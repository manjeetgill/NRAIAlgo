"use client";

import { useState } from "react";
import { formatPaise, formatTimestamp } from "./format";

/** Retains only confirmed values, in memory, for this mounted metric and scope.
 * Never caches a partial sum or shares financial values across sessions. */
export function SnapshotMetric({ value, scope, asOf, count = false, signed = false }: { value: number | null; scope: string; asOf?: string | null | undefined; count?: boolean; signed?: boolean }) {
  const [saved, setSaved] = useState<{ scope: string; value: number; asOf: string | null } | null>(null);
  if (saved && saved.scope !== scope) setSaved(null);
  if (value !== null && (!saved || saved.scope !== scope || saved.value !== value || saved.asOf !== (asOf ?? null))) {
    setSaved({ scope, value, asOf: asOf ?? null });
  }
  const previous = saved?.scope === scope ? saved : null;
  const displayed = value ?? previous?.value ?? null;
  const note = previous
    ? `Last confirmed snapshot${previous.asOf ? `: ${formatTimestamp(previous.asOf) + " IST"}` : ""}. Current refresh is not complete.`
    : "No confirmed value has been received for this selection.";
  return <strong data-tone={signed && displayed !== null ? displayed < 0 ? "negative" : displayed > 0 ? "positive" : "neutral" : "neutral"} data-confirmed={displayed !== null}>{displayed === null ? "—" : count ? displayed : `${signed && displayed > 0 ? "+" : ""}${formatPaise(displayed)}`}{value === null && <sup title={note} aria-label={note}>*</sup>}</strong>;
}
