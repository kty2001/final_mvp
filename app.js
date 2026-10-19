// 화면 렌더링·상태 관리 (브라우저 localStorage 저장, 고객사별 데이터 분리)

const STORE_KEY = 'cti-mvp-v5';
const clone = o => JSON.parse(JSON.stringify(o));
const $view = document.getElementById('view');
const PRODUCTS = [...new Set(VULNS.map(v => v.product))];
const STATUS_ORDER = { active: 0, resolved: 1, excluded: 2 };

let store;           // { current, simStep, vulns, feed, tenants }
let state;           // 현재 고객사 (store.tenants[store.current])
let analysisFilter = 'active';
let taskFilter = 'open';
let editingAssetId = null;
let chatLog = [];
let notifOpen = false;
let intakeText = '';
let intakePreview = null;
let formError = '';
let overrideError = '';
let formDraft = null;
let discoveryPreview = null;
let discoverySources = DISCOVERY_SOURCES.map(s => s.id);
let auditFormId = null;   // 점검 대응: 작성 중인 양식
let krPreview = null;     // 국내 공지 추출 미리보기 (공지 id)
let scanText = '';
let scanSource = '';
let scanPreview = null;   // 외부 점검 결과 분석 결과
let condDraft = {};       // 영향 조건 확인: key → { output, result }
let vendorDraft = {};     // 외주 업체 회신: key → { reply, parsed }
let evidenceDraft = null; // 조치 증빙 입력: { assetId, type, text, error }
let opsPick = { component: 'db', fault: 'socket' }; // 오류 리포팅: 오류 시뮬레이션 선택값

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function today() { return ymd(new Date()); }
function nowText() { const d = new Date(); return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function nowLocal() { return nowText().replace(' ', 'T'); }
function addDays(date, n) { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); }
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
const ddayText = n => (n > 0 ? `D-${n}` : n === 0 ? 'D-day' : `D+${-n}`);
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const badge = (label, cls) => `<span class="badge ${cls}">${esc(label)}</span>`;
const detailLink = key => `#analysis/${encodeURIComponent(key)}`;
const planOf = (s = state) => PLANS.find(p => p.id === s.plan) || PLANS[0];
const assetRoom = n => planOf().assetLimit == null || state.assets.length + n <= planOf().assetLimit;
const limitMsg = () => `${state.plan} 플랜 자산 한도(${planOf().assetLimit}개) 초과 — 요금제에서 플랜 변경 필요`;

