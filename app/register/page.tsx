import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <AppShell>
      <div className="auth-page"><AuthForm mode="register" /></div>
    </AppShell>
  );
}
