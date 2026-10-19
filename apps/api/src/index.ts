import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import {
  HealthSchema,
  EchoSchema,
  MessageInputSchema,
  ErrorSchema,
} from "@starter/shared/schemas";
import type { AppEnv } from "./env";
import notes from "./notes";
import { parseCorsOrigins } from "@starter/shared/config";
import query from "./query";

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success)
      return c.json(
        {
          ok: false as const,
          error: {
            code: "invalid_request",
            message: "Request validation failed.",
          },
        },
        400,
      );
  },
});
app.use("*", secureHeaders());
app.use(
  "/api/*",
  cors({
    origin: (origin, c: Context<AppEnv>) =>
      parseCorsOrigins(c.env.CORS_ORIGINS).includes(origin)
        ? origin
        : "",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);
app.use("/api/*", bodyLimit({
  maxSize: 131_072,
  onError: c => c.json({ ok: false, error: { code: "body_too_large", message: "Request body is too large." } }, 413),
}));
const normalBodyLimit = bodyLimit({
  maxSize: 16_384,
  onError: c => c.json({ ok: false, error: { code: "body_too_large", message: "Request body is too large." } }, 413),
});
for (const path of ["/api/echo", "/api/notes/*", "/api/query/ingest/images/*", "/api/query/ingest/batches/*"]) app.use(path, normalBodyLimit);
app.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json(
      { ok: false, error: { code: "http_error", message: error.message } },
      error.status,
    );
  console.error(error);
  return c.json(
    {
      ok: false,
      error: { code: "internal_error", message: "Unexpected server error." },
    },
    500,
  );
});
app.notFound((c) =>
  c.json(
    { ok: false, error: { code: "not_found", message: "Endpoint not found." } },
    404,
  ),
);
app.openapi(
  createRoute({
    method: "get",
    path: "/api/health",
    responses: {
      200: {
        description: "Worker health; does not access D1.",
        content: { "application/json": { schema: HealthSchema } },
      },
    },
  }),
  (c) =>
    c.json(
      {
        ok: true as const,
        status: "ok" as const,
        databaseConfigured: Boolean(c.env.APP_DB),
      },
      200,
    ),
);
app.openapi(
  createRoute({
    method: "post",
    path: "/api/echo",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: MessageInputSchema } },
      },
    },
    responses: {
      200: {
        description: "Validated message.",
        content: { "application/json": { schema: EchoSchema } },
      },
      400: {
        description: "Invalid input.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  }),
  (c) => c.json({ ok: true as const, data: c.req.valid("json") }, 200),
);
app.route("/api/notes", notes);
app.route("/api/query", query);
app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: { title: "48query API", version: "0.1.0" },
});
app.get("/docs", apiReference({ url: "/openapi.json" }));
export default app;
