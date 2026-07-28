import { AuthForm } from "@/components/auth/AuthForm";
import { AppShell } from "@/components/layout/AppShell";
import { safeReauthenticationReturnPath } from "@/lib/auth/returnPath";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("de", "login", "/login");

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function GermanLoginPage({ searchParams }: LoginPageProps) {
  const parameters = await searchParams;
  const returnTo = parameters.reauthenticate === "1"
    ? safeReauthenticationReturnPath(parameters.returnTo)
    : null;
  return (
    <AppShell>
      <div className="auth-page">
        <AuthForm mode="login" reauthenticate={Boolean(returnTo)} returnTo={returnTo} />
      </div>
    </AppShell>
  );
}
