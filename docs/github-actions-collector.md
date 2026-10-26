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

配置为每小时一次，北京时间每小时的第 17 分钟（UTC `17 * * * *`）。并发组为 `48query-production-collector`，不取消正在写入的上一批次。全团模式执行 `group --collect --update-roster`；指定成员或关注成员模式使用：

```sh
pnpm --filter @starter/collector run run
```

该命令读取真实来源，通过保护的 ingest API 写入。正文、已核验附件和私有待核验目录先入库；独立的 `media` job 上传至图库，不经过 Worker 下载，也不建立新的 R2 bucket。不请求录播或弹幕；仅下载和上传已核验的普通房间小视频，单文件上限为 50 MiB。

每来源独立分页与错误状态；图库失败保留重试记录，实际请求／写入失败会使任务报错。预算到期、历史尚未补齐、目录已可靠入队等待核验均为待续采，不会仅因此把本批标红，也不会冒充历史完整。`source_page` 日志只含数量、来源和成员 ID，不输出消息正文、图片 URL、凭证或请求头。网页读取本站已保存的数据，不在访客浏览时调用 Pocket48。

## 上线顺序

1. 本地通过 `pnpm check`、`pnpm test:smoke`、`pnpm test:e2e`，检查 `0005_text_image_archive.sql` 仅增加图文字段、图片关联和来源状态。
2. 发布前检查部署配置；在已授权的生产环境应用迁移并部署 D1 API，再部署 Web。历史录播数据保留。
3. 手动运行少量成员、少量页，核对作者、文字、图片图库地址、分页、错误状态和录播数量不增加。若需要暂时启用 workflow 进行手动验证，验证后按结果决定是否恢复定时任务。
4. 对已确认可读取的来源与成员逐步扩大范围。空列表或权限限制在状态中保留，不将其计为完整覆盖。

完整的来源、游标和图片行为见[采集器说明](collector.md)。

2026-10-20 调度调整：工作流固定 `COLLECTOR_SINCE=2026-01-01T00:00:00+08:00`，不再向前补采。全团定时运行加 `--refresh`，周日北京时间 00:17 额外重查身份未验证项。每来源首页默认 1 页、历史默认 1 页；每轮预算 60 分钟，手动 `group_minutes` 可取 1–60。增量阶段最多使用剩余预算的 75%，之后轮转历史和待核验目录；增量提前结束时将剩余时间用于历史。两种阶段分别按尝试时间轮转，单成员最多使用 5 分钟。请求限速等待、分页和原消息请求均响应预算；尚未提交的页留给下一轮重放，绝不预先推进游标。

`query_collector_progress` 以 `(since, member_id)` 隔离采集范围，保存各来源游标及成员轮转时间。每页内容成功入库后才写检查点，修订号冲突返回 409，阻止旧进程回写过时进度；2026 范围完成不会覆盖原有全历史检查点。无 D1 进度时可从当前分支、同一 `collector.yml` 的最近已完成 artifact 初始化；D1 已有记录时优先采用 D1。真实写入与 dry-run 的 artifact 分别为 `group-state-2026-live`、`group-state-2026-dry-run`，保留 30 天。生产启用这版采集器前须先应用 `0008_misty_timeslip.sql` 并发布 API，否则采集应明确失败，不能静默改回临时文件。

`media` 与正文采集为独立 job，可并行运行，单轮补传预算 15 分钟；图片最多占用约前半段，余下时间留给视频，避免图片积压使视频永久排不上。私有媒体队列直接按已核验原文的时间筛选、稳定 ID 翻页，API 必须确认所请求的时间范围，避免扫描全部公开历史或让旧 API 忽略日期过滤。采集 job 软预算 60 分钟、步骤保险上限 65 分钟、job 上限 75 分钟，余量用于提交进度和清理；媒体 job 有独立保险上限。这些上限保护异常退出，不表示要求任务每轮必须跑满。
2026-10-20 用户确认转为线上采集：本地任务在当前成员完成后停止，范围检查点另存备份；仓库 Variable `COLLECTOR_MEMBER_SCOPE` 改为 `all`。Actions 的临时进度路径在执行步骤中从 `$RUNNER_TEMP` 写入 `$GITHUB_ENV`，因为任务级 `env` 不支持 `runner` context。线上首次运行从公开名单建立自己的轮转进度，保留生产库已有正文并按稳定 ID 幂等写入；后续运行优先通过 D1 检查点续采，artifact 保留为名单与进度备份。本地进度保留不删除，不表示已上传到 Actions。采集仍严格限制为北京时间 2026 年元旦起；来源失败与尚待续采分别报告，不将有限批次成功当作全量覆盖。

