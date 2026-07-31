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

        {legal.preview || !legal.configured ? (
          <div className={`legal-warning${legal.preview ? " legal-warning--preview" : ""}`} role="status">
            <AlertTriangle size={20} />
            <div>
              <strong>{legal.preview ? copy.previewTitle : copy.missingTitle}</strong>
              <p>{legal.preview ? copy.previewDescription : copy.missingDescription}</p>
            </div>
          </div>
        ) : null}

        <div className="legal-grid">
          <section className="legal-card legal-card--provider">
            <h2>{copy.provider}</h2>
            <strong className="legal-provider-name">{legal.name}</strong>
            {legal.entityDetails ? <p className="legal-entity-details">{legal.entityDetails}</p> : null}

            {legal.partners.length > 0 ? (
              <div className="legal-detail-group">
                <span>{copy.partners}</span>
                <ul>
                  {legal.partners.map((partner) => <li key={partner}>{partner}</li>)}
                </ul>
              </div>
            ) : null}

            {legal.representedBy ? (
              <div className="legal-detail-group">
                <span>{copy.representation}</span>
                <p>{legal.representedBy}</p>
              </div>
            ) : null}

            <div className="legal-detail-group">
              <span>{copy.postalAddress}</span>
              <address className="legal-contact-line">
                <MapPin size={18} />
                <span>
                  {legal.street}<br />
                  {legal.city}
                  {legal.country ? <><br />{legal.country}</> : null}
                </span>
              </address>
            </div>
          </section>

          <section className="legal-card legal-card--contact">
            <h2>{copy.contact}</h2>
            {legal.configured || legal.preview ? (
              <a className="legal-contact-action" href={`mailto:${legal.email}`}>
                <Mail size={19} />
                <span><small>{copy.emailLabel}</small>{legal.email}</span>
              </a>
            ) : (
              <p className="legal-contact-action">
                <Mail size={19} />
                <span><small>{copy.emailLabel}</small>{legal.email}</span>
              </p>
            )}
            {legal.phone ? (
              <p className="legal-contact-action">
                <Phone size={19} />
                <span><small>{copy.phoneLabel}</small>{legal.phone}</span>
              </p>
            ) : null}
            <p className="legal-response-note">{copy.responseNote}</p>
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

          <section className="legal-card legal-card--wide legal-card--dsa">
            <div>
              <h2>{copy.dsaContact}</h2>
              <p>{copy.dsaDescription}</p>
              <p>{copy.dsaLanguages}</p>
            </div>
            {legal.configured || legal.preview ? (
              <a className="legal-contact-action" href={`mailto:${legal.dsaEmail}`}>
                <Mail size={19} />
                <span><small>{copy.emailLabel}</small>{legal.dsaEmail}</span>
              </a>
            ) : (
              <p className="legal-contact-action">
                <Mail size={19} />
                <span><small>{copy.emailLabel}</small>{legal.dsaEmail}</span>
              </p>
            )}
          </section>
        </div>
      </article>
    </AppShell>
  );
}
