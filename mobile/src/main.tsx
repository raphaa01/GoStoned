import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import "@/app/globals.css";
import "@/app/redesign.css";
import "./mobile.css";
import { MobileApp } from "./MobileApp";
import { installMobileFetchBridge } from "./runtime";

installMobileFetchBridge();
document.documentElement.dataset.mobilePlatform = Capacitor.getPlatform();
document.documentElement.dataset.mobileApp = "true";

void CapacitorApp.addListener("appUrlOpen", ({ url }) => {
  const opened = new URL(url);
  window.history.pushState({}, "", `${opened.pathname}${opened.search}${opened.hash}`);
  window.dispatchEvent(new Event("gostone:navigation"));
});

const root = document.getElementById("root");
if (!root) throw new Error("The GoStone mobile root element is missing.");

createRoot(root).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
