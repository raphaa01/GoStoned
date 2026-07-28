import { ApiRequestError } from "./api";

export type IdentityRequestToken = Readonly<{
  identityKey: string;
  generation: number;
}>;

export type IdentityRequestAuthority = Readonly<{
  capture: () => IdentityRequestToken;
  invalidate: () => void;
  isCurrent: (token: IdentityRequestToken) => boolean;
  updateIdentity: (identityKey: string) => boolean;
}>;

export function createIdentityRequestAuthority(
  initialIdentityKey: string,
): IdentityRequestAuthority {
  let identityKey = initialIdentityKey;
  let generation = 0;

  return {
    capture() {
      return { identityKey, generation };
    },
    invalidate() {
      generation += 1;
    },
    isCurrent(token) {
      return token.identityKey === identityKey && token.generation === generation;
    },
    updateIdentity(nextIdentityKey) {
      if (nextIdentityKey === identityKey) return false;
      identityKey = nextIdentityKey;
      generation += 1;
      return true;
    },
  };
}

export function assertResponseActor(actor: unknown, expectedPlayerKey: string): void {
  if (actor === expectedPlayerKey) return;
  throw new ApiRequestError("The player session changed.", {
    status: 409,
    code: "identity_changed",
  });
}
