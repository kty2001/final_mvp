// 화면 렌더링·상태 관리 (브라우저 localStorage 저장)

const STORE_KEY = 'cti-mvp-v1';
const clone = o => JSON.parse(JSON.stringify(o));
const $view = document.getElementById('view');
const PRODUCTS = [...new Set(VULNS.map(v => v.product))];
const STATUS_ORDER = { active: 0, resolved: 1, excluded: 2 };

let state;
let analysisFilter = 'active';
let taskFilter = 'open';
let editingAssetId = null;
let chatLog = [];

const pad = n => String(n).padStart(2, '0');
function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function nowText() { const d = new Date(); return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const badge = (label, cls) => `<span class="badge ${cls}">${esc(label)}</span>`;
const detailLink = key => `#analysis/${encodeURIComponent(key)}`;

// ---------- 상태 ----------
function seedState() {
  return { assets: clone(SEED_ASSETS), vulns: clone(VULNS), tasks: [], history: [], feed: clone(SEED_FEED), snapshot: {}, simStep: 0, seq: 100 };
}
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return JSON.parse(raw); } catch (e) { /* 저장소 사용 불가 시 초기 데이터 사용 */ }
  return null;
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
}
function addHistory(type, text, key) {
  state.history.unshift({ time: nowText(), type, text, key: key || null });
}

function allAssessments() {
  const list = [];
  state.assets.forEach(a => state.vulns.forEach(v => { const r = assess(a, v); if (r) list.push(r); }));
  return list.sort((x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status] || y.score - x.score);
}

// 재평가 후 이전 판단과 비교해 변경 이력 기록
function reassess(reason, initial = false) {
  const list = allAssessments();
  const next = {};
  const fresh = [];
  list.forEach(a => {
    const prev = state.snapshot[a.key];
    const cur = { score: a.status === 'active' ? a.score : null, label: a.label, at: nowText() };
    if (!prev) fresh.push(a);
    else if (prev.score !== cur.score || prev.label !== cur.label) {
      const fmt = s => `${s.label}${s.score != null ? `(${s.score}점)` : ''}`;
      addHistory('판단 갱신', `${a.asset.name} × ${a.vuln.id}: ${fmt(prev)} → ${fmt(cur)} — ${reason}`, a.key);
    } else cur.at = prev.at;
    next[a.key] = cur;
  });
  if (initial) addHistory('최초 평가', `자산 ${state.assets.length}건 × 취약점 ${state.vulns.length}건 매칭 → 평가 ${fresh.length}건 생성`);
  else fresh.forEach(a => addHistory('신규 평가', `${a.asset.name} × ${a.vuln.id}: ${a.label}${a.status === 'active' ? `(${a.score}점)` : ''} — ${reason}`, a.key));
  state.snapshot = next;
  save();
}

