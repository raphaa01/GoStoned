"use client";

import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { useI18n } from "./I18nProvider";

export function LocalizedNotFound() {
  const { dictionary, href } = useI18n();
  return (
    <AppShell>
      <section className="not-found-page">
        <span className="section-kicker">{dictionary.notFound.kicker}</span>
        <h1>{dictionary.notFound.title}</h1>
        <p>{dictionary.notFound.description}</p>
        <Link className="button button--primary" href={href("/")}>
          {dictionary.notFound.action}
        </Link>
      </section>
    </AppShell>
  );
}
