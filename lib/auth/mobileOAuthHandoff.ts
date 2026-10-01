import { createHash, randomBytes } from "node:crypto";
import { query } from "@/lib/db";
import type { VerifiedOAuthIdentity } from "./oauthAccountService";

const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type HandoffRow = Readonly<{
  provider: VerifiedOAuthIdentity["provider"];
  provider_subject: string;
  email: string | null;
  email_verified: boolean;
  display_name: string | null;
}>;

export function mobileOAuthChallenge(verifier: string): string | null {
  if (!CODE_PATTERN.test(verifier)) return null;
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function createMobileOAuthHandoff(
  identity: VerifiedOAuthIdentity,
  codeChallenge: string,
): Promise<string> {
  if (!CHALLENGE_PATTERN.test(codeChallenge)) throw new Error("Invalid mobile OAuth challenge.");
  const code = randomBytes(32).toString("base64url");
  const codeHash = createHash("sha256").update(code).digest("hex");
  await query(
    `INSERT INTO mobile_oauth_handoffs
       (code_hash, code_challenge, provider, provider_subject, email,
        email_verified, display_name, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, statement_timestamp() + INTERVAL '3 minutes')`,
    [codeHash, codeChallenge, identity.provider, identity.subject,
      identity.email, identity.emailVerified, identity.displayName?.slice(0, 255) ?? null],
  );
  await query(
    `WITH expired AS MATERIALIZED (
       SELECT code_hash FROM mobile_oauth_handoffs
        WHERE expires_at <= statement_timestamp()
        ORDER BY expires_at, code_hash
        LIMIT 200
        FOR UPDATE SKIP LOCKED
     )
     DELETE FROM mobile_oauth_handoffs AS handoff
      USING expired WHERE handoff.code_hash = expired.code_hash`,
  );
  return code;
}

export async function consumeMobileOAuthHandoff(
  code: string,
  verifier: string,
): Promise<VerifiedOAuthIdentity | null> {
  if (!CODE_PATTERN.test(code)) return null;
  const challenge = mobileOAuthChallenge(verifier);
  if (!challenge) return null;
  const codeHash = createHash("sha256").update(code).digest("hex");
  const result = await query<HandoffRow>(
    `DELETE FROM mobile_oauth_handoffs
      WHERE code_hash = $1
        AND code_challenge = $2
        AND expires_at > statement_timestamp()
      RETURNING provider, provider_subject, email, email_verified, display_name`,
    [codeHash, challenge],
  );
  const row = result.rows[0];
  return row ? {
    provider: row.provider,
    subject: row.provider_subject,
    email: row.email,
    emailVerified: row.email_verified,
    displayName: row.display_name,
  } : null;
}
