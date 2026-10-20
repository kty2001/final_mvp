// 공용 상태·평가·알림·라우팅. 화면은 views/*.js가 VIEWS·ACTIONS·CHANGES·FORMS에 등록함

const STORE_KEY = 'site-ops-mvp-v7';
const clone = o => JSON.parse(JSON.stringify(o));
const $view = document.getElementById('view');
const PRODUCTS = [...new Set(VULNS.map(v => v.product))];
const STATUS_ORDER = { active: 0, resolved: 1, excluded: 2 };

// 화면 등록부: VIEWS[hash] = 렌더 함수, ACTIONS[data-action](id, el), CHANGES[data-change](el), FORMS[form id](FormData)
const VIEWS = {}, ACTIONS = {}, CHANGES = {}, FORMS = {};

let store;           // { current, simStep, vulns, feed, krIngested, tenants }
let state;           // 현재 고객사 (store.tenants[store.current])
let ui = freshUi();  // 화면 입력·미리보기 상태 (고객사 전환 시 초기화)

function freshUi() {
  return {
    chatLog: [], notifOpen: false, formError: '', open: new Set(),
    analysisFilter: 'active', taskFilter: 'open',
    assetTab: 'discover', editingAssetId: null, formDraft: null, intakeText: '', intakePreview: null,
    discoveryPreview: null, discoverySources: DISCOVERY_SOURCES.map(s => s.id),
    scanText: '', scanSource: '', scanPreview: null,
    overrideError: '', condDraft: {}, vendorDraft: {}, evidenceDraft: null, krPreview: null,
    auditFormId: null, starterDraft: null, opsPick: { component: 'db', fault: 'socket' },
  };
}

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function today() { return ymd(new Date()); }
function nowText() { const d = new Date(); return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function addDays(date, n) { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); }
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
const ddayText = n => (n > 0 ? `D-${n}` : n === 0 ? 'D-day' : `D+${-n}`);
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const badge = (label, cls) => `<span class="badge ${cls}">${esc(label)}</span>`;
const detailLink = key => `#analysis/${encodeURIComponent(key)}`;
const planOf = (s = state) => PLANS.find(p => p.id === s.plan) || PLANS[0];
const assetRoom = n => planOf().assetLimit == null || state.assets.length + n <= planOf().assetLimit;
const limitMsg = () => `${state.plan} 플랜 자산 한도(${planOf().assetLimit}개) 초과 — 요금제에서 플랜 변경 필요`;
// 다시 그려도 펼침 상태를 유지할 <details> 속성
const keep = id => `data-keep="${id}" ${ui.open.has(id) ? 'open' : ''}`;
const formData = form => Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v).trim()]));

function selectField(name, label, options, value) {
  return `<label>${label}<select name="${name}">${options.map(o => `<option ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
}

// ---------- 저장소 ----------
function seedTenant(seed) {
  return {
    id: seed.id, name: seed.name, industry: seed.industry, plan: seed.plan,
    assets: clone(seed.assets), trend: clone(seed.trend), tasks: [], history: [], snapshot: {}, seq: 100,
    overrides: {}, notifications: [], reportLog: [], schedules: clone(seed.schedules || DEFAULT_SCHEDULES),
    profile: clone(seed.profile || DEFAULT_PROFILE),
    dutyDue: Object.fromEntries(DUTIES.map(d => [d.id, addDays(today(), d.firstDueIn)])), dutyLog: [],
    conditionChecks: {}, vendorRequests: {}, decisions: {}, opsIncidents: [],
  };
}
function linkShared(s) {
  Object.values(s.tenants).forEach(t => { t.vulns = s.vulns; t.feed = s.feed; });
  return s;
}
function seedStore() {
  const s = { current: 'A', simStep: 0, vulns: clone(VULNS), feed: clone(SEED_FEED), krIngested: [], tenants: {} };
  SEED_TENANTS.forEach(seed => { s.tenants[seed.id] = seedTenant(seed); });
  return linkShared(s);
}
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return linkShared(JSON.parse(raw)); } catch (e) { /* 저장소 사용 불가 시 초기 데이터 사용 */ }
  return null;
}
function save() {
  // 공용 vulns·feed는 store에만 저장 (고객사별 중복 제외)
  const replacer = function (k, v) { return (k === 'vulns' || k === 'feed') && this !== store ? undefined : v; };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store, replacer)); } catch (e) { /* 무시 */ }
}
function withTenant(t, fn) {
  const prev = state;
  state = t;
  try { return fn(); } finally { state = prev; }
}
function switchTenant(id) {
  store.current = id;
  state = store.tenants[id];
  ui = freshUi();
  save();
}
function initTenants() {
  Object.values(store.tenants).forEach(t => withTenant(t, () => {
    if (t.assets.length && !Object.keys(t.snapshot).length) reassess('', true);
  }));
}