真实 GitHub 运行器访问 `data.gnz.hk` 的历史名单返回 403。默认历史目录不可用时，使用 `apps/collector/data/historical-directory.json` 中 2026-10-20 的公开精简快照；仅保存成员候选 ID、姓名、团／队和房间映射，不包含生日、正文、媒体或凭证。官网与主要社区目录仍实时读取；历史目录可用时优先使用实时内容，显式配置的其他历史目录失败时不会被快照替换。快照只提供候选及查询线索，不代替官方身份、作者及时间范围核验。


## 2026-10-23 故障恢复与结果报告

采集来源按连续 3 轮实际失败标红，隔离后 2/6/12/24 小时退避并到期自动探测。运行预算结束本身不算故障；已有持续错误及 48 小时增量过期仍使 job 失败。人工暂停不会被自动解除，历史核验缺口不阻断新增首页。身份周复查按持久化的每成员到期时间执行。

2026-10-26 降级与新鲜度修复：名单刷新临时失败时，有有效缓存则继续采集，报告 `rosterStatus=cached`、原刷新时间及失败次数；无其他采集故障时报告 `execution=degraded`，不再仅因名单累计失败使 job 标红。无缓存、鉴权失败、名单解析或校验失败仍中止。未曾成功核验增量、且已有访问／作者核验缺口的来源单列为 `unverifiedSources`，保留重试和游标，不计作增量过期，也不抢占已验证过期来源的轮转优先级。首次增量成功后，仍按 24/48 小时检查更新，历史缺口不能豁免；尚未尝试的来源和真实请求故障也不会因此被隐藏。报告另列 `freshnessFailures`，便于区分超时与来源实际故障。

collect job 将 health.json 单独保存为 collector-health-2026，media job 单独保存 media-health-2026；失败时也上传。进度恢复跳过旧版仅含报告的 artifact；全团模式还会继续查找有效名单，同时保留较新的独立范围检查点，避免被单成员 artifact 遮蔽。Actions summary 展示故障、新鲜度、暂停和下次探测时间。完整 JSON 包含所有来源，摘要最多展示 100 项异常，不含正文、媒体 URL 或凭证。媒体状态保存在私有 `/api/query/ingest/media-progress/{image|video}`，API 需先支持该契约再运行新版媒体任务；无需数据库迁移。

GitHub Actions 的安装改用 `node scripts/install-build-dependencies.mjs`，冻结锁文件，只对网络超时/限流/临时网络失败最多尝试三次。Cloudflare Workers Builds 需设置构建变量 `SKIP_DEPENDENCY_INSTALL=1`，并将原 build command 前置 `node scripts/install-build-dependencies.mjs && `。保留原部署命令、Git 仓库、分支和路径过滤。这样 pnpm 版本引导下载也进入受控依赖安装；平台更早的工具准备故障仍需单独处理，不能靠项目脚本消除。

2026-10-23 空成员优化：所有启用来源在当前范围内完整成功检查、且实际归档消息和图片都为零的已验证成员，每 30 天复查一次；其余成员继续小时轮转。检查点新增可选 `emptyCheckedAt`，沿用现有 D1 JSON，不需要迁移；待核验、未完成或失败不算空。新内容取消降频，新启用来源使旧证明失效。`group_progress.emptyMembersDeferred` 记录当轮降频成员数；正常 30 天间隔不计作 48 小时过期故障。
