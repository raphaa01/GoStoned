"use client";

import {
  BarChart3,
  BookOpen,
  Crown,
  Gamepad2,
  LogIn,
  MessageCircle,
  Radio,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const mainItems = [
  { href: "/play", label: "Play", icon: Gamepad2 },
  { href: "/#learn", label: "Learn", icon: BookOpen },
  { href: "/leaderboard", label: "Leaderboard", icon: Crown },
];

const secondaryItems = [
  { href: "/#watch", label: "Watch", icon: Radio },
  { href: "/#community", label: "Community", icon: Users },
  { href: "/#stats", label: "Statistics", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="GoStoned home">
        <span className="brand-mark">
          <span />
          <span />
        </span>
        <span>GoStoned</span>
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

        <span className="nav-label">More</span>
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
        <Link className="nav-link" href="/#support">
          <MessageCircle size={19} strokeWidth={1.8} />
          <span>Support</span>
        </Link>
        <Link className="nav-link" href="/#settings">
          <Settings size={19} strokeWidth={1.8} />
          <span>Settings</span>
        </Link>
        <Link className="sidebar-signup" href="/profile">Sign Up</Link>
        <Link className="sidebar-login" href="/profile"><LogIn size={17} /> Log In</Link>
      </div>
    </aside>
  );
}
