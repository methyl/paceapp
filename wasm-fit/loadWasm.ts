// Loader that works in both Vite (browser) and Vitest (Node).
// In the browser, wasm-bindgen's web target resolves the .wasm sibling via
// `new URL(..., import.meta.url)` and fetches it; Vite handles the asset.
// Native Node fetch can't read file:// URLs, so we read bytes from disk
// directly under Node and hand them to init().
import init, { parse_fit as wasmParseFit } from "./pkg/wasm_fit.js";

export interface WasmSession {
  start_time?: string;
  total_distance?: number;
  total_timer_time?: number;
  total_elapsed_time?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  avg_cadence?: number;
  avg_speed?: number;
  enhanced_avg_speed?: number;
  sport?: string;
  avg_vertical_oscillation?: number;
  avg_stance_time?: number;
  avg_step_length?: number;
  avg_vertical_ratio?: number;
  avg_power?: number;
}

export interface WasmLap {
  start_time?: string;
  total_distance?: number;
  total_timer_time?: number;
  total_elapsed_time?: number;
  avg_speed?: number;
  enhanced_avg_speed?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  avg_cadence?: number;
  avg_vertical_oscillation?: number;
  avg_stance_time?: number;
  avg_stance_time_balance?: number;
  avg_step_length?: number;
  avg_vertical_ratio?: number;
  avg_power?: number;
}

export interface WasmRecord {
  timestamp?: string;
  elapsed_time: number;
  distance: number;
  position_lat?: number;
  position_long?: number;
  altitude?: number;
  enhanced_altitude?: number;
  heart_rate?: number;
  cadence?: number;
  speed?: number;
  enhanced_speed?: number;
  vertical_oscillation?: number;
  stance_time?: number;
  stance_time_balance?: number;
  step_length?: number;
  vertical_ratio?: number;
  power?: number;
  lap_index: number;
}

export interface WasmFitResult {
  session: WasmSession | null;
  laps: WasmLap[];
  records: WasmRecord[];
  /**
   * Mirror of every FIT message keyed by `<camelCaseName>Mesgs`, with
   * camelCase field names, Date objects for timestamps, and enum values
   * camelCased — matching @garmin/fitsdk Decoder output so the same
   * structure can be fed back into its Encoder for re-export.
   */
  rawMessages: Record<string, unknown[]>;
}

let initPromise: Promise<void> | null = null;

interface NodeProcess { versions?: { node?: string } }
interface NodeFs { readFile(p: string): Promise<{ buffer: ArrayBuffer; byteOffset: number; byteLength: number }> }
interface NodeUrl { fileURLToPath(u: URL | string): string }

function nodeProcess(): NodeProcess | undefined {
  return (globalThis as { process?: NodeProcess }).process;
}

function isNode(): boolean {
  return !!nodeProcess()?.versions?.node;
}

async function initOnce(): Promise<void> {
  if (isNode()) {
    // Native fetch in Node can't read file:// URLs, so we read bytes from
    // disk and hand them to init(). The `node:` module specifiers are kept
    // in string variables so the tsconfig (which doesn't include `@types/node`
    // for the frontend build) doesn't try to resolve them at type-check time.
    const fsMod = "node:fs/promises";
    const urlMod = "node:url";
    const fs = (await import(/* @vite-ignore */ fsMod)) as unknown as NodeFs;
    const url = (await import(/* @vite-ignore */ urlMod)) as unknown as NodeUrl;
    const path = url.fileURLToPath(new URL("./pkg/wasm_fit_bg.wasm", import.meta.url));
    const buf = await fs.readFile(path);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    await init({ module_or_path: bytes });
  } else {
    const wasmUrl = new URL("./pkg/wasm_fit_bg.wasm", import.meta.url);
    await init({ module_or_path: wasmUrl });
  }
}

export function ensureWasm(): Promise<void> {
  if (!initPromise) initPromise = initOnce();
  return initPromise;
}

export async function parseFitWasm(bytes: Uint8Array): Promise<WasmFitResult> {
  await ensureWasm();
  return wasmParseFit(bytes) as WasmFitResult;
}
