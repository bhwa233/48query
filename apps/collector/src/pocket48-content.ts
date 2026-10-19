import { createHash } from "node:crypto";
import type { ImageAttachment } from "@starter/shared";
import type { CollectionSource, CollectorMember, CollectorMessage } from "./types";

// No installed parser is needed: Node 24 exposes the original JSON number in
// reviver context. Preserve large IDs before IEEE-754 rounding can change them.
export function parsePocketJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value, (_key: string, item: unknown, context?: { source?: string }) =>
      typeof item === "number" && Number.isInteger(item) && !Number.isSafeInteger(item) ? context?.source ?? String(item) : item) as unknown;
  } catch { return value; }
}
export const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const string = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null;
export const sourceFlags: Record<CollectionSource, number> = { room: 1, album: 2, essence: 4, posts: 8, post_images: 16, weibo: 32, room_posts: 64 };

export function imageUrl(value: unknown): string | null {
  const text = string(value);
  if (!text) return null;
  try {
    const url = new URL(text.startsWith("//") ? `https:${text}` : text, "https://source.48.cn/");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 2000) return null;
    if (/\.(?:mp4|mov|m3u8|mp3|aac|wav|webm)(?:$|[?#])/i.test(url.href)) return null;
    return url.href;
  } catch { return null; }
}

export function timestamp(value: unknown): string | null {
  const text = string(value);
  if (!text) return null;
  const number = Number(text);
  const date = Number.isFinite(number) && number > 0 ? new Date(number < 100_000_000_000 ? number * 1000 : number) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function contentList(content: unknown): unknown[] {
  if (Array.isArray(content)) return content;
  const root = object(content);
  for (const key of ["message", "messageList", "data", "posts", "postsList", "postList", "list"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  throw new Error("Pocket48 returned an unknown content list shape; refusing to advance its cursor.");
}

function attachment(value: unknown): ImageAttachment | null {
  const body = typeof value === "string" ? { url: value } : object(value);
  const url = imageUrl(body.url ?? body.imageUrl ?? body.picUrl ?? body.originalUrl);
  if (!url) return null;
  const dimension = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  return { id: createHash("sha256").update(url).digest("hex"), sourceUrl: url, galleryUrl: null, thumbnailUrl: null,
    width: dimension(body.w ?? body.width), height: dimension(body.h ?? body.height), status: "pending" };
}

function postObject(value: unknown, depth = 0): Record<string, unknown> {
  const parsed = object(parsePocketJson(value));
  if (parsed.postId !== undefined) return parsed;
  if (depth > 4) return {};
  for (const key of ["postsInfo", "post", "data", "content", "extInfo"]) {
    const found = postObject(parsed[key], depth + 1);
    if (found.postId !== undefined) return found;
  }
  return {};
}

const excluded = /^(?:AUDIO|VIDEO|FLIPCARD_AUDIO|FLIPCARD_VIDEO|AUDIO_REPLY|AUDIO_GIFT_REPLY|SESSION_DIANTAI)$/;
const events = /^(?:LIVEPUSH|OPEN_LIVE|PRESENT_.*|RED_PACKET.*|DELETE|DISABLE_SPEAK|CLOSE_ROOM_CHAT|ZHONGQIU_.*)$/;

export function normalizeMessage(value: unknown, roomOwner: CollectorMember, source: CollectionSource, directory: ReadonlyMap<string, CollectorMember>): CollectorMessage | null {
  const item = object(value);
  const bodyValue = parsePocketJson(item.bodys);
  const body = object(bodyValue);
  const ext = object(parsePocketJson(item.extInfo));
  const post = postObject(item);
  const user = object(ext.user ?? ext.sender ?? item.userInfo ?? item.user ?? post.userInfo ?? post.user);
  const senderId = string(user.userId ?? user.id ?? ext.senderId ?? ext.senderUserId ?? item.senderUserId ?? item.senderId ?? item.userId ?? post.userId ?? post.ownerId);
  // An endpoint's owner parameter or a display name does not prove authorship.
  if (!senderId) return null;
  const author = directory.get(senderId) ?? (senderId === roomOwner.id ? roomOwner : null);
  if (!author) return null;
  if ((source === "posts" || source === "post_images") && senderId !== roomOwner.id) return null;
  const occurredAt = timestamp(item.msgTime ?? item.createTime ?? item.ctime ?? post.ctime ?? post.createTime ?? ext.createAt);
  if (!occurredAt) throw new Error("A member message has no valid timestamp; page retained for retry.");

  let type = string(body.messageType ?? ext.messageType ?? item.sourceType ?? item.msgType)?.toUpperCase() ?? "UNKNOWN";
  if (/^\d+$/.test(type)) type = ({ "0": "TEXT", "1": "IMAGE", "2": "AUDIO", "3": "VIDEO" } as Record<string, string>)[type] ?? "UNKNOWN";
  if (string(ext.messageObject) === "faipaiText") type = "FLIPCARD";
  const isPost = source === "posts" || source === "post_images" || (source === "room_posts" && Object.keys(post).length > 0);
  if (isPost) type = "POST_INFO";
  if (source === "weibo") type = "WEI_BO";
  const reply = object(body.replyInfo ?? body.giftReplyInfo ?? ext.replyInfo ?? ext.giftReplyInfo);
  const flip = object(body.filpCardInfo ?? body.flipCardInfo ?? body.filpCardAudioInfo ?? body.flipCardAudioInfo ?? body.filpCardVideoInfo ?? body.flipCardVideoInfo);
  let text = string(body.text ?? body.content ?? ext.text) ?? (typeof bodyValue === "string" ? string(bodyValue) : null);
  let question: string | null = null;
  let answer: string | null = null;
  let kind: NonNullable<CollectorMessage["kind"]> = "unknown";
  const images: ImageAttachment[] = [];
  if (type === "TEXT") kind = "text";
  else if (type === "IMAGE" || type === "EXPRESSIMAGE") {
    kind = "image";
    const image = attachment(type === "EXPRESSIMAGE" ? { url: object(body.expressImgInfo ?? ext.expressImgInfo).emotionRemote } : body);
    if (image) images.push(image);
    else throw new Error("A member image message has no valid image URL; page retained for retry.");
    text = string(ext.text ?? body.text);
  } else if (type === "REPLY" || type === "GIFTREPLY") {
    kind = "reply"; question = string(reply.replyText ?? ext.replyText); answer = string(reply.text ?? ext.text ?? body.text); text = answer;
  } else if (type === "FLIPCARD") {
    kind = "reply"; question = string(flip.question ?? ext.question ?? ext.faipaiContent); answer = string(flip.answer ?? ext.answer ?? ext.messageText); text = answer;
  } else if (excluded.test(type)) {
    kind = "excluded"; text = null; question = string(flip.question ?? ext.question);
  } else if (events.test(type)) { kind = "event"; text = null; }
  else if (type === "POST_INFO" || type === "WEI_BO") {
    kind = "post";
    text = string(post.text ?? post.content ?? ext.content ?? ext.previewText ?? body.text) ?? (typeof bodyValue === "string" ? string(bodyValue) : null);
    const list = post.images ?? post.imgUrls ?? post.imageUrls ?? post.picUrls ?? ext.coverUrlList ?? (ext.coverUrl ? [ext.coverUrl] : []);
    if (Array.isArray(list)) for (const value of list) { const image = attachment(value); if (image) images.push(image); }
  } else if (type === "VOTE") { kind = "text"; }

  const upstreamId = string(item.msgIdServer ?? item.msgIdClient ?? item.msgidClient ?? item.messageId ?? item.id);
  const postId = string(post.postId ?? item.postId ?? ext.postId);
  const roomId = roomOwner.channelId ?? roomOwner.roomId ?? roomOwner.id;
  const id = isPost && postId ? `post:${postId}` : upstreamId ? `room:${roomId}:${upstreamId}` : null;
  if (!id) throw new Error("A member message has no stable ID; page retained for retry.");
  if ([text, question, answer].some(part => part && part.length > 20000) || images.length > 30) throw new Error("A member message exceeds supported content bounds; page retained for retry.");
  return { id, memberId: senderId, author, occurredAt, type, text, senderId, senderName: author.name, senderType: "member",
    roomOwnerId: roomOwner.id, roomId: isPost ? null : roomId, kind, question, answer, source,
    sourceFlags: sourceFlags[source], images: [...new Map(images.map(image => [image.id, image])).values()], parseStatus: kind === "unknown" ? "unsupported" : "parsed",
    sourceJson: JSON.stringify({ upstreamId, postId, format: "pocket48-v2" }) };
}
