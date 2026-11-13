import { readFile } from "node:fs/promises";
import { applyMove } from "../lib/game/goEngine";
import type { Board, Stone } from "../lib/game/types";

type Transition = { before: number[]; after: number[]; player: number; move: number; source: string };

async function main() {
const path = process.argv[2];
if (!path) throw new Error("Usage: tsx scripts/audit-puzzle-ai-rules.ts <transitions.json>");
const { transitions } = JSON.parse(await readFile(path, "utf8")) as { transitions: Transition[] };
let checked = 0;
for (const transition of transitions) {
  const board: Board = Array.from({ length: 19 }, (_, y) => transition.before.slice(y * 19, y * 19 + 19)
    .map((color): Stone | null => color === 1 ? "black" : color === 2 ? "white" : null));
  const result = applyMove(board, transition.player === 1 ? "black" : "white", transition.move % 19, Math.floor(transition.move / 19));
  if (!result.ok) throw new Error(`Independent engine rejected ${transition.source}: ${result.error}`);
  const actual = result.board.flat().map((stone) => stone === "black" ? 1 : stone === "white" ? 2 : 0);
  if (JSON.stringify(actual) !== JSON.stringify(transition.after)) throw new Error(`Board mismatch at ${transition.source}`);
  checked += 1;
}
console.log(JSON.stringify({ checked, status: "all board transitions match GoStone's independent TypeScript rule engine", limits: "Does not independently validate Benson, superko histories or proof coverage." }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
