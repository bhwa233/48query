# 架构与裁剪

Web 与 API 分开部署，前端只引用共享契约，不引用 API 源码或生成类型。因此 `check:web` 和 Web 构建均不需要 API 构建、数据库或 Cloudflare 账号。

页面默认服务端渲染，主题切换与示例表单是小型 client islands。客户端只调用已整形 API；第三方数据聚合、密钥和持久化操作属于 API。一个页面只包含一个 `AppPageContainer`。共享 UI 来自 SparkHub，通用工具已内联到 Web，避免为一个 `cn` 函数维护额外 workspace 包。

国际化保留 en/zh 与 next-intl locale routing，内容来自本地 TypeScript registry。根路径永久跳转到默认语言，语言切换使用普通链接。新增页面使用共享 metadata helper 设置 canonical 和 alternates。文章正文采用按语言维护的本地 MDX，索引与元数据集中维护，可通过 siteConfig.contentEnabled 整体关闭，见 [内容站示例](content.md)。语言切换保留当前页面路径。全局路由缺失使用 global-not-found，页面内部缺失使用 locale not-found，二者复用本地化布局。站点标题、导航与示例文案不包含 SparkHub 业务。

共享请求和响应类型由 Zod schema 推导，Web 只引用传输契约。公开 URL 和 CORS 使用共享格式校验；构建配置优先级和部署前的覆盖检测见 README。

API 默认无 D1 binding。数据库配置作为一个完整独立文件维护，启用时显式选择。这样本地默认路径不需要资源 ID，生产无数据库 API 也可以直接使用。两份配置的公共字段（CORS、Worker 名称、日期等）需要一起维护；部署时只选择其中一份。D1 binding 类型由 D1 配置生成，在应用环境里显式声明为可选。

notes 是演示模块，并非正式用户数据产品。它没有用户身份、权限或隔离，正式产品应在开放写入前增加所需的鉴权、归属和配额。可直接删除 `src/notes`、路由挂载、D1 配置、迁移以及首页 `NotesExample`；基础 API 不受影响。

## 只需要前端

可长期保留 workspace 中的 API 而不运行或部署。若希望物理删除 API，移除 `apps/api`、对应根脚本、D1文档，并将 CI 改成 `pnpm check:web`。Web 不需要同时改动。删除示例后，共享包也可随用途裁剪。

## 从 SparkHub 保留和移除

保留：UI 原语、页面宽度和容器、主题、RSC 边界原则、Cloudflare/Vinext 打包路径、TypeScript 配置基础。

移除：所有 Deck 业务、抓取和调度、存储桶、队列、外部服务、分析和追踪、远程数据库、线上域名和 ID、PWA、业务字体、市场 API 代理、管理会话、历史流水线。

新写：精简首页、双语文案、错误与加载页、基础 SEO、API 健康/回显、可选 notes 示例、部署前配置检查、针对模板的文档与规范。
