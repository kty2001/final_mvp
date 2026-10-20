// 기록: 조치 업무 기록·이력 — 감사·점검 대응용 기록 확인 화면

function taskTable(tasks, showTarget) {
  return `<div class="table-wrap"><table>
    <tr><th>우선순위</th><th>업무</th>${showTarget ? '<th>대상</th>' : ''}<th>권장 이유</th><th>근거</th><th>담당자</th><th>상태</th><th>확인 일자</th></tr>
    ${tasks.map(t => `<tr>
      <td>${badge(t.priority, t.priorityCls)}</td>
      <td>${esc(t.title)}${t.due ? `<div class="muted">작업 예정 ${esc(t.due)}</div>` : ''}</td>
      ${showTarget ? `<td><a href="${t.kind ? t.link : detailLink(t.key)}">${esc(t.assetName)}<br><span class="muted">${esc(t.cveId)}</span></a></td>` : ''}
      <td class="muted">${esc(t.reason)}</td>
      <td>${t.refs.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</td>
      <td><input data-change="task-field" data-id="${t.id}" data-field="owner" value="${esc(t.owner)}" size="8"></td>
      <td><select data-change="task-field" data-id="${t.id}" data-field="status">${['대기', '진행', '완료'].map(s => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        ${t.autoClosed ? `<div class="muted">자동 종결: ${esc(t.autoClosed)}</div>` : ''}</td>
      <td><input type="date" data-change="task-field" data-id="${t.id}" data-field="checkedAt" value="${esc(t.checkedAt)}"></td>
    </tr>`).join('')}
  </table></div>`;
}

function viewTasks() {
  const order = { 긴급: 0, 높음: 1, 보통: 2, 낮음: 3 };
  const f = ui.taskFilter;
  const tasks = state.tasks
    .filter(t => f === 'all' || (f === 'open' ? t.status !== '완료' : t.status === '완료'))
    .sort((a, b) => order[a.priority] - order[b.priority]);
  const opt = (v, l) => `<option value="${v}" ${f === v ? 'selected' : ''}>${l}</option>`;
  return `
    <h2>조치 업무 기록</h2>
    <p class="sub">할 일 홈·위협 분석·에이전트 대화에서 등록한 조치 항목 · 상태·담당자·확인 일자 기록</p>
    <div class="card">
      <div class="toolbar"><select data-change="task-filter">${opt('open', '미완료')}${opt('done', '완료')}${opt('all', '전체')}</select>
        <span class="muted">전체 ${state.tasks.length}건 · 완료 ${state.tasks.filter(t => t.status === '완료').length}건</span></div>
      ${tasks.length ? taskTable(tasks, true) : '<p class="empty">업무 없음 — 할 일 홈에서 \'할 일로 등록\'</p>'}
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

function historyItem(h) {
  return `<li><span class="time">${h.time}</span><span class="type">${esc(h.type)}</span><span>${h.key ? `<a href="${detailLink(h.key)}">${esc(h.text)}</a>` : esc(h.text)}</span></li>`;
}

function viewHistory() {
  return `
    <h2>이력</h2>
    <p class="sub">${esc(state.name)} · 판단 변경·수정, 위협 정보 갱신, 자산 변경, 조치·리포트 기록</p>
    <div class="card">${state.history.length ? `<ul class="timeline">${state.history.map(historyItem).join('')}</ul>` : '<p class="empty">이력 없음</p>'}</div>`;
}

VIEWS.tasks = viewTasks;
VIEWS.history = viewHistory;

Object.assign(CHANGES, {
  'task-filter': el => { ui.taskFilter = el.value; route(); },
  'task-field': el => updateTask(el.dataset.id, el.dataset.field, el.value),
});
