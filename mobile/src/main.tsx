import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import "@/app/globals.css";
import "@/app/redesign.css";
import "./mobile.css";
import { MobileApp } from "./MobileApp";
import { installNativeChromeBridge } from "./nativeChrome";
import { installMobileFetchBridge } from "./runtime";
import { handleNativeOAuthUrl } from "./nativeOAuth";

installMobileFetchBridge();
installNativeChromeBridge();
const mobilePlatform = Capacitor.getPlatform();
document.documentElement.dataset.mobilePlatform = mobilePlatform;
document.documentElement.dataset.mobileApp = "true";
if (mobilePlatform === "ios") document.documentElement.dataset.nativeTabBar = "true";

void CapacitorApp.addListener("appUrlOpen", ({ url }) => {
  if (handleNativeOAuthUrl(url)) return;
  const opened = new URL(url);
  window.history.pushState({}, "", `${opened.pathname}${opened.search}${opened.hash}`);
  window.dispatchEvent(new Event("gostone:navigation"));
});
void CapacitorApp.getLaunchUrl().then((launch) => {
  if (launch?.url) handleNativeOAuthUrl(launch.url);
});

const root = document.getElementById("root");
if (!root) throw new Error("The GoStone mobile root element is missing.");

createRoot(root).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
