// 오류 운영: 오류 모니터링 — 구성요소 지표·로그 감시 → 원인 분석·근거 검증 → 메신저 알림·오류 보고서·할 일 (팀원 AI SRE '당직동료' 로직)
// 원칙: 근거는 지표·로그·런북, 판정은 코드, 문장은 템플릿(LLM 자리)

const opsSite = () => state.site || OPS_SITES[state.id] || { name: '사이트', domain: `${state.name} 사이트` };
const OPS_STATUS_CLS = { '원인 후보': 'p-urgent', 이상: 'p-high', 주의: 'p-medium', 정상: 'p-done' };
const openIncidents = () => state.opsIncidents.filter(opsOpen);

// 오류 감지 → 분석 → 보고서 자동 보관·알림·런북 단계별 할 일 등록 (KEV 긴급 알림 자동 생성과 같은 흐름)
function simulateOpsIncident(component, fault) {
  const id = `I${++state.seq}`;
  const site = opsSite().domain;
  const inc = { id, at: nowText(), ...runOpsAnalysis(component, fault, state.seq, site) };
  state.opsIncidents.unshift(inc);
  const f = inc.facts, top = f.원인_후보[0].서비스, rb = runbookOf(f.참고_런북[0].id);
  inc.reportId = archiveReport('error', '자동 — 사이트 오류 감지', id).id;
  addHistory('오류 감지', `${site}: ${top} ${f.추정_장애유형} 추정 — 근거 ${opsVerified(f)}/${f.검증.length} 확인, 오류 보고서 초안 자동 생성`);
  notify('오류', `${top} · ${f.추정_장애유형} 추정`, `${site} — 메신저 알림·오류 보고서 초안 자동 생성`, `#ops/${id}`);
  [['원인 1차 확인', rb.check], ['즉시 조치', rb.action], ['재발 방지 계획', rb.prevent]].forEach(([title, reason]) => addExtraTask({
    kind: 'ops', key: `ops|${id}`, assetName: `${site} ${top}`, cveId: rb.id, priority: '긴급', priorityCls: 'p-urgent',
    title: `[오류] ${title}`, reason, refs: [rb.id], link: `#ops/${id}`,
  }));
  save();
  return inc;
}

// 할 일 홈 '오늘 처리'의 오류 카드: 왜(쉬운 말) → 런북 단계 체크 → 원인·근거·보고서
function opsCard(inc) {
  const f = inc.facts, ok = opsVerified(f);
  const tasks = state.tasks.filter(t => t.key === `ops|${inc.id}`);
  return `<div class="card todo-card p-urgent-edge">
    <div class="head">${badge('사이트 오류', 'p-urgent')} <b>${esc(f.원인_후보[0].서비스)}</b> <span class="muted">${esc(inc.site)} · 감지 ${esc(f.장애_감지_시각)}</span></div>
    <p class="why"><b>왜</b> ${esc(f.추정_장애유형)} 추정 · ${esc(f.근거_지표[0].지표)}가 평소보다 크게 튐 · 근거 ${ok}/${f.검증.length} 확인</p>
    <ul class="checklist">${tasks.map(t => `<li><label><input type="checkbox" data-change="todo-task" data-id="${t.id}" ${t.status === '완료' ? 'checked' : ''}> ${esc(t.title.replace('[오류] ', ''))}</label>
      <div class="muted">${esc(t.reason)}</div></li>`).join('')}</ul>
    <div class="toolbar"><a href="#ops/${inc.id}">원인·근거 보기 →</a><a href="#report/log-${inc.reportId}">오류 보고서 초안 →</a></div>
  </div>`;
}

