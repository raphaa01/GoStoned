/// <reference lib="webworker" />

import * as ort from "onnxruntime-web/wasm";
import { applyMove, boardHash, getGroup, replayMovesWithPrisoners } from "@/lib/game/goEngine";
import { scoreJapaneseTerritory } from "@/lib/game/japaneseScoring";
import type { Board, Position, Stone } from "@/lib/game/types";
import {
  botStrengthForRating,
  GOSTONE_BOT_MODEL,
  type GoStoneBotMove,
  type GoStoneBotPosition,
  type GoStoneBotWorkerRequest,
  type GoStoneBotWorkerResponse,
  type GoStoneJapaneseSettlementProposal,
  type GoStoneSettlementPosition,
  type GoStoneSettlementGroup,
} from "@/lib/bot/modelV1";

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
let sessionPromise: Promise<ort.InferenceSession> | null = null;

function inferenceSession(): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = GOSTONE_BOT_MODEL.runtimeBaseUrl;
  sessionPromise = ort.InferenceSession.create(GOSTONE_BOT_MODEL.artifactUrl, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  return sessionPromise;
}

function boardOffset(size: number): number {
  return (GOSTONE_BOT_MODEL.maximumBoardSize - size) / 2;
}

function positionKey({ x, y }: Position): string {
  return `${x}:${y}`;
}

function buildFeatures(position: GoStoneBotPosition): Float32Array {
  const size = position.boardSize;
  const area = GOSTONE_BOT_MODEL.maximumBoardSize ** 2;
  const features = new Float32Array(GOSTONE_BOT_MODEL.inputPlanes * area);
  const offset = boardOffset(size);
  const replay = replayMovesWithPrisoners(size, [...position.moves]);
  const lastMove = position.moves.at(-1);
  const consecutivePasses = lastMove?.isPass
    ? position.moves.at(-2)?.isPass ? 2 : 1
    : 0;
  const strength = botStrengthForRating(position.targetRating);
  const boardArea = size * size;

  const set = (plane: number, x: number, y: number, value: number) => {
    const padded = (y + offset) * GOSTONE_BOT_MODEL.maximumBoardSize + x + offset;
    features[plane * area + padded] = value;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const stone = position.board[y][x];
      set(0, x, y, stone === "black" ? 1 : 0);
      set(1, x, y, stone === "white" ? 1 : 0);
      set(2, x, y, position.toMove === "black" ? 1 : 0);
      set(3, x, y, position.toMove === "white" ? 1 : 0);
      set(4, x, y, 1);
      set(5, x, y, Math.max(-1, Math.min(1, position.komi / 20)));
      set(6, x, y, Math.min(1, position.moves.length / boardArea));
      set(7, x, y, strength);
      set(8, x, y, Math.min(1, replay.prisoners.capturedWhiteByBlack / boardArea));
      set(9, x, y, Math.min(1, replay.prisoners.capturedBlackByWhite / boardArea));
      set(10, x, y, Math.min(1, consecutivePasses / 2));
    }
  }
  if (lastMove && !lastMove.isPass && lastMove.x !== null && lastMove.y !== null) {
    set(11, lastMove.x, lastMove.y, 1);
  }
  return features;
}

async function runModel(position: GoStoneBotPosition) {
  const session = await inferenceSession();
  const features = buildFeatures(position);
  return session.run({
    [GOSTONE_BOT_MODEL.inputName]: new ort.Tensor(
      "float32",
      features,
      [1, GOSTONE_BOT_MODEL.inputPlanes, 19, 19],
    ),
  });
}

function deterministicUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function policyPoint(index: number, size: number): Position | null {
  if (index === GOSTONE_BOT_MODEL.passIndex) return null;
  const paddedY = Math.floor(index / 19);
  const paddedX = index % 19;
  const offset = boardOffset(size);
  const x = paddedX - offset;
  const y = paddedY - offset;
  return x >= 0 && y >= 0 && x < size && y < size ? { x, y } : null;
}

