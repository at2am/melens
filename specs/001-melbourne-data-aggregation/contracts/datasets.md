# Dataset Contract: 可追溯的地理数据

这是采集层对后续地图和 Agent 查询层的稳定数据接口。**BigQuery 从首批来源开始就是规范化数据与查询层**；GCS 保存原始批次、短期导入文件及检查点。字段定义参见 [data-model.md](../data-model.md)。调用方不能访问第三方来源 key 或原始受限正文。

## Storage and publication layout

```text
gs://<bucket>/raw/<source_id>/ingest_date=YYYY-MM-DD/<batch_id>/<content_hash>.<source_format>
gs://<bucket>/staging/<source_id>/ingest_date=YYYY-MM-DD/<batch_id>/part-*.ndjson
gs://<bucket>/manifests/<source_id>/current.json

<project>.melens_ingest.<canonical_table>       # BigQuery 追加表，采集身份可写
<project>.melens_ingest.sync_batches            # 批次状态与发布标记
<project>.melens_query.v_*                     # BigQuery 已批准的只读视图
```

原始区按来源许可限制访问；只保存允许留存的字段，`staging` 导入文件按来源许可与保留期限清理。原始对象一经写入不可就地修改，但许可撤销时可删除受限副本；保留不含受限内容的审计信息。`current.json` 含规范 `source_id`、连续完成窗口的 `checkpoint`、最近已发布 `batch_id`、`published_at`、允许留存的对象 URI、行数、来源最新时间、schema 版本和内容摘要，不含凭据。清单用 GCS generation precondition 更新；它是采集游标，不是下游查询入口。

低频／大批次用 GCS ndJSON + BigQuery load job；高频来源用 Storage Write API。规范化行先进入 `melens_ingest` 追加表。每条事实记录必须带稳定 `batch_id`、`source_id`、`schema_version`、`fetched_at`、逻辑记录 ID 与来源版本 ID。相同批次重试可以写入重复物理行；SQL 验证期望的不同逻辑记录数、同键内容一致性与约束后，才写入 `sync_batches.state = published` 的标记。视图只读已发布批次，按稳定键、来源版本与确定性顺序选当前值。发布标记不能先于完整写入和校验；失败批次的物理行保持不可见，后续按保留策略清理。对同一 `batch_id` 的并行重试需要任务级互斥或发布前复核，防止检查和发布间写入变化。GCS checkpoint 只推进到连续完成窗口。

## Canonical tables

| Table | 一行含义 | 逻辑键／版本 | 必要字段（除公共批次字段） |
| --- | --- | --- | --- |
| `data_sources` | 一个注册的外部来源 | `source_id` | legacy_ids, provider, landing_url, topic, scope, coverage_area_refs, coverage_from/to, cadence_seconds, check_interval_seconds, admission_evidence, connector_owner, license_status, last_success_at, last_source_update_at |
| `sync_batches` | 一次来源窗口的发布结果 | `batch_id` | source_id, window_from, window_to, state, published_at, input_count, output_count, error_code |
| `source_records` | 来源记录的一个版本 | `source_record_id + version_id` | original_url/raw_uri, published_at, observed_at, first_accessible_at, time_missing_reason, valid_from/to, assertion_kind, record_status, rights_status |
| `geo_records` | 可地理查询的事件或观测的一个版本 | `geo_record_id + version_id` | topic, assertion_kind, title, geometry_geojson, geometry, centroid_lat/lon, location_role/confidence, area_refs, time fields, record_status, freshness_state |
| `geo_record_sources` | 地理记录与来源记录的证据关系 | `geo_record_id + source_record_id + version_id` | evidence_role, original_url |
| `boundaries` | 某版行政／统计边界 | `scheme + code + vintage` | name, geometry_geojson, geometry, valid_from/to, source_record_id |
| `area_indicators` | 某区域某统计期的一项指标 | `indicator_id + boundary_id + period_start` | value, unit, status, assertion_kind, definition, source_record_id |
| `parking_bays`, `parking_observations`, `parking_rules` | 车位空间、占用观测及分时规则 | 参见数据模型 | bay_id/marker_id, times, status, source_record_id |
| `sensor_locations`, `pedestrian_observations` | 传感器位置版本及每分钟读数 | `sensor_id + valid_from`／`sensor_id + observed_at` | position, active state, counts, source_record_id |

字段名用 `snake_case`，时间为 UTC `TIMESTAMP`，计数为非负整数，坐标为 WGS84。GeoJSON 原文保留作溯源，验证后用 [`ST_GEOGFROMGEOJSON`](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/geography_functions) 得到 `GEOGRAPHY`；无法可靠定位时两列均为 null，不能写成 `0,0`。各事实追加表按 `DATE(fetched_at)` 分区，并按 `source_id` 和稳定记录 ID 聚类；具体粒度按首批数据量与查询成本复核。不兼容 schema 变更提高主版本并保留旧批次可读。

## Read-only query views

| View | 语义 |
| --- | --- |
| `v_geo_records_current` | 每个逻辑记录最新有效版本；默认排除撤稿／取消／已解决，保留来源及新鲜度状态 |
| `v_geo_records_history` | 已发布的全部许可可见版本，含取消／解除／撤稿；支持按地理、时间、主题、来源、事实类型与状态组合筛选 |
| `v_news_current` | GDELT／合规警方新闻的本地报道，保留全部出处和定位依据；不含未许可正文 |
| `v_parking_current` | 车位、最新占用、当前适用限制与各自时间；`may_park_now` 在证据不足时为 `unknown` |
| `v_area_indicators` | 指标值、统计期、单位和边界版本；抑制／缺失项无数值 |
| `v_source_health` | 最近检查、最近成功批次、来源更新时间与延迟状态 |
| `v_source_coverage` | 每来源经核实的空间/时间覆盖、主题、许可证据状态和当前健康；下游与记录结果组合后区分 `no_matching_records`、`not_covered`、`source_unavailable` 等空结果 |

这些视图与规范化表在数据采集阶段一起建立，供 SQL 质量验收使用；当前、历史与区域指标视图均提供由 `assertion_kind = prediction` 推导的 `is_prediction`。本阶段无预测来源。对指定区域、时间和类别的查询必须同时使用 `v_source_coverage` 与 `v_source_health`，按 [quality-rules.md](../quality-rules.md#4-时间新鲜度与查询空结果) 产生类别级 `coverage_status`，即使记录结果为空也能说明原因。Agent 的 SQL 生成仍属于后续阶段。`melens_query` 只通过已授权视图暴露必要列，未来查询身份只授予这些视图和查询作业权限，不授予 `melens_ingest` 原始表或 GCS raw 区权限。Agent 执行 SQL 时还要实施只读与表白名单校验、参数化条件、结果上限、超时、dry run 和最大计费字节限制。

## Compatibility rules

1. 下游使用稳定 `source_id`、`geo_record_id` 和 `boundary_id`，不得依赖 GCS 文件名或 BigQuery 物理行号作为业务主键。
2. `fetched_at` 不替代 `observed_at`／`published_at`；来源更新慢和采集失败分别呈现。
3. 新闻一个逻辑事件可关联多个报道；区域统计只能按原始地域单位或有明确边界映射查询。
4. 取消、更正、撤稿保留版本历史；当前视图只按确定的状态规则挑选。
5. 许可状态为 `review_required` 的来源不发布受限内容列。
6. 已有项目来源 ID 需在 `data_sources.legacy_ids` 映射到唯一规范 `source_id`；同一上游资料的镜像和分页不能算成不同数据集。
