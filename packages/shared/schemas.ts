import { z } from "@hono/zod-openapi";

export const ErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  })
  .openapi("ApiError");

export const HealthSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal("ok"),
    databaseConfigured: z.boolean(),
  })
  .openapi("Health");

export const MessageInputSchema = z
  .object({
    message: z.string().trim().min(1).max(200),
  })
  .openapi("MessageInput");

export const EchoSchema = z
  .object({
    ok: z.literal(true),
    data: MessageInputSchema,
  })
  .openapi("Echo");

export const CreateNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
  })
  .openapi("CreateNote");

export const NoteSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    createdAt: z.string(),
  })
  .openapi("Note");

export const NotesSchema = z.object({
  ok: z.literal(true),
  data: z.array(NoteSchema),
});
export const NoteResponseSchema = z.object({
  ok: z.literal(true),
  data: NoteSchema,
});
