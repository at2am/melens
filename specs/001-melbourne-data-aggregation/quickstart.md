# Quickstart: 验证数据获取链路

此文档是数据链路的验证步骤。`cloud/data/` 已有本地采集与发布程序，但候选来源仍需逐项完成许可、配额和运行准入；本地读取公开样本不等于云端已发布或首期指标已通过。

## 1. Prerequisites

- 本地：Node.js 24 LTS、npm、Google Cloud CLI，以及项目实施后的 `cloud/data/` 包。当前工作机可见 Node 26，实施时应切换到锁定的 Node 24。
- GCP：由用户拥有且已关联 billing 的项目；Cloud Run、BigQuery 和存储桶使用 `australia-southeast2`，Cloud Scheduler 使用 `australia-southeast1`；从首批采集起启用 Cloud Run、Cloud Scheduler、Cloud Storage、BigQuery、BigQuery Storage Write API、Secret Manager、Artifact Registry 和 IAM Credentials API。
- 外部来源：公开 City of Melbourne／GDELT／ABS／CSA 可先做匿名验证；Transport Victoria 的 KeyID 和 Ticketmaster 的 developer key 在接入相应来源前由用户取得。
- **只需向助手提供非秘密信息**：GCP project ID、确认的区域、希望部署的资源命名，以及已开通的外部来源。不要在聊天中提供密码、API key、token 或 service account JSON。

## 2. Safe access setup

