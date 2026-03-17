import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";

const rootDir = join(import.meta.dir, "..");
const targets = process.argv.slice(2);

async function clean() {
  for (const target of targets) {
    if (target.includes("*")) {
      const glob = new Glob(target);
      for await (const file of glob.scan({ cwd: rootDir })) {
        await rm(join(rootDir, file), { recursive: true, force: true });
      }
    } else {
      await rm(join(rootDir, target), { recursive: true, force: true });
    }
  }
}

clean().catch((err) => {
  console.error("Clean error:", err);
  process.exit(1);
});
