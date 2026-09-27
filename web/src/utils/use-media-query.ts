import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `md` breakpoint: side-by-side list and map from here up. */
export const WIDE = "(min-width: 48rem)";

/**
 * Whether a media query matches, kept up to date. For behaviour that differs by screen
 * size (a draggable sheet on phones); for looks alone, use CSS breakpoints.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
  );
}
