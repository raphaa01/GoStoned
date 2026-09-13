import type { Metadata } from "next";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { AppShell } from "@/components/layout/AppShell";
import { getBusinessAnalyticsReport } from "@/lib/analytics/businessReport";
import { analyticsAdminCopy } from "@/lib/analytics/adminCopy";
import { getVercelTrafficReport } from "@/lib/analytics/vercelReport";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: analyticsAdminCopy.title,
  robots: { index: false, follow: false, noarchive: true, nocache: true },
};

export default async function WebAnalyticsPage() {
  const generatedAt = new Date().toISOString();
  const [trafficResult, businessResult] = await Promise.allSettled([
    getVercelTrafficReport(),
    getBusinessAnalyticsReport(),
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

  return (
    <AppShell>
      <AnalyticsDashboard
        business={businessResult.status === "fulfilled" ? businessResult.value : null}
        generatedAt={generatedAt}
        traffic={trafficResult.status === "fulfilled" ? trafficResult.value : null}
      />
    </AppShell>
  );
}
