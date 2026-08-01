import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
  type JsonWebKey,
} from "node:crypto";
import type { Locale } from "@/lib/i18n/config";
import type { OAuthProvider, VerifiedOAuthIdentity } from "./oauthAccountService";

export type OAuthMode = "login" | "register";

export type OAuthTransaction = Readonly<{
  state: string;
  codeVerifier: string | null;
  nonce: string | null;
  mode: OAuthMode;
  locale: Locale;
  returnTo: string | null;
  expiresAt: number;
}>;

type ProviderCredentials = Readonly<{
  clientId: string;
  clientSecret: string;
}>;

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const APPLE_AUTHORIZE_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
const OAUTH_TRANSACTION_SECONDS = 10 * 60;
const PROVIDERS = new Set<OAuthProvider>(["google", "apple"]);

export class OAuthConfigurationError extends Error {}

export function isOAuthProvider(value: string): value is OAuthProvider {
  return PROVIDERS.has(value as OAuthProvider);
}

export function oauthTransactionCookie(provider: OAuthProvider): string {
  return `gostone_oauth_${provider}`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new OAuthConfigurationError(`${name} is not configured.`);
  return value;
}

function appOrigin(): string {
  const configured = requiredEnvironment("NEXT_PUBLIC_APP_URL");
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new OAuthConfigurationError("NEXT_PUBLIC_APP_URL must be an absolute URL.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new OAuthConfigurationError("NEXT_PUBLIC_APP_URL must contain only the public origin.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new OAuthConfigurationError("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
  }
  return url.origin;
}

export function oauthCallbackUrl(provider: OAuthProvider): string {
  return new URL(`/api/auth/oauth/${provider}/callback`, appOrigin()).toString();
}

function googleCredentials(): ProviderCredentials {
  return {
    clientId: requiredEnvironment("GOOGLE_CLIENT_ID"),
    clientSecret: requiredEnvironment("GOOGLE_CLIENT_SECRET"),
  };
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function appleClientSecret(): string {
  const teamId = requiredEnvironment("APPLE_TEAM_ID");
  const clientId = requiredEnvironment("APPLE_CLIENT_ID");
  const keyId = requiredEnvironment("APPLE_KEY_ID");
  const privateKey = requiredEnvironment("APPLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = base64urlJson({
    iss: teamId,
    iat: now,
    exp: now + 5 * 60,
    aud: "https://appleid.apple.com",
    sub: clientId,
  });
  const unsigned = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${unsigned}.${signature}`;
}

function appleCredentials(): ProviderCredentials {
  return {
    clientId: requiredEnvironment("APPLE_CLIENT_ID"),
    clientSecret: appleClientSecret(),
  };
}

function providerCredentials(provider: OAuthProvider): ProviderCredentials {
  return provider === "google" ? googleCredentials() : appleCredentials();
}

export function configuredOAuthProviders(): OAuthProvider[] {
  return (["google", "apple"] as const).filter((provider) => {
    try {
      providerCredentials(provider);
      appOrigin();
      return true;
    } catch (error) {
      if (error instanceof OAuthConfigurationError) return false;
      return false;
    }
  });
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createOAuthAuthorization(
  provider: OAuthProvider,
  input: Pick<OAuthTransaction, "mode" | "locale" | "returnTo">,
): { authorizationUrl: URL; transaction: OAuthTransaction } {
  const credentials = providerCredentials(provider);
  const redirectUri = oauthCallbackUrl(provider);
  const state = randomToken();
  const codeVerifier = provider === "google" ? randomToken() : null;
  const nonce = provider === "apple" ? randomToken() : null;
  const transaction: OAuthTransaction = {
    ...input,
    state,
    codeVerifier,
    nonce,
    expiresAt: Date.now() + OAUTH_TRANSACTION_SECONDS * 1000,
  };
  const authorizationUrl = new URL(
    provider === "google" ? GOOGLE_AUTHORIZE_URL : APPLE_AUTHORIZE_URL,
  );
  authorizationUrl.searchParams.set("client_id", credentials.clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("state", state);

  if (provider === "google") {
    authorizationUrl.searchParams.set("scope", "openid email profile");
    authorizationUrl.searchParams.set("prompt", "select_account");
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set(
      "code_challenge",
      createHash("sha256").update(codeVerifier as string).digest("base64url"),
    );
  } else {
    authorizationUrl.searchParams.set("scope", "name email");
    authorizationUrl.searchParams.set("response_mode", "form_post");
    authorizationUrl.searchParams.set("nonce", nonce as string);
  }

  return { authorizationUrl, transaction };
}

export function serializeOAuthTransaction(transaction: OAuthTransaction): string {
  return base64urlJson(transaction);
}

export function parseOAuthTransaction(value: string | undefined): OAuthTransaction | null {
  if (!value || value.length > 2048) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<OAuthTransaction>;
    if (
      typeof parsed.state !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(parsed.state)
      || (parsed.codeVerifier !== null && typeof parsed.codeVerifier !== "string")
      || (parsed.nonce !== null && typeof parsed.nonce !== "string")
      || (parsed.mode !== "login" && parsed.mode !== "register")
      || typeof parsed.locale !== "string"
      || (parsed.returnTo !== null && typeof parsed.returnTo !== "string")
      || typeof parsed.expiresAt !== "number"
      || parsed.expiresAt < Date.now()
    ) return null;
    return parsed as OAuthTransaction;
  } catch {
    return null;
  }
}

async function tokenRequest(url: string, parameters: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: parameters,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`OAuth token exchange failed with status ${response.status}.`);
  return await response.json() as Record<string, unknown>;
}

async function googleIdentity(
  code: string,
  redirectUri: string,
  transaction: OAuthTransaction,
): Promise<VerifiedOAuthIdentity> {
  if (!transaction.codeVerifier) throw new Error("The Google PKCE verifier is missing.");
  const credentials = googleCredentials();
  const token = await tokenRequest(GOOGLE_TOKEN_URL, new URLSearchParams({
    code,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: transaction.codeVerifier,
  }));
  if (typeof token.access_token !== "string") throw new Error("Google did not return an access token.");
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Google user verification failed with status ${response.status}.`);
  const profile = await response.json() as Record<string, unknown>;
  if (
    typeof profile.sub !== "string"
    || typeof profile.email !== "string"
    || profile.email_verified !== true
  ) throw new Error("Google did not return a verified account identity.");
  return {
    provider: "google",
    subject: profile.sub,
    email: profile.email,
    emailVerified: true,
    displayName: typeof profile.name === "string" ? profile.name : null,
  };
}

