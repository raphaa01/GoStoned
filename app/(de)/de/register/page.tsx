import { AuthForm } from "@/components/auth/AuthForm";
import { AppShell } from "@/components/layout/AppShell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("de", "register", "/register");

export default function GermanRegisterPage() {
  return <AppShell><div className="auth-page"><AuthForm mode="register" /></div></AppShell>;
}
