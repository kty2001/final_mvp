// 자동 오류 리포팅: 사이트 지표·로그 합성(목업) → 탐지 → 로그 비교 → 런북 → 근거 검증 → 사실 JSON → 알림·보고서 초안
// 팀원 AI SRE(당직동료) 로직 이식 — 근거는 지표·로그·런북, 판정은 규칙, 문장은 템플릿 (LLM 미연동)

const OPS_WIN = 120;   // 1분 간격 120분
const OPS_INJ = 90;    // 오류 주입 시점 (이후 30분을 비교 구간으로 사용)
const FAMILY_TO_FAULT = { cpu: 'cpu', mem: 'mem', disk: 'disk', conn: 'socket', latency: 'delay', traffic: 'loss', error: 'loss' };
// 오류 유형별 지표 계열 가중치 (팀원 분류기 대체 — 규칙 기반 서명 매칭)
const FAULT_SIGNATURES = {
  cpu: { cpu: 1, latency: 0.3 }, mem: { mem: 1 }, disk: { disk: 1, cpu: 0.2 },
  delay: { latency: 1, traffic: -0.5 }, loss: { traffic: 1, latency: 0.5, error: 0.5 }, socket: { conn: 1, cpu: 0.2 },
};
// 오류 유형별 오류 구성요소의 로그율 변화 배수
const OPS_LOG_RATIO = { cpu: 1.8, mem: 1.6, disk: 2.6, delay: 0.55, loss: 0.5, socket: 2.2 };

// 고객사 사이트별 구성요소 (없으면 기본 쇼핑몰 구성요소)
const opsComponents = () => state.site?.components || OPS_SITES[state.id]?.components || OPS_COMPONENTS;
const opsName = id => opsComponents().find(c => c.id === id)?.name || id;
const faultOf = id => OPS_FAULTS.find(f => f.id === id);
const runbookOf = id => OPS_RUNBOOKS.find(r => r.id === id);
const metricLabel = col => { const [c, m] = col.split('_'); return `${opsName(c)} ${OPS_METRICS[m].name}`; };
const opsMean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const opsStd = xs => { const m = opsMean(xs); return Math.sqrt(opsMean(xs.map(x => (x - m) ** 2))); };
const opsTime = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const opsVerified = facts => facts.검증.filter(c => c.판정 === '확인').length;

// 시드 고정 난수 (mulberry32) — 같은 시드면 같은 오류 케이스 재현
function seededRandom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    uniform: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo)),
    normal: (mu, sd) => mu + sd * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
    pick: arr => arr[Math.floor(next() * arr.length)],
  };
}

