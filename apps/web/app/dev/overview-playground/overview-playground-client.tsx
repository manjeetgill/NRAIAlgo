"use client";
import OverviewPage from "@/app/app/overview/page";
import { Shell } from "@/app/components/shell/shell";
/** Legacy review URL uses authenticated account data; no fixture fallback. */
export function OverviewPlaygroundClient() {
  return <Shell><OverviewPage /></Shell>;
}
