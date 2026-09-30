# Connector Contract: TypeScript 数据源采集器

本契约用于 `cloud/data/` 中每个独立来源采集器；它规定行为，不固定类或文件名。连接器只获取并解释自己负责的来源，不直接写共享查询表。通用发布层负责 GCS 原始对象、BigQuery 装载与 SQL 校验、批次发布、检查点和同步健康。

每个连接器的 `source.json` 使用 [source-ids.md](../source-ids.md) 中唯一的规范 `source_id`，并记录 `topic`、`legacy_ids`、来源发布周期 `cadence_seconds`。需持续监测但更新不定期的来源还须在接入前设置 `check_interval_seconds`；该值是本平台的检查间隔，不是发布方的更新承诺。准入记录还须满足 [quality-rules.md](../quality-rules.md#1-来源准入记录) 的实际覆盖、完整性、配额、许可、保留期限和负责人要求；未知值不得以 `ready` 发布。

## Inputs

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `sourceId` | string | 必须使用 [source-ids.md](../source-ids.md) 的规范 ID 并在 DataSource 目录中注册；旧 ID 只能一对一映射，不能生成第二份记录 |
| `window.from`, `window.to` | ISO 8601 UTC | 半开区间 `[from, to)`；静态快照可用来源版本代替时间窗 |
| `checkpoint` | opaque string／null | 上一成功发布批次的游标，不来自“最后触发”时间 |
| `runId` | string | 本次执行标识，仅用于日志和排错 |

连接器返回：来源条款允许留存的原始批次元数据、零到多条来源记录、分页／完整性信息、建议的下一个 checkpoint、来源最新更新时间；用于 SC-002 抽样的记录还要保留可证明的首次上游可访问时间。只有当所有页面和必要关联数据完整、BigQuery 写入完成且 SQL 质量校验通过时，通用发布层才将批次标记为已发布。失败必须返回明确错误类别：`rate_limited`、`upstream_unavailable`、`schema_changed`、`auth_failed`、`incomplete_window` 或 `validation_failed`。

## Required behavior

1. **幂等**：相同来源、窗口和源版本重试时，产生同一逻辑记录 ID。分页重取、重叠窗口及 Scheduler 重复触发不产生额外当前记录。
2. **完整性**：某页失败不能把已成功的前几页当作整批发布；静态快照需有完整导出或行数校验。
3. **时间**：分别提供来源发布时间／观测时间与抓取时间。源时间不明时显式为 null。
4. **速率**：遵守来源配额和 `Retry-After`；重试使用退避及上限。不得依靠高频轮询弥补上游更新慢。
5. **权限**：第三方 key 从运行环境注入；URL、错误和结构化日志不得包含 key、令牌或完整受限新闻内容。
   采集和 GCS 原始留存同样受来源许可控制；许可缩小时停止提供受限字段并清理受限副本。
6. **地理**：原始地点字段不覆盖。归一化层可以产生位置候选及证据，不能无依据地产生精确点。
7. **版本**：活动取消、报道更正、限制变化与事故解除都生成新版本；不得静默覆盖旧记录。
8. **健康**：每次执行都输出检查时间、来源最新时间、输入／接受／拒绝数量、最终状态与错误码。

## Source-specific acceptance

| 来源组 | 合格样本行为 |
| --- | --- |
| 行人每分钟计数 | 15 分钟重叠窗口中，同一 sensor/minute 不重复；缺失分钟不补零；短窗口漏取被检测出来 |
| 车位三表 | `marker_id` 对车位空间、`bay_id` 对单车位规则；无匹配时保留缺项且不声称可合法停车 |
| GDELT | 从文章／GKG 元数据留原始 URL；海外同名 Melbourne、不确定事发地标为未定位 |
| 道路中断 | 事件和受影响路段保持父子关系；来源解除时当前状态更新 |
| Ticketmaster | 按原始事件 ID 合并分页及改期／取消版本，保存场馆位置和来源 URL |
| ABS／CSA | 每次导入有发布版本、统计期、地域代码；空值和抑制值与数值零分开 |

## Planned operator interface

实现阶段提供以下稳定命令；此处仅是接口约定，仓库目前尚无可运行的 `cloud/data` 包：

```text
npm --prefix cloud/data run ingest -- --source SOURCE_ID --from ISO_TIME --to ISO_TIME
npm --prefix cloud/data run ingest -- --source SOURCE_ID --backfill
npm --prefix cloud/data run verify -- --source SOURCE_ID --batch BATCH_ID
```

退出码 `0` 表示批次已发布且验证通过；非零表示未发布或失败。命令输出只含批次 ID、计数、状态和无秘密的错误信息。
