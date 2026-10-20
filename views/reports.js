// 보고 (기획안_v3 6-5): 경영진 운영 보고(보안·오류 통합)·실무자 상세·조치 이행·긴급 알림·오류 보고서, 예약·보관함
// 조치 이행 탭 하단: 원청·인증 점검표 답변 초안 (기획안_v3 5-5 ①)

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

// 대표 결정 요청 회신 (목업: 대표는 메일에서 회신)
function decisionCard() {
  const list = decisionRequests(allAssessments());
  if (!list.length) return '';
  return `<div class="card no-print"><h3>대표 결정 요청 (${list.length})</h3>
    <p class="muted">보고서에 포함 — 대표는 메일에서 회신 (목업: 아래 버튼으로 회신 시뮬레이션)</p>
    <ul class="plain">${list.map(d => `<li>${esc(d.title)} <span class="muted">${esc(d.ask)} · 영향: ${esc(d.impact)}</span>
      ${d.reply ? badge(`${d.reply.status} ${d.reply.at.slice(5)}`, d.reply.status === '승인' ? 'p-done' : 'p-none')
        : `<button class="small ghost" data-action="decide" data-id="${esc(d.id)}" data-reply="승인">승인</button> <button class="small ghost" data-action="decide" data-id="${esc(d.id)}" data-reply="보류">보류</button>`}</li>`).join('')}</ul>
  </div>`;
}

