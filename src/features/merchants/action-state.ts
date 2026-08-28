import type { ActionResult } from '@/lib/result';

/**
 * The first failed state among several concurrent actions, narrowed.
 *
 * A screen that offers three buttons has three `useActionState` pairs, and it wants to render whichever
 * one just failed. `states.find(s => s && !s.ok)` returns the **union**, so reading `.error` off it does
 * not typecheck — the success branch has no such property, and TypeScript is right to say so.
 *
 * A type predicate is the honest fix. The alternative, a cast, would compile and would also survive
 * somebody later adding a fourth branch to `ActionResult` that this does not handle.
 */
export type Failure<E extends string> = Extract<ActionResult<unknown, E>, { ok: false }>;

export function firstFailure<E extends string, T>(
  states: readonly (ActionResult<T, E> | null)[],
): Failure<E> | undefined {
  return states.find((state): state is Failure<E> => state !== null && state.ok === false);
}
