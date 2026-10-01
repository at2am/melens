# GM-23 (T048) 维州新闻地理标注双人复核基准集清单

> **交付物说明**：本文件为任务 **GM-23**（关联规范任务 **T048**）的唯一交付凭证，文件路径独占 `cloud/data/docs/handoff-evidence/GM-23-news-benchmark.md`。
> **严格遵循并行开发与准入准则**：未修改任何代码文件或共享文档；仅对公开可访问的官方/主流新闻出版源实施**有界、只读核查**；建立含真实来源 URL 的 4 大类别各 10 条（共 40 条）待双人标注基准集清单。
> **核心门禁与盲审防污染声明 (R09 返工专项声明)**：
> 1. **双人盲审材料隔离**：本文件严格将“待独立标注材料清单”（独立文件，见第 4 节）与“组织者基准对照表”（本文第 5 节）分开保存；待独立标注材料单独保存于 `GM-23-news-blind-review.md`，只包含重排后的无类别编号、原文 URL、待核查标题与日期，标注栏完全留空，绝对不含预期答案、抽样分类或候选区域提示**，杜绝污染审阅独立性。
> 2. **SC-004 未通过声明**：**在两名独立审阅人完成标注及仲裁之前，绝对不能用这 40 条清单计算 SC-004 成功率或声称 SC-004 已通过**。代码作者严禁代为伪造人工标注，当前状态必须保持为 `pending_human_adjudication` (`sc004Certified: false`)。

---

## 1. 任务背景与验收门槛状态

| 项目 | 规定要求 | 当前状态 | 备注说明 |
| :--- | :--- | :--- | :--- |
| **任务编号** | T048 (GM-23) | **已交付待审清单** | 独占凭证文档交付 |
| **关联指标** | SC-004 (spec.md §Measurable Outcomes) | **pending_human_adjudication** | 待两名独立人类审阅者盲审裁定，**未认证通过** |
| **计算门禁** | 禁止在双人标注完成前计算成功率 | **严格遵守** | 明确声明在独立审阅及仲裁完成前不得计算通过率 |
| **材料隔离** | 待标注材料不得暴露预期答案与分类 | **彻底解耦** | 独立盲审文件与本文组织者对照表分开保存 |
| **空间规范** | quality-rules.md §3 (空间归属与新闻合并) | **已建立映射规则** | 严格禁止无来源依据捏造精确街道点 (Point) |
| **复核规范** | quality-rules.md §6 (双人标注样本规则) | **已规范复核格式** | 维州事发、同名海外地、仅提及、多地点各 >= 10 条 |
| **区域规则 (G05)** | Geelong / Ballarat 归入 `victoria` | **已适配候选范围** | Geelong (LGA 22750) 与 Ballarat (LGA 20570) 范围为 `victoria` |
| **事实准确性** | 修正外部报道地点事实偏差 | **已修正** | 修正 SC004-ITEM-39 赛事举办地为波兰华沙 (Warsaw) 事实 |

---

## 2. 官方/权威接口有界只读核查记录

根据任务要求，本基准集不使用虚构或过期的 placeholder 域名（如 `.example`），所有 40 条候选条目及补充候选条目均在 **2026-09-30 UTC** 进行了有界只读 HTTP 核查，验证其真实存在、可访问性及字段完整度：

| 来源媒体 / 出版机构 | 目标地理范畴 | 采样检索端点 / 协议 | 核查时间 (UTC) | HTTP 状态 | 返回格式 | 采样条数 | 验证字段 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **The Guardian Australia** | 维州本地、大墨尔本、全州政治与气候 | `https://www.theguardian.com/australia-news/...` | 2026-09-30 23:06 | `200 OK` | `text/html; charset=UTF-8` | 30 条 | `title`, `datePublished`, `description`, `article:section`, 正文地理指称 |
| **Space Coast Daily** | 美国佛罗里达州墨尔本市 (Melbourne, FL) | `https://spacecoastdaily.com/2026/09/...` | 2026-09-30 23:06 | `200 OK` | `text/html; charset=UTF-8` | 10 条 | `title`, `datePublished`, `description`, 地方市政/警务事实 |
| **Derby Telegraph (Reach plc)** | 英国德比郡墨尔本镇 (Melbourne, Derbyshire, UK) | `https://www.derbytelegraph.co.uk/news/local-news/...` | 2026-09-30 23:02 | `200 OK` | `text/html; charset=utf-8` | 1 条 (补充) | `title`, `description`, 教区民政/规划事实 |
| **White River Now** | 美国阿肯色州墨尔本市 (Melbourne, Arkansas, USA) | `https://www.whiterivernow.com/2026/09/...` | 2026-09-30 23:01 | `200 OK` | `text/html` | 1 条 (补充) | `title`, `pubDate`, 县治司法管辖事实 |
| **WRIC 8News (Nexstar)** | 美国弗吉尼亚州里士满市 (Richmond, Virginia, USA) | `https://www.wric.com/news/local-news/richmond/...` | 2026-09-30 23:01 | `200 OK` | `text/html; charset=UTF-8` | 1 条 (补充) | `title`, `datePublished`, 市议会政务事实 |

