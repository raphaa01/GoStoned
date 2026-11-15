export const NEW_USERNAME_MAX_LENGTH = 16;
const EXISTING_USERNAME_MAX_LENGTH = 20;

export function normalizeUsername(value: unknown, options?: { existing?: boolean }): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  const maxLength = options?.existing ? EXISTING_USERNAME_MAX_LENGTH : NEW_USERNAME_MAX_LENGTH;
  if (username.length < 3 || username.length > maxLength || !/^[A-Za-z0-9_]+$/.test(username)) return null;
  return username;
}
