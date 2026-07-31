import {
  KataGoScoringClient,
  type KataGoScoringClientOptions,
} from "./client";
import {
  KATAGO_CONFIDENCE_POLICY_VERSION,
  KATAGO_SCORING_CONTRACT_VERSION,
  type KataGoEngineIdentity,
  type KataGoProviderKind,
  type KataGoScoringProvider,
} from "./contracts";
import { DeterministicKataGoScoringProvider } from "./deterministicProvider";
import { kataGoError } from "./errors";
import {
  hostedKataGoProviderFromEnvironment,
  localKataGoProviderFromEnvironment,
} from "./httpProvider";

export const DEFAULT_KATAGO_SCORING_VISITS = 32;

export type KataGoScoringRuntime = Readonly<{
  client: KataGoScoringClient;
  providerKind: KataGoProviderKind;
  engine: KataGoEngineIdentity;
  maxVisits: number;
  contractVersion: typeof KATAGO_SCORING_CONTRACT_VERSION;
  confidencePolicyVersion: typeof KATAGO_CONFIDENCE_POLICY_VERSION;
}>;

function requiredVersion(
  environment: Readonly<Record<string, string | undefined>>,
  name: "KATAGO_ENGINE_VERSION" | "KATAGO_MODEL_VERSION" | "KATAGO_CONFIG_VERSION",
): string {
  const value = environment[name];
  if (!value) {
    throw kataGoError("provider_not_configured", `${name} is required for KataGo scoring.`);
  }
  return value;
}

function visits(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_KATAGO_SCORING_VISITS;
  if (!/^[1-9]\d*$/.test(value)) {
    throw kataGoError("provider_not_configured", "KATAGO_MAX_VISITS must be a whole number.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw kataGoError("provider_not_configured", "KATAGO_MAX_VISITS is outside its supported bound.");
  }
  return parsed;
}

export function createKataGoScoringRuntime(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: Readonly<{
    deterministicProvider?: KataGoScoringProvider;
    clientOptions?: Omit<KataGoScoringClientOptions, "provider">;
  }> = {},
): KataGoScoringRuntime {
  const providerName = environment.KATAGO_SCORING_PROVIDER;
  let provider: KataGoScoringProvider;
  if (providerName === "hosted-http") {
    provider = hostedKataGoProviderFromEnvironment(environment);
  } else if (providerName === "local-http") {
    provider = localKataGoProviderFromEnvironment(environment);
  } else if (providerName === "deterministic" && options.deterministicProvider) {
    provider = options.deterministicProvider;
  } else if (providerName === "deterministic" && environment.NODE_ENV === "test") {
    provider = new DeterministicKataGoScoringProvider();
  } else {
    throw kataGoError(
      "provider_not_configured",
      "KATAGO_SCORING_PROVIDER must select a configured hosted or local adapter.",
    );
  }

  const engine = Object.freeze({
    engineVersion: requiredVersion(environment, "KATAGO_ENGINE_VERSION"),
    modelVersion: requiredVersion(environment, "KATAGO_MODEL_VERSION"),
    configVersion: requiredVersion(environment, "KATAGO_CONFIG_VERSION"),
  });
  return Object.freeze({
    client: new KataGoScoringClient({ provider, ...options.clientOptions }),
    providerKind: provider.kind,
    engine,
    maxVisits: visits(environment.KATAGO_MAX_VISITS),
    contractVersion: KATAGO_SCORING_CONTRACT_VERSION,
    confidencePolicyVersion: KATAGO_CONFIDENCE_POLICY_VERSION,
  });
}

let singleton: KataGoScoringRuntime | null = null;

export function configuredKataGoScoringRuntime(): KataGoScoringRuntime {
  singleton ??= createKataGoScoringRuntime();
  return singleton;
}

export function resetKataGoScoringRuntimeForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("The KataGo runtime can be reset only in tests.");
  }
  singleton = null;
}
