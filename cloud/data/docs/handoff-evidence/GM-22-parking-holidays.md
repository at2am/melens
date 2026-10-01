# GM-22: 维多利亚州法定节假日与墨尔本市停车规则可用时间证据及 `may_park_now` 事实清单设计

- **任务编号**：GM-22 (关联任务：T035 停车三表关联与合法判定、T039 US1 集成测试与断言契约、SC-005 停车准入覆盖)
- **调研角色**：GM-22 证据研究员 (Evidence Researcher)
- **调研时间**：2026-09-30 22:58:00 (Australia/Melbourne) / 2026-09-30T12:58:00Z
- **唯一交付文档**：`cloud/data/docs/handoff-evidence/GM-22-parking-holidays.md`
- **并行开发约束**：独立文档交付，绝不修改代码文件或共享文档，不改动现行 `cloud/data/docs/source-policies/parking-join.md`。

---

## 1. 执行摘要与核心调研发现 (Executive Summary & Key Findings)

在实时路边停车判定中，输出 `may_park_now = yes` 属于高法律责任的确定性承诺（用户依据该判定停放车辆若被开罚单，系统承担严重数据质量责任）。依据项目宪章及 [quality-rules.md](../../../../specs/001-melbourne-data-aggregation/quality-rules.md) §5 的铁律：**“`may_park_now = yes` 仅当车位明确对公众可用、空置观测仍 current、marker_id/bay_id 关联唯一、当前时间（Australia/Melbourne，含节假日）与车辆类别均被有效且无冲突的规则覆盖，且规则明确允许停车；关联缺失、状态过期、规则冲突、节假日/豁免未知或其他合法性证据不足时必须为 unknown，不得由空置单独推断为 yes。”**

本研究针对维州官方节假日及墨尔本市停车限制规则展开了深入的有界、只读线上核查，取得以下四大关键发现：

1. **维州官方节假日数据存在严重的上游解析陷阱（重大数据质量发现）**：
   - 维州官方数据门户 DataVic 提供了名为 `Victorian Government - Important Dates API - data` 的官方数据集（资源 ID `caaa47de-8626-46a6-aa28-3d948c15c5d9`），包含 2019 至 2028 年的公共节假日（CC BY 4.0 许可）。
   - **重大质量陷阱**：DataVic 的 CKAN DataStore 数据库在自动化导入 CSV 时，其日期解析器将澳洲本土标准的 `D/M/YYYY` 日期按美式 `M/D/YYYY` 错误入库，所列 Labour Day、Good Friday 和 Melbourne Cup 样本出现**日月倒置**。尚未逐条验证全部日期，日月相等时也不能据此判断是否发生交换。例如墨尔本杯（2026-11-03）被解析成了 `2026-03-11`，劳动节（2026-03-09）被解析成了 `2026-09-03`，耶稣受难日（2026-04-03）被解析成了 `2026-03-04`！
   - **正确取数途径**：直接从 DataVic 下载原始 CSV 文件（`important-dates-august-2026.csv`）获取未经污染的原生 `D/M/YYYY` 文本，结合维州《Public Holidays Act 1993》与 Business Victoria 官方公报进行本地校验。
   - **联邦数据源失效**：联邦门户 `data.gov.au` 的全澳机器可读节假日数据集已被总理与内阁部（PM&C）正式列为 **Inactive / 弃用**，明示必须依赖各州官方渠道。Business Victoria Web 页面存在 Cloudflare 自动化访问拦截（HTTP 403），不能作为无头定时爬虫来源。

2. **墨尔本市官方停车限制数据缺乏 2026 当前有效时间凭证（时效阻碍）**：
   - 墨尔本官方限制数据集 `on-street-car-park-bay-restrictions` 的底层处理时间停留在 **2022-11-13T10:30:19Z**（已冻结近 4 年），页面明确告警停车系统改造可能导致数据中断。
   - 全表 62 个字段中，**完全不存在单行生效起止时间（`valid_from`、`valid_to`、`created_date`、`updated_date` 均无）**，其中的 `starttime1-6` 和 `endtime1-6` 仅为挂载在虚拟伪纪元 `0001-01-01` 上的时分偏移量。
   - 现行数据属于无保质期凭证的历史标牌快照。依据质量规范，无有效时间区间的规则无法证明其今日依然合法有效。

3. **墨尔本市节假日停车规则的法律与标牌逻辑（法理证据）**：
   - 依据《维多利亚州道路安全道路规则 2017》（Road Safety Road Rules 2017）第 317 条（Rule 317）及墨尔本市议会官方规定：
     - **标注特定星期的标牌（如 "Mon-Fri"）**：在法定公休日**不生效**。在限制数据集中对应 `effectiveonph = 0`。
     - **未标注星期的全周标牌（如 "2P"、"2P Meter"）**：周一至周日皆生效，在法定公休日**依然生效**。在限制数据集中对应 `effectiveonph = 1`（经核查全表有 825 条记录 `effectiveonph1 = 1`，其 `fromday1=1, today1=0` 覆盖全部 7 天）。
     - **特殊管控区（Clearway、Loading Zone、No Stopping）**：若标牌标注工作日，公休日同样不生效；但若包含 "Including Public Holidays" 或未注星期，则依然生效。
     - 若当天法定公休日判定状态为 `unknown`，则所有依赖工作日与公休日区分的规则均无法判定适用性，必须降级为 `unknown`。

