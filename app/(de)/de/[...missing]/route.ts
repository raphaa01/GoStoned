import { localizedNotFoundResponse } from "@/lib/i18n/notFoundResponse";

export const dynamic = "force-dynamic";

export function GET() {
  return localizedNotFoundResponse("de");
}
