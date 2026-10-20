'use strict';

/* ================= constants ================= */
const KEY = 'money-tracker-v1';
const PALETTE = ['#4C78A8', '#F58518', '#54A24B', '#E45756', '#72B7B2', '#EECA3B', '#B279A2', '#9D755D', '#FF9DA6', '#79706E'];
const FIXED_SHADES = ['#2b2b2b', '#4a4a4a', '#696969', '#888888', '#a7a7a7'];
const UNCATEGORIZED = { id: null, name: 'Uncategorized', color: '#c4c4c4' };
const HEAT_RGB = '46,158,91';
const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/* ================= helpers ================= */
const $ = (s, root = document) => root.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymKey = (y, m) => `${y}-${pad(m + 1)}`;
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sum = (arr, f = x => x.amount) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const shortDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const monthName = (y, m) => new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const safeColor = c => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : UNCATEGORIZED.color);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isMonth = s => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);

// Icons for the small buttons. Drawn as shapes (not ‹ › × text characters) so they sit exactly in the middle of their button on every device and font.
const icon = (d, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const ICON = {
  prev: icon('<path d="M14.5 6l-6 6 6 6"/>'),
  next: icon('<path d="M9.5 6l6 6-6 6"/>'),
  x: icon('<path d="M7 7l10 10M17 7L7 17"/>'),
  xSmall: icon('<path d="M7 7l10 10M17 7L7 17"/>', 12),
  up: icon('<path d="M6 14l6-6 6 6"/>'),
  edit: icon('<path d="M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>', 17),
};

function money(n, compact) {
  const neg = n < 0;
  n = Math.abs(n);
  let s;
  if (compact && n >= 1e6) s = (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  else if (compact && n >= 1e3) s = (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  else s = n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) || compact ? 0 : 2, maximumFractionDigits: compact ? 0 : 2 });
  return (neg ? '−' : '') + '฿' + s;
}

// Evaluate a simple sum like "120+45", "900/3" or "(50+70)*2". Returns NaN if it isn't valid.
function calc(input) {
  const s = String(input).replace(/[\s,฿]/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  if (!s || !/^[0-9.+\-*/()]+$/.test(s)) return NaN;
  let i = 0;
  const number = () => {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (!m) throw new Error('number expected');
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = () => {
    if (s[i] === '-') { i++; return -factor(); }
    if (s[i] === '+') { i++; return factor(); }
    if (s[i] === '(') {
      i++;
      const v = sumExpr();
      if (s[i] === ')') i++; // a missing ")" at the end is forgiven
      return v;
    }
    return number();
  };
  const product = () => {
    let v = factor();
    while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const r = factor(); v = op === '*' ? v * r : v / r; }
    return v;
  };
  const sumExpr = () => {
    let v = product();
    while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const r = product(); v = op === '+' ? v + r : v - r; }
    return v;
  };
  try {
    const v = sumExpr();
    return i === s.length && Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  } catch (e) {
    return NaN;
  }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ================= state ================= */
function defaultState() {
  const names = ['Food', 'Transport', 'Groceries', 'Shopping', 'Fun', 'Health', 'Bills', 'Other'];
  return {
    version: 1,
    categories: names.map((name, i) => ({ id: uid(), name, color: PALETTE[i], u: 0 })),
    expenses: [],
    income: [],
    fixed: [],
    deleted: {}, // id -> time it was deleted, so deletions sync between devices
    settings: { budget: 0, budgetIncludesFixed: false, weekStart: 1 },
    settingsU: 0,
    pristine: true, // untouched since created; a pristine device simply adopts the cloud copy
  };
}

// Ids of the photos attached to an entry (the pictures themselves stay on the device, see slips.js).
const picsOf = e => {
  const p = Array.isArray(e.pics) ? e.pics.filter(x => typeof x === 'string').slice(0, 8) : [];
  return p.length ? { pics: p } : {};
};

function normalize(d) {
  const base = defaultState();
  if (!d || typeof d !== 'object') return base;
  const arr = a => (Array.isArray(a) ? a : []);
  const cats = arr(d.categories)
    .filter(c => c && typeof c.id === 'string' && typeof c.name === 'string')
    .map(c => ({ id: c.id, name: c.name.slice(0, 24), color: safeColor(c.color), u: Number(c.u) || 0 }));
  const amt = x => Number.isFinite(Number(x.amount)) && Number(x.amount) > 0;
  const deleted = {};
  if (d.deleted && typeof d.deleted === 'object') {
    Object.entries(d.deleted).forEach(([id, t]) => { if (Number.isFinite(Number(t))) deleted[id] = Number(t); });
  }
  return {
    version: 1,
    categories: cats.length ? cats : base.categories,
    expenses: arr(d.expenses).filter(e => e && isDate(e.date) && amt(e))
      .map(e => ({ id: String(e.id || uid()), date: e.date, amount: Number(e.amount), categoryId: e.categoryId || null, note: String(e.note || ''), u: Number(e.u) || 0, ...picsOf(e) })),
    income: arr(d.income).filter(e => e && isDate(e.date) && amt(e))
      .map(e => ({ id: String(e.id || uid()), date: e.date, amount: Number(e.amount), source: String(e.source || 'Income'), note: String(e.note || ''), u: Number(e.u) || 0, ...picsOf(e) })),
    fixed: arr(d.fixed).filter(f => f && isMonth(f.start) && (f.variable === true || amt(f)))
      .map(f => {
        const months = {};
        if (f.variable === true && f.months && typeof f.months === 'object') {
          Object.entries(f.months).forEach(([k, v]) => { if (isMonth(k) && Number(v) > 0) months[k] = Number(v); });
        }
        const variable = f.variable === true ? { variable: true, months } : {};
        return { id: String(f.id || uid()), name: String(f.name || 'Fixed'), amount: Number(f.amount) || 0, dueDay: Math.min(Math.max(parseInt(f.dueDay, 10) || 1, 1), 31), start: f.start, end: isMonth(f.end) ? f.end : null, u: Number(f.u) || 0, ...variable };
      }),
    deleted,
    settings: { ...base.settings, ...(d.settings && typeof d.settings === 'object' ? d.settings : {}) },
    settingsU: Number(d.settingsU) || 0,
    pristine: d.pristine === true,
  };
}

// Combine two copies of the data (e.g. this device and the cloud). Per record, the newest edit wins;
// a deletion wins over any edit made before it.
function mergeStates(a, b) {
  const deleted = { ...a.deleted };
  Object.entries(b.deleted).forEach(([id, t]) => { if (!(deleted[id] >= t)) deleted[id] = t; });
  const pick = (x, y) => {
    const map = new Map();
    [...x, ...y].forEach(r => { const cur = map.get(r.id); if (!cur || r.u > cur.u) map.set(r.id, r); });
    return [...map.values()].filter(r => !(deleted[r.id] >= r.u));
  };
  const out = {
    version: 1,
    categories: pick(a.categories, b.categories),
    expenses: pick(a.expenses, b.expenses),
    income: pick(a.income, b.income),
    fixed: pick(a.fixed, b.fixed),
    deleted,
    settings: (b.settingsU > a.settingsU ? b : a).settings,
    settingsU: Math.max(a.settingsU, b.settingsU),
    pristine: false,
  };
  // Two devices may each have a category with the same name. Keep the one with the smaller id
  // (so every device picks the same one) and move its expenses over.
  const byName = new Map();
  [...out.categories].sort((p, q) => (p.id < q.id ? -1 : 1)).forEach(c => {
    const k = c.name.trim().toLowerCase();
    const keep = byName.get(k);
    if (!keep) { byName.set(k, c); return; }
    out.expenses = out.expenses.map(e => (e.categoryId === c.id ? { ...e, categoryId: keep.id } : e));
    out.deleted[c.id] = Math.max(out.deleted[c.id] || 0, c.u);
  });
  out.categories = out.categories.filter(c => !(out.deleted[c.id] >= c.u));
  return normalize(out);
}

// Make `next` the authoritative data everywhere (restore, erase, undo): everything in it counts as
// edited now, and everything missing from it counts as deleted now.
function replaceState(next) {
  // Strictly newer than any deletion we know of, so restored records always win.
  const t = Math.max(Date.now(), ...Object.values(state.deleted).map(v => v + 1));
  const records = s => [...s.categories, ...s.expenses, ...s.income, ...s.fixed];
  const keep = new Set(records(next).map(r => r.id));
  next.deleted = { ...state.deleted, ...next.deleted };
  records(state).forEach(r => { if (!keep.has(r.id)) next.deleted[r.id] = t; });
  records(next).forEach(r => { r.u = t; delete next.deleted[r.id]; });
  next.settingsU = t;
  state = next;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* fall through to defaults */ }
  return defaultState();
}

function persistLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast("Couldn't save. Your browser is blocking storage."); }
}

// Call after every change the user makes.
function save() {
  state.pristine = false;
  persistLocal();
  if (typeof Sync !== 'undefined') Sync.changed();
}

const stamp = r => { r.u = Date.now(); return r; };
// `after` is the record's own edit time, so a deletion is never older than the record (clock differences between devices).
const tomb = (id, after = 0) => { state.deleted[id] = Math.max(Date.now(), after + 1); };
const snapshot = () => JSON.stringify(state);
const undoTo = snap => () => { replaceState(normalize(JSON.parse(snap))); save(); render(); };

let state = load();
const now = new Date();
let view = { y: now.getFullYear(), m: now.getMonth() };
let selected = ymd(now);
let kind = 'expense';
let chosenCat = state.categories[0].id;
let editing = null;
let chartMode = 'daily';
let catFilter; // category id (null = Uncategorized) the payments list is filtered to; undefined = all
let pieMode = 'month'; // 'month' | 'week' | 'day'
let barGroups = [];
let calView = 'day'; // 'day' | 'week' | 'year'
let page = 'home';

/* ================= queries ================= */
const catOf = id => state.categories.find(c => c.id === id) || UNCATEGORIZED;
const expensesIn = (y, m) => { const p = ymKey(y, m) + '-'; return state.expenses.filter(e => e.date.startsWith(p)); };
const incomeIn = (y, m) => { const p = ymKey(y, m) + '-'; return state.income.filter(e => e.date.startsWith(p)); };
const fixedIn = (y, m) => {
  const k = ymKey(y, m);
  // A "changes every month" cost only counts in months where its amount was entered; nothing carries over.
  return state.fixed.filter(f => f.start <= k && (!f.end || f.end >= k))
    .map(f => {
      if (!f.variable) return f;
      const prev = Object.keys(f.months).filter(x => x < k).sort().pop();
      return { ...f, amount: f.months[k] || 0, pending: !(f.months[k] > 0), hint: prev ? f.months[prev] : 0 };
    })
    .sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name));
};
const isCurrentMonth = (y, m) => { const t = new Date(); return t.getFullYear() === y && t.getMonth() === m; };

function daysElapsed(y, m) {
  const t = new Date(), ty = t.getFullYear(), tm = t.getMonth();
  if (y < ty || (y === ty && m < tm)) return daysIn(y, m);
  if (y === ty && m === tm) return t.getDate();
  return 0;
}

// Group a list of expenses into per-category parts, in category order.
function partsFor(list) {
  const map = new Map();
  list.forEach(e => map.set(e.categoryId, (map.get(e.categoryId) || 0) + Number(e.amount)));
  const order = state.categories.map(c => c.id);
  const rank = id => { const i = order.indexOf(id); return i < 0 ? 999 : i; };
  return [...map].sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([id, amount]) => { const c = catOf(id); return { name: c.name, color: c.color, amount }; });
}

// Tooltip HTML, escaped once more so it can sit in a data-tip attribute.
function tipFor(title, total, parts) {
  const html = `<b>${esc(title)}</b><span class="tt-total">${money(total)}</span>` +
    parts.map(p => `<div class="tt-row"><i style="background:${p.color}"></i>${esc(p.name)}<span>${money(p.amount)}</span></div>`).join('');
  return esc(html);
}

/* ================= rendering ================= */
function render() {
  $('#monthLabel').textContent = calView === 'year' ? String(view.y) : monthName(view.y, view.m);
  renderPageNav();
  renderHeadline();
  renderHistory();
  renderChips();
  renderStats();
  renderBudget();
  renderBars();
  renderPie();
  renderCalSummary();
  renderCalendar();
  renderDay();
  renderFixed();
  renderBills();
  renderIncome();
  if ($('#settings').open) renderSettings();
}

// Month switcher shown at the top of the Insights and Income pages.
function renderPageNav() {
  document.querySelectorAll('.pm-nav').forEach(el => {
    el.innerHTML = `<button type="button" class="icon-btn" data-pm="-1" aria-label="Previous month">${ICON.prev}</button>
      <button type="button" class="pm-label" data-pm="0" title="Back to this month">${esc(monthName(view.y, view.m))}</button>
      <button type="button" class="icon-btn" data-pm="1" aria-label="Next month">${ICON.next}</button>`;
  });
}

// Every expense and income entry, newest day first, grouped by day.
function renderHistory() {
  const all = [
    ...state.expenses.map(e => ({ ...e, k: 'expense' })),
    ...state.income.map(e => ({ ...e, k: 'income' })),
  ].sort((a, b) => (a.date === b.date ? b.u - a.u : a.date < b.date ? 1 : -1));
  if (!all.length) {
    $('#historyList').innerHTML = '<li class="empty">Nothing logged yet.<br>Add your first expense from Home.</li>';
    return;
  }
  let html = '', last = '';
  all.forEach(e => {
    if (e.date !== last) {
      last = e.date;
      const d = parse(e.date);
      const dayTotal = sum(all.filter(x => x.date === e.date && x.k === 'expense'));
      html += `<li class="day-head"><span>${esc(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }))}</span><span>${dayTotal ? money(dayTotal) : ''}</span></li>`;
    }
    if (e.k === 'expense') {
      const c = catOf(e.categoryId);
      html += row(c.color, c.name, e.note, money(e.amount), `expense:${e.id}`, e.pics);
    } else {
      html += row('var(--pos)', e.source, e.note, `<span class="pos">+${money(e.amount)}</span>`, `income:${e.id}`, e.pics);
    }
  });
  $('#historyList').innerHTML = html;
}

// Big total at the top: everything spent in the viewed month, split into day-to-day and fixed.
// The top total can show the viewed month or the selected day (hlMode). The arrows (and a swipe on the
// header) step by month or by day to match, so months can be switched without scrolling to the calendar.
let hlMode = 'month'; // 'month' | 'day'
try { if (localStorage.getItem('mt-hl') === 'day') hlMode = 'day'; } catch (e) { /* ignore */ }

function renderHeadline() {
  const { y, m } = view;
  const day = hlMode === 'day';
  const d = parse(selected), n = daysIn(d.getFullYear(), d.getMonth());
  const spent = day ? sum(state.expenses.filter(e => e.date === selected)) : sum(expensesIn(y, m));
  const fixed = day ? sum(fixedIn(d.getFullYear(), d.getMonth()).filter(f => Math.min(f.dueDay, n) === d.getDate())) : sum(fixedIn(y, m));
  const total = spent + fixed;
  const month = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long' });
  const label = day
    ? `Spent on ${d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`
    : `Spent in ${month}${y !== new Date().getFullYear() ? ' ' + y : ''}`;
  const bar = total
    ? `<span style="flex:${spent} 0 0;background:var(--accent)"></span><span style="flex:${fixed} 0 0;background:${FIXED_SHADES[0]}"></span>`
    : '';
  $('#headline').innerHTML = `
    <div class="hl-top">
      <button type="button" class="icon-btn" data-hl-step="-1" aria-label="Previous ${day ? 'day' : 'month'}">${ICON.prev}</button>
      <div class="hl-label">${label}</div>
      <button type="button" class="icon-btn" data-hl-step="1" aria-label="Next ${day ? 'day' : 'month'}">${ICON.next}</button>
      <span class="seg hl-mode" role="group" aria-label="Show total for">
        <button type="button" data-hl-mode="month" class="${day ? '' : 'on'}">Month</button>
        <button type="button" data-hl-mode="day" class="${day ? 'on' : ''}">Day</button>
      </span>
    </div>
    <div class="hl-total">${money(total)}</div>
    <div class="hl-bar">${bar}</div>
    <div class="hl-sub">
      <span><i style="background:var(--accent)"></i>${money(spent)} day-to-day</span>
      <span><i style="background:${FIXED_SHADES[0]}"></i>${money(fixed)} fixed</span>
    </div>`;
}

