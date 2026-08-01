'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';

/**
 * docs/05 §16 — the one mutation the contact inbox needs.
 *
 * `contact_messages` has an admin write policy, so this is a plain update through the SSR
 * client. It records **who** answered, in `replied_by`, which is the only reason the column
 * exists — an inbox two people share needs to show that one of them has it.
 */

export type MessageErrorKey = 'admin.errors.forbidden' | 'admin.errors.generic';
export type MessageState = ActionResult<{ id?: string }, MessageErrorKey> | null;

const schema = z.object({ messageId: z.string().uuid() });

export async function markMessageReplied(
  _previous: MessageState,
  formData: FormData,
): Promise<MessageState> {
  const gate = await requireCapability('customers.view');
  if (!gate.ok) return fail<MessageErrorKey, { id?: string }>(gate.error);

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail<MessageErrorKey, { id?: string }>('admin.errors.generic');

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('contact_messages')
      .update({
        status: 'replied',
        replied_at: new Date().toISOString(),
        replied_by: gate.actor.id,
      })
      .eq('id', parsed.data.messageId);

    if (error) {
      logger.error('markMessageReplied failed', { cause: error.message });
      return fail<MessageErrorKey, { id?: string }>('admin.errors.generic');
    }

    await audit('contact_message.replied', 'contact_message', parsed.data.messageId, null, null);
    revalidatePath('/admin/messages');
    return ok({ id: parsed.data.messageId });
  } catch (error) {
    logger.error('markMessageReplied threw', describeError(error));
    return fail<MessageErrorKey, { id?: string }>('admin.errors.generic');
  }
}
