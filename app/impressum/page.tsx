import type { Metadata } from "next";
import { AlertTriangle, Mail, MapPin, Phone } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { getLegalNotice } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Impressum",
  description: "Anbieterkennzeichnung und Kontakt für GoStone.",
};

export default function ImprintPage() {
  const legal = getLegalNotice();

  return (
    <AppShell>
      <article className="legal-page" lang="de">
        <header>
          <span className="section-kicker">Rechtliche Informationen</span>
          <h1>Impressum</h1>
          <p>Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)</p>
        </header>

        {!legal.configured ? (
          <div className="legal-warning" role="status">
            <AlertTriangle size={20} />
            <div>
              <strong>Betreiberangaben fehlen noch</strong>
              <p>
                Vor der öffentlichen Veröffentlichung müssen die mit Klammern
                markierten Angaben über die Vercel-Umgebungsvariablen ergänzt werden.
              </p>
            </div>
          </div>
        ) : null}

        <section className="legal-card">
          <h2>Anbieter</h2>
          <strong>{legal.name}</strong>
          {legal.entityDetails ? <p>{legal.entityDetails}</p> : null}
          <p className="legal-contact-line"><MapPin size={17} /> <span>{legal.street}<br />{legal.city}</span></p>
        </section>

        <section className="legal-card">
          <h2>Kontakt</h2>
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
            <h2>Umsatzsteuer-ID</h2>
            <p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: {legal.vatId}</p>
          </section>
        ) : null}

        <section className="legal-card">
          <h2>Urheberrecht</h2>
          <p>
            Inhalte, Gestaltung und Quellcode von GoStone sind urheberrechtlich
            geschützt, soweit nicht anders gekennzeichnet. Eine Nutzung außerhalb
            der gesetzlichen Schranken bedarf der vorherigen Zustimmung des
            jeweiligen Rechteinhabers.
          </p>
        </section>

        <p className="legal-note">
          Hinweis: Diese Seite stellt eine technische Vorlage dar und ersetzt keine
          individuelle Rechtsberatung.
        </p>
      </article>
    </AppShell>
  );
}
