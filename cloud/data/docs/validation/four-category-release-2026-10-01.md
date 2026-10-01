# 四类别开发环境发布：2026-10-01

## 发布目标与实际结果

停车、一般新闻、本地犯罪新闻、活动各由一个 subagent 交付，root 集成、部署和查询核验。目标为已有 GCP 开发项目 `melens-510012`，BigQuery `melens_ingest` / `melens_query`、Cloud Run 和对象存储位于 `australia-southeast2`；Scheduler 位于 `australia-southeast1`，以下时间均 UTC。

| 类别 | 已发布数据与查询 | 明确的限制 |
| --- | --- | --- |
| 停车 | `v_parking_current` 29,053 官方车位点；`v_parking_sensor_current` 6,324 传感器；`v_parking_rule_reference` 8,035 参考规则 | 规则最近处理为 2022-11-13，无已核实当前三表 crosswalk，`may_park_now` 不得为 yes；空置不是合法停车许可 |
| 一般新闻 | `v_news_current` 包含持续采集的 GDELT 元数据；10 个核实逻辑事件、3 个原出版日期、10 个官方地区关联、0 个精确 Point | 更多候选报道不保证原发布日期；GKG 处理时间不冒充出版/事发时间；地理为提及地区 |
| 本地犯罪 | `v_crime_news_current` 6 个核实报道、6 个出版日、0 个精确 Point；`v_crime_area_statistics` 1,620 指标、81 原始地区标签、10 统计期 | 后续犯罪候选标记 `gdelt_theme_candidate`/`local_occurrence=unverified`/`review_required=true`，不表示定罪或确认本地案发；CSA 不与新闻混算，未知边界代码/版本为 null |
| 活动 | `v_events_current` 419 未取消活动，其中 372 未来有日期，419 坐标与链接；完整提供方快照 421 条、38 场馆 | CBD 80km 圈不是 Greater Melbourne 法定面；没有全面免费/社区活动覆盖；47 条未计入 confirmed future；缓存公开上限 24h |

查询原文见 [four-category-readback.sql](four-category-readback.sql)。本轮新增六个独立数据集（停车三表、GDELT、CSA、Ticketmaster），加此前六个，共 **12**。GDELT 一般/犯罪新闻只计一个来源。11 个 `verified_open`，Ticketmaster `restricted`。八类样本门槛为 **5/8**：新闻、犯罪、活动、行政边界、区域统计；停车完整法律规则、行人和交通中断未通过。

## 实际 Cloud Run 发布批次

| 来源 | 成功执行 | 批次/输入/输出/拒绝 |
| --- | --- | --- |
| 停车车位 | `melens-dev-melbourne-parking-bays-xl2lz` | `batch_5fa7c1613ada47aff560d199d6afda009e2d7844` / 29,053 / 29,053 / 0 |
| 停车规则 | `melens-dev-melbourne-parking-restrictions-774cb` | `batch_b9957935654a3091cd6d1948065398cc2b8ec1d8` / 4,263 / 8,035 / 0 |
| 停车传感器 | `melens-dev-melbourne-parking-sensors-s9hwg` | `batch_aa70af2ad1512e546d2c02f0c3257b5484654038` / 6,324 / 6,324 / 0，12:30:20 published |
| GDELT 初始连续窗口 | `melens-dev-gdelt-news-xpsdh` | `batch_49d94e5043f00aae6cadce4ff0638e570412707c` / 10 / 10 / 0；11:45–12:00 |
| CSA | `melens-dev-victoria-csa-recorded-offences-4zncd` | `batch_89389c5fbb8d045b78cc3b7cdb4e9fc2a3f36203` / 810 / 2,430 / 0（含 source facts + indicators） |
| Ticketmaster | `melens-dev-ticketmaster-events-29j8r` | `batch_77e407d3dc317380ca8c849c862cca2c4e929dfe` / 421 / 421 / 0 |
| Ticketmaster 认证 Scheduler 更新 | `melens-dev-ticketmaster-events-9zds6` | `batch_5578459b222098ace9b0c724f8952aaed2696892` / 421 / 421 / 0，12:50:11 published |

GDELT 七个官方历史窗口回补实际全部成功：Sep6 20:15、Sep8 03:45、Sep11 04:00、Sep23 03:00、Sep28 12:45、Sep29 10:30、Oct1 10:30 各 15 分钟。它们提供近期覆盖样本，未声称全量历史扫描。Oct1 12:00–12:15 手动连续窗口成功后，自然 Scheduler `fxdsl` 于 12:30 发布 11 条并推进 checkpoint 至 12:30；`gg8dj` 于 12:45 发布 3 条并推进至 12:45。严格 UTF-8 不合格的 ZIP 会拒绝整窗，不推进 cursor。

