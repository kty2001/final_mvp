// 자동 자산 탐색(목업): 연결 소스의 관측값을 등록 자산과 대조해 신규·보완·변경·확인으로 분류
// 실제 접속 없음 — DISCOVERY_RESULTS(data.js)를 도구 결과로 사용, 반영은 사용자 승인 후 실행

const DISCOVERY_SOURCES = [
  { id: 'external', name: '외부 노출 점검', tool: 'scan_external', scope: '도메인·공인 IP의 포트·서비스 배너 조회 (비침투)' },
  { id: 'server', name: '서버 접속 (읽기 전용)', tool: 'list_packages', scope: '설치 패키지·버전 조회, 변경 권한 없음' },
  { id: 'repo', name: '코드 저장소', tool: 'read_manifests', scope: 'Dockerfile·의존성 파일 조회' },
];
const FIELD_LABELS = { version: '버전', exposure: '외부 노출', patch: '패치 상태' };

// 버전이 영향 범위 안이면 미적용, 해결 버전 이상이면 적용 완료로 확정 (판정 불가 시 null)
function inferPatch(product, version) {
  const vs = VULNS.filter(v => norm(v.product) === norm(product));
  if (!version || !vs.length) return null;
  if (vs.some(v => compareVersion(version, v.affected.from) >= 0 && compareVersion(version, v.affected.fixed) < 0)) return '미적용';
  return vs.some(v => compareVersion(version, v.affected.fixed) >= 0) ? '적용 완료' : null;
}

function runDiscovery(sourceIds, assets, tenantId) {
  const observed = (DISCOVERY_RESULTS[tenantId] || DISCOVERY_RESULTS.default).filter(o => sourceIds.includes(o.source));
  return observed.map(o => {
    const base = { name: o.name, source: DISCOVERY_SOURCES.find(s => s.id === o.source).name, evidence: o.evidence, changes: [] };
    const cur = assets.find(a => a.name === o.name);
    if (!cur) {
      const asset = parseLine(`${o.name} ${o.product} ${o.version || ''}`).asset;
      Object.assign(asset, { name: o.name, product: o.product, version: o.version || '', exposure: o.exposure || asset.exposure });
      asset.patch = inferPatch(asset.product, asset.version) || asset.patch;
      return { ...base, kind: '신규', asset };
    }
    const next = { version: o.version || cur.version, exposure: o.exposure || cur.exposure };
    if (cur.patch === '확인 필요' || next.version !== cur.version) next.patch = inferPatch(cur.product, next.version) || cur.patch;
    const changes = Object.entries(next).filter(([k, v]) => v && v !== (cur[k] || '')).map(([field, to]) => ({ field, from: cur[field] || '', to }));
    const filled = c => !c.from || c.from === '미확인' || c.from === '확인 필요';
    return { ...base, assetId: cur.id, changes, kind: !changes.length ? '확인' : changes.every(filled) ? '보완' : '변경' };
  });
}

function describeFinding(f) {
  if (f.kind === '신규') return `미등록 자산 — ${f.asset.product} ${f.asset.version || '버전 미확인'}, 노출 ${f.asset.exposure}, 패치 ${f.asset.patch}, 담당 ${f.asset.owner}`;
  if (f.kind === '확인') return '등록 정보와 일치';
  return f.changes.map(c => `${FIELD_LABELS[c.field]} ${c.from || '미등록'} → ${c.to}`).join(', ');
}
