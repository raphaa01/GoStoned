"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

export function redactSensitiveRouteData(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = new URL(event.url);

  if (url.pathname === "/webanalytics" || url.pathname.startsWith("/webanalytics/")) {
    return null;
  }

  url.pathname = url.pathname.replace(
    /\/(game|review)\/[^/]+$/,
    "/$1/[id]",
  );
  url.search = "";
  url.hash = "";

  return {
    ...event,
    url: url.toString(),
  };
}

export function WebAnalytics() {
  return <Analytics beforeSend={redactSensitiveRouteData} />;
}
