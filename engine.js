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

// 국산 SW 공지(CVSS 미부여)의 위험도 등급을 심각도 점수로 환산하는 규칙표
const KR_SEVERITY = { 긴급: 9.0, 높음: 7.5, 보통: 5.0, 낮음: 3.0 };
const cvssText = v => (v.kr ? `공지 위험도 ${v.kr.severity}` : `CVSS ${v.cvss.toFixed(1)}`);

function getSources(v) {
  if (v.kr) {
    return [{ ref: v.kr.ref, name: v.kr.source, url: v.vendorUrl, collectedAt: v.updatedAt,
      fact: `공지 위험도 ${v.kr.severity} (CVSS 미부여 — 규칙표로 ${v.cvss.toFixed(1)} 환산), 영향 버전 ${rangeText(v)}, ${v.affected.fixed}에서 해결. 완화 조치: ${v.mitigation}` }];
  }
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
    { name: '기술적 심각도', value: v.kr ? `${cvssText(v)} (환산 ${v.cvss.toFixed(1)})` : cvssText(v), points: v.cvss >= 9 ? 30 : v.cvss >= 7 ? 22 : v.cvss >= 4 ? 12 : 5, ref: v.kr ? v.kr.ref : 'NVD' },
    { name: '실제 악용 여부', value: v.kev ? 'KEV 등재' : 'KEV 미등재', points: v.kev ? 25 : 0, ref: 'KEV' },
    // EPSS 미제공(국산 SW)은 노출 미확인과 같은 중간값 처리
    v.epss == null
      ? { name: '악용 가능성 추정', value: 'EPSS 없음', points: 8, ref: '-' }
      : { name: '악용 가능성 추정', value: `EPSS ${v.epss.toFixed(2)}`, points: v.epss >= 0.5 ? 15 : v.epss >= 0.1 ? 8 : 2, ref: 'EPSS' },
    { name: '자산 중요도', value: asset.criticality, points: { 상: 15, 중: 8, 하: 2 }[asset.criticality] ?? 8, ref: '등록 자산' },
    { name: '외부 노출', value: asset.exposure, points: { 예: 15, 미확인: 8, 아니오: 0 }[asset.exposure] ?? 8, ref: '등록 자산' },
  ];
  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  const level = PRIORITY_LEVELS.find(l => score >= l.min);
  const versionUnknown = match.status === 'potential';

  // 위험도와 별도로 판단 신뢰도 산정: 누락 정보가 많을수록 낮음
  const missing = (versionUnknown ? 2 : 0) + (asset.exposure === '미확인' ? 1 : 0) + (asset.patch === '확인 필요' ? 1 : 0) + (v.kr ? 1 : 0);
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
  if (v.kr) { uncertainties.push('국내 공지에서 추출한 미검증 위협 정보 — CVE·EPSS 없음'); checks.push('공지 원문에서 영향 버전·해결 버전 재확인'); }
  if (status !== 'excluded') {
    if (!v.kr) uncertainties.push('EPSS는 확률적 추정치이며 실제 악용 여부를 의미하지 않음');
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
  const text = ADVISORY_TEXTS[v.id] || v.kr?.raw;
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
  lines.push(v.kr ? {
    tag: '사실',
    text: `${v.kr.source} 기준 위험도 '${v.kr.severity}'이며 CVE·CVSS는 부여되지 않았다 [${v.kr.ref}]. ${v.affected.fixed}에서 해결되었다 [${v.kr.ref}].`,
  } : {
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

// 영향 조건 확인(LLM 해석 목업): 사용자가 붙여 넣은 읽기 전용 명령 출력을 규칙으로 해석, 근거 없으면 단정하지 않음
function interpretCheck(spec, output) {
  const text = String(output || '').trim();
  if (!text) return null;
  const hit = spec.rules.find(r => r.re.test(text));
  return hit ? { verdict: hit.verdict, reason: hit.reason } : { verdict: '판단 불가', reason: '출력에서 조건 판단 근거를 찾지 못함 — 담당자 직접 확인 필요' };
}

// 외주 업체 요청 메일 초안(LLM 문장 작성 목업) — 기한은 우선순위별 규칙
const DUE_DAYS = { 긴급: 3, 높음: 7, 보통: 30, 낮음: 30 };
const vendorName = asset => (/업체|벤더/.test(asset.maintainer || '') ? asset.maintainer.replace(/^(유지보수 업체|벤더):\s*/, '') : '유지보수 업체(미등록)');

function vendorRequestDraft(a, due) {
  const { asset, vuln: v } = a;
  const to = vendorName(asset);
  return {
    to, subject: `[보안 패치 요청] ${asset.name} — ${v.id}`,
    body: [
      `${to} 담당자님께`,
      `${asset.name}(${asset.product} ${asset.version || '버전 확인 필요'})에서 보안 취약점 ${v.id}(${v.title})이 확인되어 패치 작업을 요청드립니다.`,
      `· 해결 버전: ${v.affected.fixed} 이상`,
      `· 패치 전 임시 조치: ${v.mitigation}`,
      `· 우선순위: ${a.priority} — ${due}까지 작업 일정 회신 요청`,
      `· 근거 출처: ${a.facts.map(f => f.ref).join(', ')}`,
      '작업 일정과 담당자를 회신해 주시면 조치 업무에 반영하겠습니다.',
    ],
  };
}

// 업체 회신 해석(LLM 추출 목업): 작업 날짜·시각·작업자와 근거 문장
const WEEKDAYS = '일월화수목금토';
function parseVendorReply(text, base) {
  const t = String(text || '');
  let date = null, m;
  if ((m = t.match(/\d{4}-\d{2}-\d{2}/))) date = m[0];
  else if ((m = t.match(/(\d{1,2})월\s*(\d{1,2})일/))) date = `${base.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  else if ((m = t.match(/(다음|이번)\s*주\s*([일월화수목금토])요일/))) {
    const cur = new Date(`${base}T00:00:00`).getDay();
    const toMonday = m[1] === '다음' ? ((8 - cur) % 7 || 7) : -((cur + 6) % 7);
    date = addDays(base, toMonday + (WEEKDAYS.indexOf(m[2]) + 6) % 7);
  } else if ((m = t.match(/내일|모레/))) date = addDays(base, m[0] === '내일' ? 1 : 2);
  const time = (t.match(/(\d{1,2})시/) || [])[1];
  const w = t.match(/담당(?:자)?\s*[:：]?\s*([가-힣]{2,4})\s*(기사|과장|대리|팀장|책임|선임|엔지니어)?/);
  const quote = m ? t.split(/(?<=[.!?])\s+/).find(s => s.includes(m[0])) : null;
  return { date, time: time ? `${time.padStart(2, '0')}:00` : null, worker: w ? `${w[1]}${w[2] ? ` ${w[2]}` : ''}` : null, quote };
}

// 증빙 기반 조치 종결: 증빙 속 버전을 해결 버전과 비교 (규칙 판정)
const VERSION_CMD = {
  'Apache HTTP Server': 'httpd -v', FortiOS: 'get system status', Jenkins: 'java -jar jenkins-cli.jar version', MySQL: 'mysql --version',
  nginx: 'nginx -v', OpenSSH: 'ssh -V', WordPress: 'wp core version', 'Apache Tomcat': 'version.sh',
  React: 'npm ls react',
};
function fixedVersionOf(product, vulns) {
  const fixed = vulns.filter(v => norm(v.product) === norm(product)).map(v => v.affected.fixed);
  return fixed.length ? fixed.sort(compareVersion).pop() : null;
}
function evidenceVerdict(text, product, vulns) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, label: '증빙 없음', detail: '증빙 입력 필요 — 증빙 없이 종결 불가' };
  const fixed = fixedVersionOf(product, vulns);
  const found = t.match(/\d+(?:\.\d+)+/g) || [];
  if (!found.length || !fixed) return { ok: true, label: '담당자 확인', detail: '증빙에서 버전을 확인하지 못함 — 설정 변경 등 담당자 확인으로 기록' };
  const ver = found[found.length - 1];
  return compareVersion(ver, fixed) >= 0
    ? { ok: true, label: '해결 버전 확인', detail: `증빙 버전 ${ver} ≥ 해결 버전 ${fixed}` }
    : { ok: false, label: '해결 버전 미만', detail: `증빙 버전 ${ver} < 해결 버전 ${fixed} — 패치 미완료로 판단, 반영 불가` };
}
