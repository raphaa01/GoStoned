import Link from "next/link";

export function AppFooter() {
  return (
    <footer className="app-footer">
      <span>© {new Date().getFullYear()} GoStone</span>
      <nav aria-label="Legal">
        <Link href="/impressum">Impressum</Link>
      </nav>
    </footer>
  );
}
