#!/usr/bin/env bun
/**
 * scripts/update-changelog.ts
 *
 * Finalises the [Unreleased] section in CHANGELOG.md for the current version.
 *
 * Usage:
 *   bun run scripts/update-changelog.ts [--dry-run]
 *
 * Flags:
 *   --dry-run  Print the updated changelog without modifying the file.
 */

import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");
const ROOT_PKG_PATH = join(ROOT, "package.json");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  // Read current version from root package.json
  const rootPkg = JSON.parse(await Bun.file(ROOT_PKG_PATH).text()) as {
    version: string;
  };
  const version = rootPkg.version;

  // Build the release date string (YYYY-MM-DD) in the local timezone
  const today = new Date().toLocaleDateString("en-CA");

  // Read the changelog
  const original = await Bun.file(CHANGELOG_PATH).text();

  // Locate the [Unreleased] heading (case-insensitive, flexible whitespace)
  const unreleasedRe = /^## \[Unreleased\][^\n]*\n/im;
  const match = unreleasedRe.exec(original);

  if (!match) {
    console.error("Error: Could not find an [Unreleased] section in CHANGELOG.md");
    process.exit(1);
  }

  const unreleasedHeadingEnd = match.index + match[0].length;

  // Find where the next ## section starts (i.e., end of [Unreleased] content)
  const nextSectionRe = /^## \[/im;
  // Search only after the [Unreleased] heading
  const afterUnreleased = original.slice(unreleasedHeadingEnd);
  const nextMatch = nextSectionRe.exec(afterUnreleased);

  const unreleasedBody = nextMatch
    ? afterUnreleased.slice(0, nextMatch.index)
    : afterUnreleased;

  // Everything before the [Unreleased] heading (preamble)
  const preamble = original.slice(0, match.index);

  // Everything from the next ## heading onwards (older releases)
  const olderReleases = nextMatch
    ? afterUnreleased.slice(nextMatch.index)
    : "";

  // Build the new changelog
  const newUnreleased = `## [Unreleased]\n\n`;
  const newRelease = `## [${version}] - ${today}\n${unreleasedBody}`;

  const updated = preamble + newUnreleased + newRelease + olderReleases;

  if (dryRun) {
    console.log("[dry-run] Updated CHANGELOG.md would be:\n");
    console.log(updated);
    return;
  }

  await Bun.write(CHANGELOG_PATH, updated);
  console.log(`✓ CHANGELOG.md updated — moved [Unreleased] to [${version}] - ${today}`);
}

main().catch((err) => {
  console.error(`\nFatal: ${(err as Error).message}`);
  process.exit(1);
});
