# 创作者统计口径 v2.1

## 原则

统计系统把“当前状态”和“周期行为”分开：`likes`、`favorites`、`comments`、`follows` 表示当前仍然有效的关系；`analytics_events` 是只增不改的历史事实。趋势只能按事件实际发生时间计算，禁止把文章当前累计值回填到文章创建日。

数据库与接口统一使用 `Asia/Shanghai`。接口通过一次 `REPEATABLE READ` 事务生成完整响应，并返回 `generated_at`、`data_since` 与 `definitions_version`。

## 指标定义

- 已发布文章：当前 `status=published` 的文章数。
- PV：文章正文成功渲染后上报、通过文章可见性、作者排除、明显机器人过滤和 IP 限流的访问；同访客同文章 10 秒内重复请求只记一次。
- UV：所选时间范围内至少产生一次有效阅读的独立访客数。登录用户按用户 ID 单向哈希，游客按本地随机 ID 单向哈希；原始标识不落库。
- 当前点赞/收藏/评论：当前关系表中的有效记录，排除作者本人产生的互动。
- 新增：周期内发生的正向事件数量。
- 取消/删除：周期内发生的反向事件数量。
- 净增：新增减去取消或删除。
- 阅读用户互动率：同一周期、同一筛选范围内，产生有效阅读且至少点赞、收藏或评论一次的登录用户数，除以周期 UV。排行按同一文章匹配，分类按同一分类匹配；未产生有效阅读的互动仍计入动作新增，但不计入此比例的分子。游客阅读计入 UV；游客登录前后的身份不强行合并，因此该指标不宣称精确跨身份归因。接口 `engaged_users` 表示这一读者交集，口径版本为 2.1。
- 分类篇均 UV：分类周期 UV 除以当前已发布文章数，仅用于辅助判断，样本过小时不应单独决策。

粉丝新增/取消是创作者全局指标，游戏和文章分类筛选只影响内容指标，不对粉丝行为做无依据的内容归因。

## 数据边界

`003_analytics_metrics` 上线前没有可靠事件历史。迁移只将既有公开文章的 `created_at` 作为 `published_at` 估算基线，不会把既有累计浏览、点赞或评论伪造为历史趋势。页面在查询范围早于 `data_since` 时必须展示基线提示。

文章首次审核通过时写入 `published_at`，再次审核不改写首次发布时间。文章详情 GET 无统计副作用，有效阅读由 `POST /api/posts/{id}/view` 独立上报。

## 数据结构

- `analytics_events`：事件事实，可用于复算与审计。
- `analytics_daily_metrics`：post/creator 两种粒度的日聚合，用于快速趋势查询和一致性复核。
- `analytics_daily_visitors`：日 UV 幂等集合。
- `analytics_view_sessions`：阅读上报短时防重状态。

当前数据量下，筛选和周期 UV 从事实表精确计算；日聚合作为快速趋势与未来扩容基础。数据规模增长后可将已封账日期完全切换到日聚合，仅实时计算当天。

## 统计接口

`GET /api/creator/stats` 支持：

- `from`、`to`：闭区间日期，最长 366 天；
- `game_id`、`category`、`post_id`：内容过滤；
- `rank_by`：`pv`、`uv`、`likes_added`、`favorites_added`、`comments_added`、`engagement_rate`。

响应分为 `meta`、`current`、`period`、`comparison`、`trend`、`top_posts`、`category_performance`。字段结构以 `openapi.json` 和前端 `CreatorStats` 类型为机器契约。
