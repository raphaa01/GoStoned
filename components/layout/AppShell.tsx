import type { ReactNode } from "react";
import { AppFooter } from "./AppFooter";
import { TournamentNotice } from "@/components/tournaments/TournamentNotice";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <main className="app-main" id="main-content" tabIndex={-1}>
        <TournamentNotice />
        <div className="app-content">{children}</div>
        <AppFooter />
      </main>
    </div>
  );
}
