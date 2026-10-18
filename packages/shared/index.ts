export const API_PATHS = {
  health: "/api/health",
  echo: "/api/echo",
  notes: "/api/notes",
  docs: "/docs",
  openapi: "/openapi.json",
} as const;

import type { z } from "zod";
import type {
  ErrorSchema,
  HealthSchema,
  NoteSchema,
  NotesSchema,
  NoteResponseSchema,
  EchoSchema,
} from "./schemas";

export type ApiErrorResponse = z.infer<typeof ErrorSchema>;
export type HealthResponse = z.infer<typeof HealthSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type NotesResponse = z.infer<typeof NotesSchema>;
export type NoteResponse = z.infer<typeof NoteResponseSchema>;
export type EchoResponse = z.infer<typeof EchoSchema>;
