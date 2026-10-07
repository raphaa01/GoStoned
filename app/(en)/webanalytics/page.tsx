import type { Metadata } from "next";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { AppShell } from "@/components/layout/AppShell";
import { getBusinessAnalyticsReport } from "@/lib/analytics/businessReport";
import { analyticsAdminCopy } from "@/lib/analytics/adminCopy";
import { getVercelTrafficReport } from "@/lib/analytics/vercelReport";
import { getEngagementReport } from "@/lib/analytics/engagement";
import { parseTrafficPeriod } from "@/lib/analytics/trafficOptions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: analyticsAdminCopy.title,
  robots: { index: false, follow: false, noarchive: true, nocache: true },
};

export default async function WebAnalyticsPage({ searchParams }: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const now = new Date();
  const generatedAt = now.toISOString();
  const period = parseTrafficPeriod((await searchParams).period);
  const [trafficResult, businessResult, engagementResult] = await Promise.allSettled([
    getVercelTrafficReport(now, fetch, undefined, period),
    getBusinessAnalyticsReport(),
    getEngagementReport(now, period),
  ]);

  if (trafficResult.status === "rejected") {
    console.error(JSON.stringify({
      level: "error",
      message: analyticsAdminCopy.trafficErrorLog,
      error: trafficResult.reason instanceof Error ? trafficResult.reason.message : "Unknown error",
    }));
  }
  if (businessResult.status === "rejected") {
    console.error(JSON.stringify({
      level: "error",
      message: analyticsAdminCopy.businessErrorLog,
      error: businessResult.reason instanceof Error ? businessResult.reason.message : "Unknown error",
    }));
  }
  if (engagementResult.status === "rejected") {
    console.error(JSON.stringify({
      level: "error",
      message: analyticsAdminCopy.engagementErrorLog,
      error: engagementResult.reason instanceof Error ? engagementResult.reason.message : "Unknown error",
    }));
  }

  return (
    <AppShell>
      <AnalyticsDashboard
        period={period}
        engagement={engagementResult.status === "fulfilled" ? engagementResult.value : null}
        business={businessResult.status === "fulfilled" ? businessResult.value : null}
        generatedAt={generatedAt}
        traffic={trafficResult.status === "fulfilled" ? trafficResult.value : null}
      />
    </AppShell>
  );
}
