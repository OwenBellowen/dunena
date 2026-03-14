import { createApp } from "./server/app";
import { config } from "./utils/config";

export function startServer() {
  return createApp(config);
}
