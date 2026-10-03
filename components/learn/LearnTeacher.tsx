import type { ReactNode } from "react";
import { TrainerAvatar } from "./TrainerAvatar";

export function LearnTeacher({ children, tone = "neutral", announce = false }: Readonly<{
  children: ReactNode;
  tone?: "neutral" | "success" | "correction";
  announce?: boolean;
}>) {
  return <div className="learn-teacher" data-tone={tone}>
    <TrainerAvatar />
    <div className="learn-teacher__speech" role={announce ? "status" : undefined} aria-live={announce ? "polite" : undefined}>
      {children}
    </div>
  </div>;
}
