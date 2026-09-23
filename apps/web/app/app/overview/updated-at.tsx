"use client";
import { useClock } from "@/app/components/shell/use-clock";
import { formatTimestamp } from "./format";
export function UpdatedAt({ value }: { value: string | null | undefined }) {
  const now = useClock(), timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return <span>No confirmed refresh yet</span>;
  const seconds = Math.max(0, Math.floor((now-timestamp)/1000));
  const relative = !now ? "Updated" : seconds < 60 ? `Updated ${seconds}s ago` : seconds < 3600 ? `Updated ${Math.floor(seconds/60)}m ago` : `Updated ${Math.floor(seconds/3600)}h ago`;
  return <time dateTime={value!} title={`${formatTimestamp(value!)} IST`}>{relative} · {new Date(timestamp).toLocaleTimeString("en-IN", {timeZone:"Asia/Kolkata",hour:"numeric",minute:"2-digit"})} IST</time>;
}
