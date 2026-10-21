export const API_PATHS = {
  health: "/api/health",
  echo: "/api/echo",
  notes: "/api/notes",
  docs: "/docs",
  openapi: "/openapi.json",
  queryOverview: "/api/query/overview",
  queryRankings: "/api/query/rankings",
  queryMembers: "/api/query/members",
  queryMessages: "/api/query/messages",
  queryRecordings: "/api/query/recordings",
} as const;

import type { z } from "zod";
import type {
  ErrorSchema,
  HealthSchema,
  NoteSchema,
  NotesSchema,
  NoteResponseSchema,
  EchoSchema,
  QueryOverviewSchema,
  QueryRankingsSchema, FollowerSnapshotSchema, MeleePeriodSchema, MeleeEntrySchema, MeleeProgressSchema, MeleePageSchema, QueryMeleeSchema,
  QueryMessageSchema, QueryMembersSchema, QueryMemberDetailSchema, QueryMessageSearchSchema, ImageAttachmentSchema, VideoAttachmentSchema, CollectionSourceSchema, SourceSyncSchema, CatalogEntrySchema, CollectorProgressSchema, CollectorRunSchema,
} from "./schemas";

export type ApiErrorResponse = z.infer<typeof ErrorSchema>;
export type HealthResponse = z.infer<typeof HealthSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type NotesResponse = z.infer<typeof NotesSchema>;
export type NoteResponse = z.infer<typeof NoteResponseSchema>;
export type EchoResponse = z.infer<typeof EchoSchema>;
export type QueryOverview = z.infer<typeof QueryOverviewSchema>;
export type QueryRankings = z.infer<typeof QueryRankingsSchema>;
export type FollowerSnapshot = z.infer<typeof FollowerSnapshotSchema>;
export type MeleePeriod = z.infer<typeof MeleePeriodSchema>;
export type MeleeEntry = z.infer<typeof MeleeEntrySchema>;
export type MeleeProgress = z.infer<typeof MeleeProgressSchema>;
export type MeleePage = z.infer<typeof MeleePageSchema>;
export type QueryMelee = z.infer<typeof QueryMeleeSchema>;
export type ArchiveMessage = z.infer<typeof QueryMessageSchema>;
export type ArchiveMembers = z.infer<typeof QueryMembersSchema>;
export type ArchiveMemberDetail = z.infer<typeof QueryMemberDetailSchema>;
export type ArchiveMessages = z.infer<typeof QueryMessageSearchSchema>;
export type ImageAttachment = z.infer<typeof ImageAttachmentSchema>;
export type VideoAttachment = z.infer<typeof VideoAttachmentSchema>;
export type CollectionSource = z.infer<typeof CollectionSourceSchema>;
export type SourceSync = z.infer<typeof SourceSyncSchema>;
export type CollectorProgress = z.infer<typeof CollectorProgressSchema>;
export type CollectorRun = z.infer<typeof CollectorRunSchema>;

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