function renderChips() {
  if (!state.categories.some(c => c.id === chosenCat)) chosenCat = state.categories[0].id;
  $('#catChips').innerHTML = state.categories.map(c =>
    `<button type="button" class="chip${c.id === chosenCat ? ' on' : ''}" data-id="${esc(c.id)}" style="--c:${c.color}"><i></i>${esc(c.name)}</button>`
  ).join('') + '<button type="button" class="chip add-chip" data-act="settings">+ Edit</button>';
}

function renderStats() {
  const { y, m } = view;
  const spent = sum(expensesIn(y, m));
  const fixed = sum(fixedIn(y, m));
  const income = sum(incomeIn(y, m));
  const net = income - spent - fixed;
  const days = daysElapsed(y, m);
  const perDay = days ? spent / days : null;
  const monthly = monthlyAverage();
  const daySpent = sum(state.expenses.filter(e => e.date === selected));
  const dayLabel = selected === ymd(new Date()) ? 'Spent today' : `Spent on ${shortDate(parse(selected))}`;
  const tile = (label, value, cls = '', dot = '') =>
    `<div class="tile"><div class="lbl">${dot ? `<i style="background:${dot}"></i>` : ''}${label}</div><div class="val ${cls}">${value}</div></div>`;
  const avg = (label, v, note = '') =>
    `<div><span>${label}</span><b>${v == null ? '—' : money(v)}</b>${note ? `<small>${note}</small>` : ''}</div>`;
  $('#stats').innerHTML = `
    <div class="tiles">
      ${tile(dayLabel, money(daySpent), '', 'var(--accent)')}
      ${tile('Fixed costs', money(fixed), '', FIXED_SHADES[0])}
      ${tile('Income', money(income), 'pos', 'var(--pos)')}
      ${tile('Left over', money(net), net >= 0 ? 'pos' : 'neg')}
    </div>
    <div class="avgs">
      ${avg('Average per day', perDay)}
      ${avg('per week', perDay == null ? null : perDay * 7)}
      ${avg('per month', monthly.value, monthly.note)}
    </div>`;
}

// Average daily spending per month: completed months in the last 6 (current month only if it's all we have).
function monthlyAverage() {
  const t = new Date();
  const done = [];
  let partial = null;
  for (let i = 0; i < 6; i++) {
    const d = new Date(view.y, view.m - i, 1);
    const y = d.getFullYear(), m = d.getMonth();
    if (d > t) continue;
    const ex = expensesIn(y, m);
    if (!ex.length) continue;
    if (isCurrentMonth(y, m)) partial = sum(ex);
    else done.push(sum(ex));
  }
  if (done.length) return { value: sum(done, x => x) / done.length, note: `last ${done.length} mo` };
  if (partial != null) return { value: partial, note: 'so far' };
  return { value: null, note: '' };
}

function renderBudget() {
  const el = $('#budgetCard');
  const budget = Number(state.settings.budget) || 0;
  if (!budget) {
    el.innerHTML = '<div class="budget-empty">No monthly budget yet. <button type="button" class="link" data-act="settings">Set one</button></div>';
    return;
  }
  const { y, m } = view;
  let used = sum(expensesIn(y, m));
  if (state.settings.budgetIncludesFixed) used += sum(fixedIn(y, m));
  const left = budget - used;
  const ratio = used / budget;
  const total = daysIn(y, m);
  const elapsed = daysElapsed(y, m);
  const remaining = isCurrentMonth(y, m) ? total - elapsed + 1 : (elapsed ? 0 : total);
  const cls = ratio > 1 ? 'over' : ratio > 0.85 ? 'warn' : '';
  let foot = left >= 0 ? `${money(left)} left` : `<span class="neg">${money(-left)} over budget</span>`;
  if (left > 0 && remaining > 0) foot += ` · about ${money(left / remaining)} a day for the ${remaining} day${remaining > 1 ? 's' : ''} left`;
  const pace = isCurrentMonth(y, m) ? `<div class="pace" style="left:${(elapsed / total) * 100}%" title="Where you'd be at an even pace"></div>` : '';
  el.innerHTML = `
    <div class="budget-top"><b>Budget</b><span>${money(used)} <span class="muted">of ${money(budget)}</span></span></div>
    <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.min(ratio, 1) * 100}%"></div>${pace}</div>
    <div class="budget-foot">${foot}</div>`;
}

