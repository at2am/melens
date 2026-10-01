# Gemini 交付整合复核，2026-10-01

## 范围与接收结果

从基线 `671ae27` 收集 GM-01 至 GM-26 的 26 个独立分支、41 个提交的净改动，共 74 个文件。按每个分支的固定 head 做三方整合，保留主工作区已经完成的 Census、HTTP、预算及 GTFS 关联改动；整合没有文件冲突。分支和提交的完整清单见本文末尾。

全部 26 组交付已纳入代码或研究记录。接收候选实现、研究和阻断记录不会自动批准来源、启用调度或通过实际覆盖验收。集成后的清单仍为 61/77 项完成；六个来源已在开发 BigQuery 发布，八类覆盖仍为 1/8。

| ID | 接收内容 | 仍需完成的门槛 |
| --- | --- | --- |
| GM-01 | GDELT 窗口去重、稳定 tie-break、完整原文链接证据 | 原始发布日期缺失继续 unknown；本地犯罪覆盖与来源发布另验 |
| GM-02 | CSA 地区原名、空键清洗及未匹配统计事实 | 官方地域代码／版次依据及发布 |
| GM-03 | 停车传感器键、时间和未知占用保留 | 官方规则 crosswalk、时效、节假日／施工条件 |
| GM-04 | 官方车位 WGS84 点及缺键事实 | 不以缺少面几何否认真实点；三表关联仍待完成 |
| GM-05 | 停车规则处理时间及冲突辅助函数 | 元数据校验与冲突函数接入真实采集，当前规则／假日依据 |
| GM-06 | 年度 establishment 容量聚合和输入顺序回归 | 许可及发布；容量继续不代表实时空位 |
| GM-07 | 上游延迟尾窗失败关闭、分钟完整性及 DST 测试 | 默认不启用未接通发布边界的 clamp；连续运行验收 |
| GM-08 | 冷启动首观测区间，移除安装日／硬编码坐标回溯 | 跨 Cloud Run 历史状态和不可变 closure 版本尚未接通，保持候选 |
| GM-09 | 严格、有界 checkpoint 摘要和更正排序校验 | Root 接入已发布历史；真实行人联合发布和来源修订证据另验 |
| GM-10 | 原 transport activity 端点 404 和候选调查 | 没有可验证替代，保持 blocked |
| GM-11 | 13 类指标、单位／null、HTTP 分页和稳定观测事实 | 官方设备现行状态及云端发布；不从历史读数推断设备 active |
| GM-12 | CLUE 统计年份、行业及同版限制 | 官方跨版对应关系；历史指标不挂到当前多边形 |
| GM-13 | zone／overlay 分类和完整分页，官方恢复记录 | 许可及开发集发布；空层仍失败关闭 |
| GM-14 | 父事故／子影响和解除事实，稳定父子版本 | offsetless 时间没有确认时区，保留原文并置规范时间 null |
| GM-15 | 计划道路生命周期、完整快照 revision 和稳定来源状态 | offsetless 时间规则待确认；未来显示由查询时刻派生 |
| GM-16 | 两模式 protobuf、父 feed 内容版本及模式向量 revision | FULL_DATASET 消失成员的当前可见性及静态版本关联 |
| GM-17 | 按范围 ZIP 校验、缺 feed_info 失败关闭 | archive digest 不能代替发布方可比较 feed_version |
| GM-18 | Ticketmaster 元数据、取消和限流契约 | 已有 Secret；留存、撤除条件与实际覆盖仍待准入 |
| GM-19 | 犯罪新闻候选与用途／存储条款区别 | 未选定合规替代；无坐标不能自行断定准确率低于 95% |
| GM-20 | 活动源 API／取消字段和授权研究 | UniMelb 网站条款限制未经许可自动提取；不以 CORS／缓存批准再利用 |
| GM-21 | 租金官方地域版次调查 | 1,106 条租金继续保留 missing 映射 |
| GM-22 | 节假日及停车所需事实清单 | 缺少任一许可停车事实继续 unknown |
| GM-23 | 40 条原文链接、组织者记录和单独重排盲审表 | 两名独立人工审阅、仲裁和模型评分，T048 保持未完成 |
| GM-24 | 调用生产健康／发布函数的本地故障和恢复测试 | 实际 GCP 来源健康与覆盖验收 |
| GM-25 | 调用生产 normalizer 的区域／统计期、null 和未匹配测试 | 实际 BigQuery 地域关联验收 |
| GM-26 | 生产 normalizer、SQL 排序结构契约及模拟测试说明 | 文本变异只验证结构；不能替代 US4 实际查询执行验收 |