4. **三表断裂现状未改，设计“事实清单 (Fact Inventory)”筑牢安全防线**：
   - 墨尔本车位传感器（`on-street-parking-bay-sensors`）使用 `kerbsideid`，车位底册（`on-street-parking-bays`）多为空键且为点要素，限制规则（`on-street-car-park-bay-restrictions`）使用 `bayid`，二者无官方背书的 1:1 交叉表。
   - 为保障下游系统绝对不产生虚假空位与虚假合法停车结论，本设计定义了由 **6 大维度、19 项原子事实**组成的严格事实清单。**缺失任何一项事实，系统无条件返回 `may_park_now = unknown`**。

---

## 2. 官方接口只读审计台账 (Bounded Read-Only API Audit Register)

本节记录所有经审计的官方接口，涵盖只读访问 URL、时间戳、HTTP 状态码、记录规模、关键字段模式以及许可证信息。

| 序号 | 数据源 / 接口标识 | 只读请求 URL / 资源定位 | 审计时间 (UTC / 本地) | HTTP 状态 | 记录条数 | 关键观测字段清单 | 许可与法律页面 |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| **IF-01** | City of Melbourne 停车限制 API | `https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-car-park-bay-restrictions/records?limit=1` | 2026-09-30T12:58:41Z<br>2026-09-30 22:58:41 | `200 OK` | 4,263 行 | `bayid`, `deviceid`, `description1-6`, `duration1-6`, `effectiveonph1-6`, `fromday1-6`, `today1-6`, `starttime1-6`, `endtime1-6`, `typedesc1-6`, `disabilityext1-6`, `exemption1-6` (共 62 字段，无有效日期) | [CC BY 4.0](https://data.melbourne.vic.gov.au/pages/terms-and-conditions/)<br>`data_processed`: 2022-11-13T10:30:19Z |
| **IF-02** | City of Melbourne 停车传感器实时 API | `https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bay-sensors/records?limit=1` | 2026-09-30T12:59:33Z<br>2026-09-30 22:59:33 | `200 OK` | 6,324 行 | `kerbsideid`, `status` (`Present`/`Unoccupied`), `laststatusupdate`, `zone_number`, `location` (经纬度点) | [CC BY 4.0](https://data.melbourne.vic.gov.au/pages/terms-and-conditions/)<br>`data_processed`: 2026-09-30T11:58:53Z (实时活跃) |
| **IF-03** | City of Melbourne 停车位底册 API | `https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bays/records?limit=1` | 2026-09-30T12:59:33Z<br>2026-09-30 22:59:33 | `200 OK` | 29,053 行 | `roadsegmentid`, 可空 `kerbsideid` (5,053 唯一点，23,981 空值), `location` (点坐标，非多边形) | [CC BY 4.0](https://data.melbourne.vic.gov.au/pages/terms-and-conditions/)<br>`data_processed`: 2026-06-25T00:52:56Z |
| **IF-04** | City of Melbourne 分区标牌数据集 API | `https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/sign-plates-located-in-each-parking-zone/records?limit=1` | 2026-09-30T12:59:39Z<br>2026-09-30 22:59:39 | `200 OK` | 1,821 行 | `parkingzone`, `restriction_days`, `time_restrictions_start`, `time_restrictions_finish`, `restriction_display` (仅 5 字段，仅限分区，无车位键，无节假日字段) | [CC BY 4.0](https://data.melbourne.vic.gov.au/pages/terms-and-conditions/)<br>`data_processed`: 2026-06-25T00:56:59Z |
| **IF-05** | DataVic 维州关键日期 CKAN DataStore API | `https://discover.data.vic.gov.au/api/3/action/datastore_search?resource_id=caaa47de-8626-46a6-aa28-3d948c15c5d9&limit=1` | 2026-09-30T12:57:12Z<br>2026-09-30 22:57:12 | `200 OK` | 143 条公休记录 (总数 3,100+) | `arun`, `dateType`, `name`, `important_date`, `publisher`, `description`, `source` (**重大缺陷：入库转换导致日月颠倒**) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)<br>发布方：Department of Government Services |
| **IF-06** | DataVic 关键日期原始 CSV 下载端点 | `https://discover.data.vic.gov.au/dataset/a8bc540d-181b-4fb5-8110-5fe52a04f6a7/resource/caaa47de-8626-46a6-aa28-3d948c15c5d9/download/important-dates-august-2026.csv` | 2026-09-30T12:57:46Z<br>2026-09-30 22:57:46 | `200 OK` | 290,970 字节 | CSV 文本：`arun,dateType,name,important_date,publisher,description,source`（**正宗澳洲 D/M/YYYY 格式**） | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)<br>文件修改时间: 2026-08-18T00:44:10Z |
| **IF-07** | Business Victoria 官方节假日页面 | `https://business.vic.gov.au/business-information/public-holidays/victorian-public-holidays-2026` | 2026-09-30T12:56:43Z<br>2026-09-30 22:56:43 | `403 Forbidden` (Cloudflare Bot Challenge) | N/A (仅供浏览器交互) | 州政府法定雇佣与节假日公报（含补假规则与管辖区域说明） | 维多利亚州版权所有；需经由 DataVic 经批准的数据管道或人工核验 |
| **IF-08** | 联邦 data.gov.au 全澳节假日数据集 | `https://data.gov.au/data/dataset/australian-holidays-machine-readable-dataset` | 2026-09-30T12:58:00Z<br>2026-09-30 22:58:00 | 页面重定向 / 状态已废弃 | 0 条活跃维护 | 标记为 Inactive；官方说明：PM&C 停止维护，重定向至各州独立门户 | 联邦政府已停止更新 |

---

## 3. 维州法定节假日数据可用性与数据质量陷阱分析 (Victorian Public Holidays Evidence & Quality Findings)

### 3.1 维州节假日的法定基础与层级体系
维多利亚州的公共节假日受《1993年公共节假日法案》（*Public Holidays Act 1993* (Vic)）管辖，并由劳工关系厅（Industrial Relations Victoria）在政府公报中正式公布。维州节假日具有以下特点：
1. **全州通用公休日（Statewide Holidays）**：包括元旦、澳大利亚日、劳动节、耶稣受难日、复活节前星期六、复活节星期日、复活节星期一、澳新军团日（ANZAC Day）、国王诞辰、圣诞节、节礼日。
2. **维州特色法定公休日**：
   - **澳式橄榄球总决赛前星期五（Friday before the AFL Grand Final）**：每年 AFL 总决赛前一天的星期五，全州公休（2026 年为 9 月 25 日）。
   - **墨尔本杯日（Melbourne Cup Day）**：每年 11 月的第一个星期二。法案明确规定墨尔本都市区所有市辖区（含 **City of Melbourne**）必须遵守；非大都市区地方议会（Non-metro councils）可申请将该公休日替换为当地赛马日或农展会日。对于本系统服务的 City of Melbourne 区域，墨尔本杯日属于**强制法定公休日**。
3. **周末顺延与补假规则（Substitute / Additional Days）**：
   - 圣诞节（12-25）若在周六或周日，周一设补假。
   - 节礼日（12-26）若在周六，下周一设补充公休日；若在周日，下周二设补充公休日。
   - 元旦若在周末，下周一补假。
   - **例外：ANZAC Day（4月25日）不设补假**。法案明确规定澳新军团日仅在 4 月 25 日当天纪念，无论是否落在周末均不补休。

### 3.2 官方 2026 年维多利亚州（City of Melbourne）法定公休日基准表
经核查 DataVic 原始官方 CSV（`important-dates-august-2026.csv`）并严格比对《Public Holidays Act 1993》法定条款，2026 年全年在 City of Melbourne 具有法律效力的法定公休日共计 14 天，确凿基准如下：

| 日期 (YYYY-MM-DD) | 官方公休日名称 (Official Holiday Name) | 星期 | 官方 CSV 原文记录 (`important_date`) | 官方备注与法律依据说明 |
| :---: | :--- | :---: | :---: | :--- |
| **2026-01-01** | New Year's Day | 周四 | `1/01/2026` | 全州公休 |
| **2026-01-26** | Australia Day | 周一 | `26/01/2026` | 全州公休 |
| **2026-03-09** | Labour Day | 周一 | `9/03/2026` | 每年三月第二个星期一 |
| **2026-04-03** | Good Friday | 周五 | `3/04/2026` | 复活节公共节假日 |
| **2026-04-04** | Saturday before Easter Sunday | 周六 | `4/04/2026` | 复活节前周六 |
| **2026-04-05** | Easter Sunday | 周日 | `5/04/2026` | 复活节周日 |
| **2026-04-06** | Easter Monday | 周一 | `6/04/2026` | 复活节周一 |
| **2026-04-25** | ANZAC Day | 周六 | `25/04/2026` | 官方备注：“ANZAC Day falls on a weekend; no replacement holiday” |
| **2026-06-08** | King's Birthday | 周一 | `8/06/2026` | 每年六月第二个星期一 |
| **2026-09-25** | Friday before the AFL grand final | 周五 | `25/09/2026` | 维州特色公休日，AFL 决赛日前周五 |
| **2026-11-03** | Melbourne Cup | 周二 | `3/11/2026` | 每年十一月首个周二，City of Melbourne 全境强制公休 |
| **2026-12-25** | Christmas Day | 周五 | `25/12/2026` | 圣诞节当天 |
| **2026-12-26** | Boxing Day | 周六 | `26/12/2026` | 节礼日当天 |
| **2026-12-28** | Boxing Day (Additional Holiday) | 周一 | `28/12/2026` | 官方备注：“As Boxing Day falls on a Saturday, an additional public holiday is given on the following Monday.” |

### 3.3 DataVic CKAN DataStore 日期解析 Bug 深度取证
在本次调研中，我们发现了维多利亚州数据门户一个潜伏极深但破坏力极强的数据污染缺陷。该取证对于后续系统接入节假日数据具有决定性意义：

- **现象**：通过官方 CKAN API 端点 `https://discover.data.vic.gov.au/api/3/action/datastore_search` 查询资源 `caaa47de-8626-46a6-aa28-3d948c15c5d9` 时，返回的 `important_date` 格式为 ISO 8601（如 `2026-03-11T00:00:00`）。
- **取证对比**：
  ```text
  【官方原始 CSV (important-dates-august-2026.csv)】:
  PUBLIC_HOLIDAY, Melbourne Cup, 3/11/2026, Business Victoria
  PUBLIC_HOLIDAY, Labour Day,    9/03/2026, Business Victoria
  PUBLIC_HOLIDAY, Good Friday,   3/04/2026, Business Victoria

  【DataVic DataStore API 查询结果】:
  _id: 2863, name: "Melbourne Cup", important_date: "2026-03-11T00:00:00"  <-- [严重错误: 11月3日变成了3月11日]
  _id: 2855, name: "Labour Day",    important_date: "2026-09-03T00:00:00"  <-- [严重错误: 3月9日变成了9月3日]
  _id: 2856, name: "Good Friday",   important_date: "2026-03-04T00:00:00"  <-- [严重错误: 4月3日变成了3月4日]
  _id: 2862, name: "AFL Friday",    important_date: "2026-09-25T00:00:00"  <-- [正确: 因日为25>12，无法混淆]
  ```
- **待验证原因**：所列样本在 CSV 与 DataStore 之间出现日月互换，现象符合日期格式误解；本次未检查 DataVic 后台实现，不能确定其 PostgreSQL、Python 库或具体入库过程。
- **系统安全防线要求**：
  1. **严禁**直接通过 DataVic 的 CKAN DataStore API 消费其输出的 `important_date` 字符串。
  2. 生产环境中获取官方节假日，必须拉取原始 CSV 文件并强制采用明确的 `DD/MM/YYYY` 解析器，或者使用经过签名的官方本地节假日事实快照。
  3. 任何节假日解析模块必须内嵌健全性自检规则（例如：验证劳动节是否在 3 月、国王诞辰是否在 6 月、墨尔本杯是否在 11 月），自检不通过时节假日日历必须判定为失效，系统节假日判定回退为 `unknown`。

---

## 4. 墨尔本市停车规则可用时间与节假日证据 (Melbourne Parking Restrictions Temporal & Holiday Evidence)

### 4.1 墨尔本市停车限制数据集现状与时间凭证缺失
墨尔本市官方在 OpenDataSoft 平台上发布了 `on-street-car-park-bay-restrictions` 数据集。对其元数据与数据行的有界核查表明：

1. **元数据停滞与系统重构告警**：
   - 官方数据集元数据字段 `data_processed` 为 `2022-11-13T10:30:19+00:00`，`modified` 为 `2022-03-01`。
   - 官方描述中明确指出：*"Upcoming Changes: Please note that our parking system is being improved and this dataset may be disrupted"*。
2. **缺乏行级别时效凭证（No Temporal Validity Dates）**：
   - 全表 62 个字段中，没有任何记录发布时间、修改时间或生效区间（`valid_from`、`valid_to`）。
   - 时间限制字段 `starttime1-6` 和 `endtime1-6` 输出形如 `0001-01-01T07:30:00+00:00`，其年份是不可信的虚拟填充，仅代表每天的时分。
   - 依据项目契约与 [parking.ts](../../../src/normalization/parking.ts) 的防伪机制：
     ```typescript
     if (rule.valid_from === null || Date.parse(rule.valid_from) > now.getTime()) return false;
     if (rule.valid_to !== null && Date.parse(rule.valid_to) <= now.getTime()) return false;
     ```
     没有当前有效的权威 `valid_from`，任何静态历史标牌都不能作为今天依然具备法律效力的准入证据。

### 4.2 墨尔本市节假日停车限制法理与 `effectiveonph` 字段取证
City of Melbourne 官方对于公共节假日的停车执法原则有清晰规定，与维州《Road Safety Road Rules 2017》Rule 317 完全一致：

1. **指定星期标牌（Days of the week signs）**：
   - 若标牌注明了具体星期（如 `Mon-Fri 7:30am-6:30pm`、`Saturday 7:30am-12:30pm`），此限制在法定公休日**一律不生效**。在法定节假日，驾驶人在此类车位停放不受该时段和计时器限制（免受罚款且免费），除非另有未注星期的标牌共存。
   - **数据取证**：限制数据集中，此类规则的 `effectiveonph` 值为 `0`。例如 `bayid: 2313`，其 `description1: "1P MTR M-F 9:30-18:30"`，`fromday1: 1, today1: 5`，对应 `effectiveonph1: 0`。
2. **未注星期标牌（Always in effect / Every day signs）**：
   - 若标牌没有列出任何星期（如单纯标为 `2P`、`1/2P Meter`），则意味着“全周生效（Monday through Sunday）”。此类标牌在法定公共节假日**依然严格生效**，驾驶人必须遵守限时或打卡付费。
   - **数据取证**：限制数据集中共有 **825 条记录** 其 `effectiveonph1 = 1`。经检查其对应字段：例如 `bayid: 6258`，其 `description1: "2P 7.30 - 22.00"`，`fromday1: 1, today1: 0`（覆盖周一至周日全 7 天），对应 `effectiveonph1: 1`。
3. **多标牌并存冲突（Conflicting Panels）**：
   - 实际街道上一根立柱常有两到三块标牌面板（Panel），例如上午是 Clearway（禁停），日间是 1P Meter（收费一小时），晚上是 Unrestricted。
   - 若其中一块面板标注了 Mon-Fri，在公休日其失效；但若立柱上同时有一块标牌注明了 `No Stopping` 且未注星期，则公休日驾驶人停车依然构成违法。
   - 因此，**缺少该车位完整立柱的所有有效规则时，不能因为一条 Mon-Fri 规则在公休日失效就草率判定为“可自由停车”**。

### 4.3 候补数据集评估：分区标牌 (`sign-plates-located-in-each-parking-zone`)
官方在 2026-06-25 更新了 `sign-plates-located-in-each-parking-zone`（1,821 条），虽然数据处理时间较新，但不能作为车位级判定的依据：
1. **仅有分区级别（`parkingzone`）**：缺乏车位物理标识（无 `bay_id`、无 `marker_id`、无 `kerbsideid`）。
2. **缺乏节假日关键属性**：仅包含 `parkingzone`、`restriction_days`、`time_restrictions_start`、`time_restrictions_finish`、`restriction_display` 五个字段，完全缺失 `effectiveonph` 或例外字段。
3. **空间精度不足**：无法区分同一分区内的装卸车位、残疾人车位、出租车专用位与普通小汽车车位。

---

## 5. `may_park_now` 事实清单设计 (Fact Inventory Specification)

为彻底阻断由于数据残缺、时效过期或虚构推断导致的误判风险，设计如下 **19 项原子事实清单**。在评估引擎执行时，必须按顺序执行严格的事实求证；**只要任何一项事实不成立、不满足或为 null/unknown，`may_park_now` 判定必须保持 `unknown`**。

```
                                  【may_park_now 事实核验图】
                                               │
             ┌─────────────────────────────────┴─────────────────────────────────┐
             ▼                                                                   ▼
   【物理/空间/传感器维度】                                              【法律/规则/日历维度】
   FACT-01: 车位官方 ID 存在                                             FACT-11: 墨尔本本地时钟精确解析
   FACT-02: 公共准入显式核实 (public_access=true)                         FACT-12: 维州节假日权威判定 (true/false)
   FACT-03: 车位版本生命周期有效 (valid_from/to)                          FACT-13: 节假日日历覆盖目标年且防倒置
   FACT-04: WGS84 几何保留，严禁造面                                     FACT-14: 规则行级生命周期有效 (valid_from/to)
   FACT-05: 车位至传感器外键 1:1 唯一                                    FACT-15: 星期与分钟时段完整覆盖
   FACT-06: 传感器观测存在且无并发冲突                                   FACT-16: 节假日规则法律逻辑匹配 (Rule 317)
   FACT-07: 传感器观测新鲜度在 2x 预算内                                 FACT-17: 目标车辆类别精准匹配 (vehicleClass)
   FACT-08: 连接器最近健康检查在 2x 预算内                                FACT-18: 无未授权许可证/豁免 (exemption=null)
   FACT-09: 传感器读数物理空置 (occupied=false)                          FACT-19: 多规则结论唯一且无歧义 (conclusions=[allow])
             └─────────────────────────────────┬─────────────────────────────────┘
                                               │
                                               ▼
                              【事实清单全部成立，且三表对齐】
                           FACT-10: 独立经核验的 HTTPS 交叉表
                                               │
                                 ┌─────────────┴─────────────┐
                                 ▼                           ▼
                        【全部满足】                     【缺任一项】
                    may_park_now = yes             may_park_now = unknown
```

### 维度 A：车位实体与空间准入事实 (Bay Entity & Physical Access)
- **[FACT-01] 官方车位唯一标识 (Official Bay Identifier)**
  - **证据要求**：车位记录必须具备官方承认且非空的规范主键（如 `bay_id`）。
  - **违例判定**：若车位记录缺失官方 ID 或 ID 格式不合规，判定终止，保持 `unknown`。
- **[FACT-02] 公共准入显式核实 (Verified Public Access)**
  - **证据要求**：车位元数据中 `public_access` 必须经过权威核验且**显式为 `true`**。
  - **违例判定**：
    - 若 `public_access === false`（明确为市政内部车位、私有专属、使领馆专用等），直接判定 `may_park_now = no`（理由：`not_public_access`）；
    - 若 `public_access === null`（无法确证是否对公众开放），禁止假定可停，保持 `unknown`（理由：`public_access_unknown`）。
- **[FACT-03] 车位版本生命周期激活 (Bay Lifetime Validity)**
  - **证据要求**：车位记录的时效区间满足：`valid_from <= now < (valid_to ?? +∞)`。
  - **违例判定**：若当前评估时间 `now` 早于生效时间或晚于失效时间，车位视作已废弃或未启用，保持 `unknown`（理由：`bay_version_expired`）。
- **[FACT-04] 空间几何无虚构 (Geometry Fidelity)**
  - **证据要求**：上游发布的 WGS84 点几何原样保留，坐标有效；禁止通过缓冲区算法人工构造虚假车位多边形。

### 维度 B：传感器占用与新鲜度事实 (Sensor Occupancy & Freshness)
- **[FACT-05] 车位至传感器外键唯一性 (Unique Bay-Sensor Association)**
  - **证据要求**：车位使用的物理关联键（如 `marker_id` / `kerbsideid`）在全量有效车位表中具有**严格唯一性（Exactly 1:1）**。
  - **违例判定**：若该键为空、或多条车位记录共享相同 marker，存在歧义，保持 `unknown`（理由：`bay_marker_not_unique`）。
- **[FACT-06] 传感器观测存在且无冲突 (Observation Existence & Concurrency Clearance)**
  - **证据要求**：对应传感器在当前批次中至少存在 1 条观测记录；若在同一最新时间戳存在多条记录，其 `occupied` 状态与设备 ID 必须完全一致。
  - **违例判定**：无观测记录返回 `unknown`（理由：`occupancy_missing`）；并发读数冲突返回 `unknown`（理由：`occupancy_conflict`）。
- **[FACT-07] 传感器观测时间新鲜度受控 (Observation Freshness Budget)**
  - **证据要求**：观测时间戳 `observed_at` 距评估时间 `now` 的延迟 `age = now - observed_at` 必须满足：$0 \le age \le 2 \times \text{cadence\_seconds}$。
  - **违例判定**：若 $age > 2 \times \text{cadence\_seconds}$，新鲜度降级为 `stale`，禁止推导可用性，保持 `unknown`（理由：`occupancy_stale`）。
- **[FACT-08] 连接器健康检查新鲜度受控 (Connector Liveness Budget)**
  - **证据要求**：连接器最近成功同步时间 `lastSuccessfulCheckAt` 距 `now` 的延迟必须满足：$0 \le checkAge \le 2 \times \text{cadence\_seconds}$。
  - **违例判定**：若上游拉取任务中断超时，保持 `unknown`。
- **[FACT-09] 物理空置观测证明 (Physical Vacancy Fact)**
  - **证据要求**：在满足 FACT-05 至 FACT-08 的前提下，最新传感器读数 `occupied === false`。
  - **分流判定**：若 `occupied === true`，无论规则如何，直接判定 `may_park_now = no`（理由：`occupied`）。

### 维度 C：跨源三表对齐事实 (Cross-Source Join Integrity)
- **[FACT-10] 独立经核验的规则对照凭据 (Verified Rule Crosswalk)**
  - **证据要求**：必须提供经发布的独立对照对象 `VerifiedRuleCrosswalk`，包含 `bayId`、`sensorBayId`、`ruleBayId`、官方证据链接 `evidenceUrl`（必须为合法 `https://` 协议）且标记 `verified === true`。
  - **违例判定**：若缺乏独立交叉表凭据，严禁以同名 `bay_id` 猜测关联，保持 `unknown`（理由：`rule_crosswalk_unverified`）。

### 维度 D：本地时钟与节假日真实性事实 (Local Clock & Holiday Truth)
- **[FACT-11] 澳大利亚/墨尔本本地时钟精确解析 (Accurate Local Clock)**
  - **证据要求**：评估时刻 `now` 必须在 `Australia/Melbourne` 时区下精确解析，自动适配冬令时（AEST，UTC+10）与夏令时（AEDT，UTC+11），提取星期 $day \in [1..7]$（周一=1 .. 周日=7）及当日分钟数 $minute \in [0..1439]$。
  - **违例判定**：若本地时区无法解析，抛出异常终止。
- **[FACT-12] 维州法定节假日明确事实 (Definitive Public Holiday Fact)**
  - **证据要求**：当天是否属于 City of Melbourne 法定公共节假日必须有确凿事实，即 `melbournePublicHoliday` 必须显式为 `true` 或 `false`，不得为 `null`。
  - **违例判定**：若当前日期是否为节假日无法证实（如外部节假日接口失效、未配置当年度日历），保持 `unknown`（理由：`rule_ambiguous` / `holiday_unknown`）。
- **[FACT-13] 节假日日历覆盖有效性与防倒置校验 (Calendar Vintage & Integrity Guarantee)**
  - **证据要求**：节假日数据源必须覆盖当前评估年份，且必须通过关键公休日健全性校验（排查 DD/MM 倒置）。超出已发布年份（如 > 2028 年）时，节假日状态自动标记为未确证。

### 维度 E：停车规则时效与适用性事实 (Rule Validity & Legal Applicability)
- **[FACT-14] 规则行级生命周期有效凭据 (Rule Lifetime Validity)**
  - **证据要求**：适用的停车规则必须包含合法的生效起止时间，且满足：`rule.valid_from !== null && rule.valid_from <= now < (rule.valid_to ?? +∞)`。
  - **违例判定**：若规则缺失 `valid_from`（如当前 2022 年未标注起止日期的静态快照），视作未获时效证实的规则，保持 `unknown`（理由：`no_current_rule`）。
- **[FACT-15] 当天星期与分钟时段精确覆盖 (Time Slot Matching)**
  - **证据要求**：规则的 `days_of_week` 数组必须包含当前星期 $day$，且 $minute$ 必须满足：$rule.start\_minute\_of\_day \le minute < rule.end\_minute\_of\_day$。
- **[FACT-16] 节假日规则法律逻辑匹配 (Statutory Public Holiday Applicability)**
  - **证据要求**：依据维州 Road Rules Rule 317：
    - 若规则为指定工作日规则（`holiday_applicability === 'does_not_apply'` 或 `effectiveonph === 0`）：
      - 当 `melbournePublicHoliday === true` 时，该规则**在此刻不生效**；
      - 当 `melbournePublicHoliday === false` 时，该规则正常生效；
    - 若规则为全周无指定星期规则（`holiday_applicability === 'applies'` 或 `effectiveonph === 1`）：
      - 无论是否为公休日，该规则均生效；
    - 若 `melbournePublicHoliday === null`，只要规则不是在任何情况下均生效的绝对规则（`all_days`），规则结论直接置为 `unknown`。
- **[FACT-17] 目标车辆类别精准匹配 (Target Vehicle Class Match)**
  - **证据要求**：评估上下文中的 `vehicleClass`（如 `'car'`）必须与规则允许的车型一致（`rule.vehicle_class === 'all'` 或匹配该车型）。
  - **违例判定**：若规则限定残疾人专用（`disability`）、装卸货车（`loading_vehicle`）、公交车（`bus`）或摩托车（`motorcycle`），对于普通私家车属于禁止或不适用，保持 `unknown` 或 `no`。
- **[FACT-18] 无未授权许可证或特殊豁免 (No Unresolved Permit Exemptions)**
  - **证据要求**：规则中的 `exemption` 字段必须为 `null`。
  - **违例判定**：若标牌注明特定许可证豁免（如 "Permit A holders excepted"、"Resident Exempt"），普通公众无法证明具备许可证，推导结论置为 `unknown`。

### 维度 F：多规则冲突消除与确定性 (Conflict Resolution & Unambiguity)
- **[FACT-19] 适用规则推断结果唯一性 (Single Unambiguous Allow Conclusion)**
  - **证据要求**：在车位当前时刻匹配到的所有适用规则中，经 FACT-14 至 FACT-18 评估后的结论集合 `conclusions` 必须**有且仅有 1 个元素，且该元素为 `'allow'`**（例如明确的合法允许停车标牌 `1P`、`2P`、`parking_allowed`）。
  - **违例判定**：
    - 若结论集合包含 `'prohibit'`（如 Clearway 禁停、No Stopping），判定 `may_park_now = no`（理由：`rule_prohibits`）；
    - 若匹配到 0 条规则，判定为无当前有效规则，保持 `unknown`（理由：`no_current_rule`）；
    - 若匹配到多条规则且存在冲突、或者结论中包含 `'unknown'`，保持 `unknown`（理由：`rule_ambiguous`）。

---

## 6. 决策真值表与状态转移矩阵 (Decision Truth Table & Scenarios)

以下矩阵穷举了在不同事实具备程度下的判定结果，展示系统如何将不确定性严格封锁在 `unknown`，确保系统绝不输出虚假的 `yes`：

| 场景编号 | 空间与车位事实<br>(FACT 01–04) | 传感器与新鲜度事实<br>(FACT 05–08) | 传感器物理占用<br>(FACT 09) | 三表对照表<br>(FACT 10) | 维州节假日事实<br>(FACT 11–13) | 规则时效与适用<br>(FACT 14–18) | 规则无歧义<br>(FACT 19) | 最终判定<br>`may_park_now` | 判定理由码 (`reasons`) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **SC-01** | 全部齐备 (`public_access=true`) | 全部新鲜 (`current`) | `false` (空置) | 经官方核验 | 明确已知 (`true`/`false`) | 有效且匹配 | 唯一允许 (`allow`) | **`yes`** | `verified_allow` |
| **SC-02** | 全部齐备 (`public_access=true`) | 全部新鲜 (`current`) | **`true` (已被占)** | 任意 / 无关 | 任意 / 无关 | 任意 / 无关 | 任意 / 无关 | **`no`** | `occupied` |
| **SC-03** | **`public_access=false`** | 任意 / 无关 | 任意 / 无关 | 任意 / 无关 | 任意 / 无关 | 任意 / 无关 | 任意 / 无关 | **`no`** | `not_public_access` |
| **SC-04** | 全部齐备 (`public_access=true`) | 全部新鲜 (`current`) | `false` (空置) | 经官方核验 | 明确已知 | 处于禁停时段 | 唯一禁止 (`prohibit`) | **`no`** | `rule_prohibits` |
| **SC-05** | 全部齐备 (`public_access=true`) | 全部新鲜 (`current`) | `false` (空置) | **缺失 / 未核验** | 明确已知 | 规则齐全 | 允许 | **`unknown`** | `rule_crosswalk_unverified` |
| **SC-06** | 全部齐备 (`public_access=true`) | 全部新鲜 (`current`) | `false` (空置) | 经官方核验 | 明确已知 | **规则无 valid_from (2022静态)** | 规则缺失 | **`unknown`** | `no_current_rule` |
| **SC-07** | 全部齐备 (`public_access=true`) | 全部新鲜 (`current`) | `false` (空置) | 经官方核验 | **未知 (`null`)** | 工作日限制标牌 (`effectiveonph=0`) | 歧义 | **`unknown`** | `rule_ambiguous` |
| **SC-08** | 全部齐备 (`public_access=true`) | **过期 (`stale`)** | `false` (空置) | 经官方核验 | 明确已知 | 有效且匹配 | 允许 | **`unknown`** | `occupancy_stale` |
| **SC-09** | 全部齐备 (`public_access=true`) | 全部新鲜 (`current`) | `false` (空置) | 经官方核验 | **是节假日 (`true`)** | **工作日限制失效且无兜底标牌** | 0 条适用规则 | **`unknown`** | `no_current_rule` |
| **SC-10** | 全部齐备 (`public_access=true`) | 全部新鲜 (`current`) | `false` (空置) | 经官方核验 | 明确已知 | 1P允许 与 Clearway禁停并发 | 结果冲突 | **`unknown`** | `rule_ambiguous` |
| **SC-11** | 全部齐备 (`public_access=true`) | 全部新鲜 (`current`) | `false` (空置) | 经官方核验 | 明确已知 | 仅限残疾人车牌 (`disability`) | 私家车不匹配 | **`unknown`** | `rule_ambiguous` |
| **SC-12** | **Marker 不唯一/缺失** | 观测丢失 | `null` | 经官方核验 | 明确已知 | 有效且匹配 | 允许 | **`unknown`** | `bay_marker_not_unique`, `occupancy_missing` |

---

## 7. 对下游实现 (T035/T039) 与验收准入 (SC-005) 的落地指引

### 7.1 与规范化引擎 `cloud/data/src/normalization/parking.ts` 的契约兼容性
现行 `cloud/data/src/normalization/parking.ts` 中的核心函数 `evaluateParkingBay` 已经内建了高度完备的契约骨架：
1. **时钟与星期转换**：`localClock(now)` 将 `Australia/Melbourne` 本地星期映射为 `Mon=1 .. Sun=7`，完全匹配 SQL 和 TypeScript 统一规范。
2. **时效检查拦截**：
   ```typescript
   if (rule.valid_from === null || Date.parse(rule.valid_from) > now.getTime()) return false;
   if (rule.valid_to !== null && Date.parse(rule.valid_to) <= now.getTime()) return false;
   ```
   该逻辑确保了墨尔本市 2022 年历史遗留的静态规则（`valid_from === null`）绝不会被错误放行，直接返回 `reasons: ['no_current_rule']`。
3. **节假日判别分支**：
   ```typescript
   if (holiday === null && rule.holiday_applicability !== 'all_days') return 'unknown';
   if (holiday === true && rule.holiday_applicability === 'does_not_apply') return 'unknown';
   ```
   若节假日为 `true` 且该规则不适用于节假日（即工作日规则），该单条规则在节假日不成立。如果现场没有其他全天候允许停车的标牌凭证，系统将因没有当前有效规则而返回 `unknown`，绝不会擅自断言可以免费停放。

### 7.2 对 BigQuery SQL 视图 `v_parking_current` 的防御性建议
在构建 SQL 聚合层时，必须遵守以下铁律：
1. **严禁在无官方 Crosswalk 的情况下执行 `bays.bay_id = restrictions.bayid` 的简单内连接**：两表 ID 域完全不同，强行关联会导致荒谬的错配。
2. **`may_park_now` 字段的 SQL 输出防护**：
   ```sql
   -- 在缺少已核实三表交叉表与当前有效规则时，may_park_now 严格恒等于 'unknown'
   CASE
     WHEN bay.public_access = FALSE THEN 'no'
     WHEN obs.occupied = TRUE AND obs_freshness = 'current' THEN 'no'
     WHEN crosswalk.verified IS TRUE AND rule_allowed IS TRUE AND obs.occupied = FALSE AND obs_freshness = 'current' THEN 'yes'
     ELSE 'unknown'
   END AS may_park_now
   ```

### 7.3 对集成测试与准入验收 (T039 / SC-005) 的裁决标准
在执行 `cloud/data/test/integration/us1-street.test.ts` 与项目整体验收门槛 SC-005 时：
1. **现状清醒判断**：由于 City of Melbourne 上游官方 API 目前既未开放包含 `marker_id` 的完整三表关联，也未更新 2022 年以后的停车限制时效区间，**当前真实生产环境下的墨尔本数据尚未达到输出 `may_park_now = yes` 的客观准入条件**。
2. **测试边界清晰化**：
   - 现存针对 `may_park_now = yes` 的 30 个正向样例属于**契约完备性合成测试（Synthetic Contract Fixtures）**，用于保障评估算法在未来数据就绪时的正确性；
   - 10 个异常测试样例（覆盖交叉表缺失、规则过期、传感器读数陈旧、节假日未知等）必须全部断言为 `unknown` 或 `no`；
   - 严禁为了促成集成测试通过而伪造生产上游字段或放宽准入限制。真实生产验收门槛应记录为：“*待墨尔本市议会发布包含现代 `kerbsideid` 的规则数据集及官方三表映射凭证*”。

---

## 8. 调研总结与交接清单 (Handoff Checklist)

- [x] **官方节假日可用性与质量陷阱取证完成**：
  - 查明 DataVic 关键日期数据资源 `caaa47de-8626-46a6-aa28-3d948c15c5d9`。
  - 揭露并记录了 DataVic CKAN DataStore API 的 `D/M/YYYY` 转换为 `M/D/YYYY` 的重大入库错误。
  - 确认了 2026 年维多利亚州 City of Melbourne 适用的 14 个法定公休日确凿日期。
  - 查明联邦 `data.gov.au` 节假日源已废弃、Business Victoria 门户存在反爬限制的事实。
- [x] **墨尔本市停车规则可用时间证据查明**：
  - 确认限制数据集 `on-street-car-park-bay-restrictions` 停滞于 2022-11-13，缺少行级生效区间与传感器外键。
  - 确认了 Rule 317 在数据层通过 `effectiveonph`（0 与 1）的体现与对应机制。
  - 评估了分区标牌数据集，确认其缺乏车位级颗粒度。
- [x] **`may_park_now` 事实清单设计完成**：
  - 梳理出涵盖 6 大维度、19 项原子事实的完整判定事实清单。
  - 制定了详尽的决策真值表，明确了“缺任一项必保持 `unknown`”的防御机制。
- [x] **严格遵守开发隔离规则**：
  - 独立生成唯一交接文档 `cloud/data/docs/handoff-evidence/GM-22-parking-holidays.md`。
  - 未触碰任何共享源码文件或共享文档，保持树环境整洁。
