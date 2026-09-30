# Phase 0 Research: 数据采集与统一查询

**日期**：2026-09-28。只采用发布方或产品官方文档；每项决定列出理由和备选方案。

## 1. 运行时与部署

**Decision**：后端数据采集使用 TypeScript、[Node.js 24 LTS](https://nodejs.org/en/about/previous-releases)，以 GCP [Cloud Run Jobs](https://docs.cloud.google.com/run/docs/execute/jobs) 运行，按来源节奏由 [Cloud Scheduler](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule) 触发。Cloud Run、Cloud Storage 和 BigQuery 使用 Melbourne `australia-southeast2`；Cloud Scheduler 使用 Sydney `australia-southeast1`，通过认证请求触发墨尔本任务。

**Rationale**：定时批次采集是会完成的工作，不需要保持 HTTP 服务器常驻。后续查询服务另建 Node.js Cloud Run service。既有 Flutter 客户端不受本次后端语言决定影响。

**Alternatives considered**：常驻 Node 服务内的定时器容易受实例伸缩和重启影响；Cloud Functions 也可触发，但按来源可重放、批次执行和独立配置更适合 Jobs。

## 2. 持久化、重试与发布

**Decision**：GCS 仅在来源条款允许时保存不可就地改写的原始资料批次，并按许可期限保留短期 ndJSON 导入文件；检查点清单不含受限正文。许可缩小时删除受限副本。规范化记录从第一批开始写入 BigQuery managed tables。每个批次有稳定 ID、来源、窗口、摘要与版本。使用 GCS [generation precondition](https://docs.cloud.google.com/storage/docs/request-preconditions) 做条件创建与清单更新；BigQuery 中整批写入并通过 SQL 校验后，才写入发布标记、推进 checkpoint。迟到和更正的记录通过重叠时间窗重取，按来源 ID 与来源版本选择当前值。

**Rationale**：[Cloud Scheduler 至少一次投递](https://docs.cloud.google.com/scheduler/docs/overview)，Cloud Run Job 也可能重试；触发成功只表示任务已启动。条件写入和可重放窗口使重复执行无害。检查点按连续完成窗口推进，防止并发任务跳过失败窗口。[Cloud Run 本地文件系统不持久](https://docs.cloud.google.com/run/docs/container-contract)，不能成为唯一数据存储。

**Alternatives considered**：只保存“最新状态”无法重算、审计和处理上游更正。GCS 原始文件不包含许可未确认的新闻全文。

## 3. BigQuery 写入与统一查询

**Decision**：BigQuery 自首批采集起承担规范化存储、质量校验和统一 SQL 查询。低频快照及较大批次先生成 GCS ndJSON，再用[原子 load job](https://docs.cloud.google.com/bigquery/docs/loading-data-cloud-storage-json)导入；每分钟刷新的道路中断等高频来源使用 [Storage Write API](https://docs.cloud.google.com/bigquery/docs/write-api-intro)。两条路径都写入带 `batch_id` 的追加表。写入完成并经 BigQuery SQL 检查不同逻辑键数量、同键内容一致性、字段与位置约束后，发布标记才对只读视图开放该批。当前视图按稳定键和来源版本去重，确保重试不产生重复的当前记录。

**Rationale**：BigQuery 提供托管共享表、并发 SQL 和 [`GEOGRAPHY`](https://docs.cloud.google.com/bigquery/docs/geospatial-data)。[批量 load job 的每日配额](https://docs.cloud.google.com/bigquery/quotas)使逐分钟、逐来源的微小装载不合适；按来源频率分别选择 load job 与 Write API。Storage Write API 默认流提供至少一次写入语义；本设计依赖稳定批次 ID、已发布批次过滤和确定性去重，不把一次成功调用当作恰好一次写入。费用通过分区／聚类、[dry run 与最大计费字节限制](https://docs.cloud.google.com/bigquery/docs/best-practices-costs)控制。所有 GCS bucket 与 BigQuery dataset 放在 Melbourne 区域，避免跨区域装载问题。

**Alternatives considered**：同时维护独立查询引擎会增加同步和语义一致性工作；用户已决定直接以 BigQuery 为统一 SQL 平台。GDELT 曾[提供 BigQuery 公共表](https://blog.gdeltproject.org/gdelt-2-0-our-global-world-in-realtime/)，但该说明较旧，实施前需验证其更新状态及[数据集区域限制](https://docs.cloud.google.com/bigquery/public-data)；不假定它可直接与 Melbourne 数据联查。

## 4. 来源获取策略

| 来源 | Decision | Rationale / alternative |
| --- | --- | --- |
| City of Melbourne Opendatasoft | 用 [Explore API v2.1](https://data.melbourne.vic.gov.au/api-console/explore/v2.1/) 取时间窗口增量；用 exports 获取初始快照／回补 | 记录端点有分页限制，exports 适合批量。车位传感器可能[网络延迟](https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bay-sensors/)；必须读来源更新时间 |
| 行人计数 | 至多 15 分钟间隔取最近一小时，并重叠重取、按传感器＋分钟去重 | [来源](https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-past-hour-counts-per-minute/)约每 15 分钟发布，缺记录不代表零；超过一小时的漏跑标为分钟数据缺口。[小时历史资料](https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-monthly-counts-per-hour/)仅作不同粒度补充 |
| 停车限制 | 传感器按 `marker_id` 连车位空间，按 `bay_id` 连[单车位限制](https://data.melbourne.vic.gov.au/explore/dataset/on-street-car-park-bay-restrictions/) | 不能以传感器空位状态推断可合法停车；如果 ID 缺失，保留未关联 |
| GDELT | 优先 15 分钟 GKG／文章元数据与 URL，依据[官方数据目录](https://gdeltproject.org/data.html)取批次；区分报道地点与事发地 | GDELT Event 行不是一篇新闻；DOC 是可评估的[文章检索接口](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)；不以纯关键词 “Melbourne” 当地理证明 |
| Transport Victoria 道路中断 | 使用[非计划中断接口](https://opendata.transport.vic.gov.au/dataset/unplanned-disruptions-road)，遵守 KeyID 与配额，保留事件及受影响路段 | 每 60 秒刷新；计划工程用独立来源和未来有效时间 |
| Ticketmaster | 用[Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/)按国家、位置和日期取活动，按事件 ID 处理更改与取消 | 需开发者密钥；只覆盖其平台活动，不能假设全城活动完整 |
| Victoria Police 新闻 | 先核实[公开页](https://www.police.vic.gov.au/news)自动获取与内容使用许可，再决定直采；不使用[认证记者邮件服务](https://www.police.vic.gov.au/news-article-subscription) | 未发现已确认的公开 API；先从 GDELT 取得可追溯犯罪报道候选，样本不足则须寻找合法替代来源 |
| ABS／CSA | 以完整版本文件导入，记录发布年、统计期和地理代码 | [ABS Census](https://www.abs.gov.au/census/find-census-data/datapacks)及[CSA 季度统计](https://discover.data.vic.gov.au/dataset/data-tables-recorded-offences)不是动态警情；与边界版本配对 |

## 5. 凭据与用户 access

**Decision**：规划阶段无需 GCP access。部署前用户只需提供非秘密的 GCP project ID、拟用区域和是否已关联 billing；用户名、密码、令牌、service account JSON 私钥都不进入聊天、仓库或日志。本地按 Google [ADC 指南](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)由用户自行登录，优先[service account impersonation](https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation)。云任务使用[专用服务身份](https://docs.cloud.google.com/run/docs/securing/service-identity)；第三方 API key 由用户写入 [Secret Manager](https://docs.cloud.google.com/secret-manager/docs/best-practices)，只授予需要的任务读取权限。

**Rationale**：避免可长期使用的私钥文件和聊天中的秘密；权限可按存储桶、任务与单个密钥划分。采集写入身份不需要全项目 Owner，也不需要读取所有历史数据。控制成本的角色和查询身份另行限定。

**重要边界**：若助手与用户以同一个本机 OS 身份运行命令，或助手可部署会读取密钥的云端代码，就不能从技术上保证“助手可使用权限但绝对看不到凭据或数据”。可以做到**不主动读取、输出或记录**秘密，并通过最小权限缩小范围。若要求严格隔离，需由用户掌握凭据和最终部署权限、审查待部署代码，或将运行环境与助手权限分开。此限制不能靠把 key 放在某个同权限文件夹解决。

**Alternatives considered**：直接交付 service account key JSON 增加泄露和轮换风险，Google 的[密钥管理建议](https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys)也建议尽量避免。把密钥放进 `.env` 或聊天不符合项目规则。
