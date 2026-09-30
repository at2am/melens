# Melbourne 公共数据源候选清单

**核查日期**：2026-09-28。以下“更新”指发布方标示的节奏或资料性质，不等于平台能保证的到达时延。A 是首期优先接入，B 是后续扩展；来源的授权、配额和真实字段须在接入前复核。City of Melbourne 的公开数据可通过其 [Explore API](https://data.melbourne.vic.gov.au/api-console/explore/v2.1/) 读取。

项目 P0 用例优先于本清单的 A/B 扩展分组：#16 GTFS Realtime 与其静态配套表、#24 历史每小时行人计数虽列 B 级，仍须在 UC-04／UC-05 的数据前置验收前完成。

| # | 来源与数据集 | 可支持的问题 | 更新／粒度 | 位置与接入要点 | 优先 |
| --- | --- | --- | --- | --- | --- |
| 1 | [GDELT 2.0 新闻／事件资料](https://gdeltproject.org/data.html) | 墨尔本一般新闻、突发事件与犯罪报道补充 | 约每 15 分钟；报道／事件 | 全球资料须按维州地理范围和事件发生地筛选；地点提及不是事发位置，需去重和回链 | A |
| 2 | [Victoria Police 新闻](https://www.police.vic.gov.au/news) | 本地犯罪与警方公开通报 | 按发布时点；报道 | 公开网页，非已确认的开放数据 API；自动获取和再利用条款待核实。其[邮件订阅](https://www.police.vic.gov.au/news-article-subscription)面向认证记者，不能作为公众接口 | A，条件性 |
| 3 | [Crime Statistics Agency 犯罪统计](https://discover.data.vic.gov.au/dataset/data-tables-recorded-offences) | 租房区域安全背景和犯罪趋势 | 季度；LGA 等区域汇总 | DataVic 提供表格；属于统计，不是实时警情或精确犯罪地点 | A |
| 4 | [City of Melbourne 路边车位传感器](https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bay-sensors/) | 哪些装有传感器的车位当前显示占用 | 动态更新；单个车位 | 含占用状态与位置；上游提示网络延迟，须检查记录的 Lastupdated；不代表可合法停车 | A |
| 5 | [City of Melbourne 路边车位空间](https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bays/) | 车位实际空间在哪里 | 变化时；车位多边形 | 与传感器按 marker_id 关联；市府提示停车系统调整可能造成数据中断 | A |
| 6 | [City of Melbourne 单车位停车限制](https://data.melbourne.vic.gov.au/explore/dataset/on-street-car-park-bay-restrictions/) | 某车位在指定时段受何限制 | 随规则变更；车位／时段 | 市府说明传感器按 bay_id 与限制关联；含星期、时间、节假日及豁免字段。仍需注意规则例外与数据中断 | A |
| 7 | [City of Melbourne 行人每分钟计数](https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-past-hour-counts-per-minute/) | 附近人流近况 | 每 15 分钟更新；分钟读数 | 按传感器标识关联位置；无读数不等于零人流，来源说明有过重复记录问题 | A |
| 8 | [City of Melbourne 行人传感器位置](https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-sensor-locations/) | 人流读数位于哪条街 | 来源标示每日；设备位置 | 设备可能搬迁、暂不可用或停用；关联历史读数须考虑位置版本 | A |
| 9 | [Transport Victoria 非计划道路中断](https://opendata.transport.vic.gov.au/dataset/unplanned-disruptions-road) | 事故、封路、车道关闭 | 约每 60 秒刷新；点／路段 | 覆盖州管及部分地方道路；需申请 KeyID，存在调用限额 | A |
| 10 | [City of Melbourne 市辖边界](https://data.melbourne.vic.gov.au/explore/dataset/municipal-boundary/) | 判断记录是否在 City of Melbourne 内 | 低频；多边形 | 本地保存版本；仅代表市府辖区，不等于整个大墨尔本 | A |
| 11 | [ABS ASGS 标准边界](https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/latest-release) | 大墨尔本、LGA、统计区和郊区归属 | 按版本／年度；多边形 | 2026 版开始发布，须按所用人口统计年份选择匹配边界，避免跨版误比较 | A |
| 12 | [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/) | 演出等计划活动 | 按活动上架／改动；场馆点位 | 开发者密钥；可按澳洲／城市／地点筛选，但覆盖不到所有社区与免费活动，使用条款待复核 | A |
| 13 | [ABS Census DataPacks](https://www.abs.gov.au/census/find-census-data/datapacks) | 人口、家庭、住宅及通勤背景 | 人口普查期；SA1／SA2 等 | 批量下载，须与同版统计边界配对；历史画像不是实时人口 | A |
| 14 | [City of Melbourne CLUE 分街区就业](https://data.melbourne.vic.gov.au/explore/dataset/employment-by-block-by-clue-industry/) | 哪里有更多工作机会和行业 | 每年；CLUE block | 须关联[CLUE 街区边界](https://data.melbourne.vic.gov.au/explore/dataset/blocks-for-census-of-land-use-and-employment-clue/)；少量企业的单元被抑制，不能补为零 | B |
| 15 | [Transport Victoria 计划道路中断](https://opendata.transport.vic.gov.au/dataset/planned-disruptions-road) | 即将发生的道路工程和延误 | 约每 30 分钟刷新；点／路段 | KeyID；必须展示工程实际起止时间，不能混作当前事故 | B |
| 16 | [Transport Victoria GTFS Realtime](https://opendata.transport.vic.gov.au/dataset/gtfs-realtime) | 火车／电车等服务变化 | 接近实时；路线／站点／车辆 | KeyID；不同模式与 feed 覆盖不同，服务警报需和静态站点／路线资料关联 | B |
| 17 | [City of Melbourne Transport Activity Counts](https://data.melbourne.vic.gov.au/explore/dataset/transport-activity-counts/) | 某些路段的车、骑行者、行人活动 | 每 5 分钟采样、约每小时更新；传感器 | 不是全市所有街道的交通量；部分时间段或类别无读数 | B |
| 18 | [City of Melbourne 微气候传感器](https://data.melbourne.vic.gov.au/explore/dataset/microclimate-sensors-data/) | 街区温度、湿度、风、颗粒物和噪声 | 约每 15 分钟；传感器 | 缺测可能存在；旧[传感器位置数据](https://data.melbourne.vic.gov.au/explore/dataset/microclimate-sensor-locations/)已标为历史，不应误作当前设备清单 | B |
| 19 | [VicEmergency 当前事件与警报](https://emergency.vic.gov.au/public/textonly.html) | 火灾、事故、洪水及其他日常警报 | 持续更新；地点／区域 | 官方公开页面；自动获取方式和再利用条件待核实；有些位置仅为概略位置 | B，条件性 |
| 20 | [City of Melbourne 离街停车场容量](https://data.melbourne.vic.gov.au/explore/dataset/off-street-car-parks-with-capacity-and-type/) | 附近是否有公共付费停车设施及容量 | CLUE 历史／年度；物业 | 记录容量与类型，**不是实时剩余车位**；住宅及私人设施不可误作公共停车场 | B |
| 21 | [Homes Victoria 季度租金](https://discover.data.vic.gov.au/dataset/rental-report-quarterly-quarterly-median-rents-by-lga) | 租房区域成本比较 | 季度；LGA／郊区表格 | 不代表正在挂牌的租金；需校验资源对应的年份与统计地域 | B |
| 22 | [Vicmap Planning 分区与覆盖层](https://discover.data.vic.gov.au/dataset/vicmap-planning-api) | 土地用途与政府规划管制 | 约每周更新；多边形 | 可看 zones／overlays；是规划现状，不等于单个项目已获批 | B |
| 23 | [City of Melbourne Development Activity Monitor](https://data.melbourne.vic.gov.au/explore/dataset/development-activity-monitor/) | 附近拟议、在建、已完工项目 | 来源标示每月；项目点位 | 含项目状态和位置；“mooted” 与“approved” 须区别 | B |
| 24 | [City of Melbourne 历史每小时行人计数](https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-monthly-counts-per-hour/) | 长期人流模式及分钟窗口之外的历史核对 | 历史、定期更新；小时读数 | 能补充长期趋势，但**不能恢复漏掉的分钟明细**；设备迁移仍需按位置版本处理 | B |

## 选源结论

- 首期最小完整链路应同时具备：车位传感器＋车位空间＋停车限制，行人计数＋传感器位置，以及边界＋新闻／犯罪资讯。单独接入其中一表不能回答用户的完整问题。
- [停车区标牌](https://data.melbourne.vic.gov.au/explore/dataset/sign-plates-located-in-each-parking-zone/)及[停车区与道路段关联](https://data.melbourne.vic.gov.au/explore/dataset/parking-zones-linked-to-street-segments/)可作为规则核对与扩展来源；首期单车位规则以表中第 6 项为准。
- 犯罪资讯采用双轨：GDELT 与警方公开报道用于“近期发生了什么”；CSA 区域统计用于“长期区域趋势”。后者不可定位到单一街道或替代即时警情。
- 关于“附近活动”，Ticketmaster 可作为有明确开发接口的首批来源，但偏向票务活动。City of Melbourne 的 [What’s On Melbourne](https://whatson.melbourne.vic.gov.au/) 适合后续评估社区／免费活动覆盖，当前没有在此清单中把它视为已核实的开放 API。
- “workable index” 可以建立在就业、人流、交通、微气候、租金与规划数据之上；评分定义与推荐算法属于后续产品 spec。本阶段保留原始指标和统计口径。
- 所有第三方新闻和活动内容先核实授权及可缓存范围；公开可浏览不自动等于可批量抓取或再分发。优先保留事实性元数据、来源链接和归属信息。
