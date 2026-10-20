// 에이전트 대화 (기획안_v3 1-4·6-3): 자연어 질의 → 도구 호출 → 근거·차트와 함께 답변, 상태 변경은 승인 후

function citationNote(c) {
  if (!c) return '';
  return `<div class="muted">인용 검증 ${c.ok}/${c.total} 출처 확인${c.missing.length ? ` · <span class="error">근거 없는 인용: ${c.missing.map(esc).join(', ')}</span>` : ''}</div>`;
}

// 에이전트 메시지 (할 일 홈의 브리핑 카드에서도 사용)
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
    <h2>에이전트 대화</h2>
    <p class="sub">${esc(state.name)} 데이터 기준 · 질의 해석 → 평가·통계 도구 호출 → 근거와 함께 답변 (목업 에이전트, 실제 LLM 미연동)</p>
    <div class="card">
      <div class="chat-log" id="chatLog">${ui.chatLog.length ? ui.chatLog.map((m, i) => renderMsg(m, i, byKey)).join('') : '<p class="empty">아래 예시 질문을 누르거나 직접 입력</p>'}</div>
      <div class="examples">${AGENT_EXAMPLES.map(q => `<button class="small ghost" data-action="chat-example" data-id="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form id="chatForm" class="chat-form"><input name="q" placeholder="예: FortiOS 관련 위협 왜 긴급이야?" autocomplete="off"><button type="submit">질의</button></form>
    </div>`;
}

function sendChat(text) {
  text = text.trim();
  if (!text) return;
  const { items, ...rest } = agentRespond(text);
  ui.chatLog.push({ role: 'user', text }, { role: 'agent', ...rest, itemKeys: items.map(a => a.key) });
  route();
}

VIEWS.chat = viewChat;

Object.assign(ACTIONS, {
  'chat-example': id => sendChat(id),
  'agent-approve': id => {
    const m = ui.chatLog[Number(id)];
    if (!m || m.done) return;
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
  },
});

FORMS.chatForm = (data, form) => sendChat(form.q.value);
