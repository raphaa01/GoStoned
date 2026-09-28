import { noStoreJson } from "@/lib/api/responses";
import { configuredOAuthProviders } from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return noStoreJson({ ok: true, providers: configuredOAuthProviders() });
}
