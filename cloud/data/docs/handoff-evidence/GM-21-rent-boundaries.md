# GM-21 交付证据：Homes Victoria 租金官方 LGA 边界映射与跨表核查调研报告

**更新时间**：2026-09-30\
**任务认领**：GM-21（关联规范不变式 T055 / T058：Homes Victoria 季度租金官方 LGA 边界映射与空间准入阻断调研）\
**独占交付文件**：
- `cloud/data/docs/handoff-evidence/GM-21-rent-boundaries.md`

**并行开发与隔离声明**：
- 本任务严格执行并行开发隔离规则，未修改任何工程源码文件（`cloud/data/src/*`）、测试套件（`cloud/data/test/*`）或现有共享文档（如 `parking-join.md`、`operations.md` 等）。
- 仅交付上述独占核查文档。

---

## 1. 调研执行摘要与核心结论

针对已入库并发布的 1,106 条 Homes Victoria 季度租金指标记录（覆盖 2025-Q2 与 2025-Q3 两个季度，每个季度 79 LGA × 7 房型 = 553 条事实），关于是否可将其关联到 ABS ASGS 或 Vicmap 官方行政区划多边形，本调研在 2026-09-30 对 DataVic、Homes Victoria 官方发布资产、澳大利亚统计局（ABS）ASGS 空间服务以及维多利亚州权威行政区划库（Vicmap Admin）执行了严格、有界、只读的技术核查。

### 核心结论（Fail-Closed 裁定）
1. **官方源文件彻底缺失空间代码与地理年份**：Homes Victoria 发布的季度租金官方 Excel 工作簿（XLSX）**未包含任何 ABS 5 位 LGA 编码、未包含任何维州州级 3 位 LGA 编码、亦未包含任何几何或空间参考，全表仅有纯文本区域名与大区名**。工作簿及 DataVic 平台元数据中，**未声明任何统计地理标准版本（如 ASGS 2011/2016/2021/2025）或法定边界生效年份**。
2. **严禁按名称相似度直接把 1,106 条租金贴到 ASGS 几何面**：
   - **名称不一致导致匹配崩塌**：79 个市议会中有多个官方名称存在缩写（如 `Mornington Penin'a`）、连字符（如 `Colac-Otway` vs `Colac Otway`）或跨州重名消歧后缀（如 `Bayside` vs `Bayside (Vic.)`、`Kingston` vs `Kingston (Vic.)`、`Latrobe` vs `Latrobe (Vic.)`）。按名称直接匹配 ABS ASGS 会导致至少 5 到 6 个核心区域静默丢失或错配至外州。
   - **行政区划更名引发历史时空错位**：工作簿系 1999 年至 2025 年（共 106 个季度）的长周期回溯表，通篇直接使用 2022 年才更名的 `Merri-bek`（原 Moreland）。若直接匹配 ASGS 2021 会因缺少 Merri-bek 失败；若直接匹配 ASGS 2025，则将 2025 年划分的多边形强行追溯至 2000 年代，违反 T058 跨年份边界不变式。
3. **维州官方跨表映射现状**：维州权威行政区划库 `Vicmap Admin`（Layer 9）虽然提供了全州 79 个市议会与非自治区的维州 `lga_code` 到 `abs_lga_code` 的法定对照，但其记录的 ABS 代码仍停留在 ASGS 2021 版本（如 Merri-bek 处仍对应 2021 年 Moreland 代码 `25250`，而非 ASGS 2025 代码 `24700`）。
4. **架构治理裁定**：
   - 维持当前连接器与归一化设计：**1,106 条记录继续严格保持 `boundary_mapping_status = 'missing'`、`geometry = null`、`boundary_id` 显式标为 `unresolved`**。
   - 严禁在未引入经官方验证并附带双向版本（source vintage + target vintage）显式 Crosswalk 资产前，将租金数据渲染为面状多边形。

---

## 2. 官方接口有界只读核查证据清单

核查时间：`2026-09-30T12:55:00Z` 至 `2026-09-30T13:00:00Z`（澳洲东部时间 2026-09-30 22:55 - 23:00）。所有核查均为只读 GET 请求，无任何写操作。

