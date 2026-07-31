/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate after every migration:  pnpm db:types
 * (`supabase gen types typescript --local > src/lib/supabase/database.types.ts`)
 *
 * This placeholder exists so M0 typechecks before the M1 migrations land. The moment the
 * first migration is applied it is replaced wholesale by the generator (CLAUDE.md §1).
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
