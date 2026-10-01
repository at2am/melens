# GM-19: Melbourne 本地犯罪新闻候选来源合规调研报告 (T050 / T051)

- **调研任务**: GM-19 (关联 tasks.md: T050 / T051)
- **调研日期**: 2026-09-30 (修订于 2026-10-01)
- **工作区分支**: `subagent-GM-19-Evidence-Researcher-self-fd66f4d5`
- **核查性质**: 官方／出版方页面只读有界核查（不接触 Secret Manager，不写任何代码或共享文件）
- **核心结论**: **未选定任何替代来源。T051 保持阻断 (`BLOCKED_PENDING_LICENSED_FEED`)，FR-002 与 SC-001 犯罪新闻覆盖指标保持未达标。**

---

## 1. 调研背景与准入门槛

### 1.1 背景与问题定义
根据 `specs/001-melbourne-data-aggregation/quality-rules.md` §2、`source-coverage.md` 与 `crime-news-coverage.md`：
- **类别要求（本地犯罪资讯）**: 最近 30 天内至少包含 5 个不同本地犯罪报道，来自至少 2 个发布日期；且具备可靠的维州／墨尔本地理证据与原文链接；另有 CSA 季度区域统计样本，二者分开呈现。
- **当前瓶颈**:
  1. GDELT GKG 15 分钟切片虽已接通，但 30 天维州本地犯罪事件候选数与日期跨度在当前验证窗口尚未确认（DOC 接口频繁限流／超时，T049 覆盖验收未通过）。
  2. 原候选 Victoria Police 网页公开报道受版权与非自动化条款限制，T044 处于条件性冻结状态。
  3. CSA（`victoria.csa.recorded_offences`）仅为季度发布的 LGA 聚合统计，不可替代具体犯罪新闻。
- **调研目标 (T050)**: 在官方及出版方页面系统核查至少 3 个 Melbourne 本地犯罪新闻候选来源的**机器访问、再利用授权、保存字段、更新频率和地理证据**。
- **准入准则**: 严格执行“**只推荐条款明确许可的来源；未选定时 T051 仍阻断**”以及“不得将未经授权的公开页面抓取假定为开放许可；不得用未经证实的第三方权利或粗粒度文本搜索假冒合规”。

---

## 2. 候选来源逐一核查证据

本调研深入核查了 7 个候选来源（涵盖官方执法机构、公营广播、主流媒体 API、商业聚合 API、通讯社及官方数据开放平台）。

---

### 候选一：Victoria Police Breaking News / 维多利亚州警方突发新闻与媒体通告

1. **官方入口与核查页面**:
   - 官方新闻主页: `https://www.police.vic.gov.au/news` (HTTP 200, Single Digital Presence / Nuxt SSR)
   - 突发新闻页面: `https://www.police.vic.gov.au/breaking-news` (HTTP 200)
   - 邮件订阅注册: `https://www.police.vic.gov.au/news-article-subscription` (HTTP 200, Webform `journalist_registration_form`)
   - 官方免责与版权声明: `https://www.police.vic.gov.au/disclaimer` (HTTP 200)
   - 爬虫协议: `https://www.police.vic.gov.au/robots.txt` (Crawl-delay: 2; 限制 `/oauth/*`, `/preview/*`, `/share-link`)
2. **机器访问可行性 (Machine Access)**:
   - **无官方公开 REST API 或公开 RSS 订阅**。
   - `news-article-subscription` 经代码审查其内部表单为 `journalist_registration_form`，明确标注仅面向认证媒体与专业记者（“for accredited media and journalists”），不能作为后端自动化采集的数据 Feed。
   - 网站部署有 QuantWAF 与 CSP 策略，未提供面向系统集成的自动化访问通道。
3. **再利用与许可条款 (Licensing & Reuse)**:
   - `https://www.police.vic.gov.au/disclaimer` 明确指出：
     - 网站内容受维多利亚州皇室版权（Crown Copyright）保护。
     - 警徽及官方标识受澳大利亚《1995年商标法》(Trade Marks Act 1995 (Cth)) 独占保护，未经书面授权严禁使用。
     - 免责条款声明：“The content of the Victoria Police website is provided for information purposes only... no assurance of any information or advice contained.”
     - **未声明任何 Creative Commons (如 CC BY 4.0) 或开放数据许可**，未授予第三方自动化抓取、入库持久化存储（BigQuery）或公共二次分发的权利。
