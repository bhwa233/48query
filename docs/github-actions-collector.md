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

SparkHub 后台负责轮换，明文凭证只在后端验证和采集任务内存中短暂存在，不会返回浏览器或写入 D1：

1. 管理员在 SparkHub 后台完成管理员认证。
2. 后端请求 Pocket48 发送短信验证码，手机号和验证码不写日志。
3. 后端用验证码完成登录，拿到 token 和设备号。
4. 后端立即请求 Pocket48 IM 用户信息，验证凭证的认证访问。
5. 验证成功后，SparkHub 将凭证使用 AES-GCM 加密保存到 D1。
6. 采集任务启动时请求 `COLLECTOR_CREDENTIALS_URL`，凭证只存在于当前进程内存中。

## 失败行为

采集器在成员级请求失败时会继续处理其他成员，但最终批次会标记为 `failed`，并以非零退出码结束 GitHub Actions。只有 `errorCount = 0` 的批次才会标记为 `completed`，查询接口不会把失败批次当成完整覆盖。

workflow 不会打印环境变量、请求头或完整上游响应，也不会上传包含凭证的 artifact。Pocket48 token 失效时应在日志中根据错误类型判断，然后从 SparkHub 后台执行轮换。

## 生产入口

- 网站：https://48query-web.404174262.workers.dev/zh
- API：https://48query-api.404174262.workers.dev
- 凭证轮换：https://www.bhwa233.com/zh/admin/collector
- 生产 API 部署使用 `wrangler.d1.jsonc`（`pnpm deploy:api:db`）；无 D1 配置只用于独立 API 验证。
- 初次部署将 `COLLECTOR_MAX_MEMBERS=1`、`COLLECTOR_MAX_PAGES=1`，完成真实单成员验证后再调整全量。当前没有真实采集批次时，页面标注演示数据。
- 手动点击 **Run workflow** 时，首次验证请将 `max_pages`、`max_members` 两个输入都改成 `1`；表单输入优先于仓库变量。
- 数据库、`production` environment、`INGEST_KEY`、`COLLECTOR_CREDENTIAL_READ_TOKEN` 和上述普通变量需要在首次部署时配置。完成 SparkHub 凭证轮换后即可运行真实采集；当前成员、消息、录播页面仍使用演示数据时，首页会继续展示演示内容。
