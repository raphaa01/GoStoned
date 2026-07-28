import { isLocale } from "@/lib/i18n/config";
import { createOpenGraphImage } from "@/lib/i18n/openGraphImage";

export const dynamic = "force-static";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  if (!isLocale(locale)) return new Response("Not found", { status: 404 });
  return createOpenGraphImage(locale);
}