4. **保存字段能力 (Schema)**:
   - 页面包含标题、发布时间、所属大区（如 ND1-Melbourne、SD1-Prahran）、正文通告、警方联系方式。
   - 但因无结构化 API，需依赖 HTML 解析，字段模式极易因前端改版失效。
5. **更新频率 (Cadence)**:
   - 随突发警情与案件调查进展实时发布（每日数条至十数条不等）。
6. **地理证据 (Geographic Evidence)**:
   - 优良。报道通常明确注明事发郊区（Suburb）、具体街道、事发商铺或警方辖区（Division/Region）。
7. **综合判定**:
   - **不予准入 (`review_required` / 维持冻结)**。无公开机器接口，皇室版权与条款未授权自动化抓取和二次分发。T044 保持冻结，严禁为该来源开发无授权爬虫连接器。

---

### 候选二：ABC News Melbourne / 澳大利亚广播公司墨尔本分部

1. **官方入口与核查页面**:
   - 墨尔本本地新闻入口: `https://www.abc.net.au/melbourne/news` (HTTP 200)
   - 商业内容分发入口: `https://www.abc.net.au/newssyndication` (HTTP 200)
   - 官方使用条款: `https://help.abc.net.au/hc/en-us/articles/360001548096-ABC-Terms-of-Use` (Cloudflare Bot Management 拦截，HTTP 403 Challenge)
   - RSS 政策公告: `https://help.abc.net.au/hc/en-us/articles/6147104938383-Why-are-RSS-feeds-no-longer-being-updated`
   - 爬虫协议: `https://www.abc.net.au/robots.txt`
2. **机器访问可行性 (Machine Access)**:
   - **公共 RSS 订阅已于官方公告中明确停止维护**（“Why are RSS feeds no longer being updated”）。
   - 帮助中心与条款域部署 Cloudflare 反机器人防护（自动化 curl 直接返回 HTTP 403）。
   - 官方唯一的商业与应用接入通道为 **ABC News Syndication**（`https://www.abc.net.au/newssyndication`），专为数字平台、聚合器和企业屏幕提供定制内容推送与 API。
3. **再利用与许可条款 (Licensing & Reuse)**:
   - ABC Terms of Use 规定内容仅供个人非商业用途使用（Personal, non-commercial use only）。
   - 明确禁止未经书面许可的抓取、自动化抽取、数据库转储或对外重发布。
   - ABC News Syndication 属于商用 B2B 授权模式，需要与 ABC 商业团队签订书面许可协议，明确约定元数据保留周期、撤稿/更正同步机制（Takedown/Correction SLA）、显示规范与计费方式。
4. **保存字段能力 (Schema)**:
   - 文章包含 OpenGraph / Article 元数据：`og:title`、`og:url`、`article:published_time`、`og:updated_time`、`og:description`、`name="keywords"`。
   - Syndication 商业 Feed 可按协议提供完整的结构化 JSON/XML 字段。
5. **更新频率 (Cadence)**:
   - 实时/高频更新（24/7 滚动发布）。
6. **地理证据 (Geographic Evidence)**:
   - 弱至中等。页面为“墨尔本受众关注的新闻”，经 2026-09-30 实测抽样，包含全澳政治、柬埔寨人权案、AFL 体育转会等非墨尔本地理事件；仅有部分涉及墨尔本地方法院判决或本地案件。
   - 元数据中无标准化事件坐标（Coordinates）或 LGA 代码，必须依赖 NLP 地名实体识别，存在同名或非事发地误判风险。
7. **综合判定**:
   - **未通过准入（谈判前不可接入）**。ABC 是目前最具可行性的高质量正规商业谈判渠道（Syndication），但在项目拥有者签订商业协议前，公网无开放许可，不可自发接入 T051。

---

### 候选三：The Guardian Australia Content API / 卫报开放平台

