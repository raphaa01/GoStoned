import { AlertTriangle, Mail, MapPin, Phone } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import type { Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLegalNotice } from "@/lib/legal";

export function LegalNotice({ locale }: { locale: Locale }) {
  const legal = getLegalNotice();
  const copy = getDictionary(locale).legal;

  return (
    <AppShell>
      <article className="legal-page">
        <header>
          <span className="section-kicker">{copy.kicker}</span>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </header>

        {!legal.configured ? (
          <div className="legal-warning" role="status">
            <AlertTriangle size={20} />
            <div>
              <strong>{copy.missingTitle}</strong>
              <p>{copy.missingDescription}</p>
            </div>
          </div>
        ) : null}

        <section className="legal-card">
          <h2>{copy.provider}</h2>
          <strong>{legal.name}</strong>
          {legal.entityDetails ? <p>{legal.entityDetails}</p> : null}
          <p className="legal-contact-line"><MapPin size={17} /> <span>{legal.street}<br />{legal.city}</span></p>
        </section>

        <section className="legal-card">
          <h2>{copy.contact}</h2>
          <p className="legal-contact-line">
            <Mail size={17} />
            {legal.configured ? <a href={`mailto:${legal.email}`}>{legal.email}</a> : <span>{legal.email}</span>}
          </p>
          {legal.phone ? (
            <p className="legal-contact-line"><Phone size={17} /><span>{legal.phone}</span></p>
          ) : null}
        </section>

        {legal.vatId ? (
          <section className="legal-card">
            <h2>{copy.vatId}</h2>
            <p>{copy.vatDescription}: {legal.vatId}</p>
          </section>
        ) : null}

        <section className="legal-card">
          <h2>{copy.copyright}</h2>
          <p>{copy.copyrightDescription}</p>
        </section>

        <p className="legal-note">{copy.note}</p>
      </article>
    </AppShell>
  );
}
