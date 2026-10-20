import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
const expectedMissing = new WeakMap<Page, Set<string>>();
test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  expectedMissing.set(page, new Set());
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      /Failed to load resource.*404/.test(message.text()) &&
      expectedMissing.get(page)?.has(message.location().url)
    )
      return;
    messages.push(message.text());
  });
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test("language navigation preserves the article, and archive routes render", async ({
  page,
}) => {
  await page.goto("/en/articles/welcome");
  await expect(
    page.getByRole("heading", { level: 1, name: "A place to start" }),
  ).toBeVisible();
  await expect(page.locator(".article-body h2")).toHaveCount(2);
  await page.getByRole("link", { name: "中文", exact: true }).click();
  await expect(page).toHaveURL(/\/zh\/articles\/welcome$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", { level: 1, name: "从这里开始" }),
  ).toBeVisible();
  for (const path of ["/zh/articles/does-not-exist", "/zh/does-not-exist"]) {
    expectedMissing.get(page)?.add(new URL(path, page.url()).href);
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "页面不存在" }),
    ).toBeVisible();
  }
});

test("theme defaults to dark even on a light system and preserves explicit choices", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/en");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("menuitem", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("dashboard search and archive navigation work", async ({ page }) => {
  await page.goto("/zh");
  await expect(page.getByRole("heading", { name: "成员数据排行" })).toBeVisible();
  await page.getByRole("textbox", { name: "搜索姓名或拼音" }).fill("syntheticmember");
  await expect(page.getByText("验证成员", { exact: true }).last()).toBeVisible();
  await page.getByRole("link", { name: "成员", exact: true }).click();
  await expect(page).toHaveURL(/\/zh\/members$/);
  await expect(page.getByRole("heading", { name: "成员", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /验证成员/ }).first().click();
  await expect(page).toHaveURL(/\/zh\/members\/e2e-member$/);
  await expect(page.getByText("统计概览", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "消息", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索消息或提问内容" }).fill("验证公开提问");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("验证成员回答", { exact: true })).toBeVisible();
  await expect(page.getByText("验证文字归档", { exact: true })).toHaveCount(0);
  await page.goto("/zh/images");
  await page.getByRole("button", { name: "查看原图", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("mobile pages fit the viewport and expose navigation and theme controls", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/en", "/zh", "/zh/members", "/zh/messages", "/zh/images", "/zh/recordings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await expect(page.getByRole("link", { name: "成员", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "切换主题" }).click();
  await expect(
    page.getByRole("menuitem", { name: "深色", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await testInfo.attach("mobile-article", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("rankings change metric, period and scope while preserving shared ranks", async ({ page }, testInfo) => {
  await page.goto("/zh");
  const list = page.getByRole("list", { name: "成员排行", exact: true });
  await expect(list.getByRole("link").first()).toHaveText(/验证成员/);
  await page.getByRole("tab", { name: "图片榜", exact: true }).click();
  await expect(list.getByRole("link").first()).toHaveText(/对照成员/);
  await page.getByRole("tab", { name: "活跃榜", exact: true }).click();
  await expect(list.locator('li > [aria-label="排名 1"]')).toHaveCount(2);
  await page.getByRole("combobox", { name: "时间范围", exact: true }).click();
  await page.getByRole("option", { name: "近 7 天", exact: true }).click();
  await expect(list.locator('li > [aria-label="排名 1"]')).toHaveCount(2);
  await page.getByRole("combobox", { name: "时间范围", exact: true }).click();
  await page.getByRole("option", { name: "近 30 天", exact: true }).click();
  await expect(list.getByRole("link").first()).toHaveText(/对照成员/);
  await expect(list.locator('li > [aria-label="排名 2"]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("rankings-desktop-default-dark.png"), fullPage: true });

  await page.getByRole("combobox", { name: "全部团体", exact: true }).click();
  await page.getByRole("option", { name: "GNZ48", exact: true }).click();
  await expect(list.getByRole("link")).toHaveCount(1);
  await expect(list.getByRole("link")).toHaveText(/对照成员/);
  await page.getByRole("combobox", { name: "全部队伍", exact: true }).click();
  await page.getByRole("option", { name: "Team G", exact: true }).click();
  await expect(list.getByRole("link")).toHaveCount(1);
  await page.getByRole("textbox", { name: "搜索姓名或拼音" }).fill("missing-member");
  await expect(page.getByText("当前暂无成员上榜", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await expect(list.getByRole("link")).toHaveCount(2);

  await page.getByRole("combobox", { name: "时间范围", exact: true }).click();
  await page.getByRole("option", { name: "自定义", exact: true }).click();
  const yesterday = new Date(Date.now() + 8 * 3600_000 - 86400_000).toISOString().slice(0, 10);
  await page.getByLabel("开始日期", { exact: true }).fill(yesterday);
  await page.getByLabel("结束日期", { exact: true }).fill(yesterday);
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect(list.locator('li > [aria-label="排名 1"]')).toHaveCount(2);
  await page.getByRole("button", { name: "切换主题" }).click();
  await page.getByRole("menuitem", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath("rankings-desktop-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("link", { name: "图片", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("rankings-mobile-dark.png"), fullPage: true });
});

test("member history keeps messages on failure, resumes its cursor and resets for another member", async ({ page, request }) => {
  const apiOrigin = process.env.STARTER_E2E_API_URL;
  if (!apiOrigin) throw new Error("Run this test through pnpm test:e2e.");
  const occurredAt = new Date(Date.now() - 86400_000).toISOString();
  // Equal timestamps put the boundary inside an ID tie, where timestamp-only cursors lose rows.
  const messages = Array.from({ length: 43 }, (_, index) => {
    const number = String(index + 1).padStart(3, "0");
    return { id: `pagination-${number}`, memberId: "e2e-pagination", senderId: "e2e-pagination", type: "TEXT", text: `分页消息${number}`, occurredAt };
  });
  for (let offset = 0; offset < messages.length; offset += 25) {
    const seed = await request.post(`${apiOrigin}/api/query/ingest/unit`, {
      headers: { "X-Ingest-Key": "test-e2e-ingest" },
      data: {
        batchId: `e2e-pagination-${offset}`, statDate: occurredAt.slice(0, 10), startedAt: occurredAt,
        member: { id: "e2e-pagination", name: "分页成员", groupName: "SNH48" },
        messages: messages.slice(offset, offset + 25),
        recordings: [], totalMembers: 3, membersCovered: 3, errorCount: 0,
      },
    });
    expect(seed.ok(), await seed.text()).toBe(true);
  }
  await page.goto("/zh/members/e2e-pagination");
  const rows = page.locator("article");
  await expect(rows).toHaveCount(20);
  await expect(page.getByText("分页消息001", { exact: true })).toHaveCount(0);
  let rejectNext = true;
  await page.route("**/api/query/messages?**", async route => {
    if (rejectNext) {
      rejectNext = false;
      // An invalid success response must also preserve the list and allow a retry.
      await route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Archive unavailable" } } });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "加载更早的消息", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("暂时无法读取图文档案。");
  await expect(rows).toHaveCount(20);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(rows).toHaveCount(40);
  await expect(rows.last()).toContainText("分页消息004");
  await page.getByRole("button", { name: "加载更早的消息", exact: true }).click();
  await expect(rows).toHaveCount(messages.length);
  await expect(rows.first()).toContainText("分页消息043");
  await expect(rows.last()).toContainText("分页消息001");
  await expect(page.getByText("分页消息043", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveText("已加载全部消息。");
  await expect(page.getByRole("button", { name: "加载更早的消息", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "成员", exact: true }).click();
  await page.getByRole("link", { name: /验证成员/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "验证成员" })).toBeVisible();
  await expect(rows).toHaveCount(3);
  await expect(page.getByText("分页消息001", { exact: true })).toHaveCount(0);
});
