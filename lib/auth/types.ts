import {
  DEFAULT_PROFILE_AVATAR_STYLE,
  isProfileAvatarStyle,
  type ProfileAvatarStyle,
} from "@/lib/profileAvatar";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  playerKey: string;
  avatarStyle: ProfileAvatarStyle;
};

export type AuthUserRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_style?: string | null;
};

export function serializeAuthUser(user: AuthUserRow): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name?.trim() || user.username,
    playerKey: `user:${user.id}`,
    avatarStyle: isProfileAvatarStyle(user.avatar_style)
      ? user.avatar_style
      : DEFAULT_PROFILE_AVATAR_STYLE,
  };
}