// 정상 기준선에 오류 주입 (팀원 make_synthetic 이식) — 호출자 지연 전파·무관 구성요소 방해 스파이크·강도/시작 형태 무작위
function makeOpsCase(component, fault, seed) {
  const r = seededRandom(seed);
  const metrics = {};
  opsComponents().forEach(c => Object.entries(OPS_METRICS).forEach(([m, spec]) => {
    const level = spec.base * r.uniform(0.7, 1.3);
    metrics[`${c.id}_${m}`] = Array.from({ length: OPS_WIN }, () => Math.max(0, r.normal(level, level * spec.sd)));
  }));
  const inj = OPS_INJ, nPost = OPS_WIN - inj, onset = r.int(2, 15), strength = r.uniform(1.5, 4.0);
  const ramp = i => Math.min(1, Math.max(0, (i - inj) / onset));
  const step = i => (i >= inj ? 1 : 0);
  const bump = (col, k, useRamp = true) => {
    const x = metrics[col], pre = x.slice(0, inj);
    const s = opsStd(pre) + 1e-6, lvl = opsMean(pre.map(Math.abs)) + s, mag = k * strength * Math.max(s * 3, lvl * 0.3);
    metrics[col] = x.map((v, i) => Math.max(0, v + (useRamp ? ramp(i) : step(i)) * mag + step(i) * r.normal(0, s * 0.5)));
  };
  const col = m => `${component}_${m}`;
  if (fault === 'cpu') { bump(col('cpu'), 3.0); bump(col('latency'), 1.2); }
  else if (fault === 'mem') {
    const x = metrics[col('mem')], base = opsMean(x.slice(0, inj));
    metrics[col('mem')] = x.map((v, i) => v + Math.max(0, (i - inj) / nPost) * strength * (base * 0.6 + 1));
  } else if (fault === 'disk') { bump(col('disk'), 3.0); bump(col('cpu'), 0.6); bump(col('latency'), 0.7); }
  else if (fault === 'delay') bump(col('latency'), 3.0, false);
  else if (fault === 'socket') {
    // 연결 수 증가폭은 기준선 규모에 맞춰 팀원 값(0.2)보다 키움
    const x = metrics[col('conn')], add = Math.max(2, opsMean(x.slice(0, inj)) * 0.8) * strength;
    metrics[col('conn')] = x.map((v, i) => v + ramp(i) * add);
    bump(col('cpu'), 1.0); bump(col('latency'), 0.8);
  } else if (fault === 'loss') { bump(col('latency'), 2.5, false); bump(col('traffic'), -1.2, false); }

  // 호출자에게 지연 전파 — 웹 프론트(진입점)는 더 크게 보이는 경우가 많음
  if (fault !== 'mem') {
    opsComponents().find(c => c.id === component).callers.forEach(caller => {
      bump(`${caller}_latency`, caller === 'web' ? r.uniform(1.0, 2.6) : r.uniform(0.6, 1.6), fault !== 'delay');
      if (caller === 'web' && fault === 'loss') bump('web_error', 1.5, false);
    });
  }

  // 방해 요소: 무관한 구성요소의 일시적 스파이크
  const others = opsComponents().filter(c => c.id !== component);
  for (let n = r.int(1, 3); n > 0; n--) {
    const x = metrics[`${r.pick(others).id}_${r.pick(Object.keys(OPS_METRICS))}`];
    const s = opsStd(x.slice(0, inj)) + 1e-6, a = r.int(inj, OPS_WIN - 6), add = s * r.uniform(3, 8);
    for (let i = a, end = a + r.int(2, 6); i < end; i++) x[i] += add;
  }

  // 로그: 구성요소별 분당 줄 수(전·후)·경고/오류 줄 수·신규 템플릿 집계
  const logs = opsComponents().map(c => {
    const root = c.id === component, pre = r.uniform(30, 80);
    return {
      component: c.id, pre, post: pre * (root ? OPS_LOG_RATIO[fault] * r.uniform(0.75, 1.25) : r.uniform(0.85, 1.15)),
      warnErr: root ? r.int(40, 400) : r.int(0, 5), newTemplates: root ? OPS_LOG_TEMPLATES[fault] : [],
    };
  });
  return { id: `syn-${component}-${fault}-${seed}`, metrics, inj, logs, truth: { component, fault } };
}

// 탐지: 주입 후 30분 vs 이전 구간 z 점수 → 구성요소 순위(전파 보정) → 오류 유형 분류
function detectOps(c) {
  const z = {};
  Object.entries(c.metrics).forEach(([col, x]) => {
    const pre = x.slice(0, c.inj), post = x.slice(c.inj), mu = opsMean(pre);
    const sd = Math.max(opsStd(pre), Math.abs(mu) * 0.05, 1e-6);
    z[col] = { zmax: Math.max(...post.map(v => Math.abs(v - mu) / sd)), zmean: Math.abs(opsMean(post) - mu) / sd };
  });
  const fam = id => Object.fromEntries(Object.keys(OPS_METRICS).map(m => [m, z[`${id}_${m}`].zmean]));
  const raw = Object.fromEntries(opsComponents().map(comp => [comp.id, Math.max(...Object.values(fam(comp.id)))]));
  // 전파 보정: 호출 대상의 이상이 더 크면 자기 지연·오류 지표는 전파 결과로 보고 감쇠 (팀원 lat_minus_callers 대응)
  const scores = opsComponents().map(comp => {
    const f = fam(comp.id);
    const upstream = Math.max(0, ...opsComponents().filter(x => x.callers.includes(comp.id)).map(x => raw[x.id]));
    if (upstream > Math.max(f.latency, f.error)) { f.latency *= 0.3; f.error *= 0.3; }
    return { id: comp.id, value: Math.max(...Object.values(f)) };
  });
  const total = scores.reduce((s, x) => s + x.value, 0) || 1;
  const ranking = scores.map(s => ({ id: s.id, score: s.value / total, z: s.value })).sort((a, b) => b.score - a.score);
  const top = ranking[0].id;
  // 오류 유형: 원인 후보의 지표 계열 z를 최댓값 기준으로 정규화해 서명과 매칭
  const f = fam(top), peak = Math.max(...Object.values(f)) || 1;
  const fault = Object.entries(FAULT_SIGNATURES)
    .map(([id, sig]) => [id, Object.entries(sig).reduce((s, [k, w]) => s + w * (f[k] / peak), 0)])
    .sort((a, b) => b[1] - a[1])[0][0];
  const families = Object.entries(f).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const topMetrics = Object.keys(OPS_METRICS).map(m => ({ metric: `${top}_${m}`, zmax: z[`${top}_${m}`].zmax }))
    .sort((a, b) => b.zmax - a.zmax).slice(0, 4);
  const peakRaw = Math.max(...Object.values(raw));
  const status = Object.fromEntries(opsComponents().map(comp => [comp.id,
    comp.id === top ? '원인 후보' : raw[comp.id] >= peakRaw * 0.5 ? '이상' : raw[comp.id] >= peakRaw * 0.2 ? '주의' : '정상']));
  return { ranking, top, fault, families, topMetrics, status, z };
}