1. **官方入口与核查页面**:
   - 开发者主页: `https://open-platform.theguardian.com/`
   - 接入层级页面: `https://open-platform.theguardian.com/access/` (HTTP 200)
   - API 条款细则: `https://www.theguardian.com/open-platform/terms-and-conditions` (HTTP 200)
   - API 测试请求: `GET https://content.guardianapis.com/search?q=melbourne` (HTTP 401 Unauthorized)
2. **机器访问可行性 (Machine Access)**:
   - 具备高度现代化的 REST API 与认证体系（需申请 API Key）。
   - Developer 免费层级配额：1 QPS，500 次/天，支持文章元数据检索。
3. **再利用与许可条款 (Licensing & Reuse)**:
   - **存在致命的法律冲突条款**！在官方使用条款第 7 条 (g) 款中明确规定：
     > *"You will not: (i) use, copy, scrape, reproduce, alter, modify, collect, mine and/or extract the Content API, OP Content or Guardian Digital Network:*
     > *(A) for any machine learning, machine learning language models and/or artificial intelligence-related purposes (including the training or development of such technologies);*
     > *(B) for any text and data aggregation, analysis or mining purposes (including to generate any patterns, trends or correlations); or*
     > *(C) with any machine learning and/or artificial intelligence technologies to generate any data or content or to synthesise or combine with any other data or content."*
   - Melens 项目的核心即为“多源数据聚合与分析”（Data Aggregation & Urban Analytics），并配合智能体助理（LLM/AI Pair-programming & Chat Agent）。卫报条款**明文严禁将 API 内容用于任何数据聚合、趋势分析、文本挖掘或 AI 相关用途**。
   - 此外，Developer Key 仅限于学生论文、黑客松等非商业用途；任何商业企业或衍生服务必须签署 Commercial 协议。
4. **保存字段能力 (Schema)**:
   - 提供 `id`, `type`, `sectionId`, `sectionName`, `webPublicationDate`, `webTitle`, `webUrl`, `apiUrl`, `fields.bodyText`。
   - 但条款禁止在外部数据库长期持久化留存。
5. **更新频率 (Cadence)**:
   - 实时。
6. **地理证据 (Geographic Evidence)**:
   - 极差。卫报澳大利亚版主打国家政治、宏观经济、国际评论与重大深度调查，几乎不报道墨尔本本地日常街区盗窃、车祸或突发治安案件。
7. **综合判定**:
   - **按当前标准条款不适用 (`unsuitable_and_prohibited`)**。条款对数据聚合与 AI 的双重禁令与系统定位直接冲突，且本地治安报道严重不足。

---

### 候选四：商业新闻聚合 API 核查（GNews 与 NewsAPI）

本项独立深入核对 GNews 与 NewsAPI 的官方条款（区分用途限制、订阅计划、存储缓存与第三方权利），并对其地理元数据与空间质量进行系统核验。

#### 4.1 GNews API (`gnews.io`)

1. **官方入口与核查页面**:
   - 官方条款: `https://gnews.io/legal/terms-of-service` (HTTP 200, 2026 年最新架构)
   - API 文档: `https://gnews.io/docs/v4/` (HTTP 200)
   - 检索端点: `https://gnews.io/api/v4/search`
2. **机器访问机制 (Machine Access)**:
   - 标准 RESTful JSON API，通过 URL 查询参数或 Header 附带 API Key。
   - 免费配额通常为 100 请求/天。
