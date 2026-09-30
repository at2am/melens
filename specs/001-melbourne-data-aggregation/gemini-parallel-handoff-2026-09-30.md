# Gemini 并行交接：数据源准入与剩余验证

更新于 2026-09-30。此清单以 [tasks.md](tasks.md)、[source-coverage.md](../../cloud/data/docs/source-coverage.md) 和实际开发集为准；旧版 [gemini-handoff.md](gemini-handoff.md) 中的历史测试数、`0 active` 等状态已过时。

## 当前基线

- 开发集已真实发布并查询 **5/24 个连接器**：市界、CLUE 街区、ABS ASGS、City of Melbourne Development Activity Monitor、Homes Victoria 租金。市界／CLUE／ABS 共 1,527 个边界面；开发项目 1,450 条；租金 Jun/Sep 2025 共 1,106 条且边界尚未匹配。ABS Census 的后续准入由集成人员处理，不在本批 Gemini 范围。
- 仍只有行政边界通过八类首期样本门槛。`T069`、`T070`、`T071`、`T077` 仍未完成；所有**来源采集** Scheduler 任务均关闭。独立的 staging 清理作业已自动运行成功，预算 AUD 100 的私有通知响应已通过模拟投递，但共享部署门槛仍未解除。
- 原任务中多数连接器 ID 已标 `[X]`，表示代码和样例交付，不表示许可准入、真实云端发布或首期门槛通过。以下 `GM-xx` 是**剩余工作的细分 ID**，括号中的 `Txxx` 是原任务关联，不要把原 `[X]` 任务重新实现或擅自改勾选。

## 并行工作规则

1. **每个 `GM-xx` 单独分支或 worktree**，一个 Gemini agent 认领一个 ID。只修改该行列出的独占来源目录／测试文件，另可新增 `cloud/data/docs/handoff-evidence/GM-xx.md`。任何 agent 不修改 `core/`、`normalization/`、`sql/`、`infra/`、`tasks.md`、`verification.md`、`source-coverage.md` 或别人的连接器。
2. 官方接口只做**有界、只读**核查。记录 URL、时间、HTTP 状态、条数、字段和许可页面；上游不可用就保留可复现阻断。不得用 fixture 成功冒充真实采集。
3. 不创建／读取 Secret Manager 的值，不在提交、日志或交接中放 KeyID、token 或密码。Transport Victoria／Ticketmaster 缺实际凭据时完成本地契约和安全失败路径，标明实盘验证待办。
4. 保持 `license_status=review_required`、`access_status=candidate`，直到集成人员复核证据。Gemini 不运行 GCP `--apply`、不发布 BigQuery、不启用 Scheduler，也不设置 `budget_action_verified`。
5. 每项回报：改动文件、官方证据、可重复的行为验证、测试命令与结果、仍阻断的门槛。确需共享契约变更时只在 `GM-xx.md` 写接口建议，由集成人员统一合并。

## 第一批：来源目录完全独立，可同时派发

