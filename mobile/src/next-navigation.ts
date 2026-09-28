import { useMemo, useSyncExternalStore } from "react";

const NAVIGATION_EVENT = "gostone:navigation";

function notifyNavigation() {
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATION_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATION_EVENT, listener);
  };
}

function currentLocation() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function serverLocation() {
  return "/";
}

function navigate(href: string, replace: boolean) {
  const destination = new URL(href, window.location.href);
  if (destination.origin !== window.location.origin) {
    window.location.assign(destination.href);
    return;
  }
  window.history[replace ? "replaceState" : "pushState"]({}, "", destination.href);
  notifyNavigation();
  window.scrollTo({ left: 0, top: 0, behavior: "instant" });
}

export function usePathname() {
  const location = useSyncExternalStore(subscribe, currentLocation, serverLocation);
  return new URL(location, window.location.origin).pathname;
}

export function useSearchParams() {
  const location = useSyncExternalStore(subscribe, currentLocation, serverLocation);
  return useMemo(
    () => new URLSearchParams(new URL(location, window.location.origin).search),
    [location],
  );
}

export function useRouter() {
  return useMemo(() => ({
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    prefetch: async () => undefined,
    push: (href: string) => navigate(href, false),
    refresh: notifyNavigation,
    replace: (href: string) => navigate(href, true),
  }), []);
}

export function redirect(href: string): never {
  navigate(href, true);
  throw new Error(`Redirected to ${href}`);
}