**核查防护与限流边界**：只读检查采用 10 秒超时门槛与并发度限制（并发数 <= 8），未抓取未授权的大规模文章正文，仅记录元数据、标题、发布日期与地理证据摘要。

---

## 3. 官方行政区划与边界版次依据 (Authoritative Boundary Vintages)

根据项目边界准入凭证 [asgs-boundaries.md](../source-policies/asgs-boundaries.md) 及官方机构发布元数据，本基准集中涉及的所有候选区域编码均具备权威官方依据并严格标注确切版次（Vintage），杜绝虚构或混用未定义年份：

1. **City of Melbourne 市中心多边形 (`COM_MUNICIPAL:1:2025`)**：
   - **发布机构**：墨尔本市政府（City of Melbourne Open Data Platform）；
   - **官方依据**：City of Melbourne Municipal Boundary 2025。对应范围为市辖区（CBD、Carlton、Docklands、Southbank、Parkville 等）；在新闻归属中对应范围 `city`。
2. **地方政府区域 LGA 边界 (`ASGS_LGA:<code >:2025`)**：
   - **发布机构**：澳大利亚统计局（Australian Bureau of Statistics, ABS）；
   - **官方依据**：ABS Australian Statistical Geography Standard (ASGS) Edition 3 (2025 Annual LGA Release)；
   - **版次说明**：项目的 2026 快照中 LGA 使用正式发布的 **`vintage = 2025`**；2021 统计则对应 2021 同版边界。该规则以 [已核查准入记录](../source-policies/asgs-boundaries.md) 为依据（如 Melbourne LGA `24600:2025`、Port Phillip LGA `25900:2025`、Yarra LGA `27350:2025`、Greater Geelong LGA `22750:2025`、Ballarat LGA `20570:2025` 等）。
3. **大墨尔本都市区统计边界 (`ASGS_GCCSA:2GMEL:2026`)**：
   - **发布机构**：澳大利亚统计局（ABS）；
   - **官方依据**：ABS ASGS Edition 4 (July 2026 - June 2031) Geospatial Web Services Catalog，Greater Capital City Statistical Areas (GCCSA) 2026 版次；
   - **空间范围**：大墨尔本大都市统计区（2GMEL）。对应范围为 `greater_melbourne`。
4. **维多利亚州州界 (`ASGS_STE:2:2026`)**：
   - **发布机构**：澳大利亚统计局（ABS）；
   - **官方依据**：ABS ASGS Edition 4 State/Territory (STE) 2026 版次（State Code 2 = Victoria）。对应范围为 `victoria`。
5. **G05 区域城市范围判定规则**：
   - 依据 ABS ASGS 2026 官方定义，Geelong（`ASGS_LGA:22750:2025`）与 Ballarat（`ASGS_LGA:20570:2025`）位于大墨尔本 GCCSA (`2GMEL`) 边界之外，属于维多利亚州区域城市（Regional Victoria）；
   - 因此其候选预期范围严格归入 **`victoria`**，**绝不能判定为 `greater_melbourne`**。

---

## 4. 独立标注材料

仅向审阅人分发单独文件 [GM-23-news-blind-review.md](GM-23-news-blind-review.md)，各自使用独立副本。该文件只包含随机重排后的无类别样本 ID、原始 URL、待核查标题与日期，以及空白标注栏。不得分发本文、组织者摘要、分类或对照表。原文事实与元数据仍由审阅人核查；清单不代表已完成双人标注或来源准入。

以下 ID 对照仅供组织者在两份独立标注提交后核对：