// ---------- 화면: 대시보드 ----------
function viewDashboard() {
  const list = allAssessments();
  const active = list.filter(a => a.status === 'active');
  const kpis = [
    ['자산 연관 위협', active.length, '대응 필요 평가 건'],
    ['실제 악용(KEV) 연관', active.filter(a => a.vuln.kev).length, 'CISA KEV 등재 취약점'],
    ['긴급·높음', active.filter(a => a.score >= 65).length, '우선 확인 대상 (65점 이상)'],
    ['미완료 조치', state.tasks.filter(t => t.status !== '완료').length, '대기·진행 중 업무'],
  ];
  const vulns = [...state.vulns].sort((a, b) => b.published.localeCompare(a.published));
  return `
    <h2>위협 인텔리전스 대시보드</h2>
    <p class="sub">등록 자산 ${state.assets.length}건 기준 · 위험도 높은 항목부터 확인</p>
    <div class="grid kpi">${kpis.map(([l, n, h]) => `<div class="card"><div class="label">${l}</div><div class="num">${n}</div><div class="hint">${h}</div></div>`).join('')}</div>
    <div class="card">
      <h3>대응 우선순위</h3>
      ${assessmentTable(active)}
      <p class="muted">조치 완료 ${list.filter(a => a.status === 'resolved').length}건 · 영향 없음(버전 범위 밖) ${list.filter(a => a.status === 'excluded').length}건은 <a href="#analysis">위협 분석</a>에서 확인</p>
    </div>
    <div class="grid two">
      <div class="card">
        <h3>최근 취약점 피드</h3>
        <div class="table-wrap"><table>
          <tr><th>CVE</th><th>제품</th><th>CVSS</th><th>EPSS</th><th>악용</th><th>관련 자산</th></tr>
          ${vulns.map(v => {
            const n = list.filter(a => a.vuln.id === v.id && a.status !== 'excluded').length;
            return `<tr><td>${v.id}<div class="muted">${esc(v.title)}</div></td><td>${esc(v.product)}</td><td class="num">${v.cvss.toFixed(1)}</td><td class="num">${v.epss.toFixed(2)}</td><td>${v.kev ? badge('KEV', 'kev') : '-'}</td><td class="num">${n || '<span class="muted">없음</span>'}</td></tr>`;
          }).join('')}
        </table></div>
      </div>
      <div class="card">
        <h3>위협 정보 변경 내역</h3>
        <ul class="timeline">${state.feed.map(f => `<li><span class="time">${f.time}</span><span>${esc(f.text)}</span></li>`).join('')}</ul>
      </div>
    </div>`;
}

