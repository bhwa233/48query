#!/usr/bin/env node
// @ts-nocheck
// oxlint-disable-file
/* Pocket48 手机号登录器。凭证只写入用户配置目录，不写入仓库。 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import init, { __x6c2adf8__ } from "../wasm/rust-wasm.js";

const API_BASE = "https://pocketapi.48.cn";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_DIR = process.env.POCKET48_CONFIG_DIR || path.join(process.env.APPDATA || process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "48query");
const CRED_PATH = process.env.POCKET48_CRED_PATH || path.join(CONFIG_DIR, "cred.json");
const DEVICE_PATH = process.env.POCKET48_DEVICE_PATH || path.join(CONFIG_DIR, "device-id");
const MOBILE_RE = /^1\d{10}$/;
let wasmReady;

async function ensureWasm() {
  if (!wasmReady) {
    wasmReady = (async () => {
      const bytes = await readFile(path.join(ROOT, "wasm", "2.wasm"));
      await init({ module_or_path: bytes });
    })();
  }
  await wasmReady;
}

function deviceId() {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const part = (size) => Array.from({ length: size }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${part(8)}-${part(4)}-${part(4)}-${part(4)}-${part(12)}`;
}

async function loadText(file) {
  try { return (await readFile(file, "utf8")).trim(); } catch { return ""; }
}

async function loadDeviceId() {
  const previous = await loadText(DEVICE_PATH);
  if (previous) return previous;
  const value = deviceId();
  await mkdir(path.dirname(DEVICE_PATH), { recursive: true });
  await writeFile(DEVICE_PATH, `${value}\n`, { mode: 0o600 });
  return value;
}

async function headers({ token = "", signed = false, device }) {
  const result = {
    "Content-Type": "application/json;charset=utf-8",
    "Accept-Language": "zh-Hans-AW;q=1",
    "User-Agent": "PocketFans201807/6.0.16 (iPhone; iOS 13.5.1; Scale/2.00)",
    appInfo: JSON.stringify({ vendor: "apple", deviceId: device, appVersion: "7.0.4", appBuild: "23011601", osVersion: "16.3.1", osType: "ios", deviceName: "iPhone XR", os: "ios" }),
  };
  if (token) result.token = token;
  if (token || signed) {
    await ensureWasm();
    result.pa = __x6c2adf8__();
  }
  return result;
}

async function post(pathname, body, requestHeaders) {
  const response = await fetch(`${API_BASE}${pathname}`, { method: "POST", headers: requestHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`接口返回非 JSON（HTTP ${response.status}）`); }
  if (response.status !== 200 || Number(data?.status) !== 200) throw new Error(data?.message || data?.msg || `请求失败（HTTP ${response.status}）`);
  return data.content;
}

async function saveCredential(credential) {
  await mkdir(path.dirname(CRED_PATH), { recursive: true });
  await writeFile(CRED_PATH, `${JSON.stringify(credential, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { await import("node:fs/promises").then(({ chmod }) => chmod(CRED_PATH, constants.S_IRUSR | constants.S_IWUSR)); } catch { /* Windows may not support POSIX mode bits. */ }
}

async function askInterface() {
  const rl = createInterface({ input: stdin, output: stdout });
  return { rl, ask: async (question) => (await rl.question(question)).trim() };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    await ensureWasm();
    const signature = __x6c2adf8__();
    console.log(JSON.stringify({ wasmLoaded: true, signatureLength: signature.length, credentialPath: CRED_PATH }));
    return;
  }
  const codeIndex = args.indexOf("--code");
  const sendOnly = args.includes("--send");
  const presetMobile = codeIndex >= 0 ? args[codeIndex + 1] : args.find((item) => MOBILE_RE.test(item));
  const presetCode = codeIndex >= 0 ? args[codeIndex + 2] : "";
  const device = await loadDeviceId();
  const { rl, ask } = await askInterface();
  try {
    const mobile = presetMobile || await ask("手机号（不含 +86）: ");
    if (!MOBILE_RE.test(mobile)) throw new Error("手机号格式不正确");
    const send = async () => post("/user/api/v1/sms/send2", { mobile, area: "86" }, await headers({ signed: false, device }));
    if (sendOnly) {
      await send();
      console.log("验证码已发送。收到后执行：pnpm --filter @starter/collector login -- --code <手机号> <验证码>");
      return;
    }
    const code = presetCode || (await send(), await ask("短信验证码: "));
    if (!/^\d{4,8}$/.test(code)) throw new Error("验证码格式不正确");
    const login = await post("/user/api/v1/login/app/mobile/code", { mobile, code }, await headers({ signed: true, device }));
    const token = String(login?.token || login?.userInfo?.token || "").trim();
    if (!token) throw new Error("登录成功但响应中没有 token");
    const im = await post("/im/api/v1/im/userinfo", {}, await headers({ token, device }));
    await saveCredential({ token, accid: im?.accid ?? null, pwd: im?.pwd ?? null, userId: im?.userId ?? null, nickname: login?.userInfo?.nickname ?? null, deviceId: device, createdAt: new Date().toISOString() });
    console.log(`登录成功，凭证已保存到 ${CRED_PATH}`);
    console.log("不会在终端输出 token。下一步可用该凭证运行单成员真实探测。");
  } finally {
    rl.close();
  }
}

main().catch((error) => { console.error(`[登录失败] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
