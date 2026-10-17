// 인라인 SVG 차트와 통계 데이터 (외부 라이브러리 없음)
// 색: 계열은 범주형 팔레트 1·2번, 우선순위는 상태색(라벨과 함께 표시), 히트맵은 파랑 단색 농도

const SERIES = ['#2a78d6', '#eb6834'];
const STATUS_FILL = { 'p-urgent': '#d03b3b', 'p-high': '#ec835a', 'p-medium': '#fab219', 'p-low': '#898781', 'p-done': '#0ca30c', 'p-none': '#c3c2b7' };
const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

// ---------- 통계 데이터 ----------
function statDistribution(list) {
  const active = list.filter(a => a.status === 'active');
  const rows = PRIORITY_LEVELS.map(l => ({ label: l.label, value: active.filter(a => a.priority === l.label).length, fill: STATUS_FILL[l.cls] }));
  rows.push({ label: '조치 완료', value: list.filter(a => a.status === 'resolved').length, fill: STATUS_FILL['p-done'] });
  rows.push({ label: '영향 없음·오탐', value: list.filter(a => a.status === 'excluded').length, fill: STATUS_FILL['p-none'] });
  return { kind: 'bar', title: '위험 등급 분포', unit: '건', rows };
}

function statByType(list) {
  const active = list.filter(a => a.status === 'active');
  const types = [...new Set(active.map(a => a.asset.type))];
  const rows = types.map(t => {
    const items = active.filter(a => a.asset.type === t);
    const avg = Math.round(items.reduce((s, a) => s + a.score, 0) / items.length);
    return { label: t, value: items.length, fill: SERIES[0], title: `${t}: 대응 필요 ${items.length}건 · 평균 ${avg}점` };
  }).sort((a, b) => b.value - a.value);
  return { kind: 'bar', title: '자산 유형별 대응 필요 위협', unit: '건', rows };
}

function statTrend() {
  const n = state.trend.length + 1;
  const labels = Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 7 * (n - 1 - i));
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });
  const active = allAssessments().filter(a => a.status === 'active').length;
  const done = state.tasks.filter(t => t.status === '완료').length;
  return {
    kind: 'line', title: '주간 위협·조치 추이', labels, note: '이전 주차는 목업 값, 마지막 주차는 현재 데이터',
    series: [
      { name: '대응 필요 위협', values: [...state.trend.map(t => t[0]), active], color: SERIES[0] },
      { name: '조치 완료 업무', values: [...state.trend.map(t => t[1]), done], color: SERIES[1] },
    ],
  };
}

function statHeatmap(list) {
  const assets = [...new Map(list.map(a => [a.asset.id, a.asset])).values()];
  const vulns = [...new Map(list.map(a => [a.vuln.id, a.vuln])).values()].sort((x, y) => x.id.localeCompare(y.id));
  const byKey = Object.fromEntries(list.map(a => [a.key, a]));
  const cells = assets.map(as => vulns.map(v => {
    const a = byKey[`${as.id}|${v.id}`];
    if (!a) return null;
    const title = `${as.name} × ${v.id} (${v.product}): ${a.label}${a.status === 'active' ? ` ${a.score}점` : ''}`;
    return a.status === 'active'
      ? { score: a.score, text: String(a.score), key: a.key, title }
      : { score: null, text: a.status === 'resolved' ? '완료' : '제외', key: a.key, title };
  }));
  return {
    kind: 'heatmap', title: '자산 × 취약점 위험 점수', note: '제품이 일치한 자산만 표시 · 칸을 누르면 상세 분석',
    rows: assets.map(a => a.name), cols: vulns.map(v => v.id.replace(/^CVE-\d{4}-/, '')), colTitles: vulns.map(v => `${v.id} ${v.product}`), cells,
  };
}

function statTenants() {
  return Object.values(store.tenants).map(t => withTenant(t, () => {
    const active = allAssessments().filter(a => a.status === 'active');
    const done = t.tasks.filter(x => x.status === '완료').length;
    return {
      id: t.id, name: t.name, industry: t.industry, plan: t.plan, assets: t.assets.length, active: active.length,
      urgent: active.filter(a => a.priority === '긴급').length, kev: active.filter(a => a.vuln.kev).length,
      progress: t.tasks.length ? Math.round((done / t.tasks.length) * 100) : null,
      unread: t.notifications.filter(x => !x.read).length,
    };
  }));
}

// ---------- 렌더링 ----------
function barPath(x0, y, x1, h) {
  const r = Math.min(4, (x1 - x0) / 2, h / 2);
  return `M${x0},${y} H${x1 - r} Q${x1},${y} ${x1},${y + r} V${y + h - r} Q${x1},${y + h} ${x1 - r},${y + h} H${x0} Z`;
}

