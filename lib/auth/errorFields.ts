export type AuthField = "username" | "password";

export function affectedAuthFields(code: string | undefined): AuthField[] {
  if (code === "invalid_username" || code === "username_taken") return ["username"];
  if (
    code === "password_required"
    || code === "password_too_short"
    || code === "password_too_long"
  ) {
    return ["password"];
  }
  if (code === "invalid_credentials") return ["username", "password"];
  return [];
}
