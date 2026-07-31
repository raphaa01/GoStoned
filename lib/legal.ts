export type LegalNotice = {
  operatorType: "individual" | "gbr" | "entity" | null;
  name: string;
  entityDetails: string | null;
  partners: string[];
  representedBy: string | null;
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
  preview: boolean;
};

function readOptional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readOperatorType(): LegalNotice["operatorType"] {
  const value = readOptional("LEGAL_OPERATOR_TYPE");
  return value === "individual" || value === "gbr" || value === "entity" ? value : null;
}

export function getLegalNotice(): LegalNotice {
  const configuredOperatorType = readOperatorType();
  const name = readOptional("LEGAL_NAME");
  const street = readOptional("LEGAL_STREET");
  const city = readOptional("LEGAL_CITY");
  const email = readOptional("LEGAL_EMAIL");
  const editorialName = readOptional("LEGAL_EDITORIAL_NAME");
  const editorialStreet = readOptional("LEGAL_EDITORIAL_STREET");
  const editorialCity = readOptional("LEGAL_EDITORIAL_CITY");
  const configuredPartners = [
    readOptional("LEGAL_PARTNER_1"),
    readOptional("LEGAL_PARTNER_2"),
  ].filter((partner): partner is string => partner !== null);
  const representedBy = readOptional("LEGAL_REPRESENTED_BY");
  const entityDetails = readOptional("LEGAL_ENTITY_DETAILS");
  const baseConfigured = Boolean(configuredOperatorType && name && street && city && email);
  const conditionalDetailsConfigured = configuredOperatorType === "gbr"
    ? configuredPartners.length >= 2 && Boolean(representedBy && entityDetails)
    : configuredOperatorType === "entity"
      ? Boolean(entityDetails)
      : configuredOperatorType === "individual";
  const configured = baseConfigured && conditionalDetailsConfigured;
  const preview = process.env.VERCEL_ENV === "preview" && !configured;
  const operatorType = configuredOperatorType ?? (preview ? "gbr" : null);

  return {
    operatorType,
    name: name ?? (preview ? "GoStone" : ""),
    entityDetails,
    partners: configuredPartners.length > 0
      ? configuredPartners
      : preview
        ? ["Felix Neuber"]
        : [],
    representedBy,
    street: street ?? "",
    city: city ?? "",
    country: readOptional("LEGAL_COUNTRY"),
    email: email ?? (preview ? "f.neu.dev@gmail.com" : ""),
    phone: readOptional("LEGAL_PHONE"),
    registerName: readOptional("LEGAL_REGISTER_NAME"),
    registerNumber: readOptional("LEGAL_REGISTER_NUMBER"),
    vatId: readOptional("LEGAL_VAT_ID"),
    businessId: readOptional("LEGAL_BUSINESS_ID"),
    supervisoryAuthority: readOptional("LEGAL_SUPERVISORY_AUTHORITY"),
    editorialResponsible: editorialName && editorialStreet && editorialCity
      ? { name: editorialName, street: editorialStreet, city: editorialCity }
      : null,
    dsaEmail: readOptional("LEGAL_DSA_EMAIL")
      ?? email
      ?? (preview ? "f.neu.dev@gmail.com" : ""),
    configured,
    preview,
  };
}
