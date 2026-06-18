#!/usr/bin/env node
/**
 * BETAŞ EPC Intelligence — bilingual (TR / 中文) dashboard generator.
 *
 * Reads curated, sourced, bilingual data from data/news.json and (when network
 * egress is available, e.g. on GitHub Actions) aggregates live items from the
 * real energy RSS feeds in feeds.json. Emits a single self-contained index.html
 * with a live TR/中文 language toggle (choice persisted in localStorage).
 *
 * No dependencies. Run:  node generate.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TZ = 'Europe/Istanbul';

// ---------- helpers ----------
const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Bilingual span pair: TR + ZH. CSS shows exactly one based on body.show-zh.
const bi = (tr, zh) =>
  `<span class="lang-tr">${esc(tr)}</span><span class="lang-zh">${esc(zh != null && zh !== '' ? zh : tr)}</span>`;
// Combined lowercased text so search matches in either language.
const biLower = (tr, zh) => esc(((tr || '') + ' ' + (zh || '')).toLowerCase());

function fmtDate(d, locale = 'tr-TR') {
  return new Intl.DateTimeFormat(locale, {
    timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric', weekday: 'long',
  }).format(d);
}
function fmtStamp(d = new Date()) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}

// ---------- tiny resilient RSS parser (no deps) ----------
function stripTag(s = '') {
  return s
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;[^&]*&gt;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#8217;|&#8216;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
function field(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? stripTag(m[1]) : '';
}
function linkField(block) {
  let m = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (m && m[1].trim()) return stripTag(m[1]);
  m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return m ? m[1].trim() : '';
}
function parseFeed(xml, sourceName) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = field(b, 'title');
    const link = linkField(b);
    const date = field(b, 'pubDate') || field(b, 'updated') || field(b, 'published') || '';
    if (title && link) items.push({ title, link, date, source: sourceName });
  }
  return items;
}
async function fetchFeed(feed, timeoutMs = 9000) {
  try {
    const res = await fetch(feed.url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'BETAS-EPC-Intelligence/1.0 (+dashboard)' },
    });
    if (!res.ok) return { ok: false, name: feed.name, items: [] };
    const xml = await res.text();
    return { ok: true, name: feed.name, items: parseFeed(xml, feed.name) };
  } catch (err) {
    return { ok: false, name: feed.name, items: [], error: err.name || 'error' };
  }
}
async function aggregateLive(cfg) {
  if (process.env.NO_FETCH === '1' || !Array.isArray(cfg.feeds)) {
    return { items: [], reachable: 0, total: (cfg.feeds || []).length };
  }
  const results = await Promise.allSettled(cfg.feeds.map((f) => fetchFeed(f)));
  const kw = (cfg.keywords || []).map((k) => k.toLowerCase());
  let reachable = 0;
  const merged = [];
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value.ok) continue;
    reachable++;
    for (const it of r.value.items) {
      const hay = (it.title + ' ' + it.source).toLowerCase();
      if (kw.length === 0 || kw.some((k) => hay.includes(k))) merged.push(it);
    }
  }
  const seen = new Set();
  const out = [];
  merged.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  for (const it of merged) {
    const key = it.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= 36) break;
  }
  return { items: out, reachable, total: cfg.feeds.length };
}

// ---------- section renderers ----------
const badge = (imp) => {
  const map = { high: ['badge-high', 'YÜKSEK', '高'], medium: ['badge-medium', 'ORTA', '中'], low: ['badge-low', 'DÜŞÜK', '低'] };
  const [cls, tr, zh] = map[imp] || map.low;
  return `<span class="badge ${cls}">${bi(tr, zh)}</span>`;
};

function renderCards(items) {
  return items.map((n) => `
    <article class="card" data-importance="${esc(n.importance)}" data-search="${biLower(
      n.title + ' ' + n.summary + ' ' + (n.tags || []).join(' '),
      (n.title_zh || '') + ' ' + (n.summary_zh || '') + ' ' + (n.tags_zh || []).join(' '),
    )}">
      <div class="card-header">
        <h3 class="card-title">${bi(n.title, n.title_zh)}</h3>
        ${badge(n.importance)}
      </div>
      <p class="card-body">${bi(n.summary, n.summary_zh)}</p>
      <div class="card-tags">${(n.tags || []).map((t, i) => `<span class="tag">${bi(t, (n.tags_zh || [])[i])}</span>`).join('')}</div>
      <div class="card-footer">
        <span class="card-date">${esc(n.date)}</span>
        <a href="${esc(n.source_url)}" target="_blank" rel="noopener">${esc(n.source_name)} →</a>
      </div>
    </article>`).join('');
}

function renderTenders(rows) {
  const st = {
    active: ['status-active', 'Aktif', '进行中'],
    upcoming: ['status-upcoming', 'Yaklaşan', '即将'],
    result: ['status-result', 'Sonuçlandı', '已结束'],
  };
  return rows.map((r) => {
    const [cls, trL, zhL] = st[r.status] || st.active;
    return `<tr data-search="${biLower(r.project + ' ' + r.org + ' ' + r.scope + ' ' + r.ikn, (r.project_zh || '') + ' ' + (r.scope_zh || ''))}">
      <td><strong>${bi(r.project, r.project_zh)}</strong></td>
      <td>${esc(r.org)}</td>
      <td>${bi(r.scope, r.scope_zh)}</td>
      <td class="mono">${esc(r.ikn)}</td>
      <td>${esc(r.date)}</td>
      <td class="${cls}">${bi(trL, zhL)}</td>
    </tr>`;
  }).join('');
}

function renderMfg(items) {
  return items.map((m) => `
    <div class="mfg-item">
      <h4>${bi(m.title, m.title_zh)}</h4>
      <p>${bi(m.body, m.body_zh)}</p>
      <div class="source"><a href="${esc(m.source_url)}" target="_blank" rel="noopener">${esc(m.source_name)} →</a></div>
    </div>`).join('');
}

function renderYeka(items) {
  return items.map((y) => `
    <div class="yeka-item">
      <div class="capacity">${bi(y.capacity, y.capacity_zh)}</div>
      <h4>${bi(y.title, y.title_zh)}</h4>
      <p>${bi(y.body, y.body_zh)}</p>
      <div class="source"><a href="${esc(y.source_url)}" target="_blank" rel="noopener">${esc(y.source_name)} →</a></div>
    </div>`).join('');
}

function renderMena(items) {
  return items.map((m) => `
    <div class="mena-item">
      <h4>${bi(m.title, m.title_zh)}</h4>
      <p>${bi(m.body, m.body_zh)}</p>
      <div class="source"><a href="${esc(m.source_url)}" target="_blank" rel="noopener">${esc(m.source_name)} →</a></div>
    </div>`).join('');
}

function renderLive(live) {
  if (!live.items.length) {
    return `<p class="live-empty">${bi(
      `Canlı besleme şu an boş veya ağ erişimi kısıtlı. Bu bölüm GitHub Actions üzerinde her yenilemede ${live.total} RSS kaynağından otomatik dolar.`,
      `实时流目前为空或网络受限。该板块在 GitHub Actions 上每次刷新时会从 ${live.total} 个 RSS 源自动填充。`,
    )}</p>`;
  }
  return `<ul class="live-list">` + live.items.map((it) => {
    let d = '';
    const t = Date.parse(it.date);
    if (!Number.isNaN(t)) d = fmtStamp(new Date(t));
    return `<li data-search="${esc(it.title.toLowerCase())}">
      <a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a>
      <span class="live-meta">${esc(it.source)}${d ? ' · ' + esc(d) : ''}</span>
    </li>`;
  }).join('') + `</ul>`;
}

function renderStats(stats) {
  return stats.map((s) => `
    <div class="stat-item">
      <span class="stat-label">${bi(s.label, s.label_zh)}</span>
      <span class="stat-value ${esc(s.accent || '')}">${esc(s.value)}</span>
    </div>`).join('');
}

function renderActions(items) {
  return items.map((a) => `
    <div class="action-item">
      <div class="action-title">${bi(a.title, a.title_zh)}</div>
      <div class="action-desc">${bi(a.desc, a.desc_zh)}</div>
      <div class="action-deadline">⏰ ${bi(a.deadline, a.deadline_zh)}</div>
    </div>`).join('');
}

function renderStrategy(items) {
  return items.map((s) => `<p><strong>${bi(s.title, s.title_zh)}:</strong> ${bi(s.body, s.body_zh)}</p>`).join('');
}

function renderTicker(tickers) {
  const cls = { hot: 'hot', new: 'new', info: '' };
  const one = tickers.map((t) => `<span class="${cls[t.type] || ''}">${bi(t.text, t.text_zh)}</span>`).join('');
  return one + one; // duplicate for seamless marquee loop
}

// ---------- page ----------
function page(data, live, now) {
  const m = data.meta || {};
  const highCount = (data.epc || []).filter((x) => x.importance === 'high').length;
  const liveBadge = live.reachable > 0
    ? `<span class="live-on">${bi(`● CANLI · ${live.reachable}/${live.total} kaynak`, `● 实时 · ${live.reachable}/${live.total} 源`)}</span>`
    : `<span class="live-off">${bi('○ Canlı besleme beklemede', '○ 实时流待启用')}</span>`;

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(m.report_title || 'EPC Intelligence')} — ${esc(fmtDate(now))}</title>
<meta name="description" content="Türkiye EPC & enerji sektörü canlı istihbarat panosu (TR/中文). Gerçek kaynaklı, kaynak bağlantılı.">
<style>
:root{--bg:#0a0e17;--panel:#111827;--card:#1a2332;--line:#1e293b;--accent:#00d4aa;--muted:#94a3b8;--dim:#64748b;--text:#e0e6ed;}
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,'PingFang SC','Microsoft YaHei',sans-serif;background:var(--bg);color:var(--text);line-height:1.6;}
a{color:var(--accent);}
/* language toggle visibility */
body:not(.show-zh) .lang-zh{display:none;}
body.show-zh .lang-tr{display:none;}
.header{background:linear-gradient(135deg,#0f1923 0%,#1a2332 50%,#0d1b2a 100%);padding:26px 36px;border-bottom:3px solid var(--accent);}
.header-content{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;}
.header-left h1{font-size:26px;color:var(--accent);font-weight:800;letter-spacing:.5px;}
.header-left .subtitle{font-size:13px;color:#8899aa;margin-top:5px;}
.header-right{text-align:right;}
.lang-toggle{display:inline-flex;gap:0;border:1px solid #2a3a4a;border-radius:6px;overflow:hidden;margin-bottom:8px;}
.lang-btn{background:var(--card);border:none;color:var(--muted);padding:5px 14px;font-size:12px;font-weight:700;cursor:pointer;}
.lang-btn.active{background:var(--accent);color:#0a0e17;}
.header-right .date{font-size:17px;color:#fff;font-weight:600;}
.header-right .time-badge{display:inline-block;background:var(--accent);color:#0a0e17;padding:4px 12px;border-radius:4px;font-size:13px;font-weight:700;margin-top:6px;}
.header-right .clock{font-size:13px;color:var(--muted);margin-top:6px;font-variant-numeric:tabular-nums;}
.status-bar{display:flex;gap:18px;align-items:center;flex-wrap:wrap;background:#0d1117;padding:8px 36px;border-bottom:1px solid var(--line);font-size:12px;color:var(--dim);}
.live-on{color:var(--accent);font-weight:700;}
.live-off{color:#d97706;font-weight:600;}
.refresh-note{margin-left:auto;}
.marquee-container{background:var(--panel);padding:11px 0;border-bottom:1px solid var(--line);overflow:hidden;}
.marquee-content{display:inline-block;white-space:nowrap;animation:marquee 60s linear infinite;font-size:13px;color:var(--muted);}
.marquee-content>span{margin-right:48px;}
.marquee-content .hot{color:#ef4444;font-weight:600;}
.marquee-content .new{color:var(--accent);font-weight:600;}
@keyframes marquee{0%{transform:translateX(0);}100%{transform:translateX(-50%);}}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:16px 36px;background:#0d1117;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20;}
.toolbar input[type=search]{flex:1;min-width:200px;background:var(--card);border:1px solid #2a3a4a;border-radius:6px;color:var(--text);padding:9px 12px;font-size:13px;}
.toolbar input[type=search]:focus{outline:none;border-color:var(--accent);}
.filter-btn{background:var(--card);border:1px solid #2a3a4a;color:var(--muted);padding:8px 14px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;}
.filter-btn.active{background:var(--accent);color:#0a0e17;border-color:var(--accent);}
.nav-links{display:flex;gap:14px;flex-wrap:wrap;}
.nav-links a{font-size:12px;color:var(--muted);text-decoration:none;}
.nav-links a:hover{color:var(--accent);}
.main-layout{display:grid;grid-template-columns:1fr 330px;gap:0;}
.content-area{padding:28px 36px;}
.sidebar{background:var(--panel);padding:24px;border-left:1px solid var(--line);}
.section-title{font-size:18px;color:var(--accent);font-weight:700;margin:8px 0 18px;padding-bottom:9px;border-bottom:2px solid var(--line);display:flex;align-items:center;gap:10px;scroll-margin-top:70px;}
.section-title::before{content:'';width:4px;height:20px;background:var(--accent);border-radius:2px;}
.card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:15px;margin-bottom:34px;}
.card{background:var(--card);border:1px solid #2a3a4a;border-radius:8px;padding:18px;transition:border-color .25s,transform .25s;display:flex;flex-direction:column;}
.card:hover{border-color:var(--accent);transform:translateY(-2px);}
.card-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:10px;}
.card-title{font-size:15px;font-weight:700;color:#fff;line-height:1.35;flex:1;}
.badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:800;text-transform:uppercase;flex-shrink:0;}
.badge-high{background:#dc2626;color:#fff;}.badge-medium{background:#d97706;color:#fff;}.badge-low{background:#059669;color:#fff;}
.card-body{font-size:13px;color:var(--muted);margin-bottom:12px;flex:1;}
.card-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;}
.tag{font-size:10px;color:var(--accent);background:rgba(0,212,170,.1);border:1px solid rgba(0,212,170,.25);padding:1px 7px;border-radius:10px;}
.card-footer{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--dim);border-top:1px solid var(--line);padding-top:9px;}
.card-footer a{text-decoration:none;}.card-footer a:hover{text-decoration:underline;}
.tender-table{width:100%;border-collapse:collapse;margin-bottom:34px;font-size:13px;}
.tender-table th{background:var(--line);color:var(--accent);padding:11px 10px;text-align:left;font-weight:600;border-bottom:2px solid var(--accent);}
.tender-table td{padding:10px;border-bottom:1px solid var(--line);color:#cbd5e1;}
.tender-table tr:hover td{background:var(--card);}
.mono{font-family:'SFMono-Regular',Consolas,monospace;font-size:12px;color:#a5b4cf;}
.status-active{color:var(--accent);font-weight:600;}.status-upcoming{color:#f59e0b;font-weight:600;}.status-result{color:#8b5cf6;font-weight:600;}
.mfg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:13px;margin-bottom:34px;}
.mfg-item{background:var(--card);border:1px solid #2a3a4a;border-radius:6px;padding:16px;}
.mfg-item h4{font-size:14px;color:#fff;margin-bottom:8px;}.mfg-item p{font-size:12px;color:var(--muted);}
.mfg-item .source{font-size:11px;margin-top:8px;}.mfg-item .source a{text-decoration:none;}
.yeka-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:13px;margin-bottom:34px;}
.yeka-item{background:var(--card);border-left:3px solid #8b5cf6;border-radius:0 6px 6px 0;padding:16px;}
.yeka-item h4{font-size:14px;color:#fff;margin-bottom:6px;}.yeka-item p{font-size:12px;color:var(--muted);}
.yeka-item .capacity{font-size:22px;color:#8b5cf6;font-weight:800;}
.yeka-item .source{font-size:11px;margin-top:8px;}.yeka-item .source a{text-decoration:none;}
.mena-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:13px;margin-bottom:34px;}
.mena-item{background:var(--card);border-left:3px solid #f59e0b;border-radius:0 6px 6px 0;padding:16px;}
.mena-item h4{font-size:14px;color:#fff;margin-bottom:6px;}.mena-item p{font-size:12px;color:var(--muted);}
.mena-item .source{font-size:11px;margin-top:8px;}.mena-item .source a{text-decoration:none;}
.live-list{list-style:none;margin-bottom:34px;}
.live-list li{padding:11px 0;border-bottom:1px solid var(--line);}
.live-list a{font-size:13px;color:#e0e6ed;text-decoration:none;font-weight:500;}
.live-list a:hover{color:var(--accent);}
.live-meta{display:block;font-size:11px;color:var(--dim);margin-top:3px;}
.live-empty{font-size:13px;color:var(--dim);background:var(--card);border:1px dashed #2a3a4a;border-radius:6px;padding:16px;margin-bottom:34px;}
.sidebar-section{margin-bottom:28px;}
.sidebar-title{font-size:14px;color:var(--accent);font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--line);}
.stat-item{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);gap:10px;}
.stat-label{font-size:12px;color:var(--muted);}.stat-value{font-size:14px;color:#fff;font-weight:700;white-space:nowrap;}
.stat-value.green{color:var(--accent);}.stat-value.red{color:#ef4444;}
.action-item{padding:10px 0;border-bottom:1px solid var(--line);}.action-item:last-child{border-bottom:none;}
.action-title{font-size:12px;color:#fff;font-weight:700;margin-bottom:3px;}
.action-desc{font-size:11px;color:var(--dim);}.action-deadline{font-size:11px;color:#f59e0b;margin-top:3px;}
.strategy-box{background:#0d1b2a;border:1px solid var(--accent);border-radius:6px;padding:15px;}
.strategy-box p{font-size:12px;color:var(--muted);margin-bottom:9px;line-height:1.5;}
.strategy-box strong{color:var(--accent);}
.footer{background:#0d1117;padding:20px 36px;border-top:1px solid var(--line);text-align:center;font-size:11px;color:var(--dim);}
.footer a{text-decoration:none;}
.no-results{display:none;color:var(--dim);font-size:13px;padding:20px;text-align:center;}
@media (max-width:1024px){.main-layout{grid-template-columns:1fr;}.sidebar{border-left:none;border-top:1px solid var(--line);}}
</style>
</head>
<body>

<header class="header">
  <div class="header-content">
    <div class="header-left">
      <h1>${esc(m.report_title || 'EPC Intelligence')}</h1>
      <div class="subtitle">${bi(m.subtitle, m.subtitle_zh)}</div>
    </div>
    <div class="header-right">
      <div class="lang-toggle">
        <button class="lang-btn" data-lang="tr">TR</button>
        <button class="lang-btn" data-lang="zh">中文</button>
      </div>
      <div class="date"><span class="lang-tr">${esc(fmtDate(now, 'tr-TR'))}</span><span class="lang-zh">${esc(fmtDate(now, 'zh-CN'))}</span></div>
      <div class="time-badge">${bi('⚡ CANLI İSTİHBARAT PANOSU', '⚡ 全天候实时情报面板')}</div>
      <div class="clock" id="clock">…</div>
    </div>
  </div>
</header>

<div class="status-bar">
  ${liveBadge}
  <span>${bi('Son güncelleme:', '最后更新：')} <strong>${esc(fmtStamp(now))}</strong> ${bi('(TSİ)', '（土耳其时间）')}</span>
  <span>${bi(`${highCount} yüksek öncelikli başlık`, `${highCount} 条高优先级头条`)}</span>
  <span class="refresh-note">${bi('Sayfa açık kaldığında her 15 dk\'da bir otomatik yenilenir.', '页面保持打开时每 15 分钟自动刷新。')}</span>
</div>

<div class="marquee-container">
  <div class="marquee-content">${renderTicker(data.tickers || [])}</div>
</div>

<div class="toolbar">
  <input type="search" id="search"
    data-ph-tr="🔎 Haber, ihale, kurum, kV, MW ara… (örn: 380 kV, Astor, offshore)"
    data-ph-zh="🔎 搜索新闻、招标、机构、kV、MW…（如：380 kV、Astor、offshore）"
    placeholder="🔎 …">
  <button class="filter-btn active" data-filter="all">${bi('Tümü', '全部')}</button>
  <button class="filter-btn" data-filter="high">${bi('Yüksek', '高')}</button>
  <button class="filter-btn" data-filter="medium">${bi('Orta', '中')}</button>
  <nav class="nav-links">
    <a href="#epc">EPC</a>
    <a href="#tenders">${bi('İhaleler', '招标')}</a>
    <a href="#mfg">${bi('Üreticiler', '制造商')}</a>
    <a href="#yeka">YEKA</a>
    <a href="#mena">MENA</a>
    <a href="#live">${bi('Canlı', '实时')}</a>
  </nav>
</div>

<div class="main-layout">
  <main class="content-area">

    <h2 class="section-title" id="epc">${bi('EPC Projeleri & Sözleşmeler', 'EPC 项目与合同')}</h2>
    <div class="card-grid" id="cards">${renderCards(data.epc || [])}</div>

    <h2 class="section-title" id="tenders">${bi('TEİAŞ / EÜAŞ İhale Takip Tablosu', 'TEİAŞ / EÜAŞ 招标跟踪表')}</h2>
    <table class="tender-table">
      <thead><tr>
        <th>${bi('Proje', '项目')}</th><th>${bi('Kurum', '机构')}</th><th>${bi('Kapsam', '范围')}</th>
        <th>${bi('İKN', '招标号')}</th><th>${bi('Yıl', '年份')}</th><th>${bi('Durum', '状态')}</th>
      </tr></thead>
      <tbody id="tender-rows">${renderTenders(data.tenders || [])}</tbody>
    </table>

    <h2 class="section-title" id="mfg">${bi('Transformatör & Ekipman Üreticileri', '变压器与设备制造商动态')}</h2>
    <div class="mfg-grid">${renderMfg(data.manufacturers || [])}</div>

    <h2 class="section-title" id="yeka">${bi('YEKA & Yenilenebilir Enerji', 'YEKA 与可再生能源')}</h2>
    <div class="yeka-grid">${renderYeka(data.yeka || [])}</div>

    <h2 class="section-title" id="mena">${bi('Kuzey Afrika & Ortadoğu EPC Pazarı', '北非与中东 EPC 市场')}</h2>
    <div class="mena-grid">${renderMena(data.mena || [])}</div>

    <h2 class="section-title" id="live">${bi('📡 Canlı Sektör Akışı (RSS)', '📡 实时行业资讯流（RSS）')}</h2>
    ${renderLive(live)}

    <div class="no-results" id="no-results">${bi('Eşleşen sonuç yok. Aramayı temizleyin.', '无匹配结果，请清除搜索。')}</div>
  </main>

  <aside class="sidebar">
    <div class="sidebar-section">
      <div class="sidebar-title">${bi('📊 Önemli Rakamlar', '📊 关键数字')}</div>
      ${renderStats(data.stats || [])}
    </div>
    <div class="sidebar-section">
      <div class="sidebar-title">${bi('🚨 Acil Takip Listesi', '🚨 紧急跟进清单')}</div>
      ${renderActions(data.actions || [])}
    </div>
    <div class="sidebar-section">
      <div class="sidebar-title">${bi('🎯 Ati İçin Strateji', '🎯 给 Ati 的策略')}</div>
      <div class="strategy-box">${renderStrategy(data.strategy || [])}</div>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-title">${bi('📰 Kaynaklar', '📰 信息来源')}</div>
      <div class="action-item"><div class="action-desc">${(data.sources_footer || []).map(esc).join(' • ')}</div></div>
    </div>
  </aside>
</div>

<footer class="footer">
  <p>${bi(m.note, m.note_zh)}</p>
  <p style="margin-top:6px;">${bi('Veri küratörlüğü', '数据核校至')}: ${esc(m.curated_through || '')} · ${bi('Oluşturulma', '生成时间')}: ${esc(fmtStamp(now))} ${bi('(TSİ)', '（土耳其时间）')} · ${bi('Ati (BETAŞ) için otomatik hazırlanmıştır.', '为 Ati (BETAŞ) 自动生成。')}</p>
</footer>

<script>
// ---- language toggle (persisted) ----
(function(){
  var KEY='betas-dash-lang';
  var btns=document.querySelectorAll('.lang-btn');
  var search=document.getElementById('search');
  window.__lang='tr';
  function setLang(l){
    if(l==='zh'){document.body.classList.add('show-zh');}else{document.body.classList.remove('show-zh');}
    btns.forEach(function(b){b.classList.toggle('active',b.getAttribute('data-lang')===l);});
    if(search){search.setAttribute('placeholder',search.getAttribute(l==='zh'?'data-ph-zh':'data-ph-tr')||'');}
    document.documentElement.setAttribute('lang',l==='zh'?'zh':'tr');
    window.__lang=l;
    try{localStorage.setItem(KEY,l);}catch(e){}
  }
  btns.forEach(function(b){b.addEventListener('click',function(){setLang(b.getAttribute('data-lang'));});});
  var saved='tr';try{saved=localStorage.getItem(KEY)||'tr';}catch(e){}
  setLang(saved);
})();

// ---- live Istanbul clock ----
(function(){
  var el=document.getElementById('clock');
  function tick(){
    var zh=document.body.classList.contains('show-zh');
    try{
      var s=new Intl.DateTimeFormat(zh?'zh-CN':'tr-TR',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());
      el.textContent=(zh?'伊斯坦布尔 · ':'İstanbul · ')+s+(zh?'':' TSİ');
    }catch(e){ el.textContent=new Date().toLocaleTimeString(); }
  }
  tick(); setInterval(tick,1000);
})();

// ---- auto-refresh every 15 minutes ----
setTimeout(function(){ location.reload(); }, 15*60*1000);

// ---- search + importance filter ----
(function(){
  var search=document.getElementById('search');
  var buttons=document.querySelectorAll('.filter-btn');
  var cards=Array.prototype.slice.call(document.querySelectorAll('#cards .card'));
  var rows=Array.prototype.slice.call(document.querySelectorAll('#tender-rows tr'));
  var liveItems=Array.prototype.slice.call(document.querySelectorAll('.live-list li'));
  var noRes=document.getElementById('no-results');
  var activeFilter='all';
  function apply(){
    var q=(search.value||'').toLowerCase().trim();
    var shown=0;
    cards.forEach(function(c){
      var matchQ=!q||(c.getAttribute('data-search')||'').indexOf(q)>-1;
      var matchF=activeFilter==='all'||c.getAttribute('data-importance')===activeFilter;
      var vis=matchQ&&matchF;
      c.style.display=vis?'':'none';
      if(vis)shown++;
    });
    rows.forEach(function(r){
      var matchQ=!q||(r.getAttribute('data-search')||'').indexOf(q)>-1;
      r.style.display=matchQ?'':'none';
    });
    liveItems.forEach(function(li){
      var matchQ=!q||(li.getAttribute('data-search')||'').indexOf(q)>-1;
      li.style.display=matchQ?'':'none';
    });
    noRes.style.display=(shown===0&&q)?'block':'none';
  }
  search.addEventListener('input',apply);
  buttons.forEach(function(b){
    b.addEventListener('click',function(){
      buttons.forEach(function(x){x.classList.remove('active');});
      b.classList.add('active');
      activeFilter=b.getAttribute('data-filter');
      apply();
    });
  });
})();
</script>
</body>
</html>`;
}

// ---------- main ----------
async function main() {
  const data = JSON.parse(await readFile(path.join(DIR, 'data', 'news.json'), 'utf-8'));
  let feedCfg = { feeds: [], keywords: [] };
  try {
    feedCfg = JSON.parse(await readFile(path.join(DIR, 'feeds.json'), 'utf-8'));
  } catch { /* feeds optional */ }

  const live = await aggregateLive(feedCfg);
  const now = new Date();
  const html = page(data, live, now);

  await writeFile(path.join(DIR, 'index.html'), html, 'utf-8');
  await writeFile(
    path.join(DIR, 'data', 'last-build.json'),
    JSON.stringify({ built_at: now.toISOString(), live_reachable: live.reachable, live_total: live.total, live_items: live.items.length }, null, 2),
    'utf-8',
  );

  console.log(`[ok] index.html yazıldı / 已生成 — ${fmtStamp(now)} (TSİ)`);
  console.log(`[live] ${live.reachable}/${live.total} RSS kaynağı erişildi, ${live.items.length} canlı başlık`);
}

main().catch((err) => {
  console.error('[hata/错误] üretim başarısız:', err);
  process.exit(1);
});
