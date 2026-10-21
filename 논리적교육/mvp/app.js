// 상태·모의 진단·라우팅·이해 루프 화면. 흐름: 응답 제출(learn) → 부모 검토(review) → 피드백 공개(feedback) → 재도전 완료(done)
// 암기 카드는 memory.js, 학습 기반 지표는 metrics.js가 VIEWS·ACTIONS·FORMS에 추가 등록함

const STORE_KEY = 'reasoning-mvp-v2';
const $view = document.getElementById('view');
const STAGES = ['learn', 'review', 'feedback', 'done'];
const STEPS = [
  { hash: 'learn', label: '개념·응답' },
  { hash: 'review', label: '부모 검토' },
  { hash: 'feedback', label: '피드백·보충' },
  { hash: 'retry', label: '재도전' },
  { hash: 'growth', label: '변화 비교' },
];
const RUBRIC = { concept: '개념 정확성', link: '근거 연결', steps: '추론 단계' };
const LEVEL = { good: '충족', mid: '보완', bad: '부족', hold: '판단 보류' };
const CAUSAL = /(때문|왜냐|니까|므로|어서|아서|해서|여서|워서|져서|와서|면서|라서)/;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const badge = (label, cls = '') => `<span class="badge ${cls}">${esc(label)}</span>`;
const typeBadge = type => badge(TYPES[type], `t-${type}`);

// ---------- 저장소 ----------
// day: 시연용 날짜(0부터, '하루 지나기'로 증가), log: 학습 세션 기록(학습 습관 지표용)
let store = load();
const ui = { t0: 0 };
function fresh() { return { unitId: UNITS[0].id, units: {}, day: 0, log: [] }; }
function blank() { return { stage: 'learn', a1: {}, a2: {}, c1: {}, c2: {}, edits: {}, coached: false, activity: false, cards: {} }; }
function load() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.units) return { ...fresh(), ...s }; } catch (e) { /* 저장소 사용 불가 */ }
  return fresh();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 저장소 사용 불가 */ } }
const unit = () => UNITS.find(u => u.id === store.unitId) || UNITS[0];
const prog = (u = unit()) => (store.units[u.id] ||= blank());
const tagOf = (u, id) => u.tags.find(t => t.id === id);
const hasLoop = u => !!u.questions;
const hasDeck = u => !!u.deck;

// 세션 기록: 같은 날·단원·종류는 한 번만 시작으로 기록, 제출 시 완료·소요 시간 저장
function startSession(type) {
  const key = `${store.day}:${unit().id}:${type}`;
  if (!store.log.some(l => l.key === key)) { store.log.push({ key, day: store.day, unitId: unit().id, type, done: false, sec: 0, items: 0 }); save(); }
  if (!ui.t0) ui.t0 = Date.now();
}
function finishSession(type, items) {
  const entry = store.log.find(l => l.key === `${store.day}:${unit().id}:${type}`);
  if (entry) Object.assign(entry, { done: true, sec: entry.sec + Math.max(1, Math.round((Date.now() - ui.t0) / 1000)), items: entry.items + items });
  ui.t0 = 0;
}
// 폼 데이터에서 확신도(conf_문항id) 분리
function splitConf(data) {
  const answers = {}, conf = {};
  Object.entries(data).forEach(([k, v]) => { if (k.startsWith('conf_')) conf[k.slice(5)] = v; else answers[k] = v; });
  return { answers, conf };
}

