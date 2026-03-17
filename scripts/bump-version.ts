#!/usr/bin/env bun
/**
 * scripts/bump-version.ts
 *
 * Bumps the version across all workspace package.json files.
 *
 * Usage:
 *   bun run scripts/bump-version.ts <major|minor|patch|x.y.z> [--dry-run] [--no-commit] [--no-tag]
 *
 * Flags:
 *   --dry-run    Print what would change without modifying any files.
 *   --no-commit  Skip creating the git commit.
 *   --no-tag     Skip creating the git tag.
 */

import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

const WORKSPACE_PACKAGE_JSONS = [
  join(ROOT, "package.json"),
  join(ROOT, "apps", "server", "package.json"),
  join(ROOT, "apps", "cli", "package.json"),
  join(ROOT, "packages", "platform", "package.json"),
  join(ROOT, "packages", "dunena", "package.json"),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseVersion(v: string): [number, number, number] {
  const parts = v.split(".").map(Number);
  if (parts.length !== 3 || parts.some((p) => isNaN(p) || p < 0)) {
    throw new Error(`Invalid semver: "${v}"`);
  }
  return [parts[0], parts[1], parts[2]];
}

function bumpVersion(
  current: string,
  bump: "major" | "minor" | "patch" | string
): string {
  const [major, minor, patch] = parseVersion(current);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  // explicit version — validate it
  parseVersion(bump);
  return bump;
}

async function readJSON(path: string): Promise<Record<string, unknown>> {
  const text = await Bun.file(path).text();
  return JSON.parse(text) as Record<string, unknown>;
}

async function writeJSON(
  path: string,
  data: Record<string, unknown>,
  dryRun: boolean
): Promise<void> {
  const text = JSON.stringify(data, null, 2) + "\n";
  if (dryRun) {
    console.log(`  [dry-run] Would write: ${path}`);
    console.log(`            version → "${data.version}"`);
  } else {
    await Bun.write(path, text);
    console.log(`  Updated: ${path} → ${data.version}`);
  }
}

async function runCommand(
  cmd: string[],
  dryRun: boolean,
  description: string
): Promise<void> {
  if (dryRun) {
    console.log(`  [dry-run] Would run: ${cmd.join(" ")}`);
    return;
  }
  console.log(`  Running: ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${description} failed with exit code ${code}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const dryRun = args.includes("--dry-run");
  const noCommit = args.includes("--no-commit");
  const noTag = args.includes("--no-tag");

  const positional = args.filter((a) => !a.startsWith("--"));

  if (positional.length === 0) {
    console.error(
      "Usage: bun run scripts/bump-version.ts <major|minor|patch|x.y.z> [--dry-run] [--no-commit] [--no-tag]"
    );
    process.exit(1);
  }

  const bump = positional[0];
  const validBumps = ["major", "minor", "patch"];

  if (!validBumps.includes(bump)) {
    // Treat as explicit version — validate format
    try {
      parseVersion(bump);
    } catch {
      console.error(
        `Error: "${bump}" is not a valid bump type (major, minor, patch) or semver version (x.y.z).`
      );
      process.exit(1);
    }
  }

  // Read current version from root package.json
  const rootPkg = await readJSON(WORKSPACE_PACKAGE_JSONS[0]);
  const currentVersion = rootPkg.version as string;
  let newVersion: string;

  try {
    newVersion = bumpVersion(currentVersion, bump);
  } catch (err) {
    console.error(`Error computing new version: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(
    `\nBumping version: ${currentVersion} → ${newVersion}${dryRun ? " (dry-run)" : ""}\n`
  );

  // Update all package.json files
  for (const pkgPath of WORKSPACE_PACKAGE_JSONS) {
    const pkg = await readJSON(pkgPath);
    pkg.version = newVersion;
    await writeJSON(pkgPath, pkg, dryRun);
  }

  // Update bun.lock
  await runCommand(["bun", "install"], dryRun, "bun install");

  if (!noCommit) {
    await runCommand(
      ["git", "add", ...WORKSPACE_PACKAGE_JSONS.map((p) => relative(ROOT, p)), "bun.lock"],
      dryRun,
      "git add"
    );
    await runCommand(
      ["git", "commit", "-m", `chore: bump version to ${newVersion}`],
      dryRun,
      "git commit"
    );
  }

  if (!noTag) {
    await runCommand(
      ["git", "tag", `v${newVersion}`],
      dryRun,
      "git tag"
    );
  }

  console.log(`\n✓ Version bumped to ${newVersion}${dryRun ? " (dry-run — no files were modified)" : ""}`);

  if (!dryRun && !noCommit) {
    console.log(`\nTo push the commit and tag, run:`);
    console.log(`  git push --follow-tags`);
  }
}

main().catch((err) => {
  console.error(`\nFatal: ${(err as Error).message}`);
  process.exit(1);
});
