export type OperationToken = symbol;

export type OperationLatch = {
  acquire: () => OperationToken | null;
  invalidate: () => void;
  release: (token: OperationToken) => boolean;
};

export function createOperationLatch(): OperationLatch {
  let activeToken: OperationToken | null = null;

  return {
    acquire() {
      if (activeToken !== null) return null;
      activeToken = Symbol("operation");
      return activeToken;
    },
    invalidate() {
      activeToken = null;
    },
    release(token) {
      if (activeToken !== token) return false;
      activeToken = null;
      return true;
    },
  };
}
