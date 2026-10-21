// 학습 기반 지표 (기획안_v2 5-9·6-4): 이해·기억·메타인지·학습 습관 + 탐구 발상(관찰, 점수 없음)
// 모두 규칙 기반 계산. 또래 비교 없음, 최소 데이터 미만이면 "데이터 부족"

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const IDEA = /(만약|아니면|수도 있|또는|그렇지 않으면)/;
// 서술형 응답 결과: 오개념·부족이면 wrong, 충족이면 right, 판단 보류는 제외
const outcome = r => (r.tags.length || r.d.concept === 'bad' ? 'wrong' : r.d.concept === 'good' ? 'right' : null);
const loopRounds = () => UNITS.filter(hasLoop).flatMap(u => {
  const st = prog(u).stage;
  return [...(st !== 'learn' ? round(u, 1) : []), ...(st === 'done' ? round(u, 2) : [])];
});
const allHist = () => UNITS.filter(hasDeck).flatMap(u => u.deck.map(c => ({ u, c, hist: cardState(u, c.id).hist })));

function mUnderstanding() {
  const done = UNITS.filter(u => hasLoop(u) && prog(u).stage === 'done');
  if (!done.length) return null;
  let n = 0, g1 = 0, g2 = 0, total = 0, solved = 0;
  done.forEach(u => {
    const r1 = round(u, 1), r2 = round(u, 2), res = resolution(u);
    n += r1.length;
    g1 += r1.filter(r => outcome(r) === 'right').length;
    g2 += r2.filter(r => outcome(r) === 'right').length;
    total += res.length; solved += res.filter(x => x.solved).length;
  });
  return { units: done.length, first: pct(g1, n), second: pct(g2, n), total, solved };
}

function mMemory() {
  const reviews = allHist().flatMap(x => x.hist.slice(1));
  if (reviews.length < 5) return null;
  const rate = list => pct(list.filter(h => h.result === 'correct').length, list.length);
  const w1 = reviews.filter(h => h.day < 7), w2 = reviews.filter(h => h.day >= 7);
  return {
    n: reviews.length, rate: rate(reviews),
    trend: w1.length && w2.length ? [rate(w1), rate(w2)] : null,
    confusions: UNITS.filter(hasDeck).flatMap(u => confusionStatus(u)),
  };
}

function mMeta() {
  const items = [
    ...loopRounds().filter(r => r.conf && outcome(r)).map(r => ({ conf: r.conf, ok: outcome(r) === 'right', text: r.text })),
    ...allHist().flatMap(({ c, hist }) => hist.filter(h => h.conf).map(h => ({ conf: h.conf, ok: h.result === 'correct', text: `${c.front} → ${h.answer}` }))),
  ];
  if (items.length < 6) return null;
  const match = items.filter(i => i.conf === 'half' || (i.conf === 'sure') === i.ok).length;
  const over = items.filter(i => i.conf === 'sure' && !i.ok);
  return { n: items.length, match: pct(match, items.length), over, under: items.filter(i => i.conf === 'unsure' && i.ok).length };
}

function mHabit() {
  const recent = store.log.filter(l => l.day > store.day - 14);
  if (recent.length < 3) return null;
  const done = recent.filter(l => l.done);
  const avg = type => {
    const list = done.filter(l => (type === 'memory') === (l.type === 'memory'));
    const items = list.reduce((s, l) => s + l.items, 0);
    return items ? Math.round(list.reduce((s, l) => s + l.sec, 0) / items) : null;
  };
  const days = new Set(done.map(l => l.day));
  return { days: days.size, dayList: days, completion: pct(done.length, recent.length), started: recent.length, avgReason: avg('reason'), avgCard: avg('memory') };
}

function mIdea() {
  return loopRounds().filter(r => r.q.type !== 'explain' && IDEA.test(r.text)).map(r => r.text).slice(0, 3);
}

