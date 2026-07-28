import { AuthForm } from "@/components/auth/AuthForm";
import { AppShell } from "@/components/layout/AppShell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("de", "login", "/login");

export default function GermanLoginPage() {
  return <AppShell><div className="auth-page"><AuthForm mode="login" /></div></AppShell>;
}
