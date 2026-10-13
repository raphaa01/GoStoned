export function allowsMobileBackGesture(pathname: string): boolean {
  return !/\/(?:game\/[^/]+|learn\/ai|play\/(?:coach|local|clock))\/?$/.test(pathname);
}
