# 数据采集与运维操作手册 (Data Operations Manual)

本手册是 Melens 墨尔本公共数据采集平台的生产运维与开发规范指南。覆盖连接器生命周期、历史回补流程、GCS 并发与前置条件、BigQuery 成本与配额管理、批次隔离与入库门禁、数据保留合规及凭据安全运维。

---

## 1. 架构总览与运维职责

### 1.1 系统组件与技术栈

| 组件 | 托管服务 / 资源 | 职责与运行边界 |
| --- | --- | --- |
| **Ingestion Engine** | Cloud Run Jobs (`australia-southeast2`) | 按数据源发布节奏或指定时间窗口执行 Node.js (>=24 <25) / TypeScript 采集任务。 |
| **Scheduler** | Cloud Scheduler (`australia-southeast1`) | 从悉尼定时触发墨尔本的 Cloud Run Jobs，身份仅具备目标 Job 的 `roles/run.invoker` 权限。 |
| **Staging & Raw Store** | Cloud Storage (`gs://${GCS_BUCKET}`) | 存放受许可保护的 `raw/` 原始报文、`staging/` 临时加载 ndjson、`checkpoints/` 清单及 `locks/` 批次与来源租约锁。 |
| **Analytical Store** | BigQuery (`melens_ingest`) | 规范化事实数据主存储（受控写入）、同步批次跟踪表及入库前 5 维度质量门禁校验。 |
| **Query Layer** | BigQuery (`melens_query`) | 面向下游应用和 Agent 的只读授权视图层。仅暴露已通过准入且已发布的干净数据。 |
| **Secret Management** | Secret Manager | 云端作业的第三方 API Key 与凭据存储。严禁提交源码、清单、镜像或 `.env` 文件中的明文凭据。 |

### 1.2 运行时环境变量配置 (`loadConfig`)

代码统一通过 `cloud/data/src/core/config.ts` 中的 `loadConfig()` 校验运行环境配置，缺失必需项立即失败关闭（Fail-Closed）：

| 环境变量 | 格式与约束 | 描述与用途 |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | 必填，`^[a-z][a-z0-9-]{4,28}[a-z0-9]$` | 目标 GCP 项目 ID（例：`melens-dev-project`）。 |
| `GCP_REGION` | 必填，固定字面量 `australia-southeast2` | 采集任务、BigQuery 与存储桶使用墨尔本区域；Cloud Scheduler 另用悉尼位置。 |
| `GCS_BUCKET` | 必填，3~63 字符合法 GCS 桶名，匹配 `^[a-z0-9][a-z0-9._-]*[a-z0-9]$` 且无连续点与连字符 | 存储桶名称（**不带 `gs://` 前缀**，例：`melens-dev-data-2026`）。 |
| `BQ_INGEST_DATASET` | 必填，合法 BigQuery 数据集标识符 `^[A-Za-z_][A-Za-z0-9_]{0,1023}$` | 规范化事实存储数据集（**必需环境变量，无代码默认值**；标准命名示例：`melens_ingest`）。 |
| `BQ_QUERY_DATASET` | 必填，合法 BigQuery 数据集标识符 `^[A-Za-z_][A-Za-z0-9_]{0,1023}$` | 面向下游的授权视图数据集（**必需环境变量，无代码默认值**；标准命名示例：`melens_query`）。 |
| `SECRET_NAMES` | 可选，逗号分隔的简单 Secret ID 列表 | 声明允许当前任务读取的 Secret Manager **简单 Secret ID** 白名单（例：`tv-api-key,ticketmaster-api-key`）。每个 ID 匹配 `^[A-Za-z0-9_-]{1,255}$` 且不得重复。**严禁传入包含斜杠的完整资源路径**（如 `projects/...` 会导致校验失败），**严禁包含任何密钥值**。 |

Cloud Scheduler 的资源位置是 `australia-southeast1`，与采集任务、BigQuery 和存储桶的 `australia-southeast2` 分开配置。预算响应服务使用 `MELENS_SCHEDULER_LOCATION=australia-southeast1` 校验允许暂停的调度任务路径。

本地运行 `npm run ingest` 时，Node.js 24 会从仓库根目录可选加载 `.env`。Ticketmaster Discovery API 连接器读取 `TICKETMASTER_DISCOVERY_API_KEY`。`.env` 已由 Git 忽略，只用于本机开发；Cloud Run 镜像不复制 `.env`，部署脚本继续把 Secret Manager 中的 `ticketmaster_discovery_api_key` 注入同名进程环境变量。

```bash
# 环境变量配置示例（通过 loadConfig() 严格校验）：
export GOOGLE_CLOUD_PROJECT="melens-dev-project"
export GCP_REGION="australia-southeast2"
export GCS_BUCKET="melens-dev-data-2026"
export BQ_INGEST_DATASET="melens_ingest"
export BQ_QUERY_DATASET="melens_query"

# 可选：仅声明简单 Secret ID（以逗号分隔，无斜杠，绝无密钥值）
export SECRET_NAMES="tv-api-key,ticketmaster-api-key"
```

> [!IMPORTANT]
> **无默认值保证 (No Default Fallback)**：`BQ_INGEST_DATASET` 与 `BQ_QUERY_DATASET` **均为必填项**，`loadConfig()` 内部**不存在**自动回退为 `melens_ingest` 或 `melens_query` 的默认逻辑。若未显式配置这两个变量，进程将立即抛出 `ConfigError: Missing or invalid configuration: BQ_INGEST_DATASET, BQ_QUERY_DATASET` 并失败退出。
>
> **Secret 标识符约束 (Secret IDs Only)**：`SECRET_NAMES` 仅接受简短的 Secret ID（如 `tv-api-key`），**绝不接受**形如 `projects/PROJECT_ID/secrets/SECRET_NAME` 的完整资源路径字符串（包含斜杠会导致正则校验失败并抛出 `ConfigError: Missing or invalid configuration: SECRET_NAMES`）。


### 1.3 时区与时间格式规范

- **业务时区**：所有涉及业务逻辑判定（如停车规则生效时段、节假日判定、新闻发生日）统一以澳大利亚墨尔本时区（`Australia/Melbourne`，AEST UTC+10 / AEDT UTC+11）为基准。
- **存储与 API 时间戳**：所有数据表字段（`published_at`, `observed_at`, `valid_from`, `valid_to`, `fetched_at`, `started_at`, `state_updated_at`）、GCS 元数据、日志和调度参数必须使用严格的 ISO-8601 UTC 格式（例：`2026-09-29T00:00:00Z`，无毫秒或毫秒保留均带 `Z`）。

### 1.4 角色与权限隔离边界

```text
[本地开发人员 / ADC]       [Cloud Scheduler]          [Cloud Run Ingest Job]       [下游查询服务 / Agent]
         │                         │                            │                            │
         ▼ (仅限开发环境)            ▼ (roles/run.invoker)        ▼ (WRITER / ObjectAdmin)     ▼ (READER)
 [GCP Dev Project]      [Cloud Run Job Trigger]      [GCS Bucket & melens_ingest]   [melens_query 授权视图]
```

