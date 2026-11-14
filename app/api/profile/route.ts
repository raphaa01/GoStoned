import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { getPlayerProfileStats } from "@/lib/stats/statsService";
import { getTournamentWins } from "@/lib/tournaments/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileRead, user.playerKey);
    const [profile, tournamentWins] = await Promise.all([
      getPlayerProfileStats(user.playerKey), getTournamentWins(user.id),
    ]);
    return noStoreJson({ ok: true, user, ...profile, tournamentWins });
  } catch (error) {
    return apiError(error);
  }
}
