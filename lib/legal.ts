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

export type LegalNoticePlaceholders = {
  name: string;
  street: string;
  city: string;
  email: string;
};

function readOptional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getLegalNotice(placeholders: LegalNoticePlaceholders): LegalNotice {
  const name = readOptional("LEGAL_NAME");
  const street = readOptional("LEGAL_STREET");
  const city = readOptional("LEGAL_CITY");
  const email = readOptional("LEGAL_EMAIL");

  return {
    name: name ?? placeholders.name,
    entityDetails: readOptional("LEGAL_ENTITY_DETAILS"),
    street: street ?? placeholders.street,
    city: city ?? placeholders.city,
    email: email ?? placeholders.email,
    phone: readOptional("LEGAL_PHONE"),
    vatId: readOptional("LEGAL_VAT_ID"),
    configured: Boolean(name && street && city && email),
  };
}