## 整合过程中追加的修复

- GM-08 不再凭安装日或硬编码坐标推断历史位置。P0 回归明确小时观测早于首个位置快照时为 unlocated，计数仍保留。
- GM-09 对 JSON 摘要使用 schema 校验并限制 50,000 条。`ingest` 对每个小时窗口从已发布 BigQuery 观测及同版本来源事实读取历史，再交给默认连接器；UTC 覆盖 checkpoint 继续由 GCS 连续完成窗口推进。发布器在来源锁内检查 sensor-hour 的版本修订证据，防止并发或上游 native ID 改变绕过校验。
- 行人查询视图按来源更正时间／序号选版本，去掉以版本哈希决定新旧的逻辑；来源事实关联必须同时匹配 source、batch 和 version。
- GM-06 的业务/schema 错误不再当网络跳过。GM-11 分页经过生产 HTTP 客户端，设备状态没有官方依据时保持 null，位置和地理事实不因本批尾部或抓取时刻改变。
- GM-14/15 不猜 offsetless 时间的时区，不把抓取时刻补成事故解除时刻。GM-14 父事件内容变化传递到子影响版本；GM-15 保留来源状态，查询视图将尚未开始的 active 计划显示为 planned。
- GM-19/20 收窄超出授权或地理样本证据的结论。GM-23 新增 [独立盲审材料](../handoff-evidence/GM-23-news-blind-review.md)，组织者答案与审阅材料分文件保存。GM-26 明确结构检查和视图模拟的证据限度。

## 验证

- Node.js 24.21.0：619 项测试，611 通过，8 个显式配置的云端／联网测试跳过，0 失败。
- Python SQL／预算基础设施测试：8/8 通过。
- 新增回归经默认 registry 加载连接器，清除进程内历史后重新读取已发布事实；无可排序修订时间的更正失败关闭。损坏摘要、过量摘要和缺 BigQuery 计费上限均在采集前拒绝。
- 实际 GCP 发布套件 4/4 通过：BigQuery Load 与 Storage Write 两条路径、发布／重放／迟到／取消／撤权、UTC checkpoint 恢复，以及默认小时历史读取和 native ID 改变后的无序更正拒绝。套件在随机隔离数据集／bucket 内执行，finally 清理成功，不启用来源调度。最新的独立小时验证也 2/2 通过：真实执行更新后的 street／changes SQL，哈希 `zz-old`／`aa-new` 逆序时，行人视图正确返回来源修订更新的计数 21。第二套隔离资源也已清理。

## 保留的集成事项

T035/T037/T039 的停车三表规则、GM-08 的持久化位置历史、GTFS 同版证明及完整快照成员、新闻双人验收、来源准入、来源专属身份／成本参数、自动部署和 24 小时运行仍未完成。T031/T042/T048/T061/T063/T066/T069/T070/T071/T077 不因本次候选代码接收而关闭；Police、VicEmergency 和犯罪新闻替代源继续遵守原条件门槛。

## 接收的固定分支版本