const bar = (label, v) => `<div class="mbar"><span class="mlabel">${label}</span><div class="bar"><span style="width:${v}%"></span></div><b>${v}%</b></div>`;
const lack = need => `<p class="note">데이터 부족 — ${need}</p>`;
const sec = s => (s == null ? '-' : s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`);
function metricCard(title, def, body) {
  return `<div class="card metric"><h3>${title}</h3><p class="def">${def}</p>${body}</div>`;
}

VIEWS.metrics = function () {
  const u = mUnderstanding(), m = mMemory(), meta = mMeta(), h = mHabit(), idea = mIdea();
  const head = `<div class="head"><div><h2>학습 기반 지표 ${badge('부모', 'who')}</h2>
    <p class="sub">전체 단원 기준 · 아이의 이전 기록과만 비교(또래 비교·등급 없음) · 아이 화면에는 표시하지 않음</p></div>
    <button class="ghost" data-action="demo">2주 사용 시연 데이터 불러오기</button></div>`;

  const cards = [
    metricCard('이해 · 설명 정확도', '서술형 응답에서 개념을 바르게 설명한 비율, 1차 → 재도전',
      u ? `${bar('1차', u.first)}${bar('재도전', u.second)}<p>재도전까지 마친 단원 ${u.units}개 · 오개념 ${u.total}개 중 <b>${u.solved}개 해소</b></p>` : lack('재도전까지 마친 단원 1개 필요')),
    metricCard('기억 · 유지율', '간격 복습(두 번째 만남부터)에서 다시 맞힌 비율',
      m ? `${bar('유지율', m.rate)}${m.trend ? `<p>첫 주 ${m.trend[0]}% → 둘째 주 ${m.trend[1]}%</p>` : ''}<p>복습 ${m.n}회</p>
        <div class="tags">${m.confusions.map(c => `<span class="chip ${c.solved ? 'good' : 'bad'}">${c.solved ? '해소' : '남음'} · ${esc(c.tag.label)}</span>`).join('') || '<span class="chip good">혼동 없음</span>'}</div>` : lack('복습 인출 5회 필요')),
    metricCard('메타인지 · 확신도 보정', '"확실해요"라고 한 답이 맞았는지, "모르겠어요"라고 한 답이 틀렸는지 — 스스로 아는 것과 모르는 것을 구분하는 정도',
      meta ? `${bar('일치', meta.match)}<p>응답 ${meta.n}개 · 과신 ${meta.over.length}개 · 과소 ${meta.under}개</p>
        ${meta.over.length ? `<p class="evidence">과신 예: "${esc(meta.over[0].text)}" — 확실하다고 했지만 다시 볼 부분</p>` : ''}` : lack('확신도를 고른 응답 6개 필요')),
    metricCard('학습 습관', '최근 14일 학습 기록 (카메라·화면 밖 활동은 수집하지 않음)',
      h ? `<div class="days">${Array.from({ length: 14 }, (_, i) => store.day - 13 + i).map(d => `<span class="${h.dayList.has(d) ? 'on' : ''}" title="${d + 1}일째"></span>`).join('')}</div>
        <p>14일 중 <b>${h.days}일</b> 학습</p>${bar('완료율', h.completion)}
        <p>서술형 문항당 평균 ${sec(h.avgReason)} · 암기 카드당 평균 ${sec(h.avgCard)}</p>` : lack('학습 세션 3회 필요')),
    metricCard('탐구 발상 · 관찰 기록', '예측·적용 문항에서 "만약", "아니면"처럼 다른 가능성을 스스로 떠올린 문장. 점수는 매기지 않음',
      idea.length ? idea.map(t => `<blockquote>${esc(t)}</blockquote>`).join('') : '<p class="note">아직 관찰된 문장 없음</p>'),
  ];
  return `${head}<div class="metrics">${cards.join('')}</div>
    <p class="note">지표는 학습 기록을 보여 주는 기능이며 능력 향상을 보장하지 않음. 산식은 기획안_v2 6-4 참조.</p>`;
};

// ---------- 2주 사용 시연 데이터 ----------
// 암기 카드 결과 각본: c 정답, f 혼동, x 오답 (각본이 끝나면 정답)
const DEMO_SCRIPT = {
  village: { d2: 'fcc', d3: 'xfc', d6: 'fc', d7: 'cfc' },
  words: { w1: 'fcc', w2: 'fcccf', w3: 'fc', w5: 'xc', w6: 'fc', w8: 'fc' }, // w2: 마지막 복습에서 다시 혼동(남음 시연)
};
const DEMO_DECK_DAYS = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13];

ACTIONS.demo = () => {
  store = { ...fresh(), unitId: store.unitId };
  ui.t0 = 0; ui.memResult = null;
  const log = (day, unitId, type, done, secs, items) => store.log.push({ key: `${day}:${unitId}:${type}`, day, unitId, type, done, sec: secs, items });
  const confMap = (qs, confs) => Object.fromEntries(qs.map((q, i) => [q.id, confs[i]]));

  UNITS.filter(hasLoop).forEach((u, i) => {
    Object.assign(prog(u), {
      a1: { ...u.samples.first }, c1: confMap(u.questions, ['sure', 'sure', 'half']),
      a2: { ...u.samples.retry }, c2: confMap(u.retry, ['sure', 'half', 'sure']),
      stage: 'done', coached: i % 2 === 0, activity: i === 0,
    });
    log(i * 3, u.id, 'reason1', true, 300 + i * 40, 3);
    log(i * 3 + 1, u.id, 'reason2', true, 240 + i * 30, 3);
  });
  log(5, UNITS[0].id, 'reason1x', false, 0, 0); // 시작만 하고 마치지 않은 세션

  UNITS.filter(hasDeck).forEach(u => {
    const script = DEMO_SCRIPT[u.id] || {}, used = {};
    DEMO_DECK_DAYS.forEach(day => {
      const due = dueCards(u, day);
      if (!due.length) return;
      due.forEach(c => {
        const n = (used[c.id] = (used[c.id] || 0) + 1) - 1;
        const step = (script[c.id] || '')[n] || 'c';
        const answer = step === 'c' ? c.answer : step === 'f' ? Object.keys(c.confuse || {})[0] || '모름' : '모름';
        applyResult(cardState(u, c.id), grade(c, answer),step === 'x' ? 'unsure' : step === 'f' || n % 2 === 0 ? 'sure' : 'half', day, answer);
      });
      log(day, u.id, 'memory', true, due.length * 14, due.length);
    });
  });
  store.day = 13;
  save();
  location.hash === '#metrics' ? render() : (location.hash = 'metrics');
};
