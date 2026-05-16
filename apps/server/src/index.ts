import { startServer } from "@dunena/platform";

import { RedisAdapterServer } from "@dunena/redis-adapter";

const app = await startServer();

const redisEnabled = process.env.DUNENA_REDIS_ENABLED === "true" || process.env.DUNENA_REDIS_ENABLED === "1";
if (redisEnabled) {
  const port = parseInt(process.env.DUNENA_REDIS_PORT ?? "6379", 10);
  const host = process.env.DUNENA_REDIS_HOST ?? "0.0.0.0";
  const redisAdapter = new RedisAdapterServer(app.cacheService, { port, host });
  redisAdapter.start();
}
