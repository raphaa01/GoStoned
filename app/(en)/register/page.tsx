import { AuthForm } from "@/components/auth/AuthForm";
import { AppShell } from "@/components/layout/AppShell";
import { configuredOAuthProviders } from "@/lib/auth/oauth";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "register", "/register");

type RegisterPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const parameters = await searchParams;
  return (
    <AppShell>
      <div className="auth-page auth-page--register">
        <AuthForm
          configuredOAuthProviders={configuredOAuthProviders()}
          mode="register"
          oauthError={typeof parameters.oauthError === "string" ? parameters.oauthError : null}
        />
      </div>
    </AppShell>
  );
}
