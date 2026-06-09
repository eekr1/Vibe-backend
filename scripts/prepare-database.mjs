import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const npxCommand = isWindows ? "npx.cmd" : "npx";

function runStep(label, command, args) {
  console.log(`[database] ${label}...`);

  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) {
    console.error(`[database] ${label} failed before execution: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[database] ${label} failed with exit code ${result.status ?? "unknown"}.`);
    process.exit(result.status ?? 1);
  }

  console.log(`[database] ${label} completed.`);
}

if (!process.env.DATABASE_URL) {
  console.error("[database] DATABASE_URL is missing. Database preparation cannot continue.");
  process.exit(1);
}

console.log("[database] Preparing database schema for deploy...");
runStep("Prisma schema push", npxCommand, ["prisma", "db", "push"]);
runStep("Category seed", npmCommand, ["run", "prisma:seed"]);
console.log("[database] Database ready.");
