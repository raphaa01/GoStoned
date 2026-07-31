"use client";

import { BookOpen, Crown, Gamepad2, LogIn, LogOut, Menu, Puzzle, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
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
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  const links = [
    { href: "/play", label: dictionary.nav.play, icon: Gamepad2 },
    { href: "/learn", label: dictionary.nav.learn, icon: BookOpen },
    { href: "/review", label: dictionary.nav.review, icon: Search },
    { href: "/puzzles", label: dictionary.nav.puzzles, icon: Puzzle },
    { href: "/leaderboard", label: dictionary.nav.leaderboard, icon: Crown },
    { href: user ? "/profile" : "/login", label: user ? user.displayName : dictionary.nav.login, icon: user ? UserRound : LogIn },
  ];

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      menuButton.current?.focus();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

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
    <header
      className="mobile-nav"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!open || (nextTarget instanceof Node && event.currentTarget.contains(nextTarget))) return;
        setOpen(false);
        if (!(nextTarget instanceof HTMLElement)) return;
        window.requestAnimationFrame(() => {
          if (!nextTarget.isConnected || document.activeElement !== nextTarget) return;
          const bounds = nextTarget.getBoundingClientRect();
          if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
            nextTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        });
      }}
    >
      <Link className="brand" href={href("/")} aria-label={dictionary.nav.homeLabel} onClick={() => setOpen(false)}>
        <span className="brand-mark"><span /><span /></span>
        <span>GoStone</span>
      </Link>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={open ? dictionary.nav.closeMenu : dictionary.nav.openMenu}
        className="icon-button"
        onClick={() => setOpen((current) => !current)}
        ref={menuButton}
        type="button"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
      <nav
        aria-label={dictionary.nav.mobileLabel}
        className="mobile-menu"
        hidden={!open}
        id={menuId}
      >
          {links.map(({ href: path, label, icon: Icon }) => (
            <Link
              className={isRouteActive(pathname, path) ? "is-active" : ""}
              href={href(path)}
              key={path}
              onClick={() => setOpen(false)}
              aria-current={isRouteActive(pathname, path) ? "page" : undefined}
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
    </header>
  );
}
