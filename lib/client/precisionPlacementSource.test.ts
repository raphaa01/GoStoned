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

test("mobile boards open a guarded press-and-drag touch lens", () => {
  const board = source("components/game/GoBoard.tsx");
  assert.match(board, /event\.pointerType !== "touch"/);
  assert.match(board, /\(pointer: coarse\) and \(max-width: 620px\)/);
  assert.match(board, /boardSize === 19 \|\| touchMagnifier/);
  assert.match(board, /onPointerDownCapture=\{handleBoardPointerDown\}/);
  assert.match(board, /onPointerMoveCapture=\{handleBoardPointerMove\}/);
  assert.match(board, /onPointerUpCapture=\{handleBoardPointerEnd\}/);
  assert.match(board, /onPointerCancelCapture=\{handleBoardPointerCancel\}/);
  assert.match(board, /TOUCH_LENS_DELAY_MS = 180/);
  assert.match(board, /Math\.hypot[\s\S]+> TOUCH_MOVE_TOLERANCE_PX/);
  assert.match(board, /multiTouch/);
  assert.match(board, /performance\.now\(\) \+ 1_000/);
  assert.match(board, /pointerTypeRef\.current === "touch"[\s\S]+performance\.now\(\) <= suppressTouchClickUntilRef\.current/);
  assert.match(board, /onClickCapture=[\s\S]+event\.stopPropagation\(\)[\s\S]+suppressTouchClickUntilRef\.current = 0/);
  assert.match(board, /onPointerDownCapture=[\s\S]+suppressTouchClickUntilRef\.current > 0[\s\S]+suppressTouchClickUntilRef\.current = 0/);
  assert.match(board, /setPointerCapture\(gesture\.pointerId\)/);
  assert.match(board, /touchLensRef\.current[\s\S]+event\.preventDefault\(\)/);
});

test("the touch lens keeps keyboard activation and submits only on release", () => {
  const board = source("components/game/GoBoard.tsx");
  assert.match(board, /TouchMagnifier/);
  assert.match(board, /touchLensCoordinates/);
  assert.match(board, /if \(!boardState\[y\]\?\.\[x\]\) onIntersectionClick\(x, y\)/);
  assert.match(board, /if \(actionable\) onIntersectionClick\(x, y\)/);
  assert.match(board, /: isPrecisionPreview \|\| undefined\}/);
  assert.match(board, /precisionRevision[\s\S]+clearTouchLens\(\)/);
});

test("responsive CSS keeps the full board fitted and the magnifier local", () => {
  const styles = source("app/globals.css");
  assert.match(styles, /\.go-board\[data-size="19"\]\[data-interaction-mode="play"\]\s*\{[\s\S]*?max-width: 100%;[\s\S]*?width: 100%;/);
  assert.match(styles, /\.touch-magnifier\s*\{[\s\S]*?height: 168px;[\s\S]*?pointer-events: none;/);
  assert.match(styles, /--touch-lens-gap: 56px/);
  assert.match(styles, /\.touch-magnifier\[data-placement="below"\]/);
  assert.match(styles, /\.touch-magnifier::after[\s\S]*?--tether-offset-x/);
  assert.match(styles, /\.touch-magnifier-board[\s\S]*?border-radius: 50%/);
  assert.doesNotMatch(styles, /data-precision/);
  assert.match(styles, /\.intersection\.is-precision-preview::after[\s\S]*?border: 3px solid[\s\S]*?box-shadow:/);
});

test("rendering and pointer snapping share one intersection geometry contract", () => {
  const board = source("components/game/GoBoard.tsx");
  const placement = source("lib/client/precisionPlacement.ts");
  const styles = source("app/globals.css");
  assert.match(placement, /export const BOARD_GRID_INSET_RATIO = 0\.07/);
  assert.match(placement, /export const BOARD_GRID_SPAN_RATIO = 1 - BOARD_GRID_INSET_RATIO \* 2/);
  assert.match(board, /BOARD_GRID_INSET_RATIO/);
  assert.match(board, /BOARD_GRID_SPAN_RATIO/);
  assert.match(board, /"--board-grid-inset"/);
  assert.match(styles, /var\(--board-grid-inset, 7%\)/);
  assert.match(styles, /var\(--board-grid-span, 86%\)/);
});

test("homepage board illustrations center every marker on explicit grid intersections", () => {
  const styles = source("app/redesign.css");
  assert.match(styles, /\.chapter-stone,[\s\S]*?transform: translate\(-50%, -50%\);/);
  assert.match(styles, /\.chapter-stone--black \{ left: 40%; top: 40%; \}/);
  assert.match(styles, /\.chapter-stone--white \{ left: 50%; top: 50%; \}/);
  assert.match(styles, /\.lesson-stone--one \{ left: 35%; top: 47\.5%; \}/);
  assert.match(styles, /\.lesson-liberty--one \{ left: 60%; top: 47\.5%; \}/);
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

test("a played stone is rendered optimistically while the server confirms it", () => {
  const room = source("components/game/GameRoom.tsx");
  const board = source("components/game/GoBoard.tsx");
  const optimisticGame = source("lib/client/optimisticGame.ts");
  const move = section(room, "async function makeMove", "async function resign");
  assert.ok(
    move.indexOf("setPendingMove({ x: move.x, y: move.y, color: game.turn })")
      < move.indexOf("await fetch"),
  );
  assert.match(move, /setPendingMove\(null\)[\s\S]+setBusy\(false\)/);
  assert.match(room, /pendingMove=\{pendingMove\}/);
  assert.match(room, /boardState=\{pendingMovePreview\?\.board \?\? game\.board\}/);
  assert.match(room, /game\.moveCount \+ \(pendingMovePreview\?\.applied \? 1 : 0\)/);
  assert.match(board, /const stone = serverStone \?\? pendingStone/);
  assert.match(optimisticGame, /applyMove\([\s\S]+result\.board/);
});

test("dead-stone groups update optimistically while the server confirms them", () => {
  const room = source("components/game/GameRoom.tsx");
  const scoring = section(room, "async function scoringAction", "async function estimateJapaneseScore");
  assert.match(room, /const \[pendingDeadStones, setPendingDeadStones\]/);
  assert.match(room, /const scoringDeadStones = pendingDeadStones \?\? game\?\.scoring\?\.deadStones/);
  assert.match(room, /const preview = toggleDeadGroup\([\s\S]+void scoringAction\("dead-stones", \{ x, y, dead \}, preview\)/);
  assert.match(scoring, /setPendingDeadStones\(deadStonePreview\)/);
  assert.match(scoring, /setPendingDeadStones\(null\)/);
});

test("version conflicts retain English and German copy", () => {
  for (const path of ["lib/i18n/catalogs/en.ts", "lib/i18n/catalogs/de.ts"]) {
    const catalogue = source(path);
    assert.match(catalogue, /game_version_conflict:/);
  }
});
