# 本地验证记录

验证日期：2026-10-18。环境：Linux、Node 24.22.0 LTS、pnpm 12.14.0，本地 Miniflare/workerd。以下结果针对本地开发与构建产物，未执行远程迁移、部署或推送。

## 工程与依赖

- 安装精确版本和锁文件，执行 frozen lockfile 与 peer dependency 检查。
- `pnpm check`：环境格式、Oxlint、共享包/Web/API 类型、Worker typegen 一致性、测试工具类型、中英文文案结构、RSC 边界、配置回归、Web 构建，以及无 D1 / 有 D1 两种 API dry run。
- 配置回归覆盖 URL 的协议、凭据、路径及查询边界，CORS origin 格式与去重，命令行环境优先级，以及真实发布校验脚本对占位配置、定制配置和 `.env.local` 覆盖的处理。
- `pnpm audit:check`：验证真正加载的 braces 补丁，再执行审计；无未处理公告。原始审计仍报告没有上游修复版的 `GHSA-vfj7-8cjw-p6xm`，本地补丁及精确例外见 [依赖维护](dependencies.md)。
- `pnpm db:generate`：Drizzle 正常运行，没有新增或变更迁移。

## 实际启动回归

`pnpm test:smoke` 使用动态端口和临时 D1，执行后清理自身启动的进程及测试数据：

- 独立 Web：显式清空公开 API URL，确认不启用数据库表单；中英文首页、根路径永久跳转、文章列表与 MDX 正文、favicon、robots 和 sitemap 正常。
- 404：不存在的文章和任意未知路径均返回 HTTP 404；中英文错误内容与 HTML 语言属性正确。升级后的旧 catch-all 出现流式响应 200，现已移除，使用启用的 `global-not-found` 入口处理路由缺失。
- 无数据库 API：健康检查报告无 binding，notes 返回明确的 503；中文回显与空白整形正常；空输入、malformed JSON 返回 400，过大请求返回 413，未知 API 返回统一 JSON 404。
- CORS：允许来源收到响应头，不允许的来源没有响应头，JSON POST 预检返回 204；文档及 OpenAPI 正常。
- D1：有 binding 但无表时返回明确的 503；对临时数据库应用真实本地迁移后，从空列表开始创建并读回记录，验证标题整形、空标题 400 和 `no-store`。
- 构建后的 Web Worker：中英文页面、MDX、中文 404、sitemap 和首页引用的 21 个 JS/CSS 资源正常。

## 浏览器验证限制

已编写 4 项 Playwright Chromium 用例并完成类型检查和测试发现：文章语言切换与 404、主题切换并刷新保持、真实 API/D1 表单读写、390 × 844 移动端布局及导航。CI 已配置安装 Chromium 并运行这些用例，失败时上传截图/trace。

本次本地浏览器导航再次被自动审批服务阻止：`404 model not found`。操作未执行，未绕过审批执行其他浏览器入口。因此本地没有完成交互、hydration、主题持久化和移动端视觉验收；用例尚不能视为已经通过，远程 CI 也尚未实际运行。

## 保留的开发服务

按用户启动要求保留 Web（3000）与带 D1 的 API（8787）。忽略文件 `apps/web/.env.local` 将 API URL 指向本机；开发数据库仍保留之前的「模板启动验证 · 本地 D1」演示记录。自动回归使用独立临时状态，不修改这份开发数据。

环境文件、数据库状态、依赖目录、构建产物、浏览器报告均不纳入初始提交或模板标签。
