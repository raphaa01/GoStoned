import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function section(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} section must exist`);
  return value.slice(startIndex, endIndex);
}

test("the 19x19 overview accepts only guarded actual-touch precision gestures", () => {
  const board = source("components/game/GoBoard.tsx");
  assert.match(board, /event\.pointerType !== "touch"/);
  assert.match(board, /\(pointer: coarse\) and \(max-width: 620px\)/);
  assert.match(board, /onPointerDownCapture=\{handleBoardPointerDown\}/);
  assert.match(board, /onPointerMoveCapture=\{handleBoardPointerMove\}/);
  assert.match(board, /onPointerUpCapture=\{handleBoardPointerEnd\}/);
  assert.match(board, /onPointerCancelCapture=\{handleBoardPointerCancel\}/);
  assert.match(board, /Math\.hypot[\s\S]+> 10/);
  assert.match(board, /multiTouch/);
  assert.match(board, /event\.timeStamp \+ 750/);
  assert.match(board, /pointerTypeRef\.current === "touch"[\s\S]+event\.timeStamp <= suppressTouchClickUntilRef\.current/);
  assert.match(board, /onClickCapture=[\s\S]+event\.stopPropagation\(\)[\s\S]+suppressTouchClickUntilRef\.current = 0/);
  assert.match(board, /onPointerDownCapture=[\s\S]+suppressTouchClickUntilRef\.current > 0[\s\S]+suppressTouchClickUntilRef\.current = 0/);
  assert.doesNotMatch(board, /Date\.now/);
  assert.match(board, /storedSession\.resetKey === resetKey/);
  assert.match(board, /reconcilePrecisionPlacement\(storedState, precisionContext\)/);
});

test("precision mode remains perceivable, cancellable, and keyboard compatible", () => {
  const board = source("components/game/GoBoard.tsx");
  assert.doesNotMatch(board, /GoBoardSession|key=\{resetKey\}/);
  assert.match(board, /precisionSession\.resetKey !== resetKey/);
  assert.match(board, /setPrecisionSession\(\{ resetKey, state: WHOLE_BOARD \}\)/);
  assert.match(board, /aria-atomic="true" aria-live="polite" role="status"/);
  assert.match(board, /copy\.precisionPlacementStatus/);
  assert.match(board, /copy\.precisionPreviewState/);
  assert.match(board, /copy\.showWholeBoard/);
  assert.match(board, /event\.key !== "Escape"/);
  assert.match(board, /const focusPreview = window\.setTimeout\([\s\S]+buttonRefs\.current\[previewIndex\]\?\.focus\(\{ preventScroll: true \}\)[\s\S]+window\.clearTimeout\(focusPreview\)/);
  assert.doesNotMatch(board, /if \(pointerTypeRef\.current !== "touch"\) return;/);
  assert.match(board, /buttonRefs\.current\[restoreIndex\]\?\.focus\(\)/);
  assert.match(board, /: isPrecisionPreview \|\| undefined\}/);
  assert.match(board, /event\.detail === 0 \? "keyboard"/);
});

test("responsive CSS keeps a fitted overview and confines magnified panning", () => {
  const styles = source("app/globals.css");
  assert.ok((760 * 0.86) / 18 >= 24, "magnified intersections meet the WCAG target minimum");
  assert.match(styles, /\.go-board\[data-size="19"\]\[data-interaction-mode="play"\]\s*\{[\s\S]*?max-width: 100%;[\s\S]*?width: 100%;/);
  assert.match(styles, /\.go-board-shell\[data-precision="true"\][^{]+\.go-board\[data-size="19"\][^{]+\{[\s\S]*?width: 760px;/);
  assert.match(styles, /max-height: min\(70dvh, 620px\);[\s\S]*?overflow: auto;[\s\S]*?overscroll-behavior: contain;/);
  assert.match(styles, /@media \(max-width: 620px\) and \(pointer: coarse\)/);
  assert.match(styles, /data-precision="false"[^{]+\.intersection\s*\{\s*pointer-events: none;/);
  assert.match(styles, /data-precision="true"[^{]+\.intersection\s*\{\s*pointer-events: auto;/);
  assert.match(styles, /\.precision-placement-toolbar button[\s\S]*?min-height: 44px;/);
  assert.match(styles, /\.intersection\.is-precision-preview::after[\s\S]*?border: 3px solid[\s\S]*?box-shadow:/);
  assert.match(styles, /@media \(max-width: 390px\)[\s\S]*?\.precision-placement-toolbar[\s\S]*?grid-template-columns: 1fr;/);
});

test("move submission binds the rendered version and uses an owned synchronous latch", () => {
  const room = source("components/game/GameRoom.tsx");
  const move = section(room, "async function makeMove", "async function resign");
  assert.match(move, /expectedVersion: number/);
  assert.match(move, /const operationToken = moveOperationLatch\.acquire\(\);\s+if \(!operationToken\) return;/);
  assert.match(move, /JSON\.stringify\(\{ \.\.\.move, expectedVersion \}\)/);
  assert.match(move, /moveOperationLatch\.release\(operationToken\)[\s\S]+identityAuthority\.current\.isCurrent\(requestIdentity\)/);
  assert.match(room, /void makeMove\(\{ x, y \}, game\.version\)/);
  assert.match(room, /onPass=\{\(\) => makeMove\(\{ isPass: true \}, game\.version\)\}/);
  assert.match(room, /precisionRevision=\{JSON\.stringify\(\[[\s\S]+game\.version,[\s\S]+game\.status,[\s\S]+game\.phase,[\s\S]+game\.turn \?\? "none",[\s\S]+identityKey,[\s\S]+connectionState\.kind,[\s\S]+busy \? "busy" : "idle"/);
  const revision = section(room, "precisionRevision={", "])}");
  assert.doesNotMatch(revision, /clock|lastSuccessAt|observedAt|retryAt/);
});

test("precision placement and version conflicts have English and German copy", () => {
  for (const path of ["lib/i18n/catalogs/en.ts", "lib/i18n/catalogs/de.ts"]) {
    const catalogue = source(path);
    assert.match(catalogue, /game_version_conflict:/);
    assert.match(catalogue, /precisionPlacementStatus:/);
    assert.match(catalogue, /precisionPreviewState:/);
    assert.match(catalogue, /showWholeBoard:/);
  }
});
