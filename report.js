// 자동 리포트 생성: 현재 평가·조치 데이터를 섹션 구조로 만들고 HTML·Markdown으로 출력

const REPORT_TYPES = { exec: '경영진 요약 보고서', detail: '실무자 상세 보고서', compliance: '조치 이행 보고서', alert: '긴급 알림 리포트' };

// keys: 긴급 알림 리포트에 담을 평가 항목 (생략 시 현재 KEV 연관 긴급 항목 전체)
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
    return {
      ...base,
      summary: `조치 업무 ${tasks.length}건(완료 ${done}건), 이력 ${state.history.length}건 수록.`,
      sections: [
        tasks.length
          ? { heading: '조치 업무 현황', paragraphs: [`전체 ${tasks.length}건 · 완료 ${done}건 · 진행률 ${progress}%`], table: { head: ['우선순위', '업무', '대상', '상태', '담당자', '확인 일자'], rows: tasks.map(t => [t.priority, t.title, `${t.assetName} × ${t.cveId}`, t.status, t.owner || '-', t.checkedAt || '-']) } }
          : { heading: '조치 업무 현황', paragraphs: ['등록된 조치 업무 없음.'] },
        { heading: '판단·조치 이력', table: { head: ['일시', '유형', '내용'], rows: state.history.map(h => [h.time, h.type, h.text]) } },
        { heading: '비고', paragraphs: ['본 보고서는 시스템 기록을 기반으로 자동 생성됨. 시스템 변경·패치는 담당자 검토·승인을 거쳐 수행됨.'] },
      ],
    };
  }

  const urgent = active.filter(a => a.priority === '긴급' && a.match.status !== 'potential').map(a => `${a.asset.name}(${a.vuln.id})`);
  const unsure = active.filter(a => a.confidence !== '높음').length;
  const conclusion = [
    urgent.length ? `긴급 ${urgent.length}건(${urgent.join(', ')})은 즉시 조치 검토 필요.` : '긴급 항목 없음.',
    unsure ? `정보 미확인으로 판단 신뢰도가 낮거나 중간인 ${unsure}건은 자산 정보 보완 후 재평가 필요.` : '',
    tasks.length ? `조치 업무 진행률 ${progress}%.` : '등록된 조치 업무 없음.',
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
      { heading: '상위 위험', table: { head: ['판단', '자산', '취약점', '점수', '신뢰도'], rows: active.slice(0, 3).map(a => [a.label, a.asset.name, `${a.vuln.id} ${a.vuln.title}`, a.score, a.confidence]) } },
      { heading: '결론', paragraphs: [conclusion] },
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
