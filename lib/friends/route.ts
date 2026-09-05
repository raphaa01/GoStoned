import { noStoreJson, apiError } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";

export function friendRouteError(error: unknown) {
  if (error instanceof AuthError) {
    return noStoreJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return apiError(error);
}
