#!/usr/bin/env bun
/**
 * scripts/release.ts
 *
 * Full release preparation sequence.
 *
 * Usage:
 *   bun run scripts/release.ts <major|minor|patch|x.y.z> [--dry-run]
 *
 * Steps:
 *   1. bun run check       — type checking
 *   2. bun run test:all    — full test suite
 *   3. Version bump        — updates all package.json files + bun.lock
 *   4. Changelog update    — moves [Unreleased] → versioned section
 *   5. Git commit + tag    — single commit containing all release changes
 *   6. Print push reminder
 *
 * Flags:
 *   --dry-run  Print every step and its effects without running or modifying anything.
 */

import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runStep(
  label: string,
  cmd: string[],
  dryRun: boolean
): Promise<void> {
  console.log(`\n▶ ${label}`);
  if (dryRun) {
    console.log(`  [dry-run] Would run: ${cmd.join(" ")}`);
    return;
  }
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Step "${label}" failed with exit code ${code}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => !a.startsWith("--"));

  if (positional.length === 0) {
    console.error(
      "Usage: bun run scripts/release.ts <major|minor|patch|x.y.z> [--dry-run]"
    );
    process.exit(1);
  }

  const bump = positional[0];
  console.log(
    `\n🚀 Release preparation — bump: ${bump}${dryRun ? " (dry-run)" : ""}`
  );

  // Step 1 — type checking
  await runStep("Type check", ["bun", "run", "check"], dryRun);

  // Step 2 — test suite
  await runStep("Test suite", ["bun", "run", "test:all"], dryRun);

  // Step 3 — version bump (--no-commit --no-tag because we commit everything together below)
  await runStep(
    `Bump version (${bump})`,
    [
      "bun",
      "run",
      "scripts/bump-version.ts",
      bump,
      "--no-commit",
      "--no-tag",
      ...(dryRun ? ["--dry-run"] : []),
    ],
    false // always run the sub-script; it handles --dry-run internally
  );

  // Step 4 — changelog update
  await runStep(
    "Update changelog",
    [
      "bun",
      "run",
      "scripts/update-changelog.ts",
      ...(dryRun ? ["--dry-run"] : []),
    ],
    false // same as above
  );

  if (!dryRun) {
    // Read the new version so we can use it for the commit/tag messages
    const rootPkg = JSON.parse(
      await Bun.file(join(ROOT, "package.json")).text()
    ) as { version: string };
    const newVersion = rootPkg.version;

    // Step 5a — stage all changed files
    await runStep("Stage release files", [
      "git",
      "add",
      "package.json",
      "apps/server/package.json",
      "apps/cli/package.json",
      "packages/platform/package.json",
      "packages/dunena/package.json",
      "bun.lock",
      "CHANGELOG.md",
    ], dryRun);

    // Step 5b — commit
    await runStep(
      "Git commit",
      ["git", "commit", "-m", `chore: release v${newVersion}`],
      dryRun
    );

    // Step 5c — tag
    await runStep(
      "Git tag",
      ["git", "tag", `v${newVersion}`],
      dryRun
    );

    console.log(`\n✅ Release v${newVersion} prepared successfully!`);
    console.log(`\nTo publish, run:`);
    console.log(`  git push --follow-tags`);
  } else {
    console.log(`\n✅ Dry-run complete — no files were modified.`);
    console.log(`\nTo execute the real release, run:`);
    console.log(`  bun run scripts/release.ts ${bump}`);
  }
}

main().catch((err) => {
  console.error(`\nFatal: ${(err as Error).message}`);
  process.exit(1);
});