| 角色 | 权限范围 | 限制与禁区 |
| --- | --- | --- |
| **项目拥有者 (Project Owner)** | 账单与预算管理、GCP 资源创建、在 Secret Manager 录入第三方 API 密钥。 | 不得下载长期 Service Account 密钥，不得将明文 key 共享给第三方或写入代码。 |
| **集成人员 (Integrator / On-call)** | 运行基础设施脚本 (`bootstrap.sh`)、审查来源准入、调整调度与并发、处理运维告警。 | 仅接触 Secret Manager 简单密钥标识符 (Secret ID)，不可直接读取明文密钥。 |
| **开发人员 / Agent** | 本地运行单元测试与契约测试、通过受限 SA 模拟测试公开数据源。 | 严禁部署未经验收代码至生产环境；无生产 Secret 读取权限。 |
| **下游查询身份 (Query Identity)** | 仅允许通过 `melens_query` 的授权视图查询已发布事实。 | 严禁直连 `melens_ingest` 物理事实表，严禁访问 GCS 原始桶。 |

---

## 2. 新增连接器流程与准入规范 (Adding New Connectors)

所有外部数据源必须通过严格的准入审查后方可在生产环境部署和发布。新增连接器分为三个阶段：准入登记、连接器实现与无状态探测（`probe`）、准入审查与上线。

### 2.1 准入前置与 `source.json` 元数据规范

每个连接器独立存放在 `cloud/data/src/connectors/<connector_name>/` 目录下，且必须包含一个规范的 `source.json` 清单文件。

```json
{
  "source_id": "melbourne.pedestrian.minute",
  "legacy_ids": ["pedestrian-live", "com.pedestrian.live"],
  "provider": "City of Melbourne",
  "dataset_title": "Pedestrian Counting System - Past Hour (counts per minute)",
  "landing_url": "https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-past-hour-counts-per-minute/",
  "api_endpoint": "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/pedestrian-counting-system-past-hour-counts-per-minute/records",
  "topic": "pedestrian",
  "scope": "city",
  "coverage_area_refs": [],
  "coverage_from": null,
  "coverage_to": null,
  "cadence_seconds": 900,
  "check_interval_seconds": 900,
  "requires_monitoring": true,
  "license_status": "review_required",
  "access_status": "candidate",
  "record_granularity": "sensor_minute",
  "connector_owner": "melens integration",
  "admission_evidence": {
    "dataset_url": "https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-past-hour-counts-per-minute/",
    "native_record_key": "location_id + sensing_datetime",
    "completeness_rule": "All pages match total_count; requested window plus 15-minute overlap remains inside the past-hour feed",
    "quota_requests_per_day": 10000,
    "secret_names": [],
    "allowed_fields": ["location_id", "sensing_datetime", "direction_1", "direction_2", "total_of_directions"],
    "staging_retention_days": 1,
    "raw_retention_days": 7,
    "license_evidence_url": "https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-past-hour-counts-per-minute/"
  }
}
```

#### 关键字段要求与准入门禁：
1. **`source_id`**：规范命名，必须匹配全局来源注册表（参见 `specs/001-melbourne-data-aggregation/source-ids.md`）。小写字母数字加点号，不得随意创造新 ID。
2. **`license_status` 与 `access_status`**：
   - **初始状态必须为 `license_status: "review_required"` 和 `access_status: "candidate"`**。
   - 严禁在未确认官方许可证据、配额上限和实际同步样本前手动改为 `verified_open` / `permitted` 或 `active`。
   - 公开样例数据可用于本地开发和契约测试，但不代表准入已通过。
3. **`secret_names`**：若该数据源需要凭据，仅填写其在 Secret Manager 中的**简单 Secret ID**（如 `"tv-api-key"` 或 `["transport_victoria_key_id"]`，字符串数组），每一项需匹配正则 `^[A-Za-z0-9_-]{1,255}$`。**严禁**填写如 `projects/.../secrets/...` 等包含斜杠的完整资源路径字符串（包含斜杠会导致清单解析失败），**绝对严禁**写入密钥值。
4. **`allowed_fields`**：在许可允许留存原始报文的前提下，列出允许持久化保存的原始字段白名单。若为 `null` 或空数组，则 GCS 禁止留存任何 `raw` 级别对象。

### 2.2 连接器实现规范 (`Connector` 接口)

连接器入口文件为 `cloud/data/src/connectors/<connector_name>/index.ts`，必须实现统一的 `Connector` 接口：

```typescript
import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';

export class PedestrianMinuteConnector implements Connector {
  readonly sourceId = 'melbourne.pedestrian.minute';

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    // 1. 解析 input.window ({ kind: 'time', from, to } 或 { kind: 'snapshot', revision })
    // 2. 调度 HTTP 请求拉取上游数据，支持分页与 Retry-After 退避 (core/http.ts)
    // 3. 校验分页与条数完整性 (completeness)
    // 4. 将原生报文投影为规范化事实记录 (sourceRecords, geoRecords 等)
    // 5. 返回 ConnectorSuccess 或 ConnectorFailure
  }
}
```

#### 编码与设计必须遵守的铁律：
- **完整性验证 (`completeness`)**：每次抓取必须核对分页总数或数据总量。若上游响应的总数发生漂移或未达到预期记录数，必须返回 `kind: 'failure'`，且 `code: 'incomplete_window'`。
- **错误处理与凭据脱敏**：上游异常时返回 `ConnectorFailure`（错误码涵盖 `rate_limited`, `upstream_unavailable`, `schema_changed`, `auth_failed`, `incomplete_window`, `validation_failed`）。**错误信息 `message` 中严禁包含请求 URL 中的 token、Authorization 请求头或明文密码**。
- **规范化表结构与版本控制**：所有输出记录打上 `schema_version = 1`，产出以下标准实体集合：
  - `sourceRecords`（来源元数据与原始引用）
  - `geoRecords`（具备空间属性的业务事件、设施或新闻）
  - `geoRecordSources`（多对多空间事实来源引用关联）
  - 领域扩展事实表（`parkingBays`, `parkingObservations`, `parkingRules`, `sensorLocations`, `pedestrianObservations`, `boundaries`, `areaIndicators`）
- **地理归属严谨性**：
  - 仅在数据源官方坐标明确指示事件点、传感器或场馆时，方可赋予 `event_site` 或 `sensor_site`。
  - 新闻文本提及的地点默认标记为 `mentioned_place` 或 `area_only`。
  - **严禁无证据生成精确 Point 坐标**，多边形质心不得伪装成事件发生点。
  - 遇到未知或冲突位置，置信度标记为 `unverified` 并将坐标置空，隔离地理映射但保留非地理事实。
