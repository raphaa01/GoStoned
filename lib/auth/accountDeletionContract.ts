export const ACCOUNT_DELETION_DAYS = 7;

export type AccountDeletionReceipt = {
  id: string;
  status: "pending" | "processing" | "completed";
  requestedAt: string;
  dueAt: string;
  completedAt: string | null;
};

export function parseAccountDeletionRequest(body: Record<string, unknown>) {
  if (Object.keys(body).some((key) => key !== "confirmed" && key !== "email") || body.confirmed !== true) {
    throw new Error("Confirm the account deletion request.");
  }
  if (typeof body.email !== "string" || body.email.length > 320) {
    throw new Error("The confirmation email is invalid.");
  }
  const email = body.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("The confirmation email is invalid.");
  }
  return { email: email || null };
}