function decodeJwtPart(value: string): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The provider returned an invalid identity token.");
  }
  return parsed as Record<string, unknown>;
}

async function verifiedAppleClaims(idToken: string, transaction: OAuthTransaction) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Apple returned an invalid identity token.");
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Apple returned an unsupported identity token.");
  }
  const keysResponse = await fetch(APPLE_KEYS_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!keysResponse.ok) throw new Error("Apple signing keys are unavailable.");
  const keySet = await keysResponse.json() as { keys?: Array<Record<string, unknown>> };
  const matchingKey = keySet.keys?.find((key) => key.kid === header.kid && key.alg === "RS256");
  if (!matchingKey) throw new Error("Apple's identity signing key was not found.");
  const signatureValid = verify(
    "sha256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: matchingKey as JsonWebKey, format: "jwk" }),
    Buffer.from(parts[2], "base64url"),
  );
  if (!signatureValid) throw new Error("Apple's identity token signature is invalid.");

  const credentials = appleCredentials();
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.iss !== "https://appleid.apple.com"
    || !audiences.includes(credentials.clientId)
    || typeof claims.exp !== "number"
    || claims.exp <= now
    || typeof claims.iat !== "number"
    || claims.iat > now + 300
    || !transaction.nonce
    || claims.nonce !== transaction.nonce
  ) throw new Error("Apple's identity token claims are invalid.");
  return claims;
}

function appleDisplayName(rawUser: string | null): string | null {
  if (!rawUser || rawUser.length > 4096) return null;
  try {
    const user = JSON.parse(rawUser) as { name?: { firstName?: unknown; lastName?: unknown } };
    const pieces = [user.name?.firstName, user.name?.lastName]
      .filter((piece): piece is string => typeof piece === "string" && Boolean(piece.trim()))
      .map((piece) => piece.trim());
    return pieces.length ? pieces.join(" ") : null;
  } catch {
    return null;
  }
}

async function appleIdentity(
  code: string,
  redirectUri: string,
  transaction: OAuthTransaction,
  rawUser: string | null,
): Promise<VerifiedOAuthIdentity> {
  const credentials = appleCredentials();
  const token = await tokenRequest(APPLE_TOKEN_URL, new URLSearchParams({
    code,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  }));
  if (typeof token.id_token !== "string") throw new Error("Apple did not return an identity token.");
  const claims = await verifiedAppleClaims(token.id_token, transaction);
  if (typeof claims.sub !== "string") throw new Error("Apple did not return an account identity.");
  const email = typeof claims.email === "string" ? claims.email : null;
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  if (email && !emailVerified) throw new Error("Apple did not verify the account email.");
  return {
    provider: "apple",
    subject: claims.sub,
    email,
    emailVerified,
    displayName: appleDisplayName(rawUser),
  };
}

export function exchangeOAuthCode(
  provider: OAuthProvider,
  code: string,
  transaction: OAuthTransaction,
  rawAppleUser: string | null = null,
): Promise<VerifiedOAuthIdentity> {
  const redirectUri = oauthCallbackUrl(provider);
  return provider === "google"
    ? googleIdentity(code, redirectUri, transaction)
    : appleIdentity(code, redirectUri, transaction, rawAppleUser);
}
