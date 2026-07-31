'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Sign-out for the admin tree.
 *
 * Separate from `features/auth/actions.ts#signOut` because that one ends in
 * `localizedRedirect`, which resolves the active locale through next-intl. The admin tree sits
 * outside `[locale]` and has no request locale (docs/01 §3 — English only), so the locale
 * lookup there is meaningless at best.
 *
 * Lands on the English sign-in page, matching what the admin middleware does when it finds no
 * session. One destination for "you are not signed in to the admin panel", however you got
 * there.
 */
export async function adminSignOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // The storefront layout renders the signed-in state too, so its cache has to go as well.
  revalidatePath('/', 'layout');
  redirect('/en/auth/sign-in');
}