// ---------- 모의 진단 (실서비스: LLM + 루브릭, 태그 목록 안에서만 판정) ----------
function diagnose(u, q, text) {
  const t = (text || '').trim();
  const aiTags = u.tags.filter(g => (!g.q || g.q.includes(q.id)) && g.patterns.some(p => new RegExp(p).test(t))).map(g => g.id);
  const keys = q.keys.filter(k => t.includes(k));
  const concept = aiTags.length ? 'bad' : keys.length ? 'good' : 'hold';
  return {
    aiTags, keys,
    concept,
    link: !CAUSAL.test(t) ? 'bad' : concept === 'good' ? 'good' : 'mid',
    steps: t.length < 15 ? 'bad' : 'good',
    quote: quoteOf(u, t, aiTags, keys),
  };
}
function quoteOf(u, t, aiTags, keys) {
  const sentences = t.split(/(?<=[.?!])\s+/).filter(Boolean);
  const pats = aiTags.flatMap(id => tagOf(u, id).patterns);
  return sentences.find(s => pats.some(p => new RegExp(p).test(s))) || sentences.find(s => keys.some(k => s.includes(k))) || sentences[0] || '';
}
// 1차 응답은 부모 수정(제외·추가) 반영
function tagsOf(u, qid, d, p = prog(u)) {
  const e = p.edits[qid] || { removed: [], added: [] };
  return [...d.aiTags.filter(id => !e.removed.includes(id)), ...e.added.filter(id => !d.aiTags.includes(id))];
}
function round(u, which) {
  const p = prog(u);
  const qs = which === 1 ? u.questions : u.retry;
  const answers = which === 1 ? p.a1 : p.a2;
  return qs.map(q => {
    const d = diagnose(u, q, answers[q.id]);
    const conf = (which === 1 ? p.c1 : p.c2)[q.id] || '';
    return { q, text: answers[q.id] || '', conf, d, tags: which === 1 ? tagsOf(u, q.id, d, p) : d.aiTags };
  });
}
function summaryLine(u, rows) {
  const tags = [...new Set(rows.flatMap(r => r.tags))];
  const holds = rows.filter(r => r.d.concept === 'hold' && !r.tags.length).length;
  if (tags.length) return `${tags.map(id => `'${tagOf(u, id).label}'`).join(', ')} 오개념이 보임${holds ? ` · 판단 보류 ${holds}문항` : ''}`;
  if (holds) return `오개념은 찾지 못함 · 판단 보류 ${holds}문항 — 응답을 직접 읽고 판단 필요`;
  return '핵심 개념을 근거와 함께 설명함 — 심화 질문으로 대화 권장';
}
function coachOf(u, rows) {
  const tags = [...new Set(rows.flatMap(r => r.tags))].map(id => tagOf(u, id));
  if (!tags.length) return { qs: u.deepCoach, why: '정답을 알고 있어도 조건을 바꿔 다시 설명해 보면 이해가 단단해짐' };
  return { qs: [...new Set(tags.flatMap(t => t.coach))].slice(0, 2), why: tags[0].why };
}
// 해소: 2차 응답에 같은 태그가 없고, 2차 개념 정확성이 모두 충족
function resolution(u) {
  const r1 = round(u, 1), r2 = round(u, 2);
  const allGood = r2.every(r => r.d.concept === 'good');
  return [...new Set(r1.flatMap(r => r.tags))].map(id => ({ tag: tagOf(u, id), solved: allGood && !r2.some(r => r.tags.includes(id)) }));
}

