"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { isRouteActive } from "@/lib/i18n/routing";

export function DesktopHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const { dictionary, href: localizedHref } = useI18n();
  const items = [
    { href: "/play", label: dictionary.nav.play },
    { href: "/learn", label: dictionary.nav.learn },
    { href: "/review", label: dictionary.nav.review },
    { href: "/leaderboard", label: dictionary.nav.leaderboard },
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
          {items.map(({ href: path, label }) => (
            <Link
              className={`nav-link ${isRouteActive(pathname, path) ? "is-active" : ""}`}
              href={localizedHref(path)}
              key={path}
              aria-current={isRouteActive(pathname, path) ? "page" : undefined}
            >
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <div className="sidebar-bottom">
        <LanguageSwitcher compact />
        {loading ? <span className="sidebar-account-loading">{dictionary.nav.accountLoading}</span> : user ? (
          <>
            <Link className="sidebar-user" href={localizedHref("/profile")}>
              <span>{user.displayName.slice(0, 2).toUpperCase()}</span>
              <strong>{user.displayName}</strong>
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
