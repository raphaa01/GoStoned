export function requestTimeout(milliseconds: number, parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(milliseconds);
  if (!parent) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([parent, timeout]);
  if (parent.aborted) return parent;

  // iOS 16 WebKit supports timeout() and abort reasons.
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    parent.removeEventListener("abort", onParent);
    timeout.removeEventListener("abort", onTimeout);
    controller.abort(signal.reason);
  };
  const onParent = () => abort(parent);
  const onTimeout = () => abort(timeout);
  parent.addEventListener("abort", onParent, { once: true });
  timeout.addEventListener("abort", onTimeout, { once: true });
  return controller.signal;
}