// ---------- 공통 조각 ----------
function highlight(u, q, text) {
  const bad = u.tags.filter(t => !t.q || t.q.includes(q.id)).flatMap(t => t.patterns);
  const good = q.keys;
  const re = new RegExp(`(${bad.join('|')})|(${good.join('|')})`, 'g');
  return esc(text).replace(re, (m, b) => `<mark class="${b ? 'bad' : 'good'}">${m}</mark>`);
}
function stepper() {
  const p = prog();
  const done = { learn: p.stage !== 'learn', review: ['feedback', 'done'].includes(p.stage), feedback: ['feedback', 'done'].includes(p.stage), retry: p.stage === 'done', growth: p.stage === 'done' };
  const cur = location.hash.slice(1) || 'learn';
  return `<ol class="stepper">${STEPS.map((s, i) => `<li class="${done[s.hash] ? 'done' : ''} ${cur === s.hash ? 'cur' : ''}"><a href="#${s.hash}">${i + 1}. ${s.label}</a></li>`).join('')}</ol>`;
}
function waiting(msg, link, label) {
  return `<div class="card empty"><p>${msg}</p>${link ? `<a class="btn" href="#${link}">${label}</a>` : ''}</div>`;
}
const unitLabel = (u = unit()) => `${u.grade} ${u.subject} · ${u.title}`;
function header(title, sub, who, steps = hasLoop(unit())) {
  return `${steps ? stepper() : ''}<div class="head"><div><h2>${title} ${badge(who, 'who')}</h2><p class="sub">${esc(unitLabel())} — ${sub}</p></div></div>`;
}
const deckOnly = head => head + waiting('이 단원은 암기 카드로 학습함', 'memory', '암기 카드로');
function confSelect(name) {
  return `<select name="${name}" class="conf"><option value="">얼마나 확실해요?</option>${Object.entries(CONF).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`;
}
function answerForm(id, qs, sampleLabel) {
  return `<form id="${id}" class="card">
    ${qs.map((q, i) => `<label class="q"><span>${typeBadge(q.type)} ${i + 1}. ${esc(q.text)}</span>
      <textarea name="${q.id}" rows="3" placeholder="내 생각과 그렇게 생각한 이유를 써 보세요"></textarea></label>
      <div class="confrow">${confSelect(`conf_${q.id}`)}</div>`).join('')}
    <div class="row"><button type="button" class="ghost" data-action="sample" data-form="${id}">${sampleLabel}</button><button type="submit">제출</button></div>
  </form>`;
}

