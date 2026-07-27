import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <AppShell>
      <div className="auth-page"><AuthForm mode="login" /></div>
    </AppShell>
  );
}
