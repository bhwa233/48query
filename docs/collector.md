# 48query 图文采集器

2026-10-19：按已确认的[图文范围](text-image-collection-review.md)实施。采集器不再调用录播接口，ingest 拒绝非空 `recordings`。原有录播表保留为历史数据，网页旧录播地址跳转至消息页。验证和上线状态见[实施记录](text-image-implementation.md)。

## 本地运行

默认仅运行合成演示源和 dry-run store，不访问 Pocket48 或图库：

```sh
pnpm collector:dev
```

真实源需本地登录凭证，或者同时配置 SparkHub 的凭证读取地址和读取令牌。手机号、短信与凭证不写进代码、页面或日志。

```sh
pnpm --filter @starter/collector login
COLLECTOR_SOURCE=pocket48 COLLECTOR_DRY_RUN=1 COLLECTOR_MAX_MEMBERS=1 COLLECTOR_MAX_PAGES=2 pnpm collector:run
```

dry-run 仍会读取所选上游源，输出只有数量、类型和同步状态，不上传图片、不写 D1。正式写入需设置 `INGEST_API_URL`、`INGEST_KEY`，并将 `COLLECTOR_DRY_RUN` 设为 `0`；缺少写入配置会报错，不会悄悄改成演示运行。

## 来源与范围

`COLLECTOR_SOURCES` 默认启用全部七类，逗号分隔可缩小验证范围：

| 来源 | 内容 |
| --- | --- |
| `room` | 全房间接口中经过目录核对的成员发言，包括其他成员来访 |
| `album` | 房间相册中的成员图片，跳过视频与未确认发送者 |
| `essence` | 经过成员身份过滤的精华消息 |
| `posts` | 成员公开动态 |
| `post_images` | 成员公开动态图片列表 |
| `weibo` | 口袋内分享的微博，不抓站外微博 |
| `room_posts` | 房间中分享的公开动态 |

正文解析支持新旧文字、图片、图片表情、公开回复、礼物回复、文字翻牌和投票文字。语音、短视频等仅保存类型占位，不请求媒体文件或转写。系统和直播通知不计入图文统计。账号私信与粉丝完整聊天不保存。

默认从账号关注列表筛选成员。`COLLECTOR_MEMBER_ID` 可单独指定一个成员，`COLLECTOR_MEMBER_SCOPE=all` 可使用目录候选名单；都不会自动关注或进房，也不保证账号有读取权限。房间 ID、频道 ID、实际作者分别处理；没有可确认的发送者 ID，不归为成员消息。

## 图片图库

参考 `galaxy-spider/src/utils/upload.ts`，使用 `https://gallery233.pages.dev/upload` 的 multipart `file` 上传协议，读取响应数组的 `src` 和可选 `thumbnail.src`。`GALLERY_BASE_URL` 可配置相同协议的 HTTPS 图库。

使用 Node 原生 fetch 保留 JPEG、PNG、GIF、WebP 原始内容，不增加 axios／sharp，不转为视频或做 OCR。下载检查可信图片域名、每次重定向、文件签名、50 MiB 上限和超时；上传网络错误、429 和 5xx 最多尝试三次，其他 4xx 留待排查。

图片由源 URL 的 SHA-256 定位到上传缓存。已保存的图库地址不会因相册或精华再次出现而重复上传；同一文件使用不同源 URL 时仍可能形成两个附件，不声称按文件内容全局去重。

上传进度独立写入 `query_images`。图片失败后仍保存文字、源图片和关联记录，状态为 `failed`；下次运行先重试 `COLLECTOR_IMAGE_RETRY_LIMIT` 条（默认 25），然后继续各源采集。无有效图库地址不能标记上传成功。网页支持图文筛选、图片查看和上传状态。

## 同步与入库

每成员、每来源在 `query_source_sync` 中保存独立状态：最新确认边界、未完成增量游标、待确认的新边界、历史回溯游标、是否到末页、最后请求成功／取得内容的时间及错误。

每次先从最新页检查新内容，未完成的增量从其游标续读；历史从独立游标续读。跨越旧时间边界后才提交新的最新边界，重复消息按稳定 ID 幂等入库，同时间戳不会只按日期翻页。`COLLECTOR_MAX_PAGES` 是每来源的增量与历史各自页面预算，不是全任务请求上限。

入库单次最多 25 条消息，按 UTF-8 JSON 实际字节数分片，`/ingest/unit` 上限为 128 KiB。中间片不提交新来源状态，最后一片与消息在同一 D1 batch 中提交；失败后可重读而不漏写。一个完整消息仍超过限制时明确报错，不截断正文或跳过游标。

未知响应结构、重复的非空游标、已确认成员消息缺少稳定 ID／时间等情况会保留进度并报错。空结果不等于历史完整；房间始终没有取得可确认成员内容时，批次标记未验证。各扩展源失败独立记录，继续其他来源；批次错误会使生产任务失败，避免把部分结果宣称为全量成功。

## 验证

`pnpm check` 覆盖 lint、类型、解析和同步回归、构建；`pnpm test:smoke` 使用真实迁移与临时本地 D1 验证 HTTP 入库、失败续写、分页和拒绝录播；`pnpm test:e2e` 验证真实本地 API 的成员导航、问答检索、图片查看及移动端布局。测试数据仅写临时数据库。

生产是否可读仍以当前账号的非空样本为准，不能以参考源码、合成测试或返回 200 代替验收。