3. **条款权责与限制深入分析**:
   - **商业使用与用途限制 (§3.1, §3.3)**: 条款规定在遵守订阅计划的前提下，允许为合法预期用途（包括商业用途）使用 API 检索数据。但明确要求使用者遵守版权法，尊重第三方知识产权，且不得虚假陈述数据来源为自己。
   - **第三方内容与著作权归属 (§5.2, §5.3, §6.2)**: 官方明确声明新闻文章、图片等全部内容归第三方原版权所有者所有，GNews 对第三方内容的真实性、合法性不予保证，亦**不向调用者转授第三方的著作权**；用户须自行对使用第三方内容承担版权法律责任。
   - **持久化建库与缓存限制 (§7 - Prohibited Uses)**:
     - 条款明确禁止：“*To create a database by systematically downloading and storing all or substantial portions of API content for the purpose of creating a competing service, redistributing the data, or avoiding API usage limits.*”（禁止为创建竞争服务、重新分发数据或规避 API 使用限额，而通过系统性下载和存储 API 的全部或重大实质部分内容来构建数据库）。
     - 同时条款明确授予合理缓存权利：“*Reasonable caching of API responses for application performance is permitted.*”（明确允许为提升应用性能对 API 响应进行合理缓存）。
   - **合同终止与留存期限 (§8.4)**: 条款明确约定，一旦服务或账户终止，“*Your right to access and use the Service immediately ceases; You must cease all use of the API and destroy any downloaded materials*”（必须停止使用并销毁所有已下载材料）。
   - **“明确禁止”与“未确认授权”的严格区分**:
     - **明确禁止**: 构建与 GNews 竞争的新闻索引服务；未授权转售或再分发 API 访问权；为逃避调用配额系统性扒取存储全部数据。
     - **未确认授权**: GNews 虽允许应用性能所需的短期缓存，但将第三方媒体的文章元数据与摘要在外部分析型数据仓库（BigQuery）中进行长期、永久性归档留存，并未获得原出版方的确权；且终止时销毁材料的合同义务与项目数据仓库的历史回溯诉求存在冲突。
4. **地理质量与事件级验证核查**:
   - **Schema 结构**: `/api/v4/search` 返回的字段仅包含：`title`, `description`, `content`, `url`, `image`, `publishedAt`, `source: { name, url }`。
   - **缺乏事件级空间属性**: 返回对象中**完全没有**事发地点（no Suburb, no LGA, no Postcode, no Street Address, no Point Coordinates）。
   - **关键词过滤在维州环境下的质量缺陷**:
     - 检索参数仅支持全文 `q` 与国家 `country=au`。若检索 `q=Melbourne AND (crime OR police)`：
       1) **同名地点风险**: 可能命中美国佛罗里达州墨尔本（Melbourne, FL）或阿肯色州墨尔本；本次未凭 authenticated API 样本量化发生频率。
       2) **非案发语义提及风险**: 关键词也可能出现在体育、市政会议或全国犯罪政策报道；这些是待验证的误报场景，本次未量化误报率。
       3) **无法区分事发地与提及地**: `quality-rules.md` §3 严格要求，仅当报道明确说明事发地且地名能唯一映射到官方区域时才可标记为 `event_site`，否则只能保留为 `mentioned_place` 或 `unknown`。仅凭 API 字段无法完成案发地独立验证。须依据经许可的材料核实事发地，再由人工基准评分；缺乏坐标字段本身不能证明 SC-004 准确率低于 95%。
5. **综合判定**:
   - **不予准入 (`review_required` / 未获第三方出版方留存授权且地理质量尚未验证)**。合理缓存虽未被一概禁止，但第三方内容版权未经授权，且缺乏事件级地理元数据。

#### 4.2 NewsAPI (`newsapi.org`)

1. **官方入口与核查页面**:
   - 官方条款: `https://newsapi.org/terms` (HTTP 200, Last updated April 30, 2020)
   - 端点规范: `https://newsapi.org/docs/endpoints/everything`
2. **机器访问机制 (Machine Access)**:
   - 标准 RESTful JSON API，通过 Header `X-Api-Key` 或查询参数鉴权。
