// 국내 제도·운영 기능(목업): 점검 양식 자동 작성, 법정·인증 의무 캘린더, 계약·단종 대장, 대표 결정 요청, 정부 지원사업 매칭
// 판정은 시스템 기록과 규칙으로만 수행 — 근거가 연결되지 않은 항목은 "충족"으로 쓰지 않음

const AUDIT_STATUS_CLS = { 충족: 'p-done', 부분: 'p-medium', 갭: 'p-urgent', '작성 필요': 'p-none' };

// 점검 항목 1건을 시스템 기록(자산·업무·증빙·보고·의무 이행)과 대조
function auditEvidence(rule) {
  const r = (status, answer, evidence = []) => ({ status, answer, evidence });
  if (rule === 'inventory') {
    const n = state.assets.length, noVer = state.assets.filter(a => !a.version).length, auto = state.assets.filter(a => a.verified).length;
    if (!n) return r('갭', '자산 대장 미작성.');
    return r(noVer ? '부분' : '충족', `예 — 서버·네트워크 장비 등 ${n}건을 자산 대장으로 관리${noVer ? ` (버전 미등록 ${noVer}건 보완 중)` : ''}.`,
      [`자산 대장 ${n}건`, auto ? `자동 탐색·점검 결과로 확인 ${auto}건` : null].filter(Boolean));
  }
  if (rule === 'patch') {
    const ev = state.assets.filter(a => a.patchEvidence);
    const done = state.tasks.filter(t => t.status === '완료' && !t.kind).length;
    if (ev.length) return r('충족', `예 — 패치 적용 ${ev.length}건의 증빙과 조치 업무 완료 ${done}건의 이력을 보관 중.`, ev.map(a => `${a.name}: ${a.patchEvidence.verdict} (${a.patchEvidence.at})`));
    if (done) return r('부분', `조치 업무 완료 ${done}건 이력은 있으나 패치 증빙 없음.`, [`조치 업무 완료 ${done}건`]);
    return r('갭', '패치 적용 이력·증빙 없음.');
  }
  if (rule === 'urgent') {
    const urgent = allAssessments().filter(a => a.status === 'active' && a.priority === '긴급');
    const missing = urgent.filter(a => !state.tasks.some(t => t.key === a.key));
    const alerts = state.reportLog.filter(l => l.type === 'alert').length;
    if (!urgent.length) return r('충족', '예 — 현재 미조치 긴급 취약점 없음. 실제 악용 연관 긴급 위협 감지 시 알림 자동 생성.', [`긴급 알림 리포트 ${alerts}건`]);
    if (!missing.length) return r('충족', `예 — 긴급 ${urgent.length}건 모두 조치 업무 등록·진행 중.`, urgent.map(a => `${a.asset.name} × ${a.vuln.id}`));
    return r('부분', `긴급 ${urgent.length}건 중 ${missing.length}건 조치 업무 미등록.`, missing.map(a => `미등록: ${a.asset.name} × ${a.vuln.id}`));
  }
  if (rule === 'exposure') {
    const unk = state.assets.filter(a => a.exposure === '미확인');
    const ext = state.assets.filter(a => a.exposure === '예').length;
    return unk.length
      ? r('부분', `외부 노출 자산 ${ext}건 파악, ${unk.length}건 확인 중.`, unk.map(a => `미확인: ${a.name}`))
      : r('충족', `예 — 외부 노출 자산 ${ext}건 파악 완료.`, [`외부 노출 ${ext}건`]);
  }
  if (rule.startsWith('duty:')) {
    const d = DUTIES.find(x => x.id === rule.slice(5));
    const log = state.dutyLog.filter(l => l.id === d.id);
    return log.length
      ? r('충족', `예 — ${d.title}(${d.cycle}) 수행, 최근 ${log[0].at}.`, log.slice(0, 3).map(l => `이행 기록 ${l.at}`))
      : r('갭', `${d.title} 이행 기록 없음.`);
  }
  if (rule === 'report') {
    const logs = state.reportLog.filter(l => l.type === 'exec');
    const sched = state.schedules.exec.on && planOf().schedule;
    if (logs.length) return r('충족', `예 — 경영진 요약 보고서 ${logs.length}건 발송·보관${sched ? `, ${state.schedules.exec.freq} 정기 발송 설정` : ''}.`, logs.slice(0, 3).map(l => `${l.generatedAt} ${l.trigger}`));
    return sched ? r('부분', `정기 보고 예약(${state.schedules.exec.freq})은 있으나 발송 기록 없음.`, ['정기 보고 예약 설정']) : r('갭', '경영진 보고 기록 없음.');
  }
  return r('작성 필요', '시스템 기록에 근거 없음 — 담당자 직접 작성.');
}

