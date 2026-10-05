# SoulsGuide 文档索引

本目录随源码版本控制，是项目文档入口。HTTP 路由以 [`openapi.json`](./openapi.json) 为机器可读契约；后端测试会把其中的 method/path 与 Express 路由做双向比对，任一侧漏改都会失败。

## 当前文档

- [SoulsGuide 技术学习与面试手册](../../souls-guide文档/学习与项目说明/SoulsGuide-技术学习与面试手册.md)：基于源码的技术事实、学习主线与面试准备，统一存放在工作区学习资料目录。
- [`architecture.md`](./architecture.md)：架构、权限边界、状态机与一致性策略。
- [`analytics.md`](./analytics.md)：创作者统计 v2 的指标口径、数据边界与接口参数。
- [`announcements.md`](./announcements.md)：公告生命周期、发布唯一性、版本与已读契约。
- [`deployment.md`](./deployment.md)：本地、Docker、HTTPS、迁移、备份与恢复。
- [`remediation-2026-09-02.md`](./remediation-2026-09-02.md)：第二次排障整改结果与尚需外部环境验证的事项。
- [`openapi.json`](./openapi.json)：OpenAPI 3.1 路由契约。

工作区的历史资料已分为 [学习与项目说明](../../souls-guide文档/学习与项目说明/) 和 [验收与测试记录](../../souls-guide文档/验收与测试记录/)，可从 [分类入口](../../souls-guide文档/README.md) 浏览。设计稿和专项复盘保留为背景资料；若与当前代码或本目录冲突，以数据库 migration、OpenAPI、测试和当前源码为准。
