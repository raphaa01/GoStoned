export function sharedGameUrl(token: string, requestOrigin: string, appUrl = process.env.NEXT_PUBLIC_APP_URL) {
  const origin = new URL(appUrl?.trim() || requestOrigin).origin;
  return new URL(`/shared-game/${token}`, origin).toString();
}