| 官方接口 / 资源 | 官方核查事实与元数据记录 |
| --- | --- |
| **DataVic CKAN Dataset Package** | **URL**: `https://discover.data.vic.gov.au/api/3/action/package_show?id=rental-report-quarterly-quarterly-median-rents-by-lga`<br>**HTTP 状态**: `200 OK`<br>**数据提供方**: Homes Victoria / Department of Families, Fairness and Housing (DFFH)<br>**许可协议**: `Creative Commons Attribution 4.0 International` (`license_id: cc-by`)<br>**许可页面 URL**: `https://creativecommons.org/licenses/by/4.0/`<br>**数据集标题**: Rental Report - Quarterly: Quarterly Median Rents by LGA<br>**资源总数**: 26 个（包含历史回溯与当期季度工作簿）<br>**元数据更新时间**: `2026-02-24T06:12:07.577509` |
| **Homes Victoria 官方 Excel 资产 (Latest XLSX)** | **URL**: `https://www.dffh.vic.gov.au/quarterly-median-rents-local-government-area-september-quarter-2025-excel`<br>**跳转 URL**: `https://www.dffh.vic.gov.au/sites/default/files/documents/202602/quarterly-median-rents-local-government-area-september-quarter-2025-excel.xlsx`<br>**HTTP 状态**: `307 Temporary Redirect` -> `200 OK`<br>**文件大小**: `674,773` 字节 (~659 KB)<br>**Last-Modified**: `Fri, 20 Feb 2026 01:17:41 GMT`<br>**工作表结构**: 共 7 个工作表 (`1br flat`, `2br Flat`, `3br Flat`, `2br House`, `3br House`, `4br House`, `All Properties`)<br>**时序覆盖**: 1999 年 6 月至 2025 年 9 月，共 106 个季度时序，每张表包含 214 列（大区名、LGA 名，加 106 季度的 `Count` 与 `Median` 列对）<br>**要素行数**: 7 个工作表每张表均**严格包含 79 行地方政府区域（LGA）**，无多无少。<br>**单季/双季记录数**: 单季度事实为 `79 × 7 = 553` 条，两个季度事实为 `553 × 2 = 1,106` 条。 |
| **ABS ASGS 2021 LGA 官方图层服务** | **URL**: `https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/LGA/MapServer/0/query?where=state_code_2021='2'&outFields=lga_code_2021,lga_name_2021,state_name_2021&returnGeometry=false&f=json`<br>**HTTP 状态**: `200 OK`<br>**维州要素总数**: **82 条**（包含 79 个市议会，加 `29399` Unincorporated Vic、`29499` No usual address、`29799` Migratory）<br>**字段**: `lga_code_2021`, `lga_name_2021`, `state_name_2021` |
| **ABS ASGS 2025 LGA 官方图层服务** | **URL**: `https://geo.abs.gov.au/arcgis/rest/services/ASGS2025/LGA/MapServer/0/query?where=state_code_2021='2'&outFields=LGA_CODE_2025,LGA_NAME_2025,STATE_NAME_2021&returnGeometry=false&f=json`<br>**HTTP 状态**: `200 OK`<br>**维州要素总数**: **82 条**<br>**字段**: `LGA_CODE_2025`, `LGA_NAME_2025`, `STATE_NAME_2021`, `AREA_ALBERS_SQKM` 等 |
| **Vicmap Admin 官方行政边界服务 (Layer 9: LGA Polygon)** | **URL**: `https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/arcgis/rest/services/Vicmap_Admin/FeatureServer/9/query?where=1=1&outFields=*&returnGeometry=false&f=json`<br>**HTTP 状态**: `200 OK`<br>**维州要素总数**: **87 条**（79 个市议会多边形 + 8 个非自治海岛/高山度假区，如 Mount Buller、Falls Creek、French Island 等）<br>**关键映射字段**: `lga_code` (维州 3 位数字), `lga_name`, `lga_official_name`, `gazettal_registration` (法定公报号), `abs_lga_code` (ABS 5 位代码) |

---

## 3. Homes Victoria 租金数据结构与缺失项深度剖析

### 3.1 工作簿内部结构全景
通过解析 `quarterly-median-rents-local-government-area-september-quarter-2025-excel.xlsx` 全部 7 张 Sheet：
1. **表头区域**：
   - Row 0: `Quarterly median rents by Local Government Area`
   - Row 1: 房型名称（如 `1 bedroom flats`）及各季度标识（`Jun 1999`, `Sep 1999`, ..., `Sep 2025`）
   - Row 2: 度量指标标识，成对出现：`Count` 与 `Median`
