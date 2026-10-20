// 설정: 사이트 시작하기 (기획안_v3 5-7) — 템플릿 + 보안·운영 기본값으로 만들고, 배포 즉시 자산·할 일·오류 감시가 붙은 채로 시작
// 꾸미기는 고객이 외부 도구로 — 배포 변경 감지 시 기본값 복원·수정안 할 일·오류 분석으로 대응

function starterHeaders(platform, domain) {
  const h = SECURITY_HEADERS;
  return platform.header === '_headers'
    ? `# _headers — ${domain}\n/*\n${h.map(([k, v]) => `  ${k}: ${v}`).join('\n')}`
    : `# .htaccess — ${domain}\nRewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]\n${h.map(([k, v]) => `Header always set ${k} "${v}"`).join('\n')}`;
}

// 템플릿 적용 후 사이트 화면 목업 — 번호는 화면에 드러나는 기본값 위치
function starterMockup(tpl, site) {
  const pin = n => `<i class="pin">${n}</i>`;
  const booking = tpl.id === 'booking';
  const body = booking
    ? `<div class="mock-box"><b>예약 가능 시간</b><div class="mock-slots"><span>10:00</span><span class="off">11:00 마감</span><span>14:00</span><span>16:00</span></div></div>`
    : `<div class="mock-cols"><div class="mock-box"><b>소개</b><p class="mock-lines"><span></span><span></span><span class="short"></span></p></div>
        <div class="mock-box"><b>오시는 길</b><div class="mock-map">지도·주소·영업시간</div></div></div>`;
  const fields = booking ? ['이름', '연락처', '희망 날짜·시간', '상담 내용'] : ['이름', '연락처', '문의 내용'];
  const legend = [
    ['HTTPS 강제·HSTS', '자물쇠 주소로 고정 — 보안 헤더는 화면에 안 보이고 응답에 적용'],
    ['폼 수집 동의·보관 기간', `${tpl.store} 저장 전 동의 체크, 1년 뒤 자동 삭제`],
    ['개인정보 처리방침 초안', '하단 고정 링크 — 게시 전 법률 검토 필요'],
    ['security.txt', '취약점 신고 연락처'],
    ['오류 감시 등록', `접수 실패 시 ${tpl.components.find(c => c.id === 'app').name} 구성요소로 감지 → 오류 보고`],
  ];
  return `<div class="site-mock tpl-${tpl.id}">
      <div class="mock-bar"><span class="mock-dots">● ● ●</span><span class="mock-url">🔒 https://${esc(site.domain)}/ ${pin(1)}</span></div>
      <div class="mock-nav"><b>${esc(site.name)}</b><span>${booking ? '소개 · 예약 · 오시는 길' : '소개 · 오시는 길 · 문의'}</span></div>
      <div class="mock-hero"><h4>${esc(site.name)}</h4><p>${esc(site.industry || '우리 가게')} — ${booking ? '원하는 시간에 바로 예약하세요' : '궁금한 점은 언제든 문의하세요'}</p><span class="mock-btn">${booking ? '예약하기' : '문의하기'}</span></div>
      ${body}
      <div class="mock-box"><b>${booking ? '예약 신청' : '문의 남기기'}</b>
        ${fields.map(f => `<div class="mock-input${f.includes('내용') ? ' tall' : ''}">${f}</div>`).join('')}
        <div class="mock-consent">☐ 개인정보 수집·이용 동의 (필수) — 이름·연락처, 1년 보관 후 자동 삭제 ${pin(2)}</div>
        <span class="mock-btn">${booking ? '예약 신청' : '보내기'}</span>
        <span class="mock-note">${booking ? '신청 즉시 예약 확인 문자·메일 발송' : '접수 시 운영자에게 알림 메일'} ${pin(5)}</span></div>
      <div class="mock-foot">© ${esc(site.name)} · <u>개인정보 처리방침</u> <em>[초안·검토 필요]</em> ${pin(3)} · 보안 연락처 /.well-known/security.txt ${pin(4)}</div>
    </div>
    <ol class="mock-legend">${legend.map(([k, v]) => `<li><b>${k}</b> — ${esc(v)}</li>`).join('')}</ol>`;
}

