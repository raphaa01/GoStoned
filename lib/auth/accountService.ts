import { query, withTransaction } from "@/lib/db";
import { hashPassword, normalizeUsername, validatePasswordIssue, verifyPassword } from "./password";
import { createSessionInTransaction } from "./session";
import type { AuthUser, AuthUserRow } from "./types";
import { serializeAuthUser } from "./types";
import {
  initialRatingForStartingStrength,
  STARTING_STRENGTH_POLICY_VERSION,
  type StartingStrength,
} from "@/lib/rating/preferences";
import {
  GLICKO2_ALGORITHM_VERSION,
} from "@/lib/rating/glicko2";
import {
  GLICKO2_INITIAL_RATING_DEVIATION,
  GLICKO2_INITIAL_VOLATILITY,
} from "@/lib/rating/ratingFinalizer";

type LoginRow = AuthUserRow & {
  password_hash: string | null;
};

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
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

export function validateCredentials(usernameValue: unknown, passwordValue: unknown) {
  const username = normalizeUsername(usernameValue);
  if (!username) {
    throw new AuthError(
      "Username must contain 3–20 letters, numbers, or underscores.",
      400,
      "invalid_username",
    );
  }
  const passwordIssue = validatePasswordIssue(passwordValue);
  if (passwordIssue) throw new AuthError(passwordIssue.message, 400, passwordIssue.code);
  return { username, password: passwordValue as string };
}

type Registration = {
  user: AuthUser;
  token: string;
};

export async function registerAccount(
  username: string,
  password: string,
  startingStrength: StartingStrength = { estimate: "unspecified", knownRank: null },
): Promise<Registration> {
  const passwordHash = await hashPassword(password);
  const initialRating = initialRatingForStartingStrength(startingStrength);
  return withTransaction(async (client) => {
    const result = await client.query<AuthUserRow>(
      `WITH account AS (
         INSERT INTO users (username, password_hash, display_name)
         VALUES ($1, $2, $1)
         RETURNING id, username, display_name
       ), preference AS (
         INSERT INTO player_rating_preferences
           (user_id,display_preference,bot_match_preference,handicap_preference,
            preference_revision)
         SELECT id,'both','never','even-only',1 FROM account
       ), rating_state AS (
         INSERT INTO player_glicko2_ratings
           (user_id,player_key,rating,rating_deviation,volatility,rated_game_count,
            algorithm_version,last_rating_period_at)
         SELECT id,'user:' || id::text,$6,$7,$8,0,$9,statement_timestamp()
           FROM account
         RETURNING user_id,rating,rating_deviation,created_at
       ), initial_claim AS (
         INSERT INTO player_initial_rating_claims
           (user_id,estimate,known_rank,applied_initial_rating,
            applied_initial_deviation,policy_version,applied_at)
         SELECT user_id,$3,$4,rating,rating_deviation,$5,created_at
           FROM rating_state
       )
       SELECT id,username,display_name FROM account`,
      [
        username,
        passwordHash,
        startingStrength.estimate,
        startingStrength.knownRank,
        STARTING_STRENGTH_POLICY_VERSION,
        initialRating,
        GLICKO2_INITIAL_RATING_DEVIATION,
        GLICKO2_INITIAL_VOLATILITY,
        GLICKO2_ALGORITHM_VERSION,
      ],
    ).catch((error: unknown) => {
      if (isUsernameUniqueViolation(error)) {
        throw new AuthError("This username is already taken.", 409, "username_taken");
      }
      throw error;
    });
    const user = serializeAuthUser(result.rows[0]);
    const token = await createSessionInTransaction(client, user.id);
    return { user, token };
  });
}

export async function authenticateAccount(
  username: string,
  password: string,
): Promise<AuthUser> {
  const result = await query<LoginRow>(
    `SELECT id, username, display_name, password_hash
       FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1`,
    [username],
  );
  const account = result.rows[0];

  const valid =
    account?.password_hash
      ? await verifyPassword(password, account.password_hash)
      : await hashPassword(password).then(() => false);
  if (!account || !valid) {
    throw new AuthError("Username or password is incorrect.", 401, "invalid_credentials");
  }
  return serializeAuthUser(account);
}
