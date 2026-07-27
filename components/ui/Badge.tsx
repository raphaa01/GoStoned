import type { HTMLAttributes } from "react";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "green" | "neutral" | "amber";
};

export function Badge({
  className = "",
  tone = "neutral",
  ...props
}: BadgeProps) {
  return <span className={`badge badge--${tone} ${className}`} {...props} />;
}
