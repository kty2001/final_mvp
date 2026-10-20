// 보안 운영: 위협 현황(대시보드)·위협 분석 목록·평가 상세 — 필요할 때 여는 분석 화면 (기획안_v3 6-7)

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

// ---------- 위협 현황 ----------
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
    <h2>위협 현황</h2>
    <p class="sub">${esc(state.name)} (${esc(state.industry)}) · 등록 자산 ${state.assets.length}건 기준 · 전체 위험 분포·추이</p>
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
        <h3>취약점 피드</h3>
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
    ${krPanel()}`;
}

// 국산 SW·한국어 공지 구조화 (기획안_v3 5-5 ②): 추출 → 원문 인용 검증·지시성 문장 검사 → 승인 시 위협 정보 추가
function krPanel() {
  const ad = ui.krPreview && KR_ADVISORIES.find(x => x.id === ui.krPreview);
  return `<details class="card" ${keep('kr')}>
    <summary><b>국내 공지 구조화</b> <span class="muted">CVE가 없는 국산 SW 공지에서 제품·버전·조치 추출 — 추가는 승인 후 (목업: 추출은 LLM 대체 데이터)</span></summary>
    <ul class="plain">${KR_ADVISORIES.map(x => `<li><b>${esc(x.product)}</b> <span class="muted">${esc(x.source)} · ${x.published}</span>
      ${store.krIngested.includes(x.id) ? badge('위협 정보 추가됨', 'p-done') : `<button class="small ghost" data-action="kr-extract" data-id="${x.id}">에이전트 추출</button>`}</li>`).join('')}</ul>
    ${ad ? krPreviewHtml(ad) : ''}
  </details>`;
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

// ---------- 위협 분석 목록 ----------
function viewAnalysis() {
  const list = allAssessments();
  const f = ui.analysisFilter;
  const filtered = f === 'all' ? list : list.filter(a => a.status === f);
  const opt = (v, l) => `<option value="${v}" ${f === v ? 'selected' : ''}>${l} (${v === 'all' ? list.length : list.filter(a => a.status === v).length})</option>`;
  return `
    <h2>위협 분석</h2>
    <p class="sub">제품 일치 자산만 평가 · 버전 범위 밖·오탐은 '영향 없음'으로 분리 · 행을 누르면 근거 상세</p>
    <div class="card">
      <div class="toolbar"><select data-change="analysis-filter">${opt('active', '대응 필요')}${opt('resolved', '조치 완료')}${opt('excluded', '영향 없음·오탐')}${opt('all', '전체')}</select></div>
      ${assessmentTable(filtered)}
    </div>`;
}

// ---------- 평가 상세 ----------
function viewDetail(key) {
  const a = allAssessments().find(x => x.key === key);
  if (!a) return '<div class="card">평가 항목을 찾을 수 없음 (자산 삭제 또는 제품 변경)</div>';
  const v = a.vuln;
  const sys = a.system ? { ...a, label: a.system.label, status: a.system.status } : a;
  const tasks = state.tasks.filter(t => t.key === key);
  const allDone = tasks.length && tasks.every(t => t.status === '완료');
  const canPatch = allDone && a.asset.patch !== '적용 완료';
  const hist = state.history.filter(h => h.key === key);
  const lines = explain(sys);
  const box = (cls, title, items) => `<div class="card ${cls}"><h3>${title}</h3>${items.length ? `<ul class="plain">${items.join('')}</ul>` : '<p class="empty">없음</p>'}</div>`;
  return `
    <p><a href="#analysis">← 위협 분석</a></p>
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
        <h3>위험도 산정 근거 (규칙 엔진)</h3>
        <div class="table-wrap"><table>
          <tr><th>요소</th><th>값</th><th>점수</th><th>출처</th></tr>
          ${a.factors.map(f => `<tr><td>${f.name}</td><td>${esc(f.value)}</td><td class="num">+${f.points}</td><td class="muted">${f.ref}</td></tr>`).join('')}
          <tr><td colspan="2"><b>합계</b></td><td class="num"><b>${a.score}</b></td><td></td></tr>
        </table></div>
        <p class="muted">85점 이상 긴급 · 65점 이상 높음 · 40점 이상 보통 · 그 외 낮음. 버전 미확인 시 '잠재적' 판정</p>
      </div>
      <div class="card explain">
        <h3>에이전트 설명</h3>
        ${lines.map(l => `<p><span class="t t-${l.tag}">${l.tag}</span>${esc(l.text)}</p>`).join('')}
        ${citationNote(verifyCitations(lines.map(l => l.text), [a]))}
        <p class="muted">근거 자료와 규칙 평가 결과로만 작성(목업 템플릿) — LLM은 위험도를 정하지 않음</p>
      </div>
    </div>
    <div class="grid two">
      ${box('box-fact', '확인된 사실', a.facts.map(f => `<li>${esc(f.fact)}<span class="chip">${esc(f.ref)}</span></li>`))}
      ${box('box-cond', '기업별 적용 조건', a.conditions.map(c => `<li>${esc(c)}</li>`))}
      ${box('box-infer', '추론', a.inferences.map(c => `<li>${esc(c)}</li>`))}
      ${box('box-unc', '불확실성·추가 확인', [...a.uncertainties, ...a.checks.map(c => `확인: ${c}`)].map(c => `<li>${esc(c)}</li>`))}
    </div>
    <div class="card">
      <h3>근거 자료</h3>
      <div class="table-wrap"><table>
        <tr><th>출처</th><th>확인 내용</th><th>수집 시각</th></tr>
        ${a.facts.map(f => `<tr><td><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a></td><td>${esc(f.fact)}</td><td class="muted">${f.collectedAt}</td></tr>`).join('')}
      </table></div>
      ${a.advisory ? `<h3>공급업체 권고문 원문 (외부 텍스트)</h3>
        <blockquote class="advisory">${a.advisory.text.split(/(?<=\.)\s+/).map(s => (a.advisory.flagged.includes(s) ? `<mark>${esc(s)}</mark>` : esc(s))).join(' ')}</blockquote>
        ${a.advisory.flagged.length ? `<p class="error">지시성 문장 ${a.advisory.flagged.length}건 감지 — 실행하지 않음</p>` : ''}
        <p class="muted">외부 문서는 데이터로만 취급 — 문서 안의 지시는 따르지 않으며 판정·조치에 반영하지 않음</p>` : ''}
    </div>
    <div class="card">
      <div class="toolbar"><h3 style="margin:0">조치 업무</h3>
        ${a.status === 'active' ? `<button class="small" data-action="create-tasks" data-id="${esc(key)}">조치 업무 생성</button>` : ''}
        ${canPatch && ui.evidenceDraft?.assetId !== a.asset.id ? `<button class="small" data-action="evidence-open" data-id="${a.asset.id}">패치 적용 완료로 반영</button>` : ''}
      </div>
      ${canPatch && ui.evidenceDraft?.assetId === a.asset.id ? evidenceForm(a.asset) : ''}
      ${tasks.length ? taskTable(tasks, false) : '<p class="empty">생성된 업무 없음</p>'}
      <p class="muted">시스템 변경·패치는 자동 실행하지 않음 — 담당자 검토·승인 후 수행</p>
    </div>
    <details class="card" ${keep('tools')}>
      <summary><b>추가 확인 도구</b> <span class="muted">What-if · 담당자 판단 수정 · 영향 조건 확인 · 외주 업체 요청</span></summary>
      <div class="grid two">${whatIfCard(a)}${overrideCard(a)}${conditionCard(a)}${vendorCard(a)}</div>
    </details>
    <div class="card">
      <h3>판단 갱신 이력</h3>
      ${hist.length ? `<ul class="timeline">${hist.map(historyItem).join('')}</ul>` : '<p class="empty">변경 이력 없음 (최초 평가 이후 변경 없음)</p>'}
    </div>`;
}

// What-if: 자산 정보를 가정으로 바꿔 판정 변화를 미리 확인 (저장하지 않음)
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
  const sel = (f, opts) => `<select data-whatif="${f}" data-change="whatif">${opts.map(o => `<option ${o === as[f] ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  return `<div class="card">
    <h3>What-if</h3>
    <div class="whatif">
      <label>버전<input data-whatif="version" data-change="whatif" value="${esc(as.version)}" placeholder="미등록"></label>
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
    : `<p class="muted">현장 판단이 다르면 사유와 함께 조정 — 원래 판정과 조정 이력 모두 보존</p>
      <div class="inline-form">
        <select id="ovPriority">${['긴급', '높음', '보통', '낮음', '오탐'].map(p => `<option value="${p}" ${p === a.priority ? 'selected' : ''}>${p === '오탐' ? '오탐(영향 없음)' : p}</option>`).join('')}</select>
        <input id="ovReason" placeholder="사유 (필수) 예: WAF로 해당 경로 차단 중">
        <button class="small" data-action="save-override" data-id="${esc(a.key)}">조정 저장</button>
      </div>
      ${ui.overrideError ? `<p class="error">${esc(ui.overrideError)}</p>` : ''}`}
  </div>`;
}

// 영향 조건 확인 (기획안_v3 5-5 ③): 읽기 전용 명령 출력 해석 → 미충족이면 승인 후 영향 없음(담당자 조정)으로 반영
const VERDICT_CLS = { 충족: 'p-urgent', 미충족: 'p-done', '판단 불가': 'p-none' };

function conditionCard(a) {
  const spec = CONDITION_CHECKS[a.vuln.id];
  if (!spec) return '';
  const rec = state.conditionChecks[a.key];
  const d = ui.condDraft[a.key] || {};
  const k = esc(a.key);
  return `<div class="card">
    <h3>영향 조건 확인</h3>
    <blockquote class="advisory">권고문 조건: ${esc(spec.condition)}</blockquote>
    <p>${esc(spec.plain)}</p>
    <p class="muted">확인 명령 — 읽기 전용, 시스템을 바꾸지 않음 (목업: 출력 해석은 LLM 대체 규칙)</p>
    ${spec.commands.map(c => `<code class="cmd">${esc(c)}</code>`).join('')}
    ${rec ? `<p>최근 확인 ${rec.at}: ${badge(`조건 ${rec.verdict}`, VERDICT_CLS[rec.verdict])} ${esc(rec.reason)}</p>` : ''}
    <textarea data-cond-output="${k}" rows="3" placeholder="명령 출력 붙여넣기">${esc(d.output || '')}</textarea>
    <div class="toolbar"><button class="small ghost" data-action="cond-sample" data-id="${k}" data-sample="met">예시: 조건 충족</button>
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
  const d = ui.condDraft[key];
  if (!a || !d?.result) return;
  const { verdict, reason } = d.result;
  state.conditionChecks[key] = { verdict, reason, at: nowText(), target: `${a.asset.name} × ${a.vuln.id}`, output: d.output.slice(0, 300) };
  addHistory('조건 확인', `${a.asset.name} × ${a.vuln.id}: 영향 조건 ${verdict} — ${reason}`, key);
  if (verdict === '미충족') {
    state.overrides[key] = { priority: '오탐', reason: `영향 조건 미충족 — ${reason}`, at: nowText(), basisLabel: a.label };
    addHistory('판단 수정', `${a.asset.name} × ${a.vuln.id}: ${a.label} → 영향 없음 (영향 조건 미충족, 확인 출력 보관)`, key);
  }
  delete ui.condDraft[key];
  reassess(`영향 조건 확인: ${reason}`);
}

