export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  playerKey: string;
};

export type AuthUserRow = {
  id: string;
  username: string;
  display_name: string | null;
};

export function serializeAuthUser(user: AuthUserRow): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name?.trim() || user.username,
    playerKey: `user:${user.id}`,
  };
}
