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

---

## Codex Review Feedback（2026-10-01）

**结论：需要返工后再整体合并。** 已检查 GM-01 至 GM-26 的全部独立提交；26 项都有交付，但仍有 **4 项 P1、8 项 P2**，涉及 11 个任务。主要问题是跨批次保护没有接入实际采集、时间事实失真，以及测试和研究结论超出证据范围。其余任务可以按下表接收候选代码、研究结果或阻断记录；这不解除来源准入、凭据和云端验收门槛。

### 审查范围与验证结果

- 审查基线为 `671ae27`，26 个分支各有一个独立提交，共涉及 73 个文件，没有相互覆盖的修改，也没有修改本批禁止改动的共享目录。下文行号对应表中提交，文件路径以 `cloud/data/` 为根；可用 `git show <commit>:cloud/data/<path>` 查看。当前主工作区另有未提交的集成改动，本次未纳入审查。
- 将基线及 26 个提交的文件组合到隔离目录，使用 **Node v24.18.0** 执行 `npm test`：编译成功，**538 tests / 534 pass / 0 fail / 4 skipped**。跳过的是发布、来源健康、US3 和 US4 的真实 GCP 验收；本次没有运行云端发布或启用采集调度。
- 补充运行了生产连接器的边界场景复现，并做了两次临时测试变异检查；变异只发生在隔离目录，检查后已恢复。已有测试全绿并不能排除下列问题。
- 官方核查均为有界、只读请求。2026-09-30T23:42:48Z 的复核确认：分钟接口 HTTP 200；37/47/181 三个点位有迁移备注；Vicmap zone layer 3 返回 439 个 Melbourne 对象 ID；UniMelb 活动接口 HTTP 200、5 条样本有修改和取消字段。另核查了 2024 停车容量官方导出，HTTP 200、7,185 行。没有用这些结果推定许可已获批准。

### 必须修正的 P1

#### R01 · GM-09：正常连续采集仍接受无法排序的小时更正

定位：`src/connectors/com_pedestrian_hourly/index.ts:182`、`:265`、`:333`；采集入口 `src/jobs/ingest.ts:91`。

跨版本检查依赖构造参数 `previousObservations`，或人工塞入 checkpoint 的历史 JSON。实际入口加载默认连接器，传入的是时间游标；连接器成功后也只返回时间游标，既不保存本批历史摘要，也不更新下一次检查所需的状态。因此新增保护只在特定测试注入方式下生效。

**复现**：默认历史配置、同一传感器／小时、无 `Last-Modified`，先采集总数 10，再把总数改为 11 并传入第一次返回的 checkpoint；两次均为 `success`。这正是 GM-09 要求失败关闭的跨批次冲突。另外，有 `Last-Modified` 时目前只判断非空，没有比较新旧修订时间，相同时间下的冲突也不能证明可排序。

**返工要求**：在 GM-09 证据文档提出可持久化的历史摘要／修订证据接口，由集成人员接入实际 runner；在接通之前明确保留阻断。回归应经过默认加载、checkpoint 保存和下一次加载，覆盖无修订时间、相同修订时间不同值、较旧版本迟到及严格更新的官方修订，不能只手工注入历史列表。

#### R02 · GM-14：缺少解除时间时把抓取时间写成事件结束时间

定位：`src/connectors/tv_road_unplanned/index.ts:115`、`:132`、`:150`。

`effectiveClosedAt = closedAt ?? (isInactive ? (updatedAt ?? fetchedAt) : null)` 将抓取时间补成 `valid_to`。抓到已解除事故只能证明抓取时已解除，不能证明它恰好在抓取时解除；普通修改时间也需要官方语义依据才能当作解除时间。

**复现**：相同的 Inactive payload 不含 `lastClosed` 和 `lastUpdated`，分别在 13:00 和 14:00 归一化，得到相同 `version_id`，但 `valid_to` 分别为 13:00 和 14:00。同一来源版本的事件时间会随重放改变。

**返工要求**：没有官方解除时刻时保留 `valid_to = null` 并明确缺失原因，仍可依据状态标为 `resolved`。修改当前认可 fallback 的测试，增加同 payload 多次重放时事件时间一致的断言；真实 60 秒源时间仍需 KeyID 实测。

#### R03 · GM-08：冷启动保护仍依赖有限关键词和硬编码坐标

定位：`src/connectors/com_pedestrian_locations/index.ts:93`、`:99`、`:282`、`:323`。

37/47/181 的已知备注得到保护，但未列入坐标表的迁移点仍可能落入安装日 fallback。`isRelocationIndicated()` 不识别一般的 `Relocated to <address>`，且“坐标与安装坐标一致”也不能证明整个历史期间都未迁移。

