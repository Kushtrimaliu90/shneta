'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { loadWishlistState } from '@/features/wishlist/actions';

/**
 * One fetch of "who am I and what have I saved" per page, shared by every heart on it.
 *
 * Mounted in the storefront layout, so a heart works on the shop grid, the PDP, the search
 * results and the compare table without each of those pages arranging it. The alternative —
 * each `WishlistButton` asking for its own state — turns a twenty-four card grid into
 * twenty-four round trips for two columns of data.
 *
 * **Sign-in state is fetched here, not passed in from the server.** That is the important part.
 * The obvious version took `isSignedIn` as a prop and the layout supplied it with
 * `getCurrentUser()` — one line, and it read `cookies()`, which opted the entire storefront into
 * dynamic rendering. Every catalogue page stopped being prerendered, and the ISR and
 * tag-purge machinery that docs/13 §K1 exists to make work became irrelevant, silently. A
 * layout is the worst possible place to touch a request-scoped API for exactly this reason: the
 * cost lands on every page beneath it.
 *
 * So the shell stays static and the personal half arrives after mount, as it does for reviews.
 */

interface WishlistContextValue {
  isSaved: (productId: string) => boolean;
  setSaved: (productId: string, saved: boolean) => void;
  isSignedIn: boolean;
  /** False until the first fetch resolves — the button waits rather than guessing. */
  ready: boolean;
}

const WishlistContext = createContext<WishlistContextValue>({
  isSaved: () => false,
  setSaved: () => {},
  isSignedIn: false,
  ready: false,
});

export function useWishlist(): WishlistContextValue {
  return useContext(WishlistContext);
}

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [saved, setSavedIds] = useState<string[]>([]);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadWishlistState().then((state) => {
      if (!active) return;
      setIsSignedIn(state.signedIn);
      setSavedIds(state.ids);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<WishlistContextValue>(
    () => ({
      isSaved: (productId) => saved.includes(productId),
      setSaved: (productId, next) =>
        setSavedIds((current) =>
          next
            ? current.includes(productId)
              ? current
              : [...current, productId]
            : current.filter((id) => id !== productId),
        ),
      isSignedIn,
      ready,
    }),
    [saved, isSignedIn, ready],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}
