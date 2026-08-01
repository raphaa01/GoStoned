import { query } from "@/lib/db";
import type { ProfileAvatarStyle } from "@/lib/profileAvatar";

type AvatarStyleRow = {
  avatar_style: ProfileAvatarStyle;
};

export async function updateProfileAvatarStyle(
  userId: string,
  avatarStyle: ProfileAvatarStyle,
): Promise<ProfileAvatarStyle> {
  const result = await query<AvatarStyleRow>(
    `UPDATE users
        SET avatar_style = $2,
            updated_at = statement_timestamp()
      WHERE id = $1
      RETURNING avatar_style`,
    [userId, avatarStyle],
  );
  const saved = result.rows[0];
  if (!saved) throw new Error("Profile avatar update did not return a user.");
  return saved.avatar_style;
}
