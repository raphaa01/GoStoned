import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import {
  GLICKO2_ALGORITHM_VERSION,
} from "@/lib/rating/glicko2";
import {
  initialRatingForStartingStrength,
  STARTING_STRENGTH_POLICY_VERSION,
  type StartingStrength,
} from "@/lib/rating/preferences";
import {
  GLICKO2_INITIAL_RATING_DEVIATION,
  GLICKO2_INITIAL_VOLATILITY,
} from "@/lib/rating/ratingFinalizer";
import { AuthError } from "./accountService";
import { normalizeUsername } from "./password";
import { createSessionInTransaction } from "./session";
import type { AuthUser, AuthUserRow } from "./types";
import { serializeAuthUser } from "./types";

export const OAUTH_REGISTRATION_COOKIE = "gostone_oauth_registration";
export const OAUTH_REGISTRATION_MAX_AGE_SECONDS = 15 * 60;

export type OAuthProvider = "google" | "apple";

export type VerifiedOAuthIdentity = Readonly<{
  provider: OAuthProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}>;

export type OAuthSignIn =
  | Readonly<{ kind: "authenticated"; user: AuthUser; token: string }>
  | Readonly<{ kind: "registration_required"; token: string }>;

type OAuthRegistration = Readonly<{
  user: AuthUser;
  token: string;
}>;

type RegistrationIntentRow = Readonly<{
  provider: OAuthProvider;
  provider_subject: string;
  email: string | null;
  email_verified: boolean;
  user_id: string | null;
}>;

type OAuthAccountRow = AuthUserRow & Readonly<{
  username_confirmed: boolean;
}>;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isOAuthRegistrationTokenFormat(token: string | undefined): token is string {
  return Boolean(token && /^[A-Za-z0-9_-]{43}$/.test(token));
}

function cleanEmail(email: string | null): string | null {
  const normalized = email?.trim().toLowerCase() ?? "";
  return normalized && normalized.length <= 320 ? normalized : null;
}

function isUsernameUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error) || !("constraint" in error)) {
    return false;
  }
  const databaseError = error as { code?: string; constraint?: string };
  return databaseError.code === "23505"
    && (
      databaseError.constraint === "users_username_key"
      || databaseError.constraint === "idx_users_username_lower"
    );
}

function validateIdentity(identity: VerifiedOAuthIdentity): void {
  if (!identity.subject || identity.subject.length > 255) {
    throw new Error("The OAuth provider returned an invalid account identifier.");
  }
}

async function deleteExpiredRegistrationIntents(
  client: PoolClient,
): Promise<void> {
  await client.query(
    `WITH expired_intents AS MATERIALIZED (
       SELECT intent.token_hash
         FROM oauth_registration_intents AS intent
        WHERE intent.expires_at <= statement_timestamp()
        ORDER BY intent.expires_at, intent.token_hash
        LIMIT 200
        FOR UPDATE OF intent SKIP LOCKED
     )
     DELETE FROM oauth_registration_intents AS intent
     USING expired_intents AS expired
     WHERE intent.token_hash = expired.token_hash`,
  );
}

export async function beginOAuthSignIn(
  identity: VerifiedOAuthIdentity,
): Promise<OAuthSignIn> {
  validateIdentity(identity);
  const registrationToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(registrationToken);
  const email = cleanEmail(identity.email);

  return withTransaction(async (client) => {
    const existing = await client.query<OAuthAccountRow>(
      `SELECT account.id, account.username, account.display_name, account.avatar_style,
              identity.username_confirmed
         FROM auth_identities AS identity
         JOIN users AS account ON account.id = identity.user_id
        WHERE identity.provider = $1 AND identity.provider_subject = $2
        FOR UPDATE OF identity`,
      [identity.provider, identity.subject],
    );

    if (existing.rows[0]?.username_confirmed) {
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
      return { kind: "authenticated", user, token };
    }

    await client.query(
      `INSERT INTO oauth_registration_intents
         (token_hash, provider, provider_subject, email, email_verified, user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6,
               statement_timestamp() + INTERVAL '15 minutes')
       ON CONFLICT (provider, provider_subject) DO UPDATE
         SET token_hash = EXCLUDED.token_hash,
             email = EXCLUDED.email,
             email_verified = EXCLUDED.email_verified,
             user_id = EXCLUDED.user_id,
             created_at = statement_timestamp(),
             expires_at = EXCLUDED.expires_at`,
      [
        tokenHash,
        identity.provider,
        identity.subject,
        email,
        identity.emailVerified,
        existing.rows[0]?.id ?? null,
      ],
    );
    await deleteExpiredRegistrationIntents(client);
    return { kind: "registration_required", token: registrationToken };
  });
}

