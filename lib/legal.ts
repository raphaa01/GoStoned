export type LegalNotice = {
  name: string;
  entityDetails: string | null;
  street: string;
  city: string;
  email: string;
  phone: string | null;
  vatId: string | null;
  configured: boolean;
};

function readOptional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getLegalNotice(): LegalNotice {
  const name = readOptional("LEGAL_NAME");
  const street = readOptional("LEGAL_STREET");
  const city = readOptional("LEGAL_CITY");
  const email = readOptional("LEGAL_EMAIL");

  return {
    name: name ?? "[Vollständiger Name des Betreibers]",
    entityDetails: readOptional("LEGAL_ENTITY_DETAILS"),
    street: street ?? "[Straße und Hausnummer]",
    city: city ?? "[PLZ und Ort]",
    email: email ?? "[E-Mail-Adresse]",
    phone: readOptional("LEGAL_PHONE"),
    vatId: readOptional("LEGAL_VAT_ID"),
    configured: Boolean(name && street && city && email),
  };
}
