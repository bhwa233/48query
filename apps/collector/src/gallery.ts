import type { ImageAttachment, VideoAttachment } from "@starter/shared";

const MAX_BYTES = 50 * 1024 * 1024;
const GALLERY_URL = "https://gallery233.pages.dev";
const allowedMediaHost = (hostname: string) => hostname === "48.cn" || hostname.endsWith(".48.cn") || hostname === "snh48.com" || hostname.endsWith(".snh48.com") || hostname.endsWith(".sinaimg.cn") || hostname === "kd48-nosdn.yunxinsvr.com";
type GalleryFile = Pick<VideoAttachment, "id" | "sourceUrl" | "galleryUrl" | "thumbnailUrl" | "status">;
export class MediaSizeLimitError extends Error {
  constructor() { super("Media exceeds size limit."); this.name = "MediaSizeLimitError"; }
}

// Reuse galaxy-spider's /upload multipart protocol with native Node fetch.
// Preserve original bytes (including animated GIFs); no image processor needed.
export class GalleryUploader {
  constructor(private readonly options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {}

  private async sourceResponse(sourceUrl: string, method: "GET" | "HEAD", headers: Record<string, string>) {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let url = new URL(sourceUrl);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port || !allowedMediaHost(url.hostname)) throw new Error("Media source host is not supported.");
      response = await fetchImpl(url, { method, redirect: "manual", signal: AbortSignal.timeout(60_000), headers });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("Location");
      await response.body?.cancel();
      if (!location || redirects === 3) throw new Error("Media redirect limit exceeded.");
      url = new URL(location, url);
    }
    if (!response) throw new Error("Media request failed.");
    return response;
  }

  async videoSize(sourceUrl: string): Promise<number | null> {
    const head = await this.sourceResponse(sourceUrl, "HEAD", { Accept: "video/*" });
    const length = Number(head.headers.get("Content-Length"));
    await head.body?.cancel();
    if (head.ok && Number.isSafeInteger(length) && length > 0) return length;
    const response = await this.sourceResponse(sourceUrl, "GET", { Accept: "video/*", Range: "bytes=0-0" });
    const size = Number(response.status === 206 ? response.headers.get("Content-Range")?.match(/\/(\d+)$/)?.[1] : response.status === 200 ? response.headers.get("Content-Length") : null);
    await response.body?.cancel();
    return response.ok && Number.isSafeInteger(size) && size > 0 ? size : null;
  }

  async upload(image: ImageAttachment): Promise<void> { await this.uploadFile(image, "image", MAX_BYTES); }

  async uploadVideo(video: GalleryFile, maxBytes = MAX_BYTES): Promise<number> { return this.uploadFile(video, "video", maxBytes); }

  private async uploadFile(image: GalleryFile, kind: "image" | "video", maxBytes: number): Promise<number> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw new Error("Media size limit must be between 1 byte and 50 MiB.");
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await this.sourceResponse(image.sourceUrl, "GET", { Accept: `${kind}/*` });
    if (!response.ok || !response.body) throw new Error("Media download failed.");
    if (Number(response.headers.get("Content-Length")) > maxBytes) { await response.body.cancel(); throw new MediaSizeLimitError(); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > maxBytes) throw new MediaSizeLimitError();
        chunks.push(result.value);
      }
    } catch (error) { await reader.cancel(); throw error; }
    const bytes = Buffer.concat(chunks, size);
    const imageFormat = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? ["jpeg", "image/jpeg"]
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? ["png", "image/png"]
        : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii")) ? ["gif", "image/gif"]
          : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" ? ["webp", "image/webp"] : null;
    const brand = bytes.subarray(8, 12).toString("ascii");
    const videoFormat = bytes.length >= 16 && bytes.subarray(4, 8).toString("ascii") === "ftyp"
      ? brand === "qt  " ? ["mov", "video/quicktime"] : /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |dash)$/.test(brand) ? ["mp4", "video/mp4"] : null : null;
    const format = kind === "video" ? videoFormat : imageFormat;
    if (!format) throw new Error(`Downloaded resource is not a supported ${kind}.`);
    const base = new URL(this.options.baseUrl ?? GALLERY_URL);
    if (base.protocol !== "https:" || base.username || base.password) throw new Error("Gallery URL must use HTTPS.");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: format[1] }), `${image.id}.${format[0]}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      let uploaded: Response;
      try {
        uploaded = await fetchImpl(`${base.origin}/upload`, { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(60_000) });
      } catch {
        if (attempt === 2) throw new Error("Gallery upload network failure.");
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      if ((uploaded.status === 429 || uploaded.status >= 500) && attempt < 2) {
        await uploaded.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      if (!uploaded.ok) throw new Error(`Gallery upload failed (HTTP ${uploaded.status}).`);
      const payload: unknown = await uploaded.json();
      const first = Array.isArray(payload) ? payload[0] as { src?: unknown; thumbnail?: { src?: unknown } } | undefined : undefined;
      const safeUrl = (value: unknown) => {
        if (typeof value !== "string" || value.length > 2000) return null;
        try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
      };
      const galleryUrl = safeUrl(first?.src);
      if (!galleryUrl) throw new Error("Gallery returned no valid media URL.");
      image.galleryUrl = galleryUrl;
      image.thumbnailUrl = safeUrl(first?.thumbnail?.src);
      image.status = "uploaded";
      return size;
    }
    throw new Error("Gallery upload attempts exhausted.");
  }
}
