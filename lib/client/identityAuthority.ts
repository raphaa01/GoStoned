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
