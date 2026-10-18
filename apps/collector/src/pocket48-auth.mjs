// @ts-nocheck
// oxlint-disable-file
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import init, { __x6c2adf8__ } from "../wasm/rust-wasm.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_DIR = process.env.POCKET48_CONFIG_DIR || path.join(process.env.APPDATA || process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "48query");
export const CREDENTIAL_PATH = process.env.POCKET48_CRED_PATH || path.join(CONFIG_DIR, "cred.json");
let wasmReady;

export async function loadCredential() {
  try { return JSON.parse(await readFile(CREDENTIAL_PATH, "utf8")); } catch { return null; }
}

export async function createPocket48Pa() {
  if (!wasmReady) {
    wasmReady = (async () => {
      const bytes = await readFile(path.join(ROOT, "wasm", "2.wasm"));
      await init({ module_or_path: bytes });
    })();
  }
  await wasmReady;
  return __x6c2adf8__();
}
