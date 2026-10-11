import type { NextRequest } from "next/server";

export const ACCOUNT_SECURITY_HEADER = "x-gostone-account-security";
export const ACCOUNT_SECURITY_VERSION = "2";

export function usesLegacyAccountContract(request: NextRequest): boolean {
  if (request.headers.has(ACCOUNT_SECURITY_HEADER)) return false;
  const origin = request.headers.get("origin");
  if (origin === "capacitor://localhost" || origin === "https://localhost") return true;
  // Released CapacitorHttp uses native networking, forwarding only explicit
  // fetch headers. It sends neither Origin nor browser Fetch Metadata. Keep
  // that existing contract usable; this is compatibility, not authorization.
  return origin === null && !request.headers.has("sec-fetch-site");
}
