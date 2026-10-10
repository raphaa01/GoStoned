// Explicitly provisioned test identity. Never infer privileges from a username,
// display name, player-submitted flags, or a password. Removing this ID revokes
// the entitlement on the next authenticated request without changing progress.
const DEVELOPER_ACCOUNT_IDS: ReadonlySet<string> = new Set([
  "2f507157-9a4a-4960-b3c8-87fa721cdd26",
]);

export function hasDeveloperAccess(user: Readonly<{ id: string }> | null | undefined): boolean {
  return Boolean(user && DEVELOPER_ACCOUNT_IDS.has(user.id));
}
