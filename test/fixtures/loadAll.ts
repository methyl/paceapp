import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../../frontend/parseFit";
import type { ParsedActivity } from "../../frontend/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = __dirname;

let allFiles: string[] | null = null;
function listFitFiles(): string[] {
  if (!allFiles) allFiles = readdirSync(FIXTURES).filter((f) => f.endsWith(".fit"));
  return allFiles;
}

export function readFixture(pattern: string): ArrayBuffer {
  const name = listFitFiles().find((f) => f.includes(pattern));
  if (!name) throw new Error(`No fixture matching ${pattern}`);
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const parseCache = new Map<string, Promise<ParsedActivity>>();

/**
 * Parses a fixture matching `pattern` once per test-file process. Subsequent
 * calls return the cached promise — tests that check different facets of the
 * same activity don't re-pay the FIT decode cost. The returned activity must
 * be treated as read-only; clone (e.g. `JSON.parse(JSON.stringify(a))`) before
 * mutating.
 */
export function parseFixture(pattern: string): Promise<ParsedActivity> {
  let p = parseCache.get(pattern);
  if (!p) {
    p = parseFitFile(readFixture(pattern), pattern);
    parseCache.set(pattern, p);
  }
  return p;
}

let cachedAll: Promise<ParsedActivity[]> | null = null;

/**
 * Parses every .fit fixture once per test-file process.
 */
export function loadAllFixtures(): Promise<ParsedActivity[]> {
  if (cachedAll) return cachedAll;
  cachedAll = Promise.all(
    listFitFiles().map(async (name) => {
      const buf = readFileSync(join(FIXTURES, name));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return parseFitFile(ab, name);
    })
  );
  return cachedAll;
}
