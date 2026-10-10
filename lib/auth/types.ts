import {
  DEFAULT_PROFILE_AVATAR_STYLE,
  isProfileAvatarStyle,
  type ProfileAvatarStyle,
} from "@/lib/profileAvatar";
import { hasDeveloperAccess } from "./developerAccess";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  playerKey: string;
  avatarStyle: ProfileAvatarStyle;
  coachBetaEnabled?: boolean;
  developerAccess?: boolean;
  analysisUnlimited?: boolean;
};

export type AuthUserRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_style?: string | null;
  coach_beta_enabled?: boolean;
  analysis_unlimited?: boolean;
};

export function serializeAuthUser(user: AuthUserRow): AuthUser {
  const developerAccess = hasDeveloperAccess(user);
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name?.trim() || user.username,
    playerKey: `user:${user.id}`,
    coachBetaEnabled: user.coach_beta_enabled === true || developerAccess,
    developerAccess,
    analysisUnlimited: user.analysis_unlimited === true || developerAccess,
    avatarStyle: isProfileAvatarStyle(user.avatar_style)
      ? user.avatar_style
      : DEFAULT_PROFILE_AVATAR_STYLE,
  };
}
