import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getMobileCopy } from "@/lib/i18n/mobile";

export function MobileSplash() {
  const { loading } = useAuth();
  const { locale } = useI18n();
  const copy = getMobileCopy(locale);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const minimum = window.setTimeout(() => setMinimumElapsed(true), 650);
    const maximum = window.setTimeout(() => setDismissed(true), 2_400);
    return () => {
      window.clearTimeout(minimum);
      window.clearTimeout(maximum);
    };
  }, []);

  useEffect(() => {
    if (!minimumElapsed || loading) return;
    const frame = window.requestAnimationFrame(() => setDismissed(true));
    return () => window.cancelAnimationFrame(frame);
  }, [loading, minimumElapsed]);

  return (
    <div
      aria-hidden={dismissed}
      aria-label={copy.loading}
      className={`mobile-splash${dismissed ? " is-dismissed" : ""}`}
      role="status"
    >
      <div className="mobile-splash__mark" aria-hidden="true">
        <i /><i /><i />
        <span />
      </div>
      <strong>GoStone</strong>
    </div>
  );
}
