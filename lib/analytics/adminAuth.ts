import { createHash, timingSafeEqual } from "node:crypto";

export type AnalyticsAdminCredentials = {
  username: string | undefined;
  passwordSha256: string | undefined;
};

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(sha256(left), sha256(right));
}

export function analyticsAdminCredentialsFromEnvironment(): AnalyticsAdminCredentials {
  return {
    username: process.env.WEB_ANALYTICS_ADMIN_USER,
    passwordSha256: process.env.WEB_ANALYTICS_ADMIN_PASSWORD_SHA256,
  };
}

export function isAnalyticsAdminAuthorized(
  authorization: string | null,
  credentials: AnalyticsAdminCredentials = analyticsAdminCredentialsFromEnvironment(),
): boolean {
  const expectedUsername = credentials.username?.trim();
  const expectedPasswordHash = credentials.passwordSha256?.trim().toLowerCase();
  if (!expectedUsername || !expectedPasswordHash || !/^[0-9a-f]{64}$/.test(expectedPasswordHash)) {
    return false;
  }
  if (!authorization || authorization.length > 8_192) return false;

  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(authorization);
  if (!match) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 1) return false;
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  return safeEqual(username, expectedUsername)
    && safeEqual(createHash("sha256").update(password, "utf8").digest("hex"), expectedPasswordHash);
}
