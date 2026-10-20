import { loadCredential } from "./pocket48-auth.mjs";

export async function loadProductionCredential() {
  const endpoint = process.env.COLLECTOR_CREDENTIALS_URL?.trim();
  const readToken = process.env.COLLECTOR_CREDENTIAL_READ_TOKEN?.trim();
  if (!endpoint && !readToken) return loadCredential();
  if (!endpoint || !readToken) throw new Error("Collector credential endpoint and read token must be configured together.");
  let response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${readToken}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Unable to reach the collector credential endpoint.");
  }
  if (!response.ok) throw new Error(`Collector credential endpoint returned HTTP ${response.status}.`);
  const payload: unknown = await response.json().catch(() => null) as unknown;
  const payloadRecord = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const data = payloadRecord?.data && typeof payloadRecord.data === "object"
    ? payloadRecord.data as Record<string, unknown>
    : null;
  const token = typeof data?.token === "string" ? data.token.trim() : "";
  const deviceId = typeof data?.deviceId === "string" ? data.deviceId.trim() : "";
  if (!token || !deviceId) throw new Error("Collector credential endpoint returned an invalid credential.");
  return { token, deviceId };
}