// ---------- 화면 ----------
const VIEWS = {
  learn() {
    const u = unit(), p = prog();
    const units = UNITS.map(x => {
      const st = (store.units[x.id] || blank()).stage;
      const label = hasLoop(x) ? { learn: '시작 전', review: '검토 대기', feedback: '재도전 대기', done: '완료' }[st] : '암기 카드';
      return `<button class="unit ${x.id === u.id ? 'on' : ''}" data-action="unit" data-id="${x.id}"><b>${esc(unitLabel(x))}</b>${badge(label, hasLoop(x) ? st : '')}</button>`;
    }).join('');
    const concept = `<div class="card concept"><h3>개념 카드</h3><p class="goal">${esc(u.goal)}</p><ol>${u.concepts.map(c => `<li>${esc(c)}</li>`).join('')}</ol></div>`;
    if (!hasLoop(u)) return `${deckOnly(header('오늘의 개념', '단원 선택', '아이'))}<div class="units">${units}</div>${concept}`;
    if (p.stage === 'learn') startSession('reason1');
    const deckHint = hasDeck(u) && p.stage === 'learn' ? '<p class="note">이 단원은 <a href="#memory">암기 카드</a>로 용어를 먼저 익힌 뒤 설명하면 좋아요.</p>' : '';
    const body = p.stage === 'learn'
      ? deckHint + answerForm('first', u.questions, '예시 응답 채우기 (오개념 포함)')
      : `<div class="card"><h3>제출한 응답</h3>${round(u, 1).map(r => `<p>${typeBadge(r.q.type)} ${esc(r.q.text)}<br><span class="ans">${esc(r.text)}</span></p>`).join('')}
         <p class="note">${p.stage === 'review' ? '보호자가 확인하고 있어요. 확인이 끝나면 피드백을 볼 수 있어요.' : '<a href="#feedback">피드백 보러 가기 →</a>'}</p></div>`;
    return `${header('오늘의 개념', '개념 카드를 읽고 세 문항에 내 말로 답하기', '아이')}
      <div class="units">${units}</div>
      ${concept}
      ${body}`;
  },

  review() {
    const u = unit(), p = prog();
    const head = header('부모 검토', 'AI 진단 초안을 확인하고 아이에게 던질 질문 고르기', '부모');
    if (!hasLoop(u)) return deckOnly(head);
    if (p.stage === 'learn') return head + waiting('아이가 아직 응답을 제출하지 않음', 'learn', '오늘의 개념으로');
    const rows = round(u, 1), coach = coachOf(u, rows), editable = p.stage === 'review';
    const cards = rows.map(r => {
      const tagChips = r.tags.map(id => `<span class="chip bad">${esc(tagOf(u, id).label)}${editable ? ` <button class="x" data-action="untag" data-q="${r.q.id}" data-id="${id}" title="진단 제외">×</button>` : ''}</span>`).join('');
      const options = u.tags.filter(t => !r.tags.includes(t.id)).map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
      const addTag = editable && options ? `<select data-change="tag" data-q="${r.q.id}"><option value="">+ 오개념 태그 직접 지정</option>${options}</select>` : '';
      return `<div class="card">
        <p class="qtext">${typeBadge(r.q.type)} ${esc(r.q.text)}</p>
        <blockquote>${esc(r.text)}${r.conf ? ` <span class="confnote">· 아이 확신도: ${CONF[r.conf]}</span>` : ''}</blockquote>
        <div class="rubric">${Object.entries(RUBRIC).map(([k, label]) => `<span class="lv ${r.d[k]}">${label} · ${LEVEL[r.d[k]]}</span>`).join('')}</div>
        <div class="tags">${tagChips || (r.d.concept === 'hold' ? '<span class="chip hold">판단 보류 — 태그 미부여, 직접 판단 필요</span>' : '<span class="chip good">오개념 없음</span>')} ${addTag}</div>
        ${r.d.quote && r.tags.length ? `<p class="evidence">근거 인용: "${esc(r.d.quote)}"</p>` : ''}
      </div>`;
    }).join('');
    const action = editable
      ? `<label class="check"><input type="checkbox" data-change="coached" ${p.coached ? 'checked' : ''}> 코칭 질문으로 아이와 대화함</label>
         <button data-action="publish">아이에게 피드백 공개</button>`
      : `<p class="note">피드백 공개 완료${p.coached ? ' · 코칭 질문 대화함' : ''}</p>`;
    return `${head}
      <div class="card summary"><h3>한 줄 진단</h3><p class="line">${esc(summaryLine(u, rows))}</p></div>
      <div class="card coach"><h3>아이에게 던질 질문</h3><ol>${coach.qs.map(q => `<li>${esc(q)}</li>`).join('')}</ol>
        <p class="why"><b>정답을 바로 말하지 않는 이유</b> ${esc(coach.why)}</p></div>
      <h3 class="sec">문항별 진단 초안</h3>${cards}
      <div class="card actionbar">${action}</div>`;
  },

  feedback() {
    const u = unit(), p = prog();
    const head = header('피드백·보충', '보호자가 확인한 피드백과 보충 카드', '아이');
    if (!hasLoop(u)) return deckOnly(head);
    if (p.stage === 'learn') return head + waiting('먼저 오늘의 개념 문항에 답해 주세요', 'learn', '오늘의 개념으로');
    if (p.stage === 'review') return head + waiting('보호자가 확인하고 있어요. 조금만 기다려 주세요');
    const rows = round(u, 1);
    const msgs = rows.map(r => {
      const msg = r.tags.length ? '이 부분은 한 번 더 생각해 보자. 아래 카드에 힌트가 있어.'
        : r.d.concept === 'hold' ? '보호자와 함께 이야기해 보자.'
        : r.d.link === 'good' ? '근거를 들어 잘 설명했어!'
        : '핵심 낱말을 잘 썼어. "왜냐하면"으로 이유를 이어 보면 더 좋아.';
      return `<div class="fb ${r.tags.length ? 'retry' : ''}"><p>${typeBadge(r.q.type)} <span class="ans">${esc(r.text)}</span></p><p class="msg">${msg}</p></div>`;
    }).join('');
    const tags = [...new Set(rows.flatMap(r => r.tags))].map(id => tagOf(u, id));
    const cards = tags.length
      ? `<div class="cards">${tags.map(t => `<div class="card supp">${badge(CARD_TYPES[t.card.type], `c-${t.card.type}`)}<h3>${esc(t.card.title)}</h3><p>${esc(t.card.body)}</p></div>`).join('')}</div>`
      : '<p class="note">보충할 오개념이 없어요. 다른 상황에서도 설명할 수 있는지 재도전해 보세요.</p>';
    return `${head}<div class="card"><h3>보호자가 확인한 피드백</h3>${msgs}</div>
      <h3 class="sec">보충 카드</h3>${cards}
      <div class="row end"><a class="btn" href="#retry">재도전하러 가기 →</a></div>`;
  },

  retry() {
    const u = unit(), p = prog();
    const head = header('재도전', '같은 개념, 다른 상황의 변형 문항', '아이');
    if (!hasLoop(u)) return deckOnly(head);
    if (p.stage === 'learn' || p.stage === 'review') return head + waiting('피드백과 보충 카드를 먼저 확인해 주세요', p.stage === 'learn' ? 'learn' : '', '오늘의 개념으로');
    if (p.stage === 'done') return head + waiting('재도전 완료! 생각이 어떻게 달라졌는지 확인해 보세요', 'growth', '성장 기록 보기');
    startSession('reason2');
    return head + answerForm('second', u.retry, '예시 응답 채우기 (개선)');
  },

  growth() {
    const u = unit(), p = prog();
    const summary = `<div class="card"><h3>단원별 기록</h3><table><thead><tr><th>단원</th><th>상태</th><th>1차 오개념</th><th>해소</th></tr></thead><tbody>
      ${UNITS.filter(hasLoop).map(x => {
        const st = (store.units[x.id] || blank()).stage;
        if (st === 'learn') return `<tr><td>${esc(unitLabel(x))}</td><td>시작 전</td><td>-</td><td>-</td></tr>`;
        const res = st === 'done' ? resolution(x) : null;
        const n1 = new Set(round(x, 1).flatMap(r => r.tags)).size;
        return `<tr><td>${esc(unitLabel(x))}</td><td>${{ review: '검토 대기', feedback: '재도전 대기', done: '완료' }[st]}</td><td>${n1}개</td><td>${res ? `${res.filter(r => r.solved).length}개` : '-'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    const head = header('성장 기록', '1차·2차 응답 비교와 해소된 오개념', '부모·아이');
    if (!hasLoop(u)) return deckOnly(head) + summary;
    if (p.stage !== 'done') return head + waiting('이 단원은 재도전을 마치면 1차·2차 응답을 비교할 수 있음') + summary;
    const r1 = round(u, 1), r2 = round(u, 2), res = resolution(u);
    const resHtml = res.length
      ? res.map(r => `<span class="chip ${r.solved ? 'good' : 'bad'}">${r.solved ? '해소' : '남음'} · ${esc(r.tag.label)}</span>`).join(' ')
      : '<span class="chip good">1차부터 오개념 없음</span>';
    const pairs = r1.map((a, i) => {
      const b = r2[i];
      return `<tr><td>${typeBadge(a.q.type)}</td>
        <td><p class="qsmall">${esc(a.q.text)}</p><p>${highlight(u, a.q, a.text)}</p></td>
        <td><p class="qsmall">${esc(b.q.text)}</p><p>${highlight(u, b.q, b.text)}</p></td></tr>`;
    }).join('');
    return `${head}
      <div class="card"><h3>오개념 변화</h3><div class="tags">${resHtml}</div></div>
      <div class="card"><h3>1차 → 2차 응답 비교</h3><p class="legend"><mark class="good">핵심 개념 표현</mark> <mark class="bad">오개념 표현</mark></p>
        <table class="compare"><thead><tr><th></th><th>1차 응답</th><th>2차 응답 (변형 문항)</th></tr></thead><tbody>${pairs}</tbody></table></div>
      <div class="card"><h3>집에서 해 볼 적용 과제</h3><p>${esc(u.activity)}</p>
        <label class="check"><input type="checkbox" data-change="activity" ${p.activity ? 'checked' : ''}> 해 봤어요</label></div>
      ${summary}`;
  },
};

// ---------- 이벤트 ----------
const ACTIONS = {
  unit(el) { store.unitId = el.dataset.id; save(); render(); },
  // 예시 확신도: 1차는 틀린 답에도 '확실해요'(과신 사례), 2차는 섞어서
  sample(el) {
    const u = unit(), form = document.getElementById(el.dataset.form);
    const first = el.dataset.form === 'first';
    const confs = first ? ['sure', 'sure', 'half'] : ['sure', 'half', 'sure'];
    Object.entries(first ? u.samples.first : u.samples.retry).forEach(([k, v], i) => {
      form.elements[k].value = v;
      form.elements[`conf_${k}`].value = confs[i];
    });
  },
  untag(el) {
    const e = (prog().edits[el.dataset.q] ||= { removed: [], added: [] });
    e.added = e.added.filter(id => id !== el.dataset.id);
    if (!e.removed.includes(el.dataset.id)) e.removed.push(el.dataset.id);
    save(); render();
  },
  publish() { prog().stage = 'feedback'; save(); location.hash = 'feedback'; },
  reset() { store = { ...fresh(), unitId: store.unitId }; ui.t0 = 0; save(); location.hash = 'learn'; render(); },
};
const CHANGES = {
  tag(el) {
    if (!el.value) return;
    const e = (prog().edits[el.dataset.q] ||= { removed: [], added: [] });
    e.removed = e.removed.filter(id => id !== el.value);
    e.added.push(el.value);
    save(); render();
  },
  coached(el) { prog().coached = el.checked; save(); },
  activity(el) { prog().activity = el.checked; save(); },
  unitSel(el) { store.unitId = el.value; ui.t0 = 0; save(); render(); },
};
const FORMS = {
  first(data) {
    const p = prog(), { answers, conf } = splitConf(data);
    Object.assign(p, { a1: answers, c1: conf, stage: 'review' });
    finishSession('reason1', Object.keys(answers).length); save(); location.hash = 'review';
  },
  second(data) {
    const p = prog(), { answers, conf } = splitConf(data);
    Object.assign(p, { a2: answers, c2: conf, stage: 'done' });
    finishSession('reason2', Object.keys(answers).length); save(); location.hash = 'growth';
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) { e.preventDefault(); ACTIONS[el.dataset.action](el); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el);
});
document.addEventListener('submit', e => {
  const form = e.target;
  if (!FORMS[form.id]) return;
  e.preventDefault();
  const data = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v).trim()]));
  if (Object.values(data).some(v => !v)) { alertBox(form, '모든 칸에 답을 쓰고 확신도를 골라 주세요'); return; }
  FORMS[form.id](data);
});
function alertBox(form, msg) {
  form.querySelector('.err')?.remove();
  form.insertAdjacentHTML('beforeend', `<p class="err">${msg}</p>`);
}

function render() {
  const hash = location.hash.slice(1) || 'learn';
  const view = VIEWS[hash] || VIEWS.learn;
  $view.innerHTML = view();
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === hash));
  document.getElementById('unitSel').innerHTML = UNITS.map(u => `<option value="${u.id}" ${u.id === store.unitId ? 'selected' : ''}>${esc(unitLabel(u))}</option>`).join('');
  document.getElementById('dayNow').textContent = `시연 ${store.day + 1}일째`;
  document.getElementById('reviewDot').hidden = prog().stage !== 'review';
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
// memory.js·metrics.js가 화면을 등록한 뒤 첫 렌더
document.addEventListener('DOMContentLoaded', render);