/* ---------- bar chart ---------- */
function dailyGroups() {
  const { y, m } = view;
  const ex = expensesIn(y, m);
  const todayKey = ymd(new Date());
  const groups = [];
  for (let d = 1; d <= daysIn(y, m); d++) {
    const key = `${ymKey(y, m)}-${pad(d)}`;
    const list = ex.filter(e => e.date === key);
    groups.push({
      key, label: String(d), title: parse(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      total: sum(list), parts: partsFor(list), active: key === selected,
      showLabel: d === 1 || d % 5 === 0, strong: key === todayKey,
    });
  }
  // Don't let a regular day label collide with today's bold label.
  const t = groups.findIndex(g => g.strong);
  if (t >= 0) [t - 1, t + 1].forEach(i => { if (groups[i]) groups[i].showLabel = false; });
  const elapsed = daysElapsed(y, m);
  groups.avg = elapsed ? sum(ex) / elapsed : 0;
  return groups;
}

function weeklyGroups() {
  const ws = state.settings.weekStart;
  const ref = isCurrentMonth(view.y, view.m) ? new Date() : new Date(view.y, view.m, daysIn(view.y, view.m));
  const lastStart = addDays(ref, -((ref.getDay() - ws + 7) % 7));
  const first = state.expenses.reduce((a, e) => (!a || e.date < a ? e.date : a), null);
  const groups = [];
  for (let i = 11; i >= 0; i--) {
    const s = addDays(lastStart, -7 * i), e = addDays(s, 6);
    const sk = ymd(s), ek = ymd(e);
    const list = state.expenses.filter(x => x.date >= sk && x.date <= ek);
    groups.push({
      key: sk, label: shortDate(s), title: `${shortDate(s)} – ${shortDate(e)}`,
      total: sum(list), parts: partsFor(list), active: selected >= sk && selected <= ek,
      showLabel: i % 3 === 0, counts: !!first && ek >= first,
    });
  }
  const counted = groups.filter(g => g.counts);
  groups.avg = counted.length ? sum(counted, g => g.total) / counted.length : 0;
  return groups;
}

// Round the axis max up so the 3 gridlines land on friendly numbers.
function niceMax(v) {
  const raw = v / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  return step * 3;
}

function renderBars() {
  const el = $('#barChart');
  const groups = chartMode === 'daily' ? dailyGroups() : weeklyGroups();
  barGroups = groups;
  const W = Math.max(el.clientWidth, 260), H = 220;
  const padL = 44, padR = 4, padT = 14, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const peak = Math.max(...groups.map(g => g.total), groups.avg);
  const max = peak > 0 ? niceMax(peak) : 300;
  const bw = iw / groups.length;
  const gap = Math.min(bw * 0.28, 8);
  const yAt = v => padT + ih - (v / max) * ih;

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${chartMode} spending chart">`;
  for (let i = 0; i <= 3; i++) {
    const v = (max * i) / 3, yy = yAt(v);
    svg += `<line class="gridline" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>`;
    svg += `<text class="axis" x="${padL - 8}" y="${yy + 4}" text-anchor="end">${money(v, true)}</text>`;
  }
  groups.forEach((g, i) => {
    const x0 = padL + i * bw, x = x0 + gap / 2, w = bw - gap;
    let yb = padT + ih;
    svg += `<g class="bar${g.active ? ' active' : ''}" data-i="${i}">`;
    svg += `<rect class="hit" x="${x0}" y="${padT}" width="${bw}" height="${ih}" rx="4"/>`;
    g.parts.forEach(p => {
      const h = (p.amount / max) * ih;
      yb -= h;
      svg += `<rect x="${x}" y="${yb}" width="${w}" height="${h}" fill="${p.color}" rx="${Math.min(2, w / 4)}"/>`;
    });
    svg += '</g>';
    if (g.showLabel || g.strong) svg += `<text class="axis${g.strong ? ' strong' : ''}" x="${x0 + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(g.label)}</text>`;
  });
  if (groups.avg > 0) {
    const yy = yAt(groups.avg);
    svg += `<line class="avg-line" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>`;
    svg += `<text class="avg-label" x="${W - padR}" y="${yy - 5}" text-anchor="end">avg ${money(groups.avg, true)}</text>`;
  }
  if (peak === 0) svg += `<text class="empty-note" x="${padL + iw / 2}" y="${padT + ih / 2}" text-anchor="middle">No spending logged yet</text>`;
  el.innerHTML = svg + '</svg>';
}

/* ---------- pie ---------- */
function renderPie() {
  const { y, m } = view;
  const el = $('#pie');
  const r = periodRange(pieMode);
  $('#piePeriod').textContent = r.title;
  $('#pieFixedLabel').hidden = pieMode !== 'month';
  let slices = partsFor(state.expenses.filter(e => e.date >= r.from && e.date <= r.to));
  if (pieMode === 'month' && $('#pieFixed').checked) {
    fixedIn(y, m).filter(f => f.amount > 0).forEach((f, i) => slices.push({ name: f.name, color: FIXED_SHADES[i % FIXED_SHADES.length], amount: f.amount }));
  }
  slices = slices.filter(s => s.amount > 0).sort((a, b) => b.amount - a.amount);
  const total = sum(slices);
  const R = 72, SW = 28, C = 2 * Math.PI * R;
  let svg = '<svg viewBox="0 0 200 200" role="img" aria-label="Spending by category">';
  if (!total) {
    el.innerHTML = svg + `<circle cx="100" cy="100" r="${R}" fill="none" stroke="#f2f2f2" stroke-width="${SW}"/>` +
      '<text class="pie-sub" x="100" y="104" text-anchor="middle">Nothing yet</text></svg>';
    return;
  }
  const gap = slices.length > 1 ? 2 : 0;
  let offset = 0;
  slices.forEach(s => {
    const len = (s.amount / total) * C;
    const vis = Math.max(len - gap, 0.5);
    const pct = Math.round((s.amount / total) * 100);
    svg += `<circle class="slice" cx="100" cy="100" r="${R}" fill="none" stroke="${s.color}" stroke-width="${SW}"
      stroke-dasharray="${vis} ${C - vis}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)"
      data-tip="${tipFor(`${s.name} · ${pct}%`, s.amount, [])}"/>`;
    offset += len;
  });
  svg += `<text class="pie-total" x="100" y="102" text-anchor="middle">${money(total, total >= 1e5)}</text>`;
  svg += `<text class="pie-sub" x="100" y="120" text-anchor="middle">${{ month: 'this month', week: 'this week', day: 'this day' }[pieMode]}</text></svg>`;
  const top = slices[0].amount;
  const legend = slices.map(s => `
    <li>
      <i style="background:${s.color}"></i>
      <span class="name">${esc(s.name)}<span class="pct">${Math.round((s.amount / total) * 100)}%</span></span>
      <b>${money(s.amount)}</b>
      <div class="mini"><span style="width:${(s.amount / top) * 100}%;background:${s.color}"></span></div>
    </li>`).join('');
  el.innerHTML = svg + `<ul class="legend">${legend}</ul>`;
}

/* ---------- calendar ---------- */
// Day / week / month totals for the selected day, each with a small category bar.
function renderCalSummary() {
  $('#calSummary').hidden = calView !== 'day';
  if (calView !== 'day') return;
  const d = parse(selected);
  const todayKey = ymd(new Date());
  const start = addDays(d, -((d.getDay() - state.settings.weekStart + 7) % 7));
  const end = addDays(start, 6);
  const sk = ymd(start), ek = ymd(end);
  const dayList = state.expenses.filter(e => e.date === selected);
  const weekList = state.expenses.filter(e => e.date >= sk && e.date <= ek);
  const monthList = expensesIn(view.y, view.m);
  let weekDays = 0;
  for (let i = 0; i < 7; i++) if (ymd(addDays(start, i)) <= todayKey) weekDays++;
  const monthDays = daysElapsed(view.y, view.m);
  const perDay = (list, n) => (n ? `avg ${money(Math.round(sum(list) / n))}/day` : '—');

  const box = (label, list, sub) => {
    const total = sum(list);
    const bar = partsFor(list).map(p => `<span style="flex:${p.amount} 0 0;background:${p.color}"></span>`).join('');
    return `<div class="cs">
      <div class="lbl">${esc(label)}</div>
      <div class="val">${money(total)}</div>
      <div class="cs-bar">${bar}</div>
      <div class="sub">${sub}</div>
    </div>`;
  };
  $('#calSummary').innerHTML =
    box(selected === todayKey ? 'Today' : shortDate(d), dayList, `${dayList.length} item${dayList.length === 1 ? '' : 's'}`) +
    box(`${shortDate(start)} – ${shortDate(end)}`, weekList, perDay(weekList, weekDays)) +
    box(new Date(view.y, view.m, 1).toLocaleDateString('en-US', { month: 'long' }), monthList, perDay(monthList, monthDays));
}

// A tile showing a period's total and a small category bar (used by the weekly and monthly views).
function periodTile(attrs, cls, label, list, sub) {
  const bar = partsFor(list).map(p => `<span style="flex:${p.amount} 0 0;background:${p.color}"></span>`).join('');
  const total = sum(list);
  return `<button type="button" class="ptile ${cls}" ${attrs}>
    <span class="lbl">${esc(label)}</span>
    <span class="val">${money(total)}</span>
    <span class="cs-bar">${bar}</span>
    <span class="sub">${sub}</span>
  </button>`;
}

const itemsText = list => `${list.length} item${list.length === 1 ? '' : 's'}`;

function renderWeekTiles() {
  const { y, m } = view;
  const ws = state.settings.weekStart;
  const last = new Date(y, m, daysIn(y, m));
  const first = new Date(y, m, 1);
  const todayKey = ymd(new Date());
  let s = addDays(first, -((first.getDay() - ws + 7) % 7));
  let html = '<div class="tiles-grid">';
  while (s <= last) {
    const e = addDays(s, 6);
    const sk = ymd(s), ek = ymd(e);
    const list = state.expenses.filter(x => x.date >= sk && x.date <= ek);
    const inMonthStart = s < first ? first : s;
    const cls = [];
    if (selected >= sk && selected <= ek) cls.push('sel');
    if (todayKey >= sk && todayKey <= ek) cls.push('now');
    if (sk > todayKey) cls.push('future');
    html += periodTile(`data-date="${ymd(inMonthStart)}"`, cls.join(' '), `${shortDate(s)} – ${shortDate(e)}`, list, itemsText(list));
    s = addDays(s, 7);
  }
  $('#calendar').innerHTML = html + '</div>';
}

function renderYearTiles() {
  const { y } = view;
  const t = new Date();
  let html = '<div class="tiles-grid">';
  let yearTotal = 0;
  for (let m = 0; m < 12; m++) {
    const list = expensesIn(y, m);
    yearTotal += sum(list);
    const cls = [];
    if (m === view.m) cls.push('sel');
    if (isCurrentMonth(y, m)) cls.push('now');
    if (y > t.getFullYear() || (y === t.getFullYear() && m > t.getMonth())) cls.push('future');
    html += periodTile(`data-month="${m}"`, cls.join(' '), new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long' }), list, itemsText(list));
  }
  $('#calendar').innerHTML = html + `</div><div class="cal-legend"><span>Total for ${y}: <b>${money(yearTotal)}</b></span></div>`;
}

function renderCalendar() {
  if (calView === 'week') return renderWeekTiles();
  if (calView === 'year') return renderYearTiles();
  const { y, m } = view;
  const n = daysIn(y, m);
  const ws = state.settings.weekStart;
  const lead = (new Date(y, m, 1).getDay() - ws + 7) % 7;
  const ex = expensesIn(y, m);
  const totals = [];
  for (let d = 1; d <= n; d++) totals[d] = sum(ex.filter(e => e.date === `${ymKey(y, m)}-${pad(d)}`));
  const max = Math.max(0, ...totals.filter(Boolean));
  const fixedDays = new Set(fixedIn(y, m).map(f => Math.min(f.dueDay, n)));
  const todayKey = ymd(new Date());

  let html = '<div class="cal">';
  for (let i = 0; i < 7; i++) html += `<div class="dow">${DAY_NAMES[(i + ws) % 7]}</div>`;
  for (let i = 0; i < lead; i++) html += '<div></div>';
  for (let d = 1; d <= n; d++) {
    const key = `${ymKey(y, m)}-${pad(d)}`;
    const t = totals[d];
    const level = t ? 0.14 + 0.86 * Math.pow(t / max, 0.7) : 0;
    const cls = ['day'];
    if (level > 0.55) cls.push('dark');
    if (key === selected) cls.push('sel');
    if (key === todayKey) cls.push('today');
    if (key > todayKey) cls.push('future');
    const style = t ? ` style="background:rgba(${HEAT_RGB},${level.toFixed(3)})"` : '';
    html += `<button type="button" class="${cls.join(' ')}" data-date="${key}"${style} aria-label="${shortDate(parse(key))}${t ? ', ' + money(t) : ''}">
      <span class="dn">${d}</span>${t ? `<span class="amt">${money(t, true)}</span>` : ''}${fixedDays.has(d) ? '<i class="fx"></i>' : ''}
    </button>`;
  }
  html += '</div><div class="cal-legend"><span>Less<span class="heat"></span>More</span><span><i class="fx-key"></i>Fixed cost due</span></div>';
  $('#calendar').innerHTML = html;
}

/* ---------- selected period ---------- */
// The date range a period covers around the selected day: 'day', 'week' or 'month'.
function periodRange(mode) {
  const d = parse(selected);
  if (mode === 'day') return { from: selected, to: selected, title: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) };
  if (mode === 'week') {
    const s = addDays(d, -((d.getDay() - state.settings.weekStart + 7) % 7));
    const e = addDays(s, 6);
    return { from: ymd(s), to: ymd(e), title: `${shortDate(s)} – ${shortDate(e)}` };
  }
  const p = ymKey(view.y, view.m) + '-';
  return { from: p + '01', to: p + '31', title: monthName(view.y, view.m) };
}

// Category breakdown (bar + list) and the editable payments list for the picked day / week / month.
function renderDay() {
  const mode = calView === 'year' ? 'month' : calView === 'week' ? 'week' : 'day';
  const r = periodRange(mode);
  const ex = state.expenses.filter(e => e.date >= r.from && e.date <= r.to);
  const total = sum(ex);
  if (catFilter !== undefined && !ex.some(e => e.categoryId === catFilter)) catFilter = undefined;

  $('#catTitle').textContent = `Categories · ${r.title}`;
  $('#catTotal').textContent = total ? money(total) : '';
  const parts = [...new Set(ex.map(e => e.categoryId))].map(id => ({ id, ...catOf(id), amount: sum(ex.filter(e => e.categoryId === id)) }))
    .sort((a, b) => b.amount - a.amount);
  const bar = parts.map(p => `<span style="flex:${p.amount} 0 0;background:${p.color}"></span>`).join('');
  $('#catList').innerHTML = parts.length
    ? `<li class="bd-bar"><div class="cs-bar">${bar}</div></li>` + parts.map(p =>
      `<li class="bd-row${p.id === catFilter ? ' on' : ''}" data-cat="${esc(p.id == null ? '' : p.id)}" data-none="${p.id == null ? 1 : ''}" tabindex="0"><i class="dot" style="background:${p.color}"></i><div class="li-main"><b>${esc(p.name)}</b></div><span class="pct">${Math.round((p.amount / total) * 100)}%</span><span class="amt">${money(p.amount)}</span></li>`).join('')
    : '<li class="empty">Nothing spent in this period.</li>';

  const shown = catFilter === undefined ? ex : ex.filter(e => e.categoryId === catFilter);
  const filterNote = catFilter === undefined ? '' : ` · ${catOf(catFilter).name}`;
  $('#dayTitle').textContent = r.title + filterNote;
  $('#dayTotal').textContent = shown.length ? money(sum(shown)) : '';

  const entry = e => { const c = catOf(e.categoryId); return row(c.color, c.name, e.note, money(e.amount), `expense:${e.id}`, e.pics); };
  let html = '';
  if (mode === 'day') {
    const d = parse(selected), n = daysIn(d.getFullYear(), d.getMonth());
    const inc = catFilter === undefined ? state.income.filter(e => e.date === selected) : [];
    const fx = catFilter === undefined ? fixedIn(d.getFullYear(), d.getMonth()).filter(f => Math.min(f.dueDay, n) === d.getDate()) : [];
    html = [
      ...shown.map(entry),
      ...inc.map(e => row('var(--pos)', e.source, e.note, `<span class="pos">+${money(e.amount)}</span>`, `income:${e.id}`, e.pics)),
      ...fx.map(f => `<li class="fixed-row"><i class="dot" style="background:${FIXED_SHADES[0]}"></i><div class="li-main"><b>${esc(f.name)}</b><small>Fixed cost due</small></div><span class="amt">${f.pending ? 'Not entered' : money(f.amount)}</span></li>`),
    ].join('');
  } else {
    let last = '';
    [...shown].sort((a, b) => (a.date === b.date ? b.u - a.u : a.date < b.date ? 1 : -1)).forEach(e => {
      if (e.date !== last) {
        last = e.date;
        html += `<li class="day-head"><span>${esc(parse(e.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}</span><span>${money(sum(shown.filter(x => x.date === e.date)))}</span></li>`;
      }
      html += entry(e);
    });
  }
  $('#dayList').innerHTML = html || '<li class="empty">Nothing logged for this period.<br>Add something above.</li>';
}

const CLIP_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3l7.5-7.5"/></svg>';

// Deleting happens inside the edit box (✎), so a row only has the edit button (and a paperclip when it has photos).
function row(color, title, note, amountHtml, ref, pics) {
  return `<li>
    <i class="dot" style="background:${color}"></i>
    <div class="li-main"><b>${esc(title)}</b>${note ? `<small>${esc(note)}</small>` : ''}</div>
    <span class="amt">${amountHtml}</span>
    <span class="acts">
      ${pics && pics.length ? `<button type="button" class="icon-btn" data-pics="${esc(ref)}" aria-label="View attached photos" title="Attached photos">${CLIP_ICON}</button>` : ''}
      <button type="button" class="icon-btn" data-edit="${esc(ref)}" aria-label="Edit">${ICON.edit}</button>
    </span>
  </li>`;
}

/* ---------- fixed & income ---------- */
function renderFixed() {
  const list = fixedIn(view.y, view.m);
  $('#fixedTotal').textContent = list.length ? `${money(sum(list))} a month` : '';
  $('#fixedList').innerHTML = list.length
    ? list.map((f, i) => `<li>
        <i class="dot" style="background:${FIXED_SHADES[i % FIXED_SHADES.length]}"></i>
        <div class="li-main"><b>${esc(f.name)}</b><small>Due on the ${ordinal(f.dueDay)}${f.variable ? ' · changes monthly' : ''}</small></div>
        ${f.variable && !f.pending
          ? `<button type="button" class="amt amt-edit" data-fx-edit="${esc(f.id)}" title="Tap to change this month's amount" aria-label="${esc(f.name)} ${money(f.amount)} for ${monthName(view.y, view.m)}. Change amount">${money(f.amount)}</button>`
          : f.variable
          ? `<input class="fx-amt${f.pending ? ' pending' : ''}" data-fx-amt="${esc(f.id)}" type="number" inputmode="decimal" step="0.01" min="0" placeholder="${f.hint ? 'last: ' + f.hint : '฿ this month'}" value="${f.pending ? '' : f.amount}" aria-label="${esc(f.name)} amount for ${monthName(view.y, view.m)}">`
          : `<span class="amt">${money(f.amount)}</span>`}
        <button type="button" class="pill-btn" data-fx-var="${esc(f.id)}" title="${f.variable ? 'Use the same amount every month' : 'Enter a new amount each month'}">${f.variable ? 'Varies' : 'Fixed'}</button>
        <button type="button" class="icon-btn" data-fx-del="${esc(f.id)}" title="Remove from this month on" aria-label="Remove ${esc(f.name)}">${ICON.x}</button>
      </li>`).join('')
    : '<li class="empty">No fixed costs yet. Add rent, gas, phone…</li>';
}

// Home prompt: monthly-varying costs still missing an amount for the viewed month (not for future months).
function renderBills() {
  const future = view.y > now.getFullYear() || (view.y === now.getFullYear() && view.m > now.getMonth());
  const todo = future ? [] : fixedIn(view.y, view.m).filter(f => f.pending);
  $('#billsCard').hidden = !todo.length;
  $('#billsList').innerHTML = todo.map(f => `<li>
      <i class="dot" style="background:${FIXED_SHADES[0]}"></i>
      <div class="li-main"><b>${esc(f.name)}</b><small>Due on the ${ordinal(f.dueDay)}</small></div>
      <input class="fx-amt pending" data-fx-amt="${esc(f.id)}" type="number" inputmode="decimal" step="0.01" min="0" placeholder="${f.hint ? 'last: ' + f.hint : '฿ this month'}" aria-label="${esc(f.name)} amount for ${monthName(view.y, view.m)}">
    </li>`).join('');
}

function renderIncome() {
  const list = incomeIn(view.y, view.m).sort((a, b) => (a.date < b.date ? 1 : -1));
  $('#incomeTotal').textContent = list.length ? money(sum(list)) : '';
  $('#incomeList').innerHTML = list.length
    ? list.map(e => row('var(--pos)', e.source, [shortDate(parse(e.date)), e.note].filter(Boolean).join(' · '), `<span class="pos">+${money(e.amount)}</span>`, `income:${e.id}`, e.pics)).join('')
    : '<li class="empty">No income this month. Switch the form on Home to “Income” to add some.</li>';
}

/* ---------- settings ---------- */
function renderSettings() {
  $('#catEdit').innerHTML = state.categories.map(c => {
    const count = state.expenses.filter(e => e.categoryId === c.id).length;
    return `<li data-id="${esc(c.id)}">
      <input type="color" value="${c.color}" data-k="color" aria-label="Color for ${esc(c.name)}">
      <input value="${esc(c.name)}" data-k="name" maxlength="24" aria-label="Category name">
      <span class="count">${count} item${count === 1 ? '' : 's'}</span>
      <button type="button" class="icon-btn" data-cat-del ${state.categories.length < 2 ? 'disabled' : ''} aria-label="Delete ${esc(c.name)}">${ICON.x}</button>
    </li>`;
  }).join('');
  $('#newCatColor').value = PALETTE[state.categories.length % PALETTE.length];
  if (document.activeElement !== $('#budgetInput')) $('#budgetInput').value = state.settings.budget || '';
  $('#budgetFixed').checked = !!state.settings.budgetIncludesFixed;
  document.querySelectorAll('#weekStartSeg button').forEach(b => b.classList.toggle('on', Number(b.dataset.ws) === state.settings.weekStart));
  if (typeof Sync !== 'undefined') Sync.render();
}

/* ================= actions ================= */
function selectDay(key) {
  selected = key;
  const d = parse(key);
  view = { y: d.getFullYear(), m: d.getMonth() };
  if (!editing) $('#date').value = key;
  render();
}

function setKind(k) {
  kind = k;
  document.querySelectorAll('#kindToggle button').forEach(b => b.classList.toggle('on', b.dataset.kind === k));
  $('#catChips').hidden = k !== 'expense';
  $('#source').hidden = k !== 'income';
  $('#scanSlips').hidden = k !== 'expense';
}

// The categories, date and note stay tucked away until you start typing an amount.
function setFormOpen(open) {
  $('#entryExtra').classList.toggle('open', open);
}

// Tapping anywhere outside the form tucks the panel away, unless an amount is typed or an entry is being edited.
document.addEventListener('pointerdown', e => {
  if (editing || $('#amount').value.trim()) return;
  if (e.target.closest('.add, #toast, dialog')) return;
  setFormOpen(false);
});

function showPage(name) {
  page = name;
  document.querySelectorAll('.page').forEach(p => { p.hidden = p.id !== 'page-' + name; });
  document.querySelectorAll('#tabbar button').forEach(b => {
    b.classList.toggle('on', b.dataset.page === name);
    if (b.dataset.page === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#headline').hidden = name !== 'home';
  window.scrollTo(0, 0);
  render();
}

// Editing happens in a pop-up on top of whatever page you're on: the add form moves into it and back,
// so the page underneath (and your scroll position) is left exactly as it was.
const editDlg = $('#editDlg'), formHome = $('#entryForm').parentNode;
function closeEdit() {
  if (editDlg.open) editDlg.close();
  if ($('#entryForm').parentNode !== formHome) formHome.appendChild($('#entryForm'));
}
editDlg.addEventListener('close', () => { if (!editDlg.open && editing) resetForm(); }); // Esc / back gesture = cancel
$('#editClose').onclick = () => resetForm();

function resetForm() {
  closeEdit();
  setFormOpen(false);
  editing = null;
  $('#amount').value = '';
  $('#note').value = '';
  $('#source').value = '';
  updateCalc();
  $('#date').value = selected;
  $('#submitBtn').textContent = 'Add';
  $('#cancelEdit').hidden = true;
  $('#delEntry').hidden = true;
  PicForm.set([]);
}

function startEdit(ref) {
  const [k, id] = ref.split(':');
  const rec = (k === 'expense' ? state.expenses : state.income).find(x => x.id === id);
  if (!rec) return;
  if (editing) resetForm();
  $('#editBody').appendChild($('#entryForm'));
  $('#editTitle').textContent = k === 'expense' ? 'Edit payment' : 'Edit income';
  if (!editDlg.open) editDlg.showModal();
  setFormOpen(true);
  setKind(k);
  editing = { kind: k, id };
  $('#amount').value = rec.amount;
  updateCalc();
  $('#date').value = rec.date;
  $('#note').value = rec.note || '';
  if (k === 'expense') { chosenCat = rec.categoryId; renderChips(); }
  else $('#source').value = rec.source || '';
  $('#submitBtn').textContent = 'Save';
  $('#cancelEdit').hidden = false;
  $('#delEntry').hidden = false;
  PicForm.set(rec.pics || []);
  $('#amount').focus({ preventScroll: true });
}

function deleteEntry(ref) {
  const [k, id] = ref.split(':');
  const key = k === 'expense' ? 'expenses' : 'income';
  const rec = state[key].find(x => x.id === id);
  if (!rec) return;
  const snap = snapshot();
  state[key] = state[key].filter(x => x.id !== id);
  tomb(id, rec.u);
  if (editing && editing.id === id) resetForm();
  save();
  render();
  toast(`Deleted ${money(rec.amount)}`, undoTo(snap));
}

function upsert(list, rec) {
  const i = list.findIndex(x => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
}

/* ---------- csv / backup ---------- */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['Type', 'Date', 'Category / Source', 'Amount (THB)', 'Note']];
  [...state.expenses].sort((a, b) => a.date.localeCompare(b.date))
    .forEach(e => rows.push(['Expense', e.date, catOf(e.categoryId).name, e.amount, e.note]));
  [...state.income].sort((a, b) => a.date.localeCompare(b.date))
    .forEach(e => rows.push(['Income', e.date, e.source, e.amount, e.note]));
  state.fixed.forEach(f => {
    if (!f.variable) return rows.push(['Fixed (monthly)', `${f.start} to ${f.end || 'now'}`, f.name, f.amount, `Due on the ${ordinal(f.dueDay)}`]);
    Object.keys(f.months).sort().forEach(k => rows.push(['Fixed (varies)', k, f.name, f.months[k], `Due on the ${ordinal(f.dueDay)}`]));
  });
  download(`money-${ymd(new Date())}.csv`, '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

/* ---------- toast & tooltip ---------- */
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body; // a modal hides everything outside it
  if (el.parentNode !== host) host.appendChild(el);
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  el.classList.toggle('has-undo', !!undo);
  if (undo) el.querySelector('button').onclick = () => { undo(); el.hidden = true; };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 6000 : 2200);
}

const tip = $('#tooltip');
function showTip(e) {
  const t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
  if (!t) { tip.hidden = true; return; }
  tip.innerHTML = t.getAttribute('data-tip');
  tip.hidden = false;
  const r = tip.getBoundingClientRect(), off = 14;
  let x = e.clientX + off, y = e.clientY + off;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - off;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - off;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}

/* ================= events ================= */
$('#prevMonth').onclick = () => goMonth(calView === 'year' ? new Date(view.y - 1, view.m, 1) : new Date(view.y, view.m - 1, 1));
$('#nextMonth').onclick = () => goMonth(calView === 'year' ? new Date(view.y + 1, view.m, 1) : new Date(view.y, view.m + 1, 1));
$('#monthLabel').onclick = () => selectDay(ymd(new Date()));

document.querySelectorAll('#calView button').forEach(b => b.onclick = () => {
  calView = b.dataset.view;
  document.querySelectorAll('#calView button').forEach(x => x.classList.toggle('on', x === b));
  render();
});

document.querySelectorAll('#tabbar button').forEach(b => b.onclick = () => showPage(b.dataset.page));

document.addEventListener('click', e => {
  const b = e.target.closest('[data-pm]');
  if (!b) return;
  const step = Number(b.dataset.pm);
  goMonth(step === 0 ? new Date() : new Date(view.y, view.m + step, 1));
});
function stepHeadline(dir) {
  if (hlMode === 'day') { const d = parse(selected); selectDay(ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir))); }
  else goMonth(new Date(view.y, view.m + dir, 1));
}

const hlEl = $('#headline');
hlEl.addEventListener('click', e => {
  const s = e.target.closest('[data-hl-step]'), md = e.target.closest('[data-hl-mode]');
  if (s) stepHeadline(Number(s.dataset.hlStep));
  else if (md) {
    hlMode = md.dataset.hlMode;
    try { localStorage.setItem('mt-hl', hlMode); } catch (err) { /* ignore */ }
    renderHeadline();
  }
});
// Swipe the header: left = next, right = previous.
let swipe = null;
hlEl.addEventListener('touchstart', e => { swipe = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
hlEl.addEventListener('touchend', e => {
  if (!swipe) return;
  const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2) stepHeadline(dx < 0 ? 1 : -1);
}, { passive: true });

function goMonth(d) {
  view = { y: d.getFullYear(), m: d.getMonth() };
  selected = isCurrentMonth(view.y, view.m) ? ymd(new Date()) : ymd(d);
  render();
}

document.querySelectorAll('#kindToggle button').forEach(b => b.onclick = () => {
  if (editing) resetForm();
  setKind(b.dataset.kind);
});

$('#catChips').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'settings') return openSettings();
  chosenCat = b.dataset.id;
  renderChips();
};

