"use client";
import { useEffect, useState, type ReactNode } from "react";
export function FilterDrawer({ children }: { children: ReactNode }) {
  const [open,setOpen] = useState(true);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(max-width: 768px)");
    const update = () => setOpen(!media.matches);
    update(); media.addEventListener("change",update);
    return () => media.removeEventListener("change",update);
  },[]);
  return <details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Filters & refresh</summary>{children}</details>;
}
