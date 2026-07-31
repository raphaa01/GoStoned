export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Copy .env.example to .env and set the connection string.",
    );
  }

  return databaseUrl;
}

const LOCAL_POSTGRES_TCP_HOSTS = new Set(["localhost", "127.0.0.1"]);
const POSTGRES_TARGET_OVERRIDE_PARAMETERS = new Set([
  "host",
  "hostaddr",
  "service",
  "servicefile",
]);

function parsePostgresUrl(databaseUrl: string): URL | null {
  if (databaseUrl !== databaseUrl.trim()) return null;

  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    return url;
  } catch {
    return null;
  }
}

export function isLocalDatabase(databaseUrl: string): boolean {
  const url = parsePostgresUrl(databaseUrl);
  if (!url) return false;

  // node-postgres uses the last non-empty `host` query value instead of the
  // authority host. Mirror that target selection so SSL and production checks
  // classify the database that the driver will actually contact.
  const queryHost = url.searchParams.getAll("host").at(-1);
  const effectiveHost = (queryHost || url.hostname).toLowerCase();
  return LOCAL_POSTGRES_TCP_HOSTS.has(effectiveHost)
    || effectiveHost === "::1"
    || effectiveHost.startsWith("/");
}

export function shouldUseDatabaseSsl(
  databaseUrl: string,
  configuredSsl = process.env.DATABASE_SSL,
): boolean {
  const override = configuredSsl?.trim().toLowerCase();
  if (override === "require") return true;
  if (override === "disable") return false;
  return !isLocalDatabase(databaseUrl);
}

export function isUnambiguousLocalDatabase(databaseUrl: string): boolean {
  const url = parsePostgresUrl(databaseUrl);
  if (!url) return false;

  // Destructive smoke tests accept only an explicit TCP loopback authority.
  // PostgreSQL query parameters may otherwise replace or obscure that target.
  for (const parameter of url.searchParams.keys()) {
    if (POSTGRES_TARGET_OVERRIDE_PARAMETERS.has(parameter.toLowerCase())) return false;
  }

  return LOCAL_POSTGRES_TCP_HOSTS.has(url.hostname.toLowerCase());
}