// ---------- 저장소 ----------
function seedTenant(seed) {
  return {
    id: seed.id, name: seed.name, industry: seed.industry, plan: seed.plan,
    assets: clone(seed.assets), trend: clone(seed.trend), tasks: [], history: [], snapshot: {}, seq: 100,
    overrides: {}, notifications: [], reportLog: [], schedules: clone(seed.schedules || DEFAULT_SCHEDULES),
    onboarding: seed.onboarding || null,
    profile: clone(seed.profile || DEFAULT_PROFILE),
    dutyDue: Object.fromEntries(DUTIES.map(d => [d.id, addDays(today(), d.firstDueIn)])), dutyLog: [],
    conditionChecks: {}, vendorRequests: {}, decisions: {}, incident: null, incidents: [], opsIncidents: [],
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
  chatLog = []; intakePreview = null; intakeText = ''; editingAssetId = null; formError = ''; notifOpen = false;
  formDraft = null; discoveryPreview = null;
  auditFormId = null; krPreview = null; scanText = ''; scanPreview = null; condDraft = {}; vendorDraft = {}; evidenceDraft = null;
  opsPick = { component: 'db', fault: 'socket' };
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
  chatLog.push({ role: 'agent', ...rest, itemKeys: items.map(a => a.key) });
  notify('브리핑', '에이전트 자동 브리핑', b.text[0], '#todo');
  save();
}

// ---------- 상단 바 ----------
function renderTopbar() {
  document.getElementById('tenantBox').innerHTML = `<select id="tenantSelect" aria-label="고객사 선택">${Object.values(store.tenants)
    .map(t => `<option value="${t.id}" ${t.id === state.id ? 'selected' : ''}>${esc(t.name)} · ${esc(t.plan)}</option>`).join('')}</select>`;
  const unread = state.notifications.filter(n => !n.read).length;
  const bell = document.getElementById('bellBtn');
  bell.textContent = unread ? `알림 ${unread}` : '알림';
  bell.classList.toggle('has', unread > 0);
  const panel = document.getElementById('notifPanel');
  panel.hidden = !notifOpen;
  if (!notifOpen) return;
  panel.innerHTML = `<div class="np-head"><b>${esc(state.name)} 알림</b>${unread ? '<button class="small ghost" data-action="read-all">모두 읽음</button>' : ''}</div>
    ${state.notifications.length ? state.notifications.slice(0, 20).map(n => `<a class="np-item ${n.read ? '' : 'unread'}" data-action="open-notif" data-id="${n.id}">
      <span class="type t-${n.level}">${esc(n.level)}</span><span><b>${esc(n.title)}</b><br><span class="muted">${esc(n.text)} · ${n.time}</span></span></a>`).join('')
    : '<p class="empty">알림 없음 — 시뮬레이션이나 자산 등록으로 긴급 위협이 생기면 표시</p>'}`;
}

// ---------- 화면: 할 일 (주 사용자 홈) ----------
// 사용자는 메뉴를 탐색하지 않고 카드 단위로 처리: 왜(쉬운 말) → 할 일 체크 → 필요 시 근거·에이전트 설명
const TODO_GROUPS = [
  { title: '오늘 처리', hint: '실제 공격 위험이 큰 항목', match: a => a.priority === '긴급' },
  { title: '이번 주', hint: '위험 높음', match: a => a.priority === '높음' },
  { title: '이번 달', hint: '여유 있게 처리', match: a => ['보통', '낮음'].includes(a.priority), collapsed: true },
];

function todoCard(a) {
  const tasks = state.tasks.filter(t => t.key === a.key);
  const lines = explain(a);
  const allDone = tasks.length && tasks.every(t => t.status === '완료');
  return `<div class="card todo-card">
    <div class="head">${badge(a.label, a.cls)} <b>${esc(a.asset.name)}</b> <span class="muted">${esc(a.vuln.title)}</span></div>
    <p class="why"><b>왜</b> ${plainReasons(a).map(esc).join(' · ')}</p>
    ${tasks.length
      ? `<ul class="checklist">${tasks.map(t => `<li><label><input type="checkbox" data-todo-task="${t.id}" ${t.status === '완료' ? 'checked' : ''}> ${esc(t.title)}</label>${t.autoClosed ? ' <span class="chip">자동 종결</span>' : ''}</li>`).join('')}</ul>`
      : `<ul class="checklist draft">${taskTemplates(a).slice(0, 3).map(t => `<li>${esc(t.title)}</li>`).join('')}</ul>
        <button class="small" data-action="create-tasks" data-id="${esc(a.key)}">할 일로 등록</button>`}
    ${allDone ? (evidenceDraft?.assetId === a.asset.id ? evidenceForm(a.asset)
      : `<p class="muted">할 일 완료 — 패치 반영 시 목록에서 빠짐 <button class="small ghost" data-action="evidence-open" data-id="${a.asset.id}">패치 적용 완료로 반영</button></p>`) : ''}
    <details><summary>에이전트 설명</summary>${lines.map(l => `<p><span class="t t-${l.tag}">${l.tag}</span>${esc(l.text)}</p>`).join('')}
      ${citationNote(verifyCitations(lines.map(l => l.text), [a]))}</details>
    <a href="${detailLink(a.key)}">근거·What-if 보기 →</a>
    ${CONDITION_CHECKS[a.vuln.id] ? ` · <a href="${detailLink(a.key)}">영향 조건 확인 (오탐 줄이기) →</a>` : ''}
  </div>`;
}

// 증빙 기반 조치 종결: 증빙 없이는 패치 완료 반영 불가
function evidenceForm(asset) {
  const d = evidenceDraft;
  return `<div class="evidence">
    <b>조치 증빙</b> <span class="muted">증빙 없이 종결 불가 — 조치 이행 보고서·점검 양식 근거로 사용</span>
    <div class="inline-form"><select id="evType">${['버전 확인 출력', '설정 화면 캡처(파일명)', '외부 배너 재확인'].map(t => `<option ${t === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="small ghost" data-action="evidence-sample" data-id="${asset.id}">예시 입력</button></div>
    <textarea id="evText" rows="3" placeholder="예: ${esc(VERSION_CMD[asset.product] || '버전 확인 명령')} 출력 붙여넣기">${esc(d.text)}</textarea>
    ${d.error ? `<p class="error">${esc(d.error)}</p>` : ''}
    <div class="toolbar"><button class="small" data-action="mark-patched" data-id="${asset.id}">증빙 확인 후 반영</button>
      <button class="small ghost" data-action="evidence-cancel">취소</button></div>
  </div>`;
}

// 비취약점 할 일 (점검 갭·점검 결과·계약 만료)
function extraTaskCard() {
  const open = state.tasks.filter(t => t.kind && t.status !== '완료');
  if (!open.length) return '';
  return `<section class="todo-group"><h3>오류·점검·계약 할 일 (${open.length}) <span class="muted">취약점 외 업무</span></h3><div class="card">
    <ul class="checklist">${open.map(t => `<li><label><input type="checkbox" data-todo-task="${t.id}"> ${esc(t.title)}</label> <a class="muted" href="${t.link}">${esc(t.assetName)}</a></li>`).join('')}</ul></div></section>`;
}

function dutyCard() {
  const list = applicableDuties();
  if (!list.length) return '';
  const cls = n => (n < 0 ? 'p-urgent' : n <= 14 ? 'p-high' : 'p-low');
  return `<section class="todo-group"><h3>보안 의무 일정 (${list.length}) <span class="muted">회사 조건 기준 · <a href="#plans">조건 변경</a></span></h3><div class="card">
    <ul class="checklist">${list.map(d => `<li><label><input type="checkbox" data-duty-done="${d.id}"> ${esc(d.title)}</label> ${badge(ddayText(d.dday), cls(d.dday))}
      <span class="muted">${d.due} · ${esc(d.cycle)} · ${esc(d.basis)}</span>${d.link ? ` <a href="${d.link}">바로 가기 →</a>` : ''}</li>`).join('')}</ul>
    <p class="muted">완료 체크 시 이행 기록 저장 후 다음 기한으로 이동 — 이행 기록은 점검 양식 근거로 사용</p></div></section>`;
}

function contractCard() {
  const list = contractAlerts();
  if (!list.length) return '';
  return `<section class="todo-group"><h3>계약·단종 임박 (${list.length}) <span class="muted">60일 이내</span></h3><div class="card"><ul class="plain">${list.map(c => {
    const has = state.tasks.some(t => t.key === `contract|${c.asset.id}|${c.kind}`);
    return `<li>${badge(ddayText(c.dday), c.dday < 0 ? 'p-urgent' : 'p-high')} <b>${esc(c.asset.name)}</b> ${esc(c.kind)} ${c.date} <span class="muted">${esc(c.asset.maintainer || '자사')}</span>
      ${has ? '<span class="chip">할 일 등록됨</span>' : `<button class="small ghost" data-action="contract-task" data-id="${c.asset.id}" data-kind="${esc(c.kind)}">할 일로 등록</button>`}</li>`;
  }).join('')}</ul></div></section>`;
}

function decisionList(list) {
  const decisions = decisionRequests(list);
  if (!decisions.length) return '';
  return `<p><b>대표 결정 요청 ${decisions.length}건</b> <span class="muted">보고서에 포함 — 대표는 메일에서 회신 (목업: 아래 버튼으로 회신 시뮬레이션)</span></p>
    <ul class="plain">${decisions.map(d => `<li>${esc(d.title)} <span class="muted">${esc(d.ask)} · 영향: ${esc(d.impact)}</span>
      ${d.reply ? badge(`${d.reply.status} ${d.reply.at.slice(5)}`, d.reply.status === '승인' ? 'p-done' : 'p-none')
        : `<button class="small ghost" data-action="decide" data-id="${esc(d.id)}" data-reply="승인">대표 회신: 승인</button> <button class="small ghost" data-action="decide" data-id="${esc(d.id)}" data-reply="보류">보류</button>`}</li>`).join('')}</ul>`;
}

function checkCard(list) {
  if (!list.length) return '';
  return `<div class="card todo-check">
    <h3>확인 필요 — 정보가 부족해 판단 보류 (${list.length})</h3>
    <ul class="plain">${list.map(a => `<li>${badge(a.label, a.cls)} <a href="${detailLink(a.key)}">${esc(a.asset.name)} × ${a.vuln.id}</a>
      <span class="muted">${esc(a.checks.filter(c => !c.startsWith('공급업체')).join(', '))}</span></li>`).join('')}</ul>
    ${discoveryPreview
      ? (discoveryPreview.length ? `${discoveryTable(discoveryPreview, false)}
        <div class="toolbar"><button class="small" data-action="todo-discover-apply">승인 — ${discoveryPreview.length}건 반영</button>
          <button class="small ghost" data-action="discover-clear">취소</button></div>` : '<p class="empty">새로 확인된 정보 없음 — 담당자 직접 확인 필요</p>')
      : '<div class="toolbar"><button class="small" data-action="todo-discover">에이전트 자동 확인</button><span class="muted">연결 소스에서 버전·노출 정보 수집 (목업) → 승인 후 반영</span></div>'}
  </div>`;
}

function viewTodo() {
  const list = allAssessments();
  const byKey = Object.fromEntries(list.map(a => [a.key, a]));
  const active = list.filter(a => a.status === 'active');
  const unsure = active.filter(a => a.match.status === 'potential' || a.confidence === '낮음');
  const ready = active.filter(a => !unsure.includes(a));
  const done = state.tasks.filter(t => t.status === '완료').length;
  const rate = state.tasks.length ? Math.round((done / state.tasks.length) * 100) : 0;
  const brief = chatLog.map((m, i) => [m, i]).filter(([m]) => m.proactive).pop();
  const report = buildReport('exec');
  const sent = state.reportLog.find(l => l.trigger === '수동 발송(목업)');
  return `
    <h2>이번 주 할 일</h2>
    <p class="sub">${esc(state.name)} · 대응 필요 ${active.length}건 · 할 일 처리율 ${rate}% (${done}/${state.tasks.length}) — 위 카드부터 처리</p>
    <div class="meter"><span style="width:${rate}%"></span></div>
    ${onboardingCard()}
    ${opsTodoCard()}
    ${brief ? `<div class="card"><h3>에이전트 브리핑</h3>${renderMsg(brief[0], brief[1], byKey)}</div>` : ''}
    ${checkCard(unsure)}
    ${TODO_GROUPS.map(g => {
      const items = ready.filter(g.match);
      if (!items.length) return '';
      const body = items.map(todoCard).join('');
      return g.collapsed
        ? `<details class="todo-group"><summary>${g.title} (${items.length}) <span class="muted">${g.hint}</span></summary>${body}</details>`
        : `<section class="todo-group"><h3>${g.title} (${items.length}) <span class="muted">${g.hint}</span></h3>${body}</section>`;
    }).join('')}
    ${active.length ? '' : '<div class="card"><p class="empty">대응할 위협 없음</p></div>'}
    ${extraTaskCard()}
    ${dutyCard()}
    ${contractCard()}
    <div class="card">
      <h3>대표 보고</h3>
      <p>${esc(report.summary)}</p>
      ${decisionList(list)}
      <div class="toolbar"><a href="#report/exec">미리보기 →</a>
        <button class="small" data-action="send-exec">이번 주 보고 보내기 (목업)</button>
        <span class="muted">수신 ${esc(state.schedules.exec.to)}${sent ? ` · 최근 발송 ${sent.generatedAt}` : ''}</span></div>
    </div>`;
}

// ---------- 화면: 위협 현황 (상세 분석) ----------
function onboardingCard() {
  if (!state.onboarding) return '';
  const steps = [
    { done: state.assets.length > 0, text: '자산 등록 — 자산 관리의 에이전트 자동 탐색 또는 일괄 등록', href: '#assets' },
    { done: !!state.onboarding.viewedDetail, text: '첫 위협 분석 결과 확인', href: '#analysis' },
    planOf().schedule
      ? { done: Object.values(state.schedules).some(s => s.on), text: '정기 리포트 예약 설정', href: '#report' }
      : { done: !!state.onboarding.viewedPlans, text: '요금제 확인 — 정기 리포트는 구독 플랜부터', href: '#plans' },
  ];
  if (steps.every(s => s.done)) return '';
  return `<div class="card onboarding"><h3>시작하기 (${steps.filter(s => s.done).length}/3)</h3>
    <ol class="steps">${steps.map(s => `<li class="${s.done ? 'done' : ''}"><a href="${s.href}">${s.done ? '✔ ' : ''}${esc(s.text)}</a></li>`).join('')}</ol></div>`;
}

function viewDashboard() {
  const list = allAssessments();
  const active = list.filter(a => a.status === 'active');
  const kpis = [
    ['자산 연관 위협', active.length, '대응 필요 평가 건'],
    ['실제 악용(KEV) 연관', active.filter(a => a.vuln.kev).length, 'CISA KEV 등재 취약점'],
    ['긴급·높음', active.filter(a => ['긴급', '높음'].includes(a.priority)).length, '우선 확인 대상'],
    ['미완료 조치', state.tasks.filter(t => t.status !== '완료').length, '대기·진행 중 업무'],
  ];
  const vulns = [...state.vulns].sort((a, b) => b.published.localeCompare(a.published));
  return `
    <h2>위협 현황 (상세 분석)</h2>
    <p class="sub">${esc(state.name)} (${esc(state.industry)}) · 등록 자산 ${state.assets.length}건 기준 · 전체 위험 현황·분포·추이</p>
    <div class="grid kpi">${kpis.map(([l, n, h]) => `<div class="card"><div class="label">${l}</div><div class="num">${n}</div><div class="hint">${h}</div></div>`).join('')}</div>
    <div class="grid two">
      <div class="card">${renderChart(statDistribution(list))}</div>
      <div class="card">${renderChart(statTrend())}</div>
    </div>
    ${list.length ? `<div class="card">${renderChart(statHeatmap(list))}</div>` : ''}
    <div class="card">
      <h3>대응 우선순위</h3>
      ${assessmentTable(active)}
      <p class="muted">조치 완료 ${list.filter(a => a.status === 'resolved').length}건 · 영향 없음·오탐 ${list.filter(a => a.status === 'excluded').length}건은 <a href="#analysis">위협 분석</a>에서 확인</p>
    </div>
    <div class="grid two">
      <div class="card">
        <h3>최근 취약점 피드</h3>
        <div class="table-wrap"><table>
          <tr><th>CVE</th><th>제품</th><th>CVSS</th><th>EPSS</th><th>악용</th><th>관련 자산</th></tr>
          ${vulns.map(v => {
            const n = list.filter(a => a.vuln.id === v.id && a.status !== 'excluded').length;
            return `<tr><td>${v.id}<div class="muted">${esc(v.title)}</div></td><td>${esc(v.product)}</td><td class="num">${v.kr ? `공지 ${esc(v.kr.severity)}` : v.cvss.toFixed(1)}</td><td class="num">${v.epss == null ? '-' : v.epss.toFixed(2)}</td><td>${v.kev ? badge('KEV', 'kev') : '-'}</td><td class="num">${n || '<span class="muted">없음</span>'}</td></tr>`;
          }).join('')}
        </table></div>
      </div>
      <div class="card">
        <h3>위협 정보 변경 내역</h3>
        <ul class="timeline">${state.feed.map(f => `<li><span class="time">${f.time}</span><span>${esc(f.text)}</span></li>`).join('')}</ul>
      </div>
    </div>
    ${krCard()}`;
}

// 국산 SW·한국어 공지 구조화: 추출 → 원문 인용 검증·지시성 문장 검사 → 승인 시 위협 정보 추가
function krCard() {
  return `<div class="card">
    <h3>국내 공지 구조화 (국산 SW · 한국어 공지)</h3>
    <p class="muted">CVE·CPE가 없는 국산 소프트웨어 공지에서 제품·버전·조치를 추출해 위협 정보로 추가 — 필드별 원문 인용 검증, 추가는 승인 후 (목업: 추출은 LLM 대체 데이터)</p>
    <ul class="plain">${KR_ADVISORIES.map(ad => `<li><b>${esc(ad.product)}</b> <span class="muted">${esc(ad.source)} · ${ad.published}</span>
      ${store.krIngested.includes(ad.id) ? badge('위협 정보 추가됨', 'p-done') : `<button class="small ghost" data-action="kr-extract" data-id="${ad.id}">에이전트 추출</button>`}</li>`).join('')}</ul>
    ${krPreview ? krPreviewHtml(KR_ADVISORIES.find(x => x.id === krPreview)) : ''}
  </div>`;
}

function krPreviewHtml(ad) {
  const r = extractKrAdvisory(ad);
  const hits = Object.values(store.tenants).map(t => t.assets.filter(a => norm(a.product) === norm(ad.product)).length);
  return `<blockquote class="advisory">${ad.raw.split(/(?<=\.)\s+/).map(s => (r.flagged.includes(s) ? `<mark>${esc(s)}</mark>` : esc(s))).join(' ')}</blockquote>
    <div class="table-wrap"><table><tr><th>필드</th><th>추출값</th><th>원문 인용</th><th>인용 검증</th></tr>
      ${r.fields.map(f => `<tr><td>${f.field}</td><td>${esc(f.value)}</td><td class="muted">"${esc(f.quote)}"</td><td>${f.verified ? badge('원문 일치', 'p-done') : badge('원문 없음', 'p-urgent')}</td></tr>`).join('')}
    </table></div>
    <p class="muted">인용 검증 ${r.verified}/${r.fields.length} · 위험도 '${esc(ad.extract.severity)}' → 규칙표 환산 ${KR_SEVERITY[ad.extract.severity].toFixed(1)} · EPSS 없음 · 미검증 위협 정보로 신뢰도 감점 · 매칭 예상: 고객사 ${hits.filter(Boolean).length}곳 자산 ${hits.reduce((s, n) => s + n, 0)}건</p>
    ${r.flagged.length ? `<p class="error">지시성 문장 ${r.flagged.length}건 감지 — 데이터로만 취급, 추출·판정에 반영하지 않음</p>` : ''}
    <details class="tools"><summary>도구 호출 3건</summary><ol>
      <li><code>extract_advisory_ko(${esc(ad.id)})</code> → 필드 ${r.fields.length}개</li>
      <li><code>verify_citations(원문)</code> → 일치 ${r.verified}/${r.fields.length}</li>
      <li><code>screen_external_text(${esc(ad.source)})</code> → 지시성 문장 ${r.flagged.length}건</li></ol></details>
    <div class="toolbar"><button class="small" data-action="kr-apply" data-id="${ad.id}">승인 — 위협 정보에 추가</button>
      <button class="small ghost" data-action="kr-clear">취소</button></div>`;
}

function assessmentTable(list) {
  if (!list.length) return '<p class="empty">해당 항목 없음</p>';
  return `<div class="table-wrap"><table>
    <tr><th>판단</th><th>자산</th><th>취약점</th><th>매칭</th><th>점수</th><th>신뢰도</th></tr>
    ${list.map(a => `<tr class="click" data-action="open" data-id="${esc(a.key)}">
      <td>${badge(a.label, a.cls)}${a.overrideStale ? ' <span class="warn-chip">재검토</span>' : ''}</td>
      <td>${esc(a.asset.name)}<div class="muted">${esc(a.asset.product)} ${esc(a.asset.version || '버전 미등록')}</div></td>
      <td>${a.vuln.id} ${a.vuln.kev ? badge('KEV', 'kev') : ''}<div class="muted">${esc(a.vuln.title)}</div></td>
      <td class="muted">${esc(a.match.text)}</td>
      <td class="num">${a.status === 'active' ? a.score : '-'}</td>
      <td>${a.status === 'excluded' ? '-' : a.confidence}</td>
    </tr>`).join('')}
  </table></div>`;
}

// ---------- 화면: 자산 관리 ----------
function selectField(name, label, options, value) {
  return `<label>${label}<select name="${name}">${options.map(o => `<option ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
}

function intakeTable(parsed) {
  return `<div class="table-wrap"><table>
    <tr><th>자산명</th><th>제품</th><th>버전</th><th>유형</th><th>중요도</th><th>외부 노출</th><th>패치</th><th>확인 필요</th></tr>
    ${parsed.map(p => `<tr><td>${esc(p.asset.name)}</td><td>${esc(p.asset.product || '-')}</td><td>${esc(p.asset.version || '-')}</td><td>${esc(p.asset.type)}</td>
      <td>${p.asset.criticality}</td><td>${p.asset.exposure}</td><td>${p.asset.patch}</td><td class="muted">${p.warnings.map(esc).join('<br>') || '-'}</td></tr>`).join('')}
  </table></div>`;
}

const KIND_CLS = { 신규: 'p-high', 보완: 'p-medium', 변경: 'p-urgent', 확인: 'p-done' };

function discoveryTable(findings, selectable) {
  return `<div class="table-wrap"><table>
    <tr>${selectable ? '<th></th>' : ''}<th>구분</th><th>자산</th><th>내용</th><th>근거</th></tr>
    ${findings.map((f, i) => `<tr>${selectable ? `<td><input type="checkbox" data-disc-pick="${i}" checked aria-label="${esc(f.name)} 반영"></td>` : ''}
      <td>${badge(f.kind, KIND_CLS[f.kind])}</td><td>${esc(f.name)}</td><td>${esc(describeFinding(f))}</td>
      <td class="muted">${esc(f.evidence)} <span class="chip">${esc(f.source)}</span></td></tr>`).join('')}
  </table></div>`;
}

function discoveryCard() {
  return `<div class="card">
    <h3>에이전트 자동 탐색</h3>
    <p class="muted">연결 소스에서 자산·버전·노출 정보를 수집해 등록 자산과 대조 — 반영은 승인 후 실행 (목업: 실제 접속 없음 · 읽기 전용 권한 전제 · 자격 증명 저장 안 함)</p>
    ${DISCOVERY_SOURCES.map(s => `<label class="check"><input type="checkbox" data-disc-source="${s.id}" ${discoverySources.includes(s.id) ? 'checked' : ''}> <b>${esc(s.name)}</b> <span class="muted">${esc(s.scope)}</span></label>`).join('')}
    <div class="toolbar" style="margin-top:8px"><button class="small" data-action="discover">탐색 실행</button></div>
    ${discoveryPreview ? (discoveryPreview.length ? `${discoveryTable(discoveryPreview, true)}
      <div class="toolbar"><button class="small" data-action="discover-apply">선택 항목 반영</button>
        <button class="small ghost" data-action="discover-clear">취소</button></div>` : '<p class="empty">관측된 자산 없음</p>') : ''}
  </div>`;
}

// 외부 점검 결과 가져오기: 자산 관측값은 자동 탐색과 같은 방식으로 대조, 설정 취약 항목은 할 일 후보
function scanCard() {
  const p = scanPreview;
  return `<div class="card">
    <h3>외부 점검 결과 가져오기</h3>
    <p class="muted">내서버돌보미·점검 스크립트·스캐너(OpenVAS·Nessus) 결과 CSV 붙여넣기 → 자산 정보 대조 + 설정 취약 항목은 할 일 후보 — 반영은 승인 후. 스캐너를 대신하지 않고 결과를 할 일·증적으로 변환</p>
    <textarea id="scanText" rows="4" placeholder="첫 줄에 헤더가 있는 CSV">${esc(scanText)}</textarea>
    <div class="toolbar" style="margin-top:8px">${Object.entries(SCAN_SAMPLES).map(([k, s]) => `<button class="small ghost" data-action="scan-sample" data-id="${k}">${esc(s.label)} 예시</button>`).join('')}
      <button class="small" data-action="scan-parse">분석</button></div>
    ${p ? `${p.findings.length ? discoveryTable(p.findings, false) : '<p class="empty">인식된 자산 없음</p>'}
      ${p.configs.length ? `<div class="table-wrap"><table><tr><th>자산</th><th>설정 점검 항목</th><th>결과</th><th>반영</th></tr>
        ${p.configs.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.item)}</td><td>${badge(c.result, 'p-high')}</td><td class="muted">할 일 등록</td></tr>`).join('')}</table></div>` : ''}
      <p class="muted">양호·조치 불필요 ${p.passed}건 제외</p>
      <div class="toolbar"><button class="small" data-action="scan-apply">승인 — 자산 반영 ${p.findings.filter(f => f.kind !== '확인').length}건 · 할 일 ${p.configs.length}건</button>
        <button class="small ghost" data-action="scan-clear">취소</button></div>` : ''}
  </div>`;
}

function applyScan() {
  const p = scanPreview;
  const changed = p.findings.filter(f => f.kind !== '확인');
  if (changed.length) {
    const r = applyDiscovery(changed);
    if (!r.ok) return r;
  }
  const n = p.configs.filter(c => addExtraTask({
    kind: 'scan', key: `scan|${c.name}|${c.item.split(' ')[0]}`, assetName: c.name, cveId: c.item.split(' ')[0],
    title: `${c.item} 조치`, reason: `${scanSource} 결과 ${c.result}`, refs: ['점검 결과'], link: '#assets',
  })).length;
  addHistory('점검 결과 반영', `${scanSource}: 자산 반영 ${changed.length}건, 설정 취약 할 일 ${n}건 등록`);
  save();
  return { ok: true };
}

// 보완·변경은 자산에 반영, 신규는 등록 — 재평가 1회 후 브리핑
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

function viewAssets() {
  const list = allAssessments();
  const lim = planOf().assetLimit;
  const e = formDraft || state.assets.find(a => a.id === editingAssetId) || { criticality: '중', exposure: '미확인', patch: '미적용', type: '서버' };
  return `
    <h2>자산 관리</h2>
    <p class="sub">${esc(state.name)} · 자산 ${state.assets.length} / ${lim ?? '무제한'} (${esc(state.plan)} 플랜) · 저장 시 전체 위협 재평가</p>
    ${formError ? `<p class="error">${esc(formError)} <a href="#plans">요금제 보기</a></p>` : ''}
    ${discoveryCard()}
    ${scanCard()}
    <div class="card">
      <h3>일괄 등록 (자연어·CSV)</h3>
      <p class="muted">한 줄에 자산 하나씩 문장으로 쓰거나, 첫 줄에 헤더가 있는 CSV를 붙여넣기 — 분석 결과 확인 후 등록</p>
      <textarea id="intakeText" rows="4" placeholder="예: 영업팀 파일 서버 톰캣 9.0.90 외부 공개">${esc(intakeText)}</textarea>
      <div class="toolbar" style="margin-top:8px">
        <button class="small ghost" data-action="intake-sample" data-id="text">자연어 예시</button>
        <button class="small ghost" data-action="intake-sample" data-id="csv">CSV 예시</button>
        <button class="small" data-action="intake-parse">분석</button>
      </div>
      ${intakePreview ? (intakePreview.length ? `${intakeTable(intakePreview)}
        <div class="toolbar"><button class="small" data-action="intake-commit">${intakePreview.length}건 등록</button>
          <button class="small ghost" data-action="intake-clear">취소</button></div>` : '<p class="empty">인식된 자산 없음</p>') : ''}
    </div>
    <div class="card">
      <h3>${editingAssetId ? '자산 수정' : '개별 등록'}</h3>
      <form id="assetForm" class="asset-form">
        <label>자산명 *<input name="name" required value="${esc(e.name)}"></label>
        <label>제품명 *<input name="product" required list="productList" value="${esc(e.product)}" placeholder="예: Apache HTTP Server"></label>
        <label>버전<input name="version" value="${esc(e.version)}" placeholder="미입력 시 '추가 확인 필요'로 평가"></label>
        ${selectField('type', '자산 유형', ['서버', '네트워크 장비', 'DB', '웹 애플리케이션', '기타'], e.type)}
        ${selectField('criticality', '업무 중요도', ['상', '중', '하'], e.criticality)}
        ${selectField('exposure', '외부 인터넷 노출', ['예', '아니오', '미확인'], e.exposure)}
        <label>운영 용도<input name="purpose" value="${esc(e.purpose)}"></label>
        ${selectField('patch', '패치 상태', ['미적용', '적용 완료', '확인 필요'], e.patch)}
        <label>담당자<input name="owner" value="${esc(e.owner)}"></label>
        <label>책임 주체<input name="maintainer" value="${esc(e.maintainer)}" placeholder="자사 / 유지보수 업체: OO / 벤더: OO"></label>
        <label>유지보수 계약 만료<input type="date" name="contractEnd" value="${esc(e.contractEnd)}"></label>
        <label>단종(EoS) 일자<input type="date" name="eos" value="${esc(e.eos)}"></label>
        <div class="form-actions">
          <button type="submit">${editingAssetId ? '수정 저장' : '등록'}</button>
          <button type="button" class="ghost" data-action="asset-autofill">자동 채우기</button>
          ${editingAssetId ? '<button type="button" class="ghost" data-action="cancel-edit">취소</button>' : ''}
        </div>
        ${formDraft ? '<p class="muted">자동 추론값 채움 — 제품명·유형·중요도·노출·패치·담당자 (저장 전 수정 가능)</p>' : ''}
        <datalist id="productList">${PRODUCTS.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      </form>
    </div>
    <div class="card">
      <h3>등록 자산 (${state.assets.length})</h3>
      ${state.assets.length ? `<div class="table-wrap"><table>
        <tr><th>자산명</th><th>제품 / 버전</th><th>유형</th><th>중요도</th><th>외부 노출</th><th>패치</th><th>담당자</th><th>책임·계약</th><th>대응 필요</th><th></th></tr>
        ${state.assets.map(a => `<tr>
          <td>${esc(a.name)}${a.verified ? ` <span class="chip" title="${esc(a.verified.source)}">자동 확인 ${a.verified.at.slice(5)}</span>` : ''}<div class="muted">${esc(a.purpose)}</div></td>
          <td>${esc(a.product)} ${a.version ? esc(a.version) : '<span class="muted">버전 미등록</span>'}</td>
          <td>${esc(a.type)}</td><td>${esc(a.criticality)}</td><td>${esc(a.exposure)}</td>
          <td>${esc(a.patch)}${a.patchEvidence ? ` <span class="chip" title="${esc(a.patchEvidence.text)}">증빙 ${esc(a.patchEvidence.verdict)}</span>` : ''}</td><td>${esc(a.owner)}</td>
          <td>${esc(a.maintainer || '자사')}${a.contractEnd ? `<div class="muted">계약 ~${a.contractEnd}</div>` : ''}${a.eos ? `<div class="muted">단종 ${a.eos}</div>` : ''}</td>
          <td class="num">${list.filter(x => x.asset.id === a.id && x.status === 'active').length}</td>
          <td style="white-space:nowrap"><button class="small ghost" data-action="edit-asset" data-id="${a.id}">수정</button>
            <button class="small danger" data-action="delete-asset" data-id="${a.id}">삭제</button></td>
        </tr>`).join('')}
      </table></div>` : '<p class="empty">등록된 자산 없음 — 위 일괄 등록으로 시작</p>'}
    </div>`;
}

function addAssets(assets, source) {
  if (!assetRoom(assets.length)) return { ok: false, msg: limitMsg() };
  assets.forEach(a => state.assets.push({ ...a, id: `A${++state.seq}` }));
  addHistory('자산 변경', `${source}: ${assets.length}건 (${assets.map(a => a.name).join(', ')})`);
  reassess(`${source} ${assets.length}건`);
  return { ok: true, msg: `${assets.length}건 등록 완료` };
}

function saveAsset(form) {
  const data = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v).trim()]));
  let asset = state.assets.find(a => a.id === editingAssetId);
  if (asset) {
    Object.assign(asset, data);
    addHistory('자산 변경', `자산 수정: ${asset.name}`);
  } else {
    if (!assetRoom(1)) { formError = limitMsg(); route(); return; }
    asset = { id: `A${++state.seq}`, ...data };
    state.assets.push(asset);
    addHistory('자산 변경', `자산 등록: ${asset.name} (${asset.product} ${asset.version || '버전 미등록'})`);
  }
  editingAssetId = null; formError = ''; formDraft = null;
  reassess(`자산 정보 변경: ${asset.name}`);
  route();
}

