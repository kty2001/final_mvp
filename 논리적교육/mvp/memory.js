// 암기 카드: 인출(직접 쓰기) + 확신도 → 채점(정답·혼동·오답) → 간격 복습(정답 1→3→7일, 틀리면 다음 날)
// 실서비스도 규칙 기반(기획안_v2 7-1). 카드 상태: prog(u).cards[cardId] = { box, due, hist: [{ day, result, conf, tag, answer }] }

const INTERVALS = [1, 3, 7];
const RESULT = { correct: '정답', confuse: '혼동', wrong: '다시 보기' };
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');

function grade(card, answer) {
  const a = norm(answer);
  if ([card.answer, ...(card.alts || [])].some(x => norm(x) === a)) return { result: 'correct' };
  const hit = Object.entries(card.confuse || {}).find(([term]) => norm(term) === a);
  return hit ? { result: 'confuse', tag: hit[1] } : { result: 'wrong' };
}
// 채점 결과를 카드 상태에 반영 (시연 데이터 생성에도 재사용)
function applyResult(state, r, conf, day, answer) {
  state.hist.push({ day, result: r.result, conf, tag: r.tag || '', answer });
  if (r.result === 'correct') { state.box = Math.min(state.box + 1, INTERVALS.length); state.due = day + INTERVALS[state.box - 1]; }
  else { state.box = 0; state.due = day + 1; }
}
const cardState = (u, id) => (prog(u).cards[id] ||= { box: 0, due: 0, hist: [] });
const dueCards = (u, day = store.day) => u.deck.filter(c => cardState(u, c.id).due <= day);
const confusionOf = (u, id) => u.confusions.find(c => c.id === id);

// 혼동 태그별 해소 여부: 혼동이 있었던 카드의 마지막 결과가 모두 정답이면 해소
function confusionStatus(u) {
  const byTag = {};
  u.deck.forEach(c => {
    const hist = cardState(u, c.id).hist;
    hist.filter(h => h.result === 'confuse').forEach(h => {
      const t = (byTag[h.tag] ||= { tag: confusionOf(u, h.tag), count: 0, solved: true });
      t.count++;
      if (hist[hist.length - 1].result !== 'correct') t.solved = false;
    });
  });
  return Object.values(byTag);
}

VIEWS.memory = function () {
  const u = unit();
  const head = header('암기 카드', '뜻을 보고 직접 써서 떠올리기, 헷갈린 것은 짝과 비교하기', '아이', false);
  if (!hasDeck(u)) return head + waiting('이 단원은 암기 카드가 없음 — 개념 설명 문항으로 학습함', 'learn', '오늘의 개념으로');
  const due = dueCards(u);
  const last = ui.memResult && ui.memResult.unitId === u.id ? ui.memResult : null;
  const nextDay = Math.min(...u.deck.map(c => cardState(u, c.id).due));
  const learned = u.deck.filter(c => cardState(u, c.id).box > 0).length;
  const status = `<div class="card memstat"><span>오늘 복습할 카드 <b>${due.length}장</b></span><span>기억 단계 1 이상 <b>${learned}/${u.deck.length}장</b></span>
    <button class="ghost" data-action="nextDay">하루 지나기 (시연)</button></div>`;

  let resultHtml = '';
  if (last) {
    const card = u.deck.find(c => c.id === last.cardId);
    const conf = last.tag ? confusionOf(u, last.tag) : null;
    const msg = { correct: '맞았어요! 다음에 조금 더 뒤에 다시 물어볼게요.', confuse: `헷갈렸어요 — 내가 쓴 답: "${esc(last.answer)}". 아래 카드로 짝 단어와 비교해 봐요.`, wrong: '괜찮아요. 내일 다시 만나요.' }[last.result];
    resultHtml = `<div class="card result ${last.result}"><p>${badge(RESULT[last.result], last.result)} ${esc(card.front)} → <b>${esc(card.answer)}</b></p><p class="msg">${msg}</p>
      ${conf ? `<div class="supp contrast">${badge(CARD_TYPES.contrast, 'c-contrast')} <b>${esc(conf.card.title)}</b><p>${esc(conf.card.body)}</p></div>` : ''}</div>`;
  }

  if (!due.length) {
    const link = hasLoop(u) ? '<p>용어를 익혔다면 <a href="#learn">외운 내용으로 설명하기 →</a></p>' : '';
    return `${head}${status}${resultHtml}<div class="card empty"><p>오늘 복습할 카드를 모두 마쳤어요. 다음 복습은 ${nextDay + 1}일째예요.</p>${link}</div>`;
  }
  startSession('memory');
  const card = due[0];
  const seen = cardState(u, card.id).hist.length;
  return `${head}${status}${resultHtml}
    <form id="card" class="card flash">
      <p class="front">${badge(seen ? `${seen + 1}번째 만남` : '처음', '')} ${esc(card.front)}</p>
      <input type="hidden" name="cardId" value="${card.id}">
      <input name="answer" autocomplete="off" placeholder="${u.subject === '영어' ? '영어 단어를 써 보세요' : '용어를 써 보세요'} (모르면 '모름')">
      <div class="row">${confSelect('conf')}<button type="submit">확인</button></div>
    </form>`;
};

ACTIONS.nextDay = () => { store.day++; ui.memResult = null; ui.t0 = 0; save(); render(); };

FORMS.card = data => {
  const u = unit(), card = u.deck.find(c => c.id === data.cardId);
  const r = grade(card, data.answer);
  applyResult(cardState(u, card.id), r, data.conf, store.day, data.answer);
  ui.memResult = { unitId: u.id, cardId: card.id, answer: data.answer, ...r };
  if (!dueCards(u).length) finishSession('memory', u.deck.flatMap(c => cardState(u, c.id).hist).filter(h => h.day === store.day).length);
  save(); render();
};
