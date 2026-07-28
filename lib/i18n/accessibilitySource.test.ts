import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("mobile disclosure and global focus contracts remain wired", () => {
  const navbar = source("components/layout/Navbar.tsx");
  const styles = source("app/globals.css");
  assert.match(navbar, /aria-controls=\{menuId\}/);
  assert.match(navbar, /hidden=\{!open\}/);
  assert.match(navbar, /event\.key !== "Escape"/);
  assert.match(styles, /\.mobile-menu\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(styles, /:is\(a, button, input, select, textarea, summary, \[tabindex\]\)[^{]+:focus-visible/);
});

test("selectors and leaderboard retain explicit selection and table semantics", () => {
  const boardSelector = source("components/game/BoardSizeSelector.tsx");
  const leaderboard = source("components/leaderboard/LeaderboardView.tsx");
  assert.match(boardSelector, /role="group"/);
  assert.match(boardSelector, /aria-pressed=\{value === size\.value\}/);
  assert.match(leaderboard, /role="group"/);
  assert.match(leaderboard, /aria-pressed=\{boardSize === size\}/);
  assert.match(leaderboard, /<table>/);
  assert.match(leaderboard, /<th scope="col">/);
  assert.match(leaderboard, /<th scope="row">/);
});

test("board and modal event contracts retain their accessibility guards", () => {
  const board = source("components/game/GoBoard.tsx");
  const modal = source("components/ui/ModalDialog.tsx");
  const confirmation = source("components/ui/ConfirmModal.tsx");
  assert.match(board, /if \(isBoardNavigationKey\(event\.key\)\) event\.preventDefault\(\)/);
  assert.match(modal, /useLayoutEffect/);
  assert.match(modal, /document\.addEventListener\("focusin", containFocus\)/);
  assert.match(modal, /activeElement !== document\.body/);
  assert.match(confirmation, /initialFocusRef=\{cancelButton\}/);
  assert.match(confirmation, /role="alertdialog"/);
});
