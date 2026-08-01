import { AuthForm } from "@/components/auth/AuthForm";
import { AppShell } from "@/components/layout/AppShell";
import { safeAccountReturnPath } from "@/lib/auth/returnPath";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "register", "/register");

type RegisterPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const parameters = await searchParams;
  const returnTo = safeAccountReturnPath(parameters.returnTo);
  return (
    <AppShell>
      <div className="auth-page">
        <AuthForm
          mode="register"
          oauthError={typeof parameters.oauthError === "string" ? parameters.oauthError : null}
          returnTo={returnTo}
        />
      </div>
    </AppShell>
  );
}
