import { buildGameAnalysis, buildProgressiveGameAnalysis } from "./evaluate";
import type { AnalysisInput, GameAnalysisResult, KataGoTurnResult } from "./types";

export type ProgressiveAnalysisProgress = Readonly<{
  phase: "preview" | "quality";
  completedMoves: number;
  refinedMoves: number;
  totalMoves: number;
}>;

type ProgressiveAnalysisOptions = Readonly<{
  input: AnalysisInput;
  engineVersion: string;
  modelName: string;
  previewVisits: number;
  qualityVisits: number;
  chunkMoves: number;
  analyzedAt?: string;
  analyzePositions: (
    turnNumbers: readonly number[],
    visits: number,
    phase: ProgressiveAnalysisProgress["phase"],
  ) => Promise<KataGoTurnResult[]>;
  publish: (
    result: GameAnalysisResult,
    progress: ProgressiveAnalysisProgress,
  ) => Promise<void>;
}>;

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function turnChunks(totalMoves: number, chunkMoves: number): number[][] {
  const chunks: number[][] = [];
  for (let start = 0; start <= totalMoves; start += chunkMoves) {
    const firstTurn = start === 0 ? 0 : start + 1;
    const lastTurn = Math.min(totalMoves, start + chunkMoves);
    if (firstTurn > lastTurn) break;
    chunks.push(Array.from(
      { length: lastTurn - firstTurn + 1 },
      (_, index) => firstTurn + index,
    ));
  }
  return chunks;
}

export async function analyzeGameProgressively(
  options: ProgressiveAnalysisOptions,
): Promise<GameAnalysisResult> {
  const previewVisits = positiveInteger(options.previewVisits, "previewVisits");
  const qualityVisits = positiveInteger(options.qualityVisits, "qualityVisits");
  const chunkMoves = positiveInteger(options.chunkMoves, "chunkMoves");
  const analyzedAt = options.analyzedAt ?? new Date().toISOString();
  const turns = new Map<number, KataGoTurnResult>();
  const chunks = turnChunks(options.input.moves.length, chunkMoves);

  for (const chunk of chunks) {
    const results = await options.analyzePositions(chunk, previewVisits, "preview");
    for (const turn of results) turns.set(turn.turnNumber, turn);
    const result = buildProgressiveGameAnalysis(
      options.input,
      [...turns.values()],
      {
        version: options.engineVersion,
        model: options.modelName,
        visitsPerTurn: previewVisits,
      },
      analyzedAt,
    );
    if (!result) continue;
    await options.publish(result, {
      phase: "preview",
      completedMoves: result.moves.length,
      refinedMoves: 0,
      totalMoves: options.input.moves.length,
    });
  }

  for (const chunk of chunks) {
    const results = await options.analyzePositions(chunk, qualityVisits, "quality");
    for (const turn of results) turns.set(turn.turnNumber, turn);
    const result = buildProgressiveGameAnalysis(
      options.input,
      [...turns.values()],
      {
        version: options.engineVersion,
        model: options.modelName,
        visitsPerTurn: qualityVisits,
      },
      analyzedAt,
    );
    if (!result) continue;
    await options.publish(result, {
      phase: "quality",
      completedMoves: result.moves.length,
      refinedMoves: Math.min(
        options.input.moves.length,
        chunk[chunk.length - 1] ?? 0,
      ),
      totalMoves: options.input.moves.length,
    });
  }

  return buildGameAnalysis(
    options.input,
    [...turns.values()],
    {
      version: options.engineVersion,
      model: options.modelName,
      visitsPerTurn: qualityVisits,
    },
    analyzedAt,
  );
}
