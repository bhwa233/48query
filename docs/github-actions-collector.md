# GitHub Actions 图文采集

生产采集通过 GitHub Actions 运行，凭证由 SparkHub 加密保存，通过独立读取令牌临时获取。当前配置与真实运行状态见[后端上线记录](backend-collection-rollout.md)；`Daily collector` 是否恢复，以该记录及 GitHub 实际状态为准。

## 配置

仓库需有 `production` environment。下列值放在仓库级 Actions Secrets，不写入 Variables：

```text
COLLECTOR_CREDENTIAL_READ_TOKEN
INGEST_KEY
```

`COLLECTOR_CREDENTIAL_READ_TOKEN` 与 SparkHub Worker 的凭证读取令牌一致。工作流不直接使用旧的 `POCKET48_TOKEN`／`POCKET48_DEVICE_ID` secrets，也不重新发短信。

普通 Variables：

| 名称 | 默认值／用途 |
| --- | --- |
| `INGEST_API_URL` | 必填，48query API origin |
| `COLLECTOR_CREDENTIALS_URL` | `https://api.bhwa233.com/api/collector/credentials` |
| `COLLECTOR_MEMBER_SCOPE` | `followed`；可选 `all`，只改变候选名单，不自动关注 |
| `COLLECTOR_MAX_MEMBERS` | `0` 表示全部候选；生产验证建议先 `1` |
| `COLLECTOR_MAX_PAGES` | `10`，每成员、每来源的增量／历史各自页面预算 |
| `COLLECTOR_HISTORY_PAGES` | 未设置时沿用增量页预算；`0` 跳过历史回溯 |
| `COLLECTOR_SOURCES` | `room,album,essence,posts,post_images,weibo,room_posts` |
| `POCKET48_MIN_INTERVAL_MS` | `5000`，上游请求的最小间隔，不是长期无风险保证 |
| `GALLERY_BASE_URL` | `https://gallery233.pages.dev`，沿用 galaxy-spider 图库协议 |
| `COLLECTOR_VIDEO_MAX_MIB` | `50`，普通房间短视频单文件上限，允许降低 |
| `COLLECTOR_IMAGE_RETRY_LIMIT` | `25`，每次先重试的未完成图片数，可设 `0` |

本地调试优先使用[本地凭证与采集器命令](collector.md#本地调试)，不需要推送代码反复跑 CI。手动工作流可覆盖 `max_members`、`max_pages`、`history_pages`、`member_scope`，可用 `member_id` 指定成员，`sources` 指定部分来源。未填写 `sources` 时使用 Variable 或七类默认来源。`dry_run` 可关闭写库和图片上传，`diagnostics` 只打印结构；只读与写入任务共享同一账号并发组。页预算不是完整历史的承诺，实时性也不由 Actions cron 保证。

## 调度与行为

配置的定时点是北京时间每日 01:00（UTC 前一天 17:00）。并发组为 `48query-production-collector`，不取消正在写入的上一批次。执行命令必须是：

```sh
pnpm --filter @starter/collector run run
```

该命令读取真实来源，通过保护的 ingest API 写入。图片上传至图库，不经过 Worker 下载，也不建立新的 R2 bucket。不请求录播或弹幕；仅下载和上传已核验的普通房间小视频，单文件上限为 50 MiB。

每来源独立分页与错误状态；图库失败保留重试记录，批次失败会使任务报错。`source_page` 日志只含数量、来源和成员 ID，不输出消息正文、图片 URL、凭证或请求头。网页读取本站已保存的数据，不在访客浏览时调用 Pocket48。

## 上线顺序

1. 本地通过 `pnpm check`、`pnpm test:smoke`、`pnpm test:e2e`，检查 `0005_text_image_archive.sql` 仅增加图文字段、图片关联和来源状态。
2. 发布前检查部署配置；在已授权的生产环境应用迁移并部署 D1 API，再部署 Web。历史录播数据保留。
3. 手动运行少量成员、少量页，核对作者、文字、图片图库地址、分页、错误状态和录播数量不增加。若需要暂时启用 workflow 进行手动验证，验证后按结果决定是否恢复定时任务。
4. 对已确认可读取的来源与成员逐步扩大范围。空列表或权限限制在状态中保留，不将其计为完整覆盖。

完整的来源、游标和图片行为见[采集器说明](collector.md)。

2026-10-20 范围调整：工作流固定 `COLLECTOR_SINCE=2026-01-01T00:00:00+08:00`，不再向前补采。全团模式运行 `group --collect --update-roster`；定时运行还加 `--refresh`，每周日北京时间 01:00 才额外重查身份未验证项。全团默认每来源首页 1 页、历史 1 页，每次最多 240 分钟，当前成员完成后退出；手动 `group_minutes` 支持 1–300。只有仓库 scope 设置为 `all` 时，新增北京时间 07:00、13:00、19:00 三次轮转才生效。

进度使用当前分支、同一 `collector.yml` 的最近已完成运行 artifact 恢复；真实写入与 dry-run 分别使用 `group-state-2026-live`、`group-state-2026-dry-run`。无旧 artifact 时从公开名单初始化，不伪造历史覆盖。进度即使本轮来源失败也保存 30 天，媒体补传在进度保存后单独执行，并遵守相同的时间下限。这里只描述配置；定时任务实际启用状态仍应以 GitHub API 为准，本地扩采期间保持暂停以避免同账号并发。

2026-10-20 用户确认转为线上采集：本地任务在当前成员完成后停止，范围检查点另存备份；仓库 Variable `COLLECTOR_MEMBER_SCOPE` 改为 `all`。Actions 的临时进度路径在执行步骤中从 `$RUNNER_TEMP` 写入 `$GITHUB_ENV`，因为任务级 `env` 不支持 `runner` context。线上首次运行从公开名单建立自己的轮转进度，保留生产库已有正文并按稳定 ID 幂等写入；后续运行通过线上 artifact 续采。本地进度保留不删除，不表示已上传到 Actions。采集仍严格限制为北京时间 2026 年元旦起，来源失败或范围未扫完继续如实报告未验证。
