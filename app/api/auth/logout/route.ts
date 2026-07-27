import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { deleteSession, SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await deleteSession(request.cookies.get(SESSION_COOKIE)?.value);
    const response = noStoreJson({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error("Logout failed:", error);
    return noStoreJson({ ok: false, error: "Could not log out." }, { status: 500 });
  }
}
