# GitHub Actions 采集

48query 的生产采集使用 GitHub Actions Secrets，不把 Pocket48 凭证写入仓库、D1 或采集日志。

## 配置

在运行采集的仓库中创建 `production` environment。`POCKET48_TOKEN`、`POCKET48_DEVICE_ID` 必须放在仓库级 Actions Secrets，供 SparkHub 后台轮换；不要在 environment 内创建同名值覆盖它们。`INGEST_KEY` 也可放在仓库级。需配置以下 Secrets：

```text
POCKET48_TOKEN
POCKET48_DEVICE_ID
INGEST_KEY
```

配置以下普通 Variables：

```text
INGEST_API_URL
COLLECTOR_MAX_PAGES       # 可选，默认 10
COLLECTOR_MAX_MEMBERS     # 可选，默认 0（全部成员）
POCKET48_MIN_INTERVAL_MS  # 可选，默认 5000
```

`POCKET48_PA` 不需要配置。采集器会在每次 Pocket48 请求前通过项目内 WASM 动态生成签名。`accid`、`pwd` 和完整 `cred.json` 只用于本地登录或其他长连接场景，不能上传到仓库或 GitHub Secrets。

workflow 位于 `.github/workflows/collector.yml`，每天北京时间 01:00 运行，也支持 `workflow_dispatch` 手动运行。生产任务使用并发锁，同一时间只允许一个批次运行。

第一次上线建议将 `COLLECTOR_MAX_MEMBERS` 和 `COLLECTOR_MAX_PAGES` 都设为 `1`，完成单成员验证后再改为全量配置。

## 凭证轮换

SparkHub 后台可以负责轮换，但明文凭证只能在后端短暂存在，不能由浏览器接收或写入 D1。推荐使用专用 GitHub App，而不是个人 PAT：

1. 管理员在 SparkHub 后台完成管理员认证。
2. 后端请求 Pocket48 发送短信验证码，手机号和验证码不写日志。
3. 后端用验证码完成登录，拿到 token 和设备号。
4. 后端立即请求 Pocket48 IM 用户信息，验证凭证的认证访问。
5. 验证成功后，通过 GitHub REST API 的仓库公钥加密值，更新 `POCKET48_TOKEN` 和 `POCKET48_DEVICE_ID`。
6. 后端只记录操作者、时间、版本和验证结果，不保存 token，也不向前端返回 token。

GitHub App 只安装到采集仓库，并只授予 Repository Secrets 的 Read and write 权限。轮换接口应固定允许更新的 secret 名称，不能接受任意名称；验证码需要短时效、尝试次数和频率限制。验证失败时不得覆盖当前有效 Secret。

GitHub Secrets 更新使用以下 GitHub REST API 组合：

```text
GET /repos/{owner}/{repo}/actions/secrets/public-key
PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}
```

`PUT` 请求中的 `encrypted_value` 必须使用返回的仓库公钥和 sealed-box 算法生成。GitHub App 的安装访问令牌只在 SparkHub 后端请求期间使用，不进入前端、D1 或 GitHub Actions 的环境变量。

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
- 数据库、`production` environment、`INGEST_KEY` 和上述普通变量已完成首次部署配置。仍需在 SparkHub 配好 GitHub App，并通过短信轮换写入两个 Pocket48 Secrets，才能运行真实采集。当前成员、消息、录播页面仍使用演示数据；首页已连接概览 API，但没有真实批次时展示演示内容。
