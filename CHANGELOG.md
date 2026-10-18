# Changelog

## 0.1.0 — 2026-10-18

- 从 SparkHub 提取可独立运行的 Web、可选 Hono API 与 D1 模板，保留来源 commit。
- 建立 Node 24 LTS、pnpm 12.14.0、正式版 Vinext 1.2.1、React 19.3.1 与统一 Cloudflare 工具链的精确依赖基线。
- 更新安全依赖，为尚无上游修复版的 braces 增加深度限制补丁和实际依赖链回归检查。
- 由 Zod Schema 推导共享响应类型；统一公开 URL 与 CORS 配置校验，发布前检测构建环境覆盖。
- 增加可关闭的双语 MDX 文章示例、内容索引、详情 metadata 与 sitemap。
- 使用全局 404 入口处理未知路径，保留中英文错误页面和正确 HTTP 状态码。
- 增加本地 Worker / D1 生命周期回归、Playwright 交互用例、CI 检查和 Renovate 分组更新配置。

实际执行结果及环境限制记录在 `docs/verification.md`。
