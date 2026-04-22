// Data migration: recompute `activities.meta` for every row that's missing it.
// Invoked from deploy.yml right after D1 migrations apply, so a freshly added
// ActivityMeta field gets backfilled for existing rows in the same deploy.
//
// Shells out to wrangler for D1 and R2 access — the CI environment already
// authenticates wrangler via CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveMeta, META_VERSION } from "../workers/src/meta";

const DB = "paceapp";
const BUCKET = "paceapp-fit";

function wrangler(args: string[]): string {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function query<T>(sql: string): T[] {
  const out = wrangler(["d1", "execute", DB, "--remote", "--json", "--command", sql]);
  const parsed = JSON.parse(out) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}

function fetchR2(key: string, dest: string): void {
  wrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--file", dest, "--remote"]);
}

const rows = query<{ id: string; json_r2_key: string }>(
  `SELECT id, json_r2_key FROM activities
   WHERE meta IS NULL OR meta = '' OR meta = '{}'
      OR COALESCE(CAST(json_extract(meta, '$.version') AS INTEGER), 0) < ${META_VERSION}`,
);

if (rows.length === 0) {
  console.log("backfill: nothing to do");
  process.exit(0);
}

console.log(`backfill: ${rows.length} activities need meta`);

const tmp = mkdtempSync(join(tmpdir(), "backfill-"));
const updates: string[] = [];
let skipped = 0;

for (const r of rows) {
  const dest = join(tmp, "activity.json");
  try {
    fetchR2(r.json_r2_key, dest);
    const full = JSON.parse(readFileSync(dest, "utf8"));
    const meta = deriveMeta(full);
    const metaJson = JSON.stringify(meta).replace(/'/g, "''");
    // Row ids are UUIDs we generated, so inlining is safe here.
    updates.push(`UPDATE activities SET meta = '${metaJson}' WHERE id = '${r.id}';`);
  } catch (e) {
    skipped++;
    console.warn(`backfill: skipped ${r.id}: ${(e as Error).message}`);
  }
}

if (updates.length > 0) {
  const sqlFile = join(tmp, "updates.sql");
  writeFileSync(sqlFile, updates.join("\n"));
  wrangler(["d1", "execute", DB, "--remote", "--file", sqlFile]);
}

rmSync(tmp, { recursive: true, force: true });

console.log(`backfill: updated ${updates.length}, skipped ${skipped}`);
