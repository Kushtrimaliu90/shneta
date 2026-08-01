'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { markMessageReplied, type MessageState } from '@/features/content/admin-actions';

/** docs/05 §16 — records that a reply was sent from the operator's own mail client. */
export function MarkRepliedButton({ messageId }: { messageId: string }) {
  const [state, formAction] = useActionState<MessageState, FormData>(markMessageReplied, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="messageId" value={messageId} />
      <SubmitButton size="sm" variant="secondary" loadingLabel="Saving…">
        Mark as replied
      </SubmitButton>
      {state && !state.ok && (
        <Alert tone="error" className="mt-2">
          Something went wrong. Please try again.
        </Alert>
      )}
    </form>
  );
}
