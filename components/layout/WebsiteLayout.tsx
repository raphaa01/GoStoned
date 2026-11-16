import type { ReactNode } from "react";
import { SkipLink } from "./SkipLink";
import { WebsiteNavigation } from "./WebsiteNavigation";

export function WebsiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="web-site">
      <SkipLink />
      <WebsiteNavigation />
      {children}
    </div>
  );
}