3. **条款权责与限制深入分析**:
   - **订阅计划与环境限制 (Developer plan)**:
     - 官方对免费的 Developer plan 施加了极其严苛的部署限制：“*The Developer plan may be used for development and testing in a development environment only, and cannot be used in a staging or production environment (including internally).*”（免费计划仅限在开发环境中进行开发与测试，**严禁在 staging 或生产环境中使用，包括内部环境**）。一旦在开发环境外集成，许可即被撤销，必须购买付费商业订阅。
   - **使用许可与禁止项 (Use license)**:
     - 许可下载权限表述：“*Permission is granted to download the materials (information or software) on News API's website for as long as your use case requires.*”（在用例所需期限内允许下载）。
     - 明确禁止项：
       - “*use the service to reproduce or republish copyrighted material*”（严禁使用该服务复制或重新发布受版权保护的材料）；
       - “*attempt to build a competing news database*”（严禁试图构建竞争性新闻数据库）；
       - 严禁绕过 API 限额、逆向工程等。
   - **数据许可与第三方版权 (Data license)**:
     - 官方明确声明：“*Data accessible through News API may contain third party content... will remain the sole responsibility of those who make it available... subject to intellectual property rights. If this is the case you may not use it unless you are licensed to do so or are otherwise permitted by law.*”（第三方内容受知识产权保护，除非获得所有者明示许可或法律许可，否则不得使用）。
     - 明确禁止删除作者署名、版权声明，禁止在未经明示授权下公开发布数据或统计信息。
   - **“明确禁止”与“未确认授权”的严格区分**:
     - **明确禁止**: 使用服务复制或重新发布受第三方版权保护的文章内容；试图构建竞争性新闻数据库；在 staging 或 production 环境中使用免费 Developer 计划。
     - **未确认授权**: 将文章摘要与元数据在数据分析平台中长期留存并向外部用户展示，未获原出版方授权；NewsAPI 自身并不提供对第三方新闻内容的权利担保或许可转授。
4. **地理质量与事件级验证核查**:
   - **Schema 结构**: `/v2/everything` 返回字段为：`source: { id, name }`, `author`, `title`, `description`, `url`, `urlToImage`, `publishedAt`, `content`。
   - **缺乏事件级空间属性**: 不存在任何官方地理外键、行政区划或坐标字段。
   - **空间质量分析**: 类似 GNews，全文关键字搜索无法避免同名异地、体育报道及非案发地提及。仅凭这些字段不能完成 `quality-rules.md` §3 的事发地点独立验证。尚未核实的条目保持 mentioned_place 或 unknown；经许可材料和官方位置证据可支持后续核验，本次未运行 SC-004 准确率测试。
5. **综合判定**:
   - **不予准入 (`review_required` / 生产环境需付费订阅、第三方版权未确权且地理质量尚未验证)**。条款虽允许用例期内的下载，但严禁复制受版权内容及免费计划入生产，且缺乏地理空间支撑。

---

### 候选五：Australian Associated Press (AAP Newswire) / 澳大利亚联合通讯社

1. **官方入口与核查页面**:
   - 官方主页: `https://www.aap.com.au/` (HTTP 200)
   - 使用条款: `https://www.aap.com.au/terms-of-use/` (HTTP 200)
2. **机器访问可行性 (Machine Access)**:
   - 无对公众开放的免费 API 或 RSS。仅向签约媒体机构通过 MediaNet、专线 FTP 或 B2B 商业接口供稿。
3. **再利用与许可条款 (Licensing & Reuse)**:
   - AAP Terms of Use 规定极严：
     > *"All information, text and images included on the AAP Websites is for personal use only and may not be re-written, copied, re-sold or re-distributed, framed, linked, shared onto social media or otherwise used whether for compensation of any kind or not, without the prior written permission of AAP."*
   - 严禁任何形式的自动化爬取、复制、二次分发或商业转售。
4. **保存字段能力与地理证据**:
   - 通讯社电讯稿包含发稿地（Dateline，如 `MELBOURNE, AAP`），但代表发稿记者所在地，并非案发精确地理。
5. **综合判定**:
   - **不予准入 (`review_required`)**。缺乏开放授权，必须进行高成本商业采购。

---

### 候选六：Data.Vic CKAN API & Crime Statistics Agency (CSA) / 维州官方开放数据平台

1. **官方入口与核查页面**:
   - Data.Vic CKAN 检索端点: `https://discover.data.vic.gov.au/api/3/action/package_search?q=crime&rows=10` (实测 HTTP 200)
   - 许可类型: Creative Commons Attribution 4.0 International (CC BY 4.0)
2. **机器访问与许可**:
   - 完全开放，具备标准 REST API，条款明确允许自动化机器读取、再利用与数据仓库留存。
3. **针对犯罪新闻的标准核验**:
   - 检索到的全部 38 个数据集均为 **CSA 季度/年度聚合统计表格**（如 `data-tables-recorded-offences`、`criminal-incident`、`data-tables-family-incidents`）或法院物理网点（`court-locations`）。
   - **无任何实时突发、单宗案件新闻或带有原文 URL 的媒体报道**。
   - CSA 统计数据已在 T041（`victoria.csa.recorded_offences`）中完成接入，属于“区域统计指标”，在 `quality-rules.md` §2 中明确要求与“本地犯罪报道”**分开显示，不能相互顶替**。
