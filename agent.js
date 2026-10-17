// 목업 대화형 분석 에이전트: 키워드로 의도를 분류하고 기존 평가 함수를 도구로 호출함
// 위험 점수는 규칙 엔진(engine.js) 결과를 그대로 사용, 상태 변경은 사용자 승인 후 실행

const AGENT_EXAMPLES = ['지금 제일 급한 거 뭐야?', 'VPN 관련 위협 정리해줘', 'Jenkins 건은 왜 긴급이야?', '버전 확인 필요한 자산 알려줘', '이번 주 경영진 보고서 만들어줘'];
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
  const res = o => ({ text: [], items: [], refs: [], action: null, link: null, ...o, tools });
  const refsOf = items => [...new Set(items.flatMap(a => a.facts.map(f => f.ref)))];
  const has = re => re.test(text);
  const taskAction = a => (a.status === 'active' && !state.tasks.some(t => t.key === a.key)
    ? { type: 'create-tasks', key: a.key, label: '승인 — 조치 업무 생성' } : null);

  if (has(/보고서|리포트|report/i)) {
    const type = has(/이행|감사|증적|조치 현황/) ? 'compliance' : has(/상세|실무/) ? 'detail' : 'exec';
    const r = call('generate_report', `type=${type}`, () => buildReport(type), x => `${x.title}, 섹션 ${x.sections.length}개`);
    return res({ text: [`'${r.title}' 생성 완료.`, r.summary], link: { href: `#report/${type}`, label: '리포트 열기' } });
  }

  const list = call('list_assessments', 'status=all', allAssessments, r => `${r.length}건`);
  const active = list.filter(a => a.status === 'active');
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

  return res({ text: ['질의 의도를 파악하지 못함. 지원 질의 예시:', ...AGENT_EXAMPLES.map(q => `· ${q}`), '· "CVE-2026-41003 설명해줘", "KEV 연관 항목", "ERP DB 서버 조치 업무 만들어줘"'] });
}