function fillAuditForm(form) {
  return form.items.map(it => ({ ...it, ...auditEvidence(it.rule) }));
}

// 회사 조건에 해당하는 의무만 기한순으로
function applicableDuties(s = state) {
  return DUTIES.filter(d => !d.when || s.profile[d.when])
    .map(d => ({ ...d, due: s.dutyDue[d.id], dday: daysBetween(today(), s.dutyDue[d.id]) }))
    .sort((a, b) => a.dday - b.dday);
}

// 유지보수 계약 만료·단종 임박 자산 (기본 60일 이내, 지난 항목 포함)
function contractAlerts(within = 60) {
  return state.assets.flatMap(a => [
    a.contractEnd && { asset: a, kind: '유지보수 계약 만료', date: a.contractEnd, task: '유지보수 계약 갱신 검토' },
    a.eos && { asset: a, kind: '단종(EoS)', date: a.eos, task: '단종 대비 교체·지원 연장 계획 수립' },
  ].filter(Boolean))
    .map(x => ({ ...x, dday: daysBetween(today(), x.date) }))
    .filter(x => x.dday <= within)
    .sort((a, b) => a.dday - b.dday);
}

// 위험을 비즈니스 언어로 번역 (LLM 문장 작성 목업 — 자산 용도·유형 규칙)
function businessImpact(asset) {
  const p = `${asset.name} ${asset.purpose || ''}`;
  const base = /고객|배송|화주/.test(p) ? '고객 서비스 중단, 고객 정보 유출 시 신뢰 하락·법적 책임'
    : /원격|VPN/.test(p) || asset.type === '네트워크 장비' ? '임직원 원격 업무 중단, 내부망 침투 경로'
      : /메일|결재|그룹웨어/.test(p) ? '사내 메일·결재 중단, 내부 문서 유출'
        : asset.type === 'DB' || /ERP|회계|생산/.test(p) ? '업무 데이터 손상·유출로 업무 중단'
          : '업무 시스템 중단';
  return state.profile.primeContractor ? `${base} · 원청 보안 점검 지적 가능` : base;
}

// 대표 결정 요청: 외주 긴급 작업 승인, 다운타임 승인, 단종 교체 예산 (규칙 생성)
function decisionRequests(list) {
  const out = [];
  list.filter(a => a.status === 'active' && a.priority === '긴급' && a.match.status !== 'potential').forEach(a => {
    const vendor = /업체|벤더/.test(a.asset.maintainer || '');
    const id = `dec|${a.asset.id}|${vendor ? 'vendor' : 'downtime'}`;
    if (out.some(d => d.id === id)) return;
    out.push({
      id, asset: a.asset.name, impact: businessImpact(a.asset), basis: `${a.vuln.id} ${a.label}(${a.score}점)`,
      ...(vendor
        ? { title: `${a.asset.name} 긴급 패치 외주 작업 승인`, ask: `${vendorName(a.asset)}에 긴급 작업 요청 — 계약 범위 외 비용 발생 가능` }
        : { title: `${a.asset.name} 패치 작업 다운타임 승인`, ask: '야간 1~2시간 서비스 중단 예상' }),
    });
  });
  contractAlerts().filter(c => c.kind.startsWith('단종')).forEach(c => out.push({
    id: `dec|${c.asset.id}|eos`, asset: c.asset.name, title: `${c.asset.name} 교체 예산 검토`,
    ask: `${c.date} 단종 — 교체 또는 지원 연장 비용 결정 필요`, impact: businessImpact(c.asset), basis: `단종 ${ddayText(c.dday)}`,
  }));
  return out.map(d => ({ ...d, reply: state.decisions[d.id] || null }));
}

// 정부 지원사업 매칭: 회사 조건 규칙 대조 (지원 조건은 공고별 확인 필요)
function matchPrograms(s = state) {
  const servers = s.assets.filter(a => a.type === '서버').length;
  return SUPPORT_PROGRAMS.map(p => {
    const ok = [], fail = [];
    if (p.maxEmployees) (s.profile.employees <= p.maxEmployees ? ok : fail).push(`임직원 ${s.profile.employees}명 — ${p.maxEmployees}인 이하 조건`);
    if (p.needsServer) (servers ? ok : fail).push(`서버 자산 ${servers}건`);
    return { ...p, eligible: !fail.length, ok, fail };
  });
}
