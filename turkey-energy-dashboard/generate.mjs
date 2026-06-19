#!/usr/bin/env node
/**
 * BETAŞ EPC Intelligence — trilingual (TR / EN / 中文) dashboard generator.
 *
 * Reads curated, sourced, trilingual data from data/news.json and (on networked
 * runners such as GitHub Actions) aggregates live items from the real energy RSS
 * feeds in feeds.json. Emits a single self-contained index.html with a live
 * TR/EN/中文 language toggle (choice persisted in localStorage).
 *
 * Optional machine translation of the live RSS headlines (off by default):
 *   TRANSLATE=google node generate.mjs            # unofficial Google endpoint, no key
 *   TRANSLATE=libre  LIBRETRANSLATE_URL=https://… [LIBRETRANSLATE_API_KEY=…] node generate.mjs
 *   TRANSLATE_MAX=18                               # cap items translated per build
 * When off, live headlines display in their source language across all modes.
 *
 * No dependencies. Run:  node generate.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TZ = 'Europe/Istanbul';
const LANGS = ['tr', 'en', 'zh'];

// ---------- helpers ----------
const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Trilingual span set: TR + EN + ZH. CSS shows exactly one based on body.lmode-*.
const tri = (tr, en, zh) =>
  `<span class="lang-tr">${esc(tr)}</span>` +
  `<span class="lang-en">${esc(en != null && en !== '' ? en : tr)}</span>` +
  `<span class="lang-zh">${esc(zh != null && zh !== '' ? zh : tr)}</span>`;
// Combined lowercased text so search matches in any language.
const triLower = (tr, en, zh) => esc(((tr || '') + ' ' + (en || '') + ' ' + (zh || '')).toLowerCase());

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
    return { items: [], reachable: 0, total: (cfg.feeds || []).length, translated: 0 };
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
  return { items: out, reachable, total: cfg.feeds.length, translated: 0 };
}

// ---------- optional machine translation (off by default) ----------
async function translateOne(text, target) {
  const provider = (process.env.TRANSLATE || '').toLowerCase();
  if (!provider || !text) return null;
  try {
    if (provider === 'google') {
      const tl = target === 'zh' ? 'zh-CN' : target;
      const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl='
        + encodeURIComponent(tl) + '&dt=t&q=' + encodeURIComponent(text);
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'BETAS-EPC/1.0' } });
      if (!res.ok) return null;
      const j = await res.json();
      if (!Array.isArray(j) || !Array.isArray(j[0])) return null;
      const out = j[0].map((seg) => (Array.isArray(seg) ? seg[0] : '')).join('').trim();
      return out || null;
    }
    if (provider === 'libre') {
      const base = process.env.LIBRETRANSLATE_URL;
      if (!base) return null;
      const body = { q: text, source: 'auto', target: target === 'zh' ? 'zh' : target, format: 'text' };
      if (process.env.LIBRETRANSLATE_API_KEY) body.api_key = process.env.LIBRETRANSLATE_API_KEY;
      const res = await fetch(base.replace(/\/$/, '') + '/translate', {
        method: 'POST', signal: AbortSignal.timeout(9000),
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const j = await res.json();
      return j && j.translatedText ? String(j.translatedText).trim() : null;
    }
  } catch { return null; }
  return null;
}

async function translateLive(items) {
  const provider = (process.env.TRANSLATE || '').toLowerCase();
  if (!provider || !items.length) return 0;
  const cap = Math.min(items.length, Number(process.env.TRANSLATE_MAX || 18));
  let idx = 0;
  let count = 0;
  const conc = 4;
  async function worker() {
    while (idx < cap) {
      const i = idx++;
      const it = items[i];
      const [tr, en, zh] = await Promise.all(LANGS.map((t) => translateOne(it.title, t)));
      if (tr || en || zh) {
        it.tr = tr || it.title;
        it.en = en || it.title;
        it.zh = zh || it.title;
        it.translated = true;
        count++;
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, () => worker()));
  return count;
}

// ---------- section renderers ----------
const badge = (imp) => {
  const map = { high: ['badge-high', 'YÜKSEK', 'HIGH', '高'], medium: ['badge-medium', 'ORTA', 'MED', '中'], low: ['badge-low', 'DÜŞÜK', 'LOW', '低'] };
  const [cls, tr, en, zh] = map[imp] || map.low;
  return `<span class="badge ${cls}">${tri(tr, en, zh)}</span>`;
};

function renderCards(items) {
  return items.map((n) => `
    <article class="card" data-importance="${esc(n.importance)}" data-search="${triLower(
      n.title + ' ' + n.summary + ' ' + (n.tags || []).join(' '),
      (n.title_en || '') + ' ' + (n.summary_en || '') + ' ' + (n.tags_en || []).join(' '),
      (n.title_zh || '') + ' ' + (n.summary_zh || '') + ' ' + (n.tags_zh || []).join(' '),
    )}">
      <div class="card-header">
        <h3 class="card-title">${tri(n.title, n.title_en, n.title_zh)}</h3>
        ${badge(n.importance)}
      </div>
      <p class="card-body">${tri(n.summary, n.summary_en, n.summary_zh)}</p>
      <div class="card-tags">${(n.tags || []).map((t, i) => `<span class="tag">${tri(t, (n.tags_en || [])[i], (n.tags_zh || [])[i])}</span>`).join('')}</div>
      <div class="card-footer">
        <span class="card-date">${esc(n.date)}</span>
        <a href="${esc(n.source_url)}" target="_blank" rel="noopener">${esc(n.source_name)} →</a>
      </div>
    </article>`).join('');
}

function renderTenders(rows) {
  const st = {
    active: ['status-active', 'Aktif', 'Active', '进行中'],
    upcoming: ['status-upcoming', 'Yaklaşan', 'Upcoming', '即将'],
    result: ['status-result', 'Sonuçlandı', 'Awarded', '已结束'],
  };
  return rows.map((r) => {
    const [cls, trL, enL, zhL] = st[r.status] || st.active;
    return `<tr data-search="${triLower(r.project + ' ' + r.org + ' ' + r.scope + ' ' + r.ikn, (r.project_en || '') + ' ' + (r.scope_en || ''), (r.project_zh || '') + ' ' + (r.scope_zh || ''))}">
      <td><strong>${tri(r.project, r.project_en, r.project_zh)}</strong></td>
      <td>${esc(r.org)}</td>
      <td>${tri(r.scope, r.scope_en, r.scope_zh)}</td>
      <td class="mono">${esc(r.ikn)}</td>
      <td>${esc(r.date)}</td>
      <td class="${cls}">${tri(trL, enL, zhL)}</td>
    </tr>`;
  }).join('');
}

function renderMfg(items) {
  return items.map((m) => `
    <div class="mfg-item">
      <h4>${tri(m.title, m.title_en, m.title_zh)}</h4>
      <p>${tri(m.body, m.body_en, m.body_zh)}</p>
      <div class="source"><a href="${esc(m.source_url)}" target="_blank" rel="noopener">${esc(m.source_name)} →</a></div>
    </div>`).join('');
}

function renderYeka(items) {
  return items.map((y) => `
    <div class="yeka-item">
      <div class="capacity">${tri(y.capacity, y.capacity_en, y.capacity_zh)}</div>
      <h4>${tri(y.title, y.title_en, y.title_zh)}</h4>
      <p>${tri(y.body, y.body_en, y.body_zh)}</p>
      <div class="source"><a href="${esc(y.source_url)}" target="_blank" rel="noopener">${esc(y.source_name)} →</a></div>
    </div>`).join('');
}

function renderMena(items) {
  return items.map((m) => `
    <div class="mena-item">
      <h4>${tri(m.title, m.title_en, m.title_zh)}</h4>
      <p>${tri(m.body, m.body_en, m.body_zh)}</p>
      <div class="source"><a href="${esc(m.source_url)}" target="_blank" rel="noopener">${esc(m.source_name)} →</a></div>
    </div>`).join('');
}

function renderLive(live) {
  if (!live.items.length) {
    return `<p class="live-empty">${tri(
      `Canlı besleme şu an boş veya ağ erişimi kısıtlı. Bu bölüm GitHub Actions üzerinde her yenilemede ${live.total} RSS kaynağından otomatik dolar.`,
      `The live feed is empty or network access is restricted. This section auto-fills from ${live.total} RSS feeds on each GitHub Actions rebuild.`,
      `实时流目前为空或网络受限。该板块在 GitHub Actions 上每次刷新时会从 ${live.total} 个 RSS 源自动填充。`,
    )}</p>`;
  }
  return `<ul class="live-list">` + live.items.map((it) => {
    let d = '';
    const t = Date.parse(it.date);
    if (!Number.isNaN(t)) d = fmtStamp(new Date(t));
    const titleHtml = it.translated
      ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">${tri(it.tr, it.en, it.zh)}</a>`
      : `<a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a>`;
    const search = it.translated ? triLower(it.tr, it.en, it.zh) : esc(it.title.toLowerCase());
    return `<li data-search="${search}">
      ${titleHtml}
      <span class="live-meta">${esc(it.source)}${d ? ' · ' + esc(d) : ''}</span>
    </li>`;
  }).join('') + `</ul>`;
}

function renderStats(stats) {
  return stats.map((s) => `
    <div class="stat-item">
      <span class="stat-label">${tri(s.label, s.label_en, s.label_zh)}</span>
      <span class="stat-value ${esc(s.accent || '')}">${esc(s.value)}</span>
    </div>`).join('');
}

function renderActions(items) {
  return items.map((a) => `
    <div class="action-item">
      <div class="action-title">${tri(a.title, a.title_en, a.title_zh)}</div>
      <div class="action-desc">${tri(a.desc, a.desc_en, a.desc_zh)}</div>
      <div class="action-deadline">⏰ ${tri(a.deadline, a.deadline_en, a.deadline_zh)}</div>
    </div>`).join('');
}

function renderStrategy(items) {
  return items.map((s) => `<p><strong>${tri(s.title, s.title_en, s.title_zh)}:</strong> ${tri(s.body, s.body_en, s.body_zh)}</p>`).join('');
}

function renderAnalytics(data) {
  const epc = data.epc || [];
  const tenders = data.tenders || [];
  const mfg = data.manufacturers || [];
  const yeka = data.yeka || [];
  const mena = data.mena || [];

  const cImp = { high: 0, medium: 0, low: 0 };
  epc.forEach((x) => { cImp[x.importance] = (cImp[x.importance] || 0) + 1; });
  const cTen = { active: 0, upcoming: 0, result: 0 };
  tenders.forEach((x) => { cTen[x.status] = (cTen[x.status] || 0) + 1; });

  const totalTracked = epc.length + tenders.length + mfg.length + yeka.length + mena.length;
  const sources = new Set();
  [...epc, ...mfg, ...yeka, ...mena].forEach((x) => { if (x.source_name) sources.add(x.source_name); });

  const pct = (n, t) => (t > 0 ? Math.round((n / t) * 100) : 0);
  const bar = (label, n, t, color) =>
    `<div class="an-row"><span class="an-label">${label}</span><div class="an-bar"><span style="width:${pct(n, t)}%;background:${color}"></span></div><span class="an-val">${n}</span></div>`;

  const impCard = `<div class="an-card"><h4>${tri('Önem Dağılımı (EPC)', 'Importance Split (EPC)', '重要性分布 (EPC)')}</h4>
    ${bar(tri('Yüksek', 'High', '高'), cImp.high, epc.length, '#dc2626')}
    ${bar(tri('Orta', 'Med', '中'), cImp.medium, epc.length, '#d97706')}
    ${bar(tri('Düşük', 'Low', '低'), cImp.low, epc.length, '#059669')}</div>`;

  const tenCard = `<div class="an-card"><h4>${tri('İhale Durumu', 'Tender Status', '招标状态')}</h4>
    ${bar(tri('Aktif', 'Active', '进行中'), cTen.active, tenders.length, '#00d4aa')}
    ${bar(tri('Yaklaşan', 'Upcoming', '即将'), cTen.upcoming, tenders.length, '#f59e0b')}
    ${bar(tri('Sonuç', 'Done', '已结束'), cTen.result, tenders.length, '#8b5cf6')}</div>`;

  const covMax = Math.max(epc.length, mfg.length, yeka.length, mena.length, 1);
  const covCard = `<div class="an-card"><h4>${tri('Sektör Kapsamı', 'Sector Coverage', '板块覆盖')}</h4>
    ${bar('EPC', epc.length, covMax, '#00d4aa')}
    ${bar(tri('Üretici', 'Makers', '制造商'), mfg.length, covMax, '#38bdf8')}
    ${bar('YEKA', yeka.length, covMax, '#8b5cf6')}
    ${bar('MENA', mena.length, covMax, '#f59e0b')}</div>`;

  const totCard = `<div class="an-card an-totals">
    <div><div class="an-big">${totalTracked}</div><div class="an-big-label">${tri('Takip edilen başlık', 'Tracked items', '跟踪条目')}</div></div>
    <div><div class="an-big">${sources.size}</div><div class="an-big-label">${tri('Farklı kaynak', 'Distinct sources', '不同来源')}</div></div>
    <div><div class="an-big">${cImp.high}</div><div class="an-big-label">${tri('Yüksek öncelik', 'High priority', '高优先级')}</div></div>
  </div>`;

  return impCard + tenCard + covCard + totCard;
}

function renderTicker(tickers) {
  const cls = { hot: 'hot', new: 'new', info: '' };
  const one = tickers.map((t) => `<span class="${cls[t.type] || ''}">${tri(t.text, t.text_en, t.text_zh)}</span>`).join('');
  return one + one; // duplicate for seamless marquee loop
}

// ---------- page ----------
function page(data, live, now) {
  const m = data.meta || {};
  const highCount = (data.epc || []).filter((x) => x.importance === 'high').length;
  const liveBadge = live.reachable > 0
    ? `<span class="live-on">${tri(`● CANLI · ${live.reachable}/${live.total} kaynak`, `● LIVE · ${live.reachable}/${live.total} feeds`, `● 实时 · ${live.reachable}/${live.total} 源`)}</span>`
    : `<span class="live-off">${tri('○ Canlı besleme beklemede', '○ Live feed pending', '○ 实时流待启用')}</span>`;
  const trBadge = live.translated > 0
    ? `<span class="tr-on">${tri(`🌐 ${live.translated} başlık çevrildi`, `🌐 ${live.translated} headlines translated`, `🌐 ${live.translated} 条已翻译`)}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(m.report_title || 'EPC Intelligence')} — ${esc(fmtDate(now))}</title>
<meta name="description" content="Türkiye EPC & energy live intelligence dashboard (TR/EN/中文). Real sources, linked.">
<style>
:root{--bg:#0a0e17;--panel:#111827;--card:#1a2332;--line:#1e293b;--accent:#00d4aa;--muted:#94a3b8;--dim:#64748b;--text:#e0e6ed;}
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,'PingFang SC','Microsoft YaHei',sans-serif;background:var(--bg);color:var(--text);line-height:1.6;}
a{color:var(--accent);}
/* language visibility (3-way) */
.lang-tr,.lang-en,.lang-zh{display:none;}
body.lmode-tr .lang-tr,body.lmode-en .lang-en,body.lmode-zh .lang-zh{display:inline;}
.header{background:linear-gradient(135deg,#0f1923 0%,#1a2332 50%,#0d1b2a 100%);padding:26px 36px;border-bottom:3px solid var(--accent);}
.header-content{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;}
.header-left h1{font-size:26px;color:var(--accent);font-weight:800;letter-spacing:.5px;}
.header-left .subtitle{font-size:13px;color:#8899aa;margin-top:5px;}
.header-right{text-align:right;}
.lang-toggle{display:inline-flex;border:1px solid #2a3a4a;border-radius:6px;overflow:hidden;margin-bottom:8px;}
.lang-btn{background:var(--card);border:none;border-left:1px solid #2a3a4a;color:var(--muted);padding:5px 13px;font-size:12px;font-weight:700;cursor:pointer;}
.lang-btn:first-child{border-left:none;}
.lang-btn.active{background:var(--accent);color:#0a0e17;}
.header-right .date{font-size:17px;color:#fff;font-weight:600;}
.header-right .time-badge{display:inline-block;background:var(--accent);color:#0a0e17;padding:4px 12px;border-radius:4px;font-size:13px;font-weight:700;margin-top:6px;}
.header-right .clock{font-size:13px;color:var(--muted);margin-top:6px;font-variant-numeric:tabular-nums;}
.status-bar{display:flex;gap:18px;align-items:center;flex-wrap:wrap;background:#0d1117;padding:8px 36px;border-bottom:1px solid var(--line);font-size:12px;color:var(--dim);}
.live-on{color:var(--accent);font-weight:700;}
.live-off{color:#d97706;font-weight:600;}
.tr-on{color:#8b5cf6;font-weight:600;}
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
.analytics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-bottom:34px;}
.an-card{background:var(--card);border:1px solid #2a3a4a;border-radius:8px;padding:16px;}
.an-card h4{font-size:13px;color:#fff;margin-bottom:12px;font-weight:700;}
.an-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11px;}
.an-label{width:58px;color:var(--muted);flex-shrink:0;}
.an-bar{flex:1;height:8px;background:#0d1117;border-radius:4px;overflow:hidden;}
.an-bar>span{display:block;height:100%;border-radius:4px;min-width:2px;transition:width .5s ease;}
.an-val{width:26px;text-align:right;color:#fff;font-weight:700;flex-shrink:0;}
.an-totals{display:flex;justify-content:space-around;text-align:center;gap:10px;}
.an-big{font-size:30px;font-weight:800;color:var(--accent);line-height:1.1;}
.an-big-label{font-size:10px;color:var(--muted);margin-top:4px;}
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
<body class="lmode-tr">

<header class="header">
  <div class="header-content">
    <div class="header-left">
      <h1>${esc(m.report_title || 'EPC Intelligence')}</h1>
      <div class="subtitle">${tri(m.subtitle, m.subtitle_en, m.subtitle_zh)}</div>
    </div>
    <div class="header-right">
      <div class="lang-toggle">
        <button class="lang-btn" data-lang="tr">TR</button>
        <button class="lang-btn" data-lang="en">EN</button>
        <button class="lang-btn" data-lang="zh">中文</button>
      </div>
      <div class="date"><span class="lang-tr">${esc(fmtDate(now, 'tr-TR'))}</span><span class="lang-en">${esc(fmtDate(now, 'en-US'))}</span><span class="lang-zh">${esc(fmtDate(now, 'zh-CN'))}</span></div>
      <div class="time-badge">${tri('⚡ CANLI İSTİHBARAT PANOSU', '⚡ LIVE INTELLIGENCE DASHBOARD', '⚡ 全天候实时情报面板')}</div>
      <div class="clock" id="clock">…</div>
    </div>
  </div>
</header>

<div class="status-bar">
  ${liveBadge}
  ${trBadge}
  <span>${tri('Son güncelleme:', 'Last updated:', '最后更新：')} <strong>${esc(fmtStamp(now))}</strong> ${tri('(TSİ)', '(TRT)', '（土耳其时间）')}</span>
  <span>${tri(`${highCount} yüksek öncelikli başlık`, `${highCount} high-priority items`, `${highCount} 条高优先级头条`)}</span>
  <span class="refresh-note">${tri('Sayfa açık kaldığında her 15 dk\'da bir otomatik yenilenir.', 'Auto-refreshes every 15 min while open.', '页面保持打开时每 15 分钟自动刷新。')}</span>
</div>

<div class="marquee-container">
  <div class="marquee-content">${renderTicker(data.tickers || [])}</div>
</div>

<div class="toolbar">
  <input type="search" id="search"
    data-ph-tr="🔎 Haber, ihale, kurum, kV, MW ara… (örn: 380 kV, Astor, offshore)"
    data-ph-en="🔎 Search news, tenders, orgs, kV, MW… (e.g. 380 kV, Astor, offshore)"
    data-ph-zh="🔎 搜索新闻、招标、机构、kV、MW…（如：380 kV、Astor、offshore）"
    placeholder="🔎 …">
  <button class="filter-btn active" data-filter="all">${tri('Tümü', 'All', '全部')}</button>
  <button class="filter-btn" data-filter="high">${tri('Yüksek', 'High', '高')}</button>
  <button class="filter-btn" data-filter="medium">${tri('Orta', 'Med', '中')}</button>
  <nav class="nav-links">
    <a href="#overview">${tri('Genel Bakış', 'Overview', '概览')}</a>
    <a href="#epc">EPC</a>
    <a href="#tenders">${tri('İhaleler', 'Tenders', '招标')}</a>
    <a href="#mfg">${tri('Üreticiler', 'Makers', '制造商')}</a>
    <a href="#yeka">YEKA</a>
    <a href="#mena">MENA</a>
    <a href="#live">${tri('Canlı', 'Live', '实时')}</a>
  </nav>
</div>

<div class="main-layout">
  <main class="content-area">

    <h2 class="section-title" id="overview">${tri('📈 Genel Bakış', '📈 Overview', '📈 数据概览')}</h2>
    <div class="analytics-grid">${renderAnalytics(data)}</div>

    <h2 class="section-title" id="epc">${tri('EPC Projeleri & Sözleşmeler', 'EPC Projects & Contracts', 'EPC 项目与合同')}</h2>
    <div class="card-grid" id="cards">${renderCards(data.epc || [])}</div>

    <h2 class="section-title" id="tenders">${tri('TEİAŞ / EÜAŞ İhale Takip Tablosu', 'TEİAŞ / EÜAŞ Tender Tracker', 'TEİAŞ / EÜAŞ 招标跟踪表')}</h2>
    <table class="tender-table">
      <thead><tr>
        <th>${tri('Proje', 'Project', '项目')}</th><th>${tri('Kurum', 'Org', '机构')}</th><th>${tri('Kapsam', 'Scope', '范围')}</th>
        <th>${tri('İKN', 'Ref', '招标号')}</th><th>${tri('Yıl', 'Year', '年份')}</th><th>${tri('Durum', 'Status', '状态')}</th>
      </tr></thead>
      <tbody id="tender-rows">${renderTenders(data.tenders || [])}</tbody>
    </table>

    <h2 class="section-title" id="mfg">${tri('Transformatör & Ekipman Üreticileri', 'Transformer & Equipment Makers', '变压器与设备制造商动态')}</h2>
    <div class="mfg-grid">${renderMfg(data.manufacturers || [])}</div>

    <h2 class="section-title" id="yeka">${tri('YEKA & Yenilenebilir Enerji', 'YEKA & Renewables', 'YEKA 与可再生能源')}</h2>
    <div class="yeka-grid">${renderYeka(data.yeka || [])}</div>

    <h2 class="section-title" id="mena">${tri('Kuzey Afrika & Ortadoğu EPC Pazarı', 'North Africa & Middle East EPC Market', '北非与中东 EPC 市场')}</h2>
    <div class="mena-grid">${renderMena(data.mena || [])}</div>

    <h2 class="section-title" id="live">${tri('📡 Canlı Sektör Akışı (RSS)', '📡 Live Sector Feed (RSS)', '📡 实时行业资讯流（RSS）')}</h2>
    ${renderLive(live)}

    <div class="no-results" id="no-results">${tri('Eşleşen sonuç yok. Aramayı temizleyin.', 'No matches. Clear the search.', '无匹配结果，请清除搜索。')}</div>
  </main>

  <aside class="sidebar">
    <div class="sidebar-section">
      <div class="sidebar-title">${tri('📊 Önemli Rakamlar', '📊 Key Numbers', '📊 关键数字')}</div>
      ${renderStats(data.stats || [])}
    </div>
    <div class="sidebar-section">
      <div class="sidebar-title">${tri('🚨 Acil Takip Listesi', '🚨 Urgent Follow-ups', '🚨 紧急跟进清单')}</div>
      ${renderActions(data.actions || [])}
    </div>
    <div class="sidebar-section">
      <div class="sidebar-title">${tri('🎯 Ati İçin Strateji', '🎯 Strategy for Ati', '🎯 给 Ati 的策略')}</div>
      <div class="strategy-box">${renderStrategy(data.strategy || [])}</div>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-title">${tri('📰 Kaynaklar', '📰 Sources', '📰 信息来源')}</div>
      <div class="action-item"><div class="action-desc">${(data.sources_footer || []).map(esc).join(' • ')}</div></div>
    </div>
  </aside>
</div>

<footer class="footer">
  <p>${tri(m.note, m.note_en, m.note_zh)}</p>
  <p style="margin-top:6px;">${tri('Veri küratörlüğü', 'Curated through', '数据核校至')}: ${esc(m.curated_through || '')} · ${tri('Oluşturulma', 'Generated', '生成时间')}: ${esc(fmtStamp(now))} ${tri('(TSİ)', '(TRT)', '（土耳其时间）')} · ${tri('Ati (BETAŞ) için otomatik hazırlanmıştır.', 'Auto-generated for Ati (BETAŞ).', '为 Ati (BETAŞ) 自动生成。')}</p>
</footer>

<script>
// ---- language toggle (3-way, persisted) ----
(function(){
  var KEY='betas-dash-lang';
  var MODES=['tr','en','zh'];
  var btns=document.querySelectorAll('.lang-btn');
  var search=document.getElementById('search');
  window.__lang='tr';
  function setLang(l){
    if(MODES.indexOf(l)<0)l='tr';
    MODES.forEach(function(x){document.body.classList.remove('lmode-'+x);});
    document.body.classList.add('lmode-'+l);
    btns.forEach(function(b){b.classList.toggle('active',b.getAttribute('data-lang')===l);});
    if(search){search.setAttribute('placeholder',search.getAttribute('data-ph-'+l)||'');}
    document.documentElement.setAttribute('lang',l==='zh'?'zh':l);
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
    var l=window.__lang||'tr';
    var loc=l==='zh'?'zh-CN':(l==='en'?'en-US':'tr-TR');
    var label=l==='zh'?'伊斯坦布尔 · ':'İstanbul · ';
    var suffix=l==='en'?' TRT':(l==='tr'?' TSİ':'');
    try{
      var s=new Intl.DateTimeFormat(loc,{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());
      el.textContent=label+s+suffix;
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
  live.translated = await translateLive(live.items);
  const now = new Date();
  const html = page(data, live, now);

  await writeFile(path.join(DIR, 'index.html'), html, 'utf-8');
  await writeFile(
    path.join(DIR, 'data', 'last-build.json'),
    JSON.stringify({ built_at: now.toISOString(), live_reachable: live.reachable, live_total: live.total, live_items: live.items.length, translated: live.translated, translate_provider: process.env.TRANSLATE || 'off' }, null, 2),
    'utf-8',
  );

  console.log(`[ok] index.html yazıldı / generated / 已生成 — ${fmtStamp(now)} (TSİ)`);
  console.log(`[live] ${live.reachable}/${live.total} RSS feeds, ${live.items.length} items, ${live.translated} translated (${process.env.TRANSLATE || 'off'})`);
}

main().catch((err) => {
  console.error('[hata/error/错误] generation failed:', err);
  process.exit(1);
});
