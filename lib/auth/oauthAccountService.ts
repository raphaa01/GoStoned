import { createHash } from "node:crypto";
import { withTransaction } from "@/lib/db";
import {
  GLICKO2_ALGORITHM_VERSION,
} from "@/lib/rating/glicko2";
import {
  STARTING_STRENGTH_POLICY_VERSION,
} from "@/lib/rating/preferences";
import {
  GLICKO2_INITIAL_RATING,
  GLICKO2_INITIAL_RATING_DEVIATION,
  GLICKO2_INITIAL_VOLATILITY,
} from "@/lib/rating/ratingFinalizer";
import { createSessionInTransaction } from "./session";
import type { AuthUser, AuthUserRow } from "./types";
import { serializeAuthUser } from "./types";

export type OAuthProvider = "google" | "apple";

export type VerifiedOAuthIdentity = Readonly<{
  provider: OAuthProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}>;

type OAuthLogin = {
  user: AuthUser;
  token: string;
  created: boolean;
};

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && "constraint" in error
      && (error as { code?: string }).code === "23505"
      && (error as { constraint?: string }).constraint === constraint,
  );
}

function cleanEmail(email: string | null): string | null {
  const normalized = email?.trim().toLowerCase() ?? "";
  return normalized && normalized.length <= 320 ? normalized : null;
}

function cleanDisplayName(displayName: string | null): string | null {
  const normalized = displayName
    ?.replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim() ?? "";
  return normalized ? normalized.slice(0, 80) : null;
}

export function socialUsername(identity: VerifiedOAuthIdentity, attempt = 0): string {
  const source = identity.email?.split("@", 1)[0] || identity.displayName || identity.provider;
  const base = source
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || identity.provider;
  const suffix = createHash("sha256")
    .update(`${identity.provider}:${identity.subject}:${attempt}`)
    .digest("hex")
    .slice(0, 8);
  return `${base.slice(0, 11)}_${suffix}`;
}

async function oauthLoginAttempt(
  identity: VerifiedOAuthIdentity,
  username: string,
): Promise<OAuthLogin> {
  const email = cleanEmail(identity.email);
  const displayName = cleanDisplayName(identity.displayName) || username;

  return withTransaction(async (client) => {
    const existing = await client.query<AuthUserRow>(
      `SELECT account.id, account.username, account.display_name
         FROM auth_identities AS identity
         JOIN users AS account ON account.id = identity.user_id
        WHERE identity.provider = $1 AND identity.provider_subject = $2
        FOR UPDATE OF identity`,
      [identity.provider, identity.subject],
    );

    if (existing.rows[0]) {
      await client.query(
        `UPDATE auth_identities
            SET email = COALESCE($3, email),
                email_verified = email_verified OR $4,
                updated_at = statement_timestamp(),
                last_login_at = statement_timestamp()
          WHERE provider = $1 AND provider_subject = $2`,
        [identity.provider, identity.subject, email, identity.emailVerified],
      );
      const user = serializeAuthUser(existing.rows[0]);
      const token = await createSessionInTransaction(client, user.id);
      return { user, token, created: false };
    }

    const created = await client.query<AuthUserRow>(
      `WITH account AS (
         INSERT INTO users (username, password_hash, display_name)
         VALUES ($1, NULL, $2)
         RETURNING id, username, display_name
       ), identity AS (
         INSERT INTO auth_identities
           (provider, provider_subject, user_id, email, email_verified)
         SELECT $3, $4, id, $5, $6 FROM account
       ), preference AS (
         INSERT INTO player_rating_preferences
           (user_id, display_preference, bot_match_preference,
            handicap_preference, preference_revision)
         SELECT id, 'both', 'never', 'even-only', 1 FROM account
       ), rating_state AS (
         INSERT INTO player_glicko2_ratings
           (user_id, player_key, rating, rating_deviation, volatility,
            rated_game_count, algorithm_version, last_rating_period_at)
         SELECT id, 'user:' || id::text, $7, $8, $9, 0, $10,
                statement_timestamp()
           FROM account
         RETURNING user_id, rating, rating_deviation, created_at
       ), initial_claim AS (
         INSERT INTO player_initial_rating_claims
           (user_id, estimate, known_rank, applied_initial_rating,
            applied_initial_deviation, policy_version, applied_at)
         SELECT user_id, 'unspecified', NULL, rating, rating_deviation, $11,
                created_at
           FROM rating_state
       )
       SELECT id, username, display_name FROM account`,
      [
        username,
        displayName,
        identity.provider,
        identity.subject,
        email,
        identity.emailVerified,
        GLICKO2_INITIAL_RATING,
        GLICKO2_INITIAL_RATING_DEVIATION,
        GLICKO2_INITIAL_VOLATILITY,
        GLICKO2_ALGORITHM_VERSION,
        STARTING_STRENGTH_POLICY_VERSION,
      ],
    );
    const user = serializeAuthUser(created.rows[0]);
    const token = await createSessionInTransaction(client, user.id);
    return { user, token, created: true };
  });
}

export async function signInWithOAuthIdentity(
  identity: VerifiedOAuthIdentity,
): Promise<OAuthLogin> {
  if (!identity.subject || identity.subject.length > 255) {
    throw new Error("The OAuth provider returned an invalid account identifier.");
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await oauthLoginAttempt(identity, socialUsername(identity, attempt));
    } catch (error) {
      if (
        isUniqueViolation(error, "users_username_key")
        || isUniqueViolation(error, "idx_users_username_lower")
      ) {
        continue;
      }
      if (isUniqueViolation(error, "auth_identities_pkey")) {
        // A concurrent first sign-in created the mapping. Retry and read it.
        continue;
      }
      throw error;
    }
  }
  throw new Error("A unique GoStone username could not be allocated.");
}
