import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const sourcePath = args.get("--source");
const binaryPath = args.get("--binary");
const modelPath = args.get("--model");
const configPath = args.get("--config");
const outputPath = args.get("--output");
const limit = Number(args.get("--limit") ?? 200);
const visits = Number(args.get("--visits") ?? 160);
const engineVersion = args.get("--engine-version") ?? "v1.17.1";

if (!sourcePath || !binaryPath || !modelPath || !configPath || !outputPath) {
  throw new Error("Usage: node scripts/generate-gokyo-shumyo-catalog.mjs --source <sgf> --binary <katago> --model <model> --config <cfg> --output <json> [--limit 200] [--visits 160]");
}

const SECTION_METADATA = {
  1: { category: "gokyo_life", title: "Living", total: 103, baseRank: 23 },
  2: { category: "gokyo_death", title: "Killing", total: 71, baseRank: 21 },
  3: { category: "gokyo_ko", title: "Ko", total: 90, baseRank: 17 },
};

function values(node, property) {
  const match = node.match(new RegExp(`${property}((?:\\[[^\\]]*\\])+)`));
  return match ? [...match[1].matchAll(/\[([^\]]*)\]/g)].map((entry) => entry[1]) : [];
}

function sgfPoint(value) {
  return { x: value.charCodeAt(0) - 97, y: value.charCodeAt(1) - 97 };
}

function gtpPoint(value, boardSize = 19) {
  const match = /^([A-HJ-T])(\d{1,2})$/i.exec(value);
  if (!match) return null;
  const letter = match[1].toUpperCase().charCodeAt(0);
  const x = letter - 65 - (letter > 73 ? 1 : 0);
  const y = boardSize - Number(match[2]);
  return x >= 0 && x < boardSize && y >= 0 && y < boardSize ? { x, y } : null;
}

function toGtp(point, boardSize = 19) {
  const letter = String.fromCharCode(65 + point.x + (point.x >= 8 ? 1 : 0));
  return `${letter}${boardSize - point.y}`;
}

function parseProblems(source) {
  const nodes = [...source.matchAll(/\(;C\[problem (\d+)-(\d+), ([^\]]+)\]PL\[([BW])\][^)]*\)/g)];
  return nodes.slice(0, limit).map((match, index) => {
    const section = Number(match[1]);
    const sectionOrder = Number(match[2]);
    const metadata = SECTION_METADATA[section];
    if (!metadata) throw new Error(`Unsupported Gokyo Shumyo section ${section}.`);
    const node = match[0];
    const black = values(node, "AB").map(sgfPoint);
    const white = values(node, "AW").map(sgfPoint);
    const toPlay = match[4] === "B" ? "black" : "white";
    if ([...black, ...white].some(({ x, y }) => x < 0 || x > 18 || y < 0 || y > 18)) {
      throw new Error(`Problem ${section}-${sectionOrder} does not fit a 19x19 board.`);
    }
    return {
      globalOrder: index + 1,
      section,
      sectionOrder,
      category: metadata.category,
      sectionTitle: metadata.title,
      sectionTotal: metadata.total,
      baseRank: metadata.baseRank,
      toPlay,
      black,
      white,
    };
  });
}

function localMoves(problem) {
  const stones = [...problem.black, ...problem.white];
  const occupied = new Set(stones.map(({ x, y }) => `${x}:${y}`));
  // These classical diagrams describe a local corner problem. Letting normal
  // whole-board analysis play into the surrounding empty board rewards remote
  // territory moves instead of solving the life-and-death shape. Restrict both
  // players to the rectangle occupied by the diagram so every candidate is an
  // answer to the local problem rather than an unrelated opening move.
  const maxX = Math.max(...stones.map(({ x }) => x));
  const maxY = Math.max(...stones.map(({ y }) => y));
  const result = [];
  for (let y = 0; y <= maxY; y += 1) {
    for (let x = 0; x <= maxX; x += 1) {
      if (!occupied.has(`${x}:${y}`)) result.push(toGtp({ x, y }));
    }
  }
  return result;
}

function analysisQuery(problem) {
  const moves = localMoves(problem);
  return {
    id: `gokyo-${problem.globalOrder}`,
    initialStones: [
      ...problem.black.map((point) => ["B", toGtp(point)]),
      ...problem.white.map((point) => ["W", toGtp(point)]),
    ],
    initialPlayer: problem.toPlay === "black" ? "B" : "W",
    allowMoves: [
      { player: "B", moves, untilDepth: 8 },
      { player: "W", moves, untilDepth: 8 },
    ],
    moves: [],
    rules: "japanese",
    komi: 0,
    boardXSize: 19,
    boardYSize: 19,
    analyzeTurns: [0],
    maxVisits: visits,
    analysisPVLen: 8,
    includePolicy: true,
  };
}

function rankedCandidates(result) {
  return [...(result.moveInfos ?? [])]
    .filter((candidate) => candidate.move.toLowerCase() !== "pass" && gtpPoint(candidate.move))
    .sort((left, right) => (left.order ?? 999) - (right.order ?? 999) || (right.visits ?? 0) - (left.visits ?? 0));
}

