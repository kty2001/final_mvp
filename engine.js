// 규칙 기반 매칭·위험도 평가, 근거 기반 설명 생성(LLM 대체 템플릿)

const PRIORITY_LEVELS = [
  { min: 85, label: '긴급', cls: 'p-urgent' },
  { min: 65, label: '높음', cls: 'p-high' },
  { min: 40, label: '보통', cls: 'p-medium' },
  { min: 0, label: '낮음', cls: 'p-low' },
];

function parseVersion(v) {
  return String(v).trim().split('.').map(n => parseInt(n, 10) || 0);
}

function compareVersion(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const norm = s => String(s || '').trim().toLowerCase();
const rangeText = v => `${v.affected.from} 이상 ${v.affected.fixed} 미만`;
const severity = c => (c >= 9 ? 'CRITICAL' : c >= 7 ? 'HIGH' : c >= 4 ? 'MEDIUM' : 'LOW');

function getSources(v) {
  const list = [
    { ref: 'NVD', name: 'NVD / CVE', url: 'https://nvd.nist.gov/', fact: `CVSS ${v.cvss.toFixed(1)} (${severity(v.cvss)}) — ${v.summary}` },
  ];
  if (v.kev) list.push({ ref: 'KEV', name: 'CISA KEV', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', fact: `실제 악용 확인 취약점으로 등재 (${v.kevDate})` });
  list.push({ ref: 'EPSS', name: 'FIRST EPSS', url: 'https://www.first.org/epss/', fact: `향후 30일 내 악용 확률 추정치 ${v.epss.toFixed(2)}` });
  list.push({ ref: '공급업체', name: `${v.product} 보안 권고문`, url: v.vendorUrl, fact: `영향 버전 ${rangeText(v)}, ${v.affected.fixed}에서 해결. 완화 조치: ${v.mitigation}` });
  if (v.kisa) list.push({ ref: 'KISA', name: 'KISA 보호나라', url: 'https://www.boho.or.kr/', fact: v.kisa });
  list.push({ ref: 'ATT&CK', name: `MITRE ATT&CK ${v.attack.id}`, url: `https://attack.mitre.org/techniques/${v.attack.id.replace('.', '/')}/`, fact: `관련 공격 기법: ${v.attack.name}` });
  return list.map(s => ({ ...s, collectedAt: v.updatedAt }));
}

function matchAsset(asset, v) {
  if (norm(asset.product) !== norm(v.product)) return null;
  if (!asset.version) {
    return { status: 'potential', text: `등록 버전 없음 — 영향 범위(${rangeText(v)}) 포함 여부 미확인` };
  }
  const inRange = compareVersion(asset.version, v.affected.from) >= 0 && compareVersion(asset.version, v.affected.fixed) < 0;
  return inRange
    ? { status: 'match', text: `등록 버전 ${asset.version} — 영향 범위(${rangeText(v)})에 포함` }
    : { status: 'excluded', text: `등록 버전 ${asset.version} — 영향 범위(${rangeText(v)}) 밖` };
}

function assess(asset, v) {
  const match = matchAsset(asset, v);
  if (!match) return null;

  const factors = [
    { name: '기술적 심각도', value: `CVSS ${v.cvss.toFixed(1)}`, points: v.cvss >= 9 ? 30 : v.cvss >= 7 ? 22 : v.cvss >= 4 ? 12 : 5, ref: 'NVD' },
    { name: '실제 악용 여부', value: v.kev ? 'KEV 등재' : 'KEV 미등재', points: v.kev ? 25 : 0, ref: 'KEV' },
    { name: '악용 가능성 추정', value: `EPSS ${v.epss.toFixed(2)}`, points: v.epss >= 0.5 ? 15 : v.epss >= 0.1 ? 8 : 2, ref: 'EPSS' },
    { name: '자산 중요도', value: asset.criticality, points: { 상: 15, 중: 8, 하: 2 }[asset.criticality] ?? 8, ref: '등록 자산' },
    { name: '외부 노출', value: asset.exposure, points: { 예: 15, 미확인: 8, 아니오: 0 }[asset.exposure] ?? 8, ref: '등록 자산' },
  ];
  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  const level = PRIORITY_LEVELS.find(l => score >= l.min);
  const versionUnknown = match.status === 'potential';

  // 위험도와 별도로 판단 신뢰도 산정: 누락 정보가 많을수록 낮음
  const missing = (versionUnknown ? 2 : 0) + (asset.exposure === '미확인' ? 1 : 0) + (asset.patch === '확인 필요' ? 1 : 0);
  const confidence = missing === 0 ? '높음' : missing === 1 ? '중간' : '낮음';

  let status = 'active', label = level.label, cls = level.cls;
  if (match.status === 'excluded') { status = 'excluded'; label = '영향 없음'; cls = 'p-none'; }
  else if (asset.patch === '적용 완료') { status = 'resolved'; label = '조치 완료'; cls = 'p-done'; }
  else if (versionUnknown) label = score >= 65 ? '잠재적 고위험·추가 확인 필요' : `${level.label}·버전 확인 필요`;

  const conditions = [
    `등록 제품 '${asset.product}' — 취약 제품과 일치`,
    match.text,
    `자산 중요도 ${asset.criticality} · 외부 노출 ${asset.exposure} · 패치 상태 ${asset.patch}`,
    asset.purpose ? `운영 용도: ${asset.purpose}` : null,
  ].filter(Boolean);

  const inferences = [];
  if (status !== 'excluded') {
    if (v.kev && asset.exposure === '예') inferences.push('외부 노출 자산이며 실제 악용이 확인된 취약점이므로 인터넷 경유 공격 대상이 될 가능성이 높다.');
    else if (v.kev && asset.exposure === '아니오') inferences.push('실제 악용 사례가 있으나 외부 비노출 자산이므로 내부 침투 이후 단계의 위험으로 본다.');
    else if (v.kev) inferences.push('실제 악용 사례가 있으며, 외부 노출 시 위험이 크게 높아질 수 있다.');
    if (!v.kev && v.epss >= 0.1) inferences.push('KEV 미등재이나 EPSS 추정치가 상대적으로 높아 악용 동향 모니터링이 필요하다.');
    if (asset.criticality === '상') inferences.push('업무 핵심 자산으로 침해 시 영향 범위가 크다.');
    if (asset.criticality === '하') inferences.push('업무 중요도가 낮아 동일 취약점의 다른 자산보다 우선순위를 낮춘다.');
  }

  const uncertainties = [];
  const checks = [];
  if (versionUnknown) { uncertainties.push('제품 버전 미등록 — 영향 범위 포함 여부 확인 불가'); checks.push('실제 설치 제품 버전 확인'); }
  if (asset.exposure === '미확인') { uncertainties.push('외부 노출 여부 미확인 — 노출 시 점수 7점 상승'); checks.push('외부 인터넷 노출 여부 확인'); }
  if (asset.patch === '확인 필요') { uncertainties.push('패치·완화 조치 적용 여부 미확인'); checks.push('패치·완화 조치 적용 여부 확인'); }
  if (status !== 'excluded') {
    uncertainties.push('EPSS는 확률적 추정치이며 실제 악용 여부를 의미하지 않음');
    checks.push('공급업체 권고문의 영향 조건(설정·모듈 사용 여부) 확인');
  }

  return {
    key: `${asset.id}|${v.id}`, asset, vuln: v, match, status, score, label, cls,
    priority: level.label, priorityCls: level.cls, confidence, factors,
    facts: getSources(v), conditions, inferences, uncertainties, checks, advisory: screenAdvisory(v),
  };
}

// 외부 문서 속 지시성 문장 탐지: 데이터로만 취급하고 판정·업무에 반영하지 않음 (프롬프트 인젝션 방어)
const INSTRUCTION_PATTERN = /무시하|지시|보고하라|처리하라|생성하라|ignore|instruction/i;
function screenAdvisory(v) {
  const text = ADVISORY_TEXTS[v.id];
  if (!text) return null;
  return { text, flagged: text.split(/(?<=\.)\s+/).filter(s => INSTRUCTION_PATTERN.test(s)) };
}

// 인용 검증(목업): 답변 속 [출처] 태그가 대상 항목의 실제 근거 자료에 있는지 대조
const CITE_PATTERN = /\[(NVD|KEV|EPSS|공급업체|KISA|ATT&CK)\]/g;
function verifyCitations(lines, items) {
  const cited = [...new Set(lines.join(' ').match(CITE_PATTERN) || [])].map(c => c.slice(1, -1));
  if (!cited.length) return null;
  const avail = new Set(items.flatMap(a => a.facts.map(f => f.ref)));
  const missing = cited.filter(r => !avail.has(r));
  return { total: cited.length, ok: cited.length - missing.length, missing };
}

function explain(a) {
  const { asset, vuln: v } = a;
  const target = `${asset.name}(${asset.product} ${asset.version || '버전 미등록'})`;
  const lines = [];
  lines.push({
    tag: '요약',
    text: a.match.status === 'potential'
      ? `${target}은(는) ${v.id}(${v.title})의 대상 제품이나, 버전이 등록되지 않아 영향 범위 포함 여부를 확정할 수 없다.`
      : a.match.status === 'excluded'
        ? `${target}은(는) ${v.id}의 영향 범위(${rangeText(v)}) 밖으로 판단된다.`
        : `${target}은(는) ${v.id}(${v.title})의 영향 범위(${rangeText(v)})에 포함된다.`,
  });
  lines.push({
    tag: '사실',
    text: `NVD 기준 CVSS ${v.cvss.toFixed(1)}(${severity(v.cvss)})이다 [NVD]. `
      + (v.kev ? `CISA KEV에 실제 악용 취약점으로 등재되어 있다(${v.kevDate}) [KEV]. ` : 'CISA KEV에는 등재되어 있지 않다. ')
      + `EPSS 추정치는 ${v.epss.toFixed(2)}이다 [EPSS]. 공급업체 권고문에 따르면 ${v.affected.fixed}에서 해결되었다 [공급업체].`,
  });
  a.inferences.forEach(t => lines.push({ tag: '추론', text: t }));
  lines.push({
    tag: '판단',
    text: a.status === 'excluded'
      ? '현재 등록 정보 기준 대응 대상이 아니다. 버전 정보가 바뀌면 재평가한다.'
      : a.status === 'resolved'
        ? `패치 적용 완료로 등록되어 조치 완료로 분류한다. 참고용 위험 점수는 ${a.score}점이다.`
        : `규칙 기반 점수 ${a.score}점으로 '${a.label}' 대응을 권장한다. 판단 신뢰도는 ${a.confidence}이다.`,
  });
  if (a.uncertainties.length) lines.push({ tag: '주의', text: a.uncertainties.join(' / ') });
  if (a.advisory?.flagged.length) lines.push({ tag: '주의', text: `공급업체 권고문 원문에 지시성 문장 ${a.advisory.flagged.length}건 포함 — 외부 문서는 데이터로만 취급하며 판정·조치에 반영하지 않음.` });
  return lines;
}

function taskTemplates(a) {
  const { asset, vuln: v } = a;
  const t = [];
  t.push({ title: asset.version ? `제품 버전 재확인 (등록값 ${asset.version})` : '실제 설치 제품 버전 확인', reason: a.match.text, refs: ['공급업체'] });
  t.push({ title: `공급업체 권고문에서 영향 범위·해결 버전(${v.affected.fixed}) 확인`, reason: '영향 조건과 해결 버전을 원문 기준으로 확정', refs: ['공급업체', 'NVD'] });
  if (asset.exposure === '미확인') t.push({ title: '외부 인터넷 노출 여부 점검', reason: '노출 여부에 따라 우선순위 변동', refs: ['등록 자산'] });
  if (asset.exposure === '예') t.push({ title: `임시 완화 조치 검토 (${v.mitigation})`, reason: '외부 노출 자산 — 패치 전 공격 표면 축소', refs: ['공급업체'] });
  if (v.kev) t.push({ title: '접근 로그·침해 정황 점검', reason: '실제 악용이 확인된 취약점', refs: ['KEV'] });
  t.push({ title: `패치 가능 여부 및 적용 일정 검토 (${v.affected.fixed} 이상)`, reason: '근본 조치', refs: ['공급업체'] });
  t.push({ title: '패치 전 백업 및 서비스 영향 확인', reason: '운영 영향 최소화 — 담당자 검토·승인 후 진행', refs: ['등록 자산'] });
  return t;
}
