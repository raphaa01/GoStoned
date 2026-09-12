"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

function redactSensitiveRouteData(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);

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
