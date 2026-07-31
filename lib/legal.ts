export type LegalNotice = {
  name: string;
  entityDetails: string | null;
  street: string;
  city: string;
  country: string | null;
  email: string;
  phone: string | null;
  registerName: string | null;
  registerNumber: string | null;
  vatId: string | null;
  businessId: string | null;
  supervisoryAuthority: string | null;
  editorialResponsible: {
    name: string;
    street: string;
    city: string;
  } | null;
  dsaEmail: string;
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
  const editorialName = readOptional("LEGAL_EDITORIAL_NAME");
  const editorialStreet = readOptional("LEGAL_EDITORIAL_STREET");
  const editorialCity = readOptional("LEGAL_EDITORIAL_CITY");

  return {
    name: name ?? "[Vollständiger Name des Betreibers]",
    entityDetails: readOptional("LEGAL_ENTITY_DETAILS"),
    street: street ?? "[Straße und Hausnummer]",
    city: city ?? "[PLZ und Ort]",
    country: readOptional("LEGAL_COUNTRY"),
    email: email ?? "[E-Mail-Adresse]",
    phone: readOptional("LEGAL_PHONE"),
    registerName: readOptional("LEGAL_REGISTER_NAME"),
    registerNumber: readOptional("LEGAL_REGISTER_NUMBER"),
    vatId: readOptional("LEGAL_VAT_ID"),
    businessId: readOptional("LEGAL_BUSINESS_ID"),
    supervisoryAuthority: readOptional("LEGAL_SUPERVISORY_AUTHORITY"),
    editorialResponsible: editorialName && editorialStreet && editorialCity
      ? { name: editorialName, street: editorialStreet, city: editorialCity }
      : null,
    dsaEmail: readOptional("LEGAL_DSA_EMAIL") ?? email ?? "[E-Mail-Adresse]",
    configured: Boolean(name && street && city && email),
  };
}
