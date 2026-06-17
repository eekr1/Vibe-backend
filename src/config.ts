import "dotenv/config";

export type RuntimeConfig = {
  corsOrigin: string[];
  databaseUrl: string;
  emailFrom: string;
  emailProvider: "console" | "brevo";
  frontendUrl: string;
  logLevel: string;
  nodeEnv: "development" | "test" | "production";
  port: number;
  brevoApiKey?: string;
  sessionSecret: string;
};

function readNodeEnv(): RuntimeConfig["nodeEnv"] {
  const value = process.env.NODE_ENV ?? "development";

  if (value === "development" || value === "test" || value === "production") {
    return value;
  }

  throw new Error(`Invalid NODE_ENV value: ${value}`);
}

function readPort(): number {
  const rawPort = process.env.PORT ?? "4000";
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return port;
}

function readCorsOrigin(): string[] {
  const rawOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";
  return rawOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function readEmailProvider(): RuntimeConfig["emailProvider"] {
  const rawValue = process.env.EMAIL_PROVIDER?.trim().replace(/^["']|["']$/g, "").toLowerCase();
  const value = rawValue || (process.env.BREVO_API_KEY ? "brevo" : "console");

  if (value === "console" || value === "brevo") {
    return value;
  }

  throw new Error(`Invalid EMAIL_PROVIDER value: ${value}`);
}

export function loadConfig(): RuntimeConfig {
  const nodeEnv = readNodeEnv();
  const fallbackSecret = nodeEnv === "production" ? "" : "dev-session-secret-change-me";
  const sessionSecret = process.env.SESSION_SECRET ?? fallbackSecret;
  const emailProvider = readEmailProvider();
  const brevoApiKey = process.env.BREVO_API_KEY;

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required in production.");
  }

  if (emailProvider === "brevo" && !brevoApiKey) {
    throw new Error("BREVO_API_KEY is required when EMAIL_PROVIDER=brevo.");
  }

  return {
    brevoApiKey,
    corsOrigin: readCorsOrigin(),
    databaseUrl:
      process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/vibehall",
    emailFrom: process.env.EMAIL_FROM ?? "Vibehall <noreply@vibehall.local>",
    emailProvider,
    frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
    logLevel: process.env.LOG_LEVEL ?? "info",
    nodeEnv,
    port: readPort(),
    sessionSecret
  };
}

export function toSafeConfig(config: RuntimeConfig) {
  return {
    brevoApiKeyConfigured: Boolean(config.brevoApiKey),
    corsOrigin: config.corsOrigin,
    databaseConfigured: Boolean(config.databaseUrl),
    emailFromConfigured: Boolean(config.emailFrom),
    emailProvider: config.emailProvider,
    frontendUrlConfigured: Boolean(config.frontendUrl),
    logLevel: config.logLevel,
    nodeEnv: config.nodeEnv,
    port: config.port,
    sessionSecretConfigured: Boolean(config.sessionSecret)
  };
}
