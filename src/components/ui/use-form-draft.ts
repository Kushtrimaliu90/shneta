'use client';

import { useCallback, useState } from 'react';

/**
 * Keeping what somebody typed when the save comes back rejected.
 *
 * ── The behaviour this works around ──
 *
 * React 19 resets an uncontrolled form once its `action` resolves — success or failure, it does not
 * look at what the action returned. So a form built from `defaultValue` is emptied back to the saved
 * record at the exact moment it reports "check the fields below", and the operator's twenty minutes of
 * typing is gone along with the mistake they were being asked to fix.
 *
 * The fix is to capture the submission, hand it back as the new `defaultValue`, and bump `attempt` so
 * the inputs remount carrying the echoed values. Put `key={draft.attempt}` on the `<form>`.
 *
 * ── Why this is a hook rather than a sixth copy ──
 *
 * The same workaround was already written out by hand in five components (placements, two hero
 * editors, and the two merchant bulk forms). Four of them capture with
 * `Object.fromEntries(formData.entries())`, and that is **wrong for any form with repeated field
 * names**: `fromEntries` keeps only the last value per key, so a group of checkboxes sharing one name
 * comes back with a single box ticked. Those four forms happen not to have groups, so the bug is
 * latent there — but the product editor has three (`dietaryTags`, `categoryIds`, `goalIds`), and
 * copying the pattern a sixth time would have silently unticked categories on every rejected save.
 *
 * So the draft holds `string[]` per name, and the accessors below are the only supported way to read
 * it back.
 */
export interface FormDraft {
  /** Bump on every rejected attempt. Use as `key` on the `<form>` to force the remount. */
  attempt: number;
  /** Record a submission. Call this with the `FormData` before awaiting the action. */
  capture: (formData: FormData) => void;
  /** Forget the draft — call after a successful save so the form returns to the saved record. */
  clear: () => void;
  /** A single-value input: `defaultValue={draft.text('slug', product.slug)}`. */
  text: (name: string, fallback: string) => string;
  /**
   * One checkbox or radio out of a group sharing a name:
   * `defaultChecked={draft.selected('categoryIds', category.id, isLinked)}`.
   */
  selected: (name: string, value: string, fallback: boolean) => boolean;
  /** A lone checkbox with no siblings: `defaultChecked={draft.ticked('isFeatured', product.isFeatured)}`. */
  ticked: (name: string, fallback: boolean) => boolean;
}

export function useFormDraft(): FormDraft {
  const [draft, setDraft] = useState<Record<string, string[]> | null>(null);
  const [attempt, setAttempt] = useState(0);

  const capture = useCallback((formData: FormData) => {
    const next: Record<string, string[]> = {};

    for (const [key, value] of formData.entries()) {
      /*
       * Strings only. A file input yields a `File`, which cannot be re-seeded into an input's
       * `defaultValue` by any means — the browser owns that value and will not accept one back. File
       * fields therefore have to be re-chosen after a rejected save, which is a real limitation and
       * the reason the upload-bearing editors keep their own separate path state.
       */
      if (typeof value !== 'string') continue;
      (next[key] ??= []).push(value);
    }

    setDraft(next);
    setAttempt((current) => current + 1);
  }, []);

  const clear = useCallback(() => setDraft(null), []);

  const text = useCallback(
    (name: string, fallback: string) => draft?.[name]?.[0] ?? fallback,
    [draft],
  );

  /*
   * `draft` being present is what decides these, not the key being present.
   *
   * An unchecked box submits **nothing at all**, so an absent key after a real submission means the
   * operator deliberately cleared it — which must come back cleared. Falling back to `fallback`
   * whenever the key is missing would silently re-tick every box they had just unticked, which is a
   * more confusing bug than the data loss this hook exists to fix.
   */
  const selected = useCallback(
    (name: string, value: string, fallback: boolean) =>
      draft ? (draft[name] ?? []).includes(value) : fallback,
    [draft],
  );

  const ticked = useCallback(
    (name: string, fallback: boolean) => (draft ? (draft[name] ?? []).length > 0 : fallback),
    [draft],
  );

  return { attempt, capture, clear, text, selected, ticked };
}
