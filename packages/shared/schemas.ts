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

export const CollectionSourceSchema = z.enum(["room", "album", "essence", "posts", "post_images", "weibo", "room_posts"]);
const ImageUrlSchema = z.string().url().max(2000).refine(value => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "Expected an HTTP(S) image URL without credentials.");
export const ImageAttachmentSchema = z.object({
  id: z.string().min(1).max(100), sourceUrl: ImageUrlSchema,
  galleryUrl: ImageUrlSchema.nullable().optional(), thumbnailUrl: ImageUrlSchema.nullable().optional(),
  width: z.number().int().positive().nullable().optional(), height: z.number().int().positive().nullable().optional(),
  status: z.enum(["pending", "uploaded", "failed"]).default("pending"),
}).refine(image => image.status !== "uploaded" || Boolean(image.galleryUrl), "Uploaded images require a gallery URL.");
export const VideoAttachmentSchema = z.object({
  id: z.string().min(1).max(100), sourceUrl: ImageUrlSchema,
  galleryUrl: ImageUrlSchema.nullable().optional(), thumbnailUrl: ImageUrlSchema.nullable().optional(),
  bytes: z.number().int().positive().nullable().optional(),
  status: z.enum(["pending", "uploaded", "failed", "skipped"]).default("pending"),
  skipReason: z.literal("too_large").nullable().optional(),
}).refine(video => video.status !== "uploaded" || Boolean(video.galleryUrl && video.bytes), "Uploaded videos require a gallery URL and measured size.")
  .refine(video => video.status !== "skipped" || video.skipReason === "too_large", "Skipped videos require a reason.");
export const SourceSyncSchema = z.object({
  source: CollectionSourceSchema, historyCursor: z.string().max(500).nullable(), historyDone: z.boolean(),
  latestAt: z.string().nullable(), latestIds: z.array(z.string().max(200)).max(100),
  incrementalCursor: z.string().max(500).nullable(), pendingLatestAt: z.string().nullable(), pendingLatestIds: z.array(z.string().max(200)).max(100),
  status: z.enum(["pending", "ok", "empty", "failed"]), lastError: z.string().max(1000).nullable(),
  lastSuccessAt: z.string().nullable(), lastNonemptyAt: z.string().nullable(),
  failureCount: z.number().int().min(0).max(3).optional(), skippedAt: z.string().datetime().nullable().optional(),
  enabledAt: z.string().datetime().optional(), lastIncrementalSuccessAt: z.string().datetime().nullable().optional(),
  healthVersion: z.literal(1).optional(),
  failureKind: z.enum(["transient", "protocol"]).nullable().optional(),
  lastFailureRunId: z.string().max(200).nullable().optional(), lastFailureAt: z.string().datetime().nullable().optional(),
  nextRetryAt: z.string().datetime().nullable().optional(), recoveryAttempt: z.number().int().min(0).max(4).optional(),
  paused: z.boolean().optional(),
  historyRetryAt: z.string().datetime().nullable().optional(), historyError: z.string().max(1000).nullable().optional(),
});

export const CollectorSinceSchema = z.string().datetime().refine(value => Date.parse(value) >= Date.parse("2025-12-31T16:00:00.000Z"), "Collection starts no earlier than Beijing New Year 2026.");
export const CollectorProgressSchema = z.object({
  memberId: z.string().min(1).max(100).refine(value => !value.startsWith("@media/"), "Reserved collector progress key."), since: CollectorSinceSchema,
  writeId: z.string().uuid().optional(),
  revision: z.number().int().nonnegative(),
  sources: z.array(SourceSyncSchema).max(7).refine(values => new Set(values.map(value => value.source)).size === values.length, "Duplicate source checkpoints."),
  lastAttemptAt: z.string().datetime().nullable(), lastIncrementalAt: z.string().datetime().nullable(), lastHistoryAt: z.string().datetime().nullable(),
  collectedAt: z.string().datetime().nullable(), scopeComplete: z.boolean(), errorCount: z.number().int().nonnegative(),
});

export const SourceHealthSchema = SourceSyncSchema.pick({ status: true, lastError: true, failureCount: true, skippedAt: true,
  enabledAt: true, lastIncrementalSuccessAt: true, healthVersion: true, failureKind: true, lastFailureRunId: true,
  lastFailureAt: true, nextRetryAt: true, recoveryAttempt: true, paused: true, historyError: true, historyRetryAt: true });
export const MediaRetryProgressSchema = z.object({ since: CollectorSinceSchema, kind: z.enum(["image", "video"]),
  revision: z.number().int().nonnegative(), health: SourceHealthSchema, writeId: z.string().uuid().optional() });

