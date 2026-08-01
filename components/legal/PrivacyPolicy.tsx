import { AppShell } from "@/components/layout/AppShell";
import type { Locale } from "@/lib/i18n/config";
import { getPrivacyCopy } from "@/lib/i18n/privacy";
import { getLegalNotice } from "@/lib/legal";

export function PrivacyPolicy({ locale }: { locale: Locale }) {
  const copy = getPrivacyCopy(locale);
  const legal = getLegalNotice();

  return (
    <AppShell>
      <article className="legal-page privacy-page">
        <header>
          <span className="section-kicker">{copy.kicker}</span>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
          <p className="privacy-updated">
            {copy.updatedLabel}: <time dateTime="2026-07-31">{copy.updated}</time>
          </p>
        </header>

        <div className="legal-sections">
          <section className="legal-section">
            <h2>{copy.controller.title}</h2>
            <div className="legal-section__content">
              <p>{copy.controller.intro}</p>
              {legal.name ? (
                <strong className="legal-provider-name privacy-controller-name">{legal.name}</strong>
              ) : null}
              {legal.entityDetails ? <p>{legal.entityDetails}</p> : null}
              {legal.representedBy ? (
                <p><strong>{copy.controller.representedBy}:</strong> {legal.representedBy}</p>
              ) : null}
              {legal.street && legal.city ? (
                <p>
                  <strong>{copy.controller.address}:</strong><br />
                  {legal.street}<br />
                  {legal.city}
                  {legal.country ? <><br />{legal.country}</> : null}
                </p>
              ) : null}
              {legal.email ? (
                <p>
                  <strong>{copy.controller.contact}:</strong><br />
                  <a className="legal-email privacy-email" href={`mailto:${legal.email}`}>
                    {legal.email}
                  </a>
                </p>
              ) : null}
            </div>
          </section>

          {copy.sections.map((section) => (
            <section className="legal-section" key={section.title}>
              <h2>{section.title}</h2>
              <div className="legal-section__content privacy-copy">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.items.length > 0 ? (
                  <ul>
                    {section.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : null}
              </div>
            </section>
          ))}

          <section className="legal-section">
            <h2>{copy.cookies.title}</h2>
            <div className="legal-section__content privacy-copy">
              <p>{copy.cookies.intro}</p>
              <div
                aria-label={copy.cookies.title}
                className="privacy-table-wrap"
                role="region"
                tabIndex={0}
              >
                <table className="privacy-table">
                  <thead>
                    <tr>
                      <th scope="col">{copy.cookies.name}</th>
                      <th scope="col">{copy.cookies.purpose}</th>
                      <th scope="col">{copy.cookies.duration}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {copy.cookies.rows.map((row) => (
                      <tr key={row.name}>
                        <th scope="row"><code>{row.name}</code></th>
                        <td>{row.purpose}</td>
                        <td>{row.duration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>{copy.cookies.closing}</p>
            </div>
          </section>

          <section className="legal-section">
            <h2>{copy.processors.title}</h2>
            <div className="legal-section__content privacy-copy">
              <p>{copy.processors.intro}</p>
              <div className="privacy-processors">
                {copy.processors.entries.map((entry) => (
                  <section className="privacy-processor" key={entry.name}>
                    <h3>{entry.name}</h3>
                    <p>{entry.purpose}</p>
                    <a href={entry.privacyUrl} rel="noreferrer">{copy.processors.privacyLabel}</a>
                  </section>
                ))}
              </div>
              <p>{copy.processors.transfer}</p>
            </div>
          </section>

          <section className="legal-section">
            <h2>{copy.rights.title}</h2>
            <div className="legal-section__content privacy-copy">
              <p>{copy.rights.intro}</p>
              <ul>
                {copy.rights.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p>{copy.rights.contact}</p>
            </div>
          </section>
        </div>
      </article>
    </AppShell>
  );
}
