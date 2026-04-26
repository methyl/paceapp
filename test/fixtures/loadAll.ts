import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../../frontend/parseFit";
import type { ParsedActivity } from "../../frontend/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = __dirname;

let cached: Promise<ParsedActivity[]> | null = null;

/**
 * Parses every .fit fixture once per test-file process. Subsequent calls
 * return the same cached promise, so suites that share the full corpus
 * (tsb, fitness) don't re-parse 138 files per test.
 */
export function loadAllFixtures(): Promise<ParsedActivity[]> {
  if (cached) return cached;
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".fit"));
  cached = Promise.all(
    files.map(async (name) => {
      const buf = readFileSync(join(FIXTURES, name));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return parseFitFile(ab, name);
    })
  );
  return cached;
}
