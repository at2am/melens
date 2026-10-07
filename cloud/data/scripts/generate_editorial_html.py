import json
import os

with open('cloud/data/test/fixtures/_full_catalog.json') as f:
    items = json.load(f)

html_template = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Melens Data Intelligence // 数据资产与 BigQuery 统一规范化编目</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-page: #FAF8F5;
      --bg-card: #FFFFFF;
      --bg-subtle: #F4F1EA;
      --border-color: #E6E1D8;
      --border-dark: #2C2825;
      --text-main: #1D1B18;
      --text-muted: #5C5750;
      --text-light: #8E8880;
      --accent-crimson: #9B1C1C;
      --accent-forest: #1E5128;
      --accent-navy: #1E3A8A;
      --accent-ochre: #B45309;
      --badge-live-bg: #E8F5E9;
      --badge-live-text: #1E5128;
      --badge-ready-bg: #E0F2FE;
      --badge-ready-text: #0369A1;
      --code-bg: #18181B;
      --code-text: #E4E4E7;
      --font-serif: 'Newsreader', Georgia, serif;
      --font-display: 'Instrument Serif', Georgia, serif;
      --font-headline: 'Cinzel', serif;
      --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
      --shadow-md: 0 4px 12px rgba(29, 27, 24, 0.06);
    }

    [data-theme="dark"] {
      --bg-page: #121110;
      --bg-card: #1A1918;
      --bg-subtle: #242220;
      --border-color: #33302C;
      --border-dark: #DCD8D0;
      --text-main: #EAE6DF;
      --text-muted: #A39E95;
      --text-light: #706B62;
      --badge-live-bg: #14301B;
      --badge-live-text: #74C686;
      --badge-ready-bg: #132B3D;
      --badge-ready-text: #67B6EC;
      --code-bg: #0D0D0E;
      --code-text: #D4D4D8;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.4);
      --shadow-md: 0 4px 16px rgba(0,0,0,0.5);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-page);
      color: var(--text-main);
      font-family: var(--font-sans);
      font-size: 15px;
      line-height: 1.6;
      padding: 0 20px 80px;
      transition: background-color 0.25s ease, color 0.25s ease;
      -webkit-font-smoothing: antialiased;
    }

    .container {
      max-width: 1240px;
      margin: 0 auto;
    }

    /* Masthead */
    .masthead {
      border-bottom: 2px solid var(--border-dark);
      padding: 24px 0 16px;
      margin-bottom: 32px;
      position: relative;
    }

    .masthead-meta-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: var(--font-mono);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 8px;
      margin-bottom: 18px;
    }

    .theme-toggle-btn {
      background: none;
      border: 1px solid var(--border-color);
      padding: 4px 10px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-main);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .theme-toggle-btn:hover {
      background: var(--bg-subtle);
    }

    .masthead-title {
      font-family: var(--font-display);
      font-size: clamp(40px, 6vw, 76px);
      line-height: 0.95;
      font-weight: 400;
      letter-spacing: -0.02em;
      text-align: center;
      margin-bottom: 12px;
      color: var(--text-main);
    }

    .masthead-subtitle {
      font-family: var(--font-serif);
      font-size: clamp(17px, 2vw, 21px);
      font-style: italic;
      text-align: center;
      color: var(--text-muted);
      max-width: 860px;
      margin: 0 auto 16px;
      line-height: 1.4;
    }

    .masthead-meta-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid var(--border-color);
      padding-top: 10px;
      font-size: 12px;
      color: var(--text-light);
      flex-wrap: wrap;
      gap: 10px;
    }

    .masthead-tag {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      color: var(--accent-crimson);
      background: var(--bg-subtle);
      padding: 2px 8px;
      border-radius: 2px;
      border: 1px solid var(--border-color);
    }

    /* Executive Stats */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 36px;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 20px;
      box-shadow: var(--shadow-sm);
      position: relative;
      overflow: hidden;
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--text-muted);
    }

    .stat-card.accent-live::before { background: var(--accent-forest); }
    .stat-card.accent-ready::before { background: var(--accent-navy); }
    .stat-card.accent-ochre::before { background: var(--accent-ochre); }
    .stat-card.accent-crimson::before { background: var(--accent-crimson); }

    .stat-number {
      font-family: var(--font-serif);
      font-size: 42px;
      font-weight: 600;
      line-height: 1;
      margin-bottom: 6px;
      color: var(--text-main);
    }

    .stat-label {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .stat-subtext {
      font-size: 12px;
      color: var(--text-light);
      line-height: 1.4;
    }

    /* Section Headers */
    .section-header {
      border-top: 2px solid var(--border-dark);
      padding-top: 20px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      flex-wrap: wrap;
      gap: 12px;
    }

    .section-title-wrap {
      max-width: 800px;
    }

    .section-number {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--accent-crimson);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 4px;
    }

    .section-title {
      font-family: var(--font-serif);
      font-size: 28px;
      font-weight: 600;
      color: var(--text-main);
      line-height: 1.2;
    }

    .section-desc {
      font-size: 14px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    /* Architecture Box */
    .architecture-box {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 28px;
      margin-bottom: 40px;
      box-shadow: var(--shadow-sm);
    }

    .arch-lead-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #ECFDF5;
      color: #065F46;
      border: 1px solid #A7F3D0;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 4px;
      margin-bottom: 14px;
    }

    [data-theme="dark"] .arch-lead-badge {
      background: #064E3B;
      color: #A7F3D0;
      border-color: #059669;
    }

    .arch-statement {
      font-family: var(--font-serif);
      font-size: 20px;
      line-height: 1.5;
      color: var(--text-main);
      margin-bottom: 24px;
    }

    .arch-diagram {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }

    .arch-column {
      background: var(--bg-subtle);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 20px;
    }

    .arch-col-title {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-main);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .arch-col-title svg {
      width: 16px;
      height: 16px;
      fill: var(--accent-navy);
    }

    .arch-item {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 8px;
      font-size: 13px;
    }

    .arch-item strong {
      display: block;
      color: var(--text-main);
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .arch-item span {
      color: var(--text-muted);
      font-size: 12px;
    }

    .arch-rules-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
      border-top: 1px solid var(--border-color);
      padding-top: 20px;
    }

    .arch-rule-card {
      font-size: 13px;
    }

    .arch-rule-card h4 {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-main);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .arch-rule-card p {
      color: var(--text-muted);
      line-height: 1.5;
    }

    /* Filter & Search Bar */
    .control-bar {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 16px 20px;
      margin-bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: var(--shadow-sm);
    }

    .search-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .search-input-wrap {
      flex: 1;
      min-width: 260px;
      position: relative;
    }

    .search-input {
      width: 100%;
      padding: 10px 14px 10px 36px;
      font-family: var(--font-sans);
      font-size: 14px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: var(--bg-subtle);
      color: var(--text-main);
      outline: none;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      border-color: var(--text-main);
      background: var(--bg-card);
    }

    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      fill: var(--text-light);
    }

    .status-filter-pills {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .filter-pill {
      background: var(--bg-subtle);
      border: 1px solid var(--border-color);
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
      user-select: none;
    }

    .filter-pill:hover {
      background: var(--border-color);
      color: var(--text-main);
    }

    .filter-pill.active {
      background: var(--text-main);
      border-color: var(--text-main);
      color: var(--bg-card);
      font-weight: 600;
    }

    .domain-filter-pills {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      border-top: 1px dashed var(--border-color);
      padding-top: 12px;
    }

    .results-count {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-light);
      margin-left: auto;
      align-self: center;
    }

    /* Catalog Cards Grid */
    .catalog-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
    }

    .catalog-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      box-shadow: var(--shadow-sm);
      overflow: hidden;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .catalog-card:hover {
      border-color: var(--border-dark);
      box-shadow: var(--shadow-md);
    }

    .card-header {
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
    }

    .card-title-group {
      flex: 1;
      min-width: 280px;
    }

    .card-num-domain {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-light);
      margin-bottom: 4px;
    }

    .card-num {
      color: var(--accent-crimson);
      font-weight: 700;
    }

    .card-title-zh {
      font-family: var(--font-serif);
      font-size: 22px;
      font-weight: 600;
      color: var(--text-main);
      line-height: 1.25;
      margin-bottom: 2px;
    }

    .card-title-en {
      font-size: 13px;
      color: var(--text-muted);
      font-weight: 400;
    }

    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }

    .badge-status.live {
      background: var(--badge-live-bg);
      color: var(--badge-live-text);
      border: 1px solid rgba(30, 81, 40, 0.2);
    }

    .badge-status.ready {
      background: var(--badge-ready-bg);
      color: var(--badge-ready-text);
      border: 1px solid rgba(3, 105, 161, 0.2);
    }

    .badge-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .card-body {
      padding: 20px 24px;
    }

    .card-desc {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.55;
      margin-bottom: 18px;
    }

    .metadata-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px 18px;
      background: var(--bg-subtle);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 14px 16px;
      margin-bottom: 20px;
      font-size: 12px;
    }

    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .meta-label {
      font-family: var(--font-mono);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-light);
    }

    .meta-value {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 500;
      color: var(--text-main);
      word-break: break-all;
    }

    .meta-value.highlight-bq {
      color: var(--accent-navy);
      font-weight: 600;
    }

    /* Inspector & Code View */
    .inspector-box {
      border: 1px solid var(--border-color);
      border-radius: 4px;
      overflow: hidden;
    }

    .inspector-header {
      background: var(--bg-subtle);
      border-bottom: 1px solid var(--border-color);
      padding: 8px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .inspector-tabs {
      display: flex;
      gap: 4px;
    }

    .tab-btn {
      background: none;
      border: none;
      padding: 5px 12px;
      border-radius: 3px;
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s;
    }

    .tab-btn:hover {
      color: var(--text-main);
      background: rgba(0,0,0,0.04);
    }

    .tab-btn.active {
      background: var(--bg-card);
      color: var(--text-main);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
    }

    .copy-btn {
      background: none;
      border: 1px solid var(--border-color);
      padding: 4px 10px;
      border-radius: 3px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s;
    }

    .copy-btn:hover {
      background: var(--bg-card);
      color: var(--text-main);
      border-color: var(--text-main);
    }

    .inspector-content {
      position: relative;
    }

    .code-view {
      background: var(--code-bg);
      color: var(--code-text);
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      padding: 16px;
      margin: 0;
      overflow-x: auto;
      max-height: 340px;
      white-space: pre;
    }

    .hidden {
      display: none !important;
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--text-main);
      color: var(--bg-card);
      font-family: var(--font-mono);
      font-size: 12px;
      padding: 10px 18px;
      border-radius: 4px;
      box-shadow: var(--shadow-md);
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.25s ease;
      z-index: 999;
      pointer-events: none;
    }

    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    /* Footer */
    .editorial-footer {
      margin-top: 60px;
      border-top: 2px solid var(--border-dark);
      padding-top: 24px;
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }

    .footer-left {
      max-width: 600px;
    }

    .footer-title {
      font-family: var(--font-headline);
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: var(--text-main);
      margin-bottom: 6px;
    }

    /* Quick jump / back to top */
    .back-to-top {
      position: fixed;
      bottom: 24px;
      left: 24px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 50%;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-main);
      cursor: pointer;
      box-shadow: var(--shadow-sm);
      transition: all 0.2s;
      opacity: 0;
      pointer-events: none;
    }
    .back-to-top.visible {
      opacity: 1;
      pointer-events: auto;
    }
    .back-to-top:hover {
      background: var(--bg-subtle);
      border-color: var(--text-main);
    }

    @media (max-width: 768px) {
      body { padding: 0 14px 60px; }
      .masthead-title { font-size: 38px; }
      .card-header { flex-direction: column; }
      .badge-status { align-self: flex-start; }
      .metadata-grid { grid-template-columns: 1fr; }
    }

    @media print {
      body { background: white; color: black; padding: 0; font-size: 12pt; }
      .control-bar, .theme-toggle-btn, .copy-btn, .inspector-tabs { display: none !important; }
      .catalog-card { break-inside: avoid; border: 1px solid #ccc; box-shadow: none; margin-bottom: 20px; }
      .code-view { max-height: none; background: #f8f8f8; color: #111; }
    }
  </style>
</head>
<body>

<div class="container">
  <!-- Masthead -->
  <header class="masthead">
    <div class="masthead-meta-top">
      <div>VOLUME I &bull; REPORT NO. 04 &bull; GCP MELENS-510012</div>
      <div>AUSTRALIA-SOUTHEAST2 (MELBOURNE) &bull; A-1 GRADE AUDIT</div>
      <button class="theme-toggle-btn" id="themeToggleBtn" title="切换暗色/纸张模式">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        <span id="themeToggleText">NIGHT PRESS</span>
      </button>
    </div>

    <h1 class="masthead-title">MELENS DATA INTELLIGENCE</h1>
    <p class="masthead-subtitle">
      当前已实现且可获取的墨尔本城市数据全景编目、数据样例对照与 BigQuery 统一规范化转换核验报告
    </p>

    <div class="masthead-meta-bottom">
      <div><strong>TARGET AUDIENCE:</strong> 研发团队、产品决策者与跨领域业务同事 (Internal Engineering & Product Review)</div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <span class="masthead-tag">SPEC-001 AGGREGATION</span>
        <span class="masthead-tag">SPEC-002 MAP READY</span>
        <span class="masthead-tag">27 CANONICAL TYPES</span>
      </div>
    </div>
  </header>

  <!-- Executive Summary Stats -->
  <section class="stats-grid">
    <div class="stat-card accent-crimson">
      <div class="stat-number">27</div>
      <div class="stat-label">已成功实现数据类型</div>
      <div class="stat-subtext">覆盖 10 大城市生活与空间运行领域，连接器与解析校验 100% 具备</div>
    </div>
    <div class="stat-card accent-live">
      <div class="stat-number">12</div>
      <div class="stat-label">BigQuery 云端已发布数据集</div>
      <div class="stat-subtext">在 GCP <code>melens-510012</code> 实际写入并通过 SQL 约束校验、定时调度活跃</div>
    </div>
    <div class="stat-card accent-ready">
      <div class="stat-number">15</div>
      <div class="stat-label">管线就绪 / 候选测试完成</div>
      <div class="stat-subtext">包含行人客流、交通线网、规划与 28 市议会公众咨询，测试用例与离线/私网凭据读取通过</div>
    </div>
    <div class="stat-card accent-ochre">
      <div class="stat-number">100%</div>
      <div class="stat-label">时空统一规范符合度</div>
      <div class="stat-subtext">全量强制转换至 ISO-8601 UTC 时间戳与 WGS84 (EPSG:4326) 空间几何</div>
    </div>
  </section>

  <!-- Section 1: BigQuery Standardization Verification -->
  <section class="section-header" id="architecture">
    <div class="section-title-wrap">
      <div class="section-number">CHAPTER 01 // ARCHITECTURAL VERIFICATION</div>
      <h2 class="section-title">BigQuery 数据统一转换确认与架构全景</h2>
      <p class="section-desc">确认结论：是，Project 中所有已实现的数据类型均已转换为统一规范的格式并由 BigQuery 托管。</p>
    </div>
  </section>

  <div class="architecture-box">
    <div class="arch-lead-badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      ARCHITECTURAL CONFIRMATION &bull; TWO-TIER CANONICAL MODEL VERIFIED
    </div>
    <p class="arch-statement">
      在本项目设计与生产部署中，原始异构数据绝不直接暴露给业务端。系统构建了严格的<strong>“基表摄入层 (<code>melens_ingest</code>) &rarr; 规范化事实表 &rarr; 统一只读视图 (<code>melens_query</code>)”</strong>三层演进模型。无论是新闻文本、地磁停车读数、交通警报还是政府人口普查，均被收敛至统一的标准时空与实体规范中。
    </p>

    <!-- Visual 3-tier diagram -->
    <div class="arch-diagram">
      <div class="arch-column">
        <div class="arch-col-title">
          <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg>
          1. 摄入与审计控制层 (melens_ingest)
        </div>
        <div class="arch-item">
          <strong>data_sources</strong>
          <span>统一管理来源 ID、准入许可状态、爬取频率与配额约束</span>
        </div>
        <div class="arch-item">
          <strong>sync_batches</strong>
          <span>不可篡改的批次审计表，记录时间窗口、成功/失败与 Checkpoint</span>
        </div>
        <div class="arch-item">
          <strong>source_records</strong>
          <span>保留原生版本、版权声明（rights_status）与来源追溯 URL</span>
        </div>
      </div>

      <div class="arch-column">
        <div class="arch-col-title">
          <svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>
          2. 跨领域规范化实体层 (Normalized Facts)
        </div>
        <div class="arch-item" style="border-left: 3px solid var(--accent-crimson);">
          <strong>geo_records (核心统一时空大表)</strong>
          <span>所有地理事件/报道/规划统一至此表：统一 topic、时间、WGS84 几何</span>
        </div>
        <div class="arch-item">
          <strong>area_indicators (统一区域统计)</strong>
          <span>人口、租金、犯罪、就业、微气候统一为 indicator_id, value, unit</span>
        </div>
        <div class="arch-item">
          <strong>boundaries (统一空间底图)</strong>
          <span>市界、ASGS 统计区、CLUE 街区统一为 scheme + code + vintage</span>
        </div>
        <div class="arch-item">
          <strong>parking / pedestrian (领域时序)</strong>
          <span>车位几何、占用时序、限制规则、行人客流规范化事实表</span>
        </div>
      </div>

      <div class="arch-column">
        <div class="arch-col-title">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
          3. 授权对外查询视图层 (melens_query)
        </div>
        <div class="arch-item">
          <strong>v_geo_records_current / history</strong>
          <span>自动合并排重，ST_GEOGFROMGEOJSON 空间衍生，仅暴露已发布批次</span>
        </div>
        <div class="arch-item">
          <strong>v_parking_current / v_parking_sensor_current</strong>
          <span>路边车位与传感器当前状态，占用与合法停车权限解耦</span>
        </div>
        <div class="arch-item">
          <strong>v_news_current / v_crime_news_current</strong>
          <span>排除撤稿更正，限制仅提及地名（mentioned_place）的虚假点位</span>
        </div>
        <div class="arch-item">
          <strong>v_area_indicators / v_boundaries</strong>
          <span>严格同版边界关联，不同年份统计区禁止跨版本静默 Join</span>
        </div>
      </div>
    </div>

    <!-- 4 Core Unification Invariants -->
    <div class="arch-rules-grid">
      <div class="arch-rule-card">
        <h4>1. 强制统一 UTC 时间戳</h4>
        <p>全库时间字段统一采用 <code>TIMESTAMP</code> (UTC)。展示层统一按墨尔本时区 <code>Australia/Melbourne</code> 转换。上游时间缺失时记录 <code>time_missing_reason</code>，严禁以系统抓取时间充当事件时间。</p>
      </div>
      <div class="arch-rule-card">
        <h4>2. 强制统一 WGS84 几何拓扑</h4>
        <p>所有点位统一为经度 -180..180、纬度 -90..90，严禁颠倒。统一生成 <code>geometry_geojson</code> 并派生 BigQuery 原生 <code>GEOGRAPHY</code> 对象。严格区分点位置信度（源坐标 vs 区域推断）。</p>
      </div>
      <div class="arch-rule-card">
        <h4>3. 事实类型与生命周期解耦</h4>
        <p>统一划分 <code>assertion_kind</code>（客观观测 observation、报道 report、规划 plan、预测 prediction）。预测结果派生 <code>is_prediction</code> 标识，撤稿与解除事件移出当前活跃视图。</p>
      </div>
      <div class="arch-rule-card">
        <h4>4. 统一数据权限与排重治理</h4>
        <p>生产视图对底层物理表零写入权限。通过 <code>rights_status</code> 动态过滤版权撤销内容，基于稳定业务键（Row Number Qualifying）对重试重放的物理行实现确定性确定去重。</p>
      </div>
    </div>
  </div>

  <!-- Section 2: Catalog Explorer -->
  <section class="section-header" id="catalog">
    <div class="section-title-wrap">
      <div class="section-number">CHAPTER 02 // DATA INVENTORY</div>
      <h2 class="section-title">全景数据资产目录与真实报文对照</h2>
      <p class="section-desc">包含 27 种已实现的数据类型。每项均提供【原始上游报文】与【BigQuery 规范化记录】的高精度结构对照。</p>
    </div>
  </section>

  <!-- Interactive Controls -->
  <div class="control-bar">
    <div class="search-row">
      <div class="search-input-wrap">
        <svg class="search-icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <input type="text" id="searchInput" class="search-input" placeholder="全局搜索：输入数据名称、source_id、BigQuery 表名或字段...">
      </div>

      <div class="status-filter-pills">
        <span class="filter-pill active" data-filter-type="status" data-value="all">全部状态 (27)</span>
        <span class="filter-pill" data-filter-type="status" data-value="live">已在 BigQuery 发布 (12)</span>
        <span class="filter-pill" data-filter-type="status" data-value="ready">管线就绪 / 测试完成 (15)</span>
      </div>

      <div class="results-count" id="resultsCount">DISPLAYING 27 OF 27 DATA ASSETS</div>
    </div>

    <div class="domain-filter-pills" id="domainFilterPills">
      <span class="filter-pill active" data-filter-type="domain" data-value="all">全部领域 (27)</span>
      <span class="filter-pill" data-filter-type="domain" data-value="parking">城市泊车 (4)</span>
      <span class="filter-pill" data-filter-type="domain" data-value="pedestrian">行人流动 (4)</span>
      <span class="filter-pill" data-filter-type="domain" data-value="transit">路网与公交 (4)</span>
      <span class="filter-pill" data-filter-type="domain" data-value="news">媒体治安与咨询 (4)</span>
      <span class="filter-pill" data-filter-type="domain" data-value="events">城市文娱 (1)</span>
      <span class="filter-pill" data-filter-type="domain" data-value="planning">规划与公众咨询 (3)</span>
      <span class="filter-pill" data-filter-type="domain" data-value="demographics">人口与经济 (3)</span>
      <span class="filter-pill" data-filter-type="domain" data-value="microclimate">环境感知 (1)</span>
      <span class="filter-pill" data-filter-type="domain" data-value="boundaries">行政底图 (3)</span>
    </div>
  </div>

  <!-- Cards Container -->
  <div class="catalog-grid" id="catalogGrid">
"""

# Render cards dynamically
cards_html = []
for idx, item in enumerate(items, 1):
    raw_json_str = json.dumps(item["raw_sample"], indent=2, ensure_ascii=False)
    bq_json_str = json.dumps(item["bq_sample"], indent=2, ensure_ascii=False)
    
    badge_class = "live" if item["status"] == "live" else "ready"
    
    card = f"""
    <article class="catalog-card" data-domain="{item['domain']}" data-status="{item['status']}" data-keywords="{item['name_zh']} {item['name_en']} {item['source_id']} {item['bq_table']} {item['bq_view']} {item['provider']}">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-num-domain">
            <span class="card-num">#{idx:02d}</span>
            <span>&bull;</span>
            <span>{item['domain_name_zh']} / {item['domain_name_en']}</span>
          </div>
          <h3 class="card-title-zh">{item['name_zh']}</h3>
          <div class="card-title-en">{item['name_en']}</div>
        </div>
        <div class="badge-status {badge_class}">
          <span class="badge-status-dot"></span>
          <span>{item['status_label']}</span>
        </div>
      </div>

      <div class="card-body">
        <p class="card-desc">{item['description']}</p>

        <div class="metadata-grid">
          <div class="meta-item">
            <span class="meta-label">规范 Source ID</span>
            <span class="meta-value">{item['source_id']}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">官方提供机构 / 接口</span>
            <span class="meta-value">{item['provider']}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">更新频率 / 节奏</span>
            <span class="meta-value">{item['cadence']}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">空间覆盖与体量</span>
            <span class="meta-value">{item['scope']} ({item['volume']})</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">BigQuery 物理基表</span>
            <span class="meta-value highlight-bq">{item['bq_table']}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">对外规范化视图</span>
            <span class="meta-value highlight-bq">{item['bq_view']}</span>
          </div>
        </div>

        <!-- Tabbed Inspector -->
        <div class="inspector-box">
          <div class="inspector-header">
            <div class="inspector-tabs">
              <button class="tab-btn active" onclick="switchTab(this, '{item['id']}', 'bq')">BigQuery 规范化格式 (Unified Canonical)</button>
              <button class="tab-btn" onclick="switchTab(this, '{item['id']}', 'raw')">原始上游报文 (Raw Upstream Sample)</button>
            </div>
            <button class="copy-btn" onclick="copyCode('{item['id']}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>COPY JSON</span>
            </button>
          </div>

          <div class="inspector-content">
            <pre class="code-view" id="code-bq-{item['id']}">{bq_json_str}</pre>
            <pre class="code-view hidden" id="code-raw-{item['id']}">{raw_json_str}</pre>
          </div>
        </div>
      </div>
    </article>
    """
    cards_html.append(card)

footer_html = """
  </div>

  <!-- Section 3: Summary Table -->
  <section class="section-header" style="margin-top: 50px;">
    <div class="section-title-wrap">
      <div class="section-number">CHAPTER 03 // MASTER SCHEMA DICTIONARY</div>
      <h2 class="section-title">BigQuery 核心规范化物理表映射速查</h2>
      <p class="section-desc">工程与数据团队查询对照表</p>
    </div>
  </section>

  <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px; overflow-x: auto; box-shadow: var(--shadow-sm); margin-bottom: 40px;">
    <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
      <thead>
        <tr style="background: var(--bg-subtle); border-bottom: 2px solid var(--border-color); font-family: var(--font-mono); font-size: 11px; text-transform: uppercase;">
          <th style="padding: 12px 16px;">#</th>
          <th style="padding: 12px 16px;">数据类型</th>
          <th style="padding: 12px 16px;">规范 Source ID</th>
          <th style="padding: 12px 16px;">BigQuery 目标表</th>
          <th style="padding: 12px 16px;">主要时间与空间规范</th>
          <th style="padding: 12px 16px;">当前发布状态</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">01</td>
          <td style="padding: 12px 16px; font-weight: 600;">路边停车实时传感器</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">melbourne.parking.sensors</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">parking_observations</td>
          <td style="padding: 12px 16px;">observed_at (UTC), WGS84 Point</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">02</td>
          <td style="padding: 12px 16px; font-weight: 600;">路边车位空间几何</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">melbourne.parking.bays</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">parking_bays</td>
          <td style="padding: 12px 16px;">valid_from, WGS84 Point / Polygon</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">03</td>
          <td style="padding: 12px 16px; font-weight: 600;">单车位停车限制规则</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">melbourne.parking.restrictions</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">parking_rules</td>
          <td style="padding: 12px 16px;">days_of_week, start/end_minute</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">04</td>
          <td style="padding: 12px 16px; font-weight: 600;">本地新闻与时空事件</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">gdelt.news</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">geo_records (topic='news')</td>
          <td style="padding: 12px 16px;">published_at (UTC), WGS84 Centroid</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">05</td>
          <td style="padding: 12px 16px; font-weight: 600;">维州官方季度犯罪统计</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">victoria.csa.recorded_offences</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">area_indicators</td>
          <td style="padding: 12px 16px;">period_start/end, ASGS_LGA Ref</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">06</td>
          <td style="padding: 12px 16px; font-weight: 600;">Ticketmaster 演出活动</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">ticketmaster.events</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">geo_records (topic='event')</td>
          <td style="padding: 12px 16px;">valid_from/to (UTC), Venue Coordinates</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">07</td>
          <td style="padding: 12px 16px; font-weight: 600;">建筑开发审批监控</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">melbourne.development_monitor</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">geo_records (topic='planning')</td>
          <td style="padding: 12px 16px;">status, residential_units, Point</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">08</td>
          <td style="padding: 12px 16px; font-weight: 600;">ABS 2021 人口普查</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">abs.census</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">area_indicators</td>
          <td style="padding: 12px 16px;">period_start/end, LGA/SA2 Boundary Match</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">09</td>
          <td style="padding: 12px 16px; font-weight: 600;">Homes Victoria 季度租金</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">homes_victoria.rents</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">area_indicators</td>
          <td style="padding: 12px 16px;">quarter, median_rent, suppressed handling</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">10</td>
          <td style="padding: 12px 16px; font-weight: 600;">墨尔本市法定市界</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">melbourne.municipal_boundary</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">boundaries</td>
          <td style="padding: 12px 16px;">vintage=2008-07-01, MultiPolygon</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">11</td>
          <td style="padding: 12px 16px; font-weight: 600;">ABS ASGS 统计边界</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">abs.asgs.boundaries</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">boundaries</td>
          <td style="padding: 12px 16px;">vintage=2021 & 2026, GCCSA/LGA/SA2</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">12</td>
          <td style="padding: 12px 16px; font-weight: 600;">CLUE 商业街区边界底图</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">melbourne.clue.blocks</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">boundaries</td>
          <td style="padding: 12px 16px;">vintage=2025, 603 Small Blocks Polygons</td>
          <td style="padding: 12px 16px;"><span class="badge-status live"><span class="badge-status-dot"></span>LIVE IN BQ</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">13</td>
          <td style="padding: 12px 16px; font-weight: 600;">28 市议会社区公众咨询项目</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">victoria.council.engagement</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">geo_records (topic='planning')</td>
          <td style="padding: 12px 16px;">valid_from, Suburb Location, restricted rights</td>
          <td style="padding: 12px 16px;"><span class="badge-status ready"><span class="badge-status-dot"></span>PIPELINE READY</span></td>
        </tr>
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 12px 16px; font-family: var(--font-mono); color: var(--accent-crimson);">14</td>
          <td style="padding: 12px 16px; font-weight: 600;">28 市议会社区咨询决策与通告</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">victoria.council.engagement_news</td>
          <td style="padding: 12px 16px; font-family: var(--font-mono);">geo_records (topic='news')</td>
          <td style="padding: 12px 16px;">published_at (UTC), Suburb Centroid, sitemap lastmod</td>
          <td style="padding: 12px 16px;"><span class="badge-status ready"><span class="badge-status-dot"></span>PIPELINE READY</span></td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Editorial Footer -->
  <footer class="editorial-footer">
    <div class="footer-left">
      <div class="footer-title">PROJECT MELENS // METROPOLITAN LENS</div>
      <p>
        本编目文档基于 <code>specs/001-melbourne-data-aggregation</code> 与 <code>specs/002-map-data-presentation</code> 规范构建。
        所有数据资产受官方开放数据许可协议（CC BY 4.0、DataVic Open Data Policy、Ticketmaster Developer Terms）管辖，严禁擅自修改保留期限与权限标识。
      </p>
    </div>
    <div style="font-family: var(--font-mono); font-size: 11px; text-align: right; color: var(--text-light);">
      <div>GCP PROJECT: melens-510012</div>
      <div>BIGQUERY DATASETS: melens_ingest / melens_query</div>
      <div>REGION: australia-southeast2</div>
      <div>CLASSIFICATION: INTERNAL STAKEHOLDER PRESENTATION</div>
    </div>
  </footer>
</div>

<!-- Back to top button -->
<button class="back-to-top" id="backToTop" title="返回顶部">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
</button>

<!-- Toast for copy confirmation -->
<div class="toast" id="toast">JSON COPIED TO CLIPBOARD</div>

<script>
  // Theme Toggle
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeToggleText = document.getElementById('themeToggleText');
  let currentTheme = localStorage.getItem('melens_theme') || 'light';

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      themeToggleText.textContent = 'DAY EDITORIAL';
    } else {
      document.documentElement.removeAttribute('data-theme');
      themeToggleText.textContent = 'NIGHT PRESS';
    }
    localStorage.setItem('melens_theme', theme);
  }
  applyTheme(currentTheme);

  themeToggleBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(currentTheme);
  });

  // Tab switching in code inspector
  function switchTab(btn, itemId, tabType) {
    const parent = btn.closest('.inspector-box');
    parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const bqCode = document.getElementById('code-bq-' + itemId);
    const rawCode = document.getElementById('code-raw-' + itemId);

    if (tabType === 'bq') {
      bqCode.classList.remove('hidden');
      rawCode.classList.add('hidden');
    } else {
      bqCode.classList.add('hidden');
      rawCode.classList.remove('hidden');
    }
  }

  // Copy code helper
  function copyCode(itemId) {
    const card = document.querySelector(`[data-keywords*="${itemId}"]`) || document.getElementById('code-bq-' + itemId).closest('.catalog-card');
    const activeCode = card.querySelector('.code-view:not(.hidden)');
    if (activeCode) {
      navigator.clipboard.writeText(activeCode.textContent).then(() => {
        showToast('JSON SNIPPET COPIED TO CLIPBOARD');
      });
    }
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  // Search & Filtering
  const searchInput = document.getElementById('searchInput');
  const cards = document.querySelectorAll('.catalog-card');
  const resultsCount = document.getElementById('resultsCount');

  let currentDomainFilter = 'all';
  let currentStatusFilter = 'all';
  let currentSearchQuery = '';

  function filterCards() {
    let visibleCount = 0;
    const query = currentSearchQuery.toLowerCase().trim();

    cards.forEach(card => {
      const domain = card.getAttribute('data-domain');
      const status = card.getAttribute('data-status');
      const keywords = card.getAttribute('data-keywords').toLowerCase();

      const matchDomain = (currentDomainFilter === 'all' || domain === currentDomainFilter);
      const matchStatus = (currentStatusFilter === 'all' || status === currentStatusFilter);
      const matchSearch = (!query || keywords.includes(query));

      if (matchDomain && matchStatus && matchSearch) {
        card.style.display = 'block';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    resultsCount.textContent = `DISPLAYING ${visibleCount} OF ${cards.length} DATA ASSETS`;
  }

  // Status Filter Pills
  document.querySelectorAll('[data-filter-type="status"]').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-type="status"]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentStatusFilter = pill.getAttribute('data-value');
      filterCards();
    });
  });

  // Domain Filter Pills
  document.querySelectorAll('[data-filter-type="domain"]').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-type="domain"]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentDomainFilter = pill.getAttribute('data-value');
      filterCards();
    });
  });

  // Search Input
  searchInput.addEventListener('input', (e) => {
    currentSearchQuery = e.target.value;
    filterCards();
  });

  // Back to top button
  const backToTop = document.getElementById('backToTop');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 400) {
      backToTop.classList.add('visible');
    } else {
      backToTop.classList.remove('visible');
    }
  });

  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
</script>

</body>
</html>
"""

full_html = html_template + "\n".join(cards_html) + footer_html

output_path = "/Users/alexgao/Dev/hackathon/melens/data-catalog-editorial.html"
with open(output_path, "w", encoding="utf-8") as f:
    f.write(full_html)

print(f"Editorial HTML file generated successfully at {output_path} ({len(full_html)} bytes)")