// 근거: 개발자가 직접 만든 실사이트 2곳의 보안 헤더 점검 (기획안_v3 5-7 근거)
function starterBasis() {
  return `<details class="card" ${keep('starter-basis')}>
    <summary><b>근거: 실사이트 2곳 보안 헤더 점검</b> <span class="muted">생성 도구·플랫폼 기본값이 운영 보안을 채워주지 않는 사례</span></summary>
    <p class="muted">관측 ${MYSITE_OBSERVED} · 읽기 전용 GET 요청(응답 헤더·HTML·공개 스크립트)만 사용한 스냅샷</p>
    ${simpleTable({ head: ['항목', OPS_SITES.ANI.name, OPS_SITES.WN.name], rows: MYSITE_CHECKS })}
  </details>`;
}

// 사이트 생성 후: 생성 정보 + 변경 감지 시뮬레이션·이력 (오류는 오류 모니터링으로 연결)
function starterManaged() {
  const site = state.site, s = site.starter;
  const tpl = STARTER_TEMPLATES.find(x => x.name === s.template);
  return `<div class="card"><h3>${esc(site.name)} ${badge('관리 연결됨', 'p-done')}</h3>
      <p>${esc(site.domain)} · ${esc(s.template)} · ${esc(s.platform)} · ${esc(s.at)} 생성</p>
      ${tpl ? `<details><summary>생성된 사이트 화면 보기</summary>${starterMockup(tpl, { ...site, industry: state.industry === '미지정' ? '' : state.industry })}</details>` : ''}
    </div>
    <div class="card"><h3>변경 감지 → 자동 대응</h3>
      <p class="muted">꾸미기는 고객이 다른 빌더·AI 도구로 직접 — 배포가 바뀌면 기본값·오류를 다시 점검. 고객 파일 수정은 수정안 + 승인</p>
      <label class="check"><input type="checkbox" data-action="starter-autorestore" ${site.autoRestore !== false ? 'checked' : ''}> 기본값 파일 자동 복원 허용</label>
      <div class="toolbar">
        <select id="starterChange">${STARTER_CHANGES.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <button class="small" data-action="starter-change">고객 수정 발생 시뮬레이션</button></div>
      ${(site.changes || []).length ? simpleTable({ head: ['감지 시각', '고객 변경', '감지 내용', '대응'],
        rows: site.changes.map(c => [c.at, c.name, c.detect, c.action]) }) : '<p class="muted">감지 이력 없음</p>'}
      ${state.opsIncidents.length ? `<p><a href="#ops">오류 모니터링에서 원인·근거 보기 →</a></p>` : ''}
    </div>`;
}