## 身份、查询与保留

- 已实际应用 13 ingestion tables、25 query views、13 authorized direct-raw view grants。查询身份只读授权视图；新增六个来源均有专用运行身份和 verified IAM，Ticketmaster 仅能读取自己的 Secret，Job 注入已启用版本 `ticketmaster_discovery_api_key:1`。
- 每来源有每日请求限额、执行限额、500MB 单次查询上限、来源锁。分钟级控制状态写入采用 DML，避免 `data_sources` 每日 load job 超限；业务 facts 用 Storage Write。原始响应不保存，staging 发布后删除。
- 停车无变化只追加完整成员和 snapshot proof；业务版本/坐标/占用引用复用，A→B→A 生成新业务 generation；最新完整空快照移除旧成员，失败快照不覆盖成功快照。清理保留仍被最新快照引用的业务事实，陈旧快照不伪造 current。
- GDELT 元数据可见/留存 30 天。Ticketmaster 当前/历史/证据视图均有 24h expiry，源内容清理每 6h 删除超过 18h 的行，提供来源级撤回清除命令。停车 membership 24h，业务历史 48h，但保护 latest references。
- 私有 `melens-dev-source-retention` 的自然 12:11 调度 `9d922` 已成功。零过期内容时删除数为零是正常；真正过期删除和 retained-reference 正例另由下面的真实 GCP fixtures 验证。清理不在预算暂停来源列表内。

## 已执行验证

- 普通 Node24 测试：727 tests、712 pass、0 fail、15 opt-in skipped。Python infrastructure **21/21**。
- 真正 GCP：停车生产视图 **2/2**；停车过期/引用保护/冷恢复/空快照 **4/4**；新闻真实行/对象删除及来源隔离 **7/7**；活动真实 publisher/current lifecycle **1/1**。隔离 datasets/buckets 已 cleanup。
- 认证 Scheduler dispatch 再次触发车位 `r7vr4`、规则 `p82kb`、CSA `7gj6b`，全部成功；静态源同版本重放保留稳定 batch。Ticketmaster 第二完整捕获产生新 snapshot batch。自然新闻两次成功。日/12h sources 下一次自然时刻未观察，不把认证手动 dispatch 冒称为自然连续样本。

## A$100 开发预算与成本

项目已有月度 A$100、50/80/100% 告警，真实私有认证预算响应已验证；允许暂停列表已刷新为 **8** 个来源调度（之前两个 + 新增六个）。预算通知可能延迟，不是硬性停费。停车两分钟调度启用前测了三次真实运行：443,547,648 → 509,607,936 → 320,864,256 计费字节；第二/第三无 LOAD jobs，第三完成 39.3 秒。空表存在校验省去无用跨表 joins，仍拒绝任何非空物理行。进一步来源谓词和 latest-members 查询降低扫描，最终测量和启用状态补记于下节。