// ---------- 화면: 위협 분석 ----------
function viewAnalysis() {
  const list = allAssessments();
  const filtered = analysisFilter === 'all' ? list : list.filter(a => a.status === analysisFilter);
  const opt = (v, l) => `<option value="${v}" ${analysisFilter === v ? 'selected' : ''}>${l} (${v === 'all' ? list.length : list.filter(a => a.status === v).length})</option>`;
  return `
    <h2>자산별 위협 영향 분석</h2>
    <p class="sub">제품 일치 자산만 평가 · 버전 범위 밖·오탐은 '영향 없음'으로 분리</p>
    <div class="card">
      <div class="toolbar"><select id="analysisFilter">${opt('active', '대응 필요')}${opt('resolved', '조치 완료')}${opt('excluded', '영향 없음·오탐')}${opt('all', '전체')}</select></div>
      ${assessmentTable(filtered)}
    </div>`;
}

function whatIfResult(key, vals) {
  const [assetId, cveId] = key.split('|');
  const asset = state.assets.find(a => a.id === assetId), vuln = state.vulns.find(v => v.id === cveId);
  const cur = assess(asset, vuln), hyp = assess({ ...asset, ...vals }, vuln);
  const side = (title, x) => `<div><span class="muted">${title}</span><br>${badge(x.label, x.cls)} <b>${x.status === 'active' ? `${x.score}점` : ''}</b> · 신뢰도 ${x.confidence}</div>`;
  const diffs = hyp.factors.map((f, i) => [cur.factors[i], f]).filter(([c, h]) => c.points !== h.points)
    .map(([c, h]) => `<li>${h.name}: ${esc(c.value)} → ${esc(h.value)} (${c.points} → ${h.points}점)</li>`);
  if (cur.match.status !== hyp.match.status) diffs.push(`<li>매칭: ${esc(hyp.match.text)}</li>`);
  const changed = Object.entries(vals).some(([k, v]) => v !== (asset[k] || ''));
  return `<div class="whatif-out">${side('현재', cur)}<div class="arrow">→</div>${side('가정', hyp)}</div>
    ${diffs.length ? `<ul class="plain">${diffs.join('')}</ul>` : ''}
    ${changed ? `<button class="small" data-action="whatif-apply" data-id="${esc(key)}">가정 값을 자산 정보로 반영</button>` : '<p class="muted">값을 바꾸면 결과가 바로 갱신됨 (규칙 엔진 기준)</p>'}`;
}

function whatIfValues() {
  const v = {};
  document.querySelectorAll('[data-whatif]').forEach(el => { v[el.dataset.whatif] = el.value.trim(); });
  return v;
}