| 盲审 ID | 组织者样本 ID |
|---|---|
| REVIEW-001 | SC004-ITEM-08 |
| REVIEW-002 | SC004-ITEM-35 |
| REVIEW-003 | SC004-ITEM-37 |
| REVIEW-004 | SC004-ITEM-29 |
| REVIEW-005 | SC004-ITEM-22 |
| REVIEW-006 | SC004-ITEM-23 |
| REVIEW-007 | SC004-ITEM-38 |
| REVIEW-008 | SC004-ITEM-28 |
| REVIEW-009 | SC004-ITEM-06 |
| REVIEW-010 | SC004-ITEM-10 |
| REVIEW-011 | SC004-ITEM-31 |
| REVIEW-012 | SC004-ITEM-11 |
| REVIEW-013 | SC004-ITEM-05 |
| REVIEW-014 | SC004-ITEM-32 |
| REVIEW-015 | SC004-ITEM-14 |
| REVIEW-016 | SC004-ITEM-17 |
| REVIEW-017 | SC004-ITEM-20 |
| REVIEW-018 | SC004-ITEM-04 |
| REVIEW-019 | SC004-ITEM-26 |
| REVIEW-020 | SC004-ITEM-09 |
| REVIEW-021 | SC004-ITEM-27 |
| REVIEW-022 | SC004-ITEM-16 |
| REVIEW-023 | SC004-ITEM-07 |
| REVIEW-024 | SC004-ITEM-40 |
| REVIEW-025 | SC004-ITEM-21 |
| REVIEW-026 | SC004-ITEM-39 |
| REVIEW-027 | SC004-ITEM-18 |
| REVIEW-028 | SC004-ITEM-13 |
| REVIEW-029 | SC004-ITEM-03 |
| REVIEW-030 | SC004-ITEM-25 |
| REVIEW-031 | SC004-ITEM-02 |
| REVIEW-032 | SC004-ITEM-15 |
| REVIEW-033 | SC004-ITEM-12 |
| REVIEW-034 | SC004-ITEM-30 |
| REVIEW-035 | SC004-ITEM-33 |
| REVIEW-036 | SC004-ITEM-34 |
| REVIEW-037 | SC004-ITEM-01 |
| REVIEW-038 | SC004-ITEM-19 |
| REVIEW-039 | SC004-ITEM-36 |
| REVIEW-040 | SC004-ITEM-24 |

---

## 5. 组织者候选记录与抽样依据

> **【使用权限声明】**
> 本节内容为基准集设计组织者与仲裁委员会专用的基准对照表，**严禁在双人盲审阶段提前出示给审阅人**。
> 待两名独立人类审阅人完全独立分别提交独立盲审文件后，组织者方可使用本文的候选记录调查分歧项；候选记录不能覆盖人类独立判断。

