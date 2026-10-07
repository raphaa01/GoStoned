import type { Metadata } from "next";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { AppShell } from "@/components/layout/AppShell";
import { getBusinessAnalyticsReport } from "@/lib/analytics/businessReport";
import { analyticsAdminCopy } from "@/lib/analytics/adminCopy";
import { getVercelTrafficReport } from "@/lib/analytics/vercelReport";
import { getEngagementReport } from "@/lib/analytics/engagement";
import { parseEngagementPeriod, parseTrafficPeriod } from "@/lib/analytics/trafficOptions";
import { getPriceSurveyReport, getReviewAnalyticsReport } from "@/lib/analytics/reviewReport";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: analyticsAdminCopy.title,
  robots: { index: false, follow: false, noarchive: true, nocache: true },
};

export default async function WebAnalyticsPage({ searchParams }: {
  searchParams: Promise<{ period?: string | string[]; engagement?: string | string[] }>;
}) {
  const now = new Date();
  const generatedAt = now.toISOString();
  const parameters = await searchParams;
  const period = parseTrafficPeriod(parameters.period);
  const engagementPeriod = parseEngagementPeriod(parameters.engagement, period);
  const [trafficResult, businessResult, engagementResult, reviewResult, surveyResult] = await Promise.allSettled([
    getVercelTrafficReport(now, fetch, undefined, period),
    getBusinessAnalyticsReport(),
    getEngagementReport(now, engagementPeriod),
    getReviewAnalyticsReport(now, period),
    getPriceSurveyReport(now, period),
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
  for (const [result, message] of [
    [reviewResult, analyticsAdminCopy.reviewErrorLog],
    [surveyResult, analyticsAdminCopy.surveyErrorLog],
  ] as const) {
    if (result.status === "rejected") console.error(JSON.stringify({
      level: "error", message,
      error: result.reason instanceof Error ? result.reason.message : "Unknown error",
    }));
  }

  return (
    <AppShell>
      <AnalyticsDashboard
        period={period}
        engagementPeriod={engagementPeriod}
        engagement={engagementResult.status === "fulfilled" ? engagementResult.value : null}
        business={businessResult.status === "fulfilled" ? businessResult.value : null}
        generatedAt={generatedAt}
        traffic={trafficResult.status === "fulfilled" ? trafficResult.value : null}
        reviews={reviewResult.status === "fulfilled" ? reviewResult.value : null}
        survey={surveyResult.status === "fulfilled" ? surveyResult.value : null}
      />
    </AppShell>
  );
}
