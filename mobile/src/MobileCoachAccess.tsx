import { Capacitor } from "@capacitor/core";
import { lazy, Suspense } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getCoachCopy } from "@/lib/i18n/coach";
import { canPlayCoach } from "@/lib/mobile/coachAccess";

const MobileCoach = lazy(() => import("./MobileCoach").then(module => ({ default: module.MobileCoach })));

export function MobileCoachEntry() {
  const { user, loading, error } = useAuth();
  const { locale, href } = useI18n();
  if (!canPlayCoach(user, Capacitor.isNativePlatform(), loading, error)) return null;
  const copy = getCoachCopy(locale);
  return <Link className="mobile-coach-entry" href={href("/play/coach")}><span>{copy.title}</span><span className="mobile-coach-beta">{copy.beta}</span></Link>;
}

export function MobileCoachGate() {
  const { user, loading, error } = useAuth();
  const { locale } = useI18n();
  const copy = getCoachCopy(locale);
  if (loading) return <p role="status">{copy.preparing}</p>;
  if (!canPlayCoach(user, Capacitor.isNativePlatform(), loading, error)) return <p>{copy.blocked}</p>;
  return <Suspense fallback={<p role="status">{copy.preparing}</p>}><MobileCoach key={user!.playerKey} /></Suspense>;
}