| 样本编号 | 原始 ID | 抽样类别 | 候选预期范围 | 候选官方区域引用 | 真实地理事实与抽样依据分析 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SC004-ITEM-01** | `SC004-VIC-01` | A. 维州事发 | `victoria` | `ASGS_LGA:27450:2025`<br>`ASGS_STE:2:2026` | The Guardian Victoria emergency dispatch: fatal bus and two-car collision in Yarra Ranges near Glenburn, Victoria |
| **SC004-ITEM-02** | `SC004-VIC-02` | A. 维州事发 | `greater_melbourne` | `COM_MUNICIPAL:1:2025`<br>`ASGS_GCCSA:2GMEL:2026` | The Guardian Melbourne crime investigation: series of retail tobacconist arson firebombings across Melbourne |
| **SC004-ITEM-03** | `SC004-VIC-03` | A. 维州事发 | `victoria` | `ASGS_STE:2:2026` | The Guardian Victoria Police active incident dispatch: violent axe assault and subsequent police manhunt in regional Victoria |
| **SC004-ITEM-04** | `SC004-VIC-04` | A. 维州事发 | `victoria` | `ASGS_STE:2:2026` | The Guardian Victoria Police integrity / coroner inquest coverage: formal police apology over death in Victorian police cells |
| **SC004-ITEM-05** | `SC004-VIC-05` | A. 维州事发 | `city` | `COM_MUNICIPAL:1:2025`<br>`ASGS_LGA:24600:2025` | The Guardian financial crimes court reporting: National Gallery of Victoria (St Kilda Rd, Melbourne CBD) employee prosecution |
| **SC004-ITEM-06** | `SC004-VIC-06` | A. 维州事发 | `greater_melbourne` | `ASGS_LGA:25900:2025`<br>`ASGS_GCCSA:2GMEL:2026` | The Guardian inner-city civic dispute reporting: Gasworks Arts Park community picnic space dispute in City of Port Phillip |
| **SC004-ITEM-07** | `SC004-VIC-07` | A. 维州事发 | `victoria` | `ASGS_LGA:22750:2025`<br>`ASGS_STE:2:2026` | The Guardian Geelong industrial emergency archive: Corio Viva Energy refinery blaze in Greater Geelong LGA (G05 scope: victoria) |
| **SC004-ITEM-08** | `SC004-VIC-08` | A. 维州事发 | `city` | `COM_MUNICIPAL:1:2025`<br>`ASGS_LGA:24600:2025` | The Guardian Melbourne cultural venue review: record 60,000 attendance EDM concert at Marvel Stadium, Docklands (City of Melbourne) |
| **SC004-ITEM-09** | `SC004-VIC-09` | A. 维州事发 | `city` | `COM_MUNICIPAL:1:2025`<br>`ASGS_LGA:24600:2025` | The Guardian major sporting dispatch: NFL exhibition match hosted at the Melbourne Cricket Ground (MCG), City of Melbourne |
| **SC004-ITEM-10** | `SC004-VIC-10` | A. 维州事发 | `victoria` | `ASGS_STE:2:2026` | The Guardian Victorian Ombudsman investigation report: solitary confinement findings at Victorian youth justice facility |
| **SC004-ITEM-11** | `SC004-OVS-01` | B. 同名海外 | `unknown` | `[]` (无维州实体) | Space Coast Daily police blotter: fatal vehicle collision on NASA Boulevard investigated by Melbourne Police Dept, Melbourne, Florida |
| **SC004-ITEM-12** | `SC004-OVS-02` | B. 同名海外 | `unknown` | `[]` (无维州实体) | Space Coast Daily coastal emergency bulletin: search and identification of missing bodyboarder off Melbourne Beach, Florida |
| **SC004-ITEM-13** | `SC004-OVS-03` | B. 同名海外 | `unknown` | `[]` (无维州实体) | Space Coast Daily commercial development report: construction of The Aston at Longleaf near Wickham Road, Melbourne, Florida |
| **SC004-ITEM-14** | `SC004-OVS-04` | B. 同名海外 | `unknown` | `[]` (无维州实体) | Space Coast Daily municipal safety advisory: pedestrian/bicycle traffic initiative by Melbourne Police Department, Florida |
| **SC004-ITEM-15** | `SC004-OVS-05` | B. 同名海外 | `unknown` | `[]` (无维州实体) | Space Coast Daily community obituary records: Eileen Virnig memorial service in Melbourne, Brevard County, Florida |
| **SC004-ITEM-16** | `SC004-OVS-06` | B. 同名海外 | `unknown` | `[]` (无维州实体) | Space Coast Daily community memorial archive: Robert Ford II obituary in Melbourne, Florida |
| **SC004-ITEM-17** | `SC004-OVS-07` | B. 同名海外 | `unknown` | `[]` (无维州实体) | Space Coast Daily prep athletics scoreboard: Melbourne High School Bulldogs victory over Palm Bay in Melbourne, Florida |
| **SC004-ITEM-18** | `SC004-OVS-08` | B. 同名海外 | `unknown` | `[]` (无维州实体) | Space Coast Daily performing arts review: Space Coast Symphony Orchestra season concerts in Melbourne and Vero Beach, Florida |
| **SC004-ITEM-19** | `SC004-OVS-09` | B. 同名海外 | `unknown` | `[]` (无维州实体) | Space Coast Daily civic ceremony report: Space Coast Honor Flight return to Melbourne Orlando International Airport, Florida |
| **SC004-ITEM-20** | `SC004-OVS-10` | B. 同名海外 | `unknown` | `[]` (无维州实体) | Space Coast Daily municipal aviation history: founding and operations of Melbourne Airport in Brevard County, Florida |
| **SC004-ITEM-21** | `SC004-PMO-01` | C. 仅提及 | `city` | `COM_MUNICIPAL:1:2025`<br>`ASGS_LGA:24600:2025` | The Guardian Bureau of Meteorology climate data summary: national winter weather statistics referencing Melbourne temperature readings |
| **SC004-ITEM-22** | `SC004-PMO-02` | C. 仅提及 | `city` | `COM_MUNICIPAL:1:2025`<br>`ASGS_LGA:24600:2025` | The Guardian national arts review: Harold Pinter drama critique mentioning the Melbourne production season run |
| **SC004-ITEM-23** | `SC004-PMO-03` | C. 仅提及 | `victoria` | `ASGS_STE:2:2026` | The Guardian environmental heritage feature: National Trust Victoria public voting contest for landmark trees across Victoria |
| **SC004-ITEM-24** | `SC004-PMO-04` | C. 仅提及 | `greater_melbourne` | `ASGS_GCCSA:2GMEL:2026` | The Guardian opinion column: personal essay on family integration and junior sporting culture across Melbourne suburbs |
| **SC004-ITEM-25** | `SC004-PMO-05` | C. 仅提及 | `victoria` | `ASGS_STE:2:2026` | The Guardian civic calendar explainer: multi-jurisdictional daylight saving schedule mentioning Victoria time regulations |
| **SC004-ITEM-26** | `SC004-PMO-06` | C. 仅提及 | `victoria` | `ASGS_STE:2:2026` | The Guardian state legal policy dispatch: Victorian Government legislative policy reform proposals |
| **SC004-ITEM-27** | `SC004-PMO-07` | C. 仅提及 | `victoria` | `ASGS_STE:2:2026` | The Guardian political party finance reporting: administrative levies on candidates contesting Victorian state parliament seats |
| **SC004-ITEM-28** | `SC004-PMO-08` | C. 仅提及 | `victoria` | `ASGS_STE:2:2026` | The Guardian economic analysis: industrial policy shift regarding large-scale data centre approvals across Victoria |
| **SC004-ITEM-29** | `SC004-PMO-09` | C. 仅提及 | `victoria` | `ASGS_STE:2:2026` | The Guardian regulatory policy report: gas industry advocacy campaigns against Victorian residential building electrification rules |
| **SC004-ITEM-30** | `SC004-PMO-10` | C. 仅提及 | `victoria` | `ASGS_STE:2:2026` | The Guardian healthcare legislation debate: statutory clinical healthcare protections under Victorian state law |
| **SC004-ITEM-31** | `SC004-MLO-01` | D. 多地点 | `victoria` | `ASGS_LGA:22750:2025`<br>`ASGS_GCCSA:2GMEL:2026`<br>`ASGS_STE:2:2026` | The Guardian energy disruption reporting: Corio Geelong oil refinery fire causing fuel supply impacts across Melbourne and regional Victoria |
| **SC004-ITEM-32** | `SC004-MLO-02` | D. 多地点 | `greater_melbourne` | `ASGS_GCCSA:2GMEL:2026`<br>`ASGS_STE:2:2026` | The Guardian multi-jurisdictional meteorology dispatch: comparative extreme temperature forecasts for Melbourne, Sydney, Adelaide |
| **SC004-ITEM-33** | `SC004-MLO-03` | D. 多地点 | `city` | `COM_MUNICIPAL:1:2025`<br>`ASGS_GCCSA:2GMEL:2026`<br>`ASGS_STE:2:2026` | The Guardian statewide infrastructure royal commission: hearings examining Melbourne Metro Tunnel, West Gate Tunnel, and regional rail contracts |
| **SC004-ITEM-34** | `SC004-MLO-04` | D. 多地点 | `greater_melbourne` | `ASGS_GCCSA:2GMEL:2026`<br>`ASGS_STE:2:2026` | The Guardian regional atmospheric dispatch: cloud phenomenon documented across Melbourne metropolitan suburbs and regional Victoria |
| **SC004-ITEM-35** | `SC004-MLO-05` | D. 多地点 | `city` | `COM_MUNICIPAL:1:2025`<br>`ASGS_LGA:22750:2025`<br>`ASGS_STE:2:2026` | The Guardian federal infrastructure review: comparative funding reallocations between Melbourne Airport rail and Geelong fast rail corridors |
| **SC004-ITEM-36** | `SC004-MLO-06` | D. 多地点 | `city` | `COM_MUNICIPAL:1:2025`<br>`ASGS_GCCSA:2GMEL:2026`<br>`ASGS_STE:2:2026` | The Guardian public transport network modernisation: rollout of tap-and-go ticketing across Melbourne metropolitan and regional V/Line routes |
| **SC004-ITEM-37** | `SC004-MLO-07` | D. 多地点 | `greater_melbourne` | `COM_MUNICIPAL:1:2025`<br>`ASGS_GCCSA:2GMEL:2026` | The Guardian national economic study: inter-capital city analysis comparing residential tenancy cost burdens in Melbourne and Sydney |
| **SC004-ITEM-38** | `SC004-MLO-08` | D. 多地点 | `greater_melbourne` | `COM_MUNICIPAL:1:2025`<br>`ASGS_GCCSA:2GMEL:2026` | The Guardian macroeconomic real estate analysis: multi-region housing study comparing Melbourne affordability against Sydney and regional Victoria |
| **SC004-ITEM-39** | `SC004-MLO-09` | D. 多地点 | `unknown` | `COM_MUNICIPAL:1:2025`<br>`ASGS_GCCSA:2GMEL:2026` | The Guardian international sports feature: Melbourne Yarra Trams team (Melbourne Tramaroos) competing at the European TramDriver Championship in Warsaw, Poland |
| **SC004-ITEM-40** | `SC004-MLO-10` | D. 多地点 | `city` | `COM_MUNICIPAL:1:2025`<br>`ASGS_LGA:22750:2025`<br>`ASGS_LGA:20570:2025`<br>`ASGS_LGA:22620:2025`<br>`ASGS_STE:2:2026` | The Guardian state transport network report: regional fare cap implementation linking Melbourne CBD with Geelong, Ballarat, and Bendigo lines |