function chooseMove(position: GoStoneBotPosition, policy: Float32Array): GoStoneBotMove {
  const replay = replayMovesWithPrisoners(position.boardSize, [...position.moves]);
  const priorHashes = new Set(replay.positionHistory);
  const excluded = new Set((position.excludedMoves ?? []).map(positionKey));
  const lastMove = position.moves.at(-1);
  const candidates: Array<{ move: GoStoneBotMove; logit: number }> = [];

  for (let index = 0; index < policy.length; index += 1) {
    if (index === GOSTONE_BOT_MODEL.passIndex) {
      const early = position.moves.length < position.boardSize * position.boardSize * 0.28;
      if (!early || lastMove?.isPass) {
        candidates.push({
          move: { kind: "pass" },
          logit: policy[index] + (lastMove?.isPass ? 1.5 : 0),
        });
      }
      continue;
    }
    const point = policyPoint(index, position.boardSize);
    if (!point || excluded.has(positionKey(point))) continue;
    const applied = applyMove(position.board, position.toMove, point.x, point.y);
    if (!applied.ok || priorHashes.has(boardHash(applied.board))) continue;
    candidates.push({ move: { kind: "play", ...point }, logit: policy[index] });
  }
  if (candidates.length === 0) return { kind: "pass" };
  candidates.sort((left, right) => right.logit - left.logit);

  const rating = Math.max(600, Math.min(2_100, position.targetRating));
  const candidateLimit = rating >= 2_000 ? 1 : rating >= 1_700 ? 2
    : rating >= 1_400 ? 3 : rating >= 1_100 ? 5 : rating >= 800 ? 7 : 10;
  const temperature = rating >= 2_000 ? 0.08 : Math.max(0.2, 1.65 - (rating - 600) / 1_050);
  const pool = candidates.slice(0, candidateLimit);
  if (pool.length === 1) return pool[0].move;
  const maximum = pool[0].logit;
  const weights = pool.map(({ logit }) => Math.exp((logit - maximum) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = deterministicUnit(`${position.gameId}:${position.gameVersion}:v1`) * total;
  for (let index = 0; index < pool.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return pool[index].move;
  }
  return pool.at(-1)!.move;
}

function numericOutput(
  outputs: ort.InferenceSession.OnnxValueMapType,
  name: string,
): Float32Array {
  const value = outputs[name];
  if (!value || !(value.data instanceof Float32Array)) {
    throw new Error(`The GoStone v1 model output ${name} is missing.`);
  }
  return value.data;
}

function groups(board: Board): Array<{ color: Stone; stones: Position[] }> {
  const visited = new Set<string>();
  const result: Array<{ color: Stone; stones: Position[] }> = [];
  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board.length; x += 1) {
      const color = board[y][x];
      if (!color || visited.has(`${x}:${y}`)) continue;
      const stones = getGroup(board, { x, y });
      stones.forEach((stone) => visited.add(positionKey(stone)));
      result.push({ color, stones });
    }
  }
  return result;
}

function territoryOwners(board: Board): {
  owners: Map<string, Stone | null>;
  regions: Array<{ points: Position[]; owner: Stone | null }>;
} {
  const owners = new Map<string, Stone | null>();
  const regions: Array<{ points: Position[]; owner: Stone | null }> = [];
  const visited = new Set<string>();
  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board.length; x += 1) {
      if (board[y][x] || visited.has(`${x}:${y}`)) continue;
      const points: Position[] = [];
      const borders = new Set<Stone>();
      const stack: Position[] = [{ x, y }];
      while (stack.length > 0) {
        const point = stack.pop()!;
        const key = positionKey(point);
        if (visited.has(key)) continue;
        visited.add(key);
        points.push(point);
        const neighbors = [
          { x: point.x - 1, y: point.y }, { x: point.x + 1, y: point.y },
          { x: point.x, y: point.y - 1 }, { x: point.x, y: point.y + 1 },
        ].filter(({ x: nx, y: ny }) => nx >= 0 && ny >= 0 && nx < board.length && ny < board.length);
        for (const neighbor of neighbors) {
          const stone = board[neighbor.y][neighbor.x];
          if (stone) borders.add(stone);
          else if (!visited.has(positionKey(neighbor))) stack.push(neighbor);
        }
      }
      const owner = borders.size === 1 ? [...borders][0] : null;
      points.forEach((point) => owners.set(positionKey(point), owner));
      regions.push({ points, owner });
    }
  }
  return { owners, regions };
}

