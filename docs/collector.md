# 48query 每日采集器

状态：批次编排、D1 入库链路和 Pocket48 真实数据适配器已实现；生产每日任务见 [GitHub Actions 采集](github-actions-collector.md)。

## 默认运行

默认使用 `demo` source 和 dry-run store，不访问网络，也不会写 D1：

```sh
pnpm --filter @starter/collector dev
```

输出中会包含 `ingest_unit` 和 `batch_complete` 事件，用于检查分页、游标和批次统计。

## Pocket48 适配器

### 获取登录凭证

使用 collector 自带的登录器，手机号和短信验证码只在本地交互输入：

```sh
pnpm --filter @starter/collector login
```

登录器会复用固定设备号，并使用项目内的 WASM 生成 `pa` 签名。token、`accid`、`pwd` 和设备号保存在用户配置目录（Linux 默认是 `~/.config/48query`，Windows 默认是 `%APPDATA%\\48query`），文件权限为当前用户可读写。可以先运行 `pnpm --filter @starter/collector login -- --check` 检查 WASM，不会发送短信。

适配器默认关闭。启用前只需要把已获得的登录会话放进运行环境，不要写入仓库：

```sh
COLLECTOR_SOURCE=pocket48 \
POCKET48_TOKEN=... \
POCKET48_DEVICE_ID=... \
POCKET48_MIN_INTERVAL_MS=5000 \
COLLECTOR_MAX_MEMBERS=1 \
COLLECTOR_MAX_PAGES=1 \
COLLECTOR_MEMBER_ID=6738 \
pnpm --filter @starter/collector run
```

它读取成员目录，按 `nextTime` 分页读取房间消息，并按 `next` 分页读取录播。录播弹幕文件仍标记为 `pending`，由后续解析任务处理。可以设置 `POCKET48_API_BASE_URL` 和 `POCKET48_DIRECTORY_URL` 指向 fixture 或代理来做离线验证；未设置凭证时进程会直接失败，不会退回 demo 数据。

第一次真实探测建议保留两个限制变量为 `1`，并使用 dry-run store；确认鉴权、字段解析和游标推进后，再去掉 `COLLECTOR_MAX_MEMBERS` 或提高 `COLLECTOR_MAX_PAGES`。只有同时设置 `INGEST_API_URL`、`INGEST_KEY` 且不带 `--dry-run` 时才会写入 D1。

生产任务应使用 `POCKET48_TOKEN`、`POCKET48_DEVICE_ID` 和 `INGEST_KEY` 环境变量。不要把本地 `cred.json` 上传到仓库；GitHub Actions 的 Secrets 配置和后台轮换流程见 [GitHub Actions 采集](github-actions-collector.md)。

`COLLECTOR_MEMBER_ID` 可选，用于把真实探测限制到指定成员；不设置时按成员目录顺序处理。

## 写入本地 D1

先启动带 D1 的 API，并在 `.dev.vars` 设置 `INGEST_KEY`。然后设置：

```sh
COLLECTOR_SOURCE=demo \
COLLECTOR_DRY_RUN=0 \
INGEST_API_URL=http://localhost:8787 \
INGEST_KEY=本地密钥 \
pnpm --filter @starter/collector run
```

采集器按成员分页，每页最多提交 25 条消息和 25 条录播。API 对成员、消息、录播和同步游标执行幂等 upsert；重复运行不会重复产生相同记录。

## 真实适配器边界

`CollectorSource` 需要提供成员目录、房间消息分页和录播分页。适配器必须自己处理 Pocket48 的登录、签名、限速和上游字段解析，输出稳定 ID、ISO 时间和不含凭证的规范数据。账号凭证只放在运行环境，不进入仓库或 D1 原始字段。

真实适配器接入前，需要完成数据能力文档中的 P0 验证：账号登录有效期、消息游标边界、去重键、录播弹幕文件延迟和全量请求预算。
