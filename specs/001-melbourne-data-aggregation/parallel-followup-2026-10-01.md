# 并行任务补充，2026-10-01

原 `gemini-parallel-handoff-2026-09-30.md` 的 26 个任务及独占路径继续有效。本文件补充实际云端证据，不要求 Gemini 修改共享模块或 GCP。

## 已由三个 Codex subagent 合并的工作

| 工作 | 当前结果 |
| --- | --- |
| 部署权限与 HTTP | 交通 probe 专用身份仅访问三个来源的账本／锁和 Transport Secret。私有请求拒绝重定向；HTTP 完整响应和流读取受超时控制。真实本地服务器测试 15/15 通过。 |
| T066 GTFS 关联 | 未经验证的班次日期／时间不生成坐标；格式无效返回 `invalid_alert`。相关测试 11/11 通过。真实静态／实时同版依据与生产关联仍待完成。 |
| T048 新闻验收 | 删除状态补齐即满分认证的逻辑；缺少双人独立裁定或模型输出时保持未认证。目标测试 14/14 通过，T048 重新打开。 |

Root 已完成预算自然消息、阈值暂停、重复投递与清理；四个全局防护验证为 true。所有来源定时仍关闭。全量 Node 24 测试为 457 通过、6 个默认跳过的云端验收、0 失败；任务清单为 61/77 已完成，16 项待完成。

## 对 Gemini 当前任务的补充

两项 Secret 已有启用版本 1。Transport Key 经 Cloud Run 私有任务验证，可完整读取非计划道路、计划道路和火车／电车警报；密钥值未在本地读取。Ticketmaster 的密钥配置不解除条款／留存门槛。Gemini 仍不读取 Secret 值或操作 GCP。

| 已分配 ID | 新证据和修订重点 |
| --- | --- |
| GM-14 / T031 | 两次完整道路快照为 291／290 个影响要素。第二次 290 个 `lastUpdated` 全部缺时区，当前 UTC 转换使 16 个来源事实落在未来。取得正式时区依据或拒绝 offsetless 时间；不能据此证明新鲜度或版本顺序。保留真实解除与预计结束的区别。 |
| GM-15 / T061 | 两次各 19 个 token 页完整返回 9,450／9,452 事件、9,465／9,467 地理要素，零拒绝。第二次 9,452 个 lastUpdated 全部缺时区；现有 Victorian 转换得到比抓取早约十小时的最新更新。需要为该端点单独核实时间规则，不能把无未来时间当作转换正确；补充重复版本测试，保持候选状态。 |
| GM-16 / T063 | 两模式实盘均 200，完整 19 警报。重复相同警报但 feed 时间变化时，同一 immutable key 的内容会冲突；仅取两个 feed 时间最大值也无法标识较慢模式的变化。按审阅文档修订警报／父 feed 版本及整批 revision，并验证重放。 |
| GM-17 / T062 | 官方静态包缺 `feed_info` 的事实保持；`archive-sha256` 不能伪装 publisher `feed_version`。寻找正式可比较依据，否则继续未定位。 |
| GM-23 / T048 | 建立真实可核查 URL 与独立待标注栏。测试评估器已禁止自动满分，不能用填满状态或代理自标注替代双人裁定和模型评分。 |
| GM-26 / T068 | Root 为适配新共享契约，仅将正向 `validSelector` 的 `tripStartDate`、`tripStartTime` 改为 null。有班次实例约束的场景应保持 `trip_instance_unverified` 或 `invalid_alert`，直到具备 calendar/frequency 证据。 |

详细证据与 scoped 修订建议见：

- [交通私有云端实测](../../cloud/data/docs/validation/transport-private-probe-2026-10-01.md)
- [GTFS 关联及发布复核](../../cloud/data/docs/validation/gtfs-integration-review-2026-10-01.md)
- [预算响应验证](../../cloud/data/docs/validation/budget-response.md)

来源级准入、共享当前快照可见性、BigQuery 发布、专属运行身份和 P0 联合验收仍由 Root 集成。候选代码修订可以并行，不能将一次成功读取当作来源已发布或 T077 已通过。