function activeValue(values: Float32Array, size: number, point: Position): number {
  const offset = boardOffset(size);
  return values[(point.y + offset) * 19 + point.x + offset];
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

function settlementProposal(
  position: GoStoneSettlementPosition,
  ownership: Float32Array,
  survival: Float32Array,
): GoStoneJapaneseSettlementProposal {
  const boardGroups = groups(position.board);
  const candidateDead = new Set<string>();
  const uncertain = new Set<string>();
  const proposedGroups: GoStoneSettlementGroup[] = boardGroups.map((group) => {
    const probability = group.stones.reduce(
      (sum, stone) => sum + sigmoid(activeValue(survival, position.boardSize, stone)),
      0,
    ) / group.stones.length;
    const status = probability <= GOSTONE_BOT_MODEL.settlement.deadThreshold ? "dead"
      : probability >= GOSTONE_BOT_MODEL.settlement.aliveThreshold ? "alive" : "uncertain";
    if (status === "dead") group.stones.forEach((stone) => candidateDead.add(positionKey(stone)));
    if (status === "uncertain") group.stones.forEach((stone) => uncertain.add(positionKey(stone)));
    return { ...group, status, survival: probability };
  });

  let changed = true;
  while (changed && candidateDead.size > 0) {
    changed = false;
    const scored = position.board.map((row, y) => row.map((stone, x) =>
      candidateDead.has(`${x}:${y}`) ? null : stone));
    const { owners } = territoryOwners(scored);
    for (const group of boardGroups) {
      if (!group.stones.every((stone) => candidateDead.has(positionKey(stone)))) continue;
      const opponent: Stone = group.color === "black" ? "white" : "black";
      if (group.stones.some((stone) => owners.get(positionKey(stone)) !== opponent)) {
        group.stones.forEach((stone) => {
          candidateDead.delete(positionKey(stone));
          uncertain.add(positionKey(stone));
        });
        changed = true;
      }
    }
  }

  const deadStones = boardGroups.flatMap((group) =>
    group.stones.filter((stone) => candidateDead.has(positionKey(stone))));
  const scored = position.board.map((row, y) => row.map((stone, x) =>
    candidateDead.has(`${x}:${y}`) ? null : stone));
  const neutralRegionSeeds = territoryOwners(scored).regions
    .filter((region) => region.owner !== null && region.points.reduce(
      (sum, point) => sum + Math.abs(activeValue(ownership, position.boardSize, point)),
      0,
    ) / region.points.length < GOSTONE_BOT_MODEL.settlement.neutralOwnershipThreshold)
    .map((region) => region.points[0]);
  const prisoners = replayMovesWithPrisoners(position.boardSize, [...position.moves]).prisoners;
  let score: ReturnType<typeof scoreJapaneseTerritory> | null = null;
  try {
    score = scoreJapaneseTerritory({
      board: position.board,
      prisoners,
      deadStones,
      agreedNeutralRegionSeeds: neutralRegionSeeds,
      komi: position.komi,
    });
  } catch {
    // Ambiguous life/death stays a proposal. The server and both players remain authoritative.
  }

  return {
    contractVersion: "gostone-japanese-settlement-v1",
    modelVersion: GOSTONE_BOT_MODEL.modelVersion,
    modelSha256: GOSTONE_BOT_MODEL.artifactSha256,
    authority: "proposal-only",
    boardSize: position.boardSize,
    gameId: position.gameId,
    stoppedBoardHash: position.stoppedBoardHash,
    stoppedMoveNumber: position.moves.length,
    scoringRevision: position.scoringRevision,
    groups: proposedGroups.map((group) => ({
      ...group,
      status: group.stones.some((stone) => uncertain.has(positionKey(stone)))
        ? "uncertain" : group.status,
    })),
    deadStones,
    uncertainStones: boardGroups.flatMap((group) =>
      group.stones.filter((stone) => uncertain.has(positionKey(stone)))),
    neutralRegionSeeds,
    score,
  };
}

async function handleRequest(request: GoStoneBotWorkerRequest): Promise<GoStoneBotWorkerResponse> {
  try {
    const modelPosition: GoStoneBotPosition = request.kind === "move"
      ? request.position
      : { ...request.position, toMove: "black" };
    const outputs = await runModel(modelPosition);
    if (request.kind === "move") {
      return {
        id: request.id,
        ok: true,
        kind: "move",
        move: chooseMove(
          request.position,
          numericOutput(outputs, GOSTONE_BOT_MODEL.outputs.policy),
        ),
        modelVersion: GOSTONE_BOT_MODEL.modelVersion,
      };
    }
    return {
      id: request.id,
      ok: true,
      kind: "settlement",
      proposal: settlementProposal(
        request.position,
        numericOutput(outputs, GOSTONE_BOT_MODEL.outputs.ownership),
        numericOutput(outputs, GOSTONE_BOT_MODEL.outputs.survival),
      ),
    };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "The local GoStone bot failed.",
    };
  }
}

workerScope.addEventListener("message", (event: MessageEvent<GoStoneBotWorkerRequest>) => {
  void handleRequest(event.data).then((response) => workerScope.postMessage(response));
});
