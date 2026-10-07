export function allowsMobileBackGesture(pathname: string): boolean {
  return !/\/(?:game\/[^/]+|learn\/ai)\/?$/.test(pathname);
}
