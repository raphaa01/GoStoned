"use client";

import {
  BarChart3,
  BookOpen,
  CircleUserRound,
  Crown,
  Gamepad2,
  LayoutDashboard,
  LogIn,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const mainItems = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/play", label: "Play", icon: Gamepad2 },
  { href: "/leaderboard", label: "Leaderboard", icon: Crown },
  { href: "/profile", label: "My profile", icon: CircleUserRound },
];

const secondaryItems = [
  { href: "/#learn", label: "Learn Go", icon: BookOpen },
  { href: "/#stats", label: "Statistics", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="KAYA home">
        <span className="brand-mark">
          <span />
          <span />
        </span>
        <span>KAYA</span>
      </Link>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="nav-group">
          {mainItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link className={`nav-link ${active ? "is-active" : ""}`} href={href} key={href}>
                <Icon size={19} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>

        <span className="nav-label">Explore</span>
        <div className="nav-group">
          {secondaryItems.map(({ href, label, icon: Icon }) => (
            <Link className="nav-link" href={href} key={href}>
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <div className="sidebar-bottom">
        <Link className="nav-link" href="/#settings">
          <Settings size={19} strokeWidth={1.8} />
          <span>Settings</span>
        </Link>
        <div className="guest-card">
          <div className="guest-avatar">G</div>
          <div>
            <strong>Playing as guest</strong>
            <span>Create an account to save progress</span>
          </div>
          <LogIn size={18} />
        </div>
      </div>
    </aside>
  );
}
