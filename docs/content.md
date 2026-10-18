# 可选内容站示例

`/en/articles` 与 `/zh/articles` 提供文章列表，`/en/articles/welcome` 与 `/zh/articles/welcome` 提供双语详情。正文来自 `apps/web/content/{locale}/*.mdx`，通过 MDX 在构建时编译为服务端组件，不需要 API、数据库或 CMS。普通 Markdown 语法可以直接写在 `.mdx` 文件中。

`apps/web/src/content/index.ts` 是显式内容索引，管理 slug、日期和正文组件；标题、摘要与界面文案在 `src/i18n/messages.ts`。新增文章时添加两种语言的正文、文案与索引项。索引同时驱动列表、详情和 sitemap；canonical、语言 alternates 由 metadata helper 生成，语言切换保留文章路径。

MDX 是可执行源码，只用于项目作者维护并随代码审查的本地内容；用户提交的文字应走独立的数据与渲染路径。

在 `src/config/site.ts` 设置 `contentEnabled: false` 即可关闭导航和 sitemap 条目，并让内容路由返回 404。需要物理裁剪时，删除 `app/[locale]/articles`、`content`、`src/content`，移除 sitemap 中的内容索引、布局中的文章导航、messages 中的 content 文案，以及 `@mdx-js/rollup` 依赖（Vinext 自动加载 MDX 插件），再调整自动回归中的文章用例。
