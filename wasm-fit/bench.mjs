// End-to-end benchmark of parseFitFile (frontend/parseFit.ts) over all fixtures.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parseFitFile } from "../frontend/parseFit.ts";

const fixturesDir = new URL("../test/fixtures/", import.meta.url);
const names = (await readdir(fileURLToPath(fixturesDir))).filter((n) => n.endsWith(".fit"));
const buffers = await Promise.all(
  names.map(async (n) => {
    const b = await readFile(new URL(n, fixturesDir));
    return { name: n, ab: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  })
);

// warm up
await parseFitFile(buffers[0].ab, buffers[0].name);

const t0 = performance.now();
for (const { ab, name } of buffers) {
  await parseFitFile(ab, name);
}
const t1 = performance.now();

console.log(`parseFitFile over ${buffers.length} fixtures: ${(t1 - t0).toFixed(0)} ms (${((t1 - t0) / buffers.length).toFixed(1)} ms/file)`);
