# 依赖基线与维护

2026-10-18 基线：Node 24.22.0 LTS、pnpm 12.14.0、TypeScript 7.0.2、Vinext 1.2.1、React / React DOM / React Server DOM 19.3.1、Vite 8.3.4、Cloudflare Vite plugin 1.64.0、Wrangler 4.151.1、Hono 4.13.13。精确版本以各 workspace 的 package.json 和根锁文件为准。

Node 与 `@types/node` 均固定在 24 系列；pnpm 保留 12 系列。Drizzle 使用稳定版 ORM 0.45.4 / Kit 0.31.11，不跟随 1.0 预发布渠道。React 的三个运行时包一起更新；Vinext、Vite 与 RSC 插件一起验证；Cloudflare 插件与两端 Wrangler 一起验证；Oxlint 与 oxlint-tsgolint 一起更新。

## 安全修复

原始锁文件命中 44 条 npm 安全公告。升级直接依赖后，还为上游的旧间接版本范围增加了以下 pnpm overrides：

- `@esbuild-kit/core-utils>esbuild`：0.25.12，修复旧 esbuild 开发服务公告；实际使用 Drizzle 生成器验证兼容性。
- `postcss`：8.5.30，统一直接与间接版本。
- `fflate@<0.7.5`：0.7.5，修复旧 0.7 系列问题，保持同一小版本系列。

`braces@3.0.3` 的 [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 在本次核对时没有已发布的上游修复版本。模板通过 `patches/braces@3.0.3.patch` 和 `patchedDependencies` 限制花括号、圆括号及混合嵌套的解析深度，超过 128 层立即抛出 `SyntaxError`，避免进入后续递归处理。普通 glob 的展开行为保持一致。

`pnpm test:config` 和 `pnpm audit:check` 都会解析 Vinext 依赖链中**真正加载的 braces**，验证普通展开与深层恶意输入。源代码补丁不会被 npm 审计自动识别，因此原始 `pnpm audit` 仍可能报告这一条公告；`audit:check` 仅在补丁的实际行为验证成功、公告 ID 与包版本完全一致时，将其报告为 MITIGATED。任何其他公告、审计请求失败或失效的补丁都会让检查失败。没有设置全局忽略公告列表。

上游发布修复版本后，应升级并删除此补丁和精确例外，同时保留边界回归测试。其他 overrides 也应在上游版本范围修正后删除。

## 更新流程

`.github/renovate.json` 提供分组更新配置，不自动合并。仓库接入 Renovate 后才会创建更新 PR；此模板不会自行安装 GitHub App 或修改远程设置。

1. 从 npm 的稳定渠道核对新版本、peer dependencies 和发行说明。
2. 更新精确版本和锁文件，不用 `--force` 或关闭严格 peer 校验来掩盖冲突。
3. Wrangler 更新后重新生成 Worker 类型。
4. 执行 `pnpm check`、`pnpm audit:check`、`pnpm test:smoke` 和 `pnpm test:e2e`。浏览器测试前先安装 Chromium：`pnpm exec playwright install chromium`。
5. 检查 `pnpm db:generate` 是否意外生成迁移，审查构建后 Worker 预览和发布配置。
6. 更新 CHANGELOG 和验证记录，再创建模板版本。

回归测试使用临时目录与动态端口，不会迁移远程 D1，也不会修改开发数据库。Vinext 同一工作树有开发锁；运行自动回归前请停止该工作树自己的开发服务。测试只清理自身启动的子进程。
