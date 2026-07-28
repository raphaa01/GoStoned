"use client";

import { Crown, Gamepad2, LogIn, LogOut, Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { isRouteActive } from "@/lib/i18n/routing";

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { dictionary, href } = useI18n();
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/play", label: dictionary.nav.play, icon: Gamepad2 },
    { href: "/leaderboard", label: dictionary.nav.leaderboard, icon: Crown },
    { href: user ? "/profile" : "/login", label: user ? user.displayName : dictionary.nav.login, icon: user ? UserRound : LogIn },
  ];

  async function signOut() {
    try {
      await logout();
      setOpen(false);
      router.push(href("/"));
      router.refresh();
    } catch {
      // AuthProvider keeps the current account identity when logout fails.
    }
  }

  return (
    <header className="mobile-nav">
      <Link className="brand" href={href("/")} aria-label={dictionary.nav.homeLabel} onClick={() => setOpen(false)}>
        <span className="brand-mark"><span /><span /></span>
        <span>GoStone</span>
      </Link>
      <button
        aria-expanded={open}
        aria-label={open ? dictionary.nav.closeMenu : dictionary.nav.openMenu}
        className="icon-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
      {open ? (
        <nav className="mobile-menu" aria-label={dictionary.nav.mobileLabel}>
          {links.map(({ href: path, label, icon: Icon }) => (
            <Link
              className={isRouteActive(pathname, path) ? "is-active" : ""}
              href={href(path)}
              key={path}
              onClick={() => setOpen(false)}
            >
              <Icon size={18} /> {label}
            </Link>
          ))}
          {!user ? <Link href={href("/register")} onClick={() => setOpen(false)}>{dictionary.nav.createAccount}</Link> : null}
          <Link href={href("/impressum")} onClick={() => setOpen(false)}>{dictionary.nav.legal}</Link>
          <LanguageSwitcher compact />
          {user ? (
            <button onClick={signOut} type="button"><LogOut size={18} /> {dictionary.nav.logout}</button>
          ) : null}
        </nav>
      ) : null}
    </header>
  );
}
