import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useLayoutEffect, useRef } from "react";

export function useNativeBack(handler: () => void) {
  const latest = useRef(handler);
  useLayoutEffect(() => { latest.current = handler; }, [handler]);
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    const listener = App.addListener("backButton", () => latest.current());
    return () => { void listener.then((subscription) => subscription.remove()); };
  }, []);
}
