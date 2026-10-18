import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { drizzle } from "drizzle-orm/d1";
import { desc } from "drizzle-orm";
import {
  CreateNoteSchema,
  NotesSchema,
  NoteResponseSchema,
  ErrorSchema,
} from "@starter/shared/schemas";
import type { AppEnv } from "../env";
import { notes } from "./schema";

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
app.use("*", async (c, next) => {
  if (!c.env.APP_DB)
    return c.json(
      {
        ok: false,
        error: {
          code: "database_not_configured",
          message: "Enable the D1 profile to use notes.",
        },
      },
      503,
    );
  c.header("Cache-Control", "no-store");
  await next();
});
// Drizzle wraps driver failures, so inspect the cause chain for missing migrations.
app.onError((error, c) => {
  let cause: unknown = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    if (/no such table/i.test(cause.message)) {
      return c.json(
        {
          ok: false,
          error: {
            code: "database_not_initialized",
            message: "Apply D1 migrations before using notes.",
          },
        },
        503,
      );
    }
    cause = cause.cause;
  }
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

function database(env: AppEnv["Bindings"]) {
  if (!env.APP_DB) throw new Error("APP_DB binding is missing");
  return drizzle(env.APP_DB);
}
const unavailable = {
  description: "D1 profile is not configured.",
  content: { "application/json": { schema: ErrorSchema } },
};
app.openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: {
      200: {
        description: "Latest notes.",
        content: { "application/json": { schema: NotesSchema } },
      },
      503: unavailable,
    },
  }),
  async (c) => {
    const data = await database(c.env)
      .select()
      .from(notes)
      .orderBy(desc(notes.createdAt))
      .limit(50);
    return c.json({ ok: true as const, data }, 200);
  },
);
app.openapi(
  createRoute({
    method: "post",
    path: "/",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: CreateNoteSchema } },
      },
    },
    responses: {
      201: {
        description: "Created note.",
        content: { "application/json": { schema: NoteResponseSchema } },
      },
      400: {
        description: "Invalid input.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      503: unavailable,
    },
  }),
  async (c) => {
    const data = {
      id: crypto.randomUUID(),
      title: c.req.valid("json").title,
      createdAt: new Date().toISOString(),
    };
    await database(c.env).insert(notes).values(data);
    return c.json({ ok: true as const, data }, 201);
  },
);
export default app;
