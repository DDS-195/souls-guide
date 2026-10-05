# 架构与工程边界

## 运行结构

```text
Browser → Nginx(TLS/static/range) → Express → MySQL
                                  └→ uploads + FFmpeg/ffprobe
```

后端使用 `route → controller → service` 分层。所有复合写入（文章与标签/媒体/资产、审核与通知、申请与角色、公告发布、游戏排序、互动计数、用户删除重算）在 MySQL 事务内完成。

公告采用冻结发布版本：草稿通过乐观锁编辑，发布后只能归档或复制为新草稿。`announcement_channels.global` 是固定事务锁和唯一公开发布槽，`announcement_events` 在业务事务内保存完整状态快照；具体契约见 [`announcements.md`](./announcements.md)。

## 权限与状态

- `user`：阅读、互动、关注、举报、申请创作者。
- `creator`：创建/编辑本人文章与上传资产。
- `admin`：审核、用户、游戏、公告、举报、通知和日志管理。
- 公开内容只接受 `published`；草稿编辑走受保护的 `/api/posts/manage/{id}`。
- 修改密码会递增 `token_version`，历史 JWT 立即失效。

文章状态机：

```text
draft → pending → published
           └──→ rejected → pending
published --编辑--> pending
```

## 媒体资产

上传先写入 `upload_assets(temporary)`，文章保存时验证 owner 并写 `post_assets`，随后转为 `attached`。删除文章或替换媒体只解除引用；无引用临时资产延迟回收。服务端验证图片魔数、视频合并 MD5，并用 ffprobe 决定是否转为 H.264/AAC、最高 1080p/30fps。生产环境缺少 ffmpeg/ffprobe 会拒绝启动相关处理，而不是静默绕过。

## 可观测性

每个请求返回 `X-Request-Id`，访问日志和 5xx 错误日志记录同一 ID。日志按日写入，旧日志后台 gzip，默认保留 30 天。管理写操作另写数据库审计日志。

## 搜索口径

当前是学习型/小数据量项目，中文标题搜索明确采用 `LIKE`。未配置 MySQL ngram 分词，因此不再保留或宣称使用无效的 FULLTEXT 索引；数据规模增长后应接入 ngram FULLTEXT 或独立搜索服务。
