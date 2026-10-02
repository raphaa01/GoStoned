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
};

declare global {
  interface Window {
    gostoneNavigateFromNative?: (href: string) => void;
    webkit?: {
      messageHandlers?: {
        gostoneChrome?: { postMessage: (message: NativeChromeMessage) => void };
      };
    };
  }
}

export function installNativeChromeBridge(): void {
  window.gostoneNavigateFromNative = (href) => {
    if (!href || `${window.location.pathname}${window.location.search}` === href) return;
    window.history.pushState({}, "", href);
    window.dispatchEvent(new Event("gostone:navigation"));
  };
}

export function updateNativeChrome(message: NativeChromeMessage): void {
  window.webkit?.messageHandlers?.gostoneChrome?.postMessage(message);
}