function assessmentTable(list) {
  if (!list.length) return '<p class="empty">해당 항목 없음</p>';
  return `<div class="table-wrap"><table>
    <tr><th>판단</th><th>자산</th><th>취약점</th><th>매칭</th><th>점수</th><th>신뢰도</th></tr>
    ${list.map(a => `<tr class="click" data-action="open" data-id="${esc(a.key)}">
      <td>${badge(a.label, a.cls)}</td>
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

function viewAssets() {
  const list = allAssessments();
  const e = state.assets.find(a => a.id === editingAssetId) || { criticality: '중', exposure: '미확인', patch: '미적용', type: '서버' };
  return `
    <h2>자산 관리</h2>
    <p class="sub">제품명·버전·중요도·외부 노출 여부를 직접 등록 — 저장 시 전체 위협 재평가</p>
    <div class="card">
      <h3>${editingAssetId ? '자산 수정' : '자산 등록'}</h3>
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
        <div class="form-actions">
          <button type="submit">${editingAssetId ? '수정 저장' : '등록'}</button>
          ${editingAssetId ? '<button type="button" class="ghost" data-action="cancel-edit">취소</button>' : ''}
        </div>
        <datalist id="productList">${PRODUCTS.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      </form>
    </div>
    <div class="card">
      <h3>등록 자산 (${state.assets.length})</h3>
      <div class="table-wrap"><table>
        <tr><th>자산명</th><th>제품 / 버전</th><th>유형</th><th>중요도</th><th>외부 노출</th><th>패치</th><th>담당자</th><th>대응 필요</th><th></th></tr>
        ${state.assets.map(a => `<tr>
          <td>${esc(a.name)}<div class="muted">${esc(a.purpose)}</div></td>
          <td>${esc(a.product)} ${a.version ? esc(a.version) : '<span class="muted">버전 미등록</span>'}</td>
          <td>${esc(a.type)}</td><td>${esc(a.criticality)}</td><td>${esc(a.exposure)}</td><td>${esc(a.patch)}</td><td>${esc(a.owner)}</td>
          <td class="num">${list.filter(x => x.asset.id === a.id && x.status === 'active').length}</td>
          <td style="white-space:nowrap"><button class="small ghost" data-action="edit-asset" data-id="${a.id}">수정</button>
            <button class="small danger" data-action="delete-asset" data-id="${a.id}">삭제</button></td>
        </tr>`).join('')}
      </table></div>
    </div>`;
}

function saveAsset(form) {
  const data = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v).trim()]));
  let asset = state.assets.find(a => a.id === editingAssetId);
  if (asset) {
    Object.assign(asset, data);
    addHistory('자산 변경', `자산 수정: ${asset.name}`);
  } else {
    asset = { id: `A${++state.seq}`, ...data };
    state.assets.push(asset);
    addHistory('자산 변경', `자산 등록: ${asset.name} (${asset.product} ${asset.version || '버전 미등록'})`);
  }
  editingAssetId = null;
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
    <p class="sub">제품 일치 자산만 평가 · 버전 범위 밖은 '영향 없음'으로 분리</p>
    <div class="card">
      <div class="toolbar"><select id="analysisFilter">${opt('active', '대응 필요')}${opt('resolved', '조치 완료')}${opt('excluded', '영향 없음')}${opt('all', '전체')}</select></div>
      ${assessmentTable(filtered)}
    </div>`;
}

function viewDetail(key) {
  const a = allAssessments().find(x => x.key === key);
  if (!a) return '<div class="card">평가 항목을 찾을 수 없음 (자산 삭제 또는 제품 변경)</div>';
  const v = a.vuln;
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
        <span>위험 점수 <b>${a.status === 'active' ? `${a.score} / 100` : '-'}</b></span>
        <span>판단 신뢰도 <b>${a.status === 'excluded' ? '-' : a.confidence}</b></span>
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
        ${explain(a).map(l => `<p><span class="t t-${l.tag}">${l.tag}</span>${esc(l.text)}</p>`).join('')}
        <p class="muted">근거 자료와 규칙 평가 결과만으로 생성한 설명(목업 템플릿). LLM은 위험도를 결정하지 않음</p>
      </div>
    </div>
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
    <div class="card">
      <div class="toolbar"><h3 style="margin:0">조치 업무</h3>
        ${a.status === 'active' ? `<button class="small" data-action="create-tasks" data-id="${esc(key)}">조치 업무 생성</button>` : ''}
        ${allDone && a.asset.patch !== '적용 완료' ? `<button class="small" data-action="mark-patched" data-id="${a.asset.id}">자산 패치 상태 '적용 완료'로 갱신</button>` : ''}
      </div>
      ${tasks.length ? taskTable(tasks, false) : '<p class="empty">생성된 업무 없음</p>'}
      <p class="muted">시스템 변경·패치는 자동 실행하지 않음 — 담당자 검토·승인 후 수행</p>
    </div>
    <div class="card">
      <h3>판단 갱신 이력</h3>
      ${hist.length ? `<ul class="timeline">${hist.map(historyItem).join('')}</ul>` : '<p class="empty">변경 이력 없음 (최초 평가 이후 변경 없음)</p>'}
    </div>`;
}

function createTasks(key) {
  const a = allAssessments().find(x => x.key === key);
  if (!a) return 0;
  const existing = new Set(state.tasks.filter(t => t.key === key).map(t => t.title));
  const created = taskTemplates(a).filter(t => !existing.has(t.title)).map(t => ({
    id: `T${++state.seq}`, key, assetName: a.asset.name, cveId: a.vuln.id,
    priority: a.priority, priorityCls: a.priorityCls, ...t,
    status: '대기', owner: a.asset.owner || '', checkedAt: '',
  }));
  state.tasks.push(...created);
  addHistory('조치 업무', `${a.asset.name} × ${a.vuln.id}: 조치 업무 ${created.length}건 생성`, key);
  save();
  route();
  return created.length;
}

