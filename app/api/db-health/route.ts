import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  RATE_LIMIT_POLICIES,
  RateLimitError,
} from "@/lib/auth/rateLimit";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.publicDatabaseHealth);
    const result = await query<{ time: Date }>("SELECT NOW() AS time");
    return NextResponse.json({
      ok: true,
      database: "connected",
      time: result.rows[0].time.toISOString(),
    });
  } catch (error) {
    if (error instanceof RateLimitError) return apiError(error);
    console.error("Database health check failed:", error);
    return NextResponse.json(
      { ok: false, database: "disconnected" },
      { status: 500 },
    );
  }
}
