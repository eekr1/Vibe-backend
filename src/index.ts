import { buildServer } from "./app.js";
import { loadConfig, toSafeConfig } from "./config.js";
import { attachRealtimeServer } from "./realtime.js";

const config = loadConfig();
const app = await buildServer({ config });

attachRealtimeServer(app.server, config);

const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

for (const signal of shutdownSignals) {
  process.on(signal, async () => {
    app.log.info({ signal }, "Shutting down Vibehall backend");
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({
    host: "0.0.0.0",
    port: config.port
  });

  app.log.info(
    {
      config: toSafeConfig(config),
      env: config.nodeEnv,
      port: config.port,
      realtimeNamespace: "/realtime"
    },
    "Vibehall backend runtime started"
  );
} catch (error) {
  app.log.error({ error }, "Vibehall backend failed to start");
  process.exit(1);
}