// 원청·인증 점검표: 양식 항목을 시스템 기록과 대조 — 근거가 연결된 항목만 충족, 제출본 저장은 승인 후
function auditPanel() {
  const form = AUDIT_FORMS.find(f => f.id === ui.auditFormId);
  const rows = form ? fillAuditForm(form) : null;
  const gaps = rows ? rows.filter(r => r.status === '갭') : [];
  const logs = state.reportLog.filter(l => l.type === 'audit');
  return `<details class="card no-print" ${keep('audit')}>
    <summary><b>원청·인증 점검표 답변 초안</b> <span class="muted">받은 양식을 기록과 대조해 초안 작성 (목업: 양식 분해는 LLM 대체 데이터)</span></summary>
    ${AUDIT_FORMS.map(f => `<div class="toolbar"><b>${esc(f.name)}</b> <span class="muted">${esc(f.from)}</span>
      <button class="small ${f.id === ui.auditFormId ? '' : 'ghost'}" data-action="audit-run" data-id="${f.id}">${f.id === ui.auditFormId ? '다시 작성' : '에이전트 작성'}</button></div>`).join('')}
    ${form ? `
      <p>${['충족', '부분', '갭', '작성 필요'].map(s => `${badge(s, AUDIT_STATUS_CLS[s])} ${rows.filter(r => r.status === s).length}`).join(' · ')}</p>
      <div class="table-wrap"><table><tr><th>항목</th><th>내용</th><th>상태</th><th>답변 초안</th><th>근거</th></tr>
        ${rows.map(r => `<tr><td>${esc(r.no)}</td><td>${esc(r.text)}</td><td>${badge(r.status, AUDIT_STATUS_CLS[r.status])}</td><td>${esc(r.answer)}</td>
          <td class="muted">${r.evidence.length ? r.evidence.map(esc).join('<br>') : '-'}</td></tr>`).join('')}
      </table></div>
      <div class="toolbar">
        ${gaps.length ? `<button class="small ghost" data-action="audit-gaps" data-id="${form.id}">갭 ${gaps.length}건 할 일로 등록</button>` : ''}
        <button class="small" data-action="audit-save" data-id="${form.id}">승인 — 제출본 저장 (수신 ${esc(form.from)})</button>
        <span class="muted">실제 제출·발송 없음</span></div>` : ''}
    ${logs.length ? `<p class="muted">제출본 ${logs.length}건: ${logs.map(l => `<a href="#report/log-${l.id}">${esc(l.title)}</a>`).join(', ')}</p>` : ''}
  </details>`;
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
        return `<tr><td><input type="checkbox" data-change="sched" data-id="${k}" data-field="on" ${s.on ? 'checked' : ''} ${dis}></td><td>${REPORT_TYPES[k]}</td>
          <td><select data-change="sched" data-id="${k}" data-field="freq" ${dis}>${freqs.map(f => `<option ${f === s.freq ? 'selected' : ''}>${f}</option>`).join('')}</select></td>
          <td><input data-change="sched" data-id="${k}" data-field="to" value="${esc(s.to)}" ${dis}></td></tr>`;
      }).join('')}
    </table></div>
    <p class="muted">긴급 알림 리포트는 KEV 연관 긴급 위협 감지 시 자동 생성. 실제 이메일·메신저 발송은 목업</p>
  </div>`;
}

function archiveCard() {
  return `<div class="card no-print"><h3>리포트 보관함 (${state.reportLog.length})</h3>
    ${state.reportLog.length ? `<div class="table-wrap"><table><tr><th>생성 일시</th><th>리포트</th><th>생성 방식</th><th>수신자</th></tr>
      ${state.reportLog.map(l => `<tr><td>${l.generatedAt}</td><td><a href="#report/log-${l.id}">${esc(l.title)}</a></td><td>${esc(l.trigger)}</td><td class="muted">${esc(l.recipients || '-')}</td></tr>`).join('')}
    </table></div>` : '<p class="empty">보관된 리포트 없음 — 발송·예약 실행·자동 감지·보관함 저장 시 기록</p>'}</div>`;
}

function viewReport(param) {
  if (param && param.startsWith('log-')) return viewReportLog(param.slice(4));
  const type = REPORT_TABS.includes(param) ? param : 'exec';
  return `
    <h2>보고</h2>
    <p class="sub">현재 평가·조치 데이터로 즉시 생성 — 수치는 규칙 엔진, 문장은 템플릿(LLM 자리)</p>
    <div class="toolbar no-print">
      ${REPORT_TABS.map(k => `<a class="tab ${k === type ? 'active' : ''}" href="#report/${k}">${REPORT_TYPES[k]}</a>`).join('')}
      <span class="spacer"></span>
      <button class="small" data-action="report-print">인쇄·PDF 저장</button>
      <button class="small ghost" data-action="report-md" data-id="${type}">Markdown 다운로드</button>
      <button class="small ghost" data-action="report-save" data-id="${type}">보관함에 저장</button>
    </div>
    ${type === 'exec' ? decisionCard() : ''}
    <div class="card report">${reportBody(buildReport(type))}</div>
    ${type === 'compliance' ? auditPanel() : ''}
    ${scheduleCard()}
    ${archiveCard()}`;
}

function viewReportLog(id) {
  const log = state.reportLog.find(l => l.id === id);
  if (!log) return '<div class="card">보관된 리포트를 찾을 수 없음</div>';
  return `<p class="no-print"><a href="#report">← 보고</a></p>
    <div class="toolbar no-print"><span class="muted">보관본 · ${esc(log.trigger)}${log.recipients ? ` · 수신 ${esc(log.recipients)} (목업 발송)` : ''}</span>
      <button class="small" data-action="report-print">인쇄·PDF 저장</button>
      <button class="small ghost" data-action="report-md" data-id="log-${log.id}">Markdown 다운로드</button></div>
    <div class="card report">${reportBody(log.report)}</div>`;
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

VIEWS.report = viewReport;

Object.assign(ACTIONS, {
  'report-print': () => window.print(),
  'report-md': id => downloadMarkdown(id),
  'report-save': id => {
    const log = archiveReport(id, '수동 저장');
    addHistory('리포트', `${log.title} 보관함 저장`);
    save(); route();
  },
  'run-schedules': () => {
    const on = Object.entries(state.schedules).filter(([, s]) => s.on);
    if (!planOf().schedule || !on.length) return;
    on.forEach(([k, s]) => archiveReport(k, `예약 — ${s.freq}`, null, s.to));
    addHistory('리포트', `예약 리포트 ${on.length}건 생성·발송(목업): ${on.map(([k]) => REPORT_TYPES[k]).join(', ')}`);
    notify('리포트', `예약 리포트 ${on.length}건 발송 완료(목업)`, on.map(([, s]) => s.to).join(', '), '#report');
    save(); route();
  },
  decide: (id, el) => {
    const d = decisionRequests(allAssessments()).find(x => x.id === id);
    if (!d) return;
    state.decisions[id] = { status: el.dataset.reply, at: nowText() };
    addHistory('대표 결정', `${d.title}: ${el.dataset.reply} (대표 회신 목업)`);
    save(); route();
  },
  'audit-run': id => { ui.auditFormId = id; ui.open.add('audit'); route(); },
  'audit-gaps': id => {
    const form = AUDIT_FORMS.find(f => f.id === id);
    fillAuditForm(form).filter(r => r.status === '갭').forEach(r => addExtraTask({
      kind: 'gap', key: `gap|${form.id}|${r.no}`, assetName: form.short, cveId: `항목 ${r.no}`,
      title: `점검 항목 ${r.no} 보완: ${r.text}`, reason: r.answer, refs: ['점검 양식'], link: '#report/compliance',
    }));
    save(); route();
  },
  'audit-save': id => {
    const form = AUDIT_FORMS.find(f => f.id === id);
    const log = archiveReport('audit', '승인 — 제출본 저장', id, form.from);
    addHistory('점검 대응', `${log.title} 저장 (${log.report.summary})`);
    save(); route();
  },
});

CHANGES.sched = el => {
  state.schedules[el.dataset.id][el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value.trim();
  save();
};
