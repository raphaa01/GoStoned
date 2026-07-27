import { Menu } from "lucide-react";
import Link from "next/link";

export function Navbar() {
  return (
    <header className="mobile-nav">
      <Link className="brand" href="/" aria-label="KAYA home">
        <span className="brand-mark">
          <span />
          <span />
        </span>
        <span>KAYA</span>
      </Link>
      <Link className="mobile-play-link" href="/play">
        Play
      </Link>
      <button className="icon-button" aria-label="Open menu" type="button">
        <Menu size={22} />
      </button>
    </header>
  );
}
