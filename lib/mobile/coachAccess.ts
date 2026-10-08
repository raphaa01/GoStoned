import type { AuthUser } from "@/lib/auth/types";

export function canPlayCoach(user: AuthUser | null, native: boolean, loading = false, error: string | null = null): boolean {
  return native && !loading && !error && user?.coachBetaEnabled === true;
}
