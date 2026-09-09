import type { Stone } from "@/lib/game/types";
import { GOSTONE_BOT_MODEL } from "./modelV1";

export type SettlementGroupStatus = "alive" | "dead" | "uncertain";

function boundedProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export function ownershipSurvivalProbability(
  color: Stone,
  ownership: number,
): number {
  const boundedOwnership = Math.max(-1, Math.min(1, Number.isFinite(ownership) ? ownership : 0));
  return color === "black"
    ? (1 - boundedOwnership) / 2
    : (1 + boundedOwnership) / 2;
}

export function classifySettlementGroup(input: {
  modelSurvival: number;
  ownershipSurvival: number;
  libertyCount: number;
  enclosedEyeCount: number;
}): Readonly<{ status: SettlementGroupStatus; survival: number }> {
  const modelSurvival = boundedProbability(input.modelSurvival);
  const ownershipSurvival = boundedProbability(input.ownershipSurvival);
  const survival = (
    modelSurvival * GOSTONE_BOT_MODEL.settlement.modelSurvivalWeight
    + ownershipSurvival * GOSTONE_BOT_MODEL.settlement.ownershipSurvivalWeight
  );

  if (input.enclosedEyeCount >= 2) return { status: "alive", survival };

  const tacticallyEndangered = input.libertyCount <= GOSTONE_BOT_MODEL.settlement.tacticalLibertyLimit
    && ownershipSurvival <= GOSTONE_BOT_MODEL.settlement.tacticalOwnershipSurvivalThreshold
    && modelSurvival <= GOSTONE_BOT_MODEL.settlement.tacticalModelSurvivalCeiling;
  if (survival <= GOSTONE_BOT_MODEL.settlement.deadThreshold || tacticallyEndangered) {
    return { status: "dead", survival };
  }
  if (survival >= GOSTONE_BOT_MODEL.settlement.aliveThreshold) {
    return { status: "alive", survival };
  }
  return { status: "uncertain", survival };
}