function estimatedRank(problem, best, second) {
  const prior = Math.max(0, Math.min(1, Number(best.prior) || 0));
  const scoreGap = second ? Math.max(0, Number(best.scoreLead) - Number(second.scoreLead)) : 0;
  const progress = (problem.sectionOrder - 1) / Math.max(1, problem.sectionTotal - 1);
  const estimate = problem.baseRank
    + Math.min(4, prior * 12)
    + Math.min(3, scoreGap / 2)
    - progress * 5;
  return Math.max(8, Math.min(30, Math.round(estimate)));
}

function moveLine(problem, candidate) {
  const source = candidate.pv?.length ? candidate.pv : [candidate.move];
  const moves = [];
  let color = problem.toPlay;
  for (const move of source) {
    const point = gtpPoint(move);
    if (!point) break;
    moves.push({ color, move: toGtp(point, 19), ...point });
    color = color === "black" ? "white" : "black";
    if (moves.length === 5) break;
  }
  return moves;
}

async function analyze(problems) {
  const engine = spawn(binaryPath, [
    "analysis",
    "-model", modelPath,
    "-config", configPath,
    "-quit-without-waiting",
  ], { stdio: ["pipe", "pipe", "pipe"] });
  const results = new Map();
  let active = 0;
  let nextIndex = 0;
  let stderr = "";
  engine.stderr.setEncoding("utf8");
  engine.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
    process.stderr.write(chunk);
  });
  const lines = createInterface({ input: engine.stdout });
  const pump = () => {
    while (active < 8 && nextIndex < problems.length) {
      engine.stdin.write(`${JSON.stringify(analysisQuery(problems[nextIndex]))}\n`);
      nextIndex += 1;
      active += 1;
    }
  };
  const complete = new Promise((resolve, reject) => {
    lines.on("line", (line) => {
      let value;
      try { value = JSON.parse(line); } catch { return; }
      if (value.error) {
        reject(new Error(`KataGo rejected ${value.id}: ${value.error}`));
        return;
      }
      if (value.id?.startsWith("gokyo-") && value.isDuringSearch !== true) {
        if (results.has(value.id)) return;
        results.set(value.id, value);
        active -= 1;
        if (results.size % 20 === 0 || results.size === problems.length) {
          process.stderr.write(`KataGo solved ${results.size}/${problems.length}\n`);
        }
        if (results.size === problems.length) {
          engine.stdin.end();
          resolve();
        } else {
          pump();
        }
      }
    });
    engine.once("error", reject);
    engine.once("exit", (code) => {
      if (results.size !== problems.length) reject(new Error(`KataGo exited with ${code}. ${stderr}`));
    });
  });
  pump();
  await complete;
  return results;
}

const source = await readFile(sourcePath, "utf8");
const problems = parseProblems(source);
if (problems.length !== limit) throw new Error(`Expected ${limit} problems, found ${problems.length}.`);
const results = await analyze(problems);
const catalog = problems.map((problem) => {
  const result = results.get(`gokyo-${problem.globalOrder}`);
  const candidates = rankedCandidates(result);
  const best = candidates[0];
  if (!best) throw new Error(`KataGo returned no move for problem ${problem.globalOrder}.`);
  const mainLine = moveLine(problem, best);
  if (mainLine.length < 1) throw new Error(`KataGo returned an empty line for problem ${problem.globalOrder}.`);
  const second = candidates[1];
  const rankKyu = estimatedRank(problem, best, second);
  return {
    id: `gokyo-shumyo-${String(problem.globalOrder).padStart(3, "0")}`,
    globalOrder: problem.globalOrder,
    category: problem.category,
    sectionOrder: problem.sectionOrder,
    toPlay: problem.toPlay,
    black: problem.black,
    white: problem.white,
    solution: mainLine[0],
    mainLine,
    refutations: candidates.slice(1, 5).map((candidate) => {
      const line = moveLine(problem, candidate);
      return { userMove: line[0], reply: line[1] ?? null };
    }).filter((entry) => entry.userMove),
    rankKyu,
    difficulty: rankKyu >= 24 ? "beginner" : rankKyu >= 18 ? "intermediate" : "advanced",
    analysis: {
      engine: `KataGo ${engineVersion}`,
      model: "b10c384h6nbttflrs",
      visits,
      bestPrior: Number(best.prior) || 0,
      scoreGap: second ? Number((Number(best.scoreLead) - Number(second.scoreLead)).toFixed(3)) : null,
    },
  };
});

await writeFile(outputPath, `${JSON.stringify({
  version: 1,
  source: {
    title: "Gokyo Shumyo",
    publicationYear: 1812,
    nijlBibliographicId: "100344678",
    nijlDoi: "10.20730/100344678",
    note: "Only public-domain board facts are retained; no scan images or modern solution text are included.",
  },
  analysis: { engine: `KataGo ${engineVersion}`, model: "b10c384h6nbttflrs", visits },
  puzzles: catalog,
}, null, 2)}\n`, "utf8");
process.stderr.write(`Wrote ${catalog.length} puzzles to ${outputPath}\n`);
