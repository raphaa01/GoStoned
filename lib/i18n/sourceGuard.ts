import ts from "typescript";

export type HardcodedUiText = {
  column: number;
  file: string;
  kind: string;
  line: number;
  text: string;
};

const LETTER = /\p{L}/u;
const ALLOWED_EXACT_LITERALS = new Set(["GoStone", "UTC"]);
const TEXT_ATTRIBUTES = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "cancelLabel",
  "caption",
  "confirmLabel",
  "description",
  "emptyMessage",
  "helperText",
  "label",
  "placeholder",
  "title",
  "tooltip",
]);
const TEXT_PROPERTIES = new Set([
  "alt",
  "caption",
  "description",
  "emptyMessage",
  "helperText",
  "label",
  "message",
  "placeholder",
  "shortLabel",
  "title",
  "tooltip",
]);
const TEXT_SETTERS = new Set(["setError", "setMessage", "setNotice", "setStatus"]);

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isReportable(value: string): boolean {
  const text = normalizedText(value);
  return LETTER.test(text) && !ALLOWED_EXACT_LITERALS.has(text);
}

function propertyName(node: ts.PropertyName | ts.JsxAttributeName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

function literalParts(node: ts.Expression): Array<{ node: ts.Node; text: string }> {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [{ node, text: node.text }];
  }
  if (ts.isTemplateExpression(node)) {
    return [
      { node: node.head, text: node.head.text },
      ...node.templateSpans.map((span) => ({ node: span.literal, text: span.literal.text })),
    ];
  }
  if (ts.isConditionalExpression(node)) {
    return [...literalParts(node.whenTrue), ...literalParts(node.whenFalse)];
  }
  if (
    ts.isAsExpression(node)
    || ts.isSatisfiesExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
  ) {
    return literalParts(node.expression);
  }
  if (ts.isParenthesizedExpression(node)) return literalParts(node.expression);
  if (
    ts.isBinaryExpression(node)
    && [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(node.operatorToken.kind)
  ) {
    return [...literalParts(node.left), ...literalParts(node.right)];
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) => (
      ts.isSpreadElement(element) ? literalParts(element.expression) : literalParts(element)
    ));
  }
  return [];
}

export function findHardcodedUiText(file: string, source: string): HardcodedUiText[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : file.endsWith(".jsx")
        ? ts.ScriptKind.JSX
        : file.endsWith(".js")
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS,
  );
  const findings: HardcodedUiText[] = [];

  function report(node: ts.Node, text: string, kind: string) {
    const normalized = normalizedText(text);
    if (!isReportable(normalized)) return;
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      column: position.character + 1,
      file,
      kind,
      line: position.line + 1,
      text: normalized,
    });
  }

  function reportExpression(expression: ts.Expression | undefined, kind: string) {
    if (!expression) return;
    for (const part of literalParts(expression)) report(part.node, part.text, kind);
  }

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) report(node, node.text, "JSX text");

    if (ts.isJsxAttribute(node)) {
      const name = propertyName(node.name);
      if (name === "dangerouslySetInnerHTML") {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push({
          column: position.character + 1,
          file,
          kind: "unsafe HTML",
          line: position.line + 1,
          text: "dangerouslySetInnerHTML",
        });
      } else if (name && TEXT_ATTRIBUTES.has(name)) {
        if (node.initializer && ts.isStringLiteral(node.initializer)) {
          report(node.initializer, node.initializer.text, `JSX ${name}`);
        } else if (node.initializer && ts.isJsxExpression(node.initializer)) {
          reportExpression(node.initializer.expression, `JSX ${name}`);
        }
      }
    }

    if (
      ts.isJsxExpression(node)
      && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      reportExpression(node.expression, "rendered expression");
    }

    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && TEXT_PROPERTIES.has(name)) reportExpression(node.initializer, `property ${name}`);
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (TEXT_SETTERS.has(node.expression.text)) {
        reportExpression(node.arguments[0], `${node.expression.text} call`);
      }
      if (node.expression.text === "localizedApiError") {
        reportExpression(node.arguments[2], "localizedApiError fallback");
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

export function findHardcodedCssContent(file: string, source: string): HardcodedUiText[] {
  const findings: HardcodedUiText[] = [];
  const declaration = /content\s*:\s*(["'])([\s\S]*?)\1\s*;/g;
  for (const match of source.matchAll(declaration)) {
    const text = normalizedText(match[2] ?? "");
    if (!isReportable(text) || match.index === undefined) continue;
    const before = source.slice(0, match.index);
    const lines = before.split("\n");
    findings.push({
      column: (lines.at(-1)?.length ?? 0) + 1,
      file,
      kind: "CSS generated text",
      line: lines.length,
      text,
    });
  }
  return findings;
}