4. **综合判定**:
   - **不可作为犯罪新闻替代源**。属性属于宏观统计表，不满足事件级新闻要求。

---

### 候选七：GDELT DOC 2.0 API 探索验证

1. **官方入口与核查请求**:
   - 请求端点: `GET https://api.gdeltproject.org/api/v2/doc/doc?query=melbourne%20crime&mode=artlist&maxrecords=5&format=json`
   - 实测结果: 响应 HTTP 200，但正文返回限流通知：
     > *"Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com for larger queries. All high-traffic users should switch to our ngrams dataset..."*
2. **属性判定**:
   - GDELT DOC API 属于已有 GDELT 来源族系的发现辅助工具，非独立出版方。
   - 接口在当前运行环境极易超时或触发反爬封锁，不能作为独立稳定的生产连接器。

---

## 3. 候选来源多维综合评估矩阵

| 候选来源 | 官方访问入口与机制 | 机器访问与鉴权方式 | 许可条款与再利用权利 | 字段与留存合法性 | 更新频率 | 维州/墨尔本地理证据 | 最终合规决策 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Victoria Police News** | `police.vic.gov.au/news` | 仅 HTML 渲染；邮件订阅限定记者身份；无公开 API/RSS | 皇室版权全权保留；明示仅作信息参考；无 CC 授权，未批准抓取与二次发布 | 需爬虫抽取 HTML；无稳定字段 Schema；未经授权不得持久化 | 随警情实时发布 | 极强（明确街道、Suburb、Division） | **否决 (`review_required`)**，T044 维持冻结 |
| **ABC News Melbourne** | `abc.net.au/melbourne/news` | 公开 RSS 已废弃；帮助站设 WAF 拦截；仅 Syndication 商业渠道 | 仅限个人非商业使用；Syndication 需签订商业合同与撤稿规范 | 文章含 OpenGraph 元数据；签约后可获取结构化数据 | 24/7 实时滚动 | 中等（需 NLP 实体抽取，混有全澳/国际新闻） | **暂缓接入**；最有前途的商业采购项，未签约前阻断 |
| **The Guardian Australia** | `open-platform.theguardian.com` | REST API；需注册 Key；免费版 1 QPS / 500 次/天 | **第 7(g) 条明文禁止用于数据聚合、趋势分析与任何 AI 场景**；免费版禁商业用途 | 标准 JSON；禁止外部数据库长期留存 | 实时 | 极差（国家级政治/深度新闻为主，本地警情极少） | **按当前标准条款不适用 (`unsuitable_and_prohibited`)** |
| **GNews API** | `gnews.io` | REST API；API Key 鉴权；免费版 100 次/天 | **明确禁止构建竞争服务与规避限额建库，允许性能合理缓存**；但第三方内容版权未授权，终止时需销毁材料 | 仅含基础元数据；未获第三方原出版方长期留存与展示确权 | 轮询 | 极低（仅关键词匹配，缺 Suburb/LGA/坐标，混入同名地点与体育新闻） | **否决 (`review_required`)**，第三方版权未确权且地理质量不足 |
| **NewsAPI** | `newsapi.org` | REST API；API Key 鉴权；**免费版明令禁止用于 staging/生产** | 允许用例期内下载，**但严禁构建竞争数据库，严禁复制/重发受版权内容**；第三方内容版权免责 | 仅提供基础标题/摘要/URL；缺乏第三方版权豁免 | 轮询 | 待验证（关键词匹配，无原生事件级空间字段；未测 SC-004 准确率） | **否决 (`review_required`)**，免费版禁入生产且地理质量不足 |
| **AAP Newswire** | `aap.com.au` | 仅面向签约媒体提供专线与商业接口；无免费通道 | 仅限个人浏览；明文严禁复制、转写、转售与对外分发 | 具备标准电讯格式；必须商用许可 | 实时 | 中等（发稿地与事发地易混淆） | **否决 (`review_required`)**，无开放授权 |
| **Data.Vic (CSA)** | `discover.data.vic.gov.au` | 标准 CKAN REST API；开放无鉴权 | CC BY 4.0 明确许可再利用与长期留存 | 规范宏观统计表格；无单条犯罪新闻与原文链接 | 季度发布 | 优秀（LGA 边界级） | **属性不符**；已由 T041 承载，不可顶替新闻 |