$('#amount').addEventListener('focus', () => setFormOpen(true));
$('#amount').addEventListener('input', () => setFormOpen(true));
$('#calcToggle').addEventListener('click', () => setFormOpen(true));

$('#entryForm').onsubmit = e => {
  e.preventDefault();
  const amount = calc($('#amount').value);
  const date = $('#date').value;
  if (!(amount > 0)) { toast('Check the amount'); $('#amount').focus(); return; }
  if (!isDate(date)) return;
  const note = $('#note').value.trim();
  const id = editing ? editing.id : uid();
  const u = Date.now();
  const pics = picsOf({ pics: PicForm.ids() });
  if (kind === 'expense') upsert(state.expenses, { id, date, amount, categoryId: chosenCat, note, u, ...pics });
  else upsert(state.income, { id, date, amount, source: $('#source').value.trim() || 'Income', note, u, ...pics });
  const wasEditing = !!editing;
  save();
  editing = null;
  if (!wasEditing) selectDay(date); // an edit leaves the page and day you were looking at alone
  resetForm();
  if (wasEditing) render();
  toast(wasEditing ? 'Saved' : `Added ${money(amount)}${kind === 'expense' ? ' · ' + catOf(chosenCat).name : ''}`);
};
$('#cancelEdit').onclick = resetForm;
$('#delEntry').onclick = () => { if (editing) deleteEntry(`${editing.kind}:${editing.id}`); };