function addHistory(type, text, key) {
  state.history.unshift({ time: nowText(), type, text, key: key || null });
}
function notify(level, title, text, link) {
  state.notifications.unshift({ id: `N${++state.seq}`, time: nowText(), level, title, text, link, read: false });
}
function archiveReport(type, trigger, keys, recipients) {
  const report = buildReport(type, keys);
  const log = { id: `R${++state.seq}`, type, title: report.title, generatedAt: report.generatedAt, trigger, recipients: recipients || '', report };
  state.reportLog.unshift(log);
  return log;
}

// ---------- 평가 ----------
function applyOverride(a, o) {
  a.system = { label: a.label, cls: a.cls, status: a.status, priority: a.priority };
  a.override = o;
  a.overrideStale = o.basisLabel !== a.label;
  if (o.priority === '오탐') { a.status = 'excluded'; a.label = '오탐 처리'; a.cls = 'p-none'; return; }
  const lv = PRIORITY_LEVELS.find(l => l.label === o.priority);
  a.label = `${o.priority}·담당자 조정`; a.cls = lv.cls; a.priority = lv.label; a.priorityCls = lv.cls;
}

function allAssessments(s = state) {
  const list = [];
  s.assets.forEach(as => s.vulns.forEach(v => {
    const a = assess(as, v);
    if (!a) return;
    const o = s.overrides[a.key];
    if (o && a.status === 'active') applyOverride(a, o);
    list.push(a);
  }));
  return list.sort((x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status] || y.score - x.score);
}

// 재평가 후 이전 판단과 비교해 변경 이력 기록, 새로 긴급이 된 항목은 알림
// 시스템 판정이 대응 불필요(조치 완료·영향 없음)로 바뀌면 열린 조치 업무 자동 종결
// 반환: 브리핑용 요약 { changes, newlyUrgent, closed }
function reassess(reason, initial = false) {
  const list = allAssessments();
  const next = {}, fresh = [], newlyUrgent = [], changes = [], closed = [];
  const fmt = s => `${s.label}${s.score != null ? `(${s.score}점)` : ''}`;
  list.forEach(a => {
    const prev = state.snapshot[a.key];
    // 긴급 감지는 시스템 판정 기준 — 담당자 조정이 새 위협 신호를 가리지 않도록
    const sys = a.system || a;
    const urgent = sys.status === 'active' && sys.priority === '긴급';
    const cur = { score: a.status === 'active' ? a.score : null, label: a.label, urgent, at: nowText() };
    if (!prev) fresh.push(a);
    else if (prev.score !== cur.score || prev.label !== cur.label) {
      addHistory('판단 갱신', `${a.asset.name} × ${a.vuln.id}: ${fmt(prev)} → ${fmt(cur)} — ${reason}`, a.key);
      changes.push({ key: a.key, name: `${a.asset.name} × ${a.vuln.id}`, from: fmt(prev), to: fmt(cur) });
    } else cur.at = prev.at;
    if (!initial && urgent && !(prev && prev.urgent)) newlyUrgent.push(a);
    const open = sys.status === 'active' ? [] : state.tasks.filter(t => t.key === a.key && t.status !== '완료');
    open.forEach(t => { t.status = '완료'; t.checkedAt = today(); t.autoClosed = `${sys.label} — ${reason}`; });
    if (open.length) {
      addHistory('조치 완료', `${a.asset.name} × ${a.vuln.id}: 열린 업무 ${open.length}건 자동 종결 (${sys.label} — ${reason})`, a.key);
      closed.push(...open);
    }
    next[a.key] = cur;
  });
  if (initial) addHistory('최초 평가', `자산 ${state.assets.length}건 × 취약점 ${state.vulns.length}건 매칭 → 평가 ${fresh.length}건 생성`);
  else fresh.forEach(a => {
    addHistory('신규 평가', `${a.asset.name} × ${a.vuln.id}: ${a.label}${a.status === 'active' ? `(${a.score}점)` : ''} — ${reason}`, a.key);
    changes.push({ key: a.key, name: `${a.asset.name} × ${a.vuln.id}`, from: '신규', to: fmt({ label: a.label, score: a.status === 'active' ? a.score : null }) });
  });
  state.snapshot = next;
  newlyUrgent.forEach(a => notify('긴급', `${a.asset.name} × ${a.vuln.id}`,
    `${a.system ? `시스템 판정 ${a.system.label}(${a.score}점), 담당자 조정 재검토 필요` : `${a.label}(${a.score}점)`} — ${reason}`, detailLink(a.key)));
  const kevHits = newlyUrgent.filter(a => a.vuln.kev);
  if (kevHits.length) {
    const log = archiveReport('alert', '자동 — KEV 연관 긴급 위협 감지', kevHits.map(a => a.key));
    notify('리포트', '긴급 알림 리포트 자동 생성', `${kevHits.length}건 수록`, `#report/log-${log.id}`);
  }
  save();
  return { changes, newlyUrgent, closed };
}

