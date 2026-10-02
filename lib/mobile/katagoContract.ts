import type { AnalysisInput, GameAnalysisResult, KataGoTurnResult } from "@/lib/analysis/types";

export const MOBILE_KATAGO = Object.freeze({
  contractVersion: "gostone-mobile-katago-v1" as const,
  engineVersion: "v1.18.2" as const,
  modelName: "b10c384h6nbttflrs" as const,
  // The payload remains the original gzip stream. A neutral extension prevents
  // Android's asset packager from transparently expanding and renaming it.
  modelFile: "katago/b10c384h6nbttflrs.katago" as const,
  modelBytes: 38_245_488,
  modelSha256: "0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229" as const,
  defaultVisitsPerTurn: 20,
  previewVisits: 2,
  maximumVisitsPerTurn: 80,
});

export type MobileKataGoThermalState = "nominal" | "fair" | "serious" | "critical";

export type MobileKataGoProgress = Readonly<{
  analysisId: string;
  phase: "preview" | "quality";
  completedTurns: number;
  totalTurns: number;
  visitsPerTurn: number;
  thermalState: MobileKataGoThermalState;
  turn?: KataGoTurnResult;
}>;

export type MobileKataGoStartOptions = Readonly<{
  analysisId: string;
  input: AnalysisInput;
  visitsPerTurn?: number;
}>;

export interface MobileKataGoEngine {
  isAvailable(): Promise<boolean>;
  start(options: MobileKataGoStartOptions): Promise<GameAnalysisResult>;
  cancel(analysisId: string): Promise<void>;
  addProgressListener(listener: (progress: MobileKataGoProgress) => void): Promise<() => void>;
}
