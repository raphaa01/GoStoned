"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { analyticsPath } from "@/lib/analytics/paths";

export function EngagementTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const path = analyticsPath(pathname);
    if (!path || navigator.doNotTrack === "1") return;
    let started = false;
    let last = performance.now();
    let visible = document.visibilityState === "visible";
    let elapsed = 0;
    const flush = () => {
      const now = performance.now();
      if (visible) elapsed += Math.max(0, now - last);
      last = now;
      const milliseconds = Math.min(60_000, Math.floor(elapsed));
      if (!started || milliseconds > 0) {
        // No browser storage, cookies, account IDs, or visitor IDs.
        void fetch("/api/analytics/engagement", {
          method: "POST", credentials: "omit", keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, milliseconds, started: !started }),
        }).catch(() => undefined);
        started = true;
        elapsed = 0;
      }
    };
    const visibilityChanged = () => {
      flush();
      visible = document.visibilityState === "visible";
    };
    const pageHidden = () => { flush(); visible = false; };
    const pageShown = () => { last = performance.now(); visible = document.visibilityState === "visible"; };
    flush();
    const interval = setInterval(flush, 30_000);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", pageHidden);
    window.addEventListener("pageshow", pageShown);
    return () => {
      flush();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", pageHidden);
      window.removeEventListener("pageshow", pageShown);
    };
  }, [pathname]);
  return null;
}