| ID | 关联任务 | 独占文件范围 | 实际未完成点与交付标准 |
| --- | --- | --- | --- |
| **GM-01** | T040/T049 | `src/connectors/gdelt/`、其来源测试 | 有界核查最近 14 天 GDELT 15 分钟文件，验证下载清单、窗口缺口、维州地理候选数和发布日期；修复同一窗口的漏取／重复。只保留元数据和原文 URL。 |
| **GM-02** | T041/T058 | `src/connectors/csa_recorded_offences/`、其来源测试 | 查明官方 Table 01 LGA 名称是否有可核实的代码及地域版次。若没有，保留原名称与 `boundary_mapping_status=missing` 的来源事实，不猜 ASGS LGA；给出至少两个真实地区／统计期样本。 |
| **GM-03** | T026/T035 | `src/connectors/com_parking_sensors/`、其来源测试 | 对当前官方快照清点 `kerbsideid`、`marker_id`、`bay_id`、时间和 `occupied` 缺值；证明可关联键覆盖率。键缺失时保持未关联，不能称空位可停。 |
| **GM-04** | T027/T035 | `src/connectors/com_parking_bays/`、其来源测试 | 对官方车位快照核对点／面几何及 `kerbsideid`、`marker_id` 空值和重复；保留真实 WGS84 点，不把点扩成虚构车位多边形。 |
| **GM-05** | T028/T035 | `src/connectors/com_parking_restrictions/`、其来源测试 | 核对规则数据最后处理时间、`bayid` 与时间段／豁免字段；确保旧规则、未知节假日、冲突规则输出证据不足，不产生肯定许可。 |
| **GM-06** | T033 | `src/connectors/com_offstreet_parks/`、其来源测试 | 复现 2024 年物业 100008 `private` 容量 13/6 的同键多行，调查官方行粒度；只在有官方稳定子键／聚合语义时修复 G23。年度容量不能转成实时空位。 |
| **GM-07** | T029/T069 | `src/connectors/com_pedestrian_minute/`、其来源测试 | 有界核查真实分钟窗与最近一小时重叠，确认时间字段、分页、缺分钟、重复和夏令时；缺测保持 null/缺口，不补零。不得宣称完成 24 小时验收。 |
| **GM-08** | T030/T036 | `src/connectors/com_pedestrian_locations/`、其来源测试 | 用真实形状的同传感器旧／新坐标快照复现迁移；修正冷启动把新坐标追溯至安装日的问题。上游无迁移时刻时保留未知区间，不伪造有效起点。 |
| **GM-09** | T034/T069 | `src/connectors/com_pedestrian_hourly/`、其来源测试 | 小时计数更正已有不同批次摘要，但来源没有可排序更正时间；调查官方可用修订证据。无证据时让不同值的同键版本失败关闭，验证夏令时重复／不存在小时。 |
| **GM-10** | T032 | `src/connectors/com_transport_activity_counts/`、其来源测试 | 官方 `transport-activity-counts` 当前返回 404。查找 City of Melbourne 官方替代 dataset ID；若有，核对车辆／自行车／行人字段、时间粒度后适配；若无，记录 404 与查询过程并保持 blocked。 |
| **GM-11** | T054 | `src/connectors/com_microclimate/`、其来源测试 | 在官方当前接口核查设备、更新时间、13 类指标与物理单位；排查停用设备被当现行点位、缺测被补零。给出完整分页与实际覆盖证据，暂不激活。 |
| **GM-12** | T053/T058 | `src/connectors/com_clue_employment/`、其来源测试 | 真实核查 2002–2024 就业表的统计年、行业、抑制值和版本；不要按 block ID 把历史指标挂到 2025 CLUE 多边形。若有官方跨版映射，提交原始链接与验证规则。 |
| **GM-13** | T056 | `src/connectors/vicmap_planning/`、其来源测试 | 复测当前 ArcGIS zone layer 3 空 `objectIds`，调查同一官方机构的正式替代服务；必须同时有 zone 与 overlay 且可穷尽分页，不能只用 overlay 假装规划分区完整。 |
| **GM-14** | T031 | `src/connectors/tv_road_unplanned/`、其来源测试 | 完成父事故／子影响、解除和 60 秒源时间的本地契约与限流失败路径；缺 KeyID 时只交付待实盘清单，不声称真实接口接通。 |
| **GM-15** | T061 | `src/connectors/tv_road_planned/`、其来源测试 | 完成未来开始／结束、受影响路段及取消状态的本地契约和分页／限流失败路径；保留 `planned`，缺 KeyID 时不报已准入。 |
| **GM-16** | T063 | `src/connectors/tv_gtfs_realtime/`、其来源测试 | 核对 protobuf alert ID、路线／站点／生效区间、取消与 train/tram/bus 覆盖声明；无 KeyID 只能验证契约和失败行为，不能把未覆盖 bus 说成无警报。 |
| **GM-17** | T062/T066 | `src/connectors/tv_gtfs_static/`、其来源测试 | 调查官方静态 GTFS 是否提供与 Realtime 可比较的 `feed_info.feed_version`；检查按范围 ZIP 校验和缺失 feed_info 的失败关闭，不能用归档 ETag 假冒 GTFS 版本。 |
| **GM-18** | T042 | `src/connectors/ticketmaster/`、其来源测试 | 只审查元数据/坐标、改期／取消版本和缓存撤除契约；当前条款与 Key 均阻断真实发布。不得抓取正文或把测试 key 写入仓库。 |

上表路径均以 `cloud/data/` 为根。各任务的测试文件由该来源目录对应的 `cloud/data/test/connectors/` 文件独占；若其测试名称不同，先定位后在交接记录中写明。`GM-01` 与下方新闻样本研究可以并行，因为研究任务只写独立文档。

## 第二批：独占文档或测试文件，也可并行

