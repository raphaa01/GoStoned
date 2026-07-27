import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await query<{ time: Date }>("SELECT NOW() AS time");
    return NextResponse.json({
      ok: true,
      database: "connected",
      time: result.rows[0].time.toISOString(),
    });
  } catch (error) {
    console.error("Database health check failed:", error);
    return NextResponse.json(
      { ok: false, database: "disconnected" },
      { status: 500 },
    );
  }
}
