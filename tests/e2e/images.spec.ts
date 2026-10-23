import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

test("gallery paginates distinct images, restores URL state and isolates previews and filters", async ({ page, request }, testInfo) => {
  test.setTimeout(90000);
  const api = process.env.STARTER_E2E_API_URL;
  const web = process.env.STARTER_E2E_WEB_URL;
  const state = process.env.STARTER_E2E_D1_STATE;
  if (!api || !web || !state) throw new Error("Run through pnpm test:e2e.");
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const image = (index: number) => ({
    id: `gallery-image-${index}`, sourceUrl: `${web}/favicon.svg?gallery-fixture=${index}`,
    galleryUrl: `${web}/favicon.svg?gallery-fixture=${index}`, status: "uploaded",
    // Include landscapes, portraits, an extra-long image and missing dimensions.
    ...(index === 7 ? {} : { width: 600, height: index === 8 ? 3000 : [800, 450, 600][index % 3] }),
  });
  const messages = Array.from({ length: 44 }, (_, index) => ({
    id: `gallery-message-${index}`, memberId: "gallery-member", senderId: "gallery-member", type: "IMAGE", kind: "image",
    text: `waterfall-regression ${index}`, occurredAt: new Date(Date.now() - index * 60000).toISOString(),
    images: [image(index), ...(index === 0 ? [image(44)] : index === 35 ? [image(0)] : [])],
  }));
  for (let offset = 0; offset < messages.length; offset += 25) {
    const seed = await request.post(`${api}/api/query/ingest/unit`, {
      headers: { "X-Ingest-Key": "test-e2e-ingest" },
      data: {
        batchId: `gallery-regression-${offset}`, statDate: new Date().toISOString().slice(0, 10), startedAt: new Date().toISOString(),
        member: { id: "gallery-member", name: "瀑布流验证成员", groupName: "SNH48" },
        messages: messages.slice(offset, offset + 25), recordings: [], totalMembers: 3, membersCovered: 3, errorCount: 0,
      },
    });
    expect(seed.ok(), await seed.text()).toBe(true);
  }
  await page.route("**/favicon.svg?gallery-fixture=*", route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#334155"/><circle cx="300" cy="300" r="160" fill="#94a3b8"/></svg>',
  }));
  let release = () => {};
  let releaseFilter = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requestedPages: string[] = [];
  await page.route("**/api/query/image-pages?**", async route => {
    const params = new URL(route.request().url()).searchParams;
    const selectedPage = params.get("page");
    if (params.get("memberId") === "gallery-member" && selectedPage === "2") {
      requestedPages.push(selectedPage);
      if (requestedPages.length === 1) {
        // A failed page request preserves the previous page and retries the same URL.
        await route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Temporary failure" } } });
        return;
      }
      await gate;
    }
    await route.continue();
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/zh/images");
    // SSR controls can be clicked before hydration; wait for real query results.
    await expect(page.getByRole("list", { name: "图片瀑布流" }).getByRole("button").first()).toBeVisible({ timeout: 15000 });
    await page.getByRole("combobox", { name: "全部成员", exact: true }).click();
    await page.getByRole("option", { name: "瀑布流验证成员", exact: true }).click();
    const wall = page.getByRole("list", { name: "图片瀑布流" });
    const cards = page.locator(".gallery-grid > li[data-image-id]");
    await expect(cards).toHaveCount(30, { timeout: 15000 });
    await expect.poll(() => cards.first().evaluate(node => getComputedStyle(node).position)).toBe("absolute");
    const positions = () => cards.evaluateAll(nodes => nodes.slice(0, 10).map(node => {
      const rect = node.getBoundingClientRect();
      return { id: node.getAttribute("data-image-id"), x: rect.x, y: rect.y + scrollY, width: rect.width, height: rect.height };
    }));
    const before = await positions();
    const firstIds = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-image-id")));
    expect(new Set(before.map(rect => rect.x)).size).toBe(5);
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(page.getByRole("button", { name: "重试", exact: true })).toBeVisible();
    await expect(cards).toHaveCount(30);
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => requestedPages.length).toBe(2);
    expect(requestedPages[1]).toBe(requestedPages[0]);
    await expect(cards).toHaveCount(30);
    release();
    await expect(cards).toHaveCount(15);
    const secondIds = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-image-id")));
    expect(new Set([...firstIds, ...secondIds]).size).toBe(45);
    await expect(page.getByRole("button", { name: "加载更多图片", exact: true })).toHaveCount(0);

    const trigger = cards.nth(10).getByRole("button", { name: "查看原图", exact: true });
    await trigger.scrollIntoViewIfNeeded();
    const savedY = await page.evaluate(() => scrollY);
    await trigger.click();
    const preview = page.getByRole("dialog", { name: "图片预览" });
    await expect(preview).toBeVisible();
    const original = await preview.getByRole("img").getAttribute("src");
    await preview.getByRole("button", { name: "下一张图片", exact: true }).click();
    await expect(preview.getByRole("img")).not.toHaveAttribute("src", original!);
    await page.keyboard.press("ArrowLeft");
    await expect(preview.getByRole("img")).toHaveAttribute("src", original!);
    await expect(preview.getByRole("link", { name: "查看源图", exact: true })).toHaveAttribute("href", original!);
    await expect(preview.getByRole("region", { name: "关联消息", exact: true })).toContainText("waterfall-regression");
    await page.keyboard.press("Escape");
    await expect(preview).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(savedY, 0);

    await page.getByRole("button", { name: "上一页", exact: true }).click();
    await expect(cards).toHaveCount(30);
    expect(await positions()).toEqual(before);
    await expect(wall.locator('[data-image-id="gallery-image-0"]')).toHaveCount(1);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("gallery-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => new Set((await positions()).map(rect => rect.x)).size).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await cards.first().locator(".gallery-caption").evaluate(node => getComputedStyle(node).opacity)).toBe("1");
    await page.screenshot({ path: testInfo.outputPath("gallery-mobile.png"), fullPage: true });

    // Deep links request the selected page directly, with no cursor replay.
    await page.goto("/zh/images?memberId=gallery-member&page=2&pageSize=30");
    await expect(cards).toHaveCount(15, { timeout: 15000 });
    await page.reload();
    await expect(cards).toHaveCount(15, { timeout: 15000 });
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");

    // A new filter must abort the old first page and never revive its images.
    const filterGate = new Promise<void>(resolve => { releaseFilter = resolve; });
    await page.route("**/api/query/image-pages?**", async route => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get("q") === "waterfall-regression" && params.get("memberId") === "gallery-member") {
        await filterGate;
      }
      await route.fallback();
    });
    await page.getByRole("textbox", { name: "搜索消息或提问内容", exact: true }).fill("waterfall-regression");
    const delayed = page.waitForRequest(req => req.url().includes("q=waterfall-regression"));
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    const oldRequest = await delayed;
    const aborted = page.waitForEvent("requestfailed", req => req === oldRequest);
    await page.getByRole("combobox", { name: "全部成员", exact: true }).click();
    await page.getByRole("option", { name: "对照成员", exact: true }).click();
    await aborted;
    releaseFilter();
    await expect(page.getByText("暂无符合条件的内容。", { exact: true })).toBeVisible();
    await expect(cards).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    release();
    releaseFilter();
    // This suite shares one temporary D1. Remove only this test's namespace so
    // the ranking/search cases still exercise their original dataset.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await promisify(execFile)("pnpm", ["exec", "wrangler", "d1", "execute", "APP_DB", "--local", "--config", "wrangler.d1.jsonc", "--persist-to", state,
      "--command", "DELETE FROM query_message_images WHERE message_id IN (SELECT id FROM query_messages WHERE member_id = 'gallery-member'); DELETE FROM query_messages WHERE member_id = 'gallery-member'; DELETE FROM query_images WHERE id LIKE 'gallery-image-%'; DELETE FROM query_source_sync WHERE member_id = 'gallery-member'; DELETE FROM query_batch_items WHERE batch_id LIKE 'gallery-regression-%'; DELETE FROM query_batches WHERE id LIKE 'gallery-regression-%'; DELETE FROM query_members WHERE id = 'gallery-member';"],
    { cwd: fileURLToPath(new URL("../../apps/api/", import.meta.url)) });
  }
});