export async function completeOAuthRegistration(
  registrationToken: string | undefined,
  usernameValue: unknown,
  startingStrength: StartingStrength,
): Promise<OAuthRegistration> {
  if (!isOAuthRegistrationTokenFormat(registrationToken)) {
    throw new AuthError(
      "Your social registration has expired. Start again with Google or Apple.",
      401,
      "oauth_registration_expired",
    );
  }
  const username = normalizeUsername(usernameValue);
  if (!username) {
    throw new AuthError(
      "Username must contain 3–20 letters, numbers, or underscores.",
      400,
      "invalid_username",
    );
  }
  const initialRating = initialRatingForStartingStrength(startingStrength);
  const tokenHash = hashToken(registrationToken);

  return withTransaction(async (client) => {
    const intentResult = await client.query<RegistrationIntentRow>(
      `SELECT provider, provider_subject, email, email_verified, user_id
         FROM oauth_registration_intents
        WHERE token_hash = $1
          AND expires_at > statement_timestamp()
        FOR UPDATE`,
      [tokenHash],
    );
    const intent = intentResult.rows[0];
    if (!intent) {
      throw new AuthError(
        "Your social registration has expired. Start again with Google or Apple.",
        401,
        "oauth_registration_expired",
      );
    }

    let account: AuthUserRow;
    try {
      if (intent.user_id) {
        const updated = await client.query<AuthUserRow>(
          `UPDATE users
              SET username = $1,
                  display_name = $1,
                  updated_at = statement_timestamp()
            WHERE id = $2
            RETURNING id, username, display_name, avatar_style`,
          [username, intent.user_id],
        );
        if (!updated.rows[0]) throw new Error("The pending OAuth account no longer exists.");
        const confirmed = await client.query(
          `UPDATE auth_identities
              SET email = COALESCE($3, email),
                  email_verified = email_verified OR $4,
                  username_confirmed = true,
                  updated_at = statement_timestamp(),
                  last_login_at = statement_timestamp()
            WHERE provider = $1
              AND provider_subject = $2
              AND user_id = $5`,
          [
            intent.provider,
            intent.provider_subject,
            intent.email,
            intent.email_verified,
            intent.user_id,
          ],
        );
        if (confirmed.rowCount !== 1) {
          throw new Error("The pending OAuth identity no longer exists.");
        }
        account = updated.rows[0];
      } else {
        const created = await client.query<AuthUserRow>(
          `WITH account AS (
         INSERT INTO users (username, password_hash, display_name)
         VALUES ($1, NULL, $1)
         RETURNING id, username, display_name, avatar_style
       ), identity AS (
         INSERT INTO auth_identities
           (provider, provider_subject, user_id, email, email_verified, username_confirmed)
         SELECT $2, $3, id, $4, $5, true FROM account
       ), preference AS (
         INSERT INTO player_rating_preferences
           (user_id, display_preference, bot_match_preference,
            handicap_preference, preference_revision)
         SELECT id, 'both', 'never', 'even-only', 1 FROM account
       ), rating_state AS (
         INSERT INTO player_glicko2_ratings
           (user_id, player_key, rating, rating_deviation, volatility,
            rated_game_count, algorithm_version, last_rating_period_at)
         SELECT id, 'user:' || id::text, $9, $10, $11, 0, $12,
                statement_timestamp()
           FROM account
         RETURNING user_id, rating, rating_deviation, created_at
       ), initial_claim AS (
         INSERT INTO player_initial_rating_claims
           (user_id, estimate, known_rank, applied_initial_rating,
            applied_initial_deviation, policy_version, applied_at)
         SELECT user_id, $6, $7, rating, rating_deviation, $8, created_at
           FROM rating_state
       )
         SELECT id, username, display_name, avatar_style FROM account`,
          [
            username,
            intent.provider,
            intent.provider_subject,
            intent.email,
            intent.email_verified,
            startingStrength.estimate,
            startingStrength.knownRank,
            STARTING_STRENGTH_POLICY_VERSION,
            initialRating,
            GLICKO2_INITIAL_RATING_DEVIATION,
            GLICKO2_INITIAL_VOLATILITY,
            GLICKO2_ALGORITHM_VERSION,
          ],
        );
        account = created.rows[0];
      }
    } catch (error) {
      if (isUsernameUniqueViolation(error)) {
        throw new AuthError("This username is already taken.", 409, "username_taken");
      }
      throw error;
    }

    const user = serializeAuthUser(account);
    const token = await createSessionInTransaction(client, user.id);
    await client.query(
      "DELETE FROM oauth_registration_intents WHERE token_hash = $1",
      [tokenHash],
    );
    await deleteExpiredRegistrationIntents(client);
    return { user, token };
  });
}
