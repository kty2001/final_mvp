// 할 일 홈 (기획안_v3 6-7): 주 사용자의 유일한 필수 화면 — 보안·오류·설정 보완을 한 목록에서 위 카드부터 처리
// 순서: 상태 줄(보안·오류) → 처리율 → 에이전트 브리핑 → 확인 필요 → 오늘·이번 주·이번 달 → 기타 할 일 → 대표 보고

const TODO_GROUPS = [
  { title: '오늘 처리', hint: '실제 공격 위험이 크거나 지금 사이트에 문제가 있는 항목', match: a => a.priority === '긴급' },
  { title: '이번 주', hint: '위험 높음', match: a => a.priority === '높음' },
  { title: '이번 달', hint: '여유 있게 처리', match: a => ['보통', '낮음'].includes(a.priority), collapsed: true },
];
const EXTRA_SOURCE = { ops: '사이트 오류', starter: '사이트', scan: '점검 결과', gap: '점검 양식', contract: '계약·단종' };
const DUTY_WITHIN = 30; // 의무 일정은 30일 이내만 홈에 표시
const fixOf = t => (t.kind === 'scan' && t.fixId ? CONFIG_FIXES.find(f => f.id === t.fixId) : null);

// 할 일 카드: 왜(쉬운 말) → 체크리스트 → 필요 시 에이전트 설명·근거
function todoCard(a) {
  const tasks = state.tasks.filter(t => t.key === a.key);
  const lines = explain(a);
  const allDone = tasks.length && tasks.every(t => t.status === '완료');
  return `<div class="card todo-card ${a.cls}-edge">
    <div class="head">${badge(a.label, a.cls)} <b>${esc(a.asset.name)}</b> <span class="muted">${esc(a.vuln.title)}</span></div>
    <p class="why"><b>왜</b> ${plainReasons(a).map(esc).join(' · ')}</p>
    ${tasks.length
      ? `<ul class="checklist">${tasks.map(t => `<li><label><input type="checkbox" data-change="todo-task" data-id="${t.id}" ${t.status === '완료' ? 'checked' : ''}> ${esc(t.title)}</label>${t.autoClosed ? ' <span class="chip">자동 종결</span>' : ''}</li>`).join('')}</ul>`
      : `<ul class="checklist draft">${taskTemplates(a).slice(0, 3).map(t => `<li>${esc(t.title)}</li>`).join('')}</ul>
        <button class="small" data-action="create-tasks" data-id="${esc(a.key)}">할 일로 등록</button>`}
    ${allDone ? (ui.evidenceDraft?.assetId === a.asset.id ? evidenceForm(a.asset)
      : `<p class="muted">할 일 완료 — 패치 반영 시 목록에서 빠짐 <button class="small ghost" data-action="evidence-open" data-id="${a.asset.id}">패치 적용 완료로 반영</button></p>`) : ''}
    <details><summary>에이전트 설명</summary>${lines.map(l => `<p><span class="t t-${l.tag}">${l.tag}</span>${esc(l.text)}</p>`).join('')}
      ${citationNote(verifyCitations(lines.map(l => l.text), [a]))}</details>
    <a href="${detailLink(a.key)}">근거·What-if 보기 →</a>
  </div>`;
}

// 설정 보완 수정안 (L1): 규칙 템플릿 수정안 → 승인 후 반영 기록 → 재점검으로 종결
function fixCode(fix) {
  const domain = opsSite().domain;
  if (!fix.header) return fix.code.replace('{domain}', domain).replace('{expires}', addDays(today(), 365));
  const [k, v] = SECURITY_HEADERS.find(([h]) => h === fix.header);
  return `# _headers — ${domain}
/*
  ${k}: ${v}`;
}

