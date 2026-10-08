export function allowsMobileBackGesture(pathname: string): boolean {
  return !/\/(?:game\/[^/]+|learn\/ai|play\/coach)\/?$/.test(pathname);
}
