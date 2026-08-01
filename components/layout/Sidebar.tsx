"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAccountFeatureHref } from "@/components/auth/useAccountFeatureHref";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { RatingLabel } from "@/components/rating/RatingLabel";
import { isRouteActive } from "@/lib/i18n/routing";

export function DesktopHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout, rating } = useAuth();
  const { dictionary, href: localizedHref, locale } = useI18n();
  const reviewHref = useAccountFeatureHref("/review");
  const items = [
    { destination: localizedHref("/play"), path: "/play", label: dictionary.nav.play },
    { destination: localizedHref("/learn"), path: "/learn", label: dictionary.nav.learn },
    { destination: reviewHref, path: "/review", label: dictionary.nav.review },
    { destination: localizedHref("/puzzles"), path: "/puzzles", label: dictionary.nav.puzzles },
    { destination: localizedHref("/leaderboard"), path: "/leaderboard", label: dictionary.nav.leaderboard },
  ];

  async function signOut() {
    try {
      await logout();
      router.push(localizedHref("/"));
      router.refresh();
    } catch {
      // AuthProvider keeps the current account identity when logout fails.
    }
  }

  return (
    <header className="sidebar">
      <Link className="brand" href={localizedHref("/")} aria-label={dictionary.nav.homeLabel}>
        <span className="brand-mark"><span /><span /></span>
        <span>GoStone</span>
      </Link>

      <nav className="sidebar-nav" aria-label={dictionary.nav.mainLabel}>
        <div className="nav-group">
          {items.map(({ destination, path, label }) => (
            <Link
              className={`nav-link ${isRouteActive(pathname, path) ? "is-active" : ""}`}
              href={destination}
              key={path}
              aria-current={isRouteActive(pathname, path) ? "page" : undefined}
            >
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <div className="sidebar-bottom">
        <LanguageSwitcher />
        {loading ? <span className="sidebar-account-loading">{dictionary.nav.accountLoading}</span> : user ? (
          <>
            <Link className="sidebar-user" href={localizedHref("/profile")}>
              <ProfileAvatar size="sm" style={user.avatarStyle} />
              <span className="sidebar-user__identity">
                <strong>{user.displayName}</strong>
                {rating ? (
                  <RatingLabel
                    locale={locale}
                    preference={rating.displayPreference}
                    rating={rating.value}
                    variant="compact"
                  />
                ) : null}
              </span>
            </Link>
            <button aria-label={dictionary.nav.logout} className="sidebar-login sidebar-login--icon" onClick={signOut} type="button">
              <LogOut size={17} />
            </button>
          </>
        ) : (
          <>
            <Link className="sidebar-login" href={localizedHref("/login")}>{dictionary.nav.login}</Link>
            <Link className="sidebar-signup" href={localizedHref("/register")}>{dictionary.nav.createAccount}</Link>
          </>
        )}
      </div>
    </header>
  );
}
