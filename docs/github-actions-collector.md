# GitHub Actions 图文采集

生产采集通过 GitHub Actions 运行，凭证由 SparkHub 加密保存，通过独立读取令牌临时获取。当前改造与真实运行状态见[实施记录](text-image-implementation.md)；`Daily collector` 是否恢复，以该记录及 GitHub 实际状态为准。

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
| `COLLECTOR_IMAGE_RETRY_LIMIT` | `25`，每次先重试的未完成图片数，可设 `0` |

本地调试优先使用[本地凭证与采集器命令](collector.md#本地调试)，不需要推送代码反复跑 CI。手动工作流可覆盖 `max_members`、`max_pages`、`history_pages`、`member_scope`，可用 `member_id` 指定成员，`sources` 指定部分来源。未填写 `sources` 时使用 Variable 或七类默认来源。`dry_run` 可关闭写库和图片上传，`diagnostics` 只打印结构；只读调试使用独立并发组。页预算不是完整历史的承诺，实时性也不由 Actions cron 保证。

## 调度与行为

配置的定时点是北京时间每日 01:00（UTC 前一天 17:00）。并发组为 `48query-production-collector`，不取消正在写入的上一批次。执行命令必须是：

```sh
pnpm --filter @starter/collector run run
```

该命令读取真实来源，通过保护的 ingest API 写入。图片上传至图库，不经过 Worker 下载，也不建立新的 R2 bucket。无任何录播、弹幕、视频文件下载请求。

每来源独立分页与错误状态；图库失败保留重试记录，批次失败会使任务报错。`source_page` 日志只含数量、来源和成员 ID，不输出消息正文、图片 URL、凭证或请求头。网页读取本站已保存的数据，不在访客浏览时调用 Pocket48。

## 上线顺序

1. 本地通过 `pnpm check`、`pnpm test:smoke`、`pnpm test:e2e`，检查 `0005_text_image_archive.sql` 仅增加图文字段、图片关联和来源状态。
2. 发布前检查部署配置；在已授权的生产环境应用迁移并部署 D1 API，再部署 Web。历史录播数据保留。
3. 手动运行少量成员、少量页，核对作者、文字、图片图库地址、分页、错误状态和录播数量不增加。若需要暂时启用 workflow 进行手动验证，验证后按结果决定是否恢复定时任务。
4. 对已确认可读取的来源与成员逐步扩大范围。空列表或权限限制在状态中保留，不将其计为完整覆盖。

完整的来源、游标和图片行为见[采集器说明](collector.md)。