function whatIfCard(a) {
  const as = a.asset;
  const sel = (f, opts) => `<select data-whatif="${f}">${opts.map(o => `<option ${o === as[f] ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  return `<div class="card">
    <h3>What-if 분석</h3>
    <p class="muted">자산 정보를 가정으로 바꿔 판정 변화를 미리 확인 — 저장하지 않음</p>
    <div class="whatif">
      <label>버전<input data-whatif="version" value="${esc(as.version)}" placeholder="미등록"></label>
      <label>중요도${sel('criticality', ['상', '중', '하'])}</label>
      <label>외부 노출${sel('exposure', ['예', '아니오', '미확인'])}</label>
      <label>패치 상태${sel('patch', ['미적용', '적용 완료', '확인 필요'])}</label>
    </div>
    <div id="whatifResult" data-key="${esc(a.key)}">${whatIfResult(a.key, {})}</div>
  </div>`;
}

function overrideCard(a) {
  if (!a.system && a.status !== 'active') return '';
  const o = a.override;
  return `<div class="card">
    <h3>담당자 판단 수정</h3>
    ${o ? `<p>시스템 판정 ${badge(a.system.label, a.system.cls)} → 담당자 조정 ${badge(a.label, a.cls)}</p>
      <p class="muted">사유: ${esc(o.reason)} · ${o.at}</p>
      ${a.overrideStale ? `<p class="warn">시스템 판정이 조정 당시(${esc(o.basisLabel)})와 달라짐 — 재검토 필요</p>` : ''}
      <button class="small ghost" data-action="clear-override" data-id="${esc(a.key)}">조정 해제</button>`
    : `<p class="muted">규칙·AI 판정과 현장 판단이 다르면 사유와 함께 조정 — 원래 판정과 조정 이력 모두 보존</p>
      <div class="inline-form">
        <select id="ovPriority">${['긴급', '높음', '보통', '낮음', '오탐'].map(p => `<option value="${p}" ${p === a.priority ? 'selected' : ''}>${p === '오탐' ? '오탐(영향 없음)' : p}</option>`).join('')}</select>
        <input id="ovReason" placeholder="사유 (필수) 예: WAF로 해당 경로 차단 중">
        <button class="small" data-action="save-override" data-id="${esc(a.key)}">조정 저장</button>
      </div>
      ${overrideError ? `<p class="error">${esc(overrideError)}</p>` : ''}`}
  </div>`;
}

function viewDetail(key) {
  const a = allAssessments().find(x => x.key === key);
  if (!a) return '<div class="card">평가 항목을 찾을 수 없음 (자산 삭제 또는 제품 변경)</div>';
  if (state.onboarding && !state.onboarding.viewedDetail) { state.onboarding.viewedDetail = true; save(); }
  const v = a.vuln;
  const sys = a.system ? { ...a, label: a.system.label, status: a.system.status } : a;
  const tasks = state.tasks.filter(t => t.key === key);
  const allDone = tasks.length && tasks.every(t => t.status === '완료');
  const hist = state.history.filter(h => h.key === key);
  const box = (cls, title, items) => `<div class="card ${cls}"><h3>${title}</h3>${items.length ? `<ul class="plain">${items.join('')}</ul>` : '<p class="empty">없음</p>'}</div>`;
  return `
    <p><a href="#analysis">← 위협 분석 목록</a></p>
    <div class="card">
      <div class="head">${badge(a.label, a.cls)} <h2>${esc(a.asset.name)} × ${v.id}</h2> ${v.kev ? badge('KEV', 'kev') : ''}</div>
      <div>${esc(v.title)} — ${esc(v.product)}</div>
      <div class="meta">
        <span>위험 점수 <b>${a.status === 'active' || a.system ? `${a.score} / 100` : '-'}</b></span>
        <span>판단 신뢰도 <b>${a.status === 'excluded' && !a.system ? '-' : a.confidence}</b></span>
        <span>데이터 수집 시각 <b>${v.updatedAt}</b></span>
        <span>판단 시각 <b>${state.snapshot[key]?.at || '-'}</b></span>
      </div>
    </div>
    <div class="grid two">
      <div class="card">
        <h3>위험도 산정 근거 (규칙 기반)</h3>
        <div class="table-wrap"><table>
          <tr><th>요소</th><th>값</th><th>점수</th><th>출처</th></tr>
          ${a.factors.map(f => `<tr><td>${f.name}</td><td>${esc(f.value)}</td><td class="num">+${f.points}</td><td class="muted">${f.ref}</td></tr>`).join('')}
          <tr><td colspan="2"><b>합계</b></td><td class="num"><b>${a.score}</b></td><td></td></tr>
        </table></div>
        <p class="muted">기준: 85점 이상 긴급 · 65점 이상 높음 · 40점 이상 보통 · 그 외 낮음. 버전 미확인 시 '잠재적' 판정</p>
      </div>
      <div class="card explain">
        <h3>AI 분석 설명</h3>
        ${explain(sys).map(l => `<p><span class="t t-${l.tag}">${l.tag}</span>${esc(l.text)}</p>`).join('')}
        ${citationNote(verifyCitations(explain(sys).map(l => l.text), [a]))}
        <p class="muted">근거 자료와 규칙 평가 결과만으로 생성한 설명(목업 템플릿). LLM은 위험도를 결정하지 않음</p>
      </div>
    </div>
    <div class="grid two">${whatIfCard(a)}${overrideCard(a)}</div>
    ${CONDITION_CHECKS[v.id] || a.status === 'active' ? `<div class="grid two">${conditionCard(a)}${vendorCard(a)}</div>` : ''}
    <div class="grid two">
      ${box('box-fact', '확인된 사실', a.facts.map(f => `<li>${esc(f.fact)}<span class="chip">${esc(f.ref)}</span></li>`))}
      ${box('box-cond', '기업별 적용 조건', a.conditions.map(c => `<li>${esc(c)}</li>`))}
      ${box('box-infer', '추론', a.inferences.map(c => `<li>${esc(c)}</li>`))}
      ${box('box-unc', '불확실성', a.uncertainties.map(c => `<li>${esc(c)}</li>`))}
    </div>
    ${box('', '추가 확인 사항', a.checks.map(c => `<li>${esc(c)}</li>`))}
    <div class="card">
      <h3>근거 자료</h3>
      <div class="table-wrap"><table>
        <tr><th>출처</th><th>확인 내용</th><th>수집 시각</th></tr>
        ${a.facts.map(f => `<tr><td><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a></td><td>${esc(f.fact)}</td><td class="muted">${f.collectedAt}</td></tr>`).join('')}
      </table></div>
    </div>
    ${a.advisory ? `<div class="card">
      <h3>공급업체 권고문 원문 점검 (외부 텍스트)</h3>
      <blockquote class="advisory">${a.advisory.text.split(/(?<=\.)\s+/).map(s => a.advisory.flagged.includes(s) ? `<mark>${esc(s)}</mark>` : esc(s)).join(' ')}</blockquote>
      ${a.advisory.flagged.length ? `<p class="error">지시성 문장 ${a.advisory.flagged.length}건 감지 — 실행하지 않음</p>` : ''}
      <p class="muted">외부 문서는 데이터로만 취급 — 문서 안의 지시는 따르지 않으며 위험 판정·조치 업무에 반영하지 않음</p>
    </div>` : ''}
    <div class="card">
      <div class="toolbar"><h3 style="margin:0">조치 업무</h3>
        ${a.status === 'active' ? `<button class="small" data-action="create-tasks" data-id="${esc(key)}">조치 업무 생성</button>` : ''}
        ${allDone && a.asset.patch !== '적용 완료' && evidenceDraft?.assetId !== a.asset.id ? `<button class="small" data-action="evidence-open" data-id="${a.asset.id}">자산 패치 상태 '적용 완료'로 갱신</button>` : ''}
      </div>
      ${allDone && a.asset.patch !== '적용 완료' && evidenceDraft?.assetId === a.asset.id ? evidenceForm(a.asset) : ''}
      ${tasks.length ? taskTable(tasks, false) : '<p class="empty">생성된 업무 없음</p>'}
      <p class="muted">시스템 변경·패치는 자동 실행하지 않음 — 담당자 검토·승인 후 수행</p>
    </div>
    <div class="card">
      <h3>판단 갱신 이력</h3>
      ${hist.length ? `<ul class="timeline">${hist.map(historyItem).join('')}</ul>` : '<p class="empty">변경 이력 없음 (최초 평가 이후 변경 없음)</p>'}
    </div>`;
}

// 영향 조건 확인: 읽기 전용 명령 출력 해석 → 미충족이면 승인 후 영향 없음(담당자 조정)으로 반영
const VERDICT_CLS = { 충족: 'p-urgent', 미충족: 'p-done', '판단 불가': 'p-none' };

function conditionCard(a) {
  const spec = CONDITION_CHECKS[a.vuln.id];
  if (!spec) return '';
  const rec = state.conditionChecks[a.key];
  const d = condDraft[a.key] || {};
  const k = esc(a.key);
  return `<div class="card">
    <h3>영향 조건 확인</h3>
    <p class="muted">버전 대조로 알 수 없는 권고문의 영향 조건을 읽기 전용 명령으로 확인 (목업: 출력 해석은 LLM 대체 규칙)</p>
    <blockquote class="advisory">권고문 조건: ${esc(spec.condition)}</blockquote>
    <p>${esc(spec.plain)}</p>
    <p class="muted">확인 명령 — 읽기 전용, 시스템을 바꾸지 않음</p>
    ${spec.commands.map(c => `<code class="cmd">${esc(c)}</code>`).join('')}
    ${rec ? `<p>최근 확인 ${rec.at}: ${badge(`조건 ${rec.verdict}`, VERDICT_CLS[rec.verdict])} ${esc(rec.reason)}</p>` : ''}
    <textarea data-cond-output="${k}" rows="3" placeholder="명령 출력 붙여넣기">${esc(d.output || '')}</textarea>
    <div class="toolbar" style="margin-top:8px"><button class="small ghost" data-action="cond-sample" data-id="${k}" data-sample="met">예시: 조건 충족</button>
      <button class="small ghost" data-action="cond-sample" data-id="${k}" data-sample="notMet">예시: 조건 미충족</button>
      <button class="small" data-action="cond-run" data-id="${k}">결과 해석</button></div>
    ${d.result ? `<p>${badge(`조건 ${d.result.verdict}`, VERDICT_CLS[d.result.verdict])} ${esc(d.result.reason)}</p>
      ${d.result.verdict === '미충족' ? `<button class="small" data-action="cond-apply" data-id="${k}">승인 — 영향 없음으로 반영</button>`
        : d.result.verdict === '충족' ? `<button class="small ghost" data-action="cond-apply" data-id="${k}">확인 기록 저장 (현재 판정 유지)</button>`
          : '<p class="muted">판정 유지 — 담당자 직접 확인 필요</p>'}` : ''}
  </div>`;
}

function applyCondition(key) {
  const a = allAssessments().find(x => x.key === key);
  const d = condDraft[key];
  if (!a || !d?.result) return;
  const { verdict, reason } = d.result;
  state.conditionChecks[key] = { verdict, reason, at: nowText(), target: `${a.asset.name} × ${a.vuln.id}`, output: d.output.slice(0, 300) };
  addHistory('조건 확인', `${a.asset.name} × ${a.vuln.id}: 영향 조건 ${verdict} — ${reason}`, key);
  if (verdict === '미충족') {
    state.overrides[key] = { priority: '오탐', reason: `영향 조건 미충족 — ${reason}`, at: nowText(), basisLabel: a.label };
    addHistory('판단 수정', `${a.asset.name} × ${a.vuln.id}: ${a.label} → 영향 없음 (영향 조건 미충족, 확인 출력 보관)`, key);
  }
  delete condDraft[key];
  reassess(`영향 조건 확인: ${reason}`);
}

// 외주 업체 요청: 메일 초안 → 승인 후 발송(목업) → 회신 해석 → 승인 후 업무 일정 반영
function vendorCard(a) {
  if (a.status !== 'active') return '';
  const sent = state.vendorRequests[a.key];
  const d = vendorDraft[a.key] || {};
  const k = esc(a.key);
  const draft = vendorRequestDraft(a, addDays(today(), DUE_DAYS[a.priority] || 7));
  return `<div class="card">
    <h3>외주 업체 요청</h3>
    <p class="muted">책임 주체: ${esc(a.asset.maintainer || '자사 (미등록)')} — 요청 메일 초안 작성, 발송·일정 반영은 승인 후 (목업: 실제 발송 없음)</p>
    ${sent ? `<p>✔ ${sent.at} 발송(목업) — 수신 ${esc(sent.to)}${sent.schedule ? ` · 작업 예정 ${esc(sent.schedule)}` : ''}</p>`
      : `<blockquote class="advisory"><b>${esc(draft.subject)}</b><br>${draft.body.map(esc).join('<br>')}</blockquote>
        <button class="small" data-action="vendor-send" data-id="${k}">승인 — 발송 (목업)</button>`}
    ${sent && !sent.schedule ? `<textarea data-vendor-reply="${k}" rows="2" placeholder="업체 회신 붙여넣기">${esc(d.reply || '')}</textarea>
      <div class="toolbar" style="margin-top:8px"><button class="small ghost" data-action="vendor-sample" data-id="${k}">예시 회신</button>
        <button class="small" data-action="vendor-parse" data-id="${k}">회신 해석</button></div>
      ${d.parsed ? `<div class="table-wrap"><table><tr><th>작업 일자</th><th>시각</th><th>작업자</th><th>근거 문장</th></tr>
        <tr><td>${esc(d.parsed.date || '찾지 못함')}</td><td>${esc(d.parsed.time || '-')}</td><td>${esc(d.parsed.worker || '-')}</td><td class="muted">${esc(d.parsed.quote || '-')}</td></tr></table></div>
        ${d.parsed.date ? `<button class="small" data-action="vendor-apply" data-id="${k}">승인 — 업무 일정 반영</button>` : '<p class="muted">일정을 찾지 못함 — 업무 화면에서 직접 입력</p>'}` : ''}` : ''}
  </div>`;
}

function applyVendorReply(key) {
  const a = allAssessments().find(x => x.key === key);
  const p = vendorDraft[key]?.parsed;
  if (!a || !p?.date) return;
  if (!state.tasks.some(t => t.key === key)) createTasks(key);
  const schedule = `${p.date}${p.time ? ` ${p.time}` : ''}`;
  const owner = `외주: ${p.worker || vendorName(a.asset)}`;
  state.tasks.filter(t => t.key === key && t.title.startsWith('패치 가능 여부')).forEach(t => { t.due = schedule; t.owner = owner; t.status = t.status === '완료' ? t.status : '진행'; });
  state.vendorRequests[key].schedule = schedule;
  addHistory('외주 요청', `${a.asset.name} × ${a.vuln.id}: 업체 회신 반영 — 작업 예정 ${schedule}, ${owner}`, key);
  delete vendorDraft[key];
  save();
}

function saveOverride(key) {
  const a = allAssessments().find(x => x.key === key);
  const priority = document.getElementById('ovPriority').value;
  const reason = document.getElementById('ovReason').value.trim();
  if (!a) return;
  if (!reason) { overrideError = '조정 사유 입력 필요'; route(); return; }
  state.overrides[key] = { priority, reason, at: nowText(), basisLabel: a.label };
  addHistory('판단 수정', `${a.asset.name} × ${a.vuln.id}: ${a.label} → ${priority} (사유: ${reason})`, key);
  overrideError = '';
  reassess(`담당자 판단 수정: ${reason}`);
  route();
}

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
  route();
  return created.length;
}

// 취약점 외 할 일 (kind: gap·scan·contract) — key·제목 중복 시 생략
function addExtraTask(t) {
  if (state.tasks.some(x => x.key === t.key && x.title === t.title)) return false;
  state.tasks.push({ id: `T${++state.seq}`, priority: '보통', priorityCls: 'p-medium', refs: [], status: '대기', owner: '', checkedAt: '', createdAt: today(), ...t });
  addHistory('조치 업무', `${t.assetName}: '${t.title}' 할 일 등록`);
  return true;
}

// ---------- 화면: 대화형 분석 ----------
function citationNote(c) {
  if (!c) return '';
  return `<div class="muted">인용 검증 ${c.ok}/${c.total} 출처 확인${c.missing.length ? ` · <span class="error">근거 없는 인용: ${c.missing.map(esc).join(', ')}</span>` : ''}</div>`;
}

function renderMsg(m, i, byKey) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
  const items = m.itemKeys.map(k => byKey[k]).filter(Boolean);
  return `<div class="msg agent">
    ${m.proactive ? '<div class="brief-tag">에이전트 자동 브리핑</div>' : ''}
    ${m.text.map(t => `<p>${esc(t)}</p>`).join('')}
    ${m.discovery ? discoveryTable(m.discovery, false) : ''}
    ${m.chart ? renderChart(m.chart) : ''}
    ${m.previewRows ? intakeTable(m.previewRows) : ''}
    ${items.length ? `<ul class="items">${items.map(a => `<li>${badge(a.label, a.cls)} <a href="${detailLink(a.key)}">${esc(a.asset.name)} × ${a.vuln.id}</a> <span class="muted">${a.status === 'active' ? `${a.score}점 · 신뢰도 ${a.confidence}` : ''}</span></li>`).join('')}</ul>` : ''}
    ${citationNote(m.citation)}
    ${m.refs.length ? `<div class="muted">근거 출처 ${m.refs.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</div>` : ''}
    ${m.link ? `<p><a href="${m.link.href}">${esc(m.link.label)} →</a></p>` : ''}
    ${m.action ? (m.done ? `<p class="muted">✔ ${esc(m.doneText)}</p>`
      : `<button class="small" data-action="agent-approve" data-id="${i}">${esc(m.action.label)}</button>${m.doneText ? `<p class="error">${esc(m.doneText)}</p>` : ''}`) : ''}
    <details class="tools"><summary>도구 호출 ${m.tools.length}건</summary><ol>${m.tools.map(t => `<li><code>${esc(t.name)}(${esc(t.args)})</code> → ${esc(t.result)}</li>`).join('')}</ol></details>
  </div>`;
}

