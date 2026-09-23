"use client";

import { useSyncExternalStore } from "react";

// useSyncExternalStore requires getSnapshot to return a STABLE value
// between calls unless the store actually changed via the subscribed
// callback -- calling Date.now() directly as the snapshot violates
// that contract, since it returns a different value on essentially
// every call (including the extra consistency-check calls React makes
// within a single render pass), which reads as "the store is always
// changing" and causes an infinite re-render loop ("Maximum update
// depth exceeded"), not just an incorrect value. This module-level
// cache is the fix: the snapshot only changes when the interval below
// explicitly updates it and notifies React, so repeated reads between
// ticks are identical.
let cachedNowMs = Date.now();

function subscribeToClock(onStoreChange: () => void): () => void {
  const id = setInterval(() => {
    cachedNowMs = Date.now();
    onStoreChange();
  }, 1000);
  return () => clearInterval(id);
}

function getClientSnapshot(): number {
  return cachedNowMs;
}

// Server render and the very first client render (before hydration
// commits) must produce identical output, so this can never depend on
// "now". 0 is a sentinel meaning "not yet resolved".
function getServerSnapshot(): number {
  return 0;
}

/** Live-updating current instant (ms since epoch), 0 until resolved client-side. */
export function useClock(): number {
  return useSyncExternalStore(subscribeToClock, getClientSnapshot, getServerSnapshot);
}