// 외주 업체 요청 (기획안_v3 5-5 ④): 메일 초안 → 승인 후 발송(목업) → 회신 해석 → 승인 후 업무 일정 반영
function vendorCard(a) {
  if (a.status !== 'active') return '';
  const sent = state.vendorRequests[a.key];
  const d = ui.vendorDraft[a.key] || {};
  const k = esc(a.key);
  const draft = vendorRequestDraft(a, addDays(today(), DUE_DAYS[a.priority] || 7));
  return `<div class="card">
    <h3>외주 업체 요청</h3>
    <p class="muted">책임 주체: ${esc(a.asset.maintainer || '자사 (미등록)')} — 발송·일정 반영은 승인 후 (목업: 실제 발송 없음)</p>
    ${sent ? `<p>✔ ${sent.at} 발송(목업) — 수신 ${esc(sent.to)}${sent.schedule ? ` · 작업 예정 ${esc(sent.schedule)}` : ''}</p>`
      : `<blockquote class="advisory"><b>${esc(draft.subject)}</b><br>${draft.body.map(esc).join('<br>')}</blockquote>
        <button class="small" data-action="vendor-send" data-id="${k}">승인 — 발송 (목업)</button>`}
    ${sent && !sent.schedule ? `<textarea data-vendor-reply="${k}" rows="2" placeholder="업체 회신 붙여넣기">${esc(d.reply || '')}</textarea>
      <div class="toolbar"><button class="small ghost" data-action="vendor-sample" data-id="${k}">예시 회신</button>
        <button class="small" data-action="vendor-parse" data-id="${k}">회신 해석</button></div>
      ${d.parsed ? `<div class="table-wrap"><table><tr><th>작업 일자</th><th>시각</th><th>작업자</th><th>근거 문장</th></tr>
        <tr><td>${esc(d.parsed.date || '찾지 못함')}</td><td>${esc(d.parsed.time || '-')}</td><td>${esc(d.parsed.worker || '-')}</td><td class="muted">${esc(d.parsed.quote || '-')}</td></tr></table></div>
        ${d.parsed.date ? `<button class="small" data-action="vendor-apply" data-id="${k}">승인 — 업무 일정 반영</button>` : '<p class="muted">일정을 찾지 못함 — 조치 업무 기록에서 직접 입력</p>'}` : ''}` : ''}
  </div>`;
}

