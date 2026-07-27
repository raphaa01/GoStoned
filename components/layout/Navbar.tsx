"use client";

import { Crown, Gamepad2, LogIn, LogOut, Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/play", label: "Play", icon: Gamepad2 },
    { href: "/leaderboard", label: "Leaderboard", icon: Crown },
    { href: user ? "/profile" : "/login", label: user ? user.displayName : "Log in", icon: user ? UserRound : LogIn },
  ];

  async function signOut() {
    await logout();
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  return (
    <header className="mobile-nav">
      <Link className="brand" href="/" aria-label="GoStoned home" onClick={() => setOpen(false)}>
        <span className="brand-mark"><span /><span /></span>
        <span>GoStoned</span>
      </Link>
      <button
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        className="icon-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
      {open ? (
        <nav className="mobile-menu" aria-label="Mobile navigation">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              className={pathname.startsWith(href) ? "is-active" : ""}
              href={href}
              key={href}
              onClick={() => setOpen(false)}
            >
              <Icon size={18} /> {label}
            </Link>
          ))}
          {!user ? <Link href="/register" onClick={() => setOpen(false)}>Create account</Link> : null}
          {user ? (
            <button onClick={signOut} type="button"><LogOut size={18} /> Log out</button>
          ) : null}
        </nav>
      ) : null}
    </header>
  );
}
