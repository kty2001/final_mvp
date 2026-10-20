// 설정: 요금제·회사 조건·지원사업 / 파트너 콘솔: 고객사 현황 (MSP)

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

// 정부 지원사업 (기획안_v3 5-6): 회사 조건 규칙 대조 → 신청용 보안 현황 자료 생성
function supportCard() {
  return `<div class="card">
    <h3>정부 지원사업</h3>
    <p class="muted">회사 조건으로 대상 여부 판단 — 지원 조건·비율·일정은 공고별 확인 필요 (목업)</p>
    <ul class="plain">${matchPrograms().map(p => `<li>${badge(p.eligible ? '대상' : '조건 미충족', p.eligible ? 'p-done' : 'p-none')} <b>${esc(p.name)}</b> <span class="muted">${esc(p.org)} · ${esc(p.benefit)}</span>
      <div class="muted">${[...p.ok.map(x => `✔ ${x}`), ...p.fail.map(x => `✖ ${x}`)].map(esc).join(' · ')}</div>
      ${p.eligible ? `<button class="small ghost" data-action="support-doc" data-id="${p.id}">신청용 보안 현황 자료 생성</button>` : ''}</li>`).join('')}</ul>
  </div>`;
}

function viewPlans() {
  const lim = planOf().assetLimit;
  return `
    <h2>요금제·지원사업</h2>
    <p class="sub">가격은 고객 인터뷰의 지불 의향 조사로 결정 예정 — 시연용 플랜 구조, 결제 기능 없음</p>
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
    <div class="grid two">${profileCard()}${supportCard()}</div>`;
}

const opsWaiting = t => t.opsIncidents.filter(i => t.tasks.some(x => x.key === `ops|${i.id}` && x.status !== '완료')).length;

function viewTenants() {
  const stats = statTenants();
  return `
    <h2>고객사 현황</h2>
    <p class="sub">파트너(MSP·에이전시) 화면 · 담당 고객사 ${stats.length}곳의 보안 위험·오류 현황을 비교하고 전환</p>
    <div class="card"><div class="table-wrap"><table>
      <tr><th>고객사</th><th>업종</th><th>플랜</th><th>자산</th><th>대응 필요</th><th>긴급</th><th>KEV 연관</th><th>오류 조치 대기</th><th>조치 진행률</th><th>읽지 않은 알림</th><th></th></tr>
      ${stats.map(s => `<tr class="${s.id === state.id ? 'current-row' : ''}">
        <td><b>${esc(s.name)}</b></td><td>${esc(s.industry)}</td><td>${esc(s.plan)}</td><td class="num">${s.assets}</td><td class="num">${s.active}</td>
        <td class="num">${s.urgent ? badge(s.urgent, 'p-urgent') : 0}</td><td class="num">${s.kev}</td><td class="num">${opsWaiting(store.tenants[s.id]) ? badge(opsWaiting(store.tenants[s.id]), 'p-high') : 0}</td><td class="num">${s.progress == null ? '-' : `${s.progress}%`}</td>
        <td class="num">${s.unread}</td>
        <td>${s.id === state.id ? '<span class="muted">현재</span>' : `<button class="small ghost" data-action="switch-tenant" data-id="${s.id}">열기</button>`}</td>
      </tr>`).join('')}
    </table></div></div>
    <div class="grid two">
      <div class="card">${renderChart({ kind: 'bar', title: '고객사별 대응 필요 위협 (보안)', unit: '건', rows: stats.map(s => ({ label: s.name, value: s.active, fill: SERIES[0], title: `${s.name}: 대응 필요 ${s.active}건 · 긴급 ${s.urgent}건` })) })}</div>
      <div class="card">${renderChart({ kind: 'bar', title: '고객사별 오류 조치 대기 (오류)', unit: '건', rows: stats.map(s => ({ label: s.name, value: opsWaiting(store.tenants[s.id]), fill: SERIES[1], title: `${s.name}: 오류 조치 대기 ${opsWaiting(store.tenants[s.id])}건` })) })}</div>
    </div>
    <div class="card">
        <h3>고객사 추가</h3>
        <form id="tenantForm" class="asset-form one">
          <label>고객사명 *<input name="name" required placeholder="예: 샘플 D사"></label>
          <label>업종<input name="industry" placeholder="예: 유통"></label>
          ${selectField('plan', '플랜', PLANS.filter(p => !p.partnerOnly).map(p => p.id), '무료')}
          <div class="form-actions"><button type="submit">추가 후 전환</button></div>
        </form>
    </div>`;
}

VIEWS.plans = viewPlans;
VIEWS.tenants = viewTenants;

Object.assign(ACTIONS, {
  'set-plan': id => {
    const prev = state.plan;
    state.plan = id;
    addHistory('플랜 변경', `${prev} → ${id} (목업, 결제 없음)`);
    ui.formError = ''; save(); route();
  },
  'support-doc': id => {
    const log = archiveReport('support', '지원사업 신청 자료 생성', id);
    addHistory('리포트', `${log.title} 생성`);
    save();
    location.hash = `#report/log-${log.id}`;
  },
  'switch-tenant': id => { switchTenant(id); location.hash = '#todo'; route(); },
});

Object.assign(FORMS, {
  profileForm: form => {
    const d = Object.fromEntries(form.entries());
    state.profile = { employees: Math.max(1, Number(d.employees) || 1), region: d.region, ...Object.fromEntries(Object.keys(PROFILE_FLAGS).map(k => [k, form.has(k)])) };
    addHistory('회사 조건', `임직원 ${state.profile.employees}명 · ${state.profile.region} · ${Object.entries(PROFILE_FLAGS).filter(([k]) => state.profile[k]).map(([, l]) => l).join(', ') || '해당 조건 없음'}`);
    save(); route();
  },
  tenantForm: form => {
    const data = formData(form);
    const id = `T${Object.keys(store.tenants).length + 1}`;
    const t = seedTenant({
      id, name: data.name, industry: data.industry || '미지정', plan: data.plan, assets: [],
      trend: Array.from({ length: 7 }, () => [0, 0]),
      schedules: Object.fromEntries(Object.entries(DEFAULT_SCHEDULES).map(([k, s]) => [k, { ...s, on: false }])),
    });
    t.vulns = store.vulns; t.feed = store.feed;
    store.tenants[id] = t;
    switchTenant(id);
    addHistory('고객사', `고객사 생성: ${t.name} (${t.plan} 플랜)`);
    save();
    location.hash = '#todo';
    route();
  },
});
