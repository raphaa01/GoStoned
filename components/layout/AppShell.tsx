import type { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <Navbar />
      <main className="app-main">
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}
