# Source IDs: 并行连接器的规范身份

此表在多代理编写来源目录前冻结。`source_id` 是数据表和同步批次的唯一规范值；文件夹名只是代码路径。旧设计 ID 只作为一对一 `legacy_ids` 别名，不产生第二份记录或第二个可计数数据集。所有 `source.json` 均须包含 `source_id`、`legacy_ids`（可为空）、`topic` 及 [FR-001](spec.md) 的其他目录字段。

| 候选 # | 来源 | 规范 `source_id` | 连接器目录 | 已有设计 ID／说明 |
| --- | --- | --- | --- | --- |
| 1 | GDELT 新闻 | `gdelt.news` | `gdelt` | — |
| 2 | Victoria Police 新闻 | `victoria.police.news` | `victoria_police` | 条件性接入 |
| 3 | CSA 犯罪统计 | `victoria.csa.recorded_offences` | `csa_recorded_offences` | — |
| 4 | 路边停车传感器 | `melbourne.parking.sensors` | `com_parking_sensors` | `parking-sensors` |
| 5 | 路边车位空间 | `melbourne.parking.bays` | `com_parking_bays` | — |
| 6 | 单车位停车限制 | `melbourne.parking.restrictions` | `com_parking_restrictions` | — |
| 7 | 行人每分钟计数 | `melbourne.pedestrian.minute` | `com_pedestrian_minute` | `pedestrian-live`、`com.pedestrian.live` |
| 8 | 行人传感器位置 | `melbourne.pedestrian.locations` | `com_pedestrian_locations` | — |
| 9 | 非计划道路中断 | `victoria.transport.road_unplanned` | `tv_road_unplanned` | 见下方复合 ID 注释 |
| 10 | City of Melbourne 市界 | `melbourne.municipal_boundary` | `com_municipal_boundary` | — |
| 11 | ABS ASGS 边界 | `abs.asgs.boundaries` | `abs_asgs_boundaries` | — |
| 12 | Ticketmaster 活动 | `ticketmaster.events` | `ticketmaster` | `events-ticketmaster` |
| 13 | ABS Census | `abs.census` | `abs_census` | — |
| 14 | CLUE 就业 | `melbourne.clue.employment` | `com_clue_employment` | 配套街区边界独立登记 |
| 15 | 计划道路中断 | `victoria.transport.road_planned` | `tv_road_planned` | 见下方复合 ID 注释 |
| 16 | GTFS Realtime | `victoria.transport.gtfs_realtime` | `tv_gtfs_realtime` | `ptv-gtfs-realtime` |
| 17 | Transport Activity Counts | `melbourne.transport.activity_counts` | `com_transport_activity_counts` | — |
| 18 | 微气候传感器 | `melbourne.microclimate` | `com_microclimate` | — |
| 19 | VicEmergency 警报 | `victoria.emergency.alerts` | `vic_emergency` | 条件性接入 |
| 20 | 离街停车场容量 | `melbourne.offstreet_parks` | `com_offstreet_parks` | — |
| 21 | Homes Victoria 季度租金 | `homes_victoria.rents` | `homes_victoria_rents` | — |
| 22 | Vicmap Planning | `victoria.vicmap.planning` | `vicmap_planning` | — |
| 23 | Development Activity Monitor | `melbourne.development_monitor` | `com_development_monitor` | — |
| 24 | 历史每小时行人计数 | `melbourne.pedestrian.hourly` | `com_pedestrian_hourly` | `pedestrian-history` |
| 25 | Council 社区咨询项目（Social Pinpoint，28 个 council） | `victoria.council.engagement` | `council_engagement` | 见 [准入记录](../../cloud/data/docs/source-policies/council-engagement-admission.md) |
| 26 | Council 社区咨询新闻（同上 28 个站点的 sitemap） | `victoria.council.engagement_news` | `council_engagement_news` | 与 #25 共用准入记录，不共用 `source_id` |
| 配套 | CLUE 街区边界 | `melbourne.clue.blocks` | `com_clue_blocks` | 与 #14 不共用 `source_id` |
| 配套 | 静态 GTFS | `victoria.transport.gtfs_static` | `tv_gtfs_static` | 与 #16 不共用 `source_id` |

既有 `road-disruptions` 在 [system-design/data-sources.md](../../system-design/data-sources.md) 同时指计划和非计划道路资料，是**复合查询概念**，不能作为任一个单独来源的 `legacy_ids` 别名；调用方须选两个规范 ID 或对应的联合视图。若犯罪新闻覆盖不足而新增合规替代来源，T050 先给它分配新的唯一 `source_id` 并在本表追加映射，T051 再开始实现。
