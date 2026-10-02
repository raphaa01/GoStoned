import { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { parseLearnProgress } from "@/lib/learn/progress";
import { getLearnProgress, saveLearnProgress } from "@/lib/learn/progressService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.search !== "") throw new AuthError("Invalid learning progress request.", 400, "invalid_request");
    const user = await requireRequestUser(request);
    return noStoreJson({ ok: true, progress: await getLearnProgress(user.id) });
  } catch (error) {
    if (error instanceof AuthError) return noStoreJson({ok:false,error:error.message,code:error.code},{status:error.status});
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (request.nextUrl.search !== "") throw new AuthError("Invalid learning progress request.", 400, "invalid_request");
    assertAuthMutationRequest(request, { requireJson: true });
    const user = await requireRequestUser(request);
    const body = await readBoundedJsonObject(request, {
      maxBytes: 16_384,
      maxChunks: 128,
      idleTimeoutMs: 1_000,
      totalTimeoutMs: 2_000,
      invalidJson: () => new AuthError("Learning progress must be valid JSON.", 400, "invalid_request"),
    });
    if (Object.keys(body).length !== 1 || !("progress" in body)) {
      throw new AuthError("Learning progress has an invalid shape.", 400, "invalid_request");
    }
    const progress = parseLearnProgress(body.progress);
    return noStoreJson({ ok: true, progress: await saveLearnProgress(user.id, progress) });
  } catch (error) {
    if (error instanceof AuthError) return noStoreJson({ok:false,error:error.message,code:error.code},{status:error.status});
    return apiError(error);
  }
}
