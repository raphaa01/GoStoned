import { randomUUID } from "node:crypto";
import { AuthError } from "./accountService";

export function resetEmailConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const domain = process.env.RESEND_EMAIL_DOMAIN?.trim();
  if (!apiKey || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new AuthError("Password recovery is temporarily unavailable.", 503, "reset_unavailable");
  }
  return { apiKey, from: `GoStone <security@${domain}>` };
}

export async function sendPasswordResetEmail(email: string, code: string, send: typeof fetch = fetch): Promise<void> {
  const { apiKey, from } = resetEmailConfiguration();
  const response = await send("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `password-reset/${randomUUID()}`,
    },
    body: JSON.stringify({
      from, to: [email], subject: "GoStone – Passwort zurücksetzen / Reset password",
      text: `Dein GoStone-Code zum Zurücksetzen des Passworts: ${code}\nDer Code ist 10 Minuten gültig. Gib ihn nur in GoStone ein und teile ihn mit niemandem. Wenn du diese Anfrage nicht gestellt hast, ignoriere diese E-Mail.\n\nYour GoStone password reset code: ${code}\nThis code expires in 10 minutes. Enter it only in GoStone and never share it. If you did not request this, ignore this email.`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  // Never expose provider payloads: they may include recipient data or secrets.
  if (!response.ok) throw new Error("Password reset email was not accepted.");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string") {
    throw new Error("Password reset email was not accepted.");
  }
}