/* ---------- calculator ---------- */
const hasMath = v => /[+\-*/×÷−()]/.test(String(v).trim().replace(/^[-−]/, ''));
function updateCalc() {
  const raw = $('#amount').value;
  const v = calc(raw);
  const show = hasMath(raw) && Number.isFinite(v);
  $('#calcResult').hidden = !show;
  if (show) $('#calcResult').textContent = '= ' + money(v);
}
function finishCalc() {
  const v = calc($('#amount').value);
  if (Number.isFinite(v)) $('#amount').value = String(v);
  updateCalc();
}
$('#amount').addEventListener('input', updateCalc);
$('#amount').addEventListener('keydown', e => {
  if (e.key === '=') { e.preventDefault(); finishCalc(); }
});
$('#calcToggle').onclick = () => {
  const open = $('#calcPad').hidden;
  $('#calcPad').hidden = !open;
  $('#calcToggle').classList.toggle('on', open);
  $('#calcToggle').setAttribute('aria-expanded', String(open));
  // While the keypad is open, tapping the amount shouldn't also pop up the phone keyboard.
  $('#amount').inputMode = open ? 'none' : 'decimal';
  if (open) $('#amount').blur();
};
$('#calcPad').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  const input = $('#amount'), k = b.dataset.k;
  if (k === 'C') input.value = '';
  else if (k === 'back') input.value = input.value.slice(0, -1);
  else if (k === '=') return finishCalc();
  else input.value += k;
  updateCalc();
};

