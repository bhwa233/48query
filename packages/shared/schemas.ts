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

const QueryCoverageSchema = z.object({
  status: z.enum(["complete", "partial", "unavailable"]),
  earliestDate: z.string().nullable(),
  latestDate: z.string().nullable(),
  membersCovered: z.number().int().nonnegative(),
  totalMembers: z.number().int().nonnegative(),
  lastBatchCompletedAt: z.string().nullable(),
});

const QueryMessageSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  type: z.string(),
  text: z.string().nullable(),
  occurredAt: z.string(),
  senderName: z.string().nullable(),
  senderType: z.string().nullable(),
});

export const QueryOverviewSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    date: z.string(),
    totals: z.object({
      messages: z.number().int().nonnegative(),
      activeMembers: z.number().int().nonnegative(),
      recordings: z.number().int().nonnegative(),
      danmaku: z.number().int().nonnegative(),
    }),
    typeBreakdown: z.array(z.object({ type: z.string(), count: z.number().int().nonnegative() })),
    dailyActivity: z.array(z.object({ date: z.string(), count: z.number().int().nonnegative() })),
    ranking: z.array(z.object({
      memberId: z.string(), memberName: z.string(), groupName: z.string(), team: z.string().nullable(),
      messages: z.number().int().nonnegative(), activeDays: z.number().int().nonnegative(),
    })),
    recentMessages: z.array(QueryMessageSchema),
  }),
  coverage: QueryCoverageSchema,
});

export const QueryMemberSchema = z.object({
  id: z.string(), name: z.string(), pinyin: z.string().nullable(), groupName: z.string(), team: z.string().nullable(),
  messages: z.number().int().nonnegative(), activeDays: z.number().int().nonnegative(), recordings: z.number().int().nonnegative(), latestMessageAt: z.string().nullable(),
});

export const QueryMembersSchema = z.object({ ok: z.literal(true), data: z.array(QueryMemberSchema), coverage: QueryCoverageSchema });

export const QueryMemberDetailSchema = z.object({
  ok: z.literal(true),
  data: QueryMemberSchema.extend({ dailyActivity: z.array(z.object({ date: z.string(), count: z.number().int().nonnegative() })), recentMessages: z.array(QueryMessageSchema) }),
  coverage: QueryCoverageSchema,
});

export const QueryRecordingsSchema = z.object({
  ok: z.literal(true),
  data: z.array(z.object({
    id: z.string(), memberId: z.string(), memberName: z.string(), title: z.string().nullable(), occurredAt: z.string(),
    durationSeconds: z.number().int().nonnegative().nullable(), danmakuCount: z.number().int().nonnegative(), danmakuStatus: z.enum(["pending", "parsed", "failed"]),
  })),
  coverage: QueryCoverageSchema,
});

export const QueryMessageSearchSchema = z.object({ ok: z.literal(true), data: z.array(QueryMessageSchema), nextCursor: z.string().nullable(), coverage: QueryCoverageSchema });

const IngestMemberSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(100), pinyin: z.string().max(200).nullable().optional(),
  groupName: z.string().min(1).max(100), team: z.string().max(100).nullable().optional(), roomId: z.string().max(200).nullable().optional(),
  channelId: z.string().max(100).nullable().optional(), serverId: z.string().max(100).nullable().optional(), liveRoomId: z.string().max(100).nullable().optional(),
  status: z.enum(["active", "gone"]).default("active"),
});
const IngestMessageSchema = z.object({
  id: z.string().min(1).max(200), memberId: z.string().min(1).max(100), occurredAt: z.string().min(1).max(80), type: z.string().min(1).max(50),
  text: z.string().max(2000).nullable().optional(), senderId: z.string().max(200).nullable().optional(), senderName: z.string().max(200).nullable().optional(),
  senderType: z.string().max(50).nullable().optional(), sourceJson: z.string().max(2000).nullable().optional(),
});
const IngestRecordingSchema = z.object({
  id: z.string().min(1).max(200), memberId: z.string().min(1).max(100), title: z.string().max(500).nullable().optional(), occurredAt: z.string().min(1).max(80),
  durationSeconds: z.number().int().nonnegative().nullable().optional(), danmakuCount: z.number().int().nonnegative().default(0), danmakuStatus: z.enum(["pending", "parsed", "failed"]).default("pending"),
  sourceJson: z.string().max(2000).nullable().optional(),
});

export const QueryIngestUnitSchema = z.object({
  batchId: z.string().min(1).max(100), statDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startedAt: z.string().max(80),
  member: IngestMemberSchema, messages: z.array(IngestMessageSchema).max(25), recordings: z.array(IngestRecordingSchema).max(25),
  messageCursor: z.string().max(500).nullable().optional(), recordingCursor: z.string().max(500).nullable().optional(),
  totalMembers: z.number().int().nonnegative(), membersCovered: z.number().int().nonnegative(), errorCount: z.number().int().nonnegative().default(0),
});

export const QueryIngestResponseSchema = z.object({ ok: z.literal(true), data: z.object({ batchId: z.string(), memberId: z.string(), messagesWritten: z.number().int().nonnegative(), recordingsWritten: z.number().int().nonnegative() }) });
export const QuerySyncStateSchema = z.object({ ok: z.literal(true), data: z.object({ memberId: z.string(), messageCursor: z.string().nullable(), recordingCursor: z.string().nullable(), updatedAt: z.string(), lastError: z.string().nullable() }) });
