// 설정: 자산·연결 소스 — 자동 탐색 / 외부 점검 결과 가져오기 / 직접 등록, 반영은 모두 승인 후. 하단에 보안 대상 자산·오류 대상 구성요소

const ASSET_TABS = [['discover', '자동 탐색'], ['scan', '점검 결과 가져오기'], ['manual', '직접 등록']];
const KIND_CLS = { 신규: 'p-high', 보완: 'p-medium', 변경: 'p-urgent', 확인: 'p-done' };

function intakeTable(parsed) {
  return `<div class="table-wrap"><table>
    <tr><th>자산명</th><th>제품</th><th>버전</th><th>유형</th><th>중요도</th><th>외부 노출</th><th>패치</th><th>확인 필요</th></tr>
    ${parsed.map(p => `<tr><td>${esc(p.asset.name)}</td><td>${esc(p.asset.product || '-')}</td><td>${esc(p.asset.version || '-')}</td><td>${esc(p.asset.type)}</td>
      <td>${p.asset.criticality}</td><td>${p.asset.exposure}</td><td>${p.asset.patch}</td><td class="muted">${p.warnings.map(esc).join('<br>') || '-'}</td></tr>`).join('')}
  </table></div>`;
}

// 탐색 결과 표 (할 일 홈·에이전트 대화에서도 사용)
function discoveryTable(findings, selectable) {
  return `<div class="table-wrap"><table>
    <tr>${selectable ? '<th></th>' : ''}<th>구분</th><th>자산</th><th>내용</th><th>근거</th></tr>
    ${findings.map((f, i) => `<tr>${selectable ? `<td><input type="checkbox" data-disc-pick="${i}" checked aria-label="${esc(f.name)} 반영"></td>` : ''}
      <td>${badge(f.kind, KIND_CLS[f.kind])}</td><td>${esc(f.name)}</td><td>${esc(describeFinding(f))}</td>
      <td class="muted">${esc(f.evidence)} <span class="chip">${esc(f.source)}</span></td></tr>`).join('')}
  </table></div>`;
}

function discoveryPanel() {
  const p = ui.discoveryPreview;
  return `<p class="muted">연결 소스에서 자산·버전·노출 정보를 수집해 등록 자산과 대조 (목업: 실제 접속 없음 · 읽기 전용 권한 전제 · 자격 증명 저장 안 함)</p>
    ${DISCOVERY_SOURCES.map(s => `<label class="check"><input type="checkbox" data-disc-source="${s.id}" ${ui.discoverySources.includes(s.id) ? 'checked' : ''}> <b>${esc(s.name)}</b> <span class="muted">${esc(s.scope)}</span></label>`).join('')}
    <div class="toolbar"><button class="small" data-action="discover">탐색 실행</button></div>
    ${p ? (p.length ? `${discoveryTable(p, true)}
      <div class="toolbar"><button class="small" data-action="discover-apply">선택 항목 반영</button>
        <button class="small ghost" data-action="discover-clear">취소</button></div>` : '<p class="empty">관측된 자산 없음</p>') : ''}`;
}

// 외부 점검 결과 가져오기 (기획안_v3 5-6): 자산 관측값은 자동 탐색과 같은 방식으로 대조, 설정 취약 항목은 할 일 후보
function scanPanel() {
  const p = ui.scanPreview;
  return `<p class="muted">내서버돌보미·점검 스크립트·스캐너(OpenVAS·Nessus) 결과 CSV 붙여넣기 → 자산 대조 + 설정 취약 항목은 할 일 후보. 스캐너를 대신하지 않고 결과를 할 일·증적으로 변환</p>
    <textarea id="scanText" rows="4" placeholder="첫 줄에 헤더가 있는 CSV">${esc(ui.scanText)}</textarea>
    <div class="toolbar">${Object.entries(SCAN_SAMPLES).map(([k, s]) => `<button class="small ghost" data-action="scan-sample" data-id="${k}">${esc(s.label)} 예시</button>`).join('')}
      <button class="small" data-action="scan-parse">분석</button></div>
    ${p ? `${p.findings.length ? discoveryTable(p.findings, false) : '<p class="empty">인식된 자산 없음</p>'}
      ${p.configs.length ? simpleTable({ head: ['자산', '설정 점검 항목', '결과'], rows: p.configs.map(c => [c.name, c.item, c.result]) }) : ''}
      <p class="muted">양호·조치 불필요 ${p.passed}건 제외 · 설정 취약 항목은 할 일로 등록</p>
      <div class="toolbar"><button class="small" data-action="scan-apply">승인 — 자산 반영 ${p.findings.filter(f => f.kind !== '확인').length}건 · 할 일 ${p.configs.length}건</button>
        <button class="small ghost" data-action="scan-clear">취소</button></div>` : ''}`;
}