| ID | 关联任务 | 唯一交付文件 | 实际未完成点与交付标准 |
| --- | --- | --- | --- |
| **GM-19** | T050/T051 | `cloud/data/docs/handoff-evidence/GM-19-local-crime-sources.md` | 在官方／出版方页面核查至少 3 个 Melbourne 本地犯罪新闻候选的机器访问、再利用、保存字段、更新频率和地理证据；只推荐条款明确许可的来源。未选定时 T051 仍阻断。 |
| **GM-20** | T042 | `cloud/data/docs/handoff-evidence/GM-20-events-sources.md` | 核查至少 3 个无 Key 或可合法授权的本地活动源，比较 API/RSS、缓存期限、取消／改期字段、坐标和许可；不因为网页可浏览就推定可抓取。 |
| **GM-21** | T055/T058 | `cloud/data/docs/handoff-evidence/GM-21-rent-boundaries.md` | 寻找 Homes Victoria XLSX 的官方 LGA 代码、统计地域年份或可核实跨表映射；列出匹配／无法匹配的样本。不得靠名称相似直接把 1,106 条租金贴到 ASGS 面。 |
| **GM-22** | T035/T039 | `cloud/data/docs/handoff-evidence/GM-22-parking-holidays.md` | 查找维州官方节假日和当前 City of Melbourne 停车规则的可用时间证据，设计 `may_park_now` 需要的事实清单；缺任何一项都保持 `unknown`。 |
| **GM-23** | T048 | `cloud/data/docs/handoff-evidence/GM-23-news-benchmark.md` | 建立真实来源 URL 的维州事发、Melbourne FL、仅提及、多地点各 ≥10 条的**待双人标注**清单；只给独立标注空栏与抽样依据，不由代码作者伪造两份人工裁定或声称 SC-004 通过。 |
| **GM-24** | T074 | `cloud/data/test/integration/source-health.test.ts` | 将测试内部自写的视图/去重模拟与真正调用生产函数的断言分开；增加能因真实函数变坏而失败的恢复、失败批次隔离和空结果验证。没有云端查询时明确只是本地检查。 |
| **GM-25** | T060 | `cloud/data/test/integration/us3-area.test.ts` | 修复同版边界与来源追溯的真实调用测试：两个地区、两个统计期、抑制/null、未匹配租金不能静默 join。不要更改公共 normalizer；需要的变更写入该 ID 的证据文档。 |
| **GM-26** | T068 | `cloud/data/test/integration/us4-changes.test.ts` | 用生产 selector/normalizer 验证改期、取消、解除与版本先后，不能依赖哈希字符串排序；静态 GTFS 无可核实 feed_version 时继续返回未验证。 |

`GM-24`、`GM-25`、`GM-26` 是三个不同测试文件，可与来源任务并行。文档任务各写自己的新文件，不改现有共用 `events-alternative.md`、`local-crime-news-alternative.md`、`parking-join.md`。

## 暂不派发给 Gemini 的集成项

- **我负责**：ABS Census 发布／边界匹配；T035/T037/T039 的真实停车三表门槛；T066 的静态/实时版本联动；T069 的 P0 云端联合验收；T070/T071 的 GCP 部署、身份、预算及调度；T077 的 ≥10 来源与八类覆盖验收、24 小时样本和双人复核。Gemini 的候选代码通过后由我统一处理公共 `core/`、`normalization/`、`sql/` 和 GCP 发布。
- **条件性冻结**：T044 Victoria Police 与 T065 VicEmergency 仍受官方再利用／自动访问条款阻断；T051 只有 GM-19 找到合规替代并由集成人员分配规范 ID 后才能开始。不要把这三项当作可立即开工的独立编码任务。
- **外部凭据**：T031/T061/T063 与 T042 的真实调用需项目拥有者把 Key 放进 GCP Secret Manager；Gemini 可完成本地契约、官方公开证据和失败路径，不代替凭据实测。

## 给每个 Gemini agent 的统一提示

> 在 Melens 仓库执行 `gemini-parallel-handoff-2026-09-30.md` 中的 **GM-xx**。只修改该行独占路径及自己的 `cloud/data/docs/handoff-evidence/GM-xx.md`；不要修改共享模块、全局任务/验证/覆盖文档或 GCP 资源。先核对现有实现，再用官方只读证据复现未完成点；证据不足就保持 candidate/blocked。交付具体改动、官方 URL/采集时间/状态/条数、可重复验证结果和仍需集成的事项。不要接触密钥值、使用 fixture 冒充真实可用或宣布 T077 通过。