### 5.1 重点地理事实与争议项说明 (Critical Geographic Clarifications)

1. **SC004-ITEM-39 (`SC004-MLO-09`) 报道实际地点修正**：
   - **实际报道事实**：新闻标题为 *The gunzels’ grand final: Melbourne Tramaroos’ campaign derails at European TramDriver Championship*，报道正文明确指出：欧洲电车司机锦标赛由来自欧洲各国及特邀队伍角逐，**实际赛事举办地在波兰华沙 (Warsaw, Poland)**（正文证据：“The Warsaw event saw 26 teams compete...”）。
   - **地理事实解析**：
     - 赛事活动实体地点为海外波兰华沙，非维多利亚州辖区；
     - 澳大利亚墨尔本市（Yarra Trams 墨尔本电车队）仅为参赛队伍来源地（代表地）；
     - 修正此前误将赛事举办地点写为德国法兰克福的重大事实差错；
     - 组织者基准将本项的核心事件发生地标记为海外（`scope: unknown`），墨尔本作为来源提及地，严禁直接给该海外赛事挂载 City of Melbourne 精确点坐标。

2. **SC004-ITEM-07 (`SC004-VIC-07`) 与 SC004-ITEM-31 (`SC004-MLO-01`) Geelong 炼油厂火灾与 G05 规则**：
   - **实际报道事实**：Geelong 市 Corio 工业区的 Viva Energy 炼油厂发生火灾；该事件影响到全维多利亚州及墨尔本的燃油供给；
   - **G05 规则核验**：Corio 位于 Greater Geelong LGA（`ASGS_LGA:22750:2025`）。根据 ABS ASGS 2026 GCCSA 划分，Geelong 位于大墨尔本大都市区（2GMEL）以外，属于 Regional Victoria；
   - **范围归属**：预期范畴严格为 `victoria`，绝不判定为 `greater_melbourne`。

