export type KataGoJobKind = "analysis" | "puzzle";

type DispatchConfig = {
  url: string;
  tokenId: string;
  tokenSecret: string;
};

function config(): DispatchConfig | null {
  const url = process.env.KATAGO_DISPATCH_URL?.trim();
  const tokenId = process.env.MODAL_PROXY_TOKEN_ID?.trim();
  const tokenSecret = process.env.MODAL_PROXY_TOKEN_SECRET?.trim();
  if (!url || !tokenId || !tokenSecret) return null;
  return { url, tokenId, tokenSecret };
}

export function isKataGoOnDemandConfigured(): boolean {
  return config() !== null;
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

export async function safelyDispatch(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error("KataGo on-demand dispatch failed:", error);
  }
}
