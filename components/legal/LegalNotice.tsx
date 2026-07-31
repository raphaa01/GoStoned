import { AppShell } from "@/components/layout/AppShell";
import type { Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLegalNotice } from "@/lib/legal";

export function LegalNotice({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).legal;
  const legal = getLegalNotice();

  return (
    <AppShell>
      <article className="legal-page">
        <header>
          <span className="section-kicker">{copy.kicker}</span>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </header>

        <div className="legal-sections">
          <section className="legal-section">
            <h2>{copy.provider}</h2>
            <div className="legal-section__content">
              {legal.name ? (
                <strong className="legal-provider-name">{legal.name}</strong>
              ) : null}
              {legal.entityDetails ? <p className="legal-entity-details">{legal.entityDetails}</p> : null}

              {legal.partners.length > 0 || legal.representedBy || (legal.street && legal.city) ? (
                <dl className="legal-facts">
                  {legal.partners.length > 0 ? (
                    <div>
                      <dt>{copy.partners}</dt>
                      <dd>
                        {legal.partners.map((partner) => (
                          <span key={partner}>{partner}</span>
                        ))}
                      </dd>
                    </div>
                  ) : null}
                  {legal.representedBy ? (
                    <div>
                      <dt>{copy.representation}</dt>
                      <dd>{legal.representedBy}</dd>
                    </div>
                  ) : null}
                  {legal.street && legal.city ? (
                    <div>
                      <dt>{copy.postalAddress}</dt>
                      <dd>
                        <address>
                          {legal.street}
                          <br />
                          {legal.city}
                          {legal.country ? (
                            <>
                              <br />
                              {legal.country}
                            </>
                          ) : null}
                        </address>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </div>
          </section>

          <section className="legal-section">
            <h2>{copy.contact}</h2>
            <div className="legal-section__content">
              {legal.email ? (
                <a className="legal-email" href={`mailto:${legal.email}`}>
                  {legal.email}
                </a>
              ) : null}
              {legal.phone ? <p>{legal.phone}</p> : null}
              <p className="legal-response-note">{copy.responseNote}</p>
            </div>
          </section>

          {legal.registerName && legal.registerNumber ? (
            <section className="legal-section">
              <h2>{copy.register}</h2>
              <div className="legal-section__content">
                <p>
                  {legal.registerName}: {legal.registerNumber}
                </p>
              </div>
            </section>
          ) : null}

          {legal.vatId || legal.businessId ? (
            <section className="legal-section">
              <h2>{copy.taxIdentifiers}</h2>
              <div className="legal-section__content">
                {legal.vatId ? <p>{copy.vatDescription}: {legal.vatId}</p> : null}
                {legal.businessId ? <p>{copy.businessIdDescription}: {legal.businessId}</p> : null}
              </div>
            </section>
          ) : null}

          {legal.supervisoryAuthority ? (
            <section className="legal-section">
              <h2>{copy.supervisoryAuthority}</h2>
              <div className="legal-section__content">
                <p>{legal.supervisoryAuthority}</p>
              </div>
            </section>
          ) : null}

          {legal.editorialResponsible ? (
            <section className="legal-section">
              <h2>{copy.editorialResponsibility}</h2>
              <div className="legal-section__content">
                <p>{copy.editorialDescription}</p>
                <strong>{legal.editorialResponsible.name}</strong>
                <p>
                  {legal.editorialResponsible.street}
                  <br />
                  {legal.editorialResponsible.city}
                </p>
              </div>
            </section>
          ) : null}

          <section className="legal-section">
            <h2>{copy.dsaContact}</h2>
            <div className="legal-section__content legal-section__content--dsa">
              <p>{copy.dsaDescription}</p>
              <p>{copy.dsaLanguages}</p>
              {legal.dsaEmail ? (
                <a className="legal-email" href={`mailto:${legal.dsaEmail}`}>
                  {legal.dsaEmail}
                </a>
              ) : null}
            </div>
          </section>
        </div>
      </article>
    </AppShell>
  );
}