// 사이트 생성 전: 1. 템플릿·조건 → 2. 화면 → 3. 기본값·헤더·자동 등록 미리보기 → 승인·배포
function starterCreate() {
  const d = ui.starterDraft;
  const tpl = d && STARTER_TEMPLATES.find(x => x.id === d.template);
  const pf = d && STARTER_PLATFORMS.find(x => x.id === d.platform);
  const opt = (items, cur) => items.map(x => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  return `<div class="card">
      <h3>1. 템플릿·배포 대상</h3>
      <form id="starterForm" class="asset-form">
        <label>사이트 이름 *<input name="name" required value="${esc(d?.name || '')}" placeholder="예: 한빛 공방"></label>
        <label>도메인 *<input name="domain" required value="${esc(d?.domain || '')}" placeholder="예: hanbit-craft.kr"></label>
        <label>업종<input name="industry" value="${esc(d?.industry || '')}" placeholder="예: 공방·교육"></label>
        <label>업종 템플릿<select name="template">${opt(STARTER_TEMPLATES, d?.template)}</select></label>
        <label>배포 대상 (고객 소유 계정)<select name="platform">${opt(STARTER_PLATFORMS, d?.platform)}</select></label>
        <div class="form-actions"><button type="submit">기본값 미리보기</button></div>
      </form>
      <p class="muted">템플릿 2종만 제공 — 편집기·쇼핑몰·결제 없음, 호스팅하지 않음</p>
    </div>
    ${d ? `
    <div class="card"><h3>2. 생성될 사이트 — ${esc(tpl.name)}</h3>
      <p class="muted">${esc(tpl.pages)} 한 페이지 구성 — 번호는 화면에 적용된 기본값 위치</p>${starterMockup(tpl, d)}</div>
    <div class="card"><h3>3. 보안·운영 기본값 (${STARTER_DEFAULTS.length})</h3>${simpleTable({ head: ['분류', '기본값', '이유'], rows: STARTER_DEFAULTS })}
      <div class="grid two">
        <div><h3>보안 헤더 파일</h3><code class="cmd">${esc(starterHeaders(pf, d.domain))}</code>
          <p class="muted">${esc(pf.header)} 형식 — 고객 계정에 함께 배포</p></div>
        <div><h3>배포 후 자동 등록</h3>
          <p><b>자산</b> ${esc(d.name)} 사이트 (${esc(pf.product)}), ${esc(tpl.store)}</p>
          <p><b>오류 감시 구성요소</b> ${tpl.components.map(c => esc(c.name)).join(' · ')}</p>
          <p><b>첫 할 일</b></p><ul class="plain">${STARTER_TASKS.map(t => `<li>${esc(t.title)}</li>`).join('')}</ul></div>
      </div>
      <div class="toolbar">
        <button data-action="starter-deploy">승인 — 고객 계정에 배포 (시뮬레이션)</button>
        <button class="ghost" data-action="starter-clear">취소</button>
        <span class="muted">실제 생성·배포 없음 — 새 고객사로 등록 후 할 일 홈으로 이동</span></div>
    </div>` : ''}`;
}

function viewStarter() {
  return `
    <h2>사이트 시작하기</h2>
    <p class="sub">업종 템플릿 + 보안·운영 기본값으로 만들고, 배포 즉시 자산·할 일·오류 감시가 붙은 채로 시작 — 고객 소유 계정에 배포</p>
    ${starterBasis()}
    ${state.site?.starter ? starterManaged() : starterCreate()}`;
}

// 배포 승인: 새 고객사 생성 → 자산·구성요소·첫 할 일 등록 (생성 시점 자산 자동 등록 → 분석 → 리포팅)
function createStarterSite() {
  const d = ui.starterDraft;
  const tpl = STARTER_TEMPLATES.find(x => x.id === d.template);
  const pf = STARTER_PLATFORMS.find(x => x.id === d.platform);
  const id = `T${Object.keys(store.tenants).length + 1}`;
  const verified = { at: today(), source: '사이트 스타터' };
  const t = seedTenant({
    id, name: d.name, industry: d.industry || '미지정', plan: '무료',
    profile: { ...DEFAULT_PROFILE, employees: 5, personalInfo: true },
    assets: [
      { id: `${id}-1`, name: `${d.name} 사이트`, product: pf.product, version: '', type: '웹 애플리케이션', criticality: '상', exposure: '예', purpose: `${tpl.name} — ${d.domain}`, patch: '적용 완료', owner: '운영자', maintainer: `고객 소유 계정: ${pf.name}`, verified },
      { id: `${id}-2`, name: tpl.store, product: pf.product, version: '', type: 'DB', criticality: '상', exposure: '아니오', purpose: `${tpl.pages} 데이터 (개인정보)`, patch: '적용 완료', owner: '운영자', maintainer: `고객 소유 계정: ${pf.name}`, verified },
    ],
    trend: Array.from({ length: 7 }, () => [0, 0]),
    schedules: Object.fromEntries(Object.entries(DEFAULT_SCHEDULES).map(([k, s]) => [k, { ...s, on: false }])),
  });
  t.site = { name: d.name, domain: d.domain, components: tpl.components, starter: { template: tpl.name, platform: pf.name, at: today() } };
  t.vulns = store.vulns; t.feed = store.feed;
  store.tenants[id] = t;
  switchTenant(id);
  addHistory('사이트 생성', `${d.domain}: ${tpl.name} 템플릿, ${pf.name} 배포(시뮬레이션) — 기본값 ${STARTER_DEFAULTS.length}종 적용, 자산 2건·구성요소 ${tpl.components.length}개 자동 등록`);
  STARTER_TASKS.forEach(x => addExtraTask({ kind: 'starter', key: `starter|${x.code}`, assetName: `${d.name} 사이트`, cveId: x.code,
    title: x.title, reason: x.reason, refs: ['사이트 스타터'], link: '#starter' }));
  notify('브리핑', `${d.name} 사이트 배포 완료(시뮬레이션)`, `관리 연결 — 첫 할 일 ${STARTER_TASKS.length}건 등록`, '#todo');
  save();
  location.hash = '#todo';
  route();
}

// 고객이 외부 도구로 수정한 배포 감지 → 기본값 복원은 자동, 고객 파일 수정은 수정안 할 일, 오류는 오류 감시로
function detectStarterChange(changeId) {
  const c = STARTER_CHANGES.find(x => x.id === changeId);
  const site = state.site, assetName = `${site.name} 사이트`;
  const log = action => {
    (site.changes ||= []).unshift({ at: nowText(), name: c.name, detect: c.detect, action });
    addHistory('변경 감지', `${site.domain}: ${c.name} — ${action}`);
  };
  if (c.ops) {
    const inc = simulateOpsIncident(c.ops.component, c.ops.fault);
    log(`오류 감시로 원인 분석·오류 보고서 초안 자동 생성 (${inc.id})`);
    save();
    location.hash = `#ops/${inc.id}`;
    return;
  } else if (c.restore && site.autoRestore !== false) {
    log(`자동 복원: ${c.fix} — 고객 계정에 재배포(시뮬레이션)`);
    notify('브리핑', `${site.name}: 보안 기본값 자동 복원`, c.detect, '#starter');
  } else {
    if (c.asset && !state.assets.some(a => a.name === c.asset)) {
      const pf = STARTER_PLATFORMS.find(p => p.name === site.starter.platform);
      state.assets.push({ id: `${state.id}-${state.assets.length + 1}`, name: c.asset, product: '외부 스크립트', version: '', type: '외부 서비스', criticality: '중', exposure: '예', purpose: `${site.domain}에 고객이 추가`, patch: '확인 필요', owner: '운영자', maintainer: `고객 소유 계정: ${pf?.name || ''}`, verified: { at: today(), source: '변경 감지' } });
    }
    addExtraTask({ kind: 'starter', key: `change|${c.id}`, assetName, cveId: c.type, priority: c.priority, priorityCls: c.priorityCls,
      title: `[변경 감지] ${c.title}`, reason: `${c.detect} → 수정안: ${c.fix}`, refs: ['변경 감지'], link: '#starter' });
    log(`수정안 생성 → 할 일 등록 (승인 후 재배포)${c.asset ? ` · 자산 '${c.asset}' 자동 등록` : ''}`);
    notify(c.priority === '긴급' ? '긴급' : '브리핑', `${site.name}: ${c.title}`, c.detect, '#todo');
  }
  save();
  route();
}

VIEWS.starter = viewStarter;

Object.assign(ACTIONS, {
  'starter-deploy': () => { if (ui.starterDraft) createStarterSite(); },
  'starter-clear': () => { ui.starterDraft = null; route(); },
  'starter-change': () => { if (state.site?.starter) detectStarterChange(document.getElementById('starterChange').value); },
  'starter-autorestore': (id, el) => { state.site.autoRestore = el.checked; save(); },
});

FORMS.starterForm = form => { ui.starterDraft = formData(form); route(); };
