"use client";

import { ArrowUpRight } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import styles from "./ios-app-banner.module.css";

const appStoreUrl = "https://apps.apple.com/de/app/gostone-lerne-und-spiele-go/id6819760816";
const subscribe = () => () => {};
const getServerSnapshot = () => false;

function isIosDevice() {
  const { userAgent, maxTouchPoints } = navigator;

  // iPadOS can use a desktop Safari user agent.
  return /\b(iPhone|iPad|iPod)\b/.test(userAgent)
    || (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1);
}

export function IosAppBanner() {
  const isIos = useSyncExternalStore(subscribe, isIosDevice, getServerSnapshot);
  const { dictionary } = useI18n();

  if (!isIos) return null;

  return (
    <a className={styles.banner} href={appStoreUrl}>
      <span>{dictionary.home.playInApp}</span>
      <span className={styles.store}>
        {dictionary.home.appStore} <ArrowUpRight aria-hidden="true" size={15} />
      </span>
    </a>
  );
}
