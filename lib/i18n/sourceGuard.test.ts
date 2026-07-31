import assert from "node:assert/strict";
import test from "node:test";
import { findHardcodedCssContent, findHardcodedUiText } from "./sourceGuard";

function texts(source: string): string[] {
  return findHardcodedUiText("fixture.tsx", source).map((finding) => finding.text);
}

test("i18n source guard finds visible JSX, attributes, branches, templates, setters, and metadata", () => {
  const source = `
    const view = <><button aria-label="Choose language">Play now</button>{busy ? "Saving…" : "Save"}{\`Playing as \${name}\`}</>;
    const metadata = { title: "Learn Go", alt: "Go board" };
    setError("Could not save");
    localizedApiError(dictionary, error, "Request failed");
    const unsafe = <div dangerouslySetInnerHTML={{ __html: value }} />;
    const german = <p>Partie öffnen</p>;
  `;
  assert.deepEqual(texts(source), [
    "Choose language",
    "Play now",
    "Saving…",
    "Save",
    "Playing as",
    "Learn Go",
    "Go board",
    "Could not save",
    "Request failed",
    "dangerouslySetInnerHTML",
    "Partie öffnen",
  ]);
});

test("i18n source guard ignores catalogued copy and technical literals", () => {
  const source = `
    const view = <div className={status === "active" ? "is-active" : ""}>{dictionary.nav.play}{\`${"${copy.gameOver} · ${result}"}\`}</div>;
    const route = "/api/games";
    const brand = <span>GoStone</span>;
    const timezone = <span>{"UTC"}</span>;
    const board = <span>9×9 · ©</span>;
  `;
  assert.deepEqual(texts(source), []);
});

test("i18n source guard does not inspect state discriminators in conditional expressions", () => {
  const source = `const view = <span>{status === "active" ? copy.active : copy.waiting}</span>;`;
  assert.deepEqual(texts(source), []);
});

test("i18n source guard unwraps common rendered fallback, cast, and array expressions", () => {
  const source = `
    const view = <>
      <p>{ready && "Hard-coded notice"}</p>
      <p>{message ?? "Fallback message"}</p>
      <p>{message || "Other fallback"}</p>
      <p>{"Casted notice" as string}</p>
      <p>{("Satisfied notice" satisfies string)}</p>
      <p>{["First label", "Second label"]}</p>
    </>;
  `;
  assert.deepEqual(texts(source), [
    "Hard-coded notice",
    "Fallback message",
    "Other fallback",
    "Casted notice",
    "Satisfied notice",
    "First label",
    "Second label",
  ]);
});

test("i18n source guard unwraps TypeScript angle-bracket assertions outside TSX", () => {
  const source = `const metadata = { title: <string>"Asserted notice" };`;
  assert.deepEqual(
    findHardcodedUiText("fixture.ts", source).map((finding) => finding.text),
    ["Asserted notice"],
  );
});

test("i18n source guard covers accessibility and common custom text props", () => {
  const source = `
    const view = <Widget
      aria-placeholder="Choose a point"
      aria-roledescription="Go board"
      caption="Final score"
      helperText="Use eight characters"
      tooltip="Open game"
    />;
  `;
  assert.deepEqual(texts(source), [
    "Choose a point",
    "Go board",
    "Final score",
    "Use eight characters",
    "Open game",
  ]);
});

test("i18n source guard rejects alphabetic CSS generated text", () => {
  assert.deepEqual(
    findHardcodedCssContent("fixture.css", `.label::before { content: "New"; } .step::before { content: counter(step); }`)
      .map((finding) => finding.text),
    ["New"],
  );
});
