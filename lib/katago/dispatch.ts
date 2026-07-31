import { query } from "@/lib/db";

export type KataGoJobKind = "analysis" | "bot" | "puzzle";

type DispatchConfig = {
  url: string;
  tokenId: string;
  tokenSecret: string;
};

function config(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DispatchConfig | null {
  const url = environment.KATAGO_DISPATCH_URL?.trim();
  const tokenId = environment.MODAL_PROXY_TOKEN_ID?.trim();
  const tokenSecret = environment.MODAL_PROXY_TOKEN_SECRET?.trim();
  if (!url || !tokenId || !tokenSecret) return null;
  return { url, tokenId, tokenSecret };
}

export function isKataGoOnDemandConfigured(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return config(environment) !== null;
}

export async function dispatchKataGoJob(kind: KataGoJobKind, targetId?: string): Promise<boolean> {
  const settings = config();
  if (!settings) return false;
  const response = await fetch(settings.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Modal-Key": settings.tokenId,
      "Modal-Secret": settings.tokenSecret,
    },
    body: JSON.stringify({ kind, targetId: targetId ?? null }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`KataGo dispatch failed with HTTP ${response.status}.`);
  }
  return true;
}

export async function dispatchBotTurnIfNeeded(gameId: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM game_bots bot
       JOIN games game ON game.id = bot.game_id
       WHERE bot.game_id = $1 AND game.status = 'active'
     ) AS exists`,
    [gameId],
  );
  if (!result.rows[0]?.exists) return false;
  return dispatchKataGoJob("bot", gameId);
}

export async function safelyDispatch(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error("KataGo on-demand dispatch failed:", error);
  }
}
