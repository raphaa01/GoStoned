import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { getRequestUser } from "@/lib/auth/requestAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    return noStoreJson({ ok: true, user });
  } catch (error) {
    console.error("Session lookup failed:", error);
    return noStoreJson({ ok: false, error: "Could not read the session." }, { status: 500 });
  }
}
