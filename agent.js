// 목업 대화형 분석 에이전트: 키워드로 의도를 분류하고 기존 평가 함수를 도구로 호출함
// 위험 점수는 규칙 엔진(engine.js) 결과를 그대로 사용, 상태 변경은 사용자 승인 후 실행

const AGENT_EXAMPLES = [
  '지금 제일 급한 거 뭐야?', 'VPN 관련 위협 정리해줘', 'Jenkins 건은 왜 긴급이야?', '버전 확인 필요한 자산 알려줘',
  '등급별 위험 분포 보여줘', '지난 8주 추이 보여줘', '고객사별 현황 비교해줘',
  '미확인 정보 채워줘', '자산 등록: 영업팀 파일 서버 톰캣 9.0.90 외부 공개', '이번 주 경영진 보고서 만들어줘',
];
const GENERIC_TOKENS = new Set(['서버', '사내', '내부']);

function findTargets(text, list) {
  const q = norm(text);
  const cve = text.match(/CVE-\d{4}-\d+/i);
  return list.filter(a => {
    if (cve) return a.vuln.id.toLowerCase() === cve[0].toLowerCase();
    if (q.includes(norm(a.asset.product))) return true;
    return a.asset.name.split(/\s+/).some(t => t.length >= 2 && !GENERIC_TOKENS.has(t) && q.includes(norm(t)));
  });
}

function reasonShort(a) {
  return [a.vuln.kev && 'KEV 등재', `CVSS ${a.vuln.cvss.toFixed(1)}`, a.asset.exposure === '예' && '외부 노출', a.asset.criticality === '상' && '핵심 자산', a.confidence !== '높음' && `신뢰도 ${a.confidence}`]
    .filter(Boolean).join(', ');
}