export const QueryMessageSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  type: z.string(),
  text: z.string().nullable(),
  occurredAt: z.string(),
  senderName: z.string().nullable(),
  senderType: z.string().nullable(),
  senderId: z.string().nullable(), roomOwnerId: z.string().nullable(), roomOwnerName: z.string().nullable(), roomId: z.string().nullable(),
  kind: z.enum(["text", "image", "video", "reply", "post", "event", "excluded", "unknown"]),
  question: z.string().nullable(), answer: z.string().nullable(), source: CollectionSourceSchema, sourceFlags: z.number().int(),
  images: z.array(ImageAttachmentSchema), videos: z.array(VideoAttachmentSchema), parseStatus: z.enum(["parsed", "unsupported"]),
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
      imageMessages: z.number().int().nonnegative(), images: z.number().int().nonnegative(), replies: z.number().int().nonnegative(),
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
  images: z.number().int().nonnegative(), replies: z.number().int().nonnegative(),
});

export const QueryMembersSchema = z.object({ ok: z.literal(true), data: z.array(QueryMemberSchema), coverage: QueryCoverageSchema });

export const FollowerSnapshotSchema = z.object({
  count: z.number().int().nonnegative(), observedAt: z.string().datetime(),
});

export const MeleePeriodSchema = z.object({ id: z.number().int().positive(), label: z.string().min(1).max(100) });
export const MeleeEntrySchema = z.object({ memberId: z.string().regex(/^\d+$/).max(100), name: z.string().min(1).max(100), rank: z.number().int().positive(), score: z.number().int().nonnegative() });
export const MeleeProgressSchema = z.object({
  snapshotId: z.string().uuid(), periodId: z.number().int().positive(), periodLabel: z.string().min(1).max(100),
  observedAt: z.string().datetime(), updatedAt: z.string().datetime(), nextCursor: z.string().regex(/^\d+$/).max(100).nullable(), complete: z.boolean(), limited: z.boolean(),
});
export const MeleePageSchema = MeleeProgressSchema.omit({ updatedAt: true, complete: true }).extend({
  cursor: z.string().regex(/^\d+$/).max(100).nullable(), entries: z.array(MeleeEntrySchema).max(25), limited: z.boolean().default(false),
}).refine(value => value.nextCursor === null || value.nextCursor !== value.cursor && value.entries.length > 0, "Melee pagination must advance with entries.")
  .refine(value => !value.limited || value.nextCursor === null, "Limited ranking scans must stop without claiming another page.")
  .refine(value => new Set(value.entries.map(entry => entry.memberId)).size === value.entries.length, "Duplicate members in a melee page.");
export const MeleeSnapshotSchema = MeleeProgressSchema.omit({ snapshotId: true, nextCursor: true });
export const QueryMeleeSchema = z.object({ ok: z.literal(true), data: z.object({
  periods: z.array(MeleePeriodSchema), snapshot: MeleeSnapshotSchema.nullable(),
  entries: z.array(MeleeEntrySchema.extend({ memberAvailable: z.boolean() })),
}) });

export const QueryRankingsSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    from: z.string(), to: z.string(),
    totals: z.object({ messages: z.number().int().nonnegative(), activeMembers: z.number().int().nonnegative(), images: z.number().int().nonnegative(), replies: z.number().int().nonnegative() }),
    members: z.array(QueryMemberSchema.extend({ followers: z.number().int().nonnegative().nullable(), followersObservedAt: z.string().nullable() })),
    followersCoverage: z.object({ membersCovered: z.number().int().nonnegative(), earliestObservedAt: z.string().nullable(), latestObservedAt: z.string().nullable() }),
    directory: z.array(z.object({ groupName: z.string(), team: z.string().nullable() })),
    dailyActivity: z.array(z.object({ date: z.string(), count: z.number().int().nonnegative() })),
    typeBreakdown: z.array(z.object({ type: z.string(), count: z.number().int().nonnegative() })),
    recentMessages: z.array(QueryMessageSchema),
  }),
  coverage: QueryCoverageSchema,
});