function svgBar(spec) {
  const W = 480, L = 112, R = 40, rowH = 30, bh = 18;
  const max = Math.max(1, ...spec.rows.map(r => r.value));
  const H = spec.rows.length * rowH + 8;
  const rows = spec.rows.map((r, i) => {
    const top = 4 + i * rowH, y = top + (rowH - bh) / 2, x1 = L + (r.value / max) * (W - L - R);
    return `<g><title>${esc(r.title || `${r.label}: ${r.value}${spec.unit || ''}`)}</title>
      <rect class="hit" x="0" y="${top}" width="${W}" height="${rowH}"/>
      <text x="${L - 8}" y="${y + bh / 2}" class="ax" text-anchor="end" dominant-baseline="middle">${esc(r.label)}</text>
      ${r.value > 0 ? `<path d="${barPath(L, y, x1, bh)}" fill="${r.fill}"/>` : ''}
      <text x="${x1 + 6}" y="${y + bh / 2}" class="val" dominant-baseline="middle">${r.value}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title)}">${rows}<line x1="${L}" y1="4" x2="${L}" y2="${H - 4}" class="base"/></svg>`;
}

function niceMax(v) {
  const m = Math.ceil(v * 1.15);
  return m % 2 ? m + 1 : m;
}

function svgLine(spec) {
  const W = 480, H = 200, L = 30, R = 104, T = 14, B = 26;
  const n = spec.labels.length;
  const max = niceMax(Math.max(1, ...spec.series.flatMap(s => s.values)));
  const step = (W - L - R) / (n - 1);
  const x = i => L + i * step;
  const y = v => T + (1 - v / max) * (H - T - B);
  const grid = [0, max / 2, max].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'base' : 'grid'}"/>
    <text x="${L - 6}" y="${y(v)}" class="ax" text-anchor="end" dominant-baseline="middle">${v}</text>`).join('');
  const xLabels = spec.labels.map((l, i) => `<text x="${x(i)}" y="${H - 8}" class="ax" text-anchor="middle">${esc(l)}</text>`).join('');
  const hits = spec.labels.map((l, i) => `<rect class="hit" x="${x(i) - step / 2}" y="${T}" width="${step}" height="${H - T - B}"><title>${esc(l)} · ${spec.series.map(s => `${s.name} ${s.values[i]}`).join(' · ')}</title></rect>`).join('');
  const lines = spec.series.map(s => `<path d="${s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>
    <circle cx="${x(n - 1)}" cy="${y(s.values[n - 1])}" r="4" fill="${s.color}" stroke="#fff" stroke-width="2" pointer-events="none"/>`).join('');
  // 끝 라벨이 겹치면 생략하고 범례·툴팁으로 대체
  const ends = spec.series.map(s => y(s.values[n - 1]));
  const separated = ends.every((e, i) => ends.every((f, j) => i === j || Math.abs(e - f) >= 14));
  const endLabels = separated ? spec.series.map((s, i) => `<text x="${x(n - 1) + 9}" y="${ends[i]}" class="val" dominant-baseline="middle">${esc(s.name)} ${s.values[n - 1]}</text>`).join('') : '';
  const legend = `<div class="legend">${spec.series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  return `${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title)}">${grid}${xLabels}${hits}${lines}${endLabels}</svg>`;
}

function htmlHeatmap(spec) {
  const idx = s => Math.min(SEQ.length - 1, Math.floor((s / 100) * SEQ.length));
  const cell = c => {
    if (!c) return '<td class="hm-empty"></td>';
    if (c.score == null) return `<td class="hm-flat" data-action="open" data-id="${esc(c.key)}" title="${esc(c.title)}">${c.text}</td>`;
    const i = idx(c.score);
    return `<td style="background:${SEQ[i]};color:${i >= 3 ? '#fff' : '#0b0b0b'}" data-action="open" data-id="${esc(c.key)}" title="${esc(c.title)}">${c.text}</td>`;
  };
  return `<div class="table-wrap"><table class="heatmap">
      <tr><th></th>${spec.cols.map((c, i) => `<th title="${esc(spec.colTitles[i])}">${esc(c)}</th>`).join('')}</tr>
      ${spec.rows.map((r, ri) => `<tr><th>${esc(r)}</th>${spec.cells[ri].map(cell).join('')}</tr>`).join('')}
    </table></div>
    <div class="ramp"><span>0점</span>${SEQ.map(c => `<i style="background:${c}"></i>`).join('')}<span>100점</span><span class="hm-key hm-flat">완료·제외</span></div>`;
}

function chartToTable(spec) {
  if (spec.kind === 'bar') return { head: ['항목', `값(${spec.unit || ''})`], rows: spec.rows.map(r => [r.label, r.value]) };
  if (spec.kind === 'line') return { head: ['주차', ...spec.series.map(s => s.name)], rows: spec.labels.map((l, i) => [l, ...spec.series.map(s => s.values[i])]) };
  return { head: ['자산', ...spec.colTitles], rows: spec.rows.map((r, ri) => [r, ...spec.cells[ri].map(c => (c ? c.text : '-'))]) };
}

function simpleTable(t) {
  return `<div class="table-wrap"><table><tr>${t.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
}

function renderChart(spec) {
  const body = spec.kind === 'bar' ? svgBar(spec) : spec.kind === 'line' ? svgLine(spec) : htmlHeatmap(spec);
  return `<figure class="chart"><figcaption>${esc(spec.title)}</figcaption>${body}
    ${spec.note ? `<p class="muted">${esc(spec.note)}</p>` : ''}
    <details><summary>표로 보기</summary>${simpleTable(chartToTable(spec))}</details></figure>`;
}
