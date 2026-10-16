# 租金与 CSA 的 LGA 映射核查

2026-10-15 核查结果：D05 仍未通过。当前代码不能把这些真实来源的指标绑定到 ABS 2021 面。数值可以保留。地图着色必须等待源地域证据。

## 已核实的目标表

本次只读请求取得 [ABS 2021 官方 LGA 图层](https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/LGA/MapServer/0)。请求只取 Victoria 的 `lga_code_2021` 与 `lga_name_2021`，不取几何。响应有 82 个唯一代码。完整名称和代码保存在 [目标表快照](abs-lga-2021-target-index-2026-10-15.json)。文件记录请求 URL、抓取时间和原响应 SHA-256。

这是目标名称代码表。它不证明 Homes Victoria 或 CSA 使用了该版地域。不要把此文件作为已经批准的源到目标 crosswalk。不要自动把 Merri-bek 改成 Moreland。不要用删除标点、模糊匹配或统计年份来推断地域版次。

[ABS 的 LGA 说明](https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/non-abs-structures/local-government-areas)指出，ABS LGA 是以 Mesh Block 近似法定边界的统计区域。因此，同名法定地区本身也不能证明两套边界相同。

## 仍缺少的源证据

[DFFH 当前租金发布页](https://www.dffh.vic.gov.au/publications/rental-report)列出 September 2025 的 LGA 季度表和完整报告。该页面没有声明与 ABS 2021 面的对应关系。Word 报告下载本次返回 HTTP 403，未取得其地理说明。已有 [租金准入记录](../source-policies/homes-victoria-rents-admission.md)说明，已采集的表只有名称，没有代码或已核实版次。

已有 [CSA 工作簿核查](../handoff-evidence/GM-02.md)说明，Table 01 只有 LGA 名称。表中的历史行也使用 Merri-bek 名称。它还有非议会统计项。本次 CSA 地理说明网页未能访问，不能据此补出源版次。

后续 crosswalk 必须记录官方证据 URL、发布版本、适用源文件或记录范围，以及源地域到目标 scheme/code/vintage 的对应行。每个目标都必须存在于官方目标表与已发布面。特殊统计项保持未解析。未取得这些证据前，默认采集继续输出 `:unresolved`，源代码与源版次继续为 null。

## 本次代码修复

显式 crosswalk 现在必须指向所提供边界证据中的唯一目标。代码拒绝不存在、重复、地域级别错误、代码错误和版次错误的目标。它也拒绝 `ASGS_LGA:2021:25250` 这类倒置 ID。名称直连现在只接受完整名称相等。名称别名必须有显式 crosswalk。源记录给出代码时，代码优先于名称；名称不能覆盖冲突代码。

这些检查修复了不安全的本地映射入口。它们没有补出缺失的官方源 crosswalk，也没有改写已发布数据。未执行采集、云端发布或 IAM 修改。

## 本地验证

在同步到主线 `3ce8804` 后，重新核查了这些实现和测试。主线的对应文件与旧工作基线相同，因此这些修复仍然适用。只迁移已审查的差异，没有恢复旧文件全集。

本次使用 Node 24.19.0 和独立输出目录编译。编译通过。租金连接器、CSA 连接器、区域指标和 crosswalk 共 48 个测试通过，零失败、零跳过。这些结果没有证明真实源的地域映射或云端发布成功。
