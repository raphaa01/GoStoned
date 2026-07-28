import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  findHardcodedCssContent,
  findHardcodedUiText,
  type HardcodedUiText,
} from "@/lib/i18n/sourceGuard";

const ROOTS = ["app/(en)", "app/(de)", "app/og", "components"];
const FILES = ["app/globals.css", "lib/i18n/metadata.ts", "lib/i18n/openGraphImage.tsx"];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    if (
      /\.(css|js|jsx|ts|tsx)$/.test(entry.name)
      && !/\.test\.(js|jsx|ts|tsx)$/.test(entry.name)
    ) return [target];
    return [];
  }));
  return nested.flat();
}

async function main() {
  const files = [
    ...FILES,
    ...(await Promise.all(ROOTS.map(sourceFiles))).flat(),
  ].sort();
  const findings: HardcodedUiText[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    findings.push(...(file.endsWith(".css")
      ? findHardcodedCssContent(file, source)
      : findHardcodedUiText(file, source)));
  }

  if (findings.length === 0) {
    process.stdout.write(`i18n source guard passed (${files.length} files).\n`);
    return;
  }

  process.stderr.write("Hard-coded user-facing text found. Move it to both locale catalogues:\n");
  for (const finding of findings) {
    process.stderr.write(
      `${finding.file}:${finding.line}:${finding.column} [${finding.kind}] ${JSON.stringify(finding.text)}\n`,
    );
  }
  process.exitCode = 1;
}

void main();