// 에이전트가 질의 없이 먼저 올리는 브리핑 (위협 갱신·자동 탐색 반영 직후)
function postBriefing(reason, summary) {
  const b = agentBriefing(reason, summary);
  if (!b) return;
  const { items, ...rest } = b;
  ui.chatLog.push({ role: 'agent', ...rest, itemKeys: items.map(a => a.key) });
  notify('브리핑', '에이전트 자동 브리핑', b.text[0], '#todo');
  save();
}

// ---------- 공용 변경 작업 (여러 화면에서 사용) ----------
function createTasks(key) {
  const a = allAssessments().find(x => x.key === key);
  if (!a) return 0;
  const existing = new Set(state.tasks.filter(t => t.key === key).map(t => t.title));
  const created = taskTemplates(a).filter(t => !existing.has(t.title)).map(t => ({
    id: `T${++state.seq}`, key, assetName: a.asset.name, cveId: a.vuln.id,
    priority: a.priority, priorityCls: a.priorityCls, ...t,
    status: '대기', owner: a.asset.owner || '', checkedAt: '', createdAt: today(),
  }));
  state.tasks.push(...created);
  addHistory('조치 업무', `${a.asset.name} × ${a.vuln.id}: 조치 업무 ${created.length}건 생성`, key);
  save();
  return created.length;
}

// 취약점 외 할 일 (kind: gap·scan·contract·ops·starter) — key·제목 중복 시 생략
function addExtraTask(t) {
  if (state.tasks.some(x => x.key === t.key && x.title === t.title)) return false;
  state.tasks.push({ id: `T${++state.seq}`, priority: '보통', priorityCls: 'p-medium', refs: [], status: '대기', owner: '', checkedAt: '', createdAt: today(), ...t });
  addHistory('조치 업무', `${t.assetName}: '${t.title}' 할 일 등록`);
  return true;
}

function addAssets(assets, source) {
  if (!assetRoom(assets.length)) return { ok: false, msg: limitMsg() };
  assets.forEach(a => state.assets.push({ ...a, id: `A${++state.seq}` }));
  addHistory('자산 변경', `${source}: ${assets.length}건 (${assets.map(a => a.name).join(', ')})`);
  reassess(`${source} ${assets.length}건`);
  return { ok: true, msg: `${assets.length}건 등록 완료` };
}

// 탐색 결과 반영: 보완·변경은 자산에 반영, 신규는 등록 — 재평가 1회 후 브리핑
function applyDiscovery(findings) {
  const fresh = findings.filter(f => f.kind === '신규');
  if (!assetRoom(fresh.length)) return { ok: false, msg: limitMsg() };
  findings.filter(f => f.assetId).forEach(f => {
    const a = state.assets.find(x => x.id === f.assetId);
    if (!a) return;
    f.changes.forEach(c => { a[c.field] = c.to; });
    a.verified = { at: today(), source: f.source };
    if (f.changes.length) addHistory('자동 탐색', `${a.name}: ${describeFinding(f)} (근거: ${f.evidence})`);
  });
  fresh.forEach(f => state.assets.push({ ...f.asset, id: `A${++state.seq}`, verified: { at: today(), source: f.source } }));
  if (fresh.length) addHistory('자동 탐색', `미등록 자산 ${fresh.length}건 등록: ${fresh.map(f => f.name).join(', ')}`);
  const reason = `자동 탐색 결과 반영 ${findings.length}건`;
  postBriefing(reason, reassess(reason));
  return { ok: true, msg: `${findings.length}건 반영` };
}

// 공용 위협 정보 변경 후 전체 고객사 재평가, 현재 고객사에 브리핑
function broadcastUpdate(feedText, reason, briefReason) {
  store.feed.unshift({ time: nowText(), text: feedText });
  let summary = null;
  Object.values(store.tenants).forEach(t => withTenant(t, () => {
    addHistory('위협 정보 갱신', feedText);
    const r = reassess(reason);
    if (t.id === store.current) summary = r;
  }));
  if (summary) postBriefing(briefReason, summary);
}

