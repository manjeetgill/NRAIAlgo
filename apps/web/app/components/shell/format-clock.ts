/**
 * Formats an instant for the header clock: "Mon 21 Sep, 12:40:43" in a
 * given IANA timezone. Pulled out as a pure function specifically so
 * it's testable without rendering the Shell or dealing with the
 * browser's own timezone.
 */
export function formatClock(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}:${get("second")}`;
}

/** Time-only variant ("12:40:43") for the secondary/tertiary header clocks. */
export function formatTimeOnly(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
