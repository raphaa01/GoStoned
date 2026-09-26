/// <reference lib="webworker" />

import * as ort from "onnxruntime-web/wasm";
import {
  applyMove,
  boardHash,
  getGroup,
  getNeighbors,
  replayMovesWithPrisoners,
} from "@/lib/game/goEngine";
import { buildLegacyV4Features, buildV8Features } from "@/lib/bot/v8Features";
import { scoreJapaneseTerritory } from "@/lib/game/japaneseScoring";
import type { Board, Position, Stone } from "@/lib/game/types";
import {
  classifySettlementGroup,
  ownershipSurvivalProbability,
  statusRequiresPlayerAgreement,
} from "@/lib/bot/settlementClassification";
import {
  GOSTONE_BOT_MODEL,
  goStoneBotModelForIdentity,
  type GoStoneBotRuntimeModel,
  type GoStoneBotMove,
  type GoStoneBotPosition,
  type GoStoneBotWorkerRequest,
  type GoStoneBotWorkerResponse,
  type GoStoneJapaneseSettlementProposal,
  type GoStoneSettlementGroup,
} from "@/lib/bot/modelV1";

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const sessionPromises = new Map<string, Promise<ort.InferenceSession>>();

function inferenceSession(model: GoStoneBotRuntimeModel): Promise<ort.InferenceSession> {
  const existing = sessionPromises.get(model.artifactSha256);
  if (existing) return existing;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = GOSTONE_BOT_MODEL.runtimeBaseUrl;
  const created = ort.InferenceSession.create(model.artifactUrl, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  sessionPromises.set(model.artifactSha256, created);
  return created;
}

function boardOffset(size: number): number {
  return (GOSTONE_BOT_MODEL.maximumBoardSize - size) / 2;
}

function positionKey({ x, y }: Position): string {
  return `${x}:${y}`;
}

async function runModel(position: GoStoneBotPosition) {
  const model = goStoneBotModelForIdentity(position.modelVersion, position.modelSha256);
  const session = await inferenceSession(model);
  const features = model.modelVersion === "v8"
    ? buildV8Features(position)
    : buildLegacyV4Features(position);
  const outputs = await session.run({
    [model.inputName]: new ort.Tensor(
      "float32",
      features,
      [1, model.inputPlanes, 19, 19],
    ),
  });
  return { model, outputs };
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

function chooseMove(
  position: GoStoneBotPosition,
  policy: Float32Array,
  modelVersion: string,
): GoStoneBotMove {
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
  let cursor = deterministicUnit(
    `${position.gameId}:${position.gameVersion}:${modelVersion}`,
  ) * total;
  for (let index = 0; index < pool.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return pool[index].move;
  }
  return pool.at(-1)!.move;
}

function numericOutput(
  outputs: ort.InferenceSession.OnnxValueMapType,
  name: string,
  modelVersion: string,
): Float32Array {
  const value = outputs[name];
  if (!value || !(value.data instanceof Float32Array)) {
    throw new Error(`The GoStone ${modelVersion} model output ${name} is missing.`);
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

function activeClassValue(
  values: Float32Array,
  classIndex: number,
  size: number,
  point: Position,
): number {
  return values[classIndex * 361 + (point.y + boardOffset(size)) * 19 + point.x + boardOffset(size)];
}

function groupShape(
  board: Board,
  stones: readonly Position[],
  emptyRegions: ReturnType<typeof territoryOwners>["regions"],
): Readonly<{ libertyCount: number; enclosedEyeCount: number }> {
  const groupKeys = new Set(stones.map(positionKey));
  const liberties = new Set<string>();
  for (const stone of stones) {
    for (const neighbor of getNeighbors(board, stone)) {
      if (board[neighbor.y][neighbor.x] === null) liberties.add(positionKey(neighbor));
    }
  }

  const enclosedEyeCount = emptyRegions.filter((region) => {
    let touchesGroup = false;
    for (const point of region.points) {
      for (const neighbor of getNeighbors(board, point)) {
        if (board[neighbor.y][neighbor.x] === null) continue;
        const neighborKey = positionKey(neighbor);
        if (!groupKeys.has(neighborKey)) return false;
        touchesGroup = true;
      }
    }
    return touchesGroup;
  }).length;
  return { libertyCount: liberties.size, enclosedEyeCount };
}

function settlementProposal(
  position: Omit<GoStoneBotPosition, "toMove" | "excludedMoves">,
  ownership: Float32Array,
  survival: Float32Array,
  statusLogits: Float32Array | null,
  model: GoStoneBotRuntimeModel,
): GoStoneJapaneseSettlementProposal {
  const boardGroups = groups(position.board);
  const candidateDead = new Set<string>();
  const uncertain = new Set<string>();
  const emptyRegions = territoryOwners(position.board).regions;
  const classifiedGroups: GoStoneSettlementGroup[] = boardGroups.map((group) => {
    const modelSurvival = group.stones.reduce(
      (sum, stone) => sum + sigmoid(activeValue(survival, position.boardSize, stone)),
      0,
    ) / group.stones.length;
    const ownershipSurvival = group.stones.reduce(
      (sum, stone) => sum + ownershipSurvivalProbability(
        group.color,
        activeValue(ownership, position.boardSize, stone),
      ),
      0,
    ) / group.stones.length;
    const classified = classifySettlementGroup({
      modelSurvival,
      ownershipSurvival,
      ...groupShape(position.board, group.stones, emptyRegions),
    });
    const averagedStatusLogit = (classIndex: number) => statusLogits
      ? group.stones.reduce(
          (sum, stone) => sum + activeClassValue(statusLogits, classIndex, position.boardSize, stone),
          0,
        ) / group.stones.length
      : Number.NEGATIVE_INFINITY;
    const requiresAgreement = statusLogits !== null && statusRequiresPlayerAgreement({
      alive: averagedStatusLogit(0),
      dead: averagedStatusLogit(1),
      seki: averagedStatusLogit(2),
      unsettled: averagedStatusLogit(3),
    });
    const status = requiresAgreement ? "uncertain" as const : classified.status;
    if (status === "dead") group.stones.forEach((stone) => candidateDead.add(positionKey(stone)));
    if (status === "uncertain") group.stones.forEach((stone) => uncertain.add(positionKey(stone)));
    return { ...group, status, survival: classified.survival };
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

  const proposedGroups = classifiedGroups.map((group) => {
    if (
      group.status !== "dead"
      || group.stones.every((stone) => candidateDead.has(positionKey(stone)))
    ) {
      return group;
    }
    return { ...group, status: "uncertain" as const };
  });
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
  if (uncertain.size === 0) {
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
  }

  return {
    contractVersion: "gostone-japanese-settlement-v1",
    modelVersion: model.modelVersion,
    modelSha256: model.artifactSha256,
    authority: "proposal-only",
    boardSize: position.boardSize,
    stoppedMoveNumber: position.moves.length,
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
    const lastColor = request.position.moves.at(-1)?.color;
    const modelPosition: GoStoneBotPosition = request.kind === "move"
      ? request.position
      : { ...request.position, toMove: lastColor === "black" ? "white" : "black" };
    const { model, outputs } = await runModel(modelPosition);
    if (request.kind === "move") {
      return {
        id: request.id,
        ok: true,
        kind: "move",
        move: chooseMove(
          request.position,
          numericOutput(outputs, model.outputs.policy, model.modelVersion),
          model.modelVersion,
        ),
        modelVersion: model.modelVersion,
      };
    }
    return {
      id: request.id,
      ok: true,
      kind: "settlement",
      proposal: settlementProposal(
        request.position,
        numericOutput(outputs, model.outputs.ownership, model.modelVersion),
        numericOutput(outputs, model.outputs.survival, model.modelVersion),
        model.outputs.status
          ? numericOutput(outputs, model.outputs.status, model.modelVersion)
          : null,
        model,
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