function viewChat() {
  const byKey = Object.fromEntries(allAssessments().map(a => [a.key, a]));
  return `
    <h2>대화형 분석</h2>
    <p class="sub">${esc(state.name)} 데이터 기준 · 자연어 질의 → 에이전트가 평가·통계 도구를 호출해 근거·차트와 함께 답변 (목업 에이전트, 실제 LLM 미연동)</p>
    <div class="card">
      <div class="chat-log" id="chatLog">${chatLog.length ? chatLog.map((m, i) => renderMsg(m, i, byKey)).join('') : '<p class="empty">아래 예시 질문을 누르거나 직접 입력</p>'}</div>
      <div class="examples">${AGENT_EXAMPLES.map(q => `<button class="small ghost" data-action="chat-example" data-id="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form id="chatForm" class="chat-form"><input name="q" placeholder="예: FortiOS 관련 위협 왜 긴급이야?" autocomplete="off"><button type="submit">질의</button></form>
    </div>`;
}

function sendChat(text) {
  text = text.trim();
  if (!text) return;
  const { items, ...rest } = agentRespond(text);
  chatLog.push({ role: 'user', text }, { role: 'agent', ...rest, itemKeys: items.map(a => a.key) });
  route();
}

// ---------- 화면: 리포트 ----------
function renderSection(s) {
  return `<h3>${esc(s.heading)}</h3>
    ${(s.paragraphs || []).map(p => `<p>${esc(p)}</p>`).join('')}
    ${s.bullets ? `<ul class="plain">${s.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    ${s.chart ? renderChart(s.chart) : ''}
    ${s.table ? simpleTable(s.table) : ''}`;
}

function reportBody(r) {
  return `<h2>${esc(r.title)}</h2>
    <p class="muted">생성 일시 ${r.generatedAt} · ${esc(state.name)} · ${esc(r.scope)} · 시연용 가상 데이터</p>
    ${r.sections.map(renderSection).join('')}`;
}

function scheduleCard() {
  const allowed = planOf().schedule;
  const freqs = ['매일 09:00', '매주 월요일 09:00', '매월 1일 09:00'];
  const dis = allowed ? '' : 'disabled';
  return `<div class="card no-print">
    <div class="toolbar"><h3 style="margin:0">정기 리포트 예약</h3>${allowed ? '<button class="small" data-action="run-schedules">예약 실행 시뮬레이션</button>' : ''}</div>
    ${allowed ? '' : `<p class="warn">${esc(state.plan)} 플랜은 정기 리포트 예약 미지원 — <a href="#plans">요금제 보기</a></p>`}
    <div class="table-wrap"><table>
      <tr><th>사용</th><th>리포트</th><th>주기</th><th>수신자</th></tr>
      ${['exec', 'detail', 'compliance'].map(k => {
        const s = state.schedules[k];
        return `<tr><td><input type="checkbox" data-sched="${k}" data-sched-field="on" ${s.on ? 'checked' : ''} ${dis}></td><td>${REPORT_TYPES[k]}</td>
          <td><select data-sched="${k}" data-sched-field="freq" ${dis}>${freqs.map(f => `<option ${f === s.freq ? 'selected' : ''}>${f}</option>`).join('')}</select></td>
          <td><input data-sched="${k}" data-sched-field="to" value="${esc(s.to)}" ${dis}></td></tr>`;
      }).join('')}
    </table></div>
    <p class="muted">긴급 알림 리포트는 KEV 연관 긴급 위협 감지 시 자동 생성. 실제 이메일·메신저 발송은 목업</p>
  </div>`;
}

function archiveCard() {
  return `<div class="card no-print"><h3>리포트 보관함 (${state.reportLog.length})</h3>
    ${state.reportLog.length ? `<div class="table-wrap"><table><tr><th>생성 일시</th><th>리포트</th><th>생성 방식</th><th>수신자</th></tr>
      ${state.reportLog.map(l => `<tr><td>${l.generatedAt}</td><td><a href="#report/log-${l.id}">${esc(l.title)}</a></td><td>${esc(l.trigger)}</td><td class="muted">${esc(l.recipients || '-')}</td></tr>`).join('')}
    </table></div>` : '<p class="empty">보관된 리포트 없음 — 예약 실행·자동 감지·보관함 저장 시 기록</p>'}</div>`;
}

function viewReport(param) {
  if (param && param.startsWith('log-')) return viewReportLog(param.slice(4));
  const type = REPORT_TABS.includes(param) ? param : 'exec';
  return `
    <h2>자동 리포트</h2>
    <p class="sub">현재 평가·조치 데이터로 즉시 생성 · 정기 예약·자동 감지 리포트는 보관함에 기록</p>
    <div class="toolbar no-print">
      ${REPORT_TABS.map(k => `<a class="tab ${k === type ? 'active' : ''}" href="#report/${k}">${REPORT_TYPES[k]}</a>`).join('')}
      <button class="small" data-action="report-print">인쇄·PDF 저장</button>
      <button class="small ghost" data-action="report-md" data-id="${type}">Markdown 다운로드</button>
      <button class="small ghost" data-action="report-save" data-id="${type}">보관함에 저장</button>
    </div>
    <div class="card report">${reportBody(buildReport(type))}</div>
    ${scheduleCard()}
    ${archiveCard()}`;
}

function viewReportLog(id) {
  const log = state.reportLog.find(l => l.id === id);
  if (!log) return '<div class="card">보관된 리포트를 찾을 수 없음</div>';
  return `<p class="no-print"><a href="#report">← 리포트</a></p>
    <div class="toolbar no-print"><span class="muted">보관본 · ${esc(log.trigger)}${log.recipients ? ` · 수신 ${esc(log.recipients)} (목업 발송)` : ''}</span>
      <button class="small" data-action="report-print">인쇄·PDF 저장</button>
      <button class="small ghost" data-action="report-md" data-id="log-${log.id}">Markdown 다운로드</button></div>
    <div class="card report">${reportBody(log.report)}</div>`;
}

function runSchedules() {
  if (!planOf().schedule) return;
  const on = Object.entries(state.schedules).filter(([, s]) => s.on);
  if (!on.length) return;
  on.forEach(([k, s]) => archiveReport(k, `예약 — ${s.freq}`, null, s.to));
  addHistory('리포트', `예약 리포트 ${on.length}건 생성·발송(목업): ${on.map(([k]) => REPORT_TYPES[k]).join(', ')}`);
  notify('리포트', `예약 리포트 ${on.length}건 발송 완료(목업)`, on.map(([, s]) => s.to).join(', '), '#report');
  save();
  route();
}

function downloadMarkdown(id) {
  const r = id.startsWith('log-') ? state.reportLog.find(l => l.id === id.slice(4))?.report : buildReport(id);
  if (!r) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([reportToMarkdown(r)], { type: 'text/markdown' }));
  link.download = `${state.name}_${r.title}_${today()}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------- 화면: 조치 업무 ----------
function taskTable(tasks, showTarget) {
  return `<div class="table-wrap"><table>
    <tr><th>우선순위</th><th>업무</th>${showTarget ? '<th>대상</th>' : ''}<th>권장 이유</th><th>근거</th><th>담당자</th><th>상태</th><th>확인 일자</th></tr>
    ${tasks.map(t => `<tr>
      <td>${badge(t.priority, t.priorityCls)}</td>
      <td>${esc(t.title)}${t.due ? `<div class="muted">작업 예정 ${esc(t.due)}</div>` : ''}</td>
      ${showTarget ? `<td><a href="${t.kind ? t.link : detailLink(t.key)}">${esc(t.assetName)}<br><span class="muted">${esc(t.cveId)}</span></a></td>` : ''}
      <td class="muted">${esc(t.reason)}</td>
      <td>${t.refs.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</td>
      <td><input data-task-id="${t.id}" data-task-field="owner" value="${esc(t.owner)}" size="8"></td>
      <td><select data-task-id="${t.id}" data-task-field="status">${['대기', '진행', '완료'].map(s => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        ${t.autoClosed ? `<div class="muted">자동 종결: ${esc(t.autoClosed)}</div>` : ''}</td>
      <td><input type="date" data-task-id="${t.id}" data-task-field="checkedAt" value="${esc(t.checkedAt)}"></td>
    </tr>`).join('')}
  </table></div>`;
}

function viewTasks() {
  const order = { 긴급: 0, 높음: 1, 보통: 2, 낮음: 3 };
  const tasks = state.tasks
    .filter(t => taskFilter === 'all' || (taskFilter === 'open' ? t.status !== '완료' : t.status === '완료'))
    .sort((a, b) => order[a.priority] - order[b.priority]);
  const opt = (v, l) => `<option value="${v}" ${taskFilter === v ? 'selected' : ''}>${l}</option>`;
  return `
    <h2>대응 업무 관리</h2>
    <p class="sub">위협 분석 상세 화면이나 대화형 분석에서 생성한 조치 항목 · 상태·담당자·확인 일자 기록</p>
    <div class="card">
      <div class="toolbar"><select id="taskFilter">${opt('open', '미완료')}${opt('done', '완료')}${opt('all', '전체')}</select>
        <span class="muted">전체 ${state.tasks.length}건 · 완료 ${state.tasks.filter(t => t.status === '완료').length}건</span></div>
      ${tasks.length ? taskTable(tasks, true) : '<p class="empty">업무 없음 — 위협 분석 상세에서 \'조치 업무 생성\' 실행</p>'}
    </div>`;
}

function updateTask(id, field, value) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || t[field] === value) return;
  t[field] = value;
  if (field === 'status') {
    if (value === '완료' && !t.checkedAt) t.checkedAt = today();
    addHistory(value === '완료' ? '조치 완료' : '조치 업무', `${t.assetName} × ${t.cveId}: '${t.title}' → ${value}`, t.key);
  }
  save();
  route();
}

// ---------- 화면: 이력 ----------
function historyItem(h) {
  return `<li><span class="time">${h.time}</span><span class="type">${esc(h.type)}</span><span>${h.key ? `<a href="${detailLink(h.key)}">${esc(h.text)}</a>` : esc(h.text)}</span></li>`;
}

function viewHistory() {
  return `
    <h2>평가·조치 이력</h2>
    <p class="sub">${esc(state.name)} · 판단 변경·수정, 위협 정보 갱신, 자산 변경, 조치·리포트 기록</p>
    <div class="card">${state.history.length ? `<ul class="timeline">${state.history.map(historyItem).join('')}</ul>` : '<p class="empty">이력 없음</p>'}</div>`;
}

// ---------- 화면: 고객사 현황 (MSP) ----------
function viewTenants() {
  const stats = statTenants();
  return `
    <h2>고객사 현황</h2>
    <p class="sub">파트너(MSP) 화면 · 담당 고객사 ${stats.length}곳의 위험 현황을 한눈에 비교하고 전환</p>
    <div class="grid two">
      <div class="card">${renderChart({ kind: 'bar', title: '고객사별 대응 필요 위협', unit: '건', rows: stats.map(s => ({ label: s.name, value: s.active, fill: SERIES[0], title: `${s.name}: 대응 필요 ${s.active}건 · 긴급 ${s.urgent}건` })) })}</div>
      <div class="card">
        <h3>고객사 추가</h3>
        <form id="tenantForm" class="asset-form one">
          <label>고객사명 *<input name="name" required placeholder="예: 샘플 D사"></label>
          <label>업종<input name="industry" placeholder="예: 유통"></label>
          ${selectField('plan', '플랜', PLANS.filter(p => !p.partnerOnly).map(p => p.id), '무료')}
          <div class="form-actions"><button type="submit">추가 후 전환</button></div>
        </form>
      </div>
    </div>
    <div class="card"><div class="table-wrap"><table>
      <tr><th>고객사</th><th>업종</th><th>플랜</th><th>자산</th><th>대응 필요</th><th>긴급</th><th>KEV 연관</th><th>조치 진행률</th><th>읽지 않은 알림</th><th></th></tr>
      ${stats.map(s => `<tr class="${s.id === state.id ? 'current-row' : ''}">
        <td><b>${esc(s.name)}</b></td><td>${esc(s.industry)}</td><td>${esc(s.plan)}</td><td class="num">${s.assets}</td><td class="num">${s.active}</td>
        <td class="num">${s.urgent ? badge(s.urgent, 'p-urgent') : 0}</td><td class="num">${s.kev}</td><td class="num">${s.progress == null ? '-' : `${s.progress}%`}</td>
        <td class="num">${s.unread}</td>
        <td>${s.id === state.id ? '<span class="muted">현재</span>' : `<button class="small ghost" data-action="switch-tenant" data-id="${s.id}">열기</button>`}</td>
      </tr>`).join('')}
    </table></div></div>`;
}

function addTenant(form) {
  const data = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v).trim()]));
  const id = `T${Object.keys(store.tenants).length + 1}`;
  const t = seedTenant({
    id, name: data.name, industry: data.industry || '미지정', plan: data.plan, assets: [],
    trend: Array.from({ length: 7 }, () => [0, 0]), onboarding: {},
    schedules: Object.fromEntries(Object.entries(DEFAULT_SCHEDULES).map(([k, s]) => [k, { ...s, on: false }])),
  });
  t.vulns = store.vulns; t.feed = store.feed;
  store.tenants[id] = t;
  switchTenant(id);
  addHistory('고객사', `고객사 생성: ${t.name} (${t.plan} 플랜)`);
  save();
  location.hash = '#todo';
  route();
}

// ---------- 화면: 내 사이트 적용 점검 (사용자 소유 실사이트 2곳) ----------
const MYSITE_CLS = { 가능: 'p-done', 부분: 'p-medium', '해당 없음': 'p-none' };
const MYSITE_STEPS = [
  ['WN', 'assets', 'WhiteNoard: 자동 자산 탐색 → React 버전 보완 승인 → 할 일 홈에 CVE-2026-41009(가상) 카드 → 증빙 예시 입력 후 종결'],
  ['WN', 'assets', 'WhiteNoard: 외부 점검 결과 가져오기 → "실사이트 점검 — WhiteNoard" 예시 → 분석 → 승인 → 헤더·SRI 할 일'],
  ['ANI', 'assets', '애니 시맨틀: 자동 자산 탐색 → 광고·분석 스크립트 신규 등록 → "실사이트 점검 — 애니 시맨틀" 예시로 보안 헤더 할 일'],
  ['ANI', 'ops', '애니 시맨틀: 오류 모니터링 → 구성요소 "통계 저장소"·"연결 고갈" 시뮬레이션 → 오류 보고서 초안'],
  ['WN', 'incident', 'WhiteNoard: 사고 대응 → 개인정보 유출 의심 → 신고 기한·신고서 초안'],
  ['WN', 'tenants', '고객사 현황: 두 사이트 위험·진행률 비교'],
];

function viewMySite() {
  const ids = ['ANI', 'WN'].filter(id => store.tenants[id]);
  if (!ids.length) return '<h2>내 사이트 적용 점검</h2><div class="card"><p class="empty">실사이트 고객사 없음 — 상단 [데모 초기화] 후 다시 열기</p></div>';
  const cells = MYSITE_FEATURES.flatMap(f => ids.map(id => f[id][0]));
  const stats = statTenants().filter(s => ids.includes(s.id));
  const openTasks = id => store.tenants[id].tasks.filter(t => t.status !== '완료').length;
  const demoBtn = (id, view, label) => `<button class="small ghost" data-action="mysite-demo" data-id="${id}|${view}">${esc(label)}</button>`;
  return `
    <h2>내 사이트 적용 점검</h2>
    <p class="sub">${ids.map(id => esc(OPS_SITES[id].domain)).join(' · ')} — MVP 기능별 적용 가능 여부와 시연 바로가기</p>
    <p class="muted">관측: ${MYSITE_OBSERVED} 읽기 전용 GET 요청(응답 헤더·HTML·공개 스크립트)만 사용한 스냅샷. 두 사이트 모두 CORS 미허용이라 브라우저에서 직접 재수집 불가 — 실서비스는 서버 측 수집기. 위협 정보 CVE-2026-41009는 시연용 가상 취약점</p>
    <div class="grid kpi">${Object.keys(MYSITE_CLS).map(v => `<div class="card"><div class="label">${v}</div><div class="num">${cells.filter(c => c === v).length}</div><div class="hint">기능 ${MYSITE_FEATURES.length}개 × 사이트 ${ids.length}곳 기준</div></div>`).join('')}</div>
    <div class="card"><h3>사이트 관측 결과</h3>${simpleTable({ head: ['항목', ...ids.map(id => OPS_SITES[id].name)], rows: MYSITE_CHECKS.map(r => [r[0], ...ids.map(id => r[id === 'ANI' ? 1 : 2])]) })}</div>
    <div class="card"><h3>기능별 적용 판정</h3><div class="table-wrap"><table>
      <tr><th>MVP 기능</th>${ids.map(id => `<th>${esc(OPS_SITES[id].name)}</th>`).join('')}</tr>
      ${MYSITE_FEATURES.map(f => `<tr><td><b>${esc(f.feature)}</b></td>${ids.map(id => `<td>${badge(f[id][0], MYSITE_CLS[f[id][0]])} ${f[id][0] === '해당 없음' ? '' : demoBtn(id, f.view, '시연')}<div class="muted">${esc(f[id][1])}</div></td>`).join('')}</tr>`).join('')}
    </table></div></div>
    <div class="grid two">
      <div class="card"><h3>권장 시연 순서</h3><ol>${MYSITE_STEPS.map(([id, view, text]) => `<li>${esc(text)} ${demoBtn(id, view, '열기')}</li>`).join('')}</ol></div>
      <div class="card"><h3>현재 상태</h3>${simpleTable({ head: ['사이트', '자산', '대응 필요', '긴급', '미완료 할 일', '읽지 않은 알림'], rows: stats.map(s => [s.name, s.assets, s.active, s.urgent, openTasks(s.id), s.unread]) })}
        <p class="muted">시연 버튼은 해당 고객사로 전환 후 화면 이동 — 상태는 고객사별로 따로 저장</p></div>
    </div>`;
}

// ---------- 화면: 점검 대응 (원청·인증 점검 양식 자동 작성) ----------
function viewAudit() {
  const form = AUDIT_FORMS.find(f => f.id === auditFormId);
  const rows = form ? fillAuditForm(form) : null;
  const gaps = rows ? rows.filter(r => r.status === '갭') : [];
  const logs = state.reportLog.filter(l => l.type === 'audit');
  return `
    <h2>원청·인증 점검 대응</h2>
    <p class="sub">${esc(state.name)} · 받은 점검 양식을 항목별로 분해해 시스템 기록과 대조 — 답변 초안·근거·갭 표시, 제출본 저장은 승인 후 (목업: 양식 분해는 LLM 대체 데이터)</p>
    <div class="card">
      <h3>받은 양식</h3>
      ${AUDIT_FORMS.map(f => `<div class="toolbar"><b>${esc(f.name)}</b> <span class="muted">${esc(f.from)}</span>
        <button class="small ${f.id === auditFormId ? '' : 'ghost'}" data-action="audit-run" data-id="${f.id}">${f.id === auditFormId ? '다시 작성' : '에이전트 작성'}</button></div>`).join('')}
    </div>
    ${form ? `<div class="card">
      <h3>${esc(form.name)}</h3>
      <details><summary>양식 원문</summary><blockquote class="advisory">${esc(form.raw).replace(/\n/g, '<br>')}</blockquote></details>
      <p>${['충족', '부분', '갭', '작성 필요'].map(s => `${badge(s, AUDIT_STATUS_CLS[s])} ${rows.filter(r => r.status === s).length}`).join(' · ')}
        <span class="muted">충족은 근거 기록이 연결된 항목만</span></p>
      <div class="table-wrap"><table><tr><th>항목</th><th>내용</th><th>상태</th><th>답변 초안</th><th>근거</th></tr>
        ${rows.map(r => `<tr><td>${esc(r.no)}</td><td>${esc(r.text)}</td><td>${badge(r.status, AUDIT_STATUS_CLS[r.status])}</td><td>${esc(r.answer)}</td>
          <td class="muted">${r.evidence.length ? r.evidence.map(esc).join('<br>') : '-'}</td></tr>`).join('')}
      </table></div>
      <details class="tools"><summary>도구 호출 ${rows.length + 1}건</summary><ol>
        <li><code>parse_checklist_form(${esc(form.short)})</code> → 항목 ${rows.length}건</li>
        ${rows.map(r => `<li><code>match_evidence(${esc(r.no)}, rule=${esc(r.rule)})</code> → ${esc(r.status)}</li>`).join('')}</ol></details>
      <div class="toolbar">
        ${gaps.length ? `<button class="small ghost" data-action="audit-gaps" data-id="${form.id}">갭 ${gaps.length}건 할 일로 등록</button>` : ''}
        <button class="small" data-action="audit-save" data-id="${form.id}">승인 — 제출본 저장 (수신 ${esc(form.from)})</button>
        <span class="muted">실제 제출·발송 없음</span></div>
    </div>` : ''}
    <div class="card"><h3>제출본 보관 (${logs.length})</h3>
      ${logs.length ? `<ul class="plain">${logs.map(l => `<li><a href="#report/log-${l.id}">${esc(l.title)}</a> <span class="muted">${l.generatedAt} · ${esc(l.report.summary)}</span></li>`).join('')}</ul>` : '<p class="empty">저장된 제출본 없음</p>'}</div>`;
}

// ---------- 화면: 사고 대응 ----------
function viewIncident() {
  const inc = state.incident;
  if (!inc) {
    return `
      <h2>사고 대응</h2>
      <p class="sub">침해가 의심될 때 비전문가가 따라 하는 첫 대응 체크리스트와 신고 기한 관리 (목업: 실제 신고 없음)</p>
      <div class="card">
        <p class="warn">${esc(INCIDENT_FIRST)}</p>
        <form id="incidentForm" class="asset-form">
          <label>의심 유형<select name="type">${INCIDENT_TYPES.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
          ${selectField('mode', '구분', ['모의 훈련', '실제'], '모의 훈련')}
          <label>인지 시각<input type="datetime-local" name="startedAt" value="${nowLocal()}"></label>
          <div class="form-actions"><button type="submit">대응 시작</button></div>
        </form>
      </div>
      <div class="card"><h3>대응·훈련 기록 (${state.incidents.length})</h3>
        ${state.incidents.length ? `<div class="table-wrap"><table><tr><th>구분</th><th>유형</th><th>인지</th><th>종료</th><th>수행 단계</th></tr>
          ${state.incidents.map(i => `<tr><td>${esc(i.mode)}</td><td>${esc(i.typeName)}</td><td>${esc(i.startedAt.replace('T', ' '))}</td><td>${esc(i.endedAt)}</td><td class="num">${Object.values(i.steps).filter(Boolean).length}</td></tr>`).join('')}
        </table></div>` : '<p class="empty">기록 없음 — 모의 훈련 기록은 점검 양식의 사고 대응 항목 근거로 사용</p>'}</div>`;
  }
  const type = INCIDENT_TYPES.find(t => t.id === inc.type);
  const deadlines = incidentDeadlines(inc);
  return `
    <h2>사고 대응 — ${esc(type.name)}</h2>
    <p class="sub">${badge(inc.mode, inc.mode === '실제' ? 'p-urgent' : 'p-medium')} 인지 ${esc(inc.startedAt.replace('T', ' '))} · 대응 시작 ${esc(inc.openedAt)}</p>
    <div class="card"><p class="warn">${esc(INCIDENT_FIRST)}</p></div>
    <div class="grid two">
      <div class="card"><h3>첫 대응 체크리스트</h3>
        <ul class="checklist">${type.steps.map((s, i) => `<li><label><input type="checkbox" data-inc-step="${i}" ${inc.steps[i] ? 'checked' : ''}> ${esc(s)}</label></li>`).join('')}</ul></div>
      <div class="card"><h3>신고·통지 기한</h3>
        <div class="table-wrap"><table><tr><th>완료</th><th>항목</th><th>기한</th><th>남은 시간</th></tr>
          ${deadlines.map(d => `<tr><td><input type="checkbox" data-inc-deadline="${d.id}" ${d.done ? 'checked' : ''} aria-label="${esc(d.name)} 완료"></td>
            <td>${esc(d.name)}<div class="muted">${esc(d.basis)} · 인지 후 ${d.hours}시간</div></td><td>${d.due}</td>
            <td>${d.done ? badge('완료', 'p-done') : badge(leftText(d.left), d.left < 0 ? 'p-urgent' : d.left < 360 ? 'p-high' : 'p-low')}</td></tr>`).join('')}
        </table></div>
        <p class="muted">남은 시간은 화면을 열 때 기준으로 계산</p></div>
    </div>
    <div class="card"><h3>신고서 초안 (자동 정리)</h3>${simpleTable(incidentDraft(inc))}
      <p class="muted">신고 서식은 기관 안내에 따름 — 초안은 내용 정리용</p></div>
    <div class="toolbar"><button data-action="incident-end">대응 종료·기록 보관</button></div>`;
}

function startIncident(form) {
  const d = Object.fromEntries(form.entries());
  const type = INCIDENT_TYPES.find(t => t.id === d.type);
  state.incident = { type: d.type, mode: d.mode, startedAt: d.startedAt || nowLocal(), openedAt: nowText(), steps: {}, done: {} };
  addHistory('사고 대응', `${d.mode} 시작: ${type.name} (인지 ${state.incident.startedAt.replace('T', ' ')})`);
  if (d.mode === '실제') notify('긴급', `사고 대응 시작: ${type.name}`, '신고·통지 기한 확인 필요', '#incident');
  save();
  route();
}

// ---------- 화면: 요금제·지원사업 ----------
function profileCard() {
  const p = state.profile;
  return `<div class="card">
    <h3>회사 조건</h3>
    <p class="muted">보안 의무 일정·정부 지원사업 매칭 기준</p>
    <form id="profileForm" class="asset-form">
      <label>임직원 수<input type="number" name="employees" min="1" value="${p.employees}"></label>
      ${selectField('region', '지역', ['서울', '경기', '인천', '부산', '대구', '광주', '대전', '기타', '미지정'], p.region)}
      ${Object.entries(PROFILE_FLAGS).map(([k, l]) => `<label class="check"><input type="checkbox" name="${k}" ${p[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      <div class="form-actions"><button type="submit">저장</button></div>
    </form>
  </div>`;
}

function supportCard() {
  const list = matchPrograms();
  return `<div class="card">
    <h3>정부 지원사업</h3>
    <p class="muted">회사 조건으로 대상 여부 판단 — 지원 조건·비율·일정은 공고별 확인 필요 (목업)</p>
    <ul class="plain">${list.map(p => `<li>${badge(p.eligible ? '대상' : '조건 미충족', p.eligible ? 'p-done' : 'p-none')} <b>${esc(p.name)}</b> <span class="muted">${esc(p.org)} · ${esc(p.benefit)}</span>
      <div class="muted">${[...p.ok.map(x => `✔ ${x}`), ...p.fail.map(x => `✖ ${x}`)].map(esc).join(' · ')}</div>
      ${p.eligible ? `<button class="small ghost" data-action="support-doc" data-id="${p.id}">신청용 보안 현황 자료 생성</button>` : ''}</li>`).join('')}</ul>
  </div>`;
}

function saveProfile(form) {
  const d = Object.fromEntries(form.entries());
  state.profile = { employees: Math.max(1, Number(d.employees) || 1), region: d.region, ...Object.fromEntries(Object.keys(PROFILE_FLAGS).map(k => [k, form.has(k)])) };
  addHistory('회사 조건', `임직원 ${state.profile.employees}명 · ${state.profile.region} · ${Object.entries(PROFILE_FLAGS).filter(([k]) => state.profile[k]).map(([, l]) => l).join(', ') || '해당 조건 없음'}`);
  save();
  route();
}

function viewPlans() {
  if (state.onboarding && !state.onboarding.viewedPlans) { state.onboarding.viewedPlans = true; save(); }
  const lim = planOf().assetLimit;
  return `
    <h2>요금제</h2>
    <p class="sub">가격은 고객 인터뷰의 지불 의향 조사로 결정 예정 — 시연용 플랜 구조</p>
    <div class="card">
      <b>${esc(state.name)}</b> 현재 플랜 ${badge(state.plan, 'plan-badge')} · 자산 ${state.assets.length} / ${lim ?? '무제한'}
      ${lim ? `<div class="meter"><span style="width:${Math.min(100, (state.assets.length / lim) * 100)}%"></span></div>` : ''}
      ${lim && state.assets.length > lim ? '<p class="warn">한도 초과 — 신규 자산 등록 불가</p>' : ''}
    </div>
    <div class="plans">${PLANS.map(p => `<div class="card plan ${p.id === state.plan ? 'current' : ''}">
      <h3>${p.id}</h3><p class="muted">${esc(p.target)}</p><div class="price">${esc(p.price)}</div>
      <ul class="plain">${p.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      ${p.id === state.plan ? '<button class="small" disabled>현재 플랜</button>'
        : p.partnerOnly ? '<a class="small-link" href="#tenants">파트너 계정 전용 — 고객사 현황 보기</a>'
        : `<button class="small" data-action="set-plan" data-id="${p.id}">이 플랜으로 변경 (목업)</button>`}
    </div>`).join('')}</div>
    <p class="muted">결제 기능 없음. 플랜 변경 시 자산 한도와 예약 리포트 사용 가능 여부만 바뀜</p>
    <h2>회사 조건·정부 지원사업</h2>
    <div class="grid two">${profileCard()}${supportCard()}</div>`;
}

// ---------- 자동 오류 리포팅 ----------
const opsSite = () => OPS_SITES[state.id] || { name: '사이트', domain: `${state.name} 사이트` };
const opsOpen = inc => state.tasks.some(t => t.key === `ops|${inc.id}` && t.status !== '완료');
const OPS_STATUS_CLS = { '원인 후보': 'p-urgent', 이상: 'p-high', 주의: 'p-medium', 정상: 'p-done' };

// 오류 감지 → 분석 → 보고서 자동 보관·알림·할 일 등록 (KEV 긴급 알림 자동 생성과 같은 흐름)
function simulateOpsIncident(component, fault) {
  const id = `I${++state.seq}`;
  const site = opsSite().domain;
  const inc = { id, at: nowText(), ...runOpsAnalysis(component, fault, state.seq, site) };
  state.opsIncidents.unshift(inc);
  const f = inc.facts, top = f.원인_후보[0].서비스, rb = runbookOf(f.참고_런북[0].id);
  inc.reportId = archiveReport('error', '자동 — 사이트 오류 감지', id).id;
  addHistory('오류 감지', `${site}: ${top} ${f.추정_장애유형} 추정 — 근거 ${opsVerified(f)}/${f.검증.length} 확인, 오류 보고서 초안 자동 생성`);
  notify('오류', `${top} · ${f.추정_장애유형} 추정`, `${site} — 메신저 알림·오류 보고서 초안 자동 생성`, `#ops/${id}`);
  addExtraTask({ kind: 'ops', key: `ops|${id}`, assetName: `${site} ${top}`, cveId: rb.id, priority: '긴급', priorityCls: 'p-urgent',
    title: `[오류] ${rb.action}`, reason: `${f.추정_장애유형} 추정 — ${f.근거_지표[0].지표} 최대 z=${f.근거_지표[0].최대z}`, refs: [rb.id], link: `#ops/${id}` });
  save();
  return inc;
}

function opsTodoCard() {
  const inc = state.opsIncidents.find(opsOpen);
  if (!inc) return '';
  const f = inc.facts;
  return `<div class="card"><h3>사이트 오류 ${badge('조치 대기', 'p-urgent')}</h3>
    <p>${esc(f.장애_감지_시각)} · ${esc(inc.site)} — ${esc(f.원인_후보[0].서비스)}에서 ${esc(f.추정_장애유형)} 추정 (근거 ${opsVerified(f)}/${f.검증.length} 확인)</p>
    <div class="toolbar"><a href="#ops/${inc.id}">원인·근거 보기 →</a><a href="#report/log-${inc.reportId}">오류 보고서 →</a></div></div>`;
}

function opsDetail(inc) {
  const f = inc.facts, ok = opsVerified(f), n = f.검증.length;
  const hit = inc.truth.component === inc.det.top && inc.truth.fault === inc.det.fault;
  const rbs = f.참고_런북.map(r => runbookOf(r.id));
  return `<div class="card">
      <div class="toolbar"><h3 style="margin:0">${esc(f.원인_후보[0].서비스)} · ${esc(f.추정_장애유형)} 추정</h3>
        ${badge('오류 감지', 'p-urgent')} ${badge(`근거 ${ok}/${n} 확인`, ok === n ? 'p-done' : 'p-medium')}
        ${badge(hit ? '주입 정답 일치' : `주입 정답: ${opsName(inc.truth.component)} · ${faultOf(inc.truth.fault).name}`, hit ? 'p-done' : 'p-high')}
        ${badge(opsOpen(inc) ? '조치 대기' : '조치 완료', opsOpen(inc) ? 'p-high' : 'p-done')}</div>
      <p class="muted">감지 ${esc(f.장애_감지_시각)} · ${esc(inc.site)} · 케이스 ${esc(f.케이스)} · <a href="#report/log-${inc.reportId}">오류 보고서 초안 보기 →</a></p>
      <div class="grid two">
        <div><h3>에이전트 실행 로그</h3>${inc.steps.map(s => `<code class="cmd">${esc(s)}</code>`).join('')}</div>
        <div>${renderChart({ kind: 'bar', title: '원인 후보 순위 (점수)', rows: inc.det.ranking.slice(0, 5).map((r, i) => ({ label: opsName(r.id), value: Number(r.score.toFixed(3)), fill: i ? STATUS_FILL['p-low'] : STATUS_FILL['p-urgent'] })) })}</div>
      </div>
      ${renderChart(inc.chart)}
    </div>
    <div class="grid two">
      <div class="card"><h3>메신저 알림</h3><div class="ops-msg">${esc(inc.message)}</div><p class="muted">#오류-대응 채널 자동 알림 미리보기 — 실제 발송은 목업</p></div>
      <div class="card"><h3>근거 검증</h3>${simpleTable({ head: ['주장', '근거', '판정'], rows: f.검증.map(c => [`${c.판정 === '확인' ? '✔' : '⚠'} ${c.주장}`, c.근거, c.판정]) })}
        <p class="muted">판정은 규칙 기반 — '확인'이 아닌 주장은 보고서에 추정으로 표기</p></div>
    </div>
    <div class="grid two">
      <div class="card"><h3>로그 변화</h3>${simpleTable({ head: ['구성요소', '분당 로그(전→후)', '변화', '경고·오류'], rows: inc.logs.map(l => [opsName(l.component), `${l.pre} → ${l.post}`, `×${l.ratio}`, `${l.warnErr}줄`]) })}
        ${f.로그 === '없음' ? '' : `<p class="muted">신규 로그 패턴</p>${f.로그.새_로그_예시.map(t => `<code class="cmd">${esc(t)}</code>`).join('')}`}</div>
      <div class="card"><h3>참고 런북</h3>${rbs.map(rb => `<details ${rb.id === 'RB-REPORT' ? '' : 'open'}><summary><b>${rb.id}</b> ${esc(rb.title)}</summary><ul class="plain">
        ${[['증상', rb.symptom], ['흔한 원인', rb.cause], ['1차 확인', rb.check], ['즉시 조치', rb.action], ['재발 방지', rb.prevent]].map(([k, v]) => `<li><b>${k}</b>: ${esc(v)}</li>`).join('')}</ul></details>`).join('')}</div>
    </div>`;
}

function viewOps(param) {
  const list = state.opsIncidents;
  const inc = (param && list.find(i => i.id === param)) || list[0];
  const site = opsSite();
  const opt = (items, cur) => items.map(x => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  return `
    <h2>오류 모니터링</h2>
    <p class="sub">${esc(site.name)} ${esc(site.domain)} · 구성요소 ${opsComponents().length}개 지표·로그 상시 감시(목업) → 오류 감지 시 원인 분석·근거 검증 → 메신저 알림·오류 보고서 자동 생성</p>
    <div class="card no-print"><div class="toolbar" style="margin:0">
      <b>오류 시뮬레이션</b>
      <select id="opsComponent" aria-label="구성요소">${opt(opsComponents(), opsPick.component)}</select>
      <select id="opsFault" aria-label="오류 유형">${opt(OPS_FAULTS, opsPick.fault)}</select>
      <button class="small" data-action="ops-simulate">오류 발생 시뮬레이션</button>
      <span class="muted">합성 지표에 오류 주입 — 호출자 지연 전파·무관 구성요소 방해 스파이크 포함, 원인은 에이전트가 판단</span>
    </div></div>
    <div class="grid kpi">${opsComponents().map(c => {
      const st = inc ? inc.det.status[c.id] : '정상';
      return `<div class="card"><div class="label">${esc(c.name)}</div><div>${badge(st, OPS_STATUS_CLS[st])}</div><div class="hint">${esc(c.desc)}</div></div>`;
    }).join('')}</div>
    ${inc ? opsDetail(inc) : '<div class="card"><p class="empty">감지된 오류 없음 — 위에서 오류 시뮬레이션 실행</p></div>'}
    ${list.length ? `<div class="card"><h3>오류 이력 (${list.length})</h3><div class="table-wrap"><table>
      <tr><th>감지 시각</th><th>원인 후보</th><th>추정 유형</th><th>근거 검증</th><th>상태</th><th>보고서</th></tr>
      ${list.map(i => `<tr${i === inc ? ' class="current"' : ''}><td><a href="#ops/${i.id}">${esc(i.facts.장애_감지_시각)}</a></td><td>${esc(i.facts.원인_후보[0].서비스)}</td><td>${esc(i.facts.추정_장애유형)}</td>
        <td>${opsVerified(i.facts)}/${i.facts.검증.length} 확인</td><td>${opsOpen(i) ? badge('조치 대기', 'p-high') : badge('조치 완료', 'p-done')}</td><td><a href="#report/log-${i.reportId}">보기</a></td></tr>`).join('')}
    </table></div></div>` : ''}`;
}

// ---------- 시뮬레이션 ----------
function runSimulation() {
  const u = SIM_UPDATES[store.simStep];
  if (!u) return;
  const v = store.vulns.find(x => x.id === u.cveId);
  Object.assign(v, u.changes, { updatedAt: today() });
  store.simStep++;
  broadcastUpdate(`${v.id} (${v.product}) — ${u.text}`, `위협 정보 갱신: ${u.text}`, `위협 정보 갱신: ${v.id} ${u.text}`);
  route();
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

// 국내 공지 추출 결과를 미검증 위협 정보로 추가 (위험도 등급은 규칙표 환산, EPSS 없음)
function ingestKr(id) {
  const ad = KR_ADVISORIES.find(x => x.id === id);
  if (!ad || store.krIngested.includes(id)) return;
  const e = ad.extract;
  store.vulns.push({
    id: ad.id, product: ad.product, title: e.title, affected: { from: e.from, fixed: e.fixed }, cvss: KR_SEVERITY[e.severity], epss: null, kev: false,
    published: ad.published, updatedAt: today(), summary: e.title, mitigation: e.mitigation, vendorUrl: 'https://www.boho.or.kr/',
    kr: { source: ad.source, ref: ad.ref, severity: e.severity, raw: ad.raw },
  });
  store.krIngested.push(id);
  broadcastUpdate(`${ad.id} (${ad.product}) — 국내 공지 구조화로 위협 정보 추가 (미검증)`, `국내 공지 추가: ${ad.product}`, `국내 공지 추가: ${ad.id} ${ad.product}`);
}

// ---------- 라우팅·이벤트 ----------
function route() {
  const [view, param] = (location.hash.slice(1) || 'todo').split('/');
  const views = {
    todo: viewTodo, dashboard: viewDashboard, chat: viewChat, assets: viewAssets, analysis: p => (p ? viewDetail(p) : viewAnalysis()),
    tasks: viewTasks, report: viewReport, history: viewHistory, tenants: viewTenants, plans: viewPlans,
    audit: viewAudit, incident: viewIncident, ops: viewOps, mysite: viewMySite,
  };
  $view.innerHTML = (views[view] || viewTodo)(param && decodeURIComponent(param));
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (views[view] ? view : 'todo')));
  const left = SIM_UPDATES.length - store.simStep;
  const btn = document.getElementById('simBtn');
  btn.textContent = left ? `위협 정보 갱신 시뮬레이션 (${left})` : '시뮬레이션 완료';
  btn.disabled = !left;
  renderTopbar();
  if (view === 'chat') {
    const log = document.getElementById('chatLog');
    log.scrollTop = log.scrollHeight;
    document.querySelector('#chatForm input').focus();
  }
}

document.addEventListener('click', e => {
  if (notifOpen && !e.target.closest('.bell-wrap')) { notifOpen = false; renderTopbar(); }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'open': location.hash = detailLink(id); break;
    case 'simulate': runSimulation(); break;
    case 'ops-simulate': {
      opsPick = { component: document.getElementById('opsComponent').value, fault: document.getElementById('opsFault').value };
      const inc = simulateOpsIncident(opsPick.component, opsPick.fault);
      location.hash = `#ops/${inc.id}`;
      break;
    }
    case 'reset':
      try { localStorage.removeItem(STORE_KEY); } catch (err) { /* 무시 */ }
      store = seedStore(); initTenants(); switchTenant('A');
      location.hash = '#todo'; route();
      break;
    case 'toggle-notif': notifOpen = !notifOpen; renderTopbar(); break;
    case 'read-all': state.notifications.forEach(n => { n.read = true; }); save(); renderTopbar(); break;
    case 'open-notif': {
      const n = state.notifications.find(x => x.id === id);
      if (!n) break;
      n.read = true; notifOpen = false; save();
      if (location.hash === n.link) route(); else location.hash = n.link;
      break;
    }
    case 'edit-asset': editingAssetId = id; formDraft = null; route(); window.scrollTo(0, 0); break;
    case 'cancel-edit': editingAssetId = null; formDraft = null; route(); break;
    case 'asset-autofill': {
      const d = Object.fromEntries([...new FormData(document.getElementById('assetForm')).entries()].map(([k, v]) => [k, String(v).trim()]));
      const p = parseLine([d.name, d.product, d.version, d.purpose].filter(Boolean).join(' ')).asset;
      const product = p.product || d.product;
      formDraft = {
        ...d, product, type: p.type, criticality: p.criticality, owner: d.owner || p.owner,
        exposure: d.exposure === '미확인' ? p.exposure : d.exposure, patch: inferPatch(product, d.version) || d.patch,
      };
      route();
      break;
    }
    case 'discover':
      discoverySources = [...document.querySelectorAll('[data-disc-source]:checked')].map(x => x.dataset.discSource);
      discoveryPreview = runDiscovery(discoverySources, state.assets, state.id);
      route();
      break;
    case 'discover-clear': discoveryPreview = null; route(); break;
    case 'discover-apply': {
      const picked = [...document.querySelectorAll('[data-disc-pick]:checked')].map(x => discoveryPreview[Number(x.dataset.discPick)]);
      if (!picked.length) break;
      const r = applyDiscovery(picked);
      if (r.ok) { discoveryPreview = null; formError = ''; } else formError = r.msg;
      route();
      break;
    }
    case 'delete-asset': {
      const a = state.assets.find(x => x.id === id);
      state.assets = state.assets.filter(x => x.id !== id);
      state.tasks = state.tasks.filter(t => !t.key.startsWith(`${id}|`));
      Object.keys(state.overrides).filter(k => k.startsWith(`${id}|`)).forEach(k => delete state.overrides[k]);
      if (editingAssetId === id) editingAssetId = null;
      addHistory('자산 변경', `자산 삭제: ${a.name}`);
      reassess(`자산 삭제: ${a.name}`); route();
      break;
    }
    case 'intake-sample': intakeText = INTAKE_SAMPLES[id]; intakePreview = null; route(); break;
    case 'intake-parse': intakeText = document.getElementById('intakeText').value; intakePreview = parseAssets(intakeText); route(); break;
    case 'intake-clear': intakePreview = null; route(); break;
    case 'intake-commit': {
      const r = addAssets(intakePreview.map(p => p.asset), '자산 일괄 등록');
      if (r.ok) { intakePreview = null; intakeText = ''; formError = ''; } else formError = r.msg;
      route();
      break;
    }
    case 'create-tasks': createTasks(id); break;
    case 'save-override': saveOverride(id); break;
    case 'clear-override': {
      delete state.overrides[id];
      addHistory('판단 수정', `담당자 조정 해제 — 시스템 판정으로 복귀`, id);
      reassess('담당자 조정 해제'); route();
      break;
    }
    case 'whatif-apply': {
      const a = state.assets.find(x => x.id === id.split('|')[0]);
      const vals = whatIfValues();
      const changes = Object.entries(vals).filter(([k, v]) => v !== (a[k] || '')).map(([k, v]) => `${k}=${v || '미등록'}`);
      Object.assign(a, vals);
      addHistory('자산 변경', `${a.name}: What-if 가정 반영 (${changes.join(', ')})`, id);
      reassess('What-if 가정을 자산 정보로 반영'); route();
      break;
    }
    case 'chat-example': sendChat(id); break;
    case 'agent-approve': {
      const m = chatLog[Number(id)];
      if (!m || m.done) break;
      if (m.action.type === 'register-assets') {
        const r = addAssets(m.action.assets, '대화형 자산 등록');
        m.doneText = r.ok ? `승인됨 — 자산 ${r.msg}` : r.msg;
        m.done = r.ok;
      } else if (m.action.type === 'apply-discovery') {
        const r = applyDiscovery(m.action.findings);
        m.doneText = r.ok ? `승인됨 — 탐색 결과 ${r.msg}` : r.msg;
        m.done = r.ok;
      } else {
        const n = (m.action.keys || [m.action.key]).reduce((sum, k) => sum + createTasks(k), 0);
        m.done = true;
        m.doneText = `승인됨 — 조치 업무 ${n}건 생성 (중복 제외)`;
      }
      route();
      break;
    }
    case 'report-print': window.print(); break;
    case 'report-md': downloadMarkdown(id); break;
    case 'report-save': {
      const log = archiveReport(id, '수동 저장');
      addHistory('리포트', `${log.title} 보관함 저장`);
      save(); route();
      break;
    }
    case 'run-schedules': runSchedules(); break;
    case 'switch-tenant': switchTenant(id); location.hash = '#todo'; route(); break;
    case 'mysite-demo': {
      const [tid, view] = id.split('|');
      if (!store.tenants[tid]) break;
      switchTenant(tid);
      if (location.hash === `#${view}`) route(); else location.hash = `#${view}`;
      break;
    }
    case 'todo-discover':
      discoveryPreview = runDiscovery(discoverySources, state.assets, state.id).filter(f => f.kind !== '확인');
      route();
      break;
    case 'todo-discover-apply': {
      const r = applyDiscovery(discoveryPreview);
      discoveryPreview = null;
      if (!r.ok) formError = r.msg;
      route();
      break;
    }
    case 'send-exec': {
      const to = state.schedules.exec.to;
      const log = archiveReport('exec', '수동 발송(목업)', null, to);
      addHistory('리포트', `${log.title} 발송(목업): ${to}`);
      notify('리포트', '대표 보고 발송 완료(목업)', to, `#report/log-${log.id}`);
      save(); route();
      break;
    }
    case 'evidence-open': evidenceDraft = { assetId: id, type: '버전 확인 출력', text: '', error: '' }; route(); break;
    case 'evidence-cancel': evidenceDraft = null; route(); break;
    case 'evidence-sample': {
      const a = state.assets.find(x => x.id === id);
      evidenceDraft = { ...evidenceDraft, type: '버전 확인 출력', error: '',
        text: `$ ${VERSION_CMD[a.product] || '버전 확인 명령'}\n${a.product} ${fixedVersionOf(a.product, state.vulns) || ''}` };
      route();
      break;
    }
    case 'mark-patched': {
      const a = state.assets.find(x => x.id === id);
      const type = document.getElementById('evType').value;
      const text = document.getElementById('evText').value.trim();
      const v = evidenceVerdict(text, a.product, state.vulns);
      if (!v.ok) { evidenceDraft = { assetId: id, type, text, error: v.detail }; route(); break; }
      a.patch = '적용 완료';
      a.patchEvidence = { at: today(), type, text: text.slice(0, 300), verdict: v.label, detail: v.detail };
      addHistory('자산 변경', `${a.name}: 조치 결과 반영 — 패치 상태 '적용 완료' (증빙: ${type}, ${v.label} — ${v.detail})`);
      evidenceDraft = null;
      reassess('조치 결과 반영: 패치 적용 완료(증빙 확인)'); route();
      break;
    }
    case 'cond-sample': {
      const spec = CONDITION_CHECKS[id.split('|')[1]];
      condDraft[id] = { output: spec.samples[el.dataset.sample] };
      route();
      break;
    }
    case 'cond-run': {
      const output = [...document.querySelectorAll('[data-cond-output]')].find(x => x.dataset.condOutput === id).value;
      condDraft[id] = { output, result: interpretCheck(CONDITION_CHECKS[id.split('|')[1]], output) };
      route();
      break;
    }
    case 'cond-apply': applyCondition(id); route(); break;
    case 'vendor-send': {
      const a = allAssessments().find(x => x.key === id);
      const draft = vendorRequestDraft(a, addDays(today(), DUE_DAYS[a.priority] || 7));
      state.vendorRequests[id] = { at: nowText(), to: draft.to, subject: draft.subject };
      addHistory('외주 요청', `${a.asset.name} × ${a.vuln.id}: ${draft.to}에 패치 작업 요청 발송(목업)`, id);
      save(); route();
      break;
    }
    case 'vendor-sample': vendorDraft[id] = { reply: VENDOR_REPLY_SAMPLE }; route(); break;
    case 'vendor-parse': {
      const reply = [...document.querySelectorAll('[data-vendor-reply]')].find(x => x.dataset.vendorReply === id).value;
      vendorDraft[id] = { reply, parsed: parseVendorReply(reply, today()) };
      route();
      break;
    }
    case 'vendor-apply': applyVendorReply(id); route(); break;
    case 'kr-extract': krPreview = id; route(); break;
    case 'kr-clear': krPreview = null; route(); break;
    case 'kr-apply': ingestKr(id); krPreview = null; route(); break;
    case 'scan-sample': scanText = SCAN_SAMPLES[id].text; scanSource = SCAN_SAMPLES[id].label; scanPreview = null; route(); break;
    case 'scan-parse': {
      scanText = document.getElementById('scanText').value;
      if (!scanSource) scanSource = '외부 점검 결과';
      const r = parseScanResults(scanText);
      scanPreview = { findings: r.observations.map(o => classifyObservation(o, state.assets, scanSource)), configs: r.configs, passed: r.passed };
      route();
      break;
    }
    case 'scan-clear': scanPreview = null; route(); break;
    case 'scan-apply': {
      const r = applyScan();
      if (r.ok) { scanPreview = null; scanText = ''; formError = ''; } else formError = r.msg;
      route();
      break;
    }
    case 'audit-run': auditFormId = id; route(); break;
    case 'audit-gaps': {
      const form = AUDIT_FORMS.find(f => f.id === id);
      fillAuditForm(form).filter(r => r.status === '갭').forEach(r => addExtraTask({
        kind: 'gap', key: `gap|${form.id}|${r.no}`, assetName: form.short, cveId: `항목 ${r.no}`,
        title: `점검 항목 ${r.no} 보완: ${r.text}`, reason: r.answer, refs: ['점검 양식'], link: '#audit',
      }));
      save(); route();
      break;
    }
    case 'audit-save': {
      const form = AUDIT_FORMS.find(f => f.id === id);
      const log = archiveReport('audit', '승인 — 제출본 저장', id, form.from);
      addHistory('점검 대응', `${log.title} 저장 (${log.report.summary})`);
      save(); route();
      break;
    }
    case 'incident-end': {
      const inc = state.incident;
      const type = INCIDENT_TYPES.find(t => t.id === inc.type);
      state.incidents.unshift({ ...inc, typeName: type.name, endedAt: nowText() });
      state.incident = null;
      addHistory('사고 대응', `${inc.mode} 종료·기록 보관: ${type.name} (수행 단계 ${Object.values(inc.steps).filter(Boolean).length}/${type.steps.length})`);
      save(); route();
      break;
    }
    case 'support-doc': {
      const log = archiveReport('support', '지원사업 신청 자료 생성', id);
      addHistory('리포트', `${log.title} 생성`);
      save();
      location.hash = `#report/log-${log.id}`;
      break;
    }
    case 'contract-task': {
      const a = state.assets.find(x => x.id === id);
      const c = contractAlerts().find(x => x.asset.id === id && x.kind === el.dataset.kind);
      if (c) addExtraTask({ kind: 'contract', key: `contract|${id}|${c.kind}`, assetName: a.name, cveId: c.kind, title: `${c.task} (${a.name})`, reason: `${c.kind} ${c.date}`, refs: ['자산 대장'], link: '#assets' });
      save(); route();
      break;
    }
    case 'decide': {
      const d = decisionRequests(allAssessments()).find(x => x.id === id);
      if (!d) break;
      state.decisions[id] = { status: el.dataset.reply, at: nowText() };
      addHistory('대표 결정', `${d.title}: ${el.dataset.reply} (대표 회신 목업)`);
      save(); route();
      break;
    }
    case 'set-plan': {
      const prev = state.plan;
      state.plan = id;
      addHistory('플랜 변경', `${prev} → ${id} (목업, 결제 없음)`);
      formError = ''; save(); route();
      break;
    }
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'analysisFilter') { analysisFilter = el.value; route(); }
  else if (el.id === 'taskFilter') { taskFilter = el.value; route(); }
  else if (el.id === 'tenantSelect') { switchTenant(el.value); route(); }
  else if (el.dataset.whatif) updateWhatIf();
  else if (el.dataset.sched) {
    state.schedules[el.dataset.sched][el.dataset.schedField] = el.type === 'checkbox' ? el.checked : el.value.trim();
    save();
  }
  else if (el.dataset.taskField) updateTask(el.dataset.taskId, el.dataset.taskField, el.value);
  else if (el.dataset.todoTask) updateTask(el.dataset.todoTask, 'status', el.checked ? '완료' : '대기');
  else if (el.dataset.dutyDone) completeDuty(el.dataset.dutyDone);
  else if (el.dataset.incStep || el.dataset.incDeadline) updateIncident(el);
});

function completeDuty(id) {
  const d = DUTIES.find(x => x.id === id);
  state.dutyLog.unshift({ id, at: today() });
  state.dutyDue[id] = addDays(today(), d.cycleDays);
  addHistory('의무 이행', `${d.title} 완료 — 다음 기한 ${state.dutyDue[id]}`);
  save();
  route();
}

function updateIncident(el) {
  const inc = state.incident;
  const type = INCIDENT_TYPES.find(t => t.id === inc.type);
  if (el.dataset.incStep) {
    inc.steps[el.dataset.incStep] = el.checked;
    addHistory('사고 대응', `${type.steps[el.dataset.incStep]} — ${el.checked ? '완료' : '해제'}`);
  } else {
    inc.done[el.dataset.incDeadline] = el.checked;
    addHistory('사고 대응', `${REPORT_DEADLINES.find(d => d.id === el.dataset.incDeadline).name} — ${el.checked ? '완료 표시' : '해제'}`);
  }
  save();
  route();
}

function updateWhatIf() {
  const box = document.getElementById('whatifResult');
  if (box) box.innerHTML = whatIfResult(box.dataset.key, whatIfValues());
}
document.addEventListener('input', e => { if (e.target.dataset.whatif) updateWhatIf(); });

document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'assetForm') saveAsset(new FormData(e.target));
  else if (e.target.id === 'chatForm') sendChat(e.target.q.value);
  else if (e.target.id === 'tenantForm') addTenant(new FormData(e.target));
  else if (e.target.id === 'incidentForm') startIncident(new FormData(e.target));
  else if (e.target.id === 'profileForm') saveProfile(new FormData(e.target));
});

window.addEventListener('hashchange', route);

store = load() || seedStore();
state = store.tenants[store.current] || store.tenants.A;
initTenants();
route();
