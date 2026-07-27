"use client";

import { Crown, Gamepad2, LogIn, LogOut, UserRound, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

const items = [
  { href: "/play", label: "Play", icon: Gamepad2 },
  { href: "/leaderboard", label: "Leaderboard", icon: Crown },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  async function signOut() {
    await logout();
    router.push("/");
    router.refresh();
  }

  return (
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="GoStone home">
        <span className="brand-mark"><span /><span /></span>
        <span>GoStone</span>
      </Link>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="nav-group">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              className={`nav-link ${pathname.startsWith(href) ? "is-active" : ""}`}
              href={href}
              key={href}
            >
              <Icon size={19} strokeWidth={1.9} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <div className="sidebar-bottom">
        <Link className="sidebar-legal" href="/impressum">Impressum</Link>
        {loading ? <span className="sidebar-account-loading">Loading account…</span> : user ? (
          <>
            <Link className="sidebar-user" href="/profile">
              <span>{user.displayName.slice(0, 2).toUpperCase()}</span>
              <div><strong>{user.displayName}</strong><small>Account</small></div>
            </Link>
            <button className="sidebar-login" onClick={signOut} type="button">
              <LogOut size={17} /> Log out
            </button>
          </>
        ) : (
          <>
            <Link className="sidebar-signup" href="/register">
              <UserRoundPlus size={17} /> Create account
            </Link>
            <Link className="sidebar-login" href="/login"><LogIn size={17} /> Log in</Link>
          </>
        )}
      </div>
    </aside>
  );
}
