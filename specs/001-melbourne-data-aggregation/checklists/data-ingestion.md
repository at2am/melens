# 数据采集需求质量 Checklist: Melbourne 公共数据聚合

**Purpose**: 在多代理开始实现前，审查 24 个候选来源的数据接入、发布、查询及授权要求是否完整、明确且可客观验收。  
**Created**: 2026-09-28  
**Feature**: [spec.md](../spec.md)；关联 [plan.md](../plan.md) 与 [tasks.md](../tasks.md)  
**Review depth**: Standard；面向实施前的需求审阅者。

**Note**: 本清单审查**需求文字的质量**，不是采集程序的运行结果。所有新条目由审阅者判断，生成时保持未勾选。
**Review Ownership**: `[x]` 仅表示审阅者确认该项需求质量达标。
**Marker Semantics**: `[x]` 不表示相应代码、数据源或云端部署已完成。

## Requirement Completeness

- [ ] CHK001 来源目录要求是否涵盖每个候选来源的提供方、公开入口、覆盖范围、数据粒度、预期更新节奏、授权状态和可计入首期的条件？[Completeness, Spec §FR-001]
- [ ] CHK002 “不少于 10 个独立公开数据集”的“独立”是否定义清楚，包括停车三表、行人两表与配套边界的计数方式？[Clarity, Spec §FR-002, Spec §SC-001]
- [ ] CHK003 每个来源的准入要求是否明确应记录实际可访问范围、获取完整性的判定、配额/凭据依赖及来源字段变更的处理责任？[Completeness, Gap]
- [ ] CHK004 犯罪资讯、活动、道路动态与区域统计各自的最低覆盖要求是否足以判断八类信息均已覆盖，而非仅有一条偶然样本？[Completeness, Spec §FR-002]
- [ ] CHK005 对静态、年度、季度、不定期与高频来源，是否分别规定更新时间的含义及何时不得标为“实时”？[Completeness, Spec §FR-003, Spec §FR-011]
- [ ] CHK006 下游组合地理范围、时间、主题、来源与状态进行查询时，返回的引用字段和区域指标语义是否定义完整？[Completeness, Spec §FR-012]

## Requirement Clarity

- [ ] CHK007 “City of Melbourne 市内”“大墨尔本”和“维州相关”的空间边界、版本及适用场景是否有明确且互不混淆的定义？[Clarity, Spec §FR-005, Spec §FR-006]
- [ ] CHK008 来源坐标、区域级定位、仅提及地点与无法定位的证据门槛及允许精度是否足够明确，使不同代理不会给同一新闻编出不同街道点？[Clarity, Spec §FR-005, Spec §FR-009]
- [ ] CHK009 “当前”“延迟”“过期”“未知”的判定依据是否明确区分上游发布时间、观测时间、有效时间与本次抓取时间？[Clarity, Spec §FR-003, Spec §FR-011]
- [ ] CHK010 车位“占用状态”和“可合法停车”的边界是否明确覆盖限制缺失、冲突、已过期和节假日例外？[Clarity, Spec §FR-007, Spec §SC-005]
- [ ] CHK011 新闻重复报道、同一事件的多个来源、更正和撤稿的身份与当前版本定义是否足够明确？[Clarity, Spec §FR-009, Spec §FR-013]
- [ ] CHK012 活动、道路工程、事故、规划项目的“计划中”“生效中”“已取消/解除”是否以明确时间与来源状态定义？[Clarity, Spec §FR-011, Spec §User Story 4]

## Requirement Consistency & Traceability

- [ ] CHK013 规范化数据的发布与查询主路径在 spec、plan、数据契约和任务清单之间是否一致，并明确原始批次与可查询记录各自的权威状态？[Consistency, Plan §Data flow]
- [ ] CHK014 本 feature 的 US1/US2 优先级与项目 UC-04/UC-05 的 P0 发布顺序是否有明确的跨文档解释，避免并行编码被误当作并行上线？[Conflict, Tasks §Dependencies & Execution Order]
- [ ] CHK015 警方新闻在用户故事中的表述，与其“许可待核实、不能计入保底来源”的准入规则是否一致？[Conflict, Spec §User Story 2, Spec §Assumptions]
- [ ] CHK016 24 个候选来源、首期 A 级来源和至少 10 个首期接入来源之间的范围关系是否明确，未把 B 级或条件性来源隐含为必需项？[Consistency, Spec §FR-002, Tasks §Implementation Strategy]
- [ ] CHK017 区域犯罪、人口、就业和租金指标的统计期、地域单位及边界版本要求是否跨用户故事和数据模型保持一致？[Consistency, Spec §FR-010, Spec §FR-016]

## Acceptance Criteria Quality

