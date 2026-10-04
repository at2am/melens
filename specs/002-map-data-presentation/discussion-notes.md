# 地图呈现讨论记录

**日期**：2026-10-01  
**状态**：讨论摘要，技术候选待规划验证  
**关联规格**：[spec.md](spec.md)

## 用户提出的需求

- 准备将已采集数据放到地图上，先讨论不同来源的呈现方式，而后进入实施。
- 重点覆盖新闻、租金、交通和行人，并设计总体图层组织与不同 zoom level 的呈现。
- 考虑 H3 等热度概览形式。
- 希望行人计数可能通过 Three.js 呈现更三维化、有人物走动的 UI 效果。用户提出的是体验与候选技术，尚未要求固定某个库或全面替换现有客户端。

## 讨论形成的初始建议

- 用户入口采用专题视图加图层开关：城市动态、附近新闻、区域比较。后台数据提供方在来源详情中呈现。
- 点事件、交通线和区域统计各用合适图形；区域填色一次选择一个指标，点线可辅助叠加。
- 缩放分为大墨尔本、城区、街区、近距离四档；聚合、标签与详情逐步展开，地理精度始终受来源约束。
- 行人较远视野使用六边形覆盖与异常概览，中近视野使用传感器计数，选中位置可开启三维示意。
- 三维人物由计数驱动数量或出现频率，准确数值、观测时间和示意标签持续可见；没有个人轨迹或速度数据。
- 原型先聚焦一个可靠传感器街区；默认入口、阈值、颜色和动画比例仍为建议。

## 数据传输与当前实现

- MapFeature 表示结构化地图数据模型，JSON 可以编码它，GeoJSON 可描述其空间部分；它们不是同一个层面的概念。MapFeature 的旧草案还未成为客户端正式契约。
- 讨论建议客户端接收按视野、主题和时间筛选后的 JSON，配合压缩、缓存与增量更新。Parquet 更适合大量表格资料的存储、导出和离线分析，未建议作为当前地图交互的默认传输格式。
- 当前采集发布逻辑对低频大批次使用 GCS NDJSON 后导入 BigQuery，高频通过 Storage Write API 写入；这是后台入库路径。见 [publisher.ts](../../cloud/data/src/core/publisher.ts)。
- Flutter 地图当前是占位页，尚未连接采集数据。见 [map_screen.dart](../../app/lib/features/map/ui/map_screen.dart)。
- 旧架构里的 Firestore 当前地图方案仍需由地图规划确认，不能当成已经部署的客户端链路。见 [数据计划](../001-melbourne-data-aggregation/plan.md)。

## 待规划验证的技术候选

| 候选 | 用途 | 需要验证 |
| --- | --- | --- |
| JSON 与 GeoJSON | 视野查询结果与点线面描述 | 正式地图契约、分页与部分结果、时间和来源字段、区域指标独立字段 |
| H3 | 多级空间索引和六边形聚合 | 分辨率、聚合指标与分母、覆盖呈现、分辨率变化后重新聚合；不是精度补全 |
| deck.gl | 较多聚合格或点线面的绘制候选 | 是否有必要引入、渲染负载与平台支持；普通多边形绘制也可作为起点 |
| Three.js | 计数驱动的三维人物示意 | 简化人物实例化、动画成本、上限、暂停与静态回退 |
| Google Maps WebGLOverlayView | 网页地图与三维对象的坐标和相机同步 | 启用矢量地图的 Map ID、深度遮挡、生命周期、手势和选中同步 |
| Flutter 与 JavaScript 集成 | 网页客户端承载三维地图区域，保留图层和详情界面 | 集成边界、性能及 Android/iOS 的独立支持方案，不能假设网页实现直接通用 |

这些候选不增加新的云平台或第三方产品 AI，也不构成实现承诺。

## 已核对的资料

- [H3 空间索引说明](https://h3geo.org/docs/)说明网格索引及分层聚合；H3 不是自动生成真实密度的算法。
- [H3HexagonLayer](https://deck.gl/docs/api-reference/geo-layers/h3-hexagon-layer)与 [HeatmapLayer](https://deck.gl/docs/api-reference/aggregation-layers/heatmap-layer)分别提供网格及连续热度的可视化候选。
- [Google Maps WebGLOverlayView](https://developers.google.com/maps/documentation/javascript/webgl/webgl-overlay-view)支持与矢量底图共享绘制环境并关联地理坐标，需要矢量地图 Map ID。
- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)支持相同几何和材质的批量实例，复杂人物动画仍需额外验证。
- [Google Maps 缩放说明](https://developers.google.com/maps/documentation/android-sdk/views)提供城市、街道与建筑级别的尺度参考；本规格档位是产品初始规则。
- [GeoJSON 标准](https://www.rfc-editor.org/info/rfc7946/)、[Flutter JSON 文档](https://docs.flutter.dev/data-and-backend/serialization/json)与 [Parquet 官方说明](https://parquet.apache.org/)支持格式区分。