- **缺口保留原则**：传感器无数据、统计项缺失必须保留 `null` 或标记 `missing`/`suppressed`，**绝对禁止补零或伪造数据**。

### 2.3 开发测试与探测工具 (`probe`)

在连接器接入阶段，可利用项目内置的 npm 脚本进行类型检查、单元测试及无副作用探测：

```sh
cd cloud/data

# 1. 类型检查
npm run typecheck

# 2. 编译并复制 manifests 清单
npm run build

# 3. 运行本地测试套件
npm test
```

#### 无副作用探测命令 (`npm run probe`)：
为了在不触碰 GCP Storage、不更新 Checkpoint 且不向 BigQuery 写入任何数据的安全前提下验证连接器逻辑，使用 `dist/src/jobs/probe.js`：

```sh
# 按时间窗口探测公开数据源
npm run probe -- --source melbourne.pedestrian.minute \
  --from 2026-09-28T00:00:00Z \
  --to 2026-09-28T01:00:00Z

# 按快照版本探测静态数据源
npm run probe -- --source melbourne.municipal_boundary \
  --revision latest
```

> [!NOTE]
> - `probe` 命令支持探测处于 `candidate` 与 `review_required` 状态的数据源，便于开发期间快速验证采集与转换逻辑。
> - **安全阻断**：若数据源在 `admission_evidence.secret_names` 中声明了密钥依赖，`probe` 会自动阻断执行（`Public probe is disabled for sources requiring a secret`），防止无授权访问。

---

## 3. 历史数据回补与采集操作指南 (Backfill & Ingest Procedures)

生产采集与回补通过 `dist/src/jobs/ingest.js` 执行。

### 3.1 CLI 采集与回补命令规范

`ingest` 命令要求数据源必须已完成准入审查（`license_status != 'review_required'` 且 `access_status == 'active'`），否则立即失败退出。

```sh
cd cloud/data

# 演示上限；正式运行前替换为该来源已审核的单次查询字节数
export BQ_MAXIMUM_BYTES_BILLED=100000000

# 1. 编译最新代码
npm run build

# 2. 增量或常规窗口采集
npm run ingest -- \
  --source melbourne.pedestrian.hourly \
  --from 2026-09-28T00:00:00Z \
  --to 2026-09-28T01:00:00Z

# 3. 历史窗口回补 (--backfill 必须与 --from 和 --to 配合使用)
npm run ingest -- \
  --source melbourne.pedestrian.hourly \
  --from 2026-08-01T00:00:00Z \
  --to 2026-08-08T00:00:00Z \
  --backfill

# 4. 首次时间窗采集的初始游标绑定 (--initial-cursor)
npm run ingest -- \
  --source melbourne.pedestrian.minute \
  --from 2026-09-28T00:00:00Z \
  --to 2026-09-28T01:00:00Z \
  --initial-cursor 2026-09-28T00:00:00Z

# 5. 静态快照版本采集 (--revision 与 --from/--to 互斥，支持 2026 或 2021)
npm run ingest -- \
  --source abs.asgs.boundaries \
  --revision 2026
```

#### `--initial-cursor` 的关键运维规则：
- 当数据源在 `source.json` 中的 `coverage_from` 为 `null`，且 GCS 中尚无该来源的 Checkpoint 清单时，首次时间窗运行**必须显式提供 `--initial-cursor`**。
- `--initial-cursor` 必须是 ISO-8601 UTC 时间戳，且不得晚于 `--from`。
- 一旦该来源已有发布的 Checkpoint 清单（GCS generation != '0'），系统严禁再传入 `--initial-cursor`，以防止篡改历史进度。

#### `--revision` 的关键运维规则：
- 静态快照型数据源（如统计边界、全量普查、季度犯罪统计）采集使用 `--revision` 参数，与 `--from` / `--to` 时间窗参数严格互斥。
- 传入的 `--revision` 值必须严格遵守各数据源连接器支持的版本契约，严禁自定后缀或别名：
  - `abs.asgs.boundaries`：仅接受官方统计年份代码 `'2026'` 或 `'2021'`（传入 `'2026-edition'` 等自定义别名会导致 `validation_failed: This connector supports ASGS 2021 or 2026 snapshots` 校验失败退出）；
  - `melbourne.municipal_boundary`：支持 `'latest'`；
  - `abs.census`：支持 `'2021'` 或 `'latest'`；
  - `victoria.csa.recorded_offences`：支持 `'latest'` 或特定季度资源 UUID。

### 3.2 窗口切分与数据源特性约束

不同数据源的上游保留窗口各不相同，回补前必须确认上游限制：

1. **实时流式数据源（如 `melbourne.pedestrian.minute`）**：
   - 上游 API 仅保留最近 60 分钟数据。
   - 若系统停机超过 60 分钟，不可试图对 60 分钟之前的时间段发起分钟级回补（上游已不存在该数据）。
   - 超过 60 分钟的断档应作为不可恢复的分钟缺口记录，由小时级历史数据源（`melbourne.pedestrian.hourly`）来填补统计需求。
2. **时序与事件数据源（如道路施工中断 `victoria.transport.road_planned`）**：
   - 建议将大跨度回补切分为单天（1 Day）或单周（1 Week）的小窗口，避免单次任务数据量过大导致内存溢出或上游限流。
3. **统计发布与静态边界版本（如 `abs.asgs.boundaries`、`victoria.csa.recorded_offences`）**：
   - 每次官方发布或固定年份为一个独立的快照版本，按版本全量采集，通过 `--revision` 执行。所选 `--revision` 参数必须符合连接器支持的版本契约（如 `abs.asgs.boundaries` 支持 `2026` 或 `2021`）。

### 3.3 GCS Checkpoint 连续窗口推进算法

回补过程中，系统如何记录和维护进度？
- Checkpoint 清单持久化在 GCS：`gs://${GCS_BUCKET}/checkpoints/<source_id>.json`。
- 数据结构如下：
  ```json
  {
    "sourceId": "melbourne.pedestrian.hourly",
    "checkpoint": "2026-08-05T00:00:00Z",
    "completedWindows": [
      { "from": "2026-08-06T00:00:00Z", "to": "2026-08-07T00:00:00Z", "batchId": "batch_abc..." }
    ]
  }
  ```
- **核心算法规则 (`addCompletedWindow`)**：
  - Checkpoint 游标仅沿着**连续无间断**的窗口向前移动（`candidate.from <= cursor && candidate.to > cursor`）。
  - **断档保护机制**：如果乱序执行回补（例如先完成了 08-06~08-07 的窗口，但 08-05~08-06 尚未完成），游标将坚决停留在 `2026-08-05T00:00:00Z`，后完成的高位窗口被暂存入 `completedWindows` 列表中。
  - 一旦补充执行 08-05~08-06 成功，系统检测到从 `2026-08-05` 到 `2026-08-07` 的连续链条已完整，游标将**自动级联推进**至 `2026-08-07T00:00:00Z`。
  - **绝不会因为后发批次先成功而跳过前序缺失数据！**

