import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Locale } from '@/lib/constants';

/** The profile shape the account UI needs. Deliberately narrow — no role leakage to views. */
export interface Profile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  preferredLocale: Locale;
  marketingOptIn: boolean;
  loyaltyPoints: number;
  role: string;
}

/**
 * Current user, or null.
 *
 * `getUser()` revalidates the JWT against the auth server; `getSession()` only decodes the
 * cookie and must never be trusted for an authorization decision.
 *
 * Wrapped in `cache()` so a layout, a page and three components in one render share a
 * single round trip.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name, phone, preferred_locale, marketing_opt_in, loyalty_points, role')
    .eq('id', user.id)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name ?? '',
    phone: data.phone,
    preferredLocale: data.preferred_locale as Locale,
    marketingOptIn: data.marketing_opt_in,
    loyaltyPoints: data.loyalty_points,
    role: data.role,
  };
});
