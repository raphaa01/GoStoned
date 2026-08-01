import { useId } from "react";
import type { ProfileAvatarStyle } from "@/lib/profileAvatar";

type ProfileAvatarProps = {
  decorative?: boolean;
  label?: string;
  size?: "xs" | "sm" | "md" | "lg";
  style: ProfileAvatarStyle;
};

function KifuMark() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 100 100">
      <rect className="profile-symbol__kifu-board" height="100" rx="15" width="100" />
      <g className="profile-symbol__kifu-grid">
        <path d="M25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100" />
      </g>
      <circle className="profile-symbol__stone profile-symbol__stone--black" cx="25" cy="25" r="10" />
      <circle className="profile-symbol__stone profile-symbol__stone--white" cx="75" cy="50" r="10" />
      <circle className="profile-symbol__stone profile-symbol__stone--black profile-symbol__detail" cx="50" cy="75" r="10" />
      <circle className="profile-symbol__stone profile-symbol__stone--white profile-symbol__detail" cx="50" cy="50" r="10" />
    </svg>
  );
}

function UrushiMon() {
  const lacquerId = useId();
  const stoneId = useId();
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 100 100">
      <defs>
        <radialGradient cx="38%" cy="30%" id={lacquerId} r="78%">
          <stop offset="0" stopColor="#a03a38" />
          <stop offset="0.62" stopColor="#702321" />
          <stop offset="1" stopColor="#461313" />
        </radialGradient>
        <radialGradient cx="36%" cy="28%" id={stoneId} r="76%">
          <stop offset="0" stopColor="#3e342f" />
          <stop offset="0.52" stopColor="#171515" />
          <stop offset="1" stopColor="#060606" />
        </radialGradient>
      </defs>
      <rect fill={`url(#${lacquerId})`} height="100" rx="15" width="100" />
      <circle className="profile-symbol__urushi-ring" cx="50" cy="50" r="34.5" />
      <g className="profile-symbol__urushi-shell">
        <path d="M50 17C59 27 59 37 50 45C41 37 41 27 50 17Z" />
        <path d="M83 50C73 59 63 59 55 50C63 41 73 41 83 50Z" />
        <path d="M50 83C41 73 41 63 50 55C59 63 59 73 50 83Z" />
        <path d="M17 50C27 41 37 41 45 50C37 59 27 59 17 50Z" />
      </g>
      <circle className="profile-symbol__urushi-stone-rim" cx="50" cy="50" r="11.5" />
      <circle cx="50" cy="50" fill={`url(#${stoneId})`} r="9.5" />
      <ellipse className="profile-symbol__urushi-glint" cx="46.5" cy="46.5" rx="3.4" ry="2.2" />
    </svg>
  );
}

export function ProfileAvatar({
  decorative = true,
  label,
  size = "md",
  style,
}: ProfileAvatarProps) {
  return (
    <span
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : label}
      className={`profile-symbol profile-symbol--${size} profile-symbol--${style}`}
      role={decorative ? undefined : "img"}
    >
      {style === "urushi-mon" ? <UrushiMon /> : <KifuMark />}
    </span>
  );
}