### 3.4 批次结果核验命令 (`npm run verify`)

每次数据采集或回补执行完毕后，可通过 `dist/src/jobs/verify.js` 核查 BigQuery 中的批次发布状态与记录质量：

```sh
# 验证指定数据源最近一次批次
npm run verify -- --source melbourne.pedestrian.minute

# 验证特定批次 ID
npm run verify -- --source melbourne.pedestrian.minute --batch batch_f10a8b9c...
```

该命令会输出结构化 JSON 报告，包含：
- `state`: 批次状态（`published` 或 `failed`）；
- `logical_records`: BigQuery 事实表中的去重逻辑记录数；
- `located_records`: 成功解析出空间位置的记录数；
- `unlocated_rows`: 无位置或被隔离地理映射的记录数；
- `source_delay_seconds`: 采集时间与上游发生时间的实际延迟秒数；
- `gap_detected`: 布尔值，指示本次窗口与上一已知 Checkpoint 之间是否存在断档缺口。

---

## 4. GCS 清单竞争与并发控制 (Concurrency & Contention Control)

在分布式任务调度或并发回补中，Melens 通过 GCS 的元数据前置条件（Preconditions）实现乐观并发控制与租约锁。

### 4.1 来源租约锁 (`withBatchLease`)

为了防止针对同一数据源的并发发布、并发回补或撤销操作发生竞态冲突，`BigQueryPublisher` 在发布、记录失败和撤销来源时均会申请来源级别的租约锁：

1. **锁对象位置与命名**：
   - 锁名称格式：`source_${sha256(source_id)}`
   - GCS 对象路径：`gs://${GCS_BUCKET}/locks/source_<hash>.json`
2. **加锁逻辑**：写入时设置 `ifGenerationMatch: 0`。仅当该锁文件在 GCS 中不存在时写入成功，锁租期默认设为 30 分钟（`leaseUntil = Date.now() + 30 * 60_000`）。
3. **冲突处理**：若另一个任务已经持有该锁，GCS 会返回 HTTP 412 Precondition Failed。系统会抛出明确异常：
   ```text
   Error: Batch publication is already in progress; inspect the job before clearing a stale lease
   ```
4. **运维排障与死锁清理 SOP**：
   - **禁止直接盲目删除锁文件！**
   - **排查步骤**：
     1. 前往 Cloud Run Jobs 列表，检查是否存在正在运行的该数据源采集容器；
     2. 检查 Cloud Logging，确认前序任务是否发生了容器崩溃（OOM、超时 SIGKILL）；
     3. 确认原任务已经彻底死亡且无存活容器后，计算哈希或列出 locks 目录定位锁文件，由集成人员手工清除：
        ```sh
        # 列出当前所有锁
        gcloud storage ls gs://${GCS_BUCKET}/locks/

        # 清除特定来源死锁
        gcloud storage rm gs://${GCS_BUCKET}/locks/source_<hash>.json
        ```

### 4.2 GCS 对象版本条件写入 (Generation Match)

保存 `raw/` 和 `staging/` 的 ndjson 文件时，统一遵循如下路径规范与条件写入：
- 路径规范：`${kind}/${source_id}/${batch_id}/${sha256(bytes)}.ndjson`
- 写入时附带 `ifGenerationMatch: 0`：
  - 若目标对象已存在（HTTP 412），系统会自动下载现有对象的元数据并比对内容 sha256。
  - **哈希一致**：认定为幂等重试，直接复用已有文件 generation，安全继续。
  - **哈希不一致**：抛出 `Error: Existing object content differs`，立即终止任务，防止数据被篡改或覆盖。

### 4.3 Checkpoint 清单竞争与重试

多任务更新来源 Checkpoint 时：
- `markPublishedWindow` 读取当前的 `generation`，计算合并后的新窗口，并在写回 `checkpoints/<source_id>.json` 时附带 `ifGenerationMatch: generation`。
- 若发生并发冲突（HTTP 412），代码内部最多自旋重试 6 次。
- 若重试 6 次依然冲突，抛出：
  ```text
  Error: Checkpoint contention exceeded retry limit
  ```
- **排查与应对措施**：
  1. 检查 Cloud Scheduler 调度频率，确认是否同一来源的上一周期任务尚未执行完毕，下一周期任务便已被拉起；
  2. 检查是否有操作人员在同时手工运行多实例回补同一来源；
  3. **解决方案**：Cloud Run Job 设置单实例执行；同一来源的手动回补任务必须按时间窗口串行触发。

### 4.4 定时抓取请求账本与锁

`scheduled.js` 在发起每次上游 HTTP 请求（包括失败后的重试）之前，将当天 UTC 计数写入 `request-limits/<source_id>/<YYYY-MM-DD>.json`。跨实例写入使用 GCS generation 前置条件；计数达到 `MELENS_REQUEST_CAP_PER_DAY`、单次执行达到 `MELENS_MAX_REQUESTS_PER_EXECUTION`，或账本不可读写时，本次抓取停止。每日额度按 UTC 日计算，不能用本地午夜来重置。查询作业另受 `BQ_MAXIMUM_BYTES_BILLED` 控制；该参数不限制 GCS 存储或 BigQuery Load Job 费用。

来源级定时锁位于 `locks/scheduled/<source_id>.json`。它没有自动过期：容器崩溃或锁的元数据读取失败可能留下锁，后续调度会失败关闭。值班人员须先暂停对应 Scheduler，确认没有该来源的运行中 Cloud Run 执行，检查锁的 generation 和相关日志，再按 generation 条件删除该锁并恢复单次验证。不得因等待一段时间就自动删除锁，也不得重置请求账本来绕过上限。

---

## 5. BigQuery 成本、配额与预算告警 (Cost, Quota & Budget Management)

### 5.1 月度预算与多级告警机制

按照质量规则，生产环境必须在 Google Cloud Billing 中为 Melens 项目创建独立的 Budget，并设置三级告警（通过 Email / Pub/Sub 触发告警通知）：

| 阈值 | 级别 | 预期响应动作 |
| --- | --- | --- |
| **50% 预算** | 提示 (Info) | 检查月度开销速率，核对各来源数据增长是否符合预期。 |
| **80% 预算** | 警告 (Warning) | 审查高频来源的请求频率与 BigQuery 存储增长，暂停非紧急的回补计划。 |
| **100% 预算** | **熔断 (Critical)** | **立即暂停所有非 P0 来源的调度任务，停止全部回补与扩展测试。** |

> [!CAUTION]
> **关键认知**：Google Cloud 预算告警是**监控与通知机制**，GCP **不会**在达到 100% 预算时自动硬性掐断服务或停止计费！运维人员必须依据告警立即执行手工或自动化熔断。