3. **SC004-ITEM-11 至 SC004-ITEM-20 (`SC004-OVS-01` ~ `10`) 佛州墨尔本市同名消歧**：
   - **实际报道事实**：所有 10 篇报道均来自美国佛罗里达州布里瓦德县墨尔本市（Melbourne, Brevard County, Florida, USA）当地正规媒体 *Space Coast Daily*；
   - **范围归属**：所有 10 条真实报道预期范围全部为 `unknown`，候选区域引用严格为空数组 `[]`，严格测试算法对同名海外城市的隔离能力。

---

## 6. 补充验证的同名海外地候选源 (Supplemental Global Same-Name Sources)

除核心 10 条 Melbourne, Florida 真实报道外，本次调研亦对以下同名海外地区的正规新闻源完成了有界 HTTP 验证，作为后续人工复核阶段的同名消歧备选扩展库：

1. **英国德比郡墨尔本镇 (Melbourne, Derbyshire, UK)**
   - **标题**: We don't want more homes: Historic Melbourne parish council development dispute
   - **URL**: [https://www.derbytelegraph.co.uk/news/local-news/we-dont-want-more-homes-10195680](https://www.derbytelegraph.co.uk/news/local-news/we-dont-want-more-homes-10195680)
   - **HTTP 状态**: `200 OK` (Server: CloudFront / Reach plc)
   - **消歧证据**: 涉及英国南德比郡（South Derbyshire District Council）民政教区，与维州墨尔本完全无关。

2. **美国阿肯色州墨尔本市 (Melbourne, Arkansas, USA)**
   - **标题**: Melbourne Man Charged with Rape, 5 Other Felony Sex Offenses
   - **URL**: [https://www.whiterivernow.com/2026/09/27/melbourne-man-charged-with-rape-5-other-felony-sex-offenses/](https://www.whiterivernow.com/2026/09/27/melbourne-man-charged-with-rape-5-other-felony-sex-offenses/)
   - **HTTP 状态**: `200 OK` (Server: nginx / White River Now)
   - **消歧证据**: 涉及美国阿肯色州伊萨德县（Izard County, Arkansas）司法管辖，与维州墨尔本完全无关。

3. **美国弗吉尼亚州里士满市 (Richmond, Virginia, USA)**
   - **标题**: Community partner reacts to shocking Richmond City Council meeting
   - **URL**: [https://www.wric.com/news/local-news/richmond/community-partner-reacts-shocking-city-council-meeting/](https://www.wric.com/news/local-news/richmond/community-partner-reacts-shocking-city-council-meeting/)
   - **HTTP 状态**: `200 OK` (Server: nginx / WordPress VIP)
   - **消歧证据**: 涉及弗吉尼亚州首府 Richmond 市政厅辩论，同名消歧检验防止误挂维州 Richmond 郊区（`ASGS_LGA:27350:2025`）。

---

## 7. SC-004 质量门槛判定规则与防护机制

根据 [spec.md](../../../../specs/001-melbourne-data-aggregation/spec.md) 与 [quality-rules.md](../../../../specs/001-melbourne-data-aggregation/quality-rules.md) §6：

1. **通过标准 (Pass Criteria)**：
   - **裁决准确率门槛**：
     $$\text{Adjudicated Accuracy} = \frac{\text{Correctly Classified Stories}}{\text{Total Benchmark Stories}} \ge 95\% \quad (\ge 38 / 40)$$
   - **未证实精确点坐标容忍度**：必须严格为 0（$\text{Unverified Point Count} = 0$），零容忍任何未经验证的点坐标生成。

2. **当前门禁状态**：
   由于当前清单处于 `pending_human_adjudication` 状态，两名人类审阅者尚未填报独立评定结果，仲裁小组亦未召开仲裁：
   - **SC-004 认证结论**：**未认证 (sc004Certified: false)**；
   - **禁止计算成功率**：在两名独立审阅人完成标注及仲裁之前，绝对不能用这 40 条清单计算 SC-004 成功率；
   - **阻止过早准入**：自动化测试套件 `us2-news.test.ts` 中的 `evaluateSC004HumanBenchmark` 将在检测到未完成裁定时显式阻断认证，不以合成数据冒充人类复核。

3. **后续人类评审工作流**：
   - 项目负责人分发独立盲审文件的两份副本至两名独立标注员（不得提供第 5 节对照表）；
   - 标注员根据独立盲审文件分别独立录入判定结论；
   - 差异项由数据工程负责人与领域专家调取第 5 节组织者记录进行裁定；
   - 裁定完成后，统一填入仲裁结果，更新 `adjudication_status: "adjudicated"`，方可执行 SC-004 最终合格认定。

---
*文档生成于 2026-10-01 00:08:00 UTC · 任务 GM-23 独占交付物 (R09 返工修订版)*
## 8. 集成复核限制，2026-10-01

本次仅核对隔离材料格式、候选记录和已发布边界版次。没有代替两名人类审阅者逐篇裁定，也没有运行模型评分。本文来源的新闻链接不是自动抓取许可，包含 Guardian 的材料须按来源许可复核后才可作为模型输入；人工研究名单不能解除该来源的数据聚合或 AI 用途限制。T048 与 SC-004 继续待人工裁定和经许可的模型评分。
