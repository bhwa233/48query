# 创建新项目

此模板第一版采用复制后独立维护的方式；不提供生成器。可以在托管平台将仓库设为 Template 后使用“Use this template”，也可以复制工作树中的版本控制文件到新目录，再初始化新仓库。

本地已发布的模板版本可以直接从标签导出：`git archive v0.1.0 | tar -x -C /path/to/new-project`（目标目录需预先创建且为空），然后在新目录初始化 Git。这种方式只导出受版本管理的内容。`template.json` 记录模板版本，CHANGELOG 记录各版本差异。

复制时仅包含源文件和 `pnpm-lock.yaml`，不要复制 `.git`、`node_modules`、`dist`、`.next`、`.wrangler`、`.env.local`、`.dev.vars` 或本地 SQLite 数据。新项目保留 `template.json`，用于记录来源模板版本。

先从 README 的“开始使用”跑通 Web，再决定是否开启 API 和 D1。第一次定制优先修改站点名称、文案、导航和图标，随后配置新项目的 Worker 和数据库。模板不与原 SparkHub 共享线上资源。

删除示例时同时检查路由、组件、共享 schema、依赖和文档。只在新业务需要时加入认证、后台、支付、对象存储、邮件或 AI 服务。

模板未来有修复时，查看版本差异，按实际使用的能力选择迁移；新项目无需跟随每一次依赖升级。
