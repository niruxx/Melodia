/**
 * Removes broken entries from Tauri's compressed-frontend cache.
 *
 * `src-tauri/target/<profile>/build/melodia-*\/out/tauri-codegen-assets/` holds
 * the brotli-compressed frontend, one file per asset, named after the hash of
 * that asset's *source* content. Tauri looks an entry up by that hash and, if a
 * file is already there, embeds it without checking that it is intact.
 *
 * A build interrupted mid-write (Ctrl+C, an antivirus or indexer holding the
 * file) can leave a zero-byte entry behind. Every later build then embeds an
 * empty asset and reports success, and the app launches to
 * `asset not found: index.html` with no UI to fix it from. `cargo clean` does
 * not help: this cache lives in the build script's OUT_DIR and survives it.
 *
 * So this runs before every bundle and drops any entry that is empty, which
 * makes the next build regenerate it. Deleting only the broken entries keeps
 * the cache doing its job — a full rebuild of it costs seconds on every build.
 *
 *   node scripts/clean-asset-cache.js         drop zero-byte entries
 *   node scripts/clean-asset-cache.js --all   drop the whole cache
 *
 * Never fails the build: a cache that can't be read is the next build's
 * problem, not a reason to stop this one.
 */

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_DIR_NAME = "tauri-codegen-assets";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = join(repoRoot, "src-tauri", "target");

const dropEverything = process.argv.includes("--all");

/** Every `…/build/<crate>-<hash>/out/tauri-codegen-assets` under target/. */
function findCaches() {
  const found = [];
  if (!existsSync(targetDir)) return found;

  for (const profile of readdirSync(targetDir)) {
    const buildDir = join(targetDir, profile, "build");
    if (!existsSync(buildDir)) continue;
    for (const crate of readdirSync(buildDir)) {
      const cache = join(buildDir, crate, "out", CACHE_DIR_NAME);
      if (existsSync(cache)) found.push(cache);
    }
  }
  return found;
}

let removed = 0;
let caches = 0;

for (const cache of findCaches()) {
  caches++;
  try {
    if (dropEverything) {
      rmSync(cache, { recursive: true, force: true });
      removed++;
      continue;
    }
    for (const entry of readdirSync(cache)) {
      const file = join(cache, entry);
      if (statSync(file).size === 0) {
        rmSync(file, { force: true });
        removed++;
        console.log(`  removed empty asset cache entry: ${entry}`);
      }
    }
  } catch (e) {
    // Locked or vanished mid-scan. Say so and carry on.
    console.warn(`  couldn't clean ${cache}: ${e.message}`);
  }
}

if (dropEverything) {
  console.log(`asset cache: cleared ${removed} of ${caches} cache director${caches === 1 ? "y" : "ies"}`);
} else if (removed > 0) {
  console.log(`asset cache: dropped ${removed} broken entr${removed === 1 ? "y" : "ies"} — they will be rebuilt`);
}
