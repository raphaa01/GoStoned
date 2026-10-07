import { allowsMobileBackGesture } from "@/lib/mobile/navigationPolicy";

type NativeTab = {
  href: string;
  label: string;
  route: string;
};

type NativeChromeMessage = {
  activeRoute: string | null;
  tabs: NativeTab[];
  type: "state";
  visible: boolean;
} | { type: "theme"; dark: boolean } | { type: "navigation"; canGoBack: boolean };

declare global {
  interface Window {
    gostoneNavigateFromNative?: (href: string) => void;
    gostoneBackFromNative?: () => void;
    webkit?: {
      messageHandlers?: {
        gostoneChrome?: { postMessage: (message: NativeChromeMessage) => void };
      };
    };
  }
}

export function installNativeChromeBridge(): void {
  window.gostoneBackFromNative = () => {
    if (allowsMobileBackGesture(window.location.pathname)) window.history.back();
  };
  window.gostoneNavigateFromNative = (href) => {
    if (!href || `${window.location.pathname}${window.location.search}` === href) return;
    window.history.pushState({}, "", href);
    window.dispatchEvent(new Event("gostone:navigation"));
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  };
}

export function updateNativeChrome(message: NativeChromeMessage): void {
  window.webkit?.messageHandlers?.gostoneChrome?.postMessage(message);
}
