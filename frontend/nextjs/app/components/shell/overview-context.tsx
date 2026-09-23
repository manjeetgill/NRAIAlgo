"use client";
import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from "react";
import type { OverviewSnapshot } from "@nraialgo/contracts";
export type ShellOverview = { snapshot: OverviewSnapshot | null; stale: boolean };
export const ShellOverviewContext = createContext<Dispatch<SetStateAction<ShellOverview>> | null>(null);
/** Share the page's existing fetch with the shell, without another broker poll. */
export function useShellOverview(snapshot: OverviewSnapshot | null, stale = false) {
  const publish = useContext(ShellOverviewContext);
  useEffect(() => {
    publish?.({ snapshot, stale });
    return () => publish?.({ snapshot: null, stale: false });
  }, [publish, snapshot, stale]);
}