// 로그 조사: 구성요소별 로그율 변화·경고/오류 줄 수·신규 패턴
function investigateOpsLogs(c) {
  return c.logs.map(l => ({ ...l, ratio: (l.post + 1e-3) / (l.pre + 1e-3) }));
}

// 근거 검증: 규칙 기반 4개 주장 판정 (LLM 미사용)
function verifyOps(det, logs) {
  const top = det.ranking[0], second = det.ranking[1], best = det.topMetrics[0];
  const log = logs.find(l => l.component === det.top);
  const fam = det.families.slice(0, 2);
  return [
    { 주장: `${opsName(det.top)}의 핵심 지표가 오류 이후 크게 변함`, 근거: `${metricLabel(best.metric)} 최대 z=${best.zmax.toFixed(1)} (기준 3 이상)`, 판정: best.zmax >= 3 ? '확인' : '근거 부족' },
    { 주장: '1순위가 2순위와 뚜렷이 구분됨', 근거: `점수 ${top.score.toFixed(3)} vs ${opsName(second.id)} ${second.score.toFixed(3)} (차이 기준 0.15)`, 판정: top.score - second.score >= 0.15 ? '확인' : '불확실 — 2순위도 점검' },
    { 주장: `오류 유형(${faultOf(det.fault).name}) 판단이 지표 계열과 일치`, 근거: `변화 큰 계열: ${fam.map(k => OPS_METRICS[k].name).join(', ')}`, 판정: fam.some(k => FAMILY_TO_FAULT[k] === det.fault) ? '확인' : '부분 일치 — 지표 계열과 분류 결과 불일치' },
    { 주장: `${opsName(det.top)}의 로그 패턴이 오류 이후 변함`, 근거: `분당 로그 ${log.pre.toFixed(0)} → ${log.post.toFixed(0)}줄 (×${log.ratio.toFixed(2)}, 기준 1.5 초과 또는 0.67 미만)`, 판정: log.ratio > 1.5 || log.ratio < 0.67 ? '확인' : '근거 부족' },
  ];
}

// 사실 JSON: 보고서·메신저 알림·에이전트 답변의 단일 근거 (팀원 build_facts 키 유지)
function buildOpsFacts(c, det, logs, checks, detectedAt) {
  const log = logs.find(l => l.component === det.top);
  const fault = faultOf(det.fault);
  return {
    케이스: c.id,
    장애_감지_시각: detectedAt,
    원인_후보: det.ranking.slice(0, 3).map(x => ({ 서비스: opsName(x.id), 점수: Number(x.score.toFixed(3)) })),
    추정_장애유형: fault.name,
    근거_지표: det.topMetrics.map(m => ({ 지표: metricLabel(m.metric), 최대z: Number(m.zmax.toFixed(1)) })),
    로그: log.warnErr ? { 경고에러_줄수: log.warnErr, 새_로그_예시: log.newTemplates.slice(0, 5) } : '없음',
    검증: checks,
    참고_런북: [fault.runbook, 'RB-REPORT'].map(id => { const rb = runbookOf(id); return { id, 제목: rb.title, 본문: `증상: ${rb.symptom} / 즉시 조치: ${rb.action} / 재발 방지: ${rb.prevent}` }; }),
  };
}