function applyVendorReply(key) {
  const a = allAssessments().find(x => x.key === key);
  const p = ui.vendorDraft[key]?.parsed;
  if (!a || !p?.date) return;
  if (!state.tasks.some(t => t.key === key)) createTasks(key);
  const schedule = `${p.date}${p.time ? ` ${p.time}` : ''}`;
  const owner = `외주: ${p.worker || vendorName(a.asset)}`;
  state.tasks.filter(t => t.key === key && t.title.startsWith('패치 가능 여부')).forEach(t => { t.due = schedule; t.owner = owner; t.status = t.status === '완료' ? t.status : '진행'; });
  state.vendorRequests[key].schedule = schedule;
  addHistory('외주 요청', `${a.asset.name} × ${a.vuln.id}: 업체 회신 반영 — 작업 예정 ${schedule}, ${owner}`, key);
  delete ui.vendorDraft[key];
  save();
}

VIEWS.dashboard = viewDashboard;
VIEWS.analysis = p => (p ? viewDetail(p) : viewAnalysis());

Object.assign(ACTIONS, {
  'save-override': id => {
    const a = allAssessments().find(x => x.key === id);
    const priority = document.getElementById('ovPriority').value;
    const reason = document.getElementById('ovReason').value.trim();
    if (!a) return;
    if (!reason) { ui.overrideError = '조정 사유 입력 필요'; route(); return; }
    state.overrides[id] = { priority, reason, at: nowText(), basisLabel: a.label };
    addHistory('판단 수정', `${a.asset.name} × ${a.vuln.id}: ${a.label} → ${priority} (사유: ${reason})`, id);
    ui.overrideError = '';
    reassess(`담당자 판단 수정: ${reason}`); route();
  },
  'clear-override': id => {
    delete state.overrides[id];
    addHistory('판단 수정', '담당자 조정 해제 — 시스템 판정으로 복귀', id);
    reassess('담당자 조정 해제'); route();
  },
  'whatif-apply': id => {
    const a = state.assets.find(x => x.id === id.split('|')[0]);
    const vals = whatIfValues();
    const changes = Object.entries(vals).filter(([k, v]) => v !== (a[k] || '')).map(([k, v]) => `${k}=${v || '미등록'}`);
    Object.assign(a, vals);
    addHistory('자산 변경', `${a.name}: What-if 가정 반영 (${changes.join(', ')})`, id);
    reassess('What-if 가정을 자산 정보로 반영'); route();
  },
  'cond-sample': (id, el) => { ui.condDraft[id] = { output: CONDITION_CHECKS[id.split('|')[1]].samples[el.dataset.sample] }; route(); },
  'cond-run': id => {
    const output = [...document.querySelectorAll('[data-cond-output]')].find(x => x.dataset.condOutput === id).value;
    ui.condDraft[id] = { output, result: interpretCheck(CONDITION_CHECKS[id.split('|')[1]], output) };
    route();
  },
  'cond-apply': id => { applyCondition(id); route(); },
  'vendor-send': id => {
    const a = allAssessments().find(x => x.key === id);
    const draft = vendorRequestDraft(a, addDays(today(), DUE_DAYS[a.priority] || 7));
    state.vendorRequests[id] = { at: nowText(), to: draft.to, subject: draft.subject };
    addHistory('외주 요청', `${a.asset.name} × ${a.vuln.id}: ${draft.to}에 패치 작업 요청 발송(목업)`, id);
    save(); route();
  },
  'vendor-sample': id => { ui.vendorDraft[id] = { reply: VENDOR_REPLY_SAMPLE }; route(); },
  'vendor-parse': id => {
    const reply = [...document.querySelectorAll('[data-vendor-reply]')].find(x => x.dataset.vendorReply === id).value;
    ui.vendorDraft[id] = { reply, parsed: parseVendorReply(reply, today()) };
    route();
  },
  'vendor-apply': id => { applyVendorReply(id); route(); },
  'kr-extract': id => { ui.krPreview = id; route(); },
  'kr-clear': () => { ui.krPreview = null; route(); },
  'kr-apply': id => { ingestKr(id); ui.krPreview = null; route(); },
});

Object.assign(CHANGES, {
  'analysis-filter': el => { ui.analysisFilter = el.value; route(); },
  whatif: () => {
    const box = document.getElementById('whatifResult');
    if (box) box.innerHTML = whatIfResult(box.dataset.key, whatIfValues());
  },
});
