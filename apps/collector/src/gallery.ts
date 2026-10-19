import type { ImageAttachment } from "@starter/shared";

const MAX_BYTES = 50 * 1024 * 1024;
const GALLERY_URL = "https://gallery233.pages.dev";
const allowedImageHost = (hostname: string) => hostname === "48.cn" || hostname.endsWith(".48.cn") || hostname === "snh48.com" || hostname.endsWith(".snh48.com") || hostname.endsWith(".sinaimg.cn");

// Reuse galaxy-spider's /upload multipart protocol with native Node fetch.
// Preserve original bytes (including animated GIFs); no image processor needed.
export class GalleryUploader {
  constructor(private readonly options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {}

  async upload(image: ImageAttachment): Promise<void> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let url = new URL(image.sourceUrl);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port || !allowedImageHost(url.hostname)) throw new Error("Image source host is not supported.");
      response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(60_000), headers: { Accept: "image/*" } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("Location");
      await response.body?.cancel();
      if (!location || redirects === 3) throw new Error("Image redirect limit exceeded.");
      url = new URL(location, url);
    }
    if (!response?.ok || !response.body) throw new Error("Image download failed.");
    if (Number(response.headers.get("Content-Length")) > MAX_BYTES) { await response.body.cancel(); throw new Error("Image exceeds size limit."); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > MAX_BYTES) throw new Error("Image exceeds size limit.");
        chunks.push(result.value);
      }
    } catch (error) { await reader.cancel(); throw error; }
    const bytes = Buffer.concat(chunks, size);
    const format = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? ["jpeg", "image/jpeg"]
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? ["png", "image/png"]
        : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii")) ? ["gif", "image/gif"]
          : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" ? ["webp", "image/webp"] : null;
    if (!format) throw new Error("Downloaded resource is not a supported image.");
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
      if (!galleryUrl) throw new Error("Gallery returned no valid image URL.");
      image.galleryUrl = galleryUrl;
      image.thumbnailUrl = safeUrl(first?.thumbnail?.src);
      image.status = "uploaded";
      return;
    }
  }
}
