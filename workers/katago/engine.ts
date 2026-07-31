import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { AnalysisInput, KataGoTurnResult } from "@/lib/analysis/types";

type PendingQuery = {
  expectedTurns: number;
  results: KataGoTurnResult[];
  resolve: (results: KataGoTurnResult[]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseTurn(value: Record<string, unknown>): KataGoTurnResult {
  const root = value.rootInfo as Record<string, unknown> | undefined;
  if (!root || (root.currentPlayer !== "B" && root.currentPlayer !== "W")) {
    throw new Error("KataGo returned an invalid root position.");
  }
  const infos = Array.isArray(value.moveInfos) ? value.moveInfos : [];
  return {
    turnNumber: finite(value.turnNumber, -1),
    rootInfo: {
      currentPlayer: root.currentPlayer,
      visits: finite(root.visits),
      winrate: finite(root.winrate, 0.5),
      scoreLead: finite(root.scoreLead),
    },
    moveInfos: infos.map((entry) => {
      const move = entry as Record<string, unknown>;
      return {
        move: typeof move.move === "string" ? move.move : "pass",
        order: finite(move.order, 999),
        visits: finite(move.visits),
        winrate: finite(move.winrate, 0.5),
        scoreLead: finite(move.scoreLead),
        prior: typeof move.prior === "number" ? move.prior : undefined,
        pv: Array.isArray(move.pv) ? move.pv.filter((item): item is string => typeof item === "string") : [],
      };
    }),
  };
}

export class KataGoEngine {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingQuery>();
  private stderrTail = "";
  private lastError: string | null = null;

  constructor(options: { binary: string; model: string; config: string }) {
    this.process = spawn(options.binary, [
      "analysis",
      "-model", options.model,
      "-config", options.config,
      "-quit-without-waiting",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    createInterface({ input: this.process.stdout }).on("line", (line) => this.handleLine(line));
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4_000);
    });
    this.process.once("error", (error) => {
      this.lastError = error.message;
      console.error("KataGo process error:", error.message);
      this.rejectAll(error);
    });
    this.process.once("exit", (code, signal) => {
      const error = new Error(`KataGo stopped unexpectedly (${code ?? signal ?? "unknown"}). ${this.stderrTail}`);
      this.lastError = error.message;
      console.error(error.message);
      this.rejectAll(error);
    });
  }

  private handleLine(line: string) {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = typeof value.id === "string" ? value.id : null;
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    if (typeof value.error === "string") {
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.reject(new Error(`KataGo rejected the analysis: ${value.error}`));
      return;
    }
    if (value.isDuringSearch === true) return;
    try {
      pending.results.push(parseTurn(value));
    } catch (error) {
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.reject(error instanceof Error ? error : new Error("KataGo response could not be parsed."));
      return;
    }
    if (pending.results.length >= pending.expectedTurns) {
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.resolve(pending.results.sort((left, right) => left.turnNumber - right.turnNumber));
    }
  }

  private rejectAll(error: Error) {
    for (const query of this.pending.values()) {
      clearTimeout(query.timeout);
      query.reject(error);
    }
    this.pending.clear();
  }

  analyze(id: string, input: AnalysisInput, maxVisits: number): Promise<KataGoTurnResult[]> {
    if (this.process.exitCode !== null || !this.process.stdin.writable) {
      return Promise.reject(new Error("KataGo is not running."));
    }
    const analyzeTurns = Array.from({ length: input.moves.length + 1 }, (_, index) => index);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("KataGo analysis timed out."));
      }, Math.max(120_000, input.moves.length * 20_000));
      this.pending.set(id, { expectedTurns: analyzeTurns.length, results: [], resolve, reject, timeout });
      this.process.stdin.write(`${JSON.stringify({
        id,
        moves: input.moves.map((move) => [move.color === "black" ? "B" : "W", move.move]),
        rules: input.rules,
        komi: input.komi,
        boardXSize: input.boardSize,
        boardYSize: input.boardSize,
        analyzeTurns,
        maxVisits,
        analysisPVLen: 12,
        includePolicy: true,
      })}\n`);
    });
  }

  close() {
    this.process.stdin.end();
  }

  get running() {
    return this.process.exitCode === null && !this.process.killed;
  }

  get error() {
    return this.lastError;
  }
}