---

## 4. 调研结论与对交付门槛的影响

### 4.1 准入结论
根据上述对 7 个候选来源的官方实证核查：
1. **没有任何一个候选来源在当前状态下同时满足“合法可用的机器访问渠道”与“明确授权用于数据分析平台留存及公开展示的版权资质”两条红线**。
2. 现有各平台中：
   - 卫报（The Guardian）存在直接法律禁令（第 7(g) 条禁止数据聚合、趋势分析与任何 AI 用途）；
   - 商业聚合 API（NewsAPI、GNews）中，NewsAPI 明确禁止免费计划用于 staging/生产环境且禁止复制受版权内容；GNews 虽允许应用性能合理缓存，但明文禁止为竞争服务或绕过限额建库，且两家均明确声明对第三方媒体内容不提供版权授权，此外缺乏原生 Suburb/LGA/坐标等事件级元数据，空间归属还需独立验证，本次未测 SC-004 准确率；
   - 官方执法机构（Victoria Police）与公营媒体（ABC）均保留全部版权，未向公众开放免授权的数据摄取接口。

### 4.2 对后续任务与门槛的阻断影响
1. **T051 保持阻断**:
   - 依据 `tasks.md` T051 的前置条件（“仅在 T050 选定许可合规的替代来源后接入其元数据与原文链接... 未选定时 FR-002／SC-001 保持未达标”），**严禁在没有正式授权的情况下创建 `cloud/data/src/connectors/local_crime_news_alt/` 目录或编造 mock fixture 假冒接入**。
   - 来源规范 ID 分配暂停，不向 `source-ids.md` 申请新增替代源 ID。
2. **FR-002 与 SC-001 保持未达标状态**:
   - `cloud/data/docs/validation/crime-news-coverage.md` 与 `source-coverage.md` 中关于犯罪新闻分类的判定继续保持“证据不足 / 未达标”。前端及 API 查询在返回犯罪新闻分类时必须准确呈现 `coverage_status = not_covered` 或 `unknown`，不得隐瞒缺失。

---

## 5. 面向产品与集成团队的后续建议

1. **推进商业谈判途径 (ABC News Syndication)**:
   - 若项目必须具备墨尔本本地实时犯罪与治安报道，建议由项目管理团队向 **ABC News Syndication** (`https://www.abc.net.au/newssyndication`) 提起商务咨询，申请包含墨尔本本地新闻元数据（标题、发布时间、摘要、分类、跳转链接）的商用 API 许可，并签订具备明确更正/撤稿同步条款的协议。
2. **向维多利亚州警方申请媒体数据通道**:
   - 向 Victoria Police Media Unit (`policemediaunit-mgr@police.vic.gov.au`) 咨询是否有面向公众安全研究或政企合作的结构化警情数据服务。
3. **依靠 GDELT GKG 维州地理累积**:
   - 在商业授权落地之前，继续完善 GM-01 对 GDELT GKG 15 分钟切片的累积摄取，由集成人员在稳定运行若干周后，通过固定时间窗口的真实样本检验是否能自然满足“30 天 ≥5 条犯罪报道、≥2 个发布日期”的最低保底门槛。

## 6. 集成复核补充，2026-10-01

[GNews 当前条款](https://gnews.io/legal/terms-of-service) 第 7 节将系统性建库限制关联到竞争服务、再分发或规避限额，并允许合理性能缓存；不能扩大为禁止一切存储。[NewsAPI 当前条款](https://newsapi.org/terms) 允许按用例下载，但分别限制竞争数据库、受版权材料重发布、第三方内容权利和免费计划部署环境。两家的长期仓库存储、具体字段展示与终止清理范围尚未获准入确认。无原生坐标只说明需要额外地理核验，不是准确率测试结果。未选定合法替代源，T051 继续待办。
