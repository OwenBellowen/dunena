import { createApp } from "./server/app";
import { config } from "./utils/config";

export async function startServer() {
  return await createApp(config);
}

export type { CacheService } from "./services/cache-service";