- [ ] CHK018 SC-001 是否定义“已核实”“完成接入”和“可查询样本”的共同判定口径，包含授权与来源可追溯要求？[Measurability, Spec §SC-001]
- [ ] CHK019 SC-002 的“95%”“两个更新周期”是否规定观察窗口、分母、来源未按时发布时的排除条件及不同 cadence 的计算方式？[Measurability, Spec §SC-002]
- [ ] CHK020 SC-003 的 100 条混合结果是否规定来源/主题/时间粒度的抽样分布，以及原始时间确实缺失时怎样判定可追溯？[Measurability, Spec §SC-003]
- [ ] CHK021 SC-004 是否明确新闻位置样本的组成、人工判定基准、未定位的可接受条件和“精确街道坐标”的边界？[Measurability, Spec §SC-004]
- [ ] CHK022 SC-005 的 30 个完整与 10 个缺失/过期车位样本，是否定义“资料完整”“可立即合法停车”的判定依据？[Measurability, Spec §SC-005]
- [ ] CHK023 SC-006 是否说明三分钟从何时计时、由哪类数据使用方完成何种查询，以及“正确判断新鲜”的评分标准？[Measurability, Spec §SC-006]

## Scenario & Edge Case Coverage

- [ ] CHK024 分批来源只取得部分页面、上游超时或字段变化时，是否定义整批可见性、失败状态及游标不得越过缺口的要求？[Coverage, Spec §FR-013, Spec §FR-014]
- [ ] CHK025 行人分钟资料超过上游最近一小时窗口后，是否明确永久分钟缺口的表示方法及历史小时数据的不同粒度？[Coverage, Spec §FR-008, Spec §Edge Cases]
- [ ] CHK026 对迟到记录、上游更正、活动取消、新闻撤稿和事故解除，是否定义历史保留与当前状态选择规则？[Coverage, Spec §FR-011, Spec §FR-013]
- [ ] CHK027 对无效坐标、传感器迁移/停用、来源条款改变或无法再利用内容，是否分别写明降级或隔离要求？[Coverage, Spec §FR-005, Spec §FR-008, Spec §FR-015]
- [ ] CHK028 无新闻、无活动、没有传感器覆盖或区域指标缺失时，是否定义“无记录”和“来源失败/未覆盖”的不同表示？[Coverage, Gap]
- [ ] CHK029 并行同步同一来源窗口与重试重复发布时，是否定义唯一当前结果及连续完成窗口的要求？[Coverage, Spec §FR-013, Plan §Data flow]
- [ ] CHK030 `marker_id`/`bay_id`、行人传感器 ID 或区域边界代码无法关联时，是否定义保留哪些事实、显示哪些缺项、何时不得推断位置或许可？[Coverage, Spec §FR-007, Spec §FR-008, Spec §FR-016]

## Non-Functional Requirements & Security

- [ ] CHK031 采集身份、原始资料、规范化记录与对外查询的访问边界是否写明最小权限和不同内容的可见范围？[Security, Spec §FR-015, Gap]
- [ ] CHK032 第三方 key 与本地/云端身份的保管、注入、日志脱敏及权限撤销要求是否明确，且与用户“不在聊天或仓库中提供秘密”的约束一致？[Security, Gap]
- [ ] CHK033 原始批次、临时导入资料与来源授权改变后的保留/删除要求是否明确，特别是新闻和商业活动内容？[Security, Gap]
- [ ] CHK034 高频来源的同步频率、外部配额及云端存储/查询成本是否有足够明确的上限或监控要求？[Non-Functional, Gap]
- [ ] CHK035 失败原因、来源最近成功时间、来源自身更新时间和数据缺口的健康要求，是否足以区分上游延迟与采集故障？[Non-Functional, Spec §FR-003, Spec §FR-014]

## Dependencies & Assumptions

- [ ] CHK036 需要外部 key、许可审查或人工准入的来源，是否定义谁提供证据、通过标准，以及未通过时的范围和验收影响？[Dependency, Spec §FR-015, Tasks §Dependencies & Execution Order]
- [ ] CHK037 多代理并行前，共享契约的冻结条件、每个来源的独占文件范围和交回的字段/样例/许可证据是否足够明确，避免交付无法集成？[Dependency, Tasks §Parallel Execution Examples]
- [ ] CHK038 Ticketmaster、Victoria Police 或 VicEmergency 不可用时，新闻/犯罪/活动类别的替代来源或未达标判断是否被明确记录？[Assumption, Spec §FR-002, Spec §Assumptions]
- [ ] CHK039 外部公共数据的更新状态、地域与跨区域使用限制是否被列为需验证假设，而非被当作已满足的接入条件？[Assumption, Plan §Query engine boundary]

## Notes

- 由需求审阅者在 spec、plan、数据契约与任务清单中找到充分且一致的文字依据后，才把对应项目标为 `[x]`。
- 未达标项目记录需修改的需求段落；本清单不代替来源授权审查、运行验证或实施测试。
- `$speckit-implement` 可读取勾选状态作为门槛，但不应修改这些标记。
- `checklists/requirements.md` 是 `$speckit-specify`/`$speckit-clarify` 维护的独立内置清单。
