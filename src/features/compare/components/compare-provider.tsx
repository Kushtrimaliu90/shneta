'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  COMPARE_COOKIE,
  COMPARE_COOKIE_MAX_AGE_SECONDS,
  COMPARE_MAX,
  parseCompareIds,
} from '@/features/compare/constants';

/**
 * docs/05 §9 — the comparison selection, in a cookie.
 *
 * Entirely client-side, and deliberately so. Comparing is a scratchpad: a visitor ticks three
 * products, looks at the table, and unticks two. Routing every tick through a server action
 * would mean a round trip and a revalidation for a decision that nothing else in the system
 * cares about. The cookie is written from the browser and read by the server only on `/compare`,
 * where the URL takes precedence anyway.
 *
 * Read on mount rather than during render: `document` does not exist on the server, and reading
 * it in a `useState` initialiser produces a hydration mismatch — the server renders "0 selected"
 * and the client immediately renders "3 selected" from a cookie the server never saw.
 */

interface CompareContextValue {
  ids: string[];
  isSelected: (productId: string) => boolean;
  toggle: (productId: string) => void;
  clear: () => void;
  isFull: boolean;
  /** False until the cookie has been read, so nothing renders a selection it is about to change. */
  ready: boolean;
}

const CompareContext = createContext<CompareContextValue>({
  ids: [],
  isSelected: () => false,
  toggle: () => {},
  clear: () => {},
  isFull: false,
  ready: false,
});

export function useCompare(): CompareContextValue {
  return useContext(CompareContext);
}

function readCookie(): string[] {
  if (typeof document === 'undefined') return [];
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COMPARE_COOKIE}=`));
  return parseCompareIds(match ? decodeURIComponent(match.slice(COMPARE_COOKIE.length + 1)) : null);
}

function writeCookie(ids: string[]): void {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(ids.join(','));
  document.cookie = `${COMPARE_COOKIE}=${value}; path=/; max-age=${COMPARE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setIds(readCookie());
    setReady(true);
  }, []);

  const toggle = useCallback((productId: string) => {
    setIds((current) => {
      const next = current.includes(productId)
        ? current.filter((id) => id !== productId)
        : // Silently ignoring the fifth would look broken. The button is disabled instead, and
          // this is the backstop for a keyboard or a race.
          current.length >= COMPARE_MAX
          ? current
          : [...current, productId];
      writeCookie(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setIds([]);
    writeCookie([]);
  }, []);

  const value = useMemo<CompareContextValue>(
    () => ({
      ids,
      isSelected: (productId) => ids.includes(productId),
      toggle,
      clear,
      isFull: ids.length >= COMPARE_MAX,
      ready,
    }),
    [ids, toggle, clear, ready],
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}