**复现**：冷启动传感器 999，`installation_date = 2015-02-11`、备注 `Relocated to 368 Elizabeth Street`，没有官方坐标有效起日；连接器仍把当前坐标的 `valid_from` 写成 2015-02-11。

**返工要求**：无官方坐标有效时间或可核实旧快照时，以首次观测快照表达已知区间，并保留历史区间未知；不能因为没有匹配关键词就追溯到安装日。硬编码的原始坐标也需要官方旧快照依据。补充未列入表的传感器、无备注、不同迁移措辞和迁移后返回旧址的冷启动用例。

#### R04 · GM-07：窗口尾部尚未出现在上游时仍推进完整 checkpoint

定位：`src/connectors/com_pedestrian_minute/index.ts:142`、`:147`、`:230`。

当前检查只拒绝已过期的窗口起点或比上游最新时间更晚的起点，没有判断窗口尾部是否已可采集。分页数量一致只能证明已返回记录取完，不能证明尚未到达上游的分钟已经覆盖。

**复现**：上游最新分钟为 12:30，请求窗口为 `[12:15, 13:00)`，返回 `success`、`complete = true`、`checkpointAfter = 13:00`。下次只回看 15 分钟；当上游延迟超过该重叠范围时，尾部读数可能永久漏取。

**返工要求**：根据上游已可用的分钟边界决定安全窗口终点，或返回 `incomplete_window` 并保持 checkpoint。补充 `from <= latest < to`、上游延迟超过 15 分钟及连续两次采集的用例；缺分钟仍保留缺口，不补零。

### 必须修正的 P2

#### R05 · GM-01：同 URL、同处理时间的去重结果依赖输入顺序

定位：`src/connectors/gdelt/index.ts:209`、`:243`。

时间相同的候选使用 `>=` 选择后出现的 `gkgRecordId`，而该 ID 又参与版本摘要。**复现**：两行 URL、处理时间一致，GKG ID 分别为 `...-1` 和 `...-2`，主题分别为 A/B；仅交换两行顺序，合并后的主题相同，但 `version_id` 不同。这会让同一窗口的等价重放产生不同版本。

**返工要求**：给相同时间的来源记录建立确定性 tie-break，归并内容采用稳定顺序；增加行顺序置换和跨切片归并的回归，断言内容及版本一致。

#### R06 · GM-06：官方实测的断言失败被吞成网络跳过

定位：`test/connectors/com_offstreet_parks.test.ts:988`、`:1014`。

整个请求、归一化和断言都包在同一个 catch 中，任何错误都会 `t.skip('Network unavailable...')`。**变异验证**：在隔离目录把容量断言从 19 改为故意错误的 999，官方接口实际返回 19；测试仍以退出码 0 结束，显示 0 fail / 1 skipped，并把 `19 !== 999` 标为网络不可用。

**返工要求**：只将明确的网络不可用归类为跳过，把 schema、归一化和业务断言放在该 catch 外。错误容量、错误几何和 schema 变化必须使测试失败。官方两行 13/6 聚合为 19 的当前结果可以保留；本次未发现 2024 全表存在完全相同的重复行，不据此要求另改聚合语义。

#### R07 · GM-26：解除／迟到版本断言仍使用测试自写的视图选择器

定位：`test/integration/us4-changes.test.ts:392`、`:1772`、`:1785`。

归一化调用了生产函数，但“解除后退出 current”及“旧版本迟到不复活”仍由同一测试文件的 `queryViewCurrent()` 决定。**变异验证**：在隔离目录把生产 `sql/002_core_views.sql` 的 current 排序改成只按 `version_id DESC`，运行 `US4 Suite 4`，仍为 1 pass / 0 fail；真实 SQL 验收则在组合测试中被跳过。

**返工要求**：明确标注这部分是视图模拟，不能作为生产排序已验证的证据。在允许范围内调用真实生产 selector；若需公共模块调整，写入 GM-26 接口建议，由集成人员处理。至少证明破坏生产版本排序会触发失败；保留无 `feed_version` 时未验证的现有断言。

#### R08 · GM-20：公开访问和 HTTP 缓存被当作再利用依据

定位：`docs/handoff-evidence/GM-20-events-sources.md:91`、`:173`、`:202`。

UniMelb 接口可访问、有 CORS 和 `Cache-Control`，这些证据没有确认自动采集、仓库存储及产品展示的授权范围。文档虽承认不是开放数据许可，随后却弱化了版权撤除门槛，并用 `max-age=86400` 推导固定 24 小时巡检周期。复核的 5 条响应实际为 `max-age=131`；HTTP 缓存期限也不等同于数据保留许可或取消通知时限。

