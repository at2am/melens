# GM-20 (T042) 本地活动数据源无 Key / 合法授权候选调研报告

- **任务编号**：GM-20 (关联任务：T042)
- **调研范围**：Greater Melbourne 及维多利亚州本地活动数据源
- **调研日期**：2026-09-30（2026-10-01 依据 Review R08 规范深化修订）
- **调研原则**：
  1. 官方接口只做**有界、只读**核查，记录实际 URL、时间、HTTP 状态、条数、字段与许可页面。
  2. 严格遵循**“不因为网页或接口可访问就推定可自动采集或再利用”**（Accessibility does not imply crawlability, storability or reusability）。
  3. **严格区分 HTTP 传输缓存、存储保留期与产品刷新要求**，不将短时 HTTP 响应头混同于法律保留许可或业务调度周期。
  4. 不创建／读取 GCP Secret Manager 真实凭据；不修改共享代码与现有 `source-policies/events-alternative.md`。

---

## 1. 调研背景与现存阻断

在系统任务 T042 中，已有针对 Ticketmaster Discovery API v2 的候选连接器（`cloud/data/src/connectors/ticketmaster/`），但其当前准入存在双重阻断：
1. **凭据已配置，来源准入待完成**：项目已在 GCP Secret Manager 配置 `ticketmaster_discovery_api_key`。本文没有读取密钥、调用有 Key 接口或验证真实活动覆盖；凭据不得提交至代码库。
2. **条款与数据留存阻断**：Ticketmaster 使用条款（Terms of Use §4）要求活动内容（Event Content）仅可在合理期限内缓存，权利人请求时须在 24 小时内删除，且禁止复制 Ticketmaster 核心体验。而 Melens 系统的 BigQuery 历史视图（History View）目前缺乏来源级的生命周期管理与撤除（takedown/retention）机制，故仍标为 `review_required` / `candidate`，活动数据未准入，SC-001 活动类覆盖门槛未验收。

本调研针对上述瓶颈，深入核查至少 3 个无 Key 或可合法授权的本地活动数据源，横向对比其接口形态、缓存与留存期限、取消／改期字段、地理坐标及许可条款，为后续活动类数据接入与准入复核提供完整事实证据。

---

## 2. 候选数据源综合比对矩阵

本次调研共核查了 5 个不同类型的候选源与平台（包含当前基线、无 Key 接口、开发者授权接口、官方分发者接口及市政公开数据）：

