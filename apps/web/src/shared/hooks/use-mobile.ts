import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * True below the `md` breakpoint (< 768px). Returns false before mount so first
 * paint matches the desktop layout server-side/pre-hydration; updates on mount
 * and on viewport changes.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (): void => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