**返工要求**：保留其为技术可行的候选，明确再利用授权待核实；列出许可页面、所需授权范围与撤除条件。将 HTTP 缓存、存储保留期和产品刷新要求分开，不能据一次缓存头固定检查周期或推定可以发布。可复核接口：[UniMelb Events JSON](https://events.unimelb.edu.au/live/json/events/max/5)；许可入口：[University disclaimer](https://www.unimelb.edu.au/disclaimer)（本次未能取得明确授权证据）。

#### R09 · GM-23：待独立标注材料暴露预设答案，并有地点事实错误

定位：`docs/handoff-evidence/GM-23-news-benchmark.md:1533`、`:1534`、`:1536`；同类预设字段也出现在其他样本。

双人栏位保持空白是正确的，但样本紧邻提供了“候选预期范围”和“候选官方区域引用”，会影响独立判断。`SC004-MLO-09` 的抽样依据写为 Frankfurt，实际报道地点为 Warsaw；该项还预设 `city` 和 Melbourne 区域引用。[原出版方报道](https://www.theguardian.com/australia-news/2026/sep/20/the-gunzels-grand-final-melbourne-tramaroos-campaign-derails-at-european-tramdriver-championship)。

**返工要求**：修正地点事实，将抽样分类、预期答案和候选区域编码留在组织者记录，另提供不含这些提示的标注材料；区域版次需附官方依据。保留真实 URL 和空白人工裁定，完成两名独立审阅及仲裁前，不能用这 40 条清单计算 SC-004 成功率。

#### R10 · GM-19：把有条件的数据库禁令扩大成禁止所有持久化

定位：`docs/handoff-evidence/GM-19-local-crime-sources.md:131`、`:144`。

文档引用的 GNews 限制针对竞争服务、再分发或绕过限额的系统性存储，却将结论扩大为条款禁止一切永久数据库；引用条款编号也应核对为当前 §7。NewsAPI 同样需要区分用途限制、订阅计划和第三方内容权利。缺少结构化坐标可以作为地理验证待办，但还没有实测样本准确率来支持“严重违反 ≥95% 门槛”的结论。[GNews 官方条款](https://gnews.io/legal/terms-of-service)、[NewsAPI 官方条款](https://newsapi.org/terms)。

**返工要求**：逐条对应具体用途、可保存字段、保留期、展示权及第三方权利，把未确认授权与明确禁止区分开。当前来源仍可保持未准入，T051 仍阻断；修正研究理由不等于批准使用。不要以“存入 BigQuery”本身或“无 coordinates”直接替代许可／地理质量核验。

#### R11 · GM-11：分页和停用设备测试没有覆盖其声称验证的行为

定位：`test/connectors/com_microclimate.test.ts:756`、`:859`；`docs/handoff-evidence/GM-11.md:126`。

所谓三页测试直接覆盖 `fetchRecords()`，一次返回 11 条记录及手填 `pageCount = 3`，没有执行生产分页请求。停用设备测试则事先从输入里去掉全部旧设备，只能证明连接器没有凭空增加它们，不能证明历史遥测不会被当成现行点位。源码对返回的每条遥测都输出 `device_status = active`、`valid_to = null`，因此历史窗口与现行设备清单的关系仍需说明。

**返工要求**：在 HTTP 边界提供多页响应，让生产 OpenDataSoft 客户端实际发出 offset 请求，并覆盖末页缺失、总数变化和页间重复。加入含旧设备历史读数的输入，验证历史观测保留与当前设备状态的区分；需要共享状态／视图能力时提交接口建议。无官方退役依据时，研究表中的“停用”应收窄为“截至核查时未见近期上报”。

#### R12 · GM-01：发布日期核验仍缺少可复核原文样本

定位：`docs/handoff-evidence/GM-01.md:65`、`:70`、`:87`。

表中代表 URL 均为 `https://.../...` 占位，不能重放核查；“15 个不同发布日期”实际来自 GKG 切片处理日期。代码正确保留 `published_at = null` 并说明处理时间不等于发布时间，但证据文档仍将两者混用。

**返工要求**：记录完整原文 URL、对应切片／记录 ID，以及能核实的原始发布时间；拿不到发布时间就明确 unknown。14 天清单连续性的记录可以保留，但不能据此断言文章发布时间覆盖 15 个自然日，或当作犯罪新闻发布时间验收已完成。

### 逐项接收意见

“可接收”仅指本批候选交付满足当前审查范围，不代表来源激活或共享部署通过。

| ID | 审查提交 | 接收意见与剩余事项 |
| --- | --- | --- |
| GM-01 | `4c10130` | 返工：R05、R12；稳定去重版本，补原文 URL／发布时间证据。 |
| GM-02 | `dfbcb17` | 可接收：保留官方地区名称及缺失边界映射，不猜代码／版次；边界匹配仍待集成。 |
| GM-03 | `5b0a2c3` | 可接收：空键清洗和关联覆盖证据有效；未关联或未知占用继续保留未知。 |
| GM-04 | `edf0ad2` | 可接收：保留上游 WGS84 点，没有将点扩成虚构车位面。 |
| GM-05 | `108a859` | 可接收候选交付：旧规则和冲突保持证据不足；元数据检查／冲突辅助函数的实际接线仍由集成人员处理。 |
| GM-06 | `49454d2` | 聚合证据可保留；测试需按 R06 返工，年度容量继续不表示实时空位。 |
| GM-07 | `e42dbc9` | 返工：R04；尾部完整性和连续窗口需补验证，24 小时验收仍未完成。 |
| GM-08 | `74dcd25` | 返工：R03；已修三个已知迁移案例，尚未解决一般冷启动追溯问题。 |
| GM-09 | `99d9550` | 返工：R01；跨批次失败关闭需接入真实 runner，当前不应认定任务完成。 |
| GM-10 | `c9f0df5` | 可接收阻断记录：未找到经验证的正式替代，保持 blocked，不作为可用来源计数。 |
| GM-11 | `1422798` | 指标单位／null 保留可接收；分页及现行设备证据按 R11 补强。 |
| GM-12 | `15f6455` | 可接收：统计年解析及同版限制保留，历史就业不直接挂到 2025 多边形。 |
| GM-13 | `5b65faa` | 可接收候选修复：zone layer 3 已恢复对象 ID；zone＋overlay、分页与修订检查保留，发布另验。 |
| GM-14 | `b34bbaf` | 返工：R02；父事故／子影响契约可保留，KeyID 和真实源时间仍待核查。 |
| GM-15 | `6580208` | 可接收本地契约：未来 planned、取消及失败路径保留；真实接口待 KeyID。 |
| GM-16 | `18b0f65` | 可接收本地契约：protobuf 与 train/tram 覆盖声明明确；bus 未覆盖及实盘待办保留。 |
| GM-17 | `322deec` | 可接收本地契约：按范围 ZIP 校验、缺 feed_info 失败关闭；T066 联动仍待集成。 |
| GM-18 | `7fe62e6` | 可接收元数据契约：取消／限流路径保留；Key 和许可／撤除门槛未解除。 |
| GM-19 | `0ff89bc` | 研究理由需按 R10 修正；未选定新闻替代源，T051 继续阻断。 |
| GM-20 | `74c0e44` | 研究结论需按 R08 修正；UniMelb 仅为技术候选，不能据公开接口批准发布。 |
| GM-21 | `95330be` | 可接收：未得到官方地域代码／版次，1,106 条租金继续保留未匹配。 |
| GM-22 | `12b185d` | 可接收研究／事实清单：日月倒置、旧规则时效风险有记录；规则／节假日证据不足继续 unknown。 |
| GM-23 | `1be7f97` | 清单已交付，按 R09 修正后再发给人工审阅；仍为待双人标注。 |
| GM-24 | `a19aef0` | 可接收本地验证：增加真实健康、覆盖和发布失败路径调用；GCP SQL 验收仍跳过。 |
| GM-25 | `a7c9a1e` | 可接收本地验证：真实 normalizer 覆盖两地区／两期、null 与未匹配；GCP join 验收仍待办。 |
| GM-26 | `df024b4` | 归一化／缺 feed_version 测试可保留；生产排序验证按 R07 返工，GCP 验收仍待办。 |

### 返工后的复核顺序

1. 先关闭 R01–R04 的时间与完整性问题，新增测试须复现上述默认入口或连续采集场景。
2. 修复 R05–R12 的版本稳定性、测试盲点及研究证据；涉及共享目录的调整继续由集成人员负责。
3. 在集成分支用 Node 24 重跑完整测试，并分别记录本地通过、真实接口核查和 GCP 验收结果。保持原 `T069/T070/T071/T077` 状态和所有来源采集 Scheduler 门槛，直到各自证据满足要求。


## 2026-10-01 整合接收结果

上述首轮审阅意见作为历史记录保留。26 组分支的原始交付及返工已按固定 head 整合，并追加修复了首观测历史位置、严格 checkpoint、已发布小时更正历史、交通未知时区及跨抓取不可变事实、盲审材料和研究证据限度。逐项接收范围、固定提交和仍需完成的共享／来源准入门槛见 [整合复核](../../cloud/data/docs/validation/gemini-merge-review-2026-10-01.md)。本地 Node 24 验证为 611 通过、8 个显式云端／联网测试跳过、0 失败。来源定时及真实覆盖验收不会因本次候选代码接收而解除。
