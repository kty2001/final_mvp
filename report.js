// 자동 리포트 생성: 현재 평가·조치 데이터를 섹션 구조로 만들고 HTML·Markdown으로 출력

const REPORT_TYPES = {
  exec: '경영진 요약 보고서', detail: '실무자 상세 보고서', compliance: '조치 이행 보고서', alert: '긴급 알림 리포트',
  audit: '점검 양식 제출본', support: '지원사업 신청 자료',
};
const REPORT_TABS = ['exec', 'detail', 'compliance', 'alert'];

// 완료 업무의 평균 소요일 (생성일 → 확인 일자)
function avgTaskDays(tasks) {
  const done = tasks.filter(t => t.status === '완료' && t.createdAt && t.checkedAt);
  return done.length ? done.reduce((s, t) => s + Math.max(0, daysBetween(t.createdAt, t.checkedAt)), 0) / done.length : null;
}

// keys: 긴급 알림은 평가 항목 key 목록, audit은 양식 id, support는 사업 id
function buildReport(type, keys) {
  const list = allAssessments();
  const active = list.filter(a => a.status === 'active');
  const tasks = state.tasks;
  const done = tasks.filter(t => t.status === '완료').length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const base = { type, title: REPORT_TYPES[type], generatedAt: nowText(), scope: `자산 ${state.assets.length}건 · 취약점 ${state.vulns.length}건 기준` };

  if (type === 'alert') {
    const items = keys ? list.filter(a => keys.includes(a.key)) : active.filter(a => a.priority === '긴급' && a.vuln.kev);
    return {
      ...base,
      summary: items.length ? `실제 악용(KEV) 연관 긴급 위협 ${items.length}건 — 즉시 확인 필요.` : '현재 KEV 연관 긴급 위협 없음.',
      sections: items.length ? [
        { heading: '긴급 위협', table: { head: ['자산', '취약점', '판정', '점수', '주요 근거'], rows: items.map(a => [a.asset.name, `${a.vuln.id} ${a.vuln.title}`, a.label, a.score, reasonShort(a)]) } },
        ...items.map(a => ({
          heading: `${a.asset.name} × ${a.vuln.id} 권장 조치`,
          bullets: [
            ...taskTemplates(a).slice(0, 4).map(t => t.title),
            ...a.facts.filter(f => ['KEV', 'NVD'].includes(f.ref)).map(f => `근거 [${f.ref}]: ${f.fact}`),
          ],
        })),
        { heading: '유의 사항', paragraphs: ['본 알림은 규칙 기반 평가로 자동 생성됨. 시스템 변경·패치는 담당자 검토·승인 후 수행.'] },
      ] : [{ heading: '긴급 위협', paragraphs: ['현재 KEV 연관 긴급 위협 없음.'] }],
    };
  }

  if (type === 'audit') {
    const form = AUDIT_FORMS.find(f => f.id === keys) || AUDIT_FORMS[0];
    const rows = fillAuditForm(form);
    const cnt = s => rows.filter(r => r.status === s).length;
    return {
      ...base, title: `${REPORT_TYPES.audit} — ${form.short}`,
      summary: `${form.name}: 충족 ${cnt('충족')} · 부분 ${cnt('부분')} · 갭 ${cnt('갭')} · 작성 필요 ${cnt('작성 필요')}.`,
      sections: [
        { heading: '항목별 답변', table: { head: ['항목', '내용', '상태', '답변', '근거'], rows: rows.map(r => [r.no, r.text, r.status, r.answer, r.evidence.join(' / ') || '-']) } },
        { heading: '비고', paragraphs: ['답변은 시스템 기록(자산 대장·조치 이력·증빙·보고·의무 이행·사고 대응 기록)으로 작성한 초안이며 담당자 검토 후 제출함. 근거가 연결된 항목만 충족으로 표기.'] },
      ],
    };
  }

  if (type === 'support') {
    const p = SUPPORT_PROGRAMS.find(x => x.id === keys) || SUPPORT_PROGRAMS[0];
    const byType = {};
    state.assets.forEach(a => { byType[a.type] = (byType[a.type] || 0) + 1; });
    return {
      ...base, title: `${REPORT_TYPES.support} — ${p.name}`,
      summary: `${p.org} ${p.name} 신청용 보안 현황 자료.`,
      sections: [
        { heading: '신청 사업', bullets: [`${p.name} (${p.org})`, `지원 내용: ${p.benefit}`, `희망 지원: ${p.needs}`] },
        { heading: '회사 개요', table: { head: ['항목', '내용'], rows: [['회사명', state.name], ['업종', state.industry], ['임직원 수', `${state.profile.employees}명`], ['지역', state.profile.region], ['보안 인력', 'IT 담당 겸직 (기본값 — 확인 후 수정)']] } },
        { heading: '정보자산 현황', table: { head: ['유형', '수량'], rows: Object.entries(byType).map(([k, n]) => [k, `${n}건`]) } },
        { heading: '보안 위협 현황', table: { head: ['항목', '값'], rows: [
          ['대응 필요 위협', `${active.length}건`],
          ['긴급·높음', `${active.filter(a => ['긴급', '높음'].includes(a.priority)).length}건`],
          ['실제 악용(KEV) 연관', `${active.filter(a => a.vuln.kev).length}건`],
          ['조치 진행률', `${progress}% (${done}/${tasks.length})`],
        ] } },
        { heading: '비고', paragraphs: ['지원 조건·서식은 공고별로 다르므로 제출 전 공고문 확인 필요. 시연용 가상 데이터.'] },
      ],
    };
  }

  if (type === 'detail') {
    const others = list.filter(a => a.status !== 'active');
    return {
      ...base,
      summary: `대응 필요 ${active.length}건의 근거·불확실성·추가 확인 사항 정리.`,
      sections: [
        { heading: '개요', paragraphs: [`대응 필요 ${active.length}건을 우선순위 순으로 정리. 점수는 규칙 기반(CVSS·KEV·EPSS·자산 중요도·외부 노출)이며 판단 신뢰도는 별도 표기.`] },
        ...active.map(a => ({
          heading: `[${a.label}] ${a.asset.name} × ${a.vuln.id} (${a.score}점)`,
          bullets: [
            `취약점: ${a.vuln.title} — ${a.vuln.product}`,
            `매칭: ${a.match.text}`,
            `판단 신뢰도: ${a.confidence}`,
            ...a.facts.filter(f => ['NVD', 'KEV', 'EPSS'].includes(f.ref)).map(f => `근거 [${f.ref}]: ${f.fact}`),
            `불확실성: ${a.uncertainties.join(' / ')}`,
            `추가 확인: ${a.checks.join(', ')}`,
          ],
        })),
        { heading: '대응 제외 항목', bullets: others.length ? others.map(a => `${a.asset.name} × ${a.vuln.id}: ${a.label} — ${a.status === 'resolved' ? '패치 적용 완료' : a.match.text}`) : ['없음'] },
      ],
    };
  }

  if (type === 'compliance') {
    const evidence = state.assets.filter(a => a.patchEvidence);
    const checks = Object.entries(state.conditionChecks);
    return {
      ...base,
      summary: `조치 업무 ${tasks.length}건(완료 ${done}건), 이력 ${state.history.length}건 수록.`,
      sections: [
        tasks.length
          ? { heading: '조치 업무 현황', paragraphs: [`전체 ${tasks.length}건 · 완료 ${done}건 · 진행률 ${progress}%`], table: { head: ['우선순위', '업무', '대상', '상태', '담당자', '확인 일자'], rows: tasks.map(t => [t.priority, t.title, `${t.assetName} × ${t.cveId}`, t.status, t.owner || '-', t.checkedAt || '-']) } }
          : { heading: '조치 업무 현황', paragraphs: ['등록된 조치 업무 없음.'] },
        { heading: '조치 증빙', ...(evidence.length
          ? { table: { head: ['자산', '반영 일자', '증빙 유형', '판정', '증빙 내용'], rows: evidence.map(a => [a.name, a.patchEvidence.at, a.patchEvidence.type, a.patchEvidence.verdict, a.patchEvidence.text]) } }
          : { paragraphs: ['등록된 조치 증빙 없음.'] }) },
        ...(checks.length ? [{ heading: '영향 조건 확인 기록', table: { head: ['대상', '확인 일시', '결과', '근거'], rows: checks.map(([k, c]) => [c.target || k, c.at, c.verdict, c.reason]) } }] : []),
        { heading: '판단·조치 이력', table: { head: ['일시', '유형', '내용'], rows: state.history.map(h => [h.time, h.type, h.text]) } },
        { heading: '비고', paragraphs: ['본 보고서는 시스템 기록을 기반으로 자동 생성됨. 시스템 변경·패치는 담당자 검토·승인을 거쳐 수행됨.'] },
      ],
    };
  }

  const urgent = active.filter(a => a.priority === '긴급' && a.match.status !== 'potential').map(a => `${a.asset.name}(${a.vuln.id})`);
  const unsure = active.filter(a => a.confidence !== '높음').length;
  const decisions = decisionRequests(list);
  const bench = BENCHMARK[state.industry] || BENCHMARK.default;
  const ownDays = avgTaskDays(tasks);
  const conclusion = [
    urgent.length ? `긴급 ${urgent.length}건(${urgent.join(', ')})은 즉시 조치 검토 필요.` : '긴급 항목 없음.',
    unsure ? `정보 미확인으로 판단 신뢰도가 낮거나 중간인 ${unsure}건은 자산 정보 보완 후 재평가 필요.` : '',
    tasks.length ? `조치 업무 진행률 ${progress}%.` : '등록된 조치 업무 없음.',
    decisions.filter(d => !d.reply).length ? `대표 결정 요청 ${decisions.filter(d => !d.reply).length}건 회신 필요.` : '',
  ].filter(Boolean).join(' ');
  return {
    ...base,
    summary: conclusion,
    sections: [
      { heading: '핵심 지표', table: { head: ['항목', '값'], rows: [
        ['대응 필요 위협', `${active.length}건`],
        ['실제 악용(KEV) 연관', `${active.filter(a => a.vuln.kev).length}건`],
        ['긴급·높음', `${active.filter(a => ['긴급', '높음'].includes(a.priority)).length}건`],
        ['조치 진행률', `${progress}% (${done}/${tasks.length})`],
      ] } },
      { heading: '위험 등급 분포', chart: statDistribution(list) },
      { heading: '상위 위험', table: { head: ['판단', '자산', '취약점', '점수', '신뢰도', '사업 영향'], rows: active.slice(0, 3).map(a => [a.label, a.asset.name, `${a.vuln.id} ${a.vuln.title}`, a.score, a.confidence, businessImpact(a.asset)]) } },
      { heading: '결론', paragraphs: [conclusion] },
      { heading: '결정 요청', ...(decisions.length
        ? { table: { head: ['요청', '내용', '사업 영향', '근거', '회신'], rows: decisions.map(d => [d.title, d.ask, d.impact, d.basis, d.reply ? `${d.reply.status} (${d.reply.at})` : '회신 대기']) } }
        : { paragraphs: ['결정이 필요한 항목 없음.'] }) },
      { heading: '동종 업계 비교', paragraphs: [`${BENCHMARK[state.industry] ? state.industry : '전체'} 업종 MSP 고객사 ${bench.n}곳 익명 집계 (목업 값).`],
        table: { head: ['지표', '자사', '업종 평균'], rows: [
          ['할 일 처리율', tasks.length ? `${progress}%` : '-', `${bench.progress}%`],
          ['평균 조치 소요일', ownDays == null ? '-' : `${ownDays.toFixed(1)}일`, `${bench.days.toFixed(1)}일`],
        ] } },
      { heading: '최근 위협 정보 변경', bullets: state.feed.slice(0, 3).map(f => `${f.time} ${f.text}`) },
    ],
  };
}

function reportToMarkdown(r) {
  const cell = c => String(c).replace(/\|/g, '\\|');
  const out = [`# ${r.title}`, '', `- 생성 일시: ${r.generatedAt}`, `- 범위: ${r.scope}`, '- 데이터: 시연용 가상 데이터', ''];
  r.sections.forEach(s => {
    out.push(`## ${s.heading}`, '');
    (s.paragraphs || []).forEach(p => out.push(p, ''));
    if (s.bullets) out.push(...s.bullets.map(b => `- ${b}`), '');
    const table = s.table || (s.chart && chartToTable(s.chart));
    if (table) {
      out.push(`| ${table.head.join(' | ')} |`, `| ${table.head.map(() => '---').join(' | ')} |`, ...table.rows.map(row => `| ${row.map(cell).join(' | ')} |`), '');
    }
  });
  return out.join('\n');
}
