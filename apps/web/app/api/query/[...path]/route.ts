import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

function failure(code: string, message: string, status: number, headers?: Record<string, string>) {
  return Response.json({ ok: false, error: { code, message } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

// The existing API owns validation and data access. Only its public query
// endpoints cross this binding; client credentials and ingestion never do.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!/^\/api\/query\/(?:overview|rankings|members(?:\/[A-Za-z0-9_-]{1,100})?|messages|message-pages|image-pages|content-summary|activity|melee|recordings)$/.test(url.pathname))
    return failure("not_found", "Query endpoint not found.", 404);
  if (!env.QUERY_API) return failure("api_unavailable", "Query API is not configured.", 503);
  const target = new URL(`${url.pathname}${url.search}`, "https://query.internal");
  try {
    const response = await env.QUERY_API.fetch(target.href, {
      method: request.method,
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
    // A disconnected local service returns plain text rather than throwing.
    // Keep that infrastructure response within the public JSON error contract.
    if (!response.headers.get("Content-Type")?.includes("application/json")) {
      await response.body?.cancel();
      return failure("api_unavailable", "Query API is temporarily unavailable.", 503);
    }
    return response;
  } catch {
    return failure("api_unavailable", "Query API is temporarily unavailable.", 503);
  }
}

function methodNotAllowed() {
  return failure("method_not_allowed", "Only read-only queries are available.", 405, { Allow: "GET, HEAD" });
}

export { GET as HEAD, methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE, methodNotAllowed as OPTIONS };
