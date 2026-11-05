import type { ReactNode } from "react";
import { SkipLink } from "@/components/layout/SkipLink";
import { AppFooter } from "./AppFooter";
import { Navbar } from "./Navbar";
import { DesktopHeader } from "./Sidebar";
import { TournamentNotice } from "@/components/tournaments/TournamentNotice";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <SkipLink />
      <DesktopHeader />
      <Navbar />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <TournamentNotice />
        <div className="app-content">{children}</div>
        <AppFooter />
      </main>
    </div>
  );
}
