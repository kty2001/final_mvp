// 자산 일괄 등록: 자연어 문장·CSV를 자산 필드로 변환 (사용자 확인 후 등록)

// 순서 중요: 'apache tomcat'이 'apache'보다 먼저 검사되어야 함
const PRODUCT_ALIASES = [
  ['Apache Tomcat', ['apache tomcat', 'tomcat', '톰캣']],
  ['Apache HTTP Server', ['apache http server', 'apache httpd', 'httpd', 'apache', '아파치']],
  ['FortiOS', ['fortios', 'fortigate', '포티게이트', 'fortinet', '포티넷']],
  ['Jenkins', ['jenkins', '젠킨스']],
  ['nginx', ['nginx', '엔진엑스']],
  ['MySQL', ['mysql', '마이에스큐엘']],
  ['WordPress', ['wordpress', '워드프레스']],
  ['OpenSSH', ['openssh', 'ssh']],
];

const CSV_HEADERS = {
  자산명: 'name', 제품: 'product', 제품명: 'product', 버전: 'version', 유형: 'type', 중요도: 'criticality',
  외부노출: 'exposure', '외부 노출': 'exposure', 용도: 'purpose', 패치: 'patch', 패치상태: 'patch', '패치 상태': 'patch', 담당자: 'owner',
};

const INTAKE_SAMPLES = {
  text: '영업팀 파일 서버 톰캣 9.0.90 외부 공개\n본사 방화벽 포티게이트 7.2.5 핵심 인터넷 노출\n개발 테스트 젠킨스 2.460 내부망\n홈페이지 워드프레스 외부 공개',
  csv: '자산명,제품,버전,중요도,외부노출,담당자\n결제 API 서버,Apache HTTP Server,2.4.62,상,예,인프라 담당\n사내 메일 프록시,nginx,1.25.3,중,아니오,인프라 담당\n재고 DB,MySQL,,상,미확인,DB 담당',
};

function findProduct(text) {
  const q = text.toLowerCase();
  for (const [product, aliases] of PRODUCT_ALIASES) {
    for (const alias of aliases) {
      const index = q.indexOf(alias);
      if (index >= 0) return { product, index };
    }
  }
  return null;
}

function inferType(text) {
  if (/DB|데이터베이스/i.test(text)) return 'DB';
  if (/VPN|방화벽|게이트웨이|라우터/i.test(text)) return '네트워크 장비';
  if (/위키|홈페이지|사이트|쇼핑몰/.test(text)) return '웹 애플리케이션';
  return '서버';
}

const OWNER_BY_TYPE = { DB: 'DB 담당', '웹 애플리케이션': '웹 담당' };
const inferOwner = type => OWNER_BY_TYPE[type] || '인프라 담당';

function normExposure(v) {
  if (/^(예|y|yes|o|true|외부|공개)$/i.test(v)) return '예';
  if (/^(아니오|아니요|n|no|x|false|내부)$/i.test(v)) return '아니오';
  return '미확인';
}

function intakeWarnings(a, recognized) {
  const w = [];
  if (!recognized) w.push('지원 목록에 없는 제품 — 현재 위협 데이터와 매칭되지 않음');
  if (!a.version) w.push('버전 없음 — "추가 확인 필요"로 평가');
  if (a.exposure === '미확인') w.push('외부 노출 미확인');
  if (a.patch === '확인 필요') w.push('패치 상태 미확인');
  return w;
}

function parseLine(line) {
  const found = findProduct(line);
  const name = (found ? line.slice(0, found.index) : '').replace(/[,·:\-\s]+$/, '').trim();
  const asset = {
    name: name || (found ? `${found.product} 자산` : line.slice(0, 20)),
    product: found ? found.product : '',
    version: (line.match(/\d+(?:\.\d+)+/) || [''])[0],
    type: inferType(line),
    criticality: /핵심|중요|결제|고객/.test(line) ? '상' : /테스트|개발|임시/.test(line) ? '하' : '중',
    exposure: /외부|공개|인터넷|노출/.test(line) && !/내부망|비공개|미노출/.test(line) ? '예' : /내부|사내망|비공개|폐쇄/.test(line) ? '아니오' : '미확인',
    purpose: '',
    patch: /패치 완료|패치됨|최신/.test(line) ? '적용 완료' : /미적용|패치 안/.test(line) ? '미적용' : '확인 필요',
    owner: inferOwner(inferType(line)),
  };
  return { asset, warnings: intakeWarnings(asset, !!found) };
}

function parseCsv(lines) {
  const fields = lines[0].split(',').map(h => CSV_HEADERS[h.trim()] || null);
  return lines.slice(1).map(line => {
    const raw = {};
    line.split(',').forEach((v, i) => { if (fields[i]) raw[fields[i]] = v.trim(); });
    const found = findProduct(raw.product || '');
    const type = ['서버', '네트워크 장비', 'DB', '웹 애플리케이션', '기타'].includes(raw.type) ? raw.type : inferType(`${raw.name} ${raw.product}`);
    const asset = {
      name: raw.name || `${raw.product || '미상'} 자산`,
      product: found ? found.product : raw.product || '',
      version: raw.version || '',
      type,
      criticality: ['상', '중', '하'].includes(raw.criticality) ? raw.criticality : '중',
      exposure: normExposure(raw.exposure || ''),
      purpose: raw.purpose || '',
      patch: ['미적용', '적용 완료', '확인 필요'].includes(raw.patch) ? raw.patch : '확인 필요',
      owner: raw.owner || inferOwner(type),
    };
    return { asset, warnings: intakeWarnings(asset, !!found) };
  });
}

function parseAssets(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const isCsv = lines[0].includes(',') && lines[0].split(',').some(h => CSV_HEADERS[h.trim()] === 'product');
  return isCsv ? parseCsv(lines) : lines.map(parseLine);
}
