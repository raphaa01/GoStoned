import { BarChart3, GraduationCap, Home, Puzzle, Trophy } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getMobileCopy } from "@/lib/i18n/mobile";
import { usePathname } from "./next-navigation";

function routeIsActive(pathname: string, route: string) {
  const normalized = pathname.replace(/^\/(?:de|fr|es|zh|ja|ko|ky)(?=\/|$)/, "") || "/";
  if (route === "/") return normalized === "/";
  return normalized === route || normalized.startsWith(`${route}/`);
}

export function MobileShell({ children, showPlayAction = false }: {
  children: ReactNode;
  showPlayAction?: boolean;
}) {
  const pathname = usePathname();
  const { dictionary, href, locale } = useI18n();
  const copy = getMobileCopy(locale);
  const items = [
    { route: "/", label: copy.home, icon: Home },
    { route: "/puzzles", label: dictionary.nav.puzzles, icon: Puzzle },
    { route: "/learn", label: dictionary.nav.learn, icon: GraduationCap },
    { route: "/review", label: dictionary.nav.review, icon: BarChart3 },
    { route: "/leaderboard", label: dictionary.nav.leaderboard, icon: Trophy },
  ] as const;

  return (
    <div className={`mobile-app-shell${showPlayAction ? " has-play-action" : ""}`}>
      <main className="mobile-app-content" id="main-content" tabIndex={-1}>{children}</main>
      {showPlayAction ? (
        <div className="mobile-play-dock">
          <Link className="mobile-play-action" href={href("/play")}>
            <span aria-hidden="true" className="mobile-play-stone" />
            {copy.play}
          </Link>
        </div>
      ) : null}
      <nav aria-label={copy.appNavigation} className="mobile-tab-bar">
        {items.map(({ route, label, icon: Icon }) => {
          const active = routeIsActive(pathname, route);
          return (
            <Link aria-current={active ? "page" : undefined} className={active ? "is-active" : ""} href={href(route)} key={route}>
              <Icon aria-hidden="true" size={22} strokeWidth={active ? 2.25 : 1.8} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