1. 用户本人在本机安装 Google Cloud CLI，并按[官方 ADC 指南](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)通过浏览器登录。推荐创建权限受限的采集 service account，按[官方模拟服务账号方法](https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation)配置本地 ADC；不要下载长期 JSON 私钥。验证只查看项目 ID，不打印 access token。
2. 云端 Cloud Run Job 绑定专用[服务身份](https://docs.cloud.google.com/run/docs/securing/service-identity)，向所需 GCS 位置赋予最小读／写权限；在 `melens_ingest` 数据集授予写入／校验所需权限，并授予创建查询与 load job 所需的项目级 BigQuery Job User 权限。开发、生产使用不同身份和数据集。Cloud Scheduler 的身份只可触发指定任务。
3. 用户通过 GCP Console 将 Transport Victoria、Ticketmaster 等第三方 key 直接放入 [Secret Manager](https://docs.cloud.google.com/secret-manager/docs/best-practices)，按**单个 secret**给对应任务身份授予访问权。仓库只保存 secret 名称，不保存其值；不要把 key 放进命令参数或 `.env`。
4. **可见性边界**：同一 OS 用户下的本地 ADC 可被运行该用户命令的助手访问，能部署含密钥读取逻辑的代码也可能间接访问云端 key。因此“助手可使用 GCP 但技术上完全看不到凭据／数据”不能由文件夹位置保证。若必须严格隔离，由用户控制最终部署和密钥权限、审查待部署代码；助手只获得非秘密项目配置和读公开数据能力。

用户已初始化本机 GCP CLI；当前执行环境尚未找到 `gcloud`、`bq` 或本地 ADC，因此这里没有运行云端建表、部署和端到端查询。CLI 登录也不等于 Node.js 本地程序已具备 ADC；需要运行云端采集时，应使用受限身份配置 ADC。

用户自行在终端执行的示意命令（替换占位符；**不要把命令输出中的凭据发给助手**）：

```sh
gcloud auth login
gcloud config set project PROJECT_ID
gcloud auth application-default login --impersonate-service-account=DEV_INGEST_SA@PROJECT_ID.iam.gserviceaccount.com
```

| 身份 | 最小权限方向 | 不需要 |
| --- | --- | --- |
| 本地开发身份 | 模拟指定开发 service account；只读所需公开数据对象，写入开发存储区与 BigQuery 开发数据集，可创建受限查询作业 | 项目 Owner、生产 Secret Accessor、长期私钥 |
| 云端采集任务身份 | 指定存储区的必要读／写、`melens_ingest` 表写入与 SQL 校验、BigQuery 作业创建及特定第三方 secret 读取 | 其他项目数据、全部 secrets |
| 调度身份 | 仅可触发指定 Cloud Run Job | 直接读取数据或密钥 |
| 后续查询身份 | 仅能读已批准的 BigQuery 视图及执行受限查询 | 修改采集数据、读取原始受限内容 |

## 3. Local validation after implementation

以下命令使用当前 [connector contract](contracts/connector.md) 的接口，从仓库根目录执行。`ingest` 只会运行已通过准入且标为 `active` 的来源；候选来源会被拒绝：

```sh
npm --prefix cloud/data ci
npm --prefix cloud/data test
npm --prefix cloud/data run build
npm --prefix cloud/data run probe -- --source melbourne.municipal_boundary --revision latest
BQ_MAXIMUM_BYTES_BILLED=100000000 npm --prefix cloud/data run ingest -- --source melbourne.pedestrian.minute --from 2026-09-28T00:00:00Z --to 2026-09-28T01:00:00Z --initial-cursor 2026-09-28T00:00:00Z
BQ_MAXIMUM_BYTES_BILLED=100000000 npm --prefix cloud/data run verify -- --source melbourne.pedestrian.minute --batch BATCH_ID
```

`probe` 只读取不需要第三方密钥的公开来源，输出完整性与各表行数，不触碰 GCP；示例中的 `100000000` 是演示用单次 BigQuery 查询字节上限，正式运行需替换为审核后的数值。`ingest` 需要来源通过准入、GCP ADC 和已建表，且最近一小时行人 feed 不能回补已过期的示例时段，实际运行时须换成当前窗口。来源没有 `coverage_from` 且尚无 checkpoint 时，首次时间窗采集须提供 `--initial-cursor`，明确从哪一刻开始承诺连续覆盖；之后不可重设。较晚窗口先成功时，checkpoint 会等待较早缺口补齐。

实施后也直接用 BigQuery 验证已发布视图（在示例中替换非秘密的 `PROJECT_ID`）：

```sh
bq --location=australia-southeast2 query --maximum_bytes_billed=100000000 --use_legacy_sql=false 'SELECT COUNT(*) AS current_geo_records FROM `PROJECT_ID.melens_query.v_geo_records_current`'
bq --location=australia-southeast2 query --maximum_bytes_billed=100000000 --use_legacy_sql=false 'SELECT record_status, COUNT(*) AS versions FROM `PROJECT_ID.melens_query.v_geo_records_history` GROUP BY record_status'
bq --location=australia-southeast2 query --maximum_bytes_billed=100000000 --use_legacy_sql=false 'SELECT source_id, topic, license_status FROM `PROJECT_ID.melens_query.v_source_coverage` LIMIT 20'
```

预期：公开样本可采集，`verify` 从 BigQuery 返回已发布批次、来源时间、记录数量和可定位数量；重复运行同一窗口后逻辑记录数不变。断开来源后，上一批仍可查，但健康状态显示错误和过期。GCS 有 manifest 对象，许可允许时有 raw 与短期 staging 对象；BigQuery 已建立规范化表及只读视图，失败批次的行不出现在视图中。

## 4. End-to-end scenarios

| 场景 | 输入／操作 | 预期结果 |
| --- | --- | --- |
| 行人数据 | 最近一小时分钟读数＋传感器位置；重放同一窗口 | 可按传感器定位；重复记录合并；缺分钟不补零 |
| 路边停车 | 传感器＋车位空间＋单车位限制 | 分别报告占用和规则；规则缺失时 `may_park_now = unknown` |
| 新闻定位 | Melbourne, VIC、Melbourne, FL、多地点报道与重复 URL 样本 | 仅可靠维州事件获得对应地理范围；含糊样本未定位；重复报道保留多来源 |
| 犯罪资讯 | GDELT 犯罪报道样本＋CSA 统计 | 报道与区域统计分开；无足够本地报道时 FR-002 犯罪资讯验收不通过 |
| 活动与道路 | 已取消活动、已解除事故、未来计划事件 | 当前视图更新状态，保留旧版本；计划不算当前事故 |
| 历史状态查询 | 取消、解除和撤稿的已发布样本 | 可按状态在许可允许的历史视图中检索；当前视图不把它们当作正在发生 |
| 区域指标 | ABS、CSA 两个不同边界／年份样本 | 地域代码、统计期及版本显示；抑制值不转成零 |
| 故障与重放 | 抓取过程中某页失败，重试并恢复 | 失败批次不推进 checkpoint；成功重试只发布一个当前批次 |
| 来源与许可 | 条款待核实的警方网页样本 | 不存储或发布未获许可的全文；只保留允许的来源链接与审查状态 |
| 查询空结果 | 健康来源无匹配、未覆盖地区、来源抓取失败 | 按 [quality-rules.md](quality-rules.md#4-时间新鲜度与查询空结果) 分别返回 `no_matching_records`、`not_covered`、`source_unavailable` |

达到 [spec.md](spec.md) 中 SC-001 至 SC-006 的数量、来源追溯、新鲜度与定位指标，并按 [quality-rules.md](quality-rules.md) 的八类最低样本、分层抽样与空结果规则，通过 BigQuery SQL 批次校验和当前/历史只读视图查询后，才把首期采集链路标为完成。SC-002 对每个持续监测的动态来源记录连续 24 小时的上游唯一新/变更记录分母、首次可访问时间及截止前可查询分子；更新不定期来源按预设检查间隔计算，不足 20 条样本报告为“样本不足”。季度/年度和版本化批次单独检查每次发布后的同步结果。项目 UC-04/UC-05 的产品 P0 端到端验收由其用例负责；Agent SQL 的生成、负载、成本与安全验证安排在后续阶段。
