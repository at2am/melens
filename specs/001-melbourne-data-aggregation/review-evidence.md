# 数据采集清单审阅证据

本次审阅对应 [data-ingestion.md](checklists/data-ingestion.md) 的 39 项**需求质量**问题。此文件记录文字依据；清单标记由审阅者决定，本轮不改动其 `[ ]`。这些依据不表示连接器、真实来源、许可或 GCP 部署已经完成。

## 原文档已有充分依据的 22 项

| 清单项 | 主要依据 |
| --- | --- |
| CHK001–002 | [spec.md](spec.md) FR-001/FR-002、[source-ids.md](source-ids.md)、[plan.md](plan.md) Acquisition sequence |
| CHK005–006 | [spec.md](spec.md) FR-003/FR-011/FR-012、[contracts/datasets.md](contracts/datasets.md) Read-only query views |
| CHK013–019 | [spec.md](spec.md) FR-002/FR-013/SC-001/SC-002、[plan.md](plan.md) Data flow、[tasks.md](tasks.md) Dependencies |
| CHK023–027 | [spec.md](spec.md) SC-006/Edge Cases、[data-model.md](data-model.md) Validation invariants、[contracts/connector.md](contracts/connector.md) Required behavior |
| CHK029–031 | [data-model.md](data-model.md) SyncBatch/parking/area rules、[quickstart.md](quickstart.md) Safe access setup |
| CHK033 | [spec.md](spec.md) FR-015、[contracts/datasets.md](contracts/datasets.md) Storage and publication layout |
| CHK037、CHK039 | [tasks.md](tasks.md) 共享冻结点/Parallel Execution、[plan.md](plan.md) Query engine boundary |

## 本轮补充规则的 17 项

| 清单项 | 补充的判定依据 |
| --- | --- |
| CHK003 | [quality-rules.md](quality-rules.md) §1 要求实际覆盖、完整性、配额/凭据、许可和维护负责人；FR-001/T009/T076 同步 |
| CHK004 | [quality-rules.md](quality-rules.md) §2 为八类信息分别规定最低真实样本；FR-002/SC-001/T077 同步 |
| CHK007–008 | [quality-rules.md](quality-rules.md) §3 区分市界、Greater Melbourne GCCSA、州界与海外同名地，并给出坐标和事发地证据门槛；T013/T023/T045 同步 |
| CHK009 | [quality-rules.md](quality-rules.md) §4 区分来源时间、采集时间、生命周期和 `current`/`late`/`stale`/`unknown`；T072 同步 |
| CHK010 | [quality-rules.md](quality-rules.md) §5 给出 `may_park_now` 的 `yes`/`no`/`unknown` 条件；T035/T039 同步 |
| CHK011 | [quality-rules.md](quality-rules.md) §3 规定同来源版本及跨来源事件合并所需的独立证据；T046 同步 |
| CHK012 | [quality-rules.md](quality-rules.md) §4 规定来源状态、有效区间与历史视图冲突处理 |
| CHK020–022 | [quality-rules.md](quality-rules.md) §6 规定 SC-003 的分层抽样、SC-004 的双人裁定、SC-005 的完整与异常样本组成；T039/T048/T077 同步 |
| CHK028 | [quality-rules.md](quality-rules.md) §4 规定类别级 `coverage_status`；[contracts/datasets.md](contracts/datasets.md) 新增 `v_source_coverage`；T073/T074 同步 |
| CHK032 | [quality-rules.md](quality-rules.md) §6 规定 key 撤销或疑似泄露时停调度、撤权、轮换；T075 同步 |
| CHK034 | [quality-rules.md](quality-rules.md) §6 规定部署前数值预算、每来源调用上限及告警；T071 同步 |
| CHK035 | [quality-rules.md](quality-rules.md) §4 规定时效与故障的不同判定；T072/T073 同步 |
| CHK036 | [quality-rules.md](quality-rules.md) §1 规定发布方证据、集成人员复核及项目拥有者提供 key 的责任 |
| CHK038 | [quality-rules.md](quality-rules.md) §2 与 [spec.md](spec.md) Assumptions 规定 Ticketmaster/警方/VicEmergency 不可用时的替代或未达标结论；T042/T050 同步 |

## 仍须用真实证据验证的事项

来源的实际许可、可访问字段、配额与地理覆盖，项目月度预算数值，第三方 key、真实同步、八类样本门槛和 SC-001–SC-006 的运行结果，都要在对应实施任务中核实。它们不是清单标记自动转为 `[x]` 或程序已经可部署的证据。
