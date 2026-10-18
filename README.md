# 48query

基于 [cloudflare-web-starter](https://github.com/bhwa233/cloudflare-web-starter) 创建的独立项目。前端可以独立开发、构建和部署；API 与 D1 按需启用。

当前项目包含 48query 统计站的 Web、查询 API、D1 数据模型和每日 Pocket48 采集器。`template.json` 保留来源记录；`docs/verification.md` 记录来源模板的验证结果，不代表本项目的业务验收。

## 技术栈

- Web：Vinext、React 19、App Router、Tailwind 4、Radix/shadcn 风格 UI、next-intl、next-themes。
- API：Hono、Zod、OpenAPI、Scalar，部署到 Cloudflare Workers。
- 数据层：Cloudflare D1 + Drizzle，包含统计查询、采集批次和同步游标。
- 采集：独立 Node collector，支持 Pocket48 分页采集、WASM 动态签名和 GitHub Actions 每日跑批。
- 工程：pnpm workspace、严格 TypeScript、Oxlint、GitHub Actions CI。

此版本使用独立验证的依赖基线：Vinext 1.2.1、React 19.3.1、Node 24 LTS、Wrangler 4.151.1。升级时验证开发、构建和 Worker 预览，依赖与补丁说明见 [依赖维护](docs/dependencies.md)。项目不包含生产资源和账号；Pocket48 凭证只通过本地配置或 GitHub Secrets 注入，轮换接口约定见 [GitHub Actions 采集](docs/github-actions-collector.md)。

## 开始使用

要求 Node 24 LTS（`.node-version` 固定 24.22.0）和 pnpm 12.14.0。在仓库根目录运行：

```sh
pnpm install
pnpm dev
```

打开 <http://localhost:3000>，默认跳转到 `/en`；中文页面为 `/zh`。无需创建环境文件、启动 API 或配置数据库。

文章示例位于 `/en/articles` 和 `/zh/articles`，正文使用本地 Markdown/MDX。可用 `siteConfig.contentEnabled` 关闭，扩展与裁剪方式见 [内容站示例](docs/content.md)。

### 启用 API

从 `apps/web/.env.local.example` 复制为 `.env.local`，设置：

```dotenv
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8787
```

然后运行 `pnpm dev:all`。首页的回显示例会启用，并展示可选 D1 示例。API 不需要数据库：

| 地址                | 行为                                              |
| ------------------- | ------------------------------------------------- |
| `GET /api/health`   | 健康检查，只报告是否有 D1 binding，不查询数据库   |
| `POST /api/echo`    | 校验并返回 `{ "message": "hello" }`               |
| `GET /docs`         | Scalar API 文档                                   |
| `GET /openapi.json` | OpenAPI 定义                                      |
| `GET /api/notes`    | 读取最多 50 条 notes；未配置 D1 时返回明确的 503  |
| `POST /api/notes`   | 创建 `{ "title": "hello" }`；未配置 D1 时返回 503 |

CORS 仅对 `CORS_ORIGINS` 中的浏览器来源放行。默认仅允许 `http://localhost:3000`。所有 API 错误使用 `{ ok: false, error: { code, message } }`。

### 启用本地 D1

```sh
pnpm db:migrate:local
pnpm dev:all:db
```

D1 profile 使用 `apps/api/wrangler.d1.jsonc`；占位 database ID 只用于本地模拟，不会连接远程数据库。执行迁移前 notes 接口不可用，执行后可以从首页读取和创建笔记。默认 `wrangler.jsonc` 完全不包含 D1 binding。

修改表结构后运行 `pnpm db:generate`，检查 `apps/api/migrations` 中的 SQL 和 Drizzle 元数据，再应用本地迁移。修改 binding 后运行 `pnpm --filter @starter/api cf-typegen` 并提交生成的声明。

## 常用命令

| 命令                                  | 用途                                        |
| ------------------------------------- | ------------------------------------------- |
| `pnpm dev` / `pnpm dev:web`           | 仅 Web，3000 端口                           |
| `pnpm dev:api`                        | 无数据库 API，8787 端口                     |
| `pnpm dev:all`                        | Web + 无数据库 API                          |
| `pnpm dev:api:db` / `pnpm dev:all:db` | 启用 D1 的 API / 全栈开发                   |
| `pnpm check:web`                      | 独立校验并构建前端                          |
| `pnpm check`                          | lint、类型、文案结构、RSC 边界和两端构建    |
| `pnpm env:check`                      | URL、CORS 与环境配置格式检查                |
| `pnpm audit:check`                    | 依赖审计及安全补丁实际行为检查              |
| `pnpm test:smoke`                     | 独立 Web、API、临时 D1 与构建后 Worker 回归 |
| `pnpm test:e2e`                       | 语言、主题、真实 API 表单与移动端浏览器检查 |
| `pnpm collector:dev`                  | 运行 demo 采集器 dry-run                    |
| `pnpm collector:run`                  | 按环境变量运行采集器                         |
| `pnpm --filter @starter/collector login` | 本地登录并保存 Pocket48 凭证                |
| `pnpm --filter @starter/api build:db` | D1 API 打包预检                             |
| `pnpm --filter @starter/web preview`  | 构建后的本地 Worker 预览                    |

开发命令不杀已有端口进程，也不执行迁移或部署。D1 schema 示例不单独建立 CRUD 单元测试；验证使用真实本地 Worker 和迁移。为新业务增加测试时应覆盖实际逻辑和边界。

首次运行浏览器测试前执行 `pnpm exec playwright install chromium`。自动测试使用动态端口和临时 D1，结束后清理自身进程与数据；先停止当前工作树的 Vinext 开发服务，再运行回归。CI 按顺序执行完整检查、安全审计、启动回归和 Chromium 交互测试。

公开环境配置的优先级为：**命令行环境变量 > Vite 环境文件 > Web Wrangler vars > 独立运行默认值**。`.env.local` 也会参与生产构建；所有 `NEXT_PUBLIC_*` 都是公开值。`pnpm env:check production` 检查生产模式的格式；发布校验还要求实际构建 URL 与生产 Wrangler vars 一致，避免本地文件覆盖生产地址。CORS 来源只接受不带路径的 HTTP(S) origin，不接受通配符。

## 目录与修改顺序

```text
apps/web/                 独立 Web 应用
  app/[locale]/           服务端页面、布局、错误与加载状态
  src/components/ui/      从 SparkHub 提取的基础组件
  src/components/         页面容器与示例交互
  src/config/site.ts      站点名称与默认主题
  src/i18n/               en/zh 文案与 locale routing
apps/api/                 可选 Hono Worker
  src/notes/              可删除的 D1 示例
  src/query/              统计查询、采集入库和同步状态
  migrations/             Drizzle SQL 与元数据
  wrangler.jsonc          无数据库 profile
  wrangler.d1.jsonc       可选 D1 profile
packages/shared/          传输契约、路径、API schema
packages/config-ts/       两端 TypeScript 基础配置
apps/collector/           Pocket48 采集器和每日批次编排
scripts/                  RSC 边界、部署配置和构建兼容处理
docs/                     架构、初始化和验证说明
```

新项目通常按以下顺序定制：

1. 修改根 `package.json` 的项目名称，站点名称在 `apps/web/src/config/site.ts`。
2. 修改中英文文案、导航、首页和 `public/favicon.svg`。
3. 设置 `NEXT_PUBLIC_SITE_URL`，生产构建前同步 Web Wrangler 的 `vars`。
4. 按项目需要启用 API / D1，替换 notes 示例。
5. 修改 Worker 名称、生产 CORS 来源；启用 D1 时填写新项目自己的 database ID。
6. 执行校验，再配置新项目的发布流程。

`@starter/*` 是内部 workspace 名称，可保留；它不代表发布到 npm。新业务通常放在 API 自有模块和 Web 自有功能目录，共享契约保持精简。

## 部署

模板提供 Cloudflare 配置和显式部署命令，但 CI 只做检查，不自动发布。

发布前使用 `pnpm verify:deploy-config web`、`api` 或 `api:db`。这些检查**故意拒绝**模板 Worker 名称、本地地址及 D1 占位 ID；它们不属于本地 `pnpm check`。

- Web：更换 `apps/web/wrangler.jsonc` 中的 Worker 名称、HTTPS 站点 URL；需要 API 时填写公开的 API URL。`NEXT_PUBLIC_*` 是公开值，构建时用于浏览器，不能放密钥。运行 `pnpm deploy:web` 将校验、构建，再使用生成的 `dist/server/wrangler.json` 发布。
- 无数据库 API：修改 `apps/api/wrangler.jsonc` 后，使用 `pnpm deploy:api`。
- D1 API：创建新项目自己的 D1，在 `wrangler.d1.jsonc` 填入 ID，明确选择远程数据库并完成迁移后，使用 `pnpm deploy:api:db`。部署脚本不会自动执行远程迁移。

如使用 Cloudflare Workers Builds，应从仓库根目录安装依赖，分别为 Web/API 配置对应部署命令。新项目需要自行设置分支和发布授权，不继承 SparkHub 的自动部署设置。

## 来源与维护

来源和基线 commit 记录在 `template.json`。此目录拥有自己的版本历史，不通过运行时路径引用 SparkHub，也没有继承它的 Git 历史或远程地址。

新项目从某个模板版本创建后独立演进。模板更新通过版本记录和有选择的迁移应用，暂不提供初始化 CLI 或强制同步机制。详见 [架构与裁剪](docs/architecture.md) 和 [创建新项目](docs/new-project.md)。

来源模板基线为 `v0.1.0`，模板变更记录见 [CHANGELOG](CHANGELOG.md)。本项目从独立初始提交开始维护，不继承模板标签。Renovate 配置已提供，接入远程仓库的 Renovate App 后才会创建依赖更新 PR；不自动合并或发布。