| ID | 分支 | Head | 净改动文件数 |
| --- | --- | --- | ---: |
| GM-01 | `subagent-GM-01-Connector-Dev-self-5855038c` | `13758a481ce070e2a689e7fe13b167ba17dedc4f` | 4 |
| GM-02 | `subagent-GM-02-Connector-Dev-self-e4f951fc` | `dfbcb170449b3a3aa21c07984aea82909a34dcb4` | 3 |
| GM-03 | `subagent-GM-03-Connector-Dev-self-79899843` | `5b0a2c34d4607417089f5c572e34a9e4e2058317` | 3 |
| GM-04 | `subagent-GM-04-Connector-Dev-self-efc6487d` | `edf0ad22b9586b8e4b274d08c93c9787edd551af` | 4 |
| GM-05 | `subagent-GM-05-Connector-Dev-self-c0e72e20` | `108a859bf74d4c7c68ac3689538be27e318a13e4` | 3 |
| GM-06 | `subagent-GM-06-Connector-Dev-self-0a9957c8` | `7dbb5921360628ebb1c2706930cab0168aaf95a0` | 4 |
| GM-07 | `subagent-GM-07-Connector-Dev-self-df772bc1` | `6df12b899df5ec580f43c03eeda5171ee0613507` | 4 |
| GM-08 | `subagent-GM-08-Connector-Dev-self-dd64f1d8` | `04d58af27df18261f97d610021dd71014f63a4ff` | 4 |
| GM-09 | `subagent-GM-09-Connector-Dev-self-21aea97d` | `6a854344948c3cad2573a2c82a4d13586ab20679` | 3 |
| GM-10 | `subagent-GM-10-Connector-Dev-self-7ba699c7` | `c9f0df583b69727cd169638704711b0dc9414078` | 4 |
| GM-11 | `subagent-GM-11-Connector-Dev-self-56b60e1f` | `7ccce18f53b9524f9438cfb359046c55c09f9dc6` | 3 |
| GM-12 | `subagent-GM-12-Connector-Dev-self-79b25c6f` | `15f64550f2c631f997db571b0e797874a0785e94` | 3 |
| GM-13 | `subagent-GM-13-Connector-Dev-self-f8c95528` | `5b65faae10a05b8696ae025a71bc80f038fd7cb0` | 3 |
| GM-14 | `subagent-GM-14-Connector-Dev-self-212c0c5e` | `a698ca1c0d54f047499043a4e3123abecee19439` | 3 |
| GM-15 | `subagent-GM-15-Connector-Dev-self-709da281` | `841ab6d3d72ff82eccb195b1f2e1ea9f14b43639` | 4 |
| GM-16 | `subagent-GM-16-Connector-Dev-self-a09cf1f1` | `de1f9cf44da6a54591a1932620ad5b841129d15a` | 4 |
| GM-17 | `subagent-GM-17-Connector-Dev-self-b0d56106` | `2229a83ab0145ff2de83189596e039d7f7091dbf` | 4 |
| GM-18 | `subagent-GM-18-Connector-Dev-self-5b29c3f7` | `7fe62e6431a07160f8eb2afe1ee611e2ca491cea` | 3 |
| GM-19 | `subagent-GM-19-Evidence-Researcher-self-fd66f4d5` | `ac24c16cc0c067252c076e37000f1f4d274d549d` | 1 |
| GM-20 | `subagent-GM-20-Evidence-Researcher-self-5b946506` | `71a635e56a6d6e004a53bdbcc068b1a094d1e358` | 1 |
| GM-21 | `subagent-GM-21-Evidence-Researcher-self-16574cc8` | `95330be14608b4031d336d45ad73e1413d2e232d` | 1 |
| GM-22 | `subagent-GM-22-Evidence-Researcher-self-5735cde3` | `12b185d41f373ce95bad4acfd438cd3896ce4472` | 1 |
| GM-23 | `subagent-GM-23-Evidence-Researcher-self-1584dddb` | `9ba60ad72f05e508af44f3348171c427264c9d3e` | 1 |
| GM-24 | `subagent-GM-24-Integration-Test-Dev-self-350abd80` | `a19aef042b091490a01c4a1f5dce6c339ebf8666` | 2 |
| GM-25 | `subagent-GM-25-Integration-Test-Dev-self-e49f542a` | `a7c9a1ebcead06a59cf49e07b069eb924f895e02` | 2 |
| GM-26 | `subagent-GM-26-Integration-Test-Dev-self-64461743` | `efced632bb1d48183bef062bf994ce6c8fe11cbb` | 2 |