2. **数据区域**：
   - Row 3 起开始记录，共分为 8 个宏观地理组（`region_group`）：
     - `Barwon South West` (9 LGAs)
     - `Grampians` (11 LGAs)
     - `Loddon Mallee` (10 LGAs)
     - `Hume` (12 LGAs)
     - `Gippsland` (6 LGAs)
     - `North and West Metro` (14 LGAs)
     - `Eastern Metro` (7 LGAs)
     - `Southern Metro` (10 LGAs)
     - **总计：8 个区域组，刚好合计 79 个市议会**。
   - 数据末尾行均为汇总统计：`Group Total` 与 `Table Total`，随后为各宏观分区的合计行（`Metro`, `Non-Metro`, `Victoria`）。
3. **缺失项核验结果**：
   - **无任何代码列**：整张表中只有第 0 列（大区名）和第 1 列（LGA 文本名），没有任何数字编号列。
   - **无地理底图版本说明**：没有单元格提及 “ASGS”、“Edition”、“Vintage”、“Boundary”、“Local Government Act 1989/2020” 或 “Vicmap”。
   - **无坐标与几何**：纯属性统计报表，源数据无任何空间面、线、点坐标。

### 3.2 1,106 条租金记录的构成与现状
在 Melens 的当前开发库及已入库批次中：
- 选取最近两个完整季度：2025 年 6 月季度（`2025-Q2`，`period_start: 2025-04-01`）与 2025 年 9 月季度（`2025-Q3`，`period_start: 2025-07-01`）。
- 每个季度包含 79 个 LGA × 7 种房型 = 553 条事实。
- 两个季度合计 **1,106 条事实记录**（已全部以 `assertion_kind = 'observation'` 存入，且严禁视作当前在架招租房源）。
- 在 BigQuery 与数据契约中，全部 1,106 条记录的 `boundary_mapping_status` 目前严格保持为 `missing`，`boundary_id` 保持为形如 `VIC_LGA_NAME:melbourne:unresolved`，多边形几何 `geometry` 严格保持为 `null`。

---

## 4. 匹配与无法匹配样本分析：为何不得靠名称相似贴面？

通过对 Homes Victoria 的 79 个 LGA 名称与 ABS ASGS 2021、ABS ASGS 2025 以及 Vicmap Admin 进行逐行精确比对，清晰呈现出以下 5 类不可直接贴面的典型风险与样本：

### 样本比对总表（重点差异样本剖析）