| 候选来源 | 接口类型 / 协议 | 鉴权要求 | 空间覆盖范围 | 坐标质量 (WGS84) | 取消／改期判定字段 | 缓存、留存与撤除条件 | 许可与法律条款 | 准入推荐结论 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Ticketmaster Discovery API v2** *(基线)* | REST JSON | API Key (经 Secret Manager) | Greater Melbourne (以 CBD 为中心 80km 圆) | 场馆经纬度点坐标 (`_embedded.venues[0].location`) | `dates.status.code` (`canceled`, `postponed`, `rescheduled`) | 仅限合理期限缓存；24 小时内响应权利人撤除；BigQuery 永久留存受限 | Ticketmaster API Terms of Use (专有商业条款) | **Candidate** (Key 已配置，待保留与撤除机制及来源准入) |
| **University of Melbourne Events (LiveWhale)** | REST JSON / RSS XML / iCal | 无 Key (接口未设密码验证) | City of Melbourne / Carlton / Parkville / Southbank | 99.3% 记录含精确点坐标 (`location_latitude`, `location_longitude`) | `is_canceled` (布尔值)；`last_modified` (秒级 Unix 时间戳) | HTTP 标头动态变动 (实测 max-age 介于 131s 至 86400s)；**HTTP 缓存不等同于数据保留许可**；存储保留与撤除待定 | [University Website Terms](https://www.unimelb.edu.au/legal/website-terms) 限制未经许可的自动提取；**未取得自动采集、再利用与分发授权** | **Candidate (技术可行，但再利用授权待核实，review_required)** |
| **Eventfinda Developer API v2** | REST JSON / XML | HTTP Basic Auth (需注册申请开发者 Key) | 澳大利亚全国 / Greater Melbourne (支持经纬度+半径或地区过滤) | 场馆经纬度点坐标 (`location.lat`, `location.lng`) | `is_cancelled` (布尔值)；`sessions` 时间段数组 | 严禁向第三方转售或二次分发（Redistribution）；展示须附带强品牌归属 | Eventfinda Developer API Terms of Service | **Blocked** (条款明确禁止向第三方二次分发原始或衍生数据，不符合公开平台准入) |
| **Australian Tourism Data Warehouse (ATDW) / Visit Victoria** | REST JSON / XML (ATLAS API) | Distributor API Key (官方分发者授权) | 维多利亚全州 (含 Greater Melbourne 及各 LGA) | 官方核准的高精度场馆坐标与地址 | `status` 生命周期字段；营运时间与日程规则 | 遵循 Distributor Agreement，刷新及撤除时限待 Distributor Agreement 确认；禁止未授权转卖 | 维州旅游局 / ATDW 官方商业分发协议 (非 CC 开放协议) | **Review Required** (维州官方活动覆盖最全，但需申请正规 Distributor 资质，非轻量接入) |
| **City of Melbourne Open Data & What's On** | ODS API v2.1 / Web 页面 | 开放数据无 Key / What's On 无公开 API | City of Melbourne 市辖区 | 历史活动多为面/点；What's On 页面有文本地址 | Open Data 无实时字段；What's On 页面标注状态 | ODS 数据更新停滞；What's On 禁止机器抓取与商业重用 | ODS 为 CC BY 4.0；What's On 为市府全版权保留 (All Rights Reserved) | **Blocked / Unavailable** (开放数据活动集 404；What's On 条款严禁商业重用与抓取) |

---

## 3. 各候选源官方有界核查事实与深度剖析

### 3.1 候选源 1：Ticketmaster Discovery API v2 (当前系统基线)

- **官方文档 URL**：`https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/`
- **条款页面 URL**：`https://developer.ticketmaster.com/support/terms-of-use/`
- **核查时间**：2026-09-30T12:54:31Z
- **只读探测结果**：
  - 文档页 HTTP 状态：`200 OK`
  - 生产接口 URL：`https://app.ticketmaster.com/discovery/v2/events.json`
  - 接口在无 Key 访问时直接返回 `401 Unauthorized` (`{"fault":{"faultstring":"Invalid ApiKey","detail":{"errorcode":"oauth.v2.InvalidApiKey"}}}`)
  - 官方调用配额：默认每日 5,000 次请求，每秒不超过 5 次请求（Rate limit: 5 req/s）。
  - 分页限制：基于 0 起始的深度分页最多支持 1,000 条结果（`page * size < 1000`）。
- **字段完备性**：
  - 原生主键：`event.id`
  - 活动标题与链接：`name`, `url`
  - 取消与改期：`dates.status.code`（包含 `onsale`, `offsale`, `canceled`, `postponed`, `rescheduled`）；`dates.start.dateTBA`, `dates.start.dateTBD`。
  - 时间字段：`dates.start.dateTime`, `dates.end.dateTime`, `dates.timezone`。
  - 空间坐标：`_embedded.venues[0].location.longitude` 与 `latitude`，对应 `location_confidence = source_coordinate`，`location_role = event_site`。
- **缓存、留存与撤除条件**：
  - 条款第 4 条明确规定：“You may only cache Event Content for a reasonable period... You must immediately remove and delete any Event Content upon request from Ticketmaster or a rights holder within 24 hours”。
  - 现有连接器已实现分页拉取与时间窗截断，但 BigQuery 永久只增不减存储（Append-Only History）违背了 24 小时删除义务。

---

### 3.2 候选源 2：University of Melbourne Events (LiveWhale 引擎) —— 技术可行但授权待定

- **官方服务入口**：`https://events.unimelb.edu.au/`
- **接口 URL**：
  - JSON API: `https://events.unimelb.edu.au/live/json/events`
  - RSS XML: `https://events.unimelb.edu.au/live/rss/events`
  - iCal: `https://events.unimelb.edu.au/live/ical/events`
- **条款入口**：`https://www.unimelb.edu.au/disclaimer` 重定向至 `/legal`；[Website Terms](https://www.unimelb.edu.au/legal/website-terms) 是本次集成复核取得的具体条款页面。
- **核查时间**：2026-09-30T13:01:36Z 至 2026-10-01T00:04:56Z
- **只读探测结果**：
  - HTTP 响应状态：`200 OK`
  - 响应标头实测分析：
    - `content-type: application/json; charset=UTF-8`
    - `access-control-allow-origin: *` (技术标头层面开放 CORS，允许浏览器跨域拉取)
    - `cache-control`: 经多轮探测复核，上游反向代理采用动态智能缓存（Smart Cache），其返回的 `max-age` 具有显著动态波动性：既有静态快照返回 `max-age=86400`，亦有动态响应返回 `max-age=300`，或处于中间衰减阶段（复核探测中实测观察到 `max-age=131`，伴随 `x-smart-cache-ttl: 46624` 等内部代理计数）。这表明该标头纯属反向代理服务器的网络传输优化，绝非固定不变的契约保证。
    - `etag: "56855f6aa7b11e20e1d5c23da78a55bd"` / `last-modified`
  - 单次拉取有效记录数：**1,000 条**（涵盖墨尔本大学各学院公开讲座、艺术展览、研讨会、演出）。
- **字段分析**：
  - 原生唯一主键：`id` (数字整型，如 `51781`)
  - 标题与描述：`title`, `description`
  - 原生活动链接：`url` (形如 `https://events.unimelb.edu.au/MDHS/event/51781-...`)
  - 时间与时区：`date_iso`, `date_utc`, `date2_iso` (结束时间), `date2_utc`, `timezone: "Australia/Canberra"`
  - **取消判定字段**：具备原生且明确的 `is_canceled` 字段（布尔/整型标记），非取消活动为 `null` 或 `0`，取消活动为 `1`。
  - **改期与版本控制**：具备 `last_modified` (Unix 时间戳，如 `1787104500`)，可用作 `source_version_id` 计算输入；结合 HTTP 的 `ETag` 与 `Last-Modified` 支持精确的增量刷新与改期识别。
  - **空间坐标质量**：
    - 在拉取的 1,000 条记录中，**993 条包含有效的 `location_latitude` 和 `location_longitude`**（覆盖率高达 99.3%）。
    - 典型点位：`-37.800297, 144.964748` (Science Gallery Melbourne, Carlton)、`-37.8242, 144.9681` (Buxton Contemporary / Southbank 艺术校区)。
    - 物理位置均位于 City of Melbourne 市界及 Greater Melbourne 内，完全契合 `location_confidence = source_coordinate` 与 `location_role = event_site`。
- **再利用许可、法律分析与撤除条件（核心合规界定）**：
  - **不可将公开访问或 HTTP 头误作授权依据**：
    - 接口能无需 Key 访问、返回了 `access-control-allow-origin: *` 以及上游设置了 `Cache-Control`，**均属于网络协议层的传输与跨域展示支持，绝不构成允许第三方进行批量自动化采集、永久落库存储以及产品化商业展示的法律授权依据**。
  - **官方许可页面审查事实**：
    - 官方 `/disclaimer` 入口当前跳转至 [Online terms and privacy](https://www.unimelb.edu.au/legal)。
    - [Website Terms](https://www.unimelb.edu.au/legal/website-terms) 规定内容的非商业使用范围，并明确未经许可不得以自动方式提取网页信息。公开 JSON 接口不是许可例外证明；是否存在适用于该 feed 的专项授权仍需确认。
    - **本次调研结论：未能取得墨尔本大学关于数据自动采集、仓库长期存储及产品化展示的明确法律授权证据**。
  - **所需授权范围（Required Authorization Scope）**：
    若后续拟推进正式准入，项目团队必须向校方取得书面确认或授权，涵盖以下范围：
    1. 允许自动化爬虫/脚本以稳定频率定时拉取日历数据；
    2. 允许将活动数据清洗并存入系统的云端数据仓库（GCS / BigQuery）；
    3. 允许在 Melens 产品的地图和检索视图中向公众呈现活动摘要、时间与地点坐标，并注明来源回链。
  - **撤除条件（Takedown Terms）**：
    系统必须建立上游撤除响应机制：
    1. 当上游通过接口标记 `is_canceled = 1` 时，系统必须在下一个刷新周期内将对应记录置为 `record_status = cancelled`，并从当前生效活动视图中撤除；
    2. 权利人撤除通知应按最终授权约定执行，并覆盖当前视图、历史表和留存快照。尚未取得授权，也未找到校方规定的 24–48 小时撤除时限；该数值不能作为已确认合同义务。

---

### 3.3 候选源 3：Eventfinda Developer API v2 —— 开发者授权候选源（转分发阻断）

- **开发者门户 URL**：`https://www.eventfinda.com.au/api/v2`
- **API 详细文档 URL**：`https://www.eventfinda.com.au/api/v2/events`
- **使用条款 URL**：`https://www.eventfinda.com.au/api/terms`
- **核查时间**：2026-09-30T12:58:38Z
- **只读探测结果**：
  - 开发者页面与条款页 HTTP 状态：`200 OK`
  - 接口规范：REST API，支持 JSON (`/v2/events.json`) 与 XML。
  - 鉴权方式：HTTP Basic Authentication，用户名与密码由申请获得的 API Key 组成。对开发者免费提供，但必须申请分配凭据。
  - 查询过滤：支持 `point` (经纬度 + 半径，如 `point=-37.8136,144.9631&radius=50`) 或 `location_id`（墨尔本市区对应特定的 location id）。
- **字段分析**：
  - 原生主键：`id`
  - 标题、描述与链接：`name`, `description`, `url`
  - 时间与场次：`datetime_start`, `datetime_end`, `sessions` (数组，包含各分场时间)
  - **取消与改期判定**：具有显式字段 `is_cancelled` (布尔型)；场次更新通过 `sessions` 调整；支持根据修改时间增量抓取。
  - **空间坐标质量**：活动对象内嵌 `location` 资源，包含 `point.lat` 与 `point.lng`，提供真实精确的场地物理坐标及详细街道门牌。
- **缓存与再利用条款审查（阻断点）**：
  - **严禁数据转售与二次分发**：Terms of Service 明确规定：“You may not resell or redistribute to any third party the Content originating from the Eventfinda Developer API”（禁止向任何第三方二次分发源于该 API 的内容）。
  - **强制品牌标识与回链**：必须在展示页面放置“Powered by Eventfinda”链接，且每个活动详情必须回链至 Eventfinda。
  - **结论**：虽然技术特性极佳，但其二次分发条款直接阻断了将数据导入 Melens 统一 BigQuery 公共视图并对外提供统一查询的能力。若接入，必须签署专门的商业合作或转授权协议，标准开发者 Key 无法满足项目准入。

---

### 3.4 候选源 4：Australian Tourism Data Warehouse (ATDW) / Visit Victoria —— 官方分发者授权源

- **官方门户**：`https://atdw.com.au/distributors/`
- **开发者文档 Hub**：`https://support.atdw.com.au/`
- **生产服务网关**：`https://atlas.atdw-online.com.au/api/atlas/products`
- **核查时间**：2026-09-30T13:03:45Z
- **只读探测结果**：
  - 根服务 HTTP 状态：`200 OK`，返回网关运行指标：`{"started":"2026-09-30T11:10:13.871Z","uptime":6819.653}`
  - 鉴权方式：分发者 API Key (`key=YOUR_API_KEY`)，支持 JSON / XML。
  - 来源背景：ATDW 是澳大利亚联邦与各州旅游局（包括 Visit Victoria 维州旅游局）联合拥有的国家级旅游与活动数据库，所有进入 `visitmelbourne.com` 和 `australia.com` 的活动均来自于此，经过官方人工质量核审。
- **字段与质量分析**：
  - 涵盖维州全境各类节庆、体育赛事、社区活动与展览，具有最高级别的官方权威性与覆盖完整度。
  - 空间坐标：所有场馆均具备官方经纬度坐标与详细标准地址。
  - 生命周期与改期：具有统一的 `status` 状态机，活动主办方直接在后台维护改期与取消状态。
- **缓存与合规性评估**：
  - ATDW 要求 Distributor 定期同步以确保活动改期/取消能即时反映给公众（具体刷新和撤除时限须在 Distributor Agreement 中确认；本文未取得适用的协议条款）。
  - 准入阻断：必须以正式机构身份申请成为 ATDW Distributor 并签署分发协议，无法由开发人员直接以无 Key 或通用测试 Key 准入。

---

### 3.5 候选源 5：City of Melbourne Open Data & What's On —— 市政公开数据反模式与法律边界

针对墨尔本市官方自身平台，本次调研对开放数据（Open Data）与官方日历（What's On）开展了系统复查：

1. **City Activities and Planned Works 数据集（失效）**：
   - DataVic 目录记录：`https://discover.data.vic.gov.au/dataset/city-activities-and-planned-works` 标注其许可为 CC BY。
   - 官方实际接口：`https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/city-activities-and-planned-works`
   - 实测结果：**HTTP 404 (`NotFoundResource`)**。该数据集已从 City of Melbourne 现行 Opendatasoft 目录中下架或重构，无法获取。
2. **Venues for event bookings 数据集**：
   - 接口 URL：`https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/venues-for-event-bookings/records`
   - 实测结果：HTTP 200，共 206 条记录，许可为 CC BY 4.0。
   - 局限：此为静态的可租用场馆资产表，非具有明确未来时间段的活动日历，无法单独满足活动时效与覆盖门槛。
3. **What's On Melbourne (`whatson.melbourne.vic.gov.au`) —— 典型反模式分析**：
   - **核查页面**：`https://whatson.melbourne.vic.gov.au/disclaimer`
   - **条款审查事实**：
     > *"Copyright: This website is the property of the City of Melbourne. Copyright of content on this website is owned by, or licensed to, the Council. Apart from fair dealing for the purpose of the private study, research, criticism or review, as permitted under the Copyright Act 1968, no part may be reproduced or reused for any commercial purposes whatsoever."*
   - **反爬与机器友好度**：
     - 无任何公开机器 API 或 RSS Feed；
     - 主站前端采用 CloudFront + WAF 防护机制（直接探测常返回 WAF Challenge 或拦截）；
     - `sitemap.xml` 实际为 HTML 渲染页面而非标准 XML 索引。
   - **核心法律结论（严守“不因可浏览即推定可抓取”原则）**：
     What's On 虽在浏览器中公开可浏览，但市府版权条款限制商业复制和再利用；本次没有取得独立的自动采集许可。在未获得市府书面商业授权前，项目没有获得自动采集和产品再利用许可，应保持 **Blocked**，不可作为数据抓取替代源。

---

## 4. 关键维度横向深入剖析

### 4.1 API / RSS 接口与机器友好度

- **REST API (JSON)**：Ticketmaster、UniMelb LiveWhale 和 Eventfinda 均提供结构高度规范的 JSON 接口。其中 UniMelb LiveWhale 兼备标准 RSS 2.0 XML 与 iCalendar 订阅流，对下游批处理最为灵活。
- **机器准入壁垒**：UniMelb LiveWhale 是唯一完全免 Key、免签名且开放 CORS 的候选源；Ticketmaster 与 Eventfinda 存在 API Key 申请门槛；City of Melbourne What's On 则完全缺乏机器接口并具备 WAF 防护。

### 4.2 缓存、存储与刷新时限的严格区分（解耦三维时间概念）

在数据接入与管道设计中，必须严格区分以下三个完全不同维度的时限，切忌将网络传输标头与数据保留许可或业务调度混为一谈：

1. **HTTP 传输缓存期限 (HTTP Cache-Control TTL)**：
   - **定义**：上游反向代理服务器或客户端在网络传输层允许临时复用响应的秒数。
   - **实测表现**：UniMelb LiveWhale 上游反向代理标头动态多变，实测观察到 `max-age=86400`、`max-age=300` 以及随缓存寿命衰减的 `max-age=131`（伴随 `x-smart-cache-ttl`）。
   - **本质与边界**：该标头仅用于避免瞬间高并发下的带宽浪费，**绝不代表上游授予了相应时间的版权保留许可，更不能据此一次性推导为固定的离线存储期限**。
2. **存储保留期 (Storage Retention Period)**：
   - **定义**：数据在 Melens 系统的 GCS 暂存桶及 BigQuery 只增不减历史表中的法定留存时长。
   - **合规矛盾**：无论是 Ticketmaster（要求 24 小时删除）、Eventfinda（禁止二次分发），还是 UniMelb（未授权长期存档），均存在版权保留约束。若 BigQuery 缺乏数据生命周期与行级撤除（Takedown）机制，将未获明确保留授权的数据永久保存在仓储中，将构成法律与合规隐患。
3. **产品刷新要求 (Product Freshness / Check Interval)**：
   - **定义**：根据产品对活动时效的实际需求（如捕获近期取消、改期活动）由系统 Scheduler 设置的主动轮询周期（`check_interval_seconds`）。
   - **设计准则**：调度周期应依据业务对未来 30 天活动覆盖的新鲜度要求来权衡定义，结合 HTTP `If-Modified-Since` 或 `ETag` 条件请求降低开销，而不是根据某次探测到的 HTTP `max-age` 简单僵化绑定，更不能据此推定数据可以合规发布。

### 4.3 取消与改期（Cancellation & Rescheduling）事实判定

在系统质量规范中，活动改期或取消必须生成新版本，不得单纯抹除或用哈希伪造版本顺序：
- **Ticketmaster**：通过 `dates.status.code` 枚举（`canceled`, `postponed` 等）和 `dates.start.dateTime` 的更新触发新版本生成，状态映射为 `record_status = cancelled` 或 `planned`。
- **UniMelb LiveWhale**：具备原生布尔型 `is_canceled`，且具有官方维护的 `last_modified`（精确至秒的修改时间戳），能够以确定性的数学依据判定记录修改先后，满足版本单调递增要求。
- **Eventfinda**：具备 `is_cancelled` 布尔字段及 `sessions` 结构，支持状态标记。

### 4.4 空间地理坐标与场馆精度

- **坐标真实度**：规范严格禁止将多边形质心或模糊地名伪造成精确点坐标（禁止伪造 Precision Point）。
- **核查表现**：
  - Ticketmaster：场馆级经纬度，准确率高，属于 `location_confidence = source_coordinate`。
  - UniMelb LiveWhale：在 1,000 条样本中实测 993 条自带 WGS84 经纬度（精度达到小数点后 6 位），准确匹配 Carlton、Parkville、Southbank 各剧场、展览馆与报告厅物理位置。
  - Eventfinda：具备标准 venue geocoding 点。

---

## 5. 结论与工程接入建议

1. **对当前 T042 Ticketmaster 的处置结论**：
   - 保持当前代码契约不变，继续保留 `license_status = review_required` 与 `access_status = candidate`。
   - 阻断解除的前提：Key 已在 GCP Secret Manager 配置，仍须验证运行身份可用并在架构层确立 BigQuery 针对 Ticketmaster 的数据保留期（Retention Period）及 24 小时删除合规动作（Takedown Protocol）。

2. **对 University of Melbourne Events (LiveWhale) 的评估结论**：
   - **技术维度**：其接口格式规整（JSON/RSS）、取消字段原生完备（`is_canceled`）、99.3% 自带 WGS84 点坐标，在技术层面上是极佳的活动连接器原型。
   - **合规维度（准入阻断）**：其 Website Terms 限制未经许可的自动提取，未取得适用 feed 的专项授权；技术上的免 Key、CORS 开放与临时 Cache-Control 均不能推定为批量采集或对外发布的授权。**本次调研未能取得明确的再利用法律授权，故不能直接推定可以发布**。
   - **推荐状态**：标记为 `license_status = review_required`，`access_status = candidate`。若后续拟将其作为正式来源，需由集成方联系校方获取再利用授权并建立明确的撤除流程，不可擅自启用云端调度任务。

3. **对 What's On Melbourne 的反模式定性**：
   - 再次重申“不因为网页可浏览就推定可抓取”原则。其版权条款限制商业再利用，项目尚未取得采集授权，且部署了反爬防护，坚决列为 **Blocked**，不得通过逆向或抓取方式接入。

4. **建议后续候选连接器规范（供集成团队参考）**：
   若后续校方授权落地，建议开发 `src/connectors/unimelb_events/` 时采用如下严格解耦的契约配置：
   - 采集端点：`https://events.unimelb.edu.au/live/json/events`
   - 检查周期（业务设定）：`check_interval_seconds = 43200` 或 `86400`（按业务刷新需求确定，不绑定某次探测的 Cache-Control）
   - 条件请求：必须携带 `If-Modified-Since` 与 `If-None-Match`
   - 状态映射：`is_canceled == 1` $\rightarrow$ `record_status = cancelled`；`location_latitude / longitude` $\rightarrow$ GeoJSON Point；`assertion_kind = plan`
   - 撤除履约：在接到下架通知或上游删除记录时，执行本地与仓储端的标记撤除逻辑。

## 6. 集成复核补充，2026-10-01

UniMelb 的 [Website Terms](https://www.unimelb.edu.au/legal/website-terms) 是自动提取限制的直接依据。保持技术候选且不启用抓取，直到取得覆盖采集、存储、公开展示和撤除的授权。HTTP 缓存头只影响传输复用，不决定仓库保留期限或合同撤除时限。本文旧探测中的 1,000 条和坐标比例没有在本轮重新拉取复核，不能作为实时活动覆盖验收；已配置 Ticketmaster Key 也不等于 T042 准入已通过。
