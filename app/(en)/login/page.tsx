import Image from "next/image";
import { AuthForm } from "@/components/auth/AuthForm";
import { AppShell } from "@/components/layout/AppShell";
import { configuredOAuthProviders } from "@/lib/auth/oauth";
import { safeAuthReturnPath } from "@/lib/auth/returnPath";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "login", "/login");

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const parameters = await searchParams;
  const returnTo = safeAuthReturnPath(parameters.returnTo);
  return (
    <AppShell>
      <div className="auth-page">
        <div aria-hidden="true" className="auth-material">
          <Image alt="" height={1024} priority sizes="(max-width: 760px) 100vw, 52vw" src="/images/gostone-hero-stone.webp" width={1536} />
        </div>
        <AuthForm
          configuredOAuthProviders={configuredOAuthProviders()}
          mode="login"
          oauthError={typeof parameters.oauthError === "string" ? parameters.oauthError : null}
          reauthenticate={parameters.reauthenticate === "1" && Boolean(returnTo)}
          returnTo={returnTo}
        />
      </div>
    </AppShell>
  );
}