每 120 秒约 21,600 次/月；按第三次估计约 6.30 TiB 查询/月，实际业务变化和表增长会改变费用。Cloud Run Jobs 最低每任务计费一分钟，月约 1,296,000 vCPU-seconds；不能按 39 秒估算全部费用。最终降低至 512MiB 需真实 Job 成功验证。使用 [BigQuery pricing](https://cloud.google.com/bigquery/pricing) 和 [Cloud Run pricing](https://cloud.google.com/run/pricing) 的 Melbourne/AUD SKU 估价，其他查询、构建、存储和地图费用单独计入；这里不宣称 A$100 是硬性最高账单。

## 本地诊断凭据事件与处理

活动 agent 的辅助 SDK metadata 诊断与 fixture cleanup 竞态产生 404，未捕获的 SDK 请求对象把短期 OAuth Authorization header 打印到工具输出。未读取/输出第三方 Secret、refresh token 或密码，未保存该输出至源码文件。诊断已停止，root 实际执行 `gcloud auth application-default revoke --quiet`，结果 `Credentials revoked.`；随后 CLI project describe 成功。Cloud Run 专用身份与 CLI 继续发布，不依赖已撤销的本地 ADC。测试错误已改为固定数值 code，避免 SDK response/request 内容泄漏。

本地 SDK 需要时由用户重新执行 `gcloud auth application-default login`。参见 [官方 revoke 命令](https://docs.cloud.google.com/sdk/gcloud/reference/auth/application-default/revoke)。不在此保存令牌或密钥值。

## 原特性仍待验收

四类别数据采集已发布，原 feature 全部首期验收尚未完成：T035/T037/T039 的当前权威规则和三表样本、行人/交通 P0、SC-002 连续 24h 上游分母、SC-004 两名独立人工审阅，以及部署后的 SC-003/SC-005/SC-006 抽样/计时。T042 已完成，原 tasks **63/77**，T077 保持 open。详情见各类别 [停车](parking-release-2026-10-01.md)、[新闻](general-news-release-2026-10-01.md)、[犯罪](crime-news-release-2026-10-01.md)、[活动](events-release-2026-10-01.md)。

## 最终镜像与云端读回

Cloud Build `22a56bf7-c0fa-4ab1-a82b-e0256cc2aacf` 于 12:59:08 完成，最终 image：

```text
australia-southeast2-docker.pkg.dev/melens-510012/melens-data/data@sha256:119c7b7e8117afdac13e6da349e3449f17527070ec99958d5f2ea85f4b6fc83e
```

新增六个来源 Jobs 和 source-retention Job 全部更新到此 immutable image，停车 sensor 为 1 vCPU / 512MiB / 120s timeout / zero retries。最新普通测试 727/712 pass、0 fail、15 opt-in skipped；21 Python infrastructure tests passed。犯罪 enrichment 变化纳入稳定 sourceRevision，保证旧窗口新分类获得新 batch，同输入与重复 enrichment 保持稳定。

12:55 只读查询实际得到 131 一般报道、10/3/10/0 核实目录样本，犯罪 6/6/6/0 核实样本，CSA1620/81/10，活动419/372/419/419。该时刻停车尚 PAUSED，fresh_sensors=0，查询如实显示陈旧，不把手动采集冒充持续刷新。保存的非敏感聚合见 [readback JSON](four-category-release-readback-2026-10-01.json)。最终 sensor 优化执行与自然调度结果在后续补记。

最终停车执行 `melens-dev-melbourne-parking-sensors-q9glz` 实际以 512MiB 成功，13:00:33.250592–13:01:18.550757，45.3s；发布 `batch_063b761d38265ce7fd55db1e704628401b75c1e6`，6,324/6,324/0。GDELT 新镜像的自然 13:00 执行 `rl2pg` 成功，3/3/0，checkpoint 连续推进 13:00，batch `batch_ade765472390de7b46a1090fac076cf92af3c129`。

最终 sensor 单次实际 23 BigQuery jobs、**230,686,720 bytes = 220 MiB**、0 LOAD、51,711,892 processed bytes；相对第二次 509,607,936 下降 54.73%。按 30 天 21,600 次，查询约 **4.53 TiB/月**（31 天约 4.68），Cloud Run 按最低 60 秒、1 vCPU/0.5GiB 的数量预算。其他来源/查询/构建也占项目预算，月费用仍以账单为准；50/80/100% 及暂停控制保持。停车 */2 调度已 ENABLED，以下表列全部新来源的启用 cron。

| 来源/维护 | UTC cron | 地位 |
| --- | --- | --- |
| sensors | `*/2 * * * *` | ENABLED，120s 官方节奏 |
| bays | `25 1 * * *` | ENABLED，每日快照检查 |
| restrictions | `30 1 * * *` | ENABLED，检查旧资料是否更新，不将其变成当前许可 |
| GDELT（一般+犯罪） | `*/15 * * * *` | ENABLED，15min 官方窗口 |
| CSA | `35 1 * * *` | ENABLED，每日发布版本检查 |
| Ticketmaster | `40 */12 * * *` | ENABLED，每12h完整未来30天快照 |
| source-retention | `11 */6 * * *` | ENABLED，独立私有保留任务 |

一次 guarded GDELT 历史窗口复核 `bpzcv` 也已成功，使用新 classifier/revision image。重复或新版本有稳定逻辑键；回补不把 checkpoint 向旧时刻回退。

自然 13:04 停车 Scheduler 执行 `w28s6` 成功，13:04:03.251997–13:04:46.565735；batch `batch_cef9de61302666cbdec1b5bd43da4426892fdb5b`，6,324/6,324/0。随后只读聚合得到 6,324 located sensors，其中 5,284 的 `source_freshness=current`、3,568 reported vacant、0 legal yes；其他传感器的旧/未知上游时间如实保留，完整重新采集不意味着每设备产生新观测。最终一般报道总数为 134，核实 10/3/10/0 样本不变，crime6/6/6/0，活动419/372不变。新源六个 Scheduler 全 ENABLED；共八个 source schedules，另两个 cleanup schedules。具体聚合查询有先后时间，不是跨查询事务快照。
