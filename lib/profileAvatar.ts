export const PROFILE_AVATAR_STYLES = ["kifu-classic", "urushi-mon"] as const;

export type ProfileAvatarStyle = (typeof PROFILE_AVATAR_STYLES)[number];

export const DEFAULT_PROFILE_AVATAR_STYLE: ProfileAvatarStyle = "kifu-classic";

export function isProfileAvatarStyle(value: unknown): value is ProfileAvatarStyle {
  return typeof value === "string"
    && PROFILE_AVATAR_STYLES.includes(value as ProfileAvatarStyle);
}

export function parseProfileAvatarUpdate(
  body: Record<string, unknown>,
): { avatarStyle: ProfileAvatarStyle } {
  if (
    Object.keys(body).length !== 1
    || !Object.hasOwn(body, "avatarStyle")
    || !isProfileAvatarStyle(body.avatarStyle)
  ) {
    throw new Error("Invalid profile avatar update.");
  }
  return { avatarStyle: body.avatarStyle };
}
