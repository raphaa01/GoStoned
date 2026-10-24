export function allowsMobileBackGesture(pathname: string): boolean {
  return !/\/(?:game\/[^/]+|learn\/ai|play\/(?:coach|local|clock))\/?$/.test(pathname);
}

// Standard URL.origin is opaque ("null") for Capacitor's iOS asset scheme.
// Compare scheme and host so local navigation keeps its in-memory app state.
export function isSameMobileOrigin(destination: URL, current: URL): boolean {
  return destination.protocol === current.protocol && destination.host === current.host;
}
