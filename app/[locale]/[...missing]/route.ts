import { localizedNotFoundResponse } from "@/lib/i18n/notFoundResponse";
import { isPrefixedLocale } from "@/lib/i18n/config";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  return isPrefixedLocale(locale)
    ? localizedNotFoundResponse(locale)
    : new Response(null, { status: 404 });
}