function agentRespond(text) {
  const tools = [];
  const call = (name, args, fn, summarize) => { const r = fn(); tools.push({ name, args, result: summarize(r) }); return r; };
  const res = o => {
    const r = { text: [], items: [], refs: [], action: null, link: null, chart: null, previewRows: null, ...o, tools };
    r.citation = verifyCitations(r.text, r.items);
    if (r.citation) tools.push({ name: 'verify_citations', args: `인용 ${r.citation.total}건`, result: `출처 일치 ${r.citation.ok}건` });
    return r;
  };
  const refsOf = items => [...new Set(items.flatMap(a => a.facts.map(f => f.ref)))];
  const has = re => re.test(text);
  const taskAction = a => (a.status === 'active' && !state.tasks.some(t => t.key === a.key)
    ? { type: 'create-tasks', key: a.key, label: '승인 — 조치 업무 생성' } : null);

  if (has(/보고서|리포트|report/i)) {
    const type = has(/이행|감사|증적|조치 현황/) ? 'compliance' : has(/상세|실무/) ? 'detail' : 'exec';
    const r = call('generate_report', `type=${type}`, () => buildReport(type), x => `${x.title}, 섹션 ${x.sections.length}개`);
    return res({ text: [`'${r.title}' 생성 완료.`, r.summary], link: { href: `#report/${type}`, label: '리포트 열기' } });
  }

  if (has(/탐색|스캔|채워|자동.*(등록|확인)/)) {
    const findings = DISCOVERY_SOURCES.flatMap(s => call(s.tool, s.name, () => runDiscovery([s.id], state.assets, state.id), r => `관측 ${r.length}건`));
    if (!findings.length) return res({ text: ['연결 소스에서 관측된 자산 없음.'] });
    const count = k => findings.filter(f => f.kind === k).length;
    return res({
      text: [`연결 소스 ${DISCOVERY_SOURCES.length}종 탐색 완료 (목업 · 읽기 전용) — 신규 ${count('신규')} · 보완 ${count('보완')} · 변경 ${count('변경')} · 일치 확인 ${count('확인')}.`,
        '아래 근거 확인 후 승인 시 자산에 반영하고 즉시 재평가함.'],
      discovery: findings, action: { type: 'apply-discovery', findings, label: `승인 — ${findings.length}건 반영` },
    });
  }

  if (has(/(자산|장비|서버).*(등록|추가)|(등록|추가)\s*[:：]/) && !has(/업무|조치/)) {
    const body = text.includes(':') || text.includes('：') ? text.split(/[:：]/).slice(1).join(':') : text.replace(/자산|등록|추가|해줘|해 줘/g, ' ');
    const parsed = call('parse_assets', `"${body.trim()}"`, () => parseAssets(body), r => `${r.length}건 인식`);
    const valid = parsed.filter(p => p.asset.product);
    if (!valid.length) return res({ text: ['제품을 인식하지 못함. 예: "자산 등록: 영업팀 파일 서버 톰캣 9.0.90 외부 공개"', `인식 가능 제품: ${PRODUCT_ALIASES.map(p => p[0]).join(', ')}`] });
    return res({
      text: [`자산 ${valid.length}건 인식. 아래 내용 확인 후 승인 시 등록하고 즉시 위협 매칭함.`, ...valid.flatMap(p => p.warnings.map(w => `· ${p.asset.name}: ${w}`))],
      previewRows: valid, action: { type: 'register-assets', assets: valid.map(p => p.asset), label: `승인 — 자산 ${valid.length}건 등록` },
    });
  }

  const list = call('list_assessments', 'status=all', allAssessments, r => `${r.length}건`);
  const active = list.filter(a => a.status === 'active');

  if (has(/고객사/)) {
    const stats = call('list_tenants', '', statTenants, r => `${r.length}곳`);
    const hot = stats.filter(s => s.urgent > 0);
    return res({
      text: [`담당 고객사 ${stats.length}곳 중 긴급 위협(버전 미확인 잠재 위험 포함) 보유 ${hot.length}곳.`, ...stats.map(s => `· ${s.name}(${s.industry}, ${s.plan}): 대응 필요 ${s.active}건, 긴급 ${s.urgent}건, KEV 연관 ${s.kev}건`)],
      chart: { kind: 'bar', title: '고객사별 대응 필요 위협', unit: '건', rows: stats.map(s => ({ label: s.name, value: s.active, fill: SERIES[0], title: `${s.name}: 대응 필요 ${s.active}건 · 긴급 ${s.urgent}건` })) },
      link: { href: '#tenants', label: '고객사 현황 열기' },
    });
  }
  if (has(/분포|등급별|비율/)) {
    const chart = call('aggregate_stats', 'metric=priority_distribution', () => statDistribution(list), r => `${r.rows.length}개 구간`);
    const v = Object.fromEntries(chart.rows.map(r => [r.label, r.value]));
    return res({ text: [`대응 필요 ${active.length}건 — 긴급 ${v['긴급']} · 높음 ${v['높음']} · 보통 ${v['보통']} · 낮음 ${v['낮음']}. 조치 완료 ${v['조치 완료']}건, 영향 없음·오탐 ${v['영향 없음·오탐']}건.`], chart });
  }
  if (has(/유형별/)) {
    const chart = call('aggregate_stats', 'metric=by_asset_type', () => statByType(list), r => `${r.rows.length}개 유형`);
    return res({ text: [chart.rows.length ? `대응 필요 위협이 가장 많은 자산 유형은 '${chart.rows[0].label}'(${chart.rows[0].value}건). 막대에 마우스를 올리면 평균 점수 확인 가능.` : '대응 필요 위협 없음.'], chart });
  }
  if (has(/추이|트렌드|주간|지난/)) {
    const chart = call('aggregate_stats', 'metric=weekly_trend', statTrend, r => `${r.labels.length}주`);
    const s = chart.series[0].values;
    return res({ text: [`최근 ${s.length}주 대응 필요 위협 ${s[0]}건 → ${s[s.length - 1]}건. 이전 주차는 목업 값이며 마지막 주차만 현재 데이터.`], chart });
  }
  if (has(/히트맵|매트릭스|한눈에/)) {
    const chart = call('aggregate_stats', 'metric=asset_vuln_matrix', () => statHeatmap(list), r => `${r.rows.length}×${r.cols.length}`);
    return res({ text: [`제품이 일치한 자산 ${chart.rows.length}개 × 취약점 ${chart.cols.length}개 매트릭스. 칸을 누르면 상세 분석으로 이동.`], chart });
  }

  const targets = call('match_entities', `"${text}"`, () => findTargets(text, list), r => `${r.length}건 일치`);

  if (has(/(업무|조치).*(생성|만들|등록)/)) {
    const a = targets.find(x => x.status === 'active') || (targets.length ? null : active[0]);
    if (!a) return res({ text: ['대응 필요 상태인 대상 항목이 없음.'] });
    const drafts = call('draft_tasks', a.key, () => taskTemplates(a), r => `초안 ${r.length}건`);
    const action = taskAction(a);
    return res({
      text: [
        ...(targets.length ? [] : ['대상 미지정 — 최우선 항목 기준으로 작성.']),
        `${a.asset.name} × ${a.vuln.id} 조치 업무 초안 ${drafts.length}건:`,
        ...drafts.map((d, i) => `${i + 1}. ${d.title}`),
        action ? '승인 시 조치 업무로 등록함. 시스템 변경은 자동 실행하지 않음.' : '이미 조치 업무가 등록된 항목임.',
      ],
      items: [a], refs: refsOf([a]), action,
    });
  }

  if (has(/왜|이유|근거|설명|어째서/) && targets.length) {
    const a = targets[0];
    const lines = call('get_assessment', a.key, () => explain(a), r => `설명 ${r.length}문단`);
    if (a.advisory) call('screen_external_text', `source=공급업체 ${a.vuln.id}`, () => a.advisory, r => `지시성 문장 ${r.flagged.length}건 — 데이터로만 처리`);
    // 질의 전제(예: "왜 긴급?")가 실제 판정과 다르면 먼저 정정
    const asked = PRIORITY_LEVELS.map(l => l.label).find(l => text.includes(l));
    const correction = asked && asked !== a.priority
      ? [`정정: 현재 판정은 '${asked}'이 아닌 '${a.label}'${a.status === 'active' ? `(${a.score}점)` : ''}임.`] : [];
    return res({ text: [...correction, ...lines.map(l => `[${l.tag}] ${l.text}`)], items: [a], refs: refsOf([a]), action: taskAction(a) });
  }

  if (has(/kev|악용/i)) {
    const items = active.filter(a => a.vuln.kev);
    return res({ text: [`실제 악용이 확인된(CISA KEV) 취약점과 연관된 대응 필요 항목 ${items.length}건.`, 'KEV 등재는 실제 공격 정황이므로 외부 노출 자산부터 확인 권장.'], items, refs: ['KEV'] });
  }

  if (has(/버전|확인 필요|불확실|미확인|신뢰도/)) {
    const items = active.filter(a => a.confidence !== '높음');
    return res({
      text: [`판단 신뢰도가 낮거나 중간인 항목 ${items.length}건. 아래 정보 보완 시 판단이 확정됨.`,
        ...items.map(a => `· ${a.asset.name}: ${a.checks.filter(c => !c.startsWith('공급업체')).join(', ')}`)],
      items,
    });
  }

  if (targets.length) {
    const count = s => targets.filter(a => a.status === s).length;
    const top = targets[0];
    return res({
      text: [`관련 평가 ${targets.length}건 (대응 필요 ${count('active')} · 조치 완료 ${count('resolved')} · 영향 없음 ${count('excluded')}).`,
        top.status === 'active' ? `최우선: ${top.asset.name} × ${top.vuln.id} — ${top.label}(${top.score}점), ${reasonShort(top)}.` : '현재 대응이 필요한 항목 없음.'],
      items: targets, refs: refsOf(targets.filter(a => a.status === 'active')),
    });
  }

  if (has(/급|우선|긴급|먼저|위험|중요/)) {
    const items = active.slice(0, 3);
    return res({
      text: [`대응 필요 ${active.length}건 중 우선순위 상위 ${items.length}건.`,
        ...items.map(a => `· ${a.asset.name} × ${a.vuln.id} — ${a.label}(${a.score}점): ${reasonShort(a)}`),
        '점수는 규칙 엔진 결과이며, 항목을 누르면 상세 근거 확인 가능.'],
      items, refs: refsOf(items),
    });
  }

  if (has(/자산/)) {
    const assets = call('get_assets', '', () => state.assets, r => `${r.length}건`);
    const by = (k, v) => assets.filter(a => a[k] === v).length;
    return res({ text: [`등록 자산 ${assets.length}건 — 중요도 상 ${by('criticality', '상')} · 중 ${by('criticality', '중')} · 하 ${by('criticality', '하')}, 외부 노출 ${by('exposure', '예')}건, 노출 미확인 ${by('exposure', '미확인')}건, 버전 미등록 ${assets.filter(a => !a.version).length}건.`], link: { href: '#assets', label: '자산 관리 열기' } });
  }

  return res({ text: ['질의 의도를 파악하지 못함. 지원 질의 예시:', ...AGENT_EXAMPLES.map(q => `· ${q}`), '· "CVE-2026-41003 설명해줘", "KEV 연관 항목", "자산 유형별 분석", "히트맵 보여줘", "ERP DB 서버 조치 업무 만들어줘"'] });
}