开发项目 `melens-510012` 的自动响应部署和实盘验证步骤见 [budget-action.py 操作说明](../infra/README.md#automatic-budget-response)。2026-09-30 已部署私有 Cloud Run 服务、Pub/Sub 认证推送与预算主题；匿名请求返回 403，模拟本月 100 澳元通知成功暂停测试任务，重复通知未重复暂停。测试任务已删除，当前白名单为空。由于尚未观察到 Billing 原生通知，`budget_action_verified=false`。自动响应只暂停已存在且列入非 P0 白名单的 Scheduler 任务。Cloud Scheduler 的 IAM 不能按任务名限制暂停权限，因此专用服务账号仅获项目级 `get`/`pause` 自定义角色，代码再限制可暂停的名称。新部署非 P0 来源后需重跑配置脚本，将新任务加入白名单。通知可能延迟数小时，已启动的任务和手工回补不会自动停止。

#### 100% 预算触发时的运维应急 SOP：
1. 暂停非 P0 数据源的定时调度：
   ```sh
   # 暂停非核心来源任务
   gcloud scheduler jobs pause melens-dev-ticketmaster-events-schedule --location australia-southeast1
   gcloud scheduler jobs pause melens-dev-homes-victoria-rents-schedule --location australia-southeast1
   ```
2. 终止任何正在执行的历史全量回补。
3. 执行 BigQuery 消耗分析 SQL，找出过去 24 小时的高消耗查询：
   ```sql
   SELECT
     user_email,
     job_id,
     DATE(creation_time) AS job_date,
     total_bytes_billed / 1024 / 1024 / 1024 AS billed_gb,
     query
   FROM `region-australia-southeast2`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
   WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
     AND job_type = 'QUERY'
   ORDER BY total_bytes_billed DESC
   LIMIT 10;
   ```

### 5.2 BigQuery 单次查询成本限制 (`maximumBytesBilled`)

为每个来源在 `schedules.json` 填写经审核的 `maximum_bytes_billed`。部署脚本将它设为 `BQ_MAXIMUM_BYTES_BILLED`；直接运行采集命令也必须显式提供此变量。发布器把该上限传给每个 BigQuery 查询作业，包括元数据读取和 DML；超出上限的查询由 BigQuery 拒绝。查询上限不覆盖 Load Job、Storage Write API 或存储费用。其他手工 SQL 和未来 Agent 查询也必须各自设置限额，不会自动继承采集器的环境变量。预算告警和人工停调度仍是独立门槛。

### 5.3 数据导入方式与配额防范 (Load Jobs vs Storage Write API)

BigQuery 对单个表每 24 小时内的 Load Job 调用次数存在硬性配额限制（默认单表每天上限 1,500 次）。因此 Melens 架构设计了严格的双通道写入机制：

```text
               ┌── 更新周期 <= 300 秒 ──> BigQuery Storage Write API (_default 流, 追加写入)
数据源写入流向 ──┤
               └── 更新周期 > 300 秒  ──> GCS staging ndJSON ──> BigQuery Load Job (melens_load_*)
```

1. **高频小批次数据源（更新周期 `<= 300` 秒，如路边停车传感器、分钟级行人流）**：
   - 限制表范围：`parking_observations`, `pedestrian_observations`, `source_records`, `geo_records`。
   - **必须使用 BigQuery Storage Write API** 直接写入（`cloud/data/src/core/bigquery-write.ts`）。
   - **写入语义**：采用 `_default` 流，提供**至少一次 (At-least-once)** 写入保证。查询视图通过稳定业务键（如 `sensor_id + observed_at`）进行去重。
   - **时间戳精度**：API 协议层强制要求微秒级整数（Microseconds since epoch），超过微秒精度的毫秒小数将被拒绝。
2. **低频/批次数据源（更新周期 `> 300` 秒、小时级、天级或静态来源）**：
   - 使用 GCS 临时 ndJSON 配合 BigQuery Load Job 批量导入（`cloud/data/src/core/bigquery-load.ts`）。
   - **稳定 Job ID**：生成格式为 `melens_load_${sha256(batchId + table + uri).slice(0, 48)}`，保证加载重试的严格幂等。
   - **重试退避**：遭遇 `rateLimitExceeded` 或 `jobRateLimitExceeded` 时采用指数退避重试，杜绝打满配额。

### 5.4 分区与聚簇规范与查询避坑指南

事实表创建时遵守分区和聚簇规范（参见 `cloud/data/sql/001_tables.sql`）：

| 表名 | 分区键 (Partition) | 聚簇键 (Clustering) |
| --- | --- | --- |
| `data_sources` | 无（元数据小表） | `source_id` |
| `sync_batches` | `PARTITION BY DATE(started_at)` | `source_id, batch_id` |
| `source_records` | `PARTITION BY DATE(fetched_at)` | `source_id, source_record_id, version_id` |
| `geo_records` | `PARTITION BY DATE(fetched_at)` | `source_id, geo_record_id, version_id` |
| `geo_record_sources` | `PARTITION BY DATE(fetched_at)` | `source_id, geo_record_id, source_record_id` |
| `boundaries` | `PARTITION BY DATE(fetched_at)` | `source_id, boundary_id, vintage` |
| `area_indicators` | `PARTITION BY DATE(fetched_at)` | `source_id, indicator_id, boundary_id` |
| `parking_bays` | `PARTITION BY DATE(fetched_at)` | `source_id, bay_id, marker_id` |
| `parking_observations`| `PARTITION BY DATE(fetched_at)` | `source_id, sensor_id, observed_at` |
| `parking_rules` | `PARTITION BY DATE(fetched_at)` | `source_id, rule_id, bay_id` |
| `sensor_locations` | `PARTITION BY DATE(fetched_at)` | `source_id, sensor_id, version_id` |
| `pedestrian_observations`| `PARTITION BY DATE(fetched_at)` | `source_id, sensor_id, observed_at` |

> [!WARNING]
> **关键查询避坑**：
> 所有 10 个事实表的分区键均为 **`DATE(fetched_at)`**，而非业务事件时间 `observed_at`！
> 如果编写查询时只写 `WHERE observed_at >= ...`，BigQuery **不会触发分区修剪 (Partition Pruning)**，从而引发全表扫描！
> 编写高效低成本查询时，**必须同时带有 `fetched_at` 过滤条件**，例如：
> ```sql
> WHERE fetched_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
>   AND observed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
> ```

### 5.5 数据源健康度与覆盖视图监控 (`008_health_views.sql`)

系统在 `melens_query` 数据集中发布了专门的健康检查与异常监测视图：

- **`v_source_health`**：
  - 计算依据：`budget_seconds = 2 * coalesce(cadence_seconds, check_interval_seconds)`。
  - 健康状态值：
    - `current`：最近一次成功同步在刷新预算内；
    - `late`：延迟超过刷新预算，但在 2 倍预算内；
    - `stale`：延迟超过 2 倍刷新预算；
    - `source_unavailable`：最近批次失败且距离上次成功已超过刷新预算；
    - `unknown`：数据源未通过准入、处于非激活状态、缺少检查证据或处于故障初期；
    - `healthy_versioned`：无固定刷新周期的版本化静态数据源。
- **`v_source_abnormal_delay`**：
  - 自动筛选当前处于 `late`, `stale`, `source_unavailable`, `unknown` 的异常数据源，作为日常巡检和告警的主表。
- **`v_source_coverage`**：
  - 明确区分查询空结果的真实含义：`covered`（有数据）、`no_matching_records`（该区域/时段确无事件）、`not_covered`（无数据源覆盖该区域）、`source_unavailable`（覆盖来源故障）、`unknown`（准入未通过或存在数据缺口）。

---

## 6. 失败批次隔离与入库门禁 (Failed Batch Isolation & Quality Gates)

### 6.1 批次生命周期流转状态机

```text
[Connector Collect] 
        │
        ├─> (ConnectorFailure) ──> [failed] (记录于 sync_batches, 停止发布)
        │
        ▼ (ConnectorSuccess)
   [running] (写入 sync_batches 状态表)
        │
        ├─> 上传 staging ndJSON / 调用 Storage Write API
        ├─> 加载进入 melens_ingest 事实表 (打上 batch_id)
        │
        ▼
   [validateLoadedRows] (执行 5 维度 SQL 严苛入库校验)
        │
        ├── 校验不通过 ──> [failed] (error_code: validation_failed, 停止发布)
        │
        ▼ 校验通过
   [validated]
        │
        ▼ 写入发布状态
   [published] (published_at 生效, 允许下游视图查询)
```

### 6.2 逻辑隔离与零泄露保证

Melens 采用**基于批次发布状态的只读视图隔离架构**：
1. 规范化事实数据（`source_records`, `geo_records`, `parking_observations` 等）在加载阶段即写入 `melens_ingest` 底层物理表，每行记录均打上唯一的 `batch_id`。
2. 下游应用和 Agent 仅被授予访问 `melens_query` 数据集的授权视图（`v_geo_records_current`, `v_geo_records_history`, `v_parking_current` 等）。
3. **核心视图隔离 SQL 逻辑**：
   ```sql
   WITH latest_batches AS (
     SELECT batch_id, source_id, state, published_at
     FROM `melens_ingest.sync_batches`
     QUALIFY ROW_NUMBER() OVER (
       PARTITION BY batch_id
       ORDER BY state_updated_at DESC, started_at DESC, batch_id DESC
     ) = 1
   ), published_batches AS (
     SELECT batch_id, source_id, published_at FROM latest_batches
     WHERE state = 'published' AND published_at IS NOT NULL
   )
   SELECT g.*
   FROM `melens_ingest.geo_records` AS g
   JOIN published_batches AS b
     ON g.batch_id = b.batch_id AND g.source_id = b.source_id
   ...
   ```
4. **隔离结论**：如果某个批次在采集、传输或校验过程中出错，其在 `sync_batches` 中的最终状态为 `failed`（或停留在未发布的 `running`）。下游视图通过 `INNER JOIN published_batches` 直接在数据库引擎层将未发布批次的全部行过滤，**实现 0 字节脏数据泄露**。

### 6.3 5 维度入库质量验证门禁 (`validateLoadedRows`)

在批次标记为 `published` 前，系统自动执行 5 维度 SQL 严苛校验（`cloud/data/src/core/publisher.ts`）：

1. **行数与主键完整性 (`distinct_count == expectedDistinct` & `unexpected == 0`)**：
   比对 BigQuery 中去重后的主键行数与内存中规划行数是否严格一致。存在重复主键或遗漏行直接阻断。
2. **字段值与地理拓扑合法性 (`invalid == 0`)**：
   - 必填主键与外键不得为空或纯空格；
   - 时序单调性：`valid_to >= valid_from`, `period_end >= period_start`, `first_accessible_at <= fetched_at`；
   - 地理空间校验：`SAFE.ST_GEOGFROMGEOJSON(geometry_geojson) IS NOT NULL`，质心经纬度处于合法范围（lat: -90..90, lon: -180..180），无多边形不得虚构质心；
   - 权限收敛门禁：`public_query_allowed = true` 时严禁 `rights_status = 'review_required'`；受限来源 (`restricted`) 的文本字段必须在 `allowed_fields` 白名单中；
   - 引用完整性：`geo_record_sources` 必须外键引用已存在的 `geo_records` 与 `source_records`；`geo_records` 必须至少拥有一条来源追溯链接。
3. **同版本内容冲突检查 (`conflicts == 0`)**：
   针对同一个实体 ID 与版本号，若在同一个批次或跨已发布批次中出现多份不同字段内容的变体（`COUNT(DISTINCT content) > 1`），直接阻断。
4. **版本更新时序单调性 (`ambiguous == 0`)**：
   同一个实体 ID 的多个版本必须具备明确递增的 `source_updated_at` 或递增的 `source_version_ordinal`。顺序模糊（未排序或无序号）直接阻断。
5. **数值与统计合法性**：
   行人流量与观测计数值不得为负数；区域指标仅 `observed` 状态允许包含非空数值，`suppressed` 与 `missing` 严禁补零。

### 6.4 失败批次排查与恢复指南

当收到批次失败告警时：
1. 查询最近失败批次列表及错误码：
   ```sql
   SELECT
     batch_id,
     source_id,
     error_code,
     input_count,
     rejected_count,
     started_at,
     state_updated_at
   FROM `melens_ingest.sync_batches`
   WHERE state = 'failed'
   ORDER BY state_updated_at DESC
   LIMIT 10;
   ```
2. **根据 `error_code` 针对性处置**：
   - `rate_limited`：上游触发频率配额。检查调度周期，适当放大 `cadence_seconds` 或在 HTTP 客户端中增加退避等待。
   - `schema_changed`：上游 API 变更字段名或数据结构。该批次自动被物理隔离。由连接器维护人修改代码中的映射逻辑，更新测试用例，经集成人复核后重新部署。
   - `validation_failed`：触发了 6.3 节的质量门禁。查看 Cloud Run 详细日志，找出冲突的主键或不合规的地理字段。
   - `auth_failed`：第三方凭据失效或过期。转入第 8 节凭据轮换流程。
   - `incomplete_window`：上游数据缺页或总量不匹配。确认上游网络恢复后重新触发采集。
3. **修复与重新发布**：
   修复问题后，直接重新执行对应时间窗口的采集命令。因为批次 ID 计算依赖内容散列或时间窗口，新任务会以幂等方式重新尝试并发布新批次。

---

## 7. 资料保留期限与许可撤销删除 (Retention & License Revocation)

### 7.1 资料分级与保留期定义

| 资料类型 | 存储位置 | 保留期限与策略 | 准入要求与用途 |
| --- | --- | --- | --- |
| **`staging` 临时加载数据** | `gs://${GCS_BUCKET}/staging/` | 正常发布后即时清理；异常残留按来源 `staging_retention_days` 到期，通常为 1 天 | 仅用于低频数据源 BigQuery Load Job 的临时 ndJSON 中转。`expiresAt` 元数据本身不会删除对象；开发项目已部署每小时清理任务。 |
| **`raw` 原始网络报文** | `gs://${GCS_BUCKET}/raw/` | 依许可而定（如 7 天 ~ 30 天，`raw_retention_days`） | **严格受控**：仅在来源许可明确允许时留存，且仅保留 `allowed_fields` 白名单字段。 |
| **规范化事实表** | BigQuery `melens_ingest.*` | 长期持久化（符合许可前提） | 规范化业务数据主存储，供只读授权视图查询。 |

- **元数据跟踪**：GCS 对象在保存时计算 `expiresAt = Date.now() + retentionDays * 86_400_000` 并作为自定义元数据写入 GCS 对象属性。

#### Staging 临时数据生命周期保证 (Staging Lifecycle Guarantees)
系统对 `staging/` 临时加载数据提供以下明确的生命周期分级保障：
1. **正常发布即时物理清理 (Primary Ephemeral Guarantee)**：
   - 批次校验通过并发布完成时，`BigQueryPublisher.finish()` 会**立即调用 `gcs.deleteStagingObjects(complete.staging_uris)` 物理删除**所有中转 ndJSON 文件。在正常作业流中，staging 文件的实际留存时间通常仅有数秒至数分钟。
2. **异常残留短效过期标定 (1-Day Metadata Retention)**：
   - 若作业在数据中转后、批次发布前因校验失败 (`validation_failed`)、网络超时或容器 OOM 中断，staging 文件会留存供排障追溯。
   - 写入时，`gcs.saveNdjson` 统一计算 `expiresAt = Date.now() + staging_retention_days * 86_400_000`（默认 1 天，即 24 小时）并写入 GCS 自定义元数据。
3. **程序化例行过期清理 (Programmatic Cleanup)**：
   - `src/jobs/cleanup-staging.ts` 调用 `gcs.cleanupExpired('staging')`；`infra/deploy-staging-cleanup.sh` 已在开发项目独立部署每小时执行的 Cloud Run Job 和 Cloud Scheduler。2026-09-30 手动执行删除了到期测试对象、保留未到期对照对象；随后 05:17–11:17 UTC 七次由 Scheduler 创建的执行均成功。到期对象以 generation 限定物理删除；缺少有效 `expiresAt` 的旧 staging 对象按创建后 24 小时清理。每次扫描最多 1,000 个对象，超限会使作业失败，需调查积压并扩容或人工处理。作业失败期间须人工检查残留。每小时执行意味着正常情况下到期后仍可能保留约 1 小时。
4. **许可撤销全量擦除 (Revocation Purge)**：
   - 触发来源停用或许可撤销 (`pauseSource`) 时，`gcs.purgeSourceCopies(source_id)` 会立即物理遍历删除该数据源在 `staging/<source_id>/` 下的全部残留对象。

### 7.2 例行过期资料自动清理与基础设施策略对齐

#### 程序化内置清理机制（开发项目已单独部署 `staging/` 调度）：
运维可调用核心清理逻辑清理已过期的 GCS 对象（`cloud/data/src/core/gcs.ts`）：
```typescript
// 定期清理 raw 和 staging 桶中已过期的文件（依据对象元数据 expiresAt <= now 判定）
await gcs.cleanupExpired('staging');
await gcs.cleanupExpired('raw');
```

#### 云端存储桶生命周期规则对齐说明（可选基础设施兜底，非代码内置保证）：
> [!WARNING]
> **生命周期规则周期对齐与澄清**：
> 1. **代码与基础设施区分**：`cloud/data/infra/bootstrap.sh` 脚本仅负责创建 GCS 存储桶与基础权限，**默认未配置** GCS Bucket 级别的 Lifecycle Management Rules。存储桶生命周期属于可选的基础设施层安全兜底，**不可将其视为系统代码已默认启用的内置保障**。
> 2. **Staging 生命周期兜底须检查来源期限**：若运维额外配置 GCS Bucket Lifecycle Rule，`staging/` 前缀的统一 `Age` 必须兼顾当前最长的来源保留期限；当前部分来源为 7 天。GCS 生命周期规则按对象创建时间生效，不能读取 `expiresAt` 自定义元数据，亦不能替代每小时清理任务对 1 天来源的期限执行。不要配置 30 天 staging 规则。
> 3. **30 天周期的正确用途**：`Age: 30 days` 生命周期仅适用于部分需要保留 30 天原始备份的 `raw/` 报文归档目录（需来源许可明确支持），不得与 `staging/` 临时中转混淆。

### 7.3 许可撤销与授权收紧响应 SOP (License Revocation)

当上游数据源变更条款、撤销数据再利用许可或要求删除已存储副本时，必须在 24 小时内完成两步硬性阻断与物理销毁：

#### 步骤一：原子化停用与全表数据擦除 (`BigQueryPublisher.pauseSource`)
调用平台内置的 `pauseSource(source)` 方法：
```typescript
const result = await publisher.pauseSource(source);
console.log(`Deleted GCS copies: ${result.deletedCopies}`);
```
`pauseSource` 内部在持有来源租约锁的保护下，原子化执行以下四项操作：
1. 更新 `data_sources` 元数据表：将 `access_status` 设为 `paused`，`license_status` 设为 `review_required`；
2. **物理删除事实表数据**：从全部 10 个物理事实表（`source_records`, `geo_records`, `geo_record_sources`, `boundaries`, `area_indicators`, `parking_bays`, `parking_observations`, `parking_rules`, `sensor_locations`, `pedestrian_observations`）中删除所有属于该 `source_id` 的记录：
   ```sql
   DELETE FROM `melens_ingest.<table_name>` WHERE source_id = @sourceId;
   ```
3. 清除 `sync_batches` 历史审计行中的原始文件引用：
   ```sql
   UPDATE `melens_ingest.sync_batches` SET raw_uri = NULL, staging_uris = [] WHERE source_id = @sourceId;
   ```
4. **物理销毁 GCS 存储副本**：调用 `gcs.purgeSourceCopies(source_id)`，物理遍历并删除存储桶中 `raw/<source_id>/` 与 `staging/<source_id>/` 下的全部历史对象。

#### 步骤二：验证下线效果
1. 验证授权视图不再暴露该数据源（核心视图均包含 `s.access_status = 'active' AND s.license_status IN ('verified_open', 'restricted')` 约束）：
   ```sql
   SELECT COUNT(*) FROM `melens_query.v_geo_records_current` WHERE source_id = 'TARGET_SOURCE_ID';
   -- 预期结果：0
   ```
2. 验证 GCS 存储桶中已无残留对象：
   ```sh
   gcloud storage ls gs://${GCS_BUCKET}/raw/TARGET_SOURCE_ID/
   gcloud storage ls gs://${GCS_BUCKET}/staging/TARGET_SOURCE_ID/
   # 预期结果：CommandException: One or more URLs matched no objects.
   ```

---

## 8. 密钥安全与撤销/停调度/撤权/轮换 SOP (Secret Security & Incident Response)

第三方 API Key（如 Transport Victoria、Ticketmaster）属于高敏感凭据，必须实施严格的生命周期管控。

> [!CAUTION]
> **绝对安全红线 (CRITICAL SECURITY)**：
> 第三方 API 密钥的值必须由**项目拥有者 (Project Owner)** 在 GCP Console 的 Secret Manager 页面直接录入！
> **绝对严禁在任何 Shell 命令示例、Bash 脚本参数、文档、代码提交、Git 历史或 AI 聊天对话中输出或传递任何明文密钥值！**

### 8.1 零明文架构与最小权限模型

1. **禁止明文凭据**：源码、配置文件（`source.json`）、Git 提交记录、Docker 镜像、环境变量及 GCS 报文中绝对不得出现明文 Key。
2. **Secret 命名引用**：所有配置文件与环境变量中仅允许配置 Secret Manager 的**简单 Secret ID 标识符**（例：`tv-api-key`、`melens-transport-vic-key`），必须匹配正则 `^[A-Za-z0-9_-]{1,255}$`。**严禁**使用 `projects/.../secrets/...` 等包含斜杠的完整资源路径字符串（会导致校验失败），**绝对严禁**写入任何密钥值。
3. **权限隔离原则**：
   - 项目级服务账号**严禁**被赋予全局 `roles/secretmanager.secretAccessor`。
   - 权限仅在部署时按单个 Secret 精准授予需要读取该密钥的特定 Ingest 服务账号（`melens-${environment}-ingest@PROJECT_ID.iam.gserviceaccount.com`）。

### 8.2 密钥撤销、失效或疑似泄露应急处置 5 步流程 (Emergency SOP)

当收到第三方服务商通知密钥失效、疑似泄露，或在系统日志中发现未授权调用异常时，按以下 5 步紧急处置：

```text
[1. 停调度] ──> [2. 撤销 IAM 权限] ──> [3. 轮换 Secret 版本] ──> [4. 安全审计排查] ──> [5. 重新授权与恢复]
```

#### 步骤 1：立即停止定时调度 (Stop Schedule)
第一时间禁用 Cloud Scheduler 中的触发任务，防止异常持续发生或向上游发起未授权请求：
```sh
gcloud scheduler jobs pause melens-prod-<source-name>-schedule \
  --location australia-southeast1 \
  --project PROJECT_ID
```

#### 步骤 2：立即撤销 Service Account 的 IAM 访问权限 (Revoke Access)
从该任务使用的服务账号上移除对该 Secret 的读取角色绑定（`<SECRET_ID>` 为简单密钥标识符，如 `tv-api-key`）：
```sh
gcloud secrets remove-iam-policy-binding <SECRET_ID> \
  --member="serviceAccount:melens-prod-ingest@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project PROJECT_ID
```

#### 步骤 3：密钥轮换与版本销毁 (Rotate Secret)
1. 项目拥有者登录第三方开发者门户（如 Transport Victoria 开放平台），撤销被泄露的旧 Key，生成全新的 API Key。
2. **安全录入**：项目拥有者登录 Google Cloud Console，进入 **Secret Manager**，找到 `<SECRET_ID>`（如 `tv-api-key`），点击 **添加新版本 (Add New Version)**，在控制台安全输入框中粘贴新密钥并保存。**切勿通过命令行参数传递新密钥！**
3. 彻底销毁旧版本 Secret，使其永久不可用：
   ```sh
   gcloud secrets versions destroy <OLD_VERSION_NUMBER> \
     --secret=<SECRET_ID> \
     --project PROJECT_ID \
     --quiet
   ```

#### 步骤 4：日志与重试队列安全排查 (Security & Leak Audit)
审查是否存在凭据被误打入日志或持久化存储的情况：
1. **排查 Cloud Logging**：检索是否有 HTTP 请求库在报错时打印了包含凭据的完整 URL 或请求头：
   ```sh
   gcloud logging read 'resource.type="cloud_run_job" AND (textPayload=~"token=" OR textPayload=~"key=" OR textPayload=~"Authorization")' \
     --limit 50 \
     --project PROJECT_ID
   ```
2. **排查 GCS 存储**：检查失败批次留存的 `staging/` 或 `raw/` ndjson 文件，确认未包含敏感 Authorization 报文头。
3. **若确认发生泄露**：立即对相关日志做数据清洗或日志桶保留策略调整，并将新生成的 Key 再次重新生成轮换。

#### 步骤 5：重新授权、单次验证与恢复调度 (Re-grant, Verify & Resume)
1. 为 Ingest 任务服务账号重新绑定新 Secret 的访问权限：
   ```sh
   gcloud secrets add-iam-policy-binding <SECRET_ID> \
     --member="serviceAccount:melens-prod-ingest@PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor" \
     --project PROJECT_ID
   ```
2. 手动单次触发 Cloud Run Job，验证新 Key 是否鉴权成功且能正常同步：
   ```sh
   gcloud run jobs execute melens-prod-<source-name> \
     --location australia-southeast2 \
     --wait \
     --project PROJECT_ID
   ```
3. 验证通过后，在 Cloud Scheduler 中恢复自动调度：
   ```sh
   gcloud scheduler jobs resume melens-prod-<source-name>-schedule \
     --location australia-southeast1 \
     --project PROJECT_ID
   ```
4. 在运维日志中记录本次凭据轮换事件、原因、受影响范围及验证结果。

---

## 9. 附录：基础设施初始化命令速查 (Infra Quick Reference)

由项目集成人员在专用 GCP 项目中执行 `cloud/data/infra/bootstrap.sh`：

```sh
# 1. 计划预览 (Plan only，不修改任何云端资源)
./cloud/data/infra/bootstrap.sh \
  --project PROJECT_ID \
  --bucket GLOBALLY_UNIQUE_BUCKET \
  --environment dev

# 2. 执行初始化 (需要显式传入 --apply 与 --confirm-project)
./cloud/data/infra/bootstrap.sh \
  --project PROJECT_ID \
  --bucket GLOBALLY_UNIQUE_BUCKET \
  --environment dev \
  --apply --confirm-project PROJECT_ID
```

初始化脚本将幂等完成：
- 启用必需 API（Cloud Run, Cloud Scheduler, Cloud Storage, BigQuery, BigQuery Storage Write API, Secret Manager, Artifact Registry, IAM Credentials, IAM）；
- 创建区域 GCS Bucket（开启统一存储桶级别访问与公共访问阻止）；
- 创建 `melens_ingest` 与 `melens_query` BigQuery 区域数据集；
- 创建最小权限 Service Accounts：`melens-${env}-ingest`, `melens-${env}-query`, `melens-${env}-scheduler` 并授予基础角色。
