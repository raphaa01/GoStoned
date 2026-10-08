import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

// Account entitlements are server data, not baked into the installed binary.
export function MobileSessionRefresh() {
  const { refresh } = useAuth();
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let active = true;
    const update = () => {
      if (disposed || inFlight || !active || document.hidden || !navigator.onLine) return;
      inFlight = true;
      void refresh({ silent: true }).catch(() => undefined).finally(() => { inFlight = false; });
    };
    const visible = () => { if (!document.hidden) update(); };
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", visible);
    const nativeListener = Capacitor.isNativePlatform()
      ? App.addListener("appStateChange", ({ isActive }) => { active = isActive; if (isActive) update(); }).catch(() => null)
      : null;
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", visible);
      void nativeListener?.then(listener => listener?.remove()).catch(() => undefined);
    };
  }, [refresh]);
  return null;
}
