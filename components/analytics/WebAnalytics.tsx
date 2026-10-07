"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { EngagementTracker } from "./EngagementTracker";
import { analyticsPath } from "@/lib/analytics/paths";

export function redactSensitiveRouteData(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = new URL(event.url);

  const path = analyticsPath(url.pathname);
  if (!path) {
    return null;
  }

  url.pathname = path;
  url.search = "";
  url.hash = "";

  return {
    ...event,
    url: url.toString(),
  };
}

export function WebAnalytics() {
  return <><Analytics beforeSend={redactSensitiveRouteData} /><EngagementTracker /></>;
}