// 능동 브리핑: 위협 갱신·자동 탐색 후 질의 없이 판단 변경을 요약하고 신규 긴급 항목의 조치 업무 초안 제시
function agentBriefing(reason, s) {
  if (!s.changes.length && !s.closed.length) return null;
  const tools = [{ name: 'diff_assessments', args: `reason="${reason}"`, result: `판단 변경 ${s.changes.length}건` }];
  const urgent = s.newlyUrgent.filter(a => a.status === 'active' && !state.tasks.some(t => t.key === a.key));
  urgent.forEach(a => tools.push({ name: 'draft_tasks', args: a.key, result: `초안 ${taskTemplates(a).length}건` }));
  const pending = state.assets.filter(a => !a.version || a.exposure === '미확인' || a.patch === '확인 필요');
  return {
    text: [
      `${reason} — 판단 변경 ${s.changes.length}건.`,
      ...s.changes.slice(0, 5).map(c => `· ${c.name}: ${c.from} → ${c.to}`),
      ...(s.changes.length > 5 ? [`· 외 ${s.changes.length - 5}건은 이력에서 확인`] : []),
      ...(urgent.length ? [`신규 긴급 ${urgent.length}건 — 조치 업무 초안 작성 완료. 승인 시 등록함.`] : []),
      ...(s.closed.length ? [`대응 불필요로 바뀐 항목의 열린 조치 업무 ${s.closed.length}건 자동 종결.`] : []),
      ...(pending.length ? [`미확인 정보가 남은 자산 ${pending.length}건 — "미확인 정보 채워줘"로 자동 확인 가능.`] : []),
    ],
    items: urgent, refs: [], chart: null, previewRows: null, citation: null, tools, proactive: true,
    action: urgent.length ? { type: 'create-tasks', keys: urgent.map(a => a.key), label: `승인 — 조치 업무 생성 (${urgent.length}건)` } : null,
    link: s.closed.length ? { href: '#tasks', label: '조치 업무 열기' } : null,
  };
}