function applyScan() {
  const p = ui.scanPreview;
  const changed = p.findings.filter(f => f.kind !== '확인');
  if (changed.length) {
    const r = applyDiscovery(changed);
    if (!r.ok) return r;
  }
  // 수정안 템플릿이 있는 설정 항목은 우선순위·수정안을 붙여 할 일 홈의 설정 보완 카드로 (L1)
  const n = p.configs.filter(c => {
    const fix = CONFIG_FIXES.find(f => f.match.test(c.item));
    const lv = fix && PRIORITY_LEVELS.find(l => l.label === fix.priority);
    return addExtraTask({
      kind: 'scan', key: `scan|${c.name}|${c.item.split(' ')[0]}`, assetName: c.name, cveId: c.item.split(' ')[0],
      title: `${c.item} 조치`, reason: `${ui.scanSource} 결과 ${c.result}`, refs: ['점검 결과'], link: '#todo',
      ...(fix ? { fixId: fix.id, priority: lv.label, priorityCls: lv.cls } : {}),
    });
  }).length;
  addHistory('점검 결과 반영', `${ui.scanSource}: 자산 반영 ${changed.length}건, 설정 취약 할 일 ${n}건 등록`);
  save();
  return { ok: true };
}

function manualPanel() {
  const e = ui.formDraft || state.assets.find(a => a.id === ui.editingAssetId) || { criticality: '중', exposure: '미확인', patch: '미적용', type: '서버' };
  const p = ui.intakePreview;
  return `${ui.editingAssetId ? '' : `<h3>일괄 등록 (자연어·CSV)</h3>
    <p class="muted">한 줄에 자산 하나씩 문장으로 쓰거나, 첫 줄에 헤더가 있는 CSV 붙여넣기 — 분석 결과 확인 후 등록</p>
    <textarea id="intakeText" rows="4" placeholder="예: 영업팀 파일 서버 톰캣 9.0.90 외부 공개">${esc(ui.intakeText)}</textarea>
    <div class="toolbar">
      <button class="small ghost" data-action="intake-sample" data-id="text">자연어 예시</button>
      <button class="small ghost" data-action="intake-sample" data-id="csv">CSV 예시</button>
      <button class="small" data-action="intake-parse">분석</button>
    </div>
    ${p ? (p.length ? `${intakeTable(p)}
      <div class="toolbar"><button class="small" data-action="intake-commit">${p.length}건 등록</button>
        <button class="small ghost" data-action="intake-clear">취소</button></div>` : '<p class="empty">인식된 자산 없음</p>') : ''}`}
    <h3>${ui.editingAssetId ? '자산 수정' : '개별 등록'}</h3>
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
        <button type="submit">${ui.editingAssetId ? '수정 저장' : '등록'}</button>
        <button type="button" class="ghost" data-action="asset-autofill">자동 채우기</button>
        ${ui.editingAssetId ? '<button type="button" class="ghost" data-action="cancel-edit">취소</button>' : ''}
      </div>
      ${ui.formDraft ? '<p class="muted">자동 추론값 채움 — 제품명·유형·중요도·노출·패치·담당자 (저장 전 수정 가능)</p>' : ''}
      <datalist id="productList">${PRODUCTS.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    </form>`;
}

function assetTable(list) {
  if (!state.assets.length) return '<p class="empty">등록된 자산 없음 — 위 자동 탐색 또는 직접 등록으로 시작</p>';
  return `<div class="table-wrap"><table>
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
  </table></div>`;
}

function viewAssets() {
  const lim = planOf().assetLimit;
  const tab = ui.editingAssetId ? 'manual' : ui.assetTab;
  const panels = { discover: discoveryPanel, scan: scanPanel, manual: manualPanel };
  return `
    <h2>자산·연결 소스</h2>
    <p class="sub">${esc(state.name)} · 자산 ${state.assets.length} / ${lim ?? '무제한'} (${esc(state.plan)} 플랜) · 저장 시 전체 위협 재평가</p>
    ${ui.formError ? `<p class="error">${esc(ui.formError)} <a href="#plans">요금제 보기</a></p>` : ''}
    <div class="card">
      <div class="toolbar">${ASSET_TABS.map(([k, l]) => `<button class="tab ${k === tab ? 'active' : ''}" data-action="asset-tab" data-id="${k}">${l}</button>`).join('')}</div>
      ${panels[tab]()}
    </div>
    <div class="card">
      <h3>등록 자산 (${state.assets.length}) <span class="muted">보안 운영 대상</span></h3>
      ${assetTable(allAssessments())}
    </div>
    <div class="card">
      <h3>사이트 구성요소 (${opsComponents().length}) <span class="muted">오류 운영 대상 — ${esc(opsSite().domain)}</span></h3>
      ${simpleTable({ head: ['구성요소', '역할', '호출하는 쪽'], rows: opsComponents().map(c => [c.name, c.desc, c.callers.map(opsName).join(', ') || '-']) })}
      <p class="muted">지표·로그 감시 대상 (목업: 합성 지표) — 오류 지연이 호출하는 쪽으로 번지는지 판단하는 데 사용</p>
    </div>`;
}