| Homes Victoria 文本 (`lga_name`) | 大区分组 (`region_group`) | ABS ASGS 2021 精确匹配 | ABS ASGS 2025 精确匹配 | Vicmap Admin 权威映射 (`lga_code` / `abs_lga_code`) | 差异根因与无法直接贴面风险剖析 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Melbourne** | North and West Metro | `24600` (Melbourne) | `24600` (Melbourne) | Code: `343`<br>ABS: `24600`<br>公报: `S063 1994 p7` | **基准正样本**：名称完全一致，代码稳定无歧义。 |
| **Yarra** | North and West Metro | `27350` (Yarra) | `27350` (Yarra) | Code: `373`<br>ABS: `27350`<br>公报: `S043 1994 p4` | **基准正样本**：名称完全一致。 |
| **Merri-bek** | North and West Metro | **无匹配** (FAILED) | `24700` (Merri-bek) | Code: `351`<br>ABS: `25250` (历史映射)<br>公报: `G037 2022 p3871` | **【重大跨期风险】行政更名与编码割裂**：<br>1. 维州政府于 2022 年 9 月公报（G37 2022）将 Moreland 更名为 Merri-bek；<br>2. ABS 在 2021 版中仅有 Moreland (`25250`)，无 Merri-bek；直到 2025 版才分配新代码 `24700`；<br>3. Homes Victoria 的 Excel 回溯表中，连 1999 年的数据行都打着 “Merri-bek”；<br>4. 更有甚者，Vicmap Admin 的属性表中，LGA 名称虽已更新为 MERRI-BEK，但其关联的 `abs_lga_code` 依然指着旧代码 `25250`！<br>若盲目按名称或按旧代码贴面，必然导致跨库数据断裂或将历史 2000 年租金投射到尚未存在的 2025 实体上。 |
| **Mornington Penin'a** | Southern Metro | **无匹配** (FAILED) | **无匹配** (FAILED) | Code: `352`<br>ABS: `25340`<br>公报: `S117 1994 p7` | **【数据清洗缩写风险】非标准缩写**：<br>Homes Victoria 官方表中使用了带有单引号的紧凑缩写 `Mornington Penin'a`，而 ABS ASGS 2021/2025 及标准名称均为 `Mornington Peninsula`。名称严格匹配直接失败；若用未约束的模糊匹配，极易引入不可控规则。 |
| **Colac-Otway** | Barwon South West | **无匹配** (FAILED) | **无匹配** (FAILED) | Code: `314`<br>ABS: `21750`<br>公报: `S063 1994 p10` | **【连字符歧义】格式不统一**：<br>Homes Victoria 官方表中带连字符 `Colac-Otway`，ABS ASGS 官方名称为无连字符的 `Colac Otway`。严格名称比对直接失配。 |
| **Bayside** | Southern Metro | **无匹配** (FAILED) | **无匹配** (FAILED) | Code: `306`<br>ABS: `20910`<br>公报: `S117 1994 p3` | **【跨州同名致命陷阱】缺少州属消歧**：<br>ABS ASGS 标准中，为了防止与新南威尔士州的 Bayside Council (`10500`) 混淆，维州的 Bayside 官方名称为 `Bayside (Vic.)`。Homes Victoria 表中仅写作 `Bayside`。若脱离州属范围盲目跨库模糊比对，会直接错误绑定至悉尼的 Bayside 区域。 |
| **Kingston** | Southern Metro | **无匹配** (FAILED) | **无匹配** (FAILED) | Code: `335`<br>ABS: `23430`<br>公报: `S117 1994 p5` | **【跨州同名致命陷阱】**：<br>维州 Kingston 在 ABS 中被标为 `Kingston (Vic.)` (`23430`)，因南澳有 Kingston District Council (`43420`)。Homes Victoria 表中未带 `(Vic.)`，名称比对失败。 |
| **Latrobe** | Gippsland | **无匹配** (FAILED) | **无匹配** (FAILED) | Code: `337`<br>ABS: `23810`<br>公报: `S087 1994 p33` | **【跨州同名致命陷阱】**：<br>维州 Latrobe 在 ABS 中为 `Latrobe (Vic.)` (`23810`)，因塔斯马尼亚有 Latrobe Council (`63810`)。Homes Victoria 表中未带 `(Vic.)`，名称比对失败。 |
| **French Island** (非工作簿实体) | *(Unincorporated)* | `29399` (Unincorp Vic) | `29399` (Unincorp Vic) | Code: `379` (French-Elizabeth Islands)<br>ABS: `29399` | **【非议会区域边界边界陷阱】**：<br>ABS ASGS 在维州总共有 82 条要素（含 3 个非自治大区代码 `29399`、`29499`、`29799`）；Vicmap Admin 包含 87 条要素（含 8 个高山度假村与外岛）；而 Homes Victoria 租金表仅有 79 个市议会，根本不存在法人的 French Island 租金行（租金测试 fixture 中的 French Island 系边界用例手工合成）。这证明租金统计总体与 ASGS 空间实体并非 1:1 结构。 |

---

## 5. 跨表映射核查事实与跨版本阻断机制

### 5.1 官方 Crosswalk 映射事实
1. **维多利亚州法定行政区划定义**：
   - 维州交通与规划厅（DTP）发布的 `Vicmap Admin` 图层 `LGA_POLYGON`（Layer 9）是维州唯一的法定 LGA 边界底图，其几何依据源于维州《地方政府法》（Local Government Act 1989/2020）及官方宪报登载（Gazette Registration）。
   - Vicmap Admin 明确维护了维州 3 位数字 `lga_code`（例如 Melbourne 为 `343`，Merri-bek 为 `351`，Colac Otway 为 `314`）。
2. **跨版本断层（Cross-vintage Discontinuity）**：
   - 现场审查证明，即便是维州官方测绘底库 `Vicmap Admin`，其内嵌的 `abs_lga_code` 仍滞后于联邦统计局（ABS）的最新版本：
     - 在 Vicmap Admin 中，`MERRI-BEK` 对应的 `abs_lga_code` 记录为 `25250`（这是 ASGS 2021 年版 Moreland 的旧代码）；
     - 但在 ABS 官方最新 `ASGS 2025` 空间服务中，`25250` 已经废弃注销，Merri-bek 被正式赋予全新代码 `24700`；
     - 如果工程师自作主张编写跨表 Join，将 Vicmap 的 `abs_lga_code` 级联到 ASGS 2025，就会发生级联丢失或错误挂接到已失效的历史编码上。

### 5.2 T058 跨年份空间映射不变式判定
根据项目架构规范与不变式 T058（`specs/001-melbourne-data-aggregation/contracts/normalization.md` 及 `cloud/data/src/normalization/area-indicators.ts`）：
- **规则 1：严禁无显式版本映射的跨年份比较与合并**。
  > *“Cross-year / cross-vintage comparisons require explicit boundary vintage mapping; unresolved boundaries must not be silently joined across vintages.”*
- **规则 2：严禁因名称相似而凭空发明空间面（No Guessing / No Fabricated Centroids）**。
  > *“Unresolved boundaries marked as unresolved without fabricated centroids or guessing.”*
- **规则 3：保持空间指标状态为 `missing`**。
  > *“The BigQuery view can expose the historical numeric series with `boundary_mapping_status = missing`, but it must not render those rows as a resolved LGA polygon or compare them as if an ASGS vintage match were proven.”*

---

## 6. 最终交接结论与架构建议

### 6.1 对 GM-21 当前发布的交付状态确认
1. **当前状态完全合规**：
   - 现行 BigQuery 视图 `melens_query.v_area_indicators` 与 `v_source_records` 中，Homes Victoria 的 1,106 条租金数据全部以 `boundary_mapping_status = 'missing'`、`geometry = null` 保存，严格遵循了 T055 与 T058 的质量底线。
   - 这 1,106 条记录作为历史季度的宏观统计事实，在业务上完全能够为图表、指标卡提供纯数值支撑，而不会在地理地图图层上产生变形多边形或错误的跨州点位。
2. **对名称直连行为实施永久阻断**：
   - 本调研用真实数据和官方接口审计证明：不得编写“按字符串包含或正则清洗后直接连 ASGS LGA 面”的隐式逻辑。

### 6.2 后续演进建议（Phase 2/3 官方 Crosswalk 资产引入路径）
若未来业务要求必须在地图上高亮渲染 Homes Victoria 租金多边形，必须满足以下前置条件方可解除阻断：
1. **建立由版本锚定的显式 Crosswalk 静态资源**：
   - 在系统中创建受控的映射资产，显式声明四元组：\
     `(hv_lga_name, target_scheme, target_vintage, target_boundary_id)`。
   - 例如：
     - `('Melbourne', 'ASGS_LGA', '2025', 'ASGS_LGA:24600:2025')`
     - `('Merri-bek', 'ASGS_LGA', '2025', 'ASGS_LGA:24700:2025')`
     - `('Mornington Penin\'a', 'ASGS_LGA', '2025', 'ASGS_LGA:25340:2025')`
     - `('Bayside', 'ASGS_LGA', '2025', 'ASGS_LGA:20910:2025')`
     - `('Kingston', 'ASGS_LGA', '2025', 'ASGS_LGA:23430:2025')`
     - `('Latrobe', 'ASGS_LGA', '2025', 'ASGS_LGA:23810:2025')`
     - `('Colac-Otway', 'ASGS_LGA', '2025', 'ASGS_LGA:21750:2025')`
2. **显式区分时间切片（Time-slicing）**：
   - 明确限制该 Crosswalk 仅适用于 **2022 年公报更名后的现代时序（如 2022-Q4 之后）**；
   - 对于 1999 年至 2022 年的历史数据，需建立历史版本映射（如映射至当时的 Moreland `25250` 与历史公报边界），严禁使用同一张 2025 年几何底图回溯渲染 2000 年的数据。
3. **准入门禁升级**：
   - 只有在上述 Crosswalk 资产具备单元测试覆盖、完整性核验通过并作为显式参数传入 `normalizeHomesVictoriaStatistics(input, evidence)` 时，才允许将 `boundary_mapping_status` 升级为 `mapped` 并挂接几何面。