export const QueryMemberDetailSchema = z.object({
  ok: z.literal(true),
  data: QueryMemberSchema.extend({ dailyActivity: z.array(z.object({ date: z.string(), count: z.number().int().nonnegative() })), recentMessages: z.array(QueryMessageSchema), sync: z.array(SourceSyncSchema) }),
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

export const ArchivePaginationSchema = z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().positive() });
export const ArchiveContentTotalsSchema = z.object({ messages: z.number().int().nonnegative(), images: z.number().int().nonnegative(), replies: z.number().int().nonnegative() });
export const QueryMessagePageSchema = z.object({ ok: z.literal(true), data: z.array(QueryMessageSchema), pagination: ArchivePaginationSchema });
export const QueryImagePageSchema = z.object({ ok: z.literal(true), data: z.array(z.object({ image: ImageAttachmentSchema, message: QueryMessageSchema })), pagination: ArchivePaginationSchema });
export const QueryContentTotalsSchema = z.object({ ok: z.literal(true), data: ArchiveContentTotalsSchema });
export const QueryActivitySchema = z.object({ ok: z.literal(true), data: z.object({
  year: z.number().int(), years: z.array(z.number().int()), asOf: z.string(),
  days: z.array(z.object({ date: z.string(), messages: z.number().int().nonnegative(), images: z.number().int().nonnegative(), replies: z.number().int().nonnegative() })),
  totals: ArchiveContentTotalsSchema.extend({ activeDays: z.number().int().nonnegative() }),
}) });

const IngestMemberSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(100), pinyin: z.string().max(200).nullable().optional(),
  groupName: z.string().min(1).max(100), team: z.string().max(100).nullable().optional(), roomId: z.string().max(200).nullable().optional(),
  channelId: z.string().max(100).nullable().optional(), serverId: z.string().max(100).nullable().optional(), liveRoomId: z.string().max(100).nullable().optional(),
  status: z.enum(["active", "gone"]).default("active"),
});
const IngestMessageSchema = z.object({
  id: z.string().min(1).max(200), memberId: z.string().min(1).max(100), occurredAt: z.string().min(1).max(80), type: z.string().min(1).max(50),
  text: z.string().max(20000).nullable().optional(), senderId: z.string().max(200).nullable().optional(), senderName: z.string().max(200).nullable().optional(),
  senderType: z.string().max(50).nullable().optional(), sourceJson: z.string().max(2000).nullable().optional(),
  author: IngestMemberSchema.optional(), roomOwnerId: z.string().max(100).nullable().optional(), roomId: z.string().max(200).nullable().optional(),
  kind: z.enum(["text", "image", "video", "reply", "post", "event", "excluded", "unknown"]).default("text"),
  question: z.string().max(20000).nullable().optional(), answer: z.string().max(20000).nullable().optional(),
  source: CollectionSourceSchema.default("room"), sourceFlags: z.number().int().min(1).max(127).default(1),
  images: z.array(ImageAttachmentSchema).max(30).default([]), videos: z.array(VideoAttachmentSchema).max(5).default([]), parseStatus: z.enum(["parsed", "unsupported"]).default("parsed"),
});

export const CatalogEntrySchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), source: z.enum(["album", "post_images"]),
  rawJson: z.string().min(2).max(8000), status: z.enum(["pending", "resolved"]),
});

export const QueryIngestUnitSchema = z.object({
  batchId: z.string().min(1).max(100), statDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startedAt: z.string().max(80),
  runId: z.string().min(1).max(100).optional(), phase: z.enum(["incremental", "history"]).optional(),
  member: IngestMemberSchema, messages: z.array(IngestMessageSchema).max(25), recordings: z.array(z.unknown()).max(0),
  followerSnapshot: FollowerSnapshotSchema.optional(),
  sync: SourceSyncSchema.optional(),
  catalog: z.array(CatalogEntrySchema).max(50).default([]),
  messageCursor: z.string().max(500).nullable().optional(), recordingCursor: z.string().max(500).nullable().optional(),
  totalMembers: z.number().int().nonnegative(), membersCovered: z.number().int().nonnegative(), errorCount: z.number().int().nonnegative().default(0),
});

export const CollectorRunSchema = z.object({
  id: z.string().min(1).max(100), statDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: z.string().datetime(), completedAt: z.string().datetime().nullable(),
  status: z.enum(["running", "completed", "bounded", "failed"]),
  totalMembers: z.number().int().nonnegative(), errorCount: z.number().int().nonnegative(),
});

export const QueryIngestResponseSchema = z.object({ ok: z.literal(true), data: z.object({ batchId: z.string(), memberId: z.string(), messagesWritten: z.number().int().nonnegative(), recordingsWritten: z.number().int().nonnegative() }) });
export const QuerySyncStateSchema = z.object({ ok: z.literal(true), data: z.object({ memberId: z.string(), messageCursor: z.string().nullable(), recordingCursor: z.string().nullable(), updatedAt: z.string(), lastError: z.string().nullable(), sources: z.array(SourceSyncSchema) }) });