// ---------- 화면: 대화형 분석 ----------
function renderMsg(m, i, byKey) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
  const items = m.itemKeys.map(k => byKey[k]).filter(Boolean);
  return `<div class="msg agent">
    ${m.text.map(t => `<p>${esc(t)}</p>`).join('')}
    ${items.length ? `<ul class="items">${items.map(a => `<li>${badge(a.label, a.cls)} <a href="${detailLink(a.key)}">${esc(a.asset.name)} × ${a.vuln.id}</a> <span class="muted">${a.status === 'active' ? `${a.score}점 · 신뢰도 ${a.confidence}` : ''}</span></li>`).join('')}</ul>` : ''}
    ${m.refs.length ? `<div class="muted">근거 출처 ${m.refs.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</div>` : ''}
    ${m.link ? `<p><a href="${m.link.href}">${esc(m.link.label)} →</a></p>` : ''}
    ${m.action ? (m.done ? `<p class="muted">✔ ${esc(m.doneText)}</p>` : `<button class="small" data-action="agent-approve" data-id="${i}">${esc(m.action.label)}</button>`) : ''}
    <details class="tools"><summary>도구 호출 ${m.tools.length}건</summary><ol>${m.tools.map(t => `<li><code>${esc(t.name)}(${esc(t.args)})</code> → ${esc(t.result)}</li>`).join('')}</ol></details>
  </div>`;
}