document.querySelectorAll('#chartMode button').forEach(b => b.onclick = () => {
  chartMode = b.dataset.mode;
  document.querySelectorAll('#chartMode button').forEach(x => x.classList.toggle('on', x === b));
  renderBars();
});
$('#barChart').onclick = e => {
  const g = e.target.closest('.bar');
  if (g) selectDay(barGroups[Number(g.dataset.i)].key);
};
$('#pieFixed').onchange = renderPie;
// ‹ › move the chart to the previous / next day, week or month (same selection the rest of the app uses).
function stepPie(dir) {
  if (pieMode === 'month') goMonth(new Date(view.y, view.m + dir, 1));
  else selectDay(ymd(addDays(parse(selected), dir * (pieMode === 'week' ? 7 : 1))));
}
$('#piePrev').onclick = () => stepPie(-1);
$('#pieNext').onclick = () => stepPie(1);
document.querySelectorAll('#pieMode button').forEach(b => b.onclick = () => {
  pieMode = b.dataset.mode;
  document.querySelectorAll('#pieMode button').forEach(x => x.classList.toggle('on', x === b));
  renderPie();
});

$('#calendar').onclick = e => {
  const b = e.target.closest('button.day, button.ptile');
  if (!b) return;
  if (b.dataset.date) selectDay(b.dataset.date);
  else if (b.dataset.month) {
    // Pick that month and show its breakdown under the tiles.
    goMonth(new Date(view.y, Number(b.dataset.month), 1));
  }
};

function onListClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.edit) startEdit(b.dataset.edit);
  else if (b.dataset.pics) {
    const [k, id] = b.dataset.pics.split(':');
    const rec = (k === 'expense' ? state.expenses : state.income).find(x => x.id === id);
    if (rec) Viewer.show(rec.pics || []);
  }
}
$('#dayList').onclick = onListClick;

// Tap a category to filter the payments list to it; tap again to clear.
function toggleCatFilter(e) {
  const li = e.target.closest('.bd-row');
  if (!li) return;
  const id = li.dataset.none ? null : li.dataset.cat;
  catFilter = catFilter === id ? undefined : id;
  renderDay();
}
$('#catList').onclick = toggleCatFilter;
$('#catList').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCatFilter(e); } };
$('#catToggle').onclick = () => {
  const card = $('#catCard');
  card.classList.toggle('collapsed');
  $('#catToggle').setAttribute('aria-expanded', String(!card.classList.contains('collapsed')));
};
$('#incomeList').onclick = onListClick;
$('#historyList').onclick = onListClick;