function fixCard(t) {
  const fix = fixOf(t);
  return `<div class="card todo-card ${t.priorityCls}-edge">
    <div class="head">${badge('설정 보완', t.priorityCls)} <b>${esc(t.assetName)}</b> <span class="muted">${esc(t.title)}</span></div>
    <p class="why"><b>왜</b> ${esc(fix.plain)}</p>
    <p class="muted">수정안 — ${fix.header ? '_headers 파일에 추가' : esc(fix.file)} (규칙 템플릿 · 반영은 담당자가 직접)</p>
    <code class="cmd">${esc(fixCode(fix))}</code>
    ${fix.header ? '<p class="muted">Cloudflare Functions·Workers 응답에는 _headers가 적용되지 않음 — 해당 응답은 코드에서 같은 헤더 추가 필요</p>' : ''}
    <div class="toolbar">${t.fix?.appliedAt
      ? `<span class="chip">반영 기록 ${t.fix.appliedAt}</span><button class="small" data-action="fix-recheck" data-id="${t.id}">재점검 (시뮬레이션)</button>`
      : `<button class="small" data-action="fix-apply" data-id="${t.id}">승인 — 반영 완료로 기록</button>`}
      <span class="muted">${esc(t.reason)}</span></div>
  </div>`;
}

// 상태 줄: 보안·오류 두 축의 현재 상태를 같은 무게로
function statusStrip(active) {
  const incs = openIncidents();
  const bad = incs.length ? Object.values(incs[0].det.status).filter(s => s !== '정상').length : 0;
  return `<div class="grid status">
    <a class="card stat" href="#dashboard"><span class="label">보안</span><span class="num">${active.length}</span>
      <span class="hint">대응 필요 위협 · 긴급 ${active.filter(a => a.priority === '긴급').length}건</span></a>
    <a class="card stat" href="#ops"><span class="label">오류</span><span class="num">${incs.length}</span>
      <span class="hint">${incs.length ? `조치 대기 오류 · 구성요소 이상 ${bad}개` : `조치 대기 없음 · ${esc(opsSite().domain)} 정상`}</span></a>
  </div>`;
}

