"use client";

import { BookOpen, Crown, Gamepad2, LogIn, LogOut, Search, UserRound, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { isRouteActive } from "@/lib/i18n/routing";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const { dictionary, href: localizedHref } = useI18n();
  const items = [
    { href: "/play", label: dictionary.nav.play, icon: Gamepad2 },
    { href: "/learn", label: dictionary.nav.learn, icon: BookOpen },
    { href: "/review", label: dictionary.nav.review, icon: Search },
    { href: "/leaderboard", label: dictionary.nav.leaderboard, icon: Crown },
    { href: "/profile", label: dictionary.nav.profile, icon: UserRound },
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
    <aside className="sidebar">
      <Link className="brand" href={localizedHref("/")} aria-label={dictionary.nav.homeLabel}>
        <span className="brand-mark"><span /><span /></span>
        <span>GoStone</span>
      </Link>

      <nav className="sidebar-nav" aria-label={dictionary.nav.mainLabel}>
        <div className="nav-group">
          {items.map(({ href: path, label, icon: Icon }) => (
            <Link
              className={`nav-link ${isRouteActive(pathname, path) ? "is-active" : ""}`}
              href={localizedHref(path)}
              key={path}
              aria-current={isRouteActive(pathname, path) ? "page" : undefined}
            >
              <Icon size={19} strokeWidth={1.9} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <div className="sidebar-bottom">
        <LanguageSwitcher />
        <Link className="sidebar-legal" href={localizedHref("/impressum")}>{dictionary.nav.legal}</Link>
        {loading ? <span className="sidebar-account-loading">{dictionary.nav.accountLoading}</span> : user ? (
          <>
            <Link className="sidebar-user" href={localizedHref("/profile")}>
              <span>{user.displayName.slice(0, 2).toUpperCase()}</span>
              <div><strong>{user.displayName}</strong><small>{dictionary.nav.account}</small></div>
            </Link>
            <button className="sidebar-login" onClick={signOut} type="button">
              <LogOut size={17} /> {dictionary.nav.logout}
            </button>
          </>
        ) : (
          <>
            <Link className="sidebar-signup" href={localizedHref("/register")}>
              <UserRoundPlus size={17} /> {dictionary.nav.createAccount}
            </Link>
            <Link className="sidebar-login" href={localizedHref("/login")}><LogIn size={17} /> {dictionary.nav.login}</Link>
          </>
        )}
      </div>
    </aside>
  );
}
