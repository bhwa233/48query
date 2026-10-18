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

test("language navigation preserves the article, and MDX and 404 render", async ({
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

test("theme changes persist after reload", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("menuitem", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
});

test("browser forms reach the actual API and persist notes in isolated D1", async ({
  page,
}) => {
  await page.goto("/zh");
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(send).toBeDisabled();
  await page
    .getByRole("textbox", { name: "输入一段简短消息" })
    .fill("浏览器回显验证");
  await send.click();
  await expect(
    page.getByText("API 返回成功。 浏览器回显验证", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "读取笔记", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已读取笔记。");
  await expect(
    page.getByRole("button", { name: "创建笔记", exact: true }),
  ).toBeDisabled();
  const title = `浏览器 D1 验证 ${Date.now()}`;
  await page
    .getByRole("textbox", { name: "笔记标题", exact: true })
    .fill(title);
  await page.getByRole("button", { name: "创建笔记", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("笔记已创建。");
  await expect(
    page.getByRole("listitem").filter({ hasText: title }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "读取笔记", exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: title }),
  ).toBeVisible();
});

test("mobile pages fit the viewport and expose navigation and theme controls", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/en", "/zh", "/zh/articles/welcome"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await expect(
    page.getByRole("link", { name: "文章", exact: true }),
  ).toBeVisible();
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