$('#fixedForm').onsubmit = e => {
  e.preventDefault();
  const name = $('#fxName').value.trim();
  const variable = $('#fxVar').checked;
  const amount = Math.round((parseFloat($('#fxAmount').value) || 0) * 100) / 100;
  if (!name || (!variable && !(amount > 0))) return;
  const dueDay = Math.min(Math.max(parseInt($('#fxDay').value, 10) || 1, 1), 31);
  const k = ymKey(view.y, view.m);
  state.fixed.push({ id: uid(), name, amount: variable ? 0 : amount, dueDay, start: k, end: null, u: Date.now(),
    ...(variable ? { variable: true, months: amount > 0 ? { [k]: amount } : {} } : {}) });
  save();
  e.target.reset();
  render();
  toast(`${name} added from ${monthName(view.y, view.m)} on`);
};

$('#fxVar').onchange = e => {
  $('#fxAmount').required = !e.target.checked;
  $('#fxAmount').placeholder = e.target.checked ? '฿ This month (optional)' : '฿ Amount';
};

// Enter this month's amount for a cost that changes every month (like electricity).
$('#fixedList').onchange = $('#billsList').onchange = e => {
  const inp = e.target.closest('[data-fx-amt]');
  if (!inp) return;
  const f = state.fixed.find(x => x.id === inp.dataset.fxAmt);
  if (!f || !f.variable) return;
  const v = Math.round((parseFloat(inp.value) || 0) * 100) / 100;
  const k = ymKey(view.y, view.m);
  if (v > 0) f.months[k] = v; else delete f.months[k];
  stamp(f);
  save();
  render();
};

// Switch a cost between "same every month" and "changes every month".
function toggleVariable(f) {
  const k = ymKey(view.y, view.m), cur = fixedIn(view.y, view.m).find(x => x.id === f.id);
  if (f.variable) {
    // Back to fixed: the viewed month's amount (or the latest entered one) becomes the amount; earlier months keep theirs.
    const latest = Object.keys(f.months).filter(x => x <= k).sort().pop();
    f.amount = (cur && cur.amount) || (latest ? f.months[latest] : 0);
    if (!(f.amount > 0)) return toast('Enter an amount for this month first');
    delete f.variable; delete f.months;
  } else {
    // To varying: months before the viewed one keep the old amount, the viewed month starts with it, later ones are empty.
    f.months = {};
    for (let [y, m] = f.start.split('-').map(Number); ymKey(y, m - 1) <= k; m === 12 ? (y++, m = 1) : m++) f.months[ymKey(y, m - 1)] = f.amount;
    if (f.amount > 0) f.months[k] = f.amount;
    f.variable = true;
  }
  stamp(f);
}

$('#fixedList').onclick = e => {
  const ed = e.target.closest('[data-fx-edit]');
  if (ed) {
    const f = state.fixed.find(x => x.id === ed.dataset.fxEdit), k = ymKey(view.y, view.m);
    if (!f) return;
    const inp = document.createElement('input');
    inp.className = 'fx-amt';
    inp.type = 'number'; inp.inputMode = 'decimal'; inp.step = '0.01'; inp.min = '0';
    inp.value = f.months[k] || '';
    inp.setAttribute('data-fx-amt', f.id);
    inp.setAttribute('aria-label', `${f.name} amount for ${monthName(view.y, view.m)}`);
    inp.onblur = () => setTimeout(() => { if (inp.isConnected) render(); }, 0); // unchanged: back to plain amount
    ed.replaceWith(inp);
    inp.focus(); inp.select();
    return;
  }
  const t = e.target.closest('[data-fx-var]');
  if (t) {
    const f = state.fixed.find(x => x.id === t.dataset.fxVar);
    if (!f) return;
    const snap = snapshot();
    toggleVariable(f);
    if (snapshot() === snap) return;
    save();
    render();
    toast(`${f.name} ${f.variable ? 'now changes every month' : 'is now the same every month'}`, undoTo(snap));
    return;
  }
  const b = e.target.closest('[data-fx-del]');
  if (!b) return;
  const f = state.fixed.find(x => x.id === b.dataset.fxDel);
  if (!f) return;
  const snap = snapshot();
  const k = ymKey(view.y, view.m);
  if (f.start >= k) { state.fixed = state.fixed.filter(x => x !== f); tomb(f.id); }
  else { const p = new Date(view.y, view.m - 1, 1); f.end = ymKey(p.getFullYear(), p.getMonth()); stamp(f); }
  save();
  render();
  toast(`${f.name} removed from ${monthName(view.y, view.m)} on`, undoTo(snap));
};

document.addEventListener('click', e => {
  if (e.target.closest('[data-act="settings"]') && !e.target.closest('#catChips')) openSettings();
});

/* ---------- settings events ---------- */
const dlg = $('#settings');
function openSettings() { dlg.showModal(); renderSettings(); }
$('#openSettings').onclick = openSettings;
$('#closeSettings').onclick = () => dlg.close();
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener('close', () => { document.body.appendChild($('#toast')); render(); });

$('#catEdit').addEventListener('change', e => {
  const li = e.target.closest('li');
  const c = li && state.categories.find(x => x.id === li.dataset.id);
  if (!c) return;
  if (e.target.dataset.k === 'color') c.color = safeColor(e.target.value);
  if (e.target.dataset.k === 'name') c.name = e.target.value.trim() || c.name;
  stamp(c);
  save();
  render();
});
$('#catEdit').addEventListener('click', e => {
  const b = e.target.closest('[data-cat-del]');
  if (!b || state.categories.length < 2) return;
  const id = b.closest('li').dataset.id;
  const c = state.categories.find(x => x.id === id);
  const snap = snapshot();
  state.categories = state.categories.filter(x => x.id !== id);
  tomb(id);
  save();
  render();
  toast(`Deleted “${c.name}”`, undoTo(snap));
});
$('#catAdd').onsubmit = e => {
  e.preventDefault();
  const name = $('#newCatName').value.trim();
  if (!name) return;
  const c = { id: uid(), name, color: safeColor($('#newCatColor').value), u: Date.now() };
  state.categories.push(c);
  chosenCat = c.id;
  $('#newCatName').value = '';
  save();
  render();
};

$('#budgetInput').addEventListener('input', e => {
  state.settings.budget = Math.max(0, parseFloat(e.target.value) || 0);
  state.settingsU = Date.now();
  save();
  renderBudget();
});
$('#budgetFixed').onchange = e => {
  state.settings.budgetIncludesFixed = e.target.checked;
  state.settingsU = Date.now();
  save();
  render();
};
document.querySelectorAll('#weekStartSeg button').forEach(b => b.onclick = () => {
  state.settings.weekStart = Number(b.dataset.ws);
  state.settingsU = Date.now();
  save();
  render();
});

$('#exportCsv').onclick = exportCsv;
$('#backupJson').onclick = () => download(`money-backup-${ymd(new Date())}.json`, JSON.stringify(state, null, 2), 'application/json');
$('#restoreFile').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.expenses)) throw new Error('bad file');
      const snap = snapshot();
      replaceState(normalize(data));
      save();
      render();
      toast('Backup restored', undoTo(snap));
    } catch (err) {
      toast("That file isn't a Money backup");
    }
    e.target.value = '';
  };
  reader.readAsText(file);
};

let eraseArmed = false;
$('#eraseAll').onclick = e => {
  const b = e.currentTarget;
  if (!eraseArmed) {
    eraseArmed = true;
    b.textContent = 'Tap again to erase';
    setTimeout(() => { eraseArmed = false; b.textContent = 'Erase everything'; }, 3000);
    return;
  }
  eraseArmed = false;
  b.textContent = 'Erase everything';
  const snap = snapshot();
  replaceState(defaultState());
  save();
  resetForm();
  render();
  toast('Everything erased', undoTo(snap));
};

/* ---------- global ---------- */
document.addEventListener('pointermove', showTip);
document.addEventListener('pointerdown', showTip);
window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
// On phones, scrolling shows/hides the address bar and fires "resize"; only redraw when the width changes.
let resizeFrame, lastWidth = innerWidth;
window.addEventListener('resize', () => {
  if (innerWidth === lastWidth) return;
  lastWidth = innerWidth;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(renderBars);
});

/* ================= start ================= */
$('#date').value = selected;
render();
