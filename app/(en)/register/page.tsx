import Image from "next/image";
import { AuthForm } from "@/components/auth/AuthForm";
import { AppShell } from "@/components/layout/AppShell";
import { configuredOAuthProviders } from "@/lib/auth/oauth";
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
      <div className="auth-page auth-page--register">
        <div aria-hidden="true" className="auth-material">
          <Image alt="" height={1024} priority sizes="(max-width: 760px) 100vw, 52vw" src="/images/gostone-hero-stone.webp" width={1536} />
        </div>
        <AuthForm
          configuredOAuthProviders={configuredOAuthProviders()}
          mode="register"
          oauthError={typeof parameters.oauthError === "string" ? parameters.oauthError : null}
          returnTo={returnTo}
        />
      </div>
    </AppShell>
  );
}
