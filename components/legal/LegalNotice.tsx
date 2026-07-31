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
          <p className="legal-contact-line">
            <MapPin size={17} />
            <span>
              {legal.street}<br />
              {legal.city}
              {legal.country ? <><br />{legal.country}</> : null}
            </span>
          </p>
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

        {legal.registerName && legal.registerNumber ? (
          <section className="legal-card">
            <h2>{copy.register}</h2>
            <p>{legal.registerName}: {legal.registerNumber}</p>
          </section>
        ) : null}

        {legal.vatId || legal.businessId ? (
          <section className="legal-card">
            <h2>{copy.taxIdentifiers}</h2>
            {legal.vatId ? <p>{copy.vatDescription}: {legal.vatId}</p> : null}
            {legal.businessId ? <p>{copy.businessIdDescription}: {legal.businessId}</p> : null}
          </section>
        ) : null}

        {legal.supervisoryAuthority ? (
          <section className="legal-card">
            <h2>{copy.supervisoryAuthority}</h2>
            <p>{legal.supervisoryAuthority}</p>
          </section>
        ) : null}

        {legal.editorialResponsible ? (
          <section className="legal-card">
            <h2>{copy.editorialResponsibility}</h2>
            <p>{copy.editorialDescription}</p>
            <strong>{legal.editorialResponsible.name}</strong>
            <p>
              {legal.editorialResponsible.street}<br />
              {legal.editorialResponsible.city}
            </p>
          </section>
        ) : null}

        <section className="legal-card">
          <h2>{copy.dsaContact}</h2>
          <p>{copy.dsaDescription}</p>
          <p className="legal-contact-line">
            <Mail size={17} />
            {legal.configured
              ? <a href={`mailto:${legal.dsaEmail}`}>{legal.dsaEmail}</a>
              : <span>{legal.dsaEmail}</span>}
          </p>
          <p>{copy.dsaLanguages}</p>
        </section>
      </article>
    </AppShell>
  );
}
