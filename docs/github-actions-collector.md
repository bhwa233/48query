# GitHub Actions 采集

48query 的生产采集使用 GitHub Actions。Pocket48 凭证由 SparkHub API 加密保存，采集任务通过独立读取令牌临时获取，不把凭证写入仓库、D1 或采集日志。

## 配置

在运行采集的仓库中创建 `production` environment。`COLLECTOR_CREDENTIAL_READ_TOKEN` 必须放在仓库级 Actions Secret，值与 SparkHub Worker 的同名 Secret 一致。`INGEST_KEY` 也可放在仓库级。旧的 `POCKET48_TOKEN` 和 `POCKET48_DEVICE_ID` 在切换完成前可以保留，但新的工作流不会读取它们。需配置以下 Secrets：

```text
COLLECTOR_CREDENTIAL_READ_TOKEN
INGEST_KEY
```

配置以下普通 Variables：

```text
INGEST_API_URL
COLLECTOR_MAX_PAGES       # 可选，默认 10
COLLECTOR_MAX_MEMBERS     # 可选，默认 0（全部成员）
POCKET48_MIN_INTERVAL_MS  # 可选，默认 5000
COLLECTOR_CREDENTIALS_URL # 可选，默认 https://api.bhwa233.com/api/collector/credentials
```

`POCKET48_PA` 不需要配置。采集器会在每次 Pocket48 请求前通过项目内 WASM 动态生成签名。`accid`、`pwd` 和完整 `cred.json` 只用于本地登录或其他长连接场景，不能上传到仓库或 GitHub Secrets。

workflow 位于 `.github/workflows/collector.yml`，每天北京时间 01:00 运行，也支持 `workflow_dispatch` 手动运行。生产任务使用并发锁，同一时间只允许一个批次运行。

第一次上线建议将 `COLLECTOR_MAX_MEMBERS` 和 `COLLECTOR_MAX_PAGES` 都设为 `1`，完成单成员验证后再改为全量配置。

## 凭证轮换

在本地完成 Pocket48 登录后，将生成的 JSON 粘贴到 SparkHub 后台。SparkHub 加密保存到 D1，采集任务启动时临时读取：

1. 在 SparkHub 仓库运行 `node scripts/pocket48-login.mjs`，本机直连 Pocket48，不使用远程代理。
2. 根据提示输入手机号和短信验证码；本地脚本完成登录及 IM 访问验证。
3. 复制生成的 `{ token, deviceId }` JSON，在 SparkHub 后台完成管理员认证后粘贴保存。
4. 保存成功后，浏览器清空表单，展示凭证版本和保存时间。
5. SparkHub 使用 AES-GCM 加密保存到 D1；手机号和短信验证码不提交到 SparkHub。
6. 采集任务启动时请求 `COLLECTOR_CREDENTIALS_URL`，凭证只存在于当前进程内存中。

## 失败行为

采集器在成员级请求失败时会继续处理其他成员，但最终批次会标记为 `failed`，并以非零退出码结束 GitHub Actions。只有 `errorCount = 0` 的批次才会标记为 `completed`，查询接口不会把失败批次当成完整覆盖。

请求 Pocket48 前先通过现有入库事务登记批次与成员，保留原游标且不计入成功成员数。这样首个成员失败也有批次可收尾，不会再用 `Batch not found` 覆盖原始错误。目录为空则直接报错，不输出空批次成功。

成员目录仅提供成员身份信息，采集消息前通过 `/im/api/v1/im/server/jump` 按成员 ID 获取当前 `channelId`、`serverId`，避免目录中旧频道返回「频道不存在」。同一批次内复用查询结果；查询失败会保留为采集错误，不会伪装成空消息成功。消息每页请求 25 条，与入库接口的单页上限一致，保留 Pocket48 分页游标。

workflow 不会打印环境变量、请求头或完整上游响应，也不会上传包含凭证的 artifact。Pocket48 token 失效时应在日志中根据错误类型判断，然后从 SparkHub 后台执行轮换。

采集启动命令是 `pnpm --filter @starter/collector run run`（或仓库根目录 `pnpm collector:run`）。第一个 `run` 是 pnpm 子命令，第二个是包内脚本名；省略第二个只会列出脚本并返回成功，不会采集。验收需检查日志包含 `batch_finished`，且 `membersCovered > 0`、`errorCount = 0`，不能只看工作流绿色状态。

## 生产入口

- 网站：https://48query-web.404174262.workers.dev/zh
- API：https://48query-api.404174262.workers.dev
- 凭证轮换：https://www.bhwa233.com/zh/admin/collector
- 生产 API 部署使用 `wrangler.d1.jsonc`（`pnpm deploy:api:db`）；无 D1 配置只用于独立 API 验证。
- 初次部署将 `COLLECTOR_MAX_MEMBERS=1`、`COLLECTOR_MAX_PAGES=1`，完成真实单成员验证后再调整全量。当前没有真实采集批次时，页面标注演示数据。
- 手动点击 **Run workflow** 时，首次验证请将 `max_pages`、`max_members` 两个输入都改成 `1`；表单输入优先于仓库变量。
- 数据库、`production` environment、`INGEST_KEY`、`COLLECTOR_CREDENTIAL_READ_TOKEN` 和上述普通变量需要在首次部署时配置。完成 SparkHub 凭证轮换后即可运行真实采集；当前成员、消息、录播页面仍使用演示数据时，首页会继续展示演示内容。
