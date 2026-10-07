import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeShare = registerPlugin<{ share(options: { title: string; text: string; url: string }): Promise<void> }>("GoStoneShare");

export async function shareGameLink(options: { title: string; text: string; url: string }): Promise<"shared" | "copied" | "link"> {
  if (Capacitor.isNativePlatform()) {
    await NativeShare.share(options);
    return "shared";
  }
  if (navigator.share) {
    try {
      await navigator.share(options);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // Some browsers lose transient activation while the link is created.
      // Keep the public link usable through the clipboard or selection below.
    }
  }
  try {
    await navigator.clipboard.writeText(options.url);
    return "copied";
  } catch {
    return "link";
  }
}
