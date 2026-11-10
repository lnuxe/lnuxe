#!/usr/bin/env node
/**
 * 极光贡献蛇 —— 把 GitHub 贡献热力图渲染成带极光动画的 SVG。
 * 视觉语言取自 lnuxe/aurora-snake（#5EEAD4 → #818CF8 渐变、霓虹发光）。
 * 用法: node scripts/gen-snake.mjs
 * 环境: GITHUB_TOKEN / GITHUB_LOGIN / OUT_DIR
 */

const LOGIN = process.env.GITHUB_LOGIN || 'lnuxe';
const OUT_DIR = process.env.OUT_DIR || 'assets';
const TOKEN = process.env.GITHUB_TOKEN || '';

async function viaGraphQL() {
  const q = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{
    totalContributions
    weeks{contributionDays{date contributionCount}}
  }}}}`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: 'bearer ' + TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'aurora-snake' },
    body: JSON.stringify({ query: q, variables: { login: LOGIN } }),
  });
  if (!res.ok) throw new Error('GraphQL HTTP ' + res.status);
  const j = await res.json();
  const cal = j && j.data && j.data.user && j.data.user.contributionsCollection
    && j.data.user.contributionsCollection.contributionCalendar;
  if (!cal) throw new Error('GraphQL 无 contributionCalendar');
  const days = [];
  for (const w of cal.weeks) for (const d of w.contributionDays) days.push(d);
  return { days, total: cal.totalContributions, source: 'graphql' };
}

async function viaHtml() {
  const res = await fetch('https://github.com/users/' + LOGIN + '/contributions', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('HTML HTTP ' + res.status);
  const html = await res.text();
  const days = [];
  const re = /data-date="(\d{4}-\d{2}-\d{2})"/g;
  let m;
  while ((m = re.exec(html))) {
    const at = m.index;
    const win = html.slice(at, at + 600);
    const lv = win.match(/data-level="(\d)"/);
    days.push({ date: m[1], level: lv ? Number(lv[1]) : 0 });
  }
  if (!days.length) throw new Error('HTML 里没解析到贡献格');
  const t = html.match(/([\d,]+)\s*contributions?\s+in the last year/i);
  return { days, total: t ? Number(t[1].replace(/,/g, '')) : null, source: 'html' };
}

async function getCalendar() {
  if (TOKEN) {
    try { return await viaGraphQL(); }
    catch (e) { console.error('[warn] GraphQL 失败, 回退 HTML: ' + e.message); }
  }
  return await viaHtml();
}

const CELL = 12, GAP = 3, PITCH = CELL + GAP, RX = 2.5, PAD = 20, COLS = 53, ROWS = 7;
const AURORA_LOW = [0x5e, 0xea, 0xd4];
const AURORA_HIGH = [0x81, 0x8c, 0xf8];

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

function levelColor(level, theme) {
  if (level <= 0) return theme === 'dark' ? '#161b22' : '#ebedf0';
  const t = (level - 1) / 3;
  const c = mix(AURORA_LOW, AURORA_HIGH, t);
  if (theme === 'dark') return hex(c.map((v) => Math.round(v * 0.8)));
  return hex(c.map((v) => Math.round(v * 0.72)));
}

const THEME = {
  dark:  { bg: '#0d1117', g0: '#5EEAD4', g1: '#818CF8', head: '#5EEAD4', food: '#F472B6', glow: 0.55, text: '#6e7681' },
  light: { bg: '#ffffff', g0: '#0D9488', g1: '#4F46E5', head: '#0D9488', food: '#DB2777', glow: 0.3,  text: '#8c959f' },
};

function buildSvg(cal, theme) {
  const T = THEME[theme];
  const days = cal.days;
  const weeks = Math.min(COLS, Math.ceil(days.length / 7));
  const W = PAD * 2 + weeks * PITCH - GAP;
  const H = PAD * 2 + ROWS * PITCH - GAP + 26;

  const cells = [];
  for (let i = 0; i < days.length; i++) {
    const col = Math.floor(i / 7), row = i % 7;
    if (col >= weeks) break;
    cells.push({ x: PAD + col * PITCH, y: PAD + row * PITCH, level: days[i].level || 0 });
  }

  const active = cells.filter((c) => c.level > 0);
  const pts = active.map((c) => [c.x + CELL / 2, c.y + CELL / 2]);
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0], y = pts[i][1];
    if (i === 0) { d += "M" + x + " " + y; continue; }
    const px = pts[i - 1][0], py = pts[i - 1][1];
    const mx = (px + x) / 2;
    d += " Q" + mx + " " + py + " " + x + " " + y;
  }
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  len = Math.max(Math.ceil(len * 1.2), 60);

  const cellsSvg = cells.map((c) =>
    '<rect x="' + c.x + '" y="' + c.y + '" width="' + CELL + '" height="' + CELL + '" rx="' + RX + '" fill="' + levelColor(c.level, theme) + '"/>'
  ).join("");

  const foods = active.filter((c) => c.level >= 3).slice(-3).map((c, i) =>
    '<circle cx="' + (c.x + CELL / 2) + '" cy="' + (c.y + CELL / 2) + '" r="2.6" fill="' + T.food + '" class="food" style="animation-delay:' + (i * 0.6).toFixed(1) + 's"/>'
  ).join("");

  const DUR = 7;
  const label = (cal.total != null ? cal.total : active.length) + " contributions in the last year";
  const trail = "trail-" + theme;
  const grad = "aurora-" + theme;
  const headG = "head-" + theme;

  const out = [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" fill="none">',
    "<defs>",
    '<linearGradient id="' + grad + '" x1="0" y1="0" x2="1" y2="0">',
    '<stop offset="0%" stop-color="' + T.g0 + '"/>',
    '<stop offset="100%" stop-color="' + T.g1 + '"/>',
    "</linearGradient>",
    '<radialGradient id="' + headG + '" cx="0.5" cy="0.5" r="0.5">',
    '<stop offset="0%" stop-color="' + T.head + '" stop-opacity="' + T.glow + '"/>',
    '<stop offset="100%" stop-color="' + T.head + '" stop-opacity="0"/>',
    "</radialGradient>",
    '<path id="' + trail + '" d="' + d + '"/>',
    "</defs>",
    "<style>",
    "  .snake { stroke-dasharray: " + len + "; animation: draw " + DUR + "s linear infinite; }",
    "  @keyframes draw { from { stroke-dashoffset: " + len + "; } to { stroke-dashoffset: 0; } }",
    "  .food { animation: pulse 1.8s ease-in-out infinite; }",
    "  @keyframes pulse { 0%,100% { opacity: .25; } 50% { opacity: 1; } }",
    "</style>",
    '<rect width="' + W + '" height="' + H + '" fill="' + T.bg + '"/>',
    cellsSvg,
    '<use href="#' + trail + '" xlink:href="#' + trail + '" class="snake" stroke="url(#' + grad + ')" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    foods,
    '<circle r="7" fill="url(#' + headG + ')"><animateMotion dur="' + DUR + 's" repeatCount="indefinite" calcMode="paced"><mpath href="#' + trail + '" xlink:href="#' + trail + '"/></animateMotion></circle>',
    '<circle r="2.6" fill="' + T.head + '"><animateMotion dur="' + DUR + 's" repeatCount="indefinite" calcMode="paced"><mpath href="#' + trail + '" xlink:href="#' + trail + '"/></animateMotion></circle>',
    '<text x="' + PAD + '" y="' + (H - 8) + '" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="10" fill="' + T.text + '">' + label.replace(/&/g, "&amp;") + "</text>",
    "</svg>",
  ].join("\n");
  return out;
}

const cal = await getCalendar();
if (!cal.days.length) { console.error("没有取到贡献数据，中止"); process.exit(1); }
const fsm = await import("node:fs");
await fsm.promises.mkdir(OUT_DIR, { recursive: true });
for (const theme of ["light", "dark"]) {
  const svg = buildSvg(cal, theme);
  await fsm.promises.writeFile(OUT_DIR + "/aurora-snake-" + theme + ".svg", svg, "utf8");
  console.log(theme + ": " + svg.length + " bytes");
}
console.log("source=" + cal.source + " days=" + cal.days.length + " total=" + cal.total);