function opsDetail(inc) {
  const f = inc.facts, ok = opsVerified(f), n = f.검증.length;
  const hit = inc.truth.component === inc.det.top && inc.truth.fault === inc.det.fault;
  const rbs = f.참고_런북.map(r => runbookOf(r.id));
  const open = opsOpen(inc);
  return `<div class="card">
      <div class="toolbar"><h3 style="margin:0">${esc(f.원인_후보[0].서비스)} · ${esc(f.추정_장애유형)} 추정</h3>
        ${badge(`근거 ${ok}/${n} 확인`, ok === n ? 'p-done' : 'p-medium')}
        ${badge(hit ? '주입 정답 일치' : `주입 정답: ${opsName(inc.truth.component)} · ${faultOf(inc.truth.fault).name}`, hit ? 'p-done' : 'p-high')}
        ${badge(open ? '조치 대기' : '조치 완료', open ? 'p-high' : 'p-done')}</div>
      <p class="muted">감지 ${esc(f.장애_감지_시각)} · ${esc(inc.site)} · 케이스 ${esc(f.케이스)} · <a href="#report/log-${inc.reportId}">오류 보고서 초안 →</a></p>
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
    <p class="sub">${esc(site.name)} ${esc(site.domain)} · 구성요소 ${opsComponents().length}개 지표·로그 상시 감시(목업) → 원인 분석·근거 검증 → 메신저 알림·오류 보고서·할 일 자동 생성</p>
    <div class="card no-print"><div class="toolbar" style="margin:0">
      <b>오류 시뮬레이션</b>
      <select id="opsComponent" aria-label="구성요소">${opt(opsComponents(), ui.opsPick.component)}</select>
      <select id="opsFault" aria-label="오류 유형">${opt(OPS_FAULTS, ui.opsPick.fault)}</select>
      <button class="small" data-action="ops-simulate">오류 발생 시뮬레이션</button>
      <span class="muted">합성 지표에 오류 주입 — 호출자 지연 전파·무관 구성요소 방해 스파이크 포함, 원인은 에이전트가 판단</span>
    </div></div>
    <div class="grid kpi">${opsComponents().map(c => {
      const st = inc && opsOpen(inc) ? inc.det.status[c.id] : '정상';
      return `<div class="card"><div class="label">${esc(c.name)}</div><div>${badge(st, OPS_STATUS_CLS[st])}</div><div class="hint">${esc(c.desc)}</div></div>`;
    }).join('')}</div>
    ${inc ? opsDetail(inc) : '<div class="card"><p class="empty">감지된 오류 없음 — 위에서 오류 시뮬레이션 실행</p></div>'}
    ${list.length ? `<div class="card"><h3>오류 이력 (${list.length})</h3><div class="table-wrap"><table>
      <tr><th>감지 시각</th><th>원인 후보</th><th>추정 유형</th><th>근거 검증</th><th>상태</th><th>보고서</th></tr>
      ${list.map(i => `<tr${i === inc ? ' class="current"' : ''}><td><a href="#ops/${i.id}">${esc(i.facts.장애_감지_시각)}</a></td><td>${esc(i.facts.원인_후보[0].서비스)}</td><td>${esc(i.facts.추정_장애유형)}</td>
        <td>${opsVerified(i.facts)}/${i.facts.검증.length} 확인</td><td>${opsOpen(i) ? badge('조치 대기', 'p-high') : badge('조치 완료', 'p-done')}</td><td><a href="#report/log-${i.reportId}">보기</a></td></tr>`).join('')}
    </table></div></div>` : ''}`;
}

VIEWS.ops = viewOps;

Object.assign(ACTIONS, {
  'ops-simulate': () => {
    ui.opsPick = { component: document.getElementById('opsComponent').value, fault: document.getElementById('opsFault').value };
    const inc = simulateOpsIncident(ui.opsPick.component, ui.opsPick.fault);
    location.hash = `#ops/${inc.id}`;
  },
  // 상단 바: 현재 선택값으로 오류 주입 — 알림·할 일 카드로 이어지는 흐름 시연
  'ops-quick': () => {
    const ids = opsComponents().map(c => c.id);
    const component = ids.includes(ui.opsPick.component) ? ui.opsPick.component : ids[0];
    simulateOpsIncident(component, ui.opsPick.fault);
    route();
  },
});
