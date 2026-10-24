import { useEffect, useMemo, useSyncExternalStore } from "react";
import { isSameMobileOrigin } from "@/lib/mobile/navigationPolicy";

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
  const current = new URL(window.location.href);
  const destination = new URL(href, current);
  if (!isSameMobileOrigin(destination, current)) {
    window.location.assign(destination.href);
    return;
  }
  window.history[replace ? "replaceState" : "pushState"]({}, "", destination.href);
  notifyNavigation();
  window.scrollTo({ left: 0, top: 0, behavior: "instant" });
}

export function usePathname() {
  const location = useSyncExternalStore(subscribe, currentLocation, serverLocation);
  return new URL(location, window.location.href).pathname;
}

export function useSearchParams() {
  const location = useSyncExternalStore(subscribe, currentLocation, serverLocation);
  return useMemo(
    () => new URLSearchParams(new URL(location, window.location.href).search),
    [location],
  );
}

// Hash targets can appear after an account check or asynchronous route data.
export function useHashScroll() {
  const location = useSyncExternalStore(subscribe, currentLocation, serverLocation);
  useEffect(() => {
    const hash = new URL(location, window.location.href).hash.slice(1);
    if (!hash) return;
    let id: string;
    try { id = decodeURIComponent(hash); } catch { return; }
    const scroll = () => {
      const target = document.getElementById(id);
      if (!target) return false;
      target.scrollIntoView({ block: "start", behavior: "instant" });
      return true;
    };
    if (scroll()) return;
    const observer = new MutationObserver(() => {
      if (scroll()) { observer.disconnect(); window.clearTimeout(timeout); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 20_000);
    return () => { observer.disconnect(); window.clearTimeout(timeout); };
  }, [location]);
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
