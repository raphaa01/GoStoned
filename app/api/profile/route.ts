import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { getPlayerProfileStats } from "@/lib/stats/statsService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const profile = await getPlayerProfileStats(user.playerKey);
    return noStoreJson({ ok: true, user, ...profile });
  } catch (error) {
    return apiError(error);
  }
}
