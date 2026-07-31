import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function deriveKey(
  password: string,
  salt: Buffer,
  options = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { ...options, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !saltValue || !hashValue) return false;

  const expected = Buffer.from(hashValue, "base64url");
  if (expected.length !== KEY_LENGTH) return false;

  try {
    const derived = await deriveKey(password, Buffer.from(saltValue, "base64url"), {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export type PasswordValidationCode =
  | "password_required"
  | "password_too_short"
  | "password_too_long";

export function validatePasswordIssue(
  value: unknown,
): { code: PasswordValidationCode; message: string } | null {
  if (typeof value !== "string") {
    return { code: "password_required", message: "Password is required." };
  }
  if (value.length < 8) {
    return {
      code: "password_too_short",
      message: "Password must contain at least 8 characters.",
    };
  }
  if (value.length > 128) {
    return {
      code: "password_too_long",
      message: "Password must contain at most 128 characters.",
    };
  }
  return null;
}

export function validatePassword(value: unknown): string | null {
  return validatePasswordIssue(value)?.message ?? null;
}

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return null;
  return username;
}
