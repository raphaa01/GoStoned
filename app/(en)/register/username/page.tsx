import { OAuthUsernameForm } from "@/components/auth/OAuthUsernameForm";
import { AppShell } from "@/components/layout/AppShell";
import { safeAuthReturnPath } from "@/lib/auth/returnPath";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "register", "/register/username");

type OAuthUsernamePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OAuthUsernamePage({ searchParams }: OAuthUsernamePageProps) {
  const parameters = await searchParams;
  return (
    <AppShell>
      <div className="auth-page auth-page--register">
        <OAuthUsernameForm returnTo={safeAuthReturnPath(parameters.returnTo)} />
      </div>
    </AppShell>
  );
}
