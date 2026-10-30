"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** True once `shown` turns from false to true while mounted. A step that is
 * already there when its data first loads (`ready`) is not treated as new.
 */
export function useAppeared(shown: boolean, ready: boolean) {
  const seen = useRef<boolean | null>(null);
  const [appeared, setAppeared] = useState(false);
  useEffect(() => {
    if (!ready) return;
    if (seen.current === false && shown) setAppeared(true);
    seen.current = shown;
  }, [shown, ready]);
  return appeared;
}

/** Brings a review step into view when `active` turns true, so the next step is
 * not left above or below the screen after an action. Focus moves to its heading
 * (keyboard and screen-reader users land on the new step too).
 */
export function RevealStep({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!active || !box) return;
    const heading = box.querySelector<HTMLElement>("h2, h3, h4");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [active]);
  return <div ref={ref} className="scroll-mt-20">{children}</div>;
}
