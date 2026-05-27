"use client";

import { useEffect } from "react";

/**
 * Tiny client-side event bus on top of CustomEvent. Used by mutating
 * client components to nudge the sidebar (or anyone listening) to refetch
 * after a successful action.
 *
 * Conventions:
 *   reflex:roots-changed                   — projects list mutated
 *   reflex:topics-changed:<rootId>         — topics under that root mutated
 *   reflex:kb-changed:<rootId>             — KB files under that root mutated
 */

export const REFLEX_EVENTS = {
  rootsChanged: "reflex:roots-changed",
  topicsChanged: (rootId: string) => `reflex:topics-changed:${rootId}`,
  kbChanged: (rootId: string) => `reflex:kb-changed:${rootId}`,
} as const;

export function dispatchReflex(name: string, detail?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function useReflexEvent(
  name: string,
  handler: (detail: unknown) => void,
): void {
  useEffect(() => {
    const cb = (e: Event) => handler((e as CustomEvent).detail);
    window.addEventListener(name, cb);
    return () => window.removeEventListener(name, cb);
  }, [name, handler]);
}
