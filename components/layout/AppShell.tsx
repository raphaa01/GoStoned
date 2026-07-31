import type { ReactNode } from "react";
import { SkipLink } from "@/components/layout/SkipLink";
import { AppFooter } from "./AppFooter";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <SkipLink />
      <Sidebar />
      <Navbar />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <div className="app-content">{children}</div>
        <AppFooter />
      </main>
    </div>
  );
}
