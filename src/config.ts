import "dotenv/config";

export type RuntimeConfig = {
  corsOrigin: string[];
  databaseUrl: string;
  logLevel: string;
  nodeEnv: "development" | "test" | "production";
  port: number;
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

export function loadConfig(): RuntimeConfig {
  const nodeEnv = readNodeEnv();
  const fallbackSecret = nodeEnv === "production" ? "" : "dev-session-secret-change-me";
  const sessionSecret = process.env.SESSION_SECRET ?? fallbackSecret;

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required in production.");
  }

  return {
    corsOrigin: readCorsOrigin(),
    databaseUrl:
      process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/vibehall",
    logLevel: process.env.LOG_LEVEL ?? "info",
    nodeEnv,
    port: readPort(),
    sessionSecret
  };
}

export function toSafeConfig(config: RuntimeConfig) {
  return {
    corsOrigin: config.corsOrigin,
    databaseConfigured: Boolean(config.databaseUrl),
    logLevel: config.logLevel,
    nodeEnv: config.nodeEnv,
    port: config.port,
    sessionSecretConfigured: Boolean(config.sessionSecret)
  };
}
