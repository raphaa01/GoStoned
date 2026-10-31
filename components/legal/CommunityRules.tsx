"use client";
import Link from "next/link";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getCommunityCopy } from "@/lib/i18n/community";
export function CommunityRules() {
  const { locale, href } = useI18n(); const copy = getCommunityCopy(locale);
  return <article className="legal-page community-rules"><h1>{copy.title}</h1>
    {copy.paragraphs.map(text => <p key={text}>{text}</p>)}
    <p>{copy.retention}</p><p><Link href={href("/impressum")}>{copy.contact}</Link>{" · "}<Link href={href("/privacy")}>{copy.privacy}</Link></p>
  </article>;
}