VIEWS.assets = viewAssets;

Object.assign(ACTIONS, {
  'asset-tab': id => { ui.assetTab = id; ui.editingAssetId = null; ui.formDraft = null; route(); },
  'edit-asset': id => { ui.editingAssetId = id; ui.formDraft = null; route(); window.scrollTo(0, 0); },
  'cancel-edit': () => { ui.editingAssetId = null; ui.formDraft = null; route(); },
  'asset-autofill': () => {
    const d = formData(new FormData(document.getElementById('assetForm')));
    const p = parseLine([d.name, d.product, d.version, d.purpose].filter(Boolean).join(' ')).asset;
    const product = p.product || d.product;
    ui.formDraft = {
      ...d, product, type: p.type, criticality: p.criticality, owner: d.owner || p.owner,
      exposure: d.exposure === '미확인' ? p.exposure : d.exposure, patch: inferPatch(product, d.version) || d.patch,
    };
    route();
  },
  'delete-asset': id => {
    const a = state.assets.find(x => x.id === id);
    state.assets = state.assets.filter(x => x.id !== id);
    state.tasks = state.tasks.filter(t => !t.key.startsWith(`${id}|`));
    Object.keys(state.overrides).filter(k => k.startsWith(`${id}|`)).forEach(k => delete state.overrides[k]);
    if (ui.editingAssetId === id) ui.editingAssetId = null;
    addHistory('자산 변경', `자산 삭제: ${a.name}`);
    reassess(`자산 삭제: ${a.name}`); route();
  },
  discover: () => {
    ui.discoverySources = [...document.querySelectorAll('[data-disc-source]:checked')].map(x => x.dataset.discSource);
    ui.discoveryPreview = runDiscovery(ui.discoverySources, state.assets, state.id);
    route();
  },
  'discover-clear': () => { ui.discoveryPreview = null; route(); },
  'discover-apply': () => {
    const picked = [...document.querySelectorAll('[data-disc-pick]:checked')].map(x => ui.discoveryPreview[Number(x.dataset.discPick)]);
    if (!picked.length) return;
    const r = applyDiscovery(picked);
    if (r.ok) { ui.discoveryPreview = null; ui.formError = ''; } else ui.formError = r.msg;
    route();
  },
  'intake-sample': id => { ui.intakeText = INTAKE_SAMPLES[id]; ui.intakePreview = null; route(); },
  'intake-parse': () => { ui.intakeText = document.getElementById('intakeText').value; ui.intakePreview = parseAssets(ui.intakeText); route(); },
  'intake-clear': () => { ui.intakePreview = null; route(); },
  'intake-commit': () => {
    const r = addAssets(ui.intakePreview.map(p => p.asset), '자산 일괄 등록');
    if (r.ok) { ui.intakePreview = null; ui.intakeText = ''; ui.formError = ''; } else ui.formError = r.msg;
    route();
  },
  'scan-sample': id => { ui.scanText = SCAN_SAMPLES[id].text; ui.scanSource = SCAN_SAMPLES[id].label; ui.scanPreview = null; route(); },
  'scan-parse': () => {
    ui.scanText = document.getElementById('scanText').value;
    if (!ui.scanSource) ui.scanSource = '외부 점검 결과';
    const r = parseScanResults(ui.scanText);
    ui.scanPreview = { findings: r.observations.map(o => classifyObservation(o, state.assets, ui.scanSource)), configs: r.configs, passed: r.passed };
    route();
  },
  'scan-clear': () => { ui.scanPreview = null; route(); },
  'scan-apply': () => {
    const r = applyScan();
    if (r.ok) { ui.scanPreview = null; ui.scanText = ''; ui.formError = ''; } else ui.formError = r.msg;
    route();
  },
});

FORMS.assetForm = form => {
  const data = formData(form);
  let asset = state.assets.find(a => a.id === ui.editingAssetId);
  if (asset) {
    Object.assign(asset, data);
    addHistory('자산 변경', `자산 수정: ${asset.name}`);
  } else {
    if (!assetRoom(1)) { ui.formError = limitMsg(); route(); return; }
    asset = { id: `A${++state.seq}`, ...data };
    state.assets.push(asset);
    addHistory('자산 변경', `자산 등록: ${asset.name} (${asset.product} ${asset.version || '버전 미등록'})`);
  }
  ui.editingAssetId = null; ui.formError = ''; ui.formDraft = null;
  reassess(`자산 정보 변경: ${asset.name}`);
  route();
};
