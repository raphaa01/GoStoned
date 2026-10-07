import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { consumeEphemeralIpPolicyRateLimit } from "@/lib/auth/rateLimit";
import { parseEngagementSample, recordEngagement } from "@/lib/analytics/engagement";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin
    || request.headers.get("sec-fetch-site") === "cross-site"
    || request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return noStoreJson({ ok: false }, { status: 403 });
  }
  try {
    consumeEphemeralIpPolicyRateLimit(request, { scope: "analytics-engagement", limit: 120, windowMinutes: 1 });
    const body = await readBoundedJsonObject(request, {
      maxBytes: 512, maxChunks: 512, idleTimeoutMs: 1_000, totalTimeoutMs: 2_000,
      invalidJson: () => new SyntaxError("Invalid analytics sample."),
    });
    const sample = parseEngagementSample(body);
    if (!sample) return noStoreJson({ ok: false }, { status: 400 });
    // Preview traffic must never contaminate production engagement reports.
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
      return noStoreJson({ ok: true });
    }
    await recordEngagement(sample);
    return noStoreJson({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) return noStoreJson({ ok: false }, { status: 400 });
    return apiError(error);
  }
}