function viewChat() {
  const byKey = Object.fromEntries(allAssessments().map(a => [a.key, a]));
  return `
    <h2>대화형 분석</h2>
    <p class="sub">자연어 질의 → 에이전트가 평가 도구를 호출해 근거와 함께 답변 (목업 에이전트, 실제 LLM 미연동)</p>
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
    ${s.table ? `<div class="table-wrap"><table><tr>${s.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${s.table.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>` : ''}`;
}

function viewReport(type) {
  if (!REPORT_TYPES[type]) type = 'exec';
  const r = buildReport(type);
  return `
    <h2>자동 리포트</h2>
    <p class="sub">현재 평가·조치 데이터로 즉시 생성 — 주간 정기 생성·이메일 발송은 후속 단계</p>
    <div class="toolbar no-print">
      ${Object.entries(REPORT_TYPES).map(([k, l]) => `<a class="tab ${k === type ? 'active' : ''}" href="#report/${k}">${l}</a>`).join('')}
      <button class="small" data-action="report-print">인쇄·PDF 저장</button>
      <button class="small ghost" data-action="report-md" data-id="${type}">Markdown 다운로드</button>
    </div>
    <div class="card report">
      <h2>${esc(r.title)}</h2>
      <p class="muted">생성 일시 ${r.generatedAt} · ${esc(r.scope)} · 시연용 가상 데이터</p>
      ${r.sections.map(renderSection).join('')}
    </div>`;
}

function downloadMarkdown(type) {
  const r = buildReport(type);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([reportToMarkdown(r)], { type: 'text/markdown' }));
  link.download = `${r.title}_${today()}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------- 화면: 조치 업무 ----------
function taskTable(tasks, showTarget) {
  return `<div class="table-wrap"><table>
    <tr><th>우선순위</th><th>업무</th>${showTarget ? '<th>대상</th>' : ''}<th>권장 이유</th><th>근거</th><th>담당자</th><th>상태</th><th>확인 일자</th></tr>
    ${tasks.map(t => `<tr>
      <td>${badge(t.priority, t.priorityCls)}</td>
      <td>${esc(t.title)}</td>
      ${showTarget ? `<td><a href="${detailLink(t.key)}">${esc(t.assetName)}<br><span class="muted">${t.cveId}</span></a></td>` : ''}
      <td class="muted">${esc(t.reason)}</td>
      <td>${t.refs.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</td>
      <td><input data-task-id="${t.id}" data-task-field="owner" value="${esc(t.owner)}" size="8"></td>
      <td><select data-task-id="${t.id}" data-task-field="status">${['대기', '진행', '완료'].map(s => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
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
    <p class="sub">위협 분석 상세 화면에서 생성한 조치 항목 · 상태·담당자·확인 일자 기록</p>
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
    <p class="sub">판단 변경, 위협 정보 갱신, 자산 변경, 조치 기록</p>
    <div class="card">${state.history.length ? `<ul class="timeline">${state.history.map(historyItem).join('')}</ul>` : '<p class="empty">이력 없음</p>'}</div>`;
}

// ---------- 시뮬레이션 ----------
function runSimulation() {
  const u = SIM_UPDATES[state.simStep];
  if (!u) return;
  const v = state.vulns.find(x => x.id === u.cveId);
  Object.assign(v, u.changes, { updatedAt: today() });
  state.simStep++;
  state.feed.unshift({ time: nowText(), text: `${v.id} (${v.product}) — ${u.text}` });
  addHistory('위협 정보 갱신', `${v.id} (${v.product}): ${u.text}`);
  reassess(`위협 정보 갱신: ${u.text}`);
  route();
}

// ---------- 라우팅·이벤트 ----------
function route() {
  const [view, param] = (location.hash.slice(1) || 'dashboard').split('/');
  const views = {
    dashboard: viewDashboard, chat: viewChat, assets: viewAssets, analysis: p => (p ? viewDetail(p) : viewAnalysis()),
    tasks: viewTasks, report: viewReport, history: viewHistory,
  };
  $view.innerHTML = (views[view] || viewDashboard)(param && decodeURIComponent(param));
  if (view === 'chat') {
    const log = document.getElementById('chatLog');
    log.scrollTop = log.scrollHeight;
    document.querySelector('#chatForm input').focus();
  }
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (views[view] ? view : 'dashboard')));
  const left = SIM_UPDATES.length - state.simStep;
  const btn = document.getElementById('simBtn');
  btn.textContent = left ? `위협 정보 갱신 시뮬레이션 (${left})` : '시뮬레이션 완료';
  btn.disabled = !left;
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'open': location.hash = detailLink(id); break;
    case 'simulate': runSimulation(); break;
    case 'reset':
      try { localStorage.removeItem(STORE_KEY); } catch (err) { /* 무시 */ }
      state = seedState(); editingAssetId = null; chatLog = [];
      reassess('', true);
      location.hash = '#dashboard'; route();
      break;
    case 'edit-asset': editingAssetId = id; route(); window.scrollTo(0, 0); break;
    case 'cancel-edit': editingAssetId = null; route(); break;
    case 'delete-asset': {
      const a = state.assets.find(x => x.id === id);
      state.assets = state.assets.filter(x => x.id !== id);
      state.tasks = state.tasks.filter(t => !t.key.startsWith(`${id}|`));
      if (editingAssetId === id) editingAssetId = null;
      addHistory('자산 변경', `자산 삭제: ${a.name}`);
      reassess(`자산 삭제: ${a.name}`); route();
      break;
    }
    case 'create-tasks': createTasks(id); break;
    case 'chat-example': sendChat(id); break;
    case 'agent-approve': {
      const m = chatLog[Number(id)];
      if (!m || m.done) break;
      const n = createTasks(m.action.key);
      m.done = true;
      m.doneText = `승인됨 — 조치 업무 ${n}건 생성 (중복 제외)`;
      route();
      break;
    }
    case 'report-print': window.print(); break;
    case 'report-md': downloadMarkdown(id); break;
    case 'mark-patched': {
      const a = state.assets.find(x => x.id === id);
      a.patch = '적용 완료';
      addHistory('자산 변경', `${a.name}: 조치 결과 반영 — 패치 상태 '적용 완료'`);
      reassess('조치 결과 반영: 패치 적용 완료'); route();
      break;
    }
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'analysisFilter') { analysisFilter = el.value; route(); }
  else if (el.id === 'taskFilter') { taskFilter = el.value; route(); }
  else if (el.dataset.taskField) updateTask(el.dataset.taskId, el.dataset.taskField, el.value);
});

document.addEventListener('submit', e => {
  if (e.target.id === 'assetForm') { e.preventDefault(); saveAsset(new FormData(e.target)); }
  else if (e.target.id === 'chatForm') { e.preventDefault(); sendChat(e.target.q.value); }
});

window.addEventListener('hashchange', route);

state = load() || seedState();
if (!Object.keys(state.snapshot).length) reassess('', true);
route();