function runSimulation() {
  const u = SIM_UPDATES[store.simStep];
  if (!u) return;
  const v = store.vulns.find(x => x.id === u.cveId);
  Object.assign(v, u.changes, { updatedAt: today() });
  store.simStep++;
  broadcastUpdate(`${v.id} (${v.product}) — ${u.text}`, `위협 정보 갱신: ${u.text}`, `위협 정보 갱신: ${v.id} ${u.text}`);
  route();
}

// ---------- 상단 바 ----------
function renderTopbar() {
  document.getElementById('tenantBox').innerHTML = `<select data-change="tenant" aria-label="고객사 선택">${Object.values(store.tenants)
    .map(t => `<option value="${t.id}" ${t.id === state.id ? 'selected' : ''}>${esc(t.name)} · ${esc(t.plan)}</option>`).join('')}</select>`;
  const unread = state.notifications.filter(n => !n.read).length;
  const bell = document.getElementById('bellBtn');
  bell.textContent = unread ? `알림 ${unread}` : '알림';
  bell.classList.toggle('has', unread > 0);
  const panel = document.getElementById('notifPanel');
  panel.hidden = !ui.notifOpen;
  if (!ui.notifOpen) return;
  panel.innerHTML = `<div class="np-head"><b>${esc(state.name)} 알림</b>${unread ? '<button class="small ghost" data-action="read-all">모두 읽음</button>' : ''}</div>
    ${state.notifications.length ? state.notifications.slice(0, 20).map(n => `<a class="np-item ${n.read ? '' : 'unread'}" data-action="open-notif" data-id="${n.id}">
      <span class="type t-${n.level}">${esc(n.level)}</span><span><b>${esc(n.title)}</b><br><span class="muted">${esc(n.text)} · ${n.time}</span></span></a>`).join('')
    : '<p class="empty">알림 없음 — 시뮬레이션이나 자산 등록으로 긴급 위협이 생기면 표시</p>'}`;
}

Object.assign(ACTIONS, {
  open: id => { location.hash = detailLink(id); },
  simulate: runSimulation,
  reset: () => {
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* 무시 */ }
    store = seedStore(); initTenants(); switchTenant('A');
    location.hash = '#todo'; route();
  },
  'toggle-notif': () => { ui.notifOpen = !ui.notifOpen; renderTopbar(); },
  'read-all': () => { state.notifications.forEach(n => { n.read = true; }); save(); renderTopbar(); },
  'open-notif': id => {
    const n = state.notifications.find(x => x.id === id);
    if (!n) return;
    n.read = true; ui.notifOpen = false; save();
    if (location.hash === n.link) route(); else location.hash = n.link;
  },
  'create-tasks': id => { createTasks(id); route(); },
});
CHANGES.tenant = el => { switchTenant(el.value); route(); };

// ---------- 라우팅·이벤트 ----------
function route() {
  const [view, param] = (location.hash.slice(1) || 'todo').split('/');
  const name = VIEWS[view] ? view : 'todo';
  $view.innerHTML = VIEWS[name](param && decodeURIComponent(param));
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  const left = SIM_UPDATES.length - store.simStep;
  const btn = document.getElementById('simBtn');
  btn.textContent = left ? `위협 정보 갱신 시뮬레이션 (${left})` : '시뮬레이션 완료';
  btn.disabled = !left;
  renderTopbar();
  if (name === 'chat') {
    const log = document.getElementById('chatLog');
    log.scrollTop = log.scrollHeight;
    document.querySelector('#chatForm input').focus();
  }
}

document.addEventListener('click', e => {
  if (ui.notifOpen && !e.target.closest('.bell-wrap')) { ui.notifOpen = false; renderTopbar(); }
  const el = e.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el.dataset.id, el);
});
document.addEventListener('change', e => { CHANGES[e.target.dataset.change]?.(e.target); });
document.addEventListener('input', e => { if (e.target.dataset.change === 'whatif') CHANGES.whatif(e.target); });
document.addEventListener('submit', e => {
  e.preventDefault();
  FORMS[e.target.id]?.(new FormData(e.target), e.target);
});
document.addEventListener('toggle', e => {
  const id = e.target.dataset?.keep;
  if (id) { if (e.target.open) ui.open.add(id); else ui.open.delete(id); }
}, true);
window.addEventListener('hashchange', route);

// views/*.js가 모두 로드된 뒤 시작
document.addEventListener('DOMContentLoaded', () => {
  store = load() || seedStore();
  state = store.tenants[store.current] || store.tenants.A;
  initTenants();
  route();
});