// 메신저 알림 문구 (팀원 slack_message 템플릿, 실제 발송은 목업)
function opsMessage(facts, site) {
  const [c1, c2] = facts.원인_후보, ev = facts.근거_지표[0], rb = runbookOf(facts.참고_런북[0].id);
  return [
    `🚨 [오류 감지] ${facts.장애_감지_시각} · ${site}`,
    `• 원인 후보: ${c1.서비스} (점수 ${c1.점수}) — ${facts.추정_장애유형} 추정`,
    `• 2순위 점검: ${c2.서비스} (점수 ${c2.점수})`,
    `• 근거: ${ev.지표} 최대 z=${ev.최대z}`,
    `• 근거 검증: ${opsVerified(facts)}/${facts.검증.length} 확인`,
    `• 권장 1차 조치 (${rb.id}): ${rb.action}`,
    '→ 오류 보고서 초안 작성 완료. 담당자 검토·승인 후 공유 📝',
  ].join('\n');
}

// 근거 지표 z 추이 차트 (10분 평균, 0~60 표시)
function opsChart(c, det) {
  const colors = ['#2a78d6', '#eb6834', '#7a5cc7'];
  const buckets = Array.from({ length: OPS_WIN / 10 }, (_, b) => b * 10);
  const series = det.topMetrics.slice(0, 3).map((m, i) => {
    const x = c.metrics[m.metric], pre = x.slice(0, c.inj), mu = opsMean(pre);
    const sd = Math.max(opsStd(pre), Math.abs(mu) * 0.05, 1e-6);
    return { name: metricLabel(m.metric), color: colors[i], values: buckets.map(b => Math.round(Math.min(60, opsMean(x.slice(b, b + 10).map(v => Math.abs(v - mu) / sd))))) };
  });
  return { kind: 'line', title: '근거 지표 z 점수 추이 (10분 평균, 최대 60)', labels: buckets.map(b => String(b - c.inj)), series, note: '가로축: 오류 주입 시점(0) 기준 분' };
}

// 전체 실행: 케이스 합성 → 탐지 → 로그 → 런북 → 검증 → 사실 → 알림 (단계 로그 포함)
function runOpsAnalysis(component, fault, seed, site, now = Date.now()) {
  const c = makeOpsCase(component, fault, seed);
  const det = detectOps(c);
  const logs = investigateOpsLogs(c);
  const checks = verifyOps(det, logs);
  const detectedAt = opsTime(now), startedAt = opsTime(now - (OPS_WIN - OPS_INJ) * 60000);
  const facts = buildOpsFacts(c, det, logs, checks, detectedAt);
  const log = logs.find(l => l.component === det.top), best = det.topMetrics[0];
  const steps = [
    `[01] 탐지 › 지표 ${Object.keys(c.metrics).length}개 · 주입 후 30분 비교 → 1순위 ${opsName(det.top)} (점수 ${det.ranking[0].score.toFixed(3)})`,
    `[02] 분류 › ${facts.추정_장애유형} 추정 — 변화 큰 계열 ${det.families.slice(0, 2).map(k => OPS_METRICS[k].name).join(', ')}`,
    `[03] 로그 › ${opsName(det.top)} 로그율 ×${log.ratio.toFixed(2)} · 경고·오류 ${log.warnErr}줄 · 신규 패턴 ${log.newTemplates.length}개`,
    `[04] 런북 › ${facts.참고_런북.map(r => `${r.id} ${r.제목}`).join(' + ')}`,
    `[05] 검증 › 근거 ${opsVerified(facts)}/${checks.length} 확인 (${metricLabel(best.metric)} 최대 z=${best.zmax.toFixed(1)})`,
    '[06] 보고 › 메신저 알림·오류 보고서 초안 생성',
  ];
  return {
    site, startedAt, truth: c.truth, facts, steps, message: opsMessage(facts, site), chart: opsChart(c, det),
    det: { top: det.top, fault: det.fault, ranking: det.ranking, status: det.status },
    logs: logs.map(l => ({ component: l.component, pre: Math.round(l.pre), post: Math.round(l.post), ratio: Number(l.ratio.toFixed(2)), warnErr: l.warnErr, newTemplates: l.newTemplates })),
  };
}