// 증빙 기반 조치 종결: 증빙 없이는 패치 완료 반영 불가 (위협 분석 상세에서도 사용)
function evidenceForm(asset) {
  const d = ui.evidenceDraft;
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

// 확인 필요: 정보가 부족해 판단 보류 → 에이전트 자동 확인 → 승인 후 반영
function checkCard(list) {
  if (!list.length) return '';
  const p = ui.discoveryPreview;
  return `<div class="card todo-check">
    <h3>확인 필요 — 정보가 부족해 판단 보류 (${list.length})</h3>
    <ul class="plain">${list.map(a => `<li>${badge(a.label, a.cls)} <a href="${detailLink(a.key)}">${esc(a.asset.name)} × ${a.vuln.id}</a>
      <span class="muted">${esc(a.checks.filter(c => !c.startsWith('공급업체')).join(', '))}</span></li>`).join('')}</ul>
    ${p
      ? (p.length ? `${discoveryTable(p, false)}
        <div class="toolbar"><button class="small" data-action="todo-discover-apply">승인 — ${p.length}건 반영</button>
          <button class="small ghost" data-action="discover-clear">취소</button></div>` : '<p class="empty">새로 확인된 정보 없음 — 담당자 직접 확인 필요</p>')
      : '<div class="toolbar"><button class="small" data-action="todo-discover">에이전트 자동 확인</button><span class="muted">연결 소스에서 버전·노출 정보 수집 (목업) → 승인 후 반영</span></div>'}
  </div>`;
}

// 취약점 외 할 일: 등록된 비취약점 업무 + 의무 일정 + 계약·단종 임박을 한 목록으로
function otherCard() {
  const open = state.tasks.filter(t => t.kind && t.kind !== 'ops' && !fixOf(t) && t.status !== '완료');
  const duties = applicableDuties().filter(d => d.dday <= DUTY_WITHIN);
  const contracts = contractAlerts().filter(c => !state.tasks.some(t => t.key === `contract|${c.asset.id}|${c.kind}`));
  const n = open.length + duties.length + contracts.length;
  if (!n) return '';
  const dday = d => badge(ddayText(d), d < 0 ? 'p-urgent' : d <= 14 ? 'p-high' : 'p-low');
  return `<section class="todo-group"><h3>기타 할 일 (${n}) <span class="muted">오류·점검·의무 일정·계약</span></h3><div class="card">
    <ul class="checklist">
      ${open.map(t => `<li><label><input type="checkbox" data-change="todo-task" data-id="${t.id}"> ${esc(t.title)}</label>
        <span class="chip">${EXTRA_SOURCE[t.kind] || '기타'}</span> <a class="muted" href="${t.link}">${esc(t.assetName)}</a></li>`).join('')}
      ${duties.map(d => `<li><label><input type="checkbox" data-change="duty-done" data-id="${d.id}"> ${esc(d.title)}</label> ${dday(d.dday)}
        <span class="chip">의무 일정</span> <span class="muted">${esc(d.cycle)} · ${esc(d.basis)}</span></li>`).join('')}
      ${contracts.map(c => `<li>${esc(c.task)} — ${esc(c.asset.name)} ${dday(c.dday)} <span class="chip">계약·단종</span>
        <button class="small ghost" data-action="contract-task" data-id="${c.asset.id}" data-kind="${esc(c.kind)}">할 일로 등록</button></li>`).join('')}
    </ul>
    ${duties.length ? '<p class="muted">의무 일정은 완료 체크 시 이행 기록 저장 후 다음 기한으로 이동 — 점검 양식 근거로 사용</p>' : ''}
  </div></section>`;
}

// 대표 보고: 구매자(대표)는 로그인하지 않고 보고 한 장만 받음 — 결정 회신은 경영진 보고서 안에서
function execCard(list) {
  const report = buildReport('exec');
  const pending = decisionRequests(list).filter(d => !d.reply).length;
  const sent = state.reportLog.find(l => l.trigger === '수동 발송(목업)');
  return `<div class="card">
    <h3>대표 보고</h3>
    <p>${esc(report.summary)}</p>
    <div class="toolbar"><a href="#report/exec">미리보기${pending ? ` · 결정 요청 ${pending}건` : ''} →</a>
      <button class="small" data-action="send-exec">이번 주 보고 보내기 (목업)</button>
      <span class="muted">수신 ${esc(state.schedules.exec.to)}${sent ? ` · 최근 발송 ${sent.generatedAt}` : ''}</span></div>
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
  const brief = ui.chatLog.map((m, i) => [m, i]).filter(([m]) => m.proactive).pop();
  // 보안 위협·사이트 오류·설정 보완을 우선순위 하나로 묶어 같은 그룹에 표시
  const items = [
    ...openIncidents().map(inc => ({ priority: '긴급', html: () => opsCard(inc) })),
    ...ready.map(a => ({ priority: a.priority, html: () => todoCard(a) })),
    ...state.tasks.filter(t => t.status !== '완료' && fixOf(t)).map(t => ({ priority: t.priority, html: () => fixCard(t) })),
  ];
  return `
    <h2>이번 주 할 일</h2>
    <p class="sub">${esc(state.name)} · 할 일 처리율 ${rate}% (${done}/${state.tasks.length}) — 위 카드부터 처리</p>
    ${statusStrip(active)}
    <div class="meter"><span style="width:${rate}%"></span></div>
    ${state.assets.length ? '' : '<div class="card onboarding"><h3>시작하기</h3><p>등록된 자산 없음 — <a href="#assets">자산·연결 소스</a>에서 자동 탐색 또는 일괄 등록으로 시작</p></div>'}
    ${brief ? `<div class="card"><h3>에이전트 브리핑</h3>${renderMsg(brief[0], brief[1], byKey)}</div>` : ''}
    ${checkCard(unsure)}
    ${TODO_GROUPS.map(g => {
      const list = items.filter(g.match);
      if (!list.length) return '';
      const body = list.map(x => x.html()).join('');
      return g.collapsed
        ? `<details class="todo-group"><summary>${g.title} (${list.length}) <span class="muted">${g.hint}</span></summary>${body}</details>`
        : `<section class="todo-group"><h3>${g.title} (${list.length}) <span class="muted">${g.hint}</span></h3>${body}</section>`;
    }).join('')}
    ${items.length || unsure.length || !state.assets.length ? '' : '<div class="card"><p class="empty">대응할 위협·오류 없음</p></div>'}
    ${otherCard()}
    ${execCard(list)}`;
}

VIEWS.todo = viewTodo;

Object.assign(ACTIONS, {
  'todo-discover': () => {
    ui.discoveryPreview = runDiscovery(ui.discoverySources, state.assets, state.id).filter(f => f.kind !== '확인');
    route();
  },
  'todo-discover-apply': () => {
    const r = applyDiscovery(ui.discoveryPreview);
    ui.discoveryPreview = null;
    if (!r.ok) ui.formError = r.msg;
    route();
  },
  'send-exec': () => {
    const to = state.schedules.exec.to;
    const log = archiveReport('exec', '수동 발송(목업)', null, to);
    addHistory('리포트', `${log.title} 발송(목업): ${to}`);
    notify('리포트', '대표 보고 발송 완료(목업)', to, `#report/log-${log.id}`);
    save(); route();
  },
  'evidence-open': id => { ui.evidenceDraft = { assetId: id, type: '버전 확인 출력', text: '', error: '' }; route(); },
  'evidence-cancel': () => { ui.evidenceDraft = null; route(); },
  'evidence-sample': id => {
    const a = state.assets.find(x => x.id === id);
    ui.evidenceDraft = { ...ui.evidenceDraft, type: '버전 확인 출력', error: '',
      text: `$ ${VERSION_CMD[a.product] || '버전 확인 명령'}\n${a.product} ${fixedVersionOf(a.product, state.vulns) || ''}` };
    route();
  },
  'mark-patched': id => {
    const a = state.assets.find(x => x.id === id);
    const type = document.getElementById('evType').value;
    const text = document.getElementById('evText').value.trim();
    const v = evidenceVerdict(text, a.product, state.vulns);
    if (!v.ok) { ui.evidenceDraft = { assetId: id, type, text, error: v.detail }; route(); return; }
    a.patch = '적용 완료';
    a.patchEvidence = { at: today(), type, text: text.slice(0, 300), verdict: v.label, detail: v.detail };
    addHistory('자산 변경', `${a.name}: 조치 결과 반영 — 패치 상태 '적용 완료' (증빙: ${type}, ${v.label} — ${v.detail})`);
    ui.evidenceDraft = null;
    reassess('조치 결과 반영: 패치 적용 완료(증빙 확인)'); route();
  },
  'fix-apply': id => {
    const t = state.tasks.find(x => x.id === id);
    t.fix = { appliedAt: nowText() };
    t.status = '진행';
    addHistory('설정 보완', `${t.assetName}: '${t.title}' 수정안 반영 기록 (담당자 승인)`);
    save(); route();
  },
  'fix-recheck': id => {
    const t = state.tasks.find(x => x.id === id);
    t.fix.recheck = { at: nowText(), result: '양호' };
    t.status = '완료'; t.checkedAt = today(); t.autoClosed = '재점검 양호';
    addHistory('설정 보완', `${t.assetName}: '${t.title}' 재점검 양호 — 종결 (시뮬레이션: 실서비스는 응답 헤더·파일 재요청)`);
    save(); route();
  },
  'contract-task': (id, el) => {
    const a = state.assets.find(x => x.id === id);
    const c = contractAlerts().find(x => x.asset.id === id && x.kind === el.dataset.kind);
    if (c) addExtraTask({ kind: 'contract', key: `contract|${id}|${c.kind}`, assetName: a.name, cveId: c.kind, title: `${c.task} (${a.name})`, reason: `${c.kind} ${c.date}`, refs: ['자산 대장'], link: '#assets' });
    save(); route();
  },
});

Object.assign(CHANGES, {
  'todo-task': el => updateTask(el.dataset.id, 'status', el.checked ? '완료' : '대기'),
  'duty-done': el => {
    const d = DUTIES.find(x => x.id === el.dataset.id);
    state.dutyLog.unshift({ id: d.id, at: today() });
    state.dutyDue[d.id] = addDays(today(), d.cycleDays);
    addHistory('의무 이행', `${d.title} 완료 — 다음 기한 ${state.dutyDue[d.id]}`);
    save(); route();
  },
});
