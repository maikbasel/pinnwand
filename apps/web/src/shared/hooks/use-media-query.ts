import { useEffect, useState } from "react";

/**
 * Subscribes to a CSS media query and re-renders when it changes. Returns
 * `false` during SSR and the initial pre-mount render so first paint matches
 * the smallest viewport (mobile-first), then updates on mount.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
