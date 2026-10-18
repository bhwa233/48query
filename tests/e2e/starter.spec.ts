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

test("dashboard search and archive navigation work", async ({ page }) => {
  await page.goto("/zh");
  await expect(page.getByRole("heading", { name: "看见每一次发言，从历史开始。" })).toBeVisible();
  await page.getByRole("textbox", { name: "搜索成员" }).fill("songxinran");
  await expect(page.getByText("宋昕冉", { exact: true }).last()).toBeVisible();
  await page.getByRole("link", { name: "成员", exact: true }).click();
  await expect(page).toHaveURL(/\/zh\/members$/);
  await expect(page.getByRole("heading", { name: "成员", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /宋昕冉/ }).first().click();
  await expect(page).toHaveURL(/\/zh\/members\/snr$/);
  await expect(page.getByText("统计概览", { exact: true })).toBeVisible();
});

test("mobile pages fit the viewport and expose navigation and theme controls", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/en", "/zh", "/zh/members", "/zh/messages", "/zh/recordings"]) {
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
