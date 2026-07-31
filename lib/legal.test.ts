import assert from "node:assert/strict";
import test from "node:test";
import { getLegalNotice } from "./legal";

const legalEnvironmentKeys = [
  "LEGAL_OPERATOR_TYPE",
  "LEGAL_NAME",
  "LEGAL_ENTITY_DETAILS",
  "LEGAL_PARTNER_1",
  "LEGAL_PARTNER_2",
  "LEGAL_REPRESENTED_BY",
  "LEGAL_STREET",
  "LEGAL_CITY",
  "LEGAL_COUNTRY",
  "LEGAL_EMAIL",
  "LEGAL_PHONE",
  "LEGAL_REGISTER_NAME",
  "LEGAL_REGISTER_NUMBER",
  "LEGAL_VAT_ID",
  "LEGAL_BUSINESS_ID",
  "LEGAL_SUPERVISORY_AUTHORITY",
  "LEGAL_EDITORIAL_NAME",
  "LEGAL_EDITORIAL_STREET",
  "LEGAL_EDITORIAL_CITY",
  "LEGAL_DSA_EMAIL",
  "VERCEL_ENV",
] as const;

function withLegalEnvironment(
  values: Partial<Record<(typeof legalEnvironmentKeys)[number], string>>,
  run: () => void,
) {
  const previous = new Map(legalEnvironmentKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of legalEnvironmentKeys) delete process.env[key];
    Object.assign(process.env, values);
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("legal notice requires only the core provider details", () => {
  withLegalEnvironment({
    LEGAL_OPERATOR_TYPE: "individual",
    LEGAL_NAME: "Example Operator",
    LEGAL_STREET: "Example Street 1",
    LEGAL_CITY: "12345 Example City",
    LEGAL_EMAIL: "legal@example.test",
  }, () => {
    const notice = getLegalNotice();

    assert.equal(notice.configured, true);
    assert.equal(notice.preview, false);
    assert.equal(notice.dsaEmail, "legal@example.test");
    assert.equal(notice.phone, null);
    assert.equal(notice.vatId, null);
    assert.equal(notice.editorialResponsible, null);
  });
});

test("legal notice exposes conditional details only when configured", () => {
  withLegalEnvironment({
    LEGAL_OPERATOR_TYPE: "gbr",
    LEGAL_NAME: "Example Company GbR",
    LEGAL_ENTITY_DETAILS: "Nicht eingetragene Gesellschaft bürgerlichen Rechts",
    LEGAL_PARTNER_1: "Example Partner One",
    LEGAL_PARTNER_2: "Example Partner Two",
    LEGAL_REPRESENTED_BY: "Example Partner One and Example Partner Two jointly",
    LEGAL_STREET: "Example Street 1",
    LEGAL_CITY: "12345 Example City",
    LEGAL_COUNTRY: "Deutschland",
    LEGAL_EMAIL: "legal@example.test",
    LEGAL_REGISTER_NAME: "Handelsregister B des Amtsgerichts Example City",
    LEGAL_REGISTER_NUMBER: "HRB 12345",
    LEGAL_VAT_ID: "DE123456789",
    LEGAL_BUSINESS_ID: "DE123456789-00001",
    LEGAL_SUPERVISORY_AUTHORITY: "Example Authority",
    LEGAL_EDITORIAL_NAME: "Editorial Person",
    LEGAL_EDITORIAL_STREET: "Editorial Street 2",
    LEGAL_EDITORIAL_CITY: "54321 Editorial City",
    LEGAL_DSA_EMAIL: "dsa@example.test",
  }, () => {
    const notice = getLegalNotice();

    assert.equal(notice.registerName, "Handelsregister B des Amtsgerichts Example City");
    assert.equal(notice.registerNumber, "HRB 12345");
    assert.equal(notice.dsaEmail, "dsa@example.test");
    assert.deepEqual(notice.partners, ["Example Partner One", "Example Partner Two"]);
    assert.equal(notice.representedBy, "Example Partner One and Example Partner Two jointly");
    assert.deepEqual(notice.editorialResponsible, {
      name: "Editorial Person",
      street: "Editorial Street 2",
      city: "54321 Editorial City",
    });
  });
});

test("partial editorial details are not published", () => {
  withLegalEnvironment({ LEGAL_EDITORIAL_NAME: "Editorial Person" }, () => {
    assert.equal(getLegalNotice().editorialResponsible, null);
  });
});

test("a GbR is not configured without both partners and its representation", () => {
  withLegalEnvironment({
    LEGAL_OPERATOR_TYPE: "gbr",
    LEGAL_NAME: "Example Company GbR",
    LEGAL_ENTITY_DETAILS: "Nicht eingetragene Gesellschaft bürgerlichen Rechts",
    LEGAL_PARTNER_1: "Example Partner One",
    LEGAL_STREET: "Example Street 1",
    LEGAL_CITY: "12345 Example City",
    LEGAL_EMAIL: "legal@example.test",
  }, () => {
    assert.equal(getLegalNotice().configured, false);
  });
});

test("Vercel previews show only confirmed data without becoming configured", () => {
  withLegalEnvironment({ VERCEL_ENV: "preview" }, () => {
    const notice = getLegalNotice();

    assert.equal(notice.configured, false);
    assert.equal(notice.preview, true);
    assert.equal(notice.name, "GoStone");
    assert.deepEqual(notice.partners, ["Felix Neuber"]);
    assert.equal(notice.entityDetails, null);
    assert.equal(notice.representedBy, null);
    assert.equal(notice.street, "");
    assert.equal(notice.city, "");
    assert.equal(notice.email, "f.neu.dev@gmail.com");
  });
});
