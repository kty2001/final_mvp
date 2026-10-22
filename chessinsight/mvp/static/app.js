const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
};

const CLS = { best: "최선", good: "양호", inaccuracy: "부정확", mistake: "실수", blunder: "블런더", forced: "유일 수" };
const RESULT = { win: "승", draw: "무", loss: "패", unknown: "-" };
const PHASE = { opening: "오프닝", middlegame: "중반", endgame: "종반" };
const TAG = { hanging_piece: "기물 방치", missed_capture: "득점 기회 놓침", missed_mate: "메이트 놓침", allowed_mate: "메이트 허용", time_trouble: "시간 부족" };
const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const moveLabel = (ply, san) => `${Math.ceil(ply / 2)}${ply % 2 ? "." : "..."}${san}`;

let state = { game: null, idx: 0, pvTimer: null };

// ---------------------------------------------------------------- 탭
function showTab(name) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${name}`));
  if (name === "report") loadReport();
  if (name === "dashboard") loadDashboard();
  if (name === "periodic") loadReports();
}
document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ---------------------------------------------------------------- 업로드·목록
function uploadMessage(r) {
  const lines = [`추가 ${r.added}판, 중복 제외 ${r.duplicates}판, 오류 ${r.errors.length}건`];
  r.errors.forEach((e) => lines.push(`  #${e.index}: ${e.error}`));
  if (r.note) lines.push(r.note);
  $("#upload-msg").textContent = lines.join("\n");
  refreshGames();
}

$("#upload-form").onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData();
  fd.append("file", $("#pgn-file").files[0]);
  fd.append("username", $("#username").value);
  try { uploadMessage(await api("/api/games/upload", { method: "POST", body: fd })); }
  catch (err) { $("#upload-msg").textContent = `업로드 실패: ${err.message}`; }
};
$("#sample-btn").onclick = async () => uploadMessage(await api("/api/games/sample", { method: "POST" }));

let pollTimer = null;
async function refreshGames() {
  const games = await api("/api/games");
  $("#game-table tbody").innerHTML = games.map((g) => {
    const status = g.status === "done" ? "분석 완료" : g.status === "error" ? `오류: ${esc(g.error)}` : g.status === "analyzing" ? `분석 중 ${g.progress}%` : "대기";
    const me = (c) => (g.user_color === c ? " ★" : "");
    return `<tr class="${g.status === "done" ? "clickable" : ""}" data-id="${g.id}">
      <td>${esc(g.played_at)}</td><td>${esc(g.white)}${me("white")}</td><td>${esc(g.black)}${me("black")}</td>
      <td>${esc(g.result)}</td><td>${esc(g.opening)}</td><td class="status-${g.status}">${status}</td></tr>`;
  }).join("");
  document.querySelectorAll("#game-table tr.clickable").forEach((tr) => (tr.onclick = () => openGame(+tr.dataset.id, 0)));
  const busy = games.some((g) => g.status === "queued" || g.status === "analyzing");
  clearTimeout(pollTimer);
  if (busy) pollTimer = setTimeout(refreshGames, 1500);
  else if (pollTimer && $("#tab-dashboard").classList.contains("active")) loadDashboard(); // 분석 완료 직후 갱신
  if (!busy) pollTimer = null;
}

// ---------------------------------------------------------------- 리뷰
async function openGame(id, ply) {
  if (!state.game || state.game.id !== id) state.game = await api(`/api/games/${id}`);
  showTab("review");
  const g = state.game, s = g.summary;
  $("#review-empty").hidden = true;
  $("#review").hidden = false;
  $("#review-title").textContent = `${g.white} vs ${g.black} · ${g.result} · ${g.played_at ?? ""} · ${g.opening ?? ""}`;
  const phases = Object.entries(s.by_phase).map(([k, v]) => `<div class="stat">${PHASE[k]} 정확도<b>${v.accuracy}</b>${v.errors}회 실수</div>`).join("");
  $("#game-summary").innerHTML = `
    <div class="stat">내 색<b>${s.user_color === "white" ? "백" : "흑"} · ${RESULT[s.result]}</b></div>
    <div class="stat">정확도<b>${s.accuracy ?? "-"}</b>유일 수 제외</div>
    <div class="stat">부정확/실수/블런더<b>${s.counts.inaccuracy} / ${s.counts.mistake} / ${s.counts.blunder}</b></div>
    ${phases}
    <div class="stat">핵심 국면<b>${s.critical.map((c) => `<a class="ev" data-ply="${c.ply}">${esc(c.label)}</a>`).join("") || "-"}</b></div>`;
  $("#game-summary").querySelectorAll("a.ev").forEach((a) => (a.onclick = () => select(+a.dataset.ply)));
  renderMoveList();
  renderGraph();
  select(ply);
}

function renderMoveList() {
  const moves = state.game.analysis;
  let html = "";
  for (let i = 0; i < moves.length; i += 2) {
    html += `<div class="no">${i / 2 + 1}.</div>`;
    for (const m of [moves[i], moves[i + 1]]) {
      html += m ? `<div class="mv ${m.cls}" data-ply="${m.ply}">${esc(m.san)}</div>` : "<div></div>";
    }
  }
  $("#move-list").innerHTML = html;
  $("#move-list").querySelectorAll(".mv").forEach((d) => (d.onclick = () => select(+d.dataset.ply)));
}

function renderBoard(fen, highlights = {}) {
  const rows = fen.split(" ")[0].split("/");
  const squares = {};
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += +ch;
      else { squares["abcdefgh"[f] + (8 - r)] = ch; f++; }
    }
  });
  const flip = state.game.user_color === "black";
  let html = "";
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const file = flip ? 7 - f : f, rank = flip ? r + 1 : 8 - r;
      const sq = "abcdefgh"[file] + rank;
      const p = squares[sq];
      const cls = ["sq", (file + rank) % 2 ? "l" : "d", highlights[sq] || ""].join(" ");
      html += `<div class="${cls}">${p ? `<span class="${p === p.toUpperCase() ? "w" : "b"}">${GLYPH[p.toLowerCase()]}</span>` : ""}</div>`;
    }
  }
  $("#board").innerHTML = html;
}

const squaresOf = (uci, cls) => (uci ? { [uci.slice(0, 2)]: cls, [uci.slice(2, 4)]: cls } : {});

function select(idx) {
  const moves = state.game.analysis;
  state.idx = Math.max(0, Math.min(moves.length, idx));
  clearInterval(state.pvTimer);
  const m = moves[state.idx - 1];
  renderBoard(m ? m.fen_after : moves[0].fen_before, m ? squaresOf(m.uci, "played") : {});
  document.querySelectorAll(".mv").forEach((d) => d.classList.toggle("sel", +d.dataset.ply === state.idx));
  const cur = document.querySelector(".mv.sel");
  if (cur) cur.scrollIntoView({ block: "nearest" });
  renderGraph();
  renderPanel(m);
}

function renderPanel(m) {
  const panel = $("#move-panel");
  if (!m) { panel.innerHTML = "<p class='msg'>수를 선택하면 실제 수와 엔진 추천 수를 비교.</p>"; return; }
  const mine = m.color === state.game.user_color;
  const tags = m.tags.map((t) => `<span class="badge">${TAG[t]}</span>`).join(" ");
  const punished = m.punished === true ? "상대가 응징함" : m.punished === false ? "상대가 응징 못 함" : "";
  panel.innerHTML = `
    <h3>${esc(moveLabel(m.ply, m.san))} <span class="badge ${m.cls}">${CLS[m.cls]}</span> ${mine ? "" : "<small>(상대 수)</small>"}</h3>
    <table>
      <tr><th>실제 수</th><td>${esc(moveLabel(m.ply, m.san))}</td></tr>
      <tr><th>엔진 최선 수</th><td>${esc(m.best_san ? moveLabel(m.ply, m.best_san) : "-")}</td></tr>
      <tr><th>승률(둔 쪽)</th><td>${m.win_before}% → ${m.win_after}% (손실 ${m.loss}%p)</td></tr>
      <tr><th>국면</th><td>${PHASE[m.phase]}${m.clock != null ? ` · 남은 시간 ${Math.round(m.clock)}초` : ""}</td></tr>
      <tr><th>후보 수</th><td>${m.candidates.map((c) => `${esc(c.san)} (${c.win}%)`).join(", ")}</td></tr>
      ${tags || punished ? `<tr><th>태그</th><td>${tags} ${punished}</td></tr>` : ""}
    </table>
    <div class="board-nav">
      <button data-kind="why_bad">이 수가 왜 문제인가?</button>
      <button data-kind="best_move" class="secondary">엔진 추천 수는?</button>
    </div>
    <div id="explain"></div>`;
  panel.querySelectorAll("button[data-kind]").forEach((b) => (b.onclick = () => explain(m.ply, b.dataset.kind)));
}

async function explain(ply, kind) {
  const r = await api(`/api/games/${state.game.id}/moves/${ply}/explain?type=${kind}`);
  $("#explain").innerHTML = `<div class="explain">${r.text.map((t) => `<p>${esc(t)}</p>`).join("")}
    <p class="hint">근거: 엔진 최선 수 ${esc(r.evidence.best ?? "-")} · 예상 수순 ${esc(r.evidence.best_line || "-")}</p></div>`;
}

function playPv() {
  // 선택한 수 직전 포지션에서 엔진 최선 수순을 재생
  const base = state.game.analysis[Math.max(0, state.idx - 1)];
  if (!base.best_pv_fens.length) return;
  clearInterval(state.pvTimer);
  let i = -1;
  renderBoard(base.fen_before, squaresOf(base.best_uci, "best"));
  state.pvTimer = setInterval(() => {
    i++;
    if (i >= base.best_pv_fens.length) { clearInterval(state.pvTimer); return; }
    renderBoard(base.best_pv_fens[i], i === 0 ? squaresOf(base.best_uci, "best") : {});
  }, 800);
}

$("#nav-first").onclick = () => select(0);
$("#nav-prev").onclick = () => select(state.idx - 1);
$("#nav-next").onclick = () => select(state.idx + 1);
$("#nav-last").onclick = () => select(state.game.analysis.length);
$("#nav-pv").onclick = playPv;
document.addEventListener("keydown", (e) => {
  if (!$("#tab-review").classList.contains("active") || !state.game || e.target.tagName === "INPUT") return;
  if (e.key === "ArrowLeft") select(state.idx - 1);
  if (e.key === "ArrowRight") select(state.idx + 1);
});

function renderGraph() {
  const moves = state.game.analysis, n = moves.length;
  const x = (ply) => (ply / n) * 400, y = (w) => 100 - w;
  const pts = [[0, 50], ...moves.map((m) => [m.ply, m.win_white_after])];
  const marks = moves.filter((m) => m.color === state.game.user_color && ["mistake", "blunder"].includes(m.cls))
    .map((m) => `<circle cx="${x(m.ply)}" cy="${y(m.win_white_after)}" r="2.5" fill="var(--${m.cls})"/>`).join("");
  $("#graph").innerHTML = `
    <line x1="0" y1="50" x2="400" y2="50" stroke="#ccc" stroke-dasharray="3"/>
    <polyline fill="none" stroke="#3a6ea5" stroke-width="1.5" vector-effect="non-scaling-stroke" points="${pts.map(([p, w]) => `${x(p)},${y(w)}`).join(" ")}"/>
    ${marks}
    <line x1="${x(state.idx)}" y1="0" x2="${x(state.idx)}" y2="100" stroke="#d0302f" vector-effect="non-scaling-stroke"/>`;
}
$("#graph").onclick = (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  select(Math.round(((e.clientX - rect.left) / rect.width) * state.game.analysis.length));
};

// ---------------------------------------------------------------- 리포트
const evLinks = (ev) => ev.map((e) => `<a class="ev" data-game="${e.game_id}" data-ply="${e.ply}" title="vs ${esc(e.opponent)} ${esc(e.played_at)}">${esc(e.label)}</a>`).join("");
function bindEv(root) {
  root.querySelectorAll("a.ev[data-game]").forEach((a) => (a.onclick = () => openGame(+a.dataset.game, +a.dataset.ply)));
}

async function loadReport() {
  const rep = await api(`/api/report?days=${$("#days").value}`);
  const o = rep.overview;
  $("#overview").innerHTML = `
    <div class="stat">분석 대국<b>${o.games}판</b></div>
    <div class="stat">전적<b>${o.win}승 ${o.draw}무 ${o.loss}패</b></div>
    <div class="stat">평균 정확도<b>${o.accuracy ?? "-"}</b></div>
    ${rep.all ? `<div class="stat">실수 이상<b>${rep.all.errors}회</b>100수당 ${rep.all.rate}회</div>` : ""}
    ${o.sample_note ? `<div class="stat">${esc(o.sample_note)}</div>` : ""}`;

  $("#weak-table tbody").innerHTML = rep.weaknesses.map((w) => `<tr>
    <td>${esc(w.label)}</td><td>${w.errors}</td><td>${w.rate}</td><td>${w.games_with}판</td><td>${w.punished}</td>
    <td>${w.confidence}</td><td>${evLinks(w.evidence)}</td></tr>`).join("") || "<tr><td colspan=7>태그가 붙은 실수 없음</td></tr>";
  $("#break-table tbody").innerHTML = [...rep.phases, ...rep.colors].map((w) => `<tr>
    <td>${esc(w.label)}</td><td>${w.moves}</td><td>${w.errors}</td><td>${w.rate}</td><td>${w.confidence}</td><td>${evLinks(w.evidence.slice(0, 3))}</td></tr>`).join("");

  const p = rep.period;
  $("#period-range").textContent = `이전 ${p.prev_range[0]}~${p.prev_range[1]} (${p.prev_games}판) vs 최근 ${p.cur_range[0]}~${p.cur_range[1]} (${p.cur_games}판)`;
  $("#period-table tbody").innerHTML = p.rows.map((r) => `<tr>
    <td>${esc(r.label)}</td><td>${r.prev.rate} <small>(${r.prev.errors}/${r.prev.moves})</small></td>
    <td>${r.cur.rate} <small>(${r.cur.errors}/${r.cur.moves})</small></td>
    <td class="${r.verdict === "개선" ? "verdict-개선" : r.verdict === "악화" ? "verdict-악화" : ""}">${r.verdict}</td></tr>`).join("");

  $("#recs").innerHTML = rep.recommendations.map((r) => `<li><b>${esc(r.text)}</b><br><span class="hint">근거: ${esc(r.reason)}${r.note ? ` · ${esc(r.note)}` : ""}</span></li>`).join("") || "<li>추천할 데이터 부족</li>";
  bindEv($("#tab-report"));
}
$("#days").onchange = loadReport;

async function ask(q) {
  if (!q.trim()) return;
  const r = await api("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, days: +$("#days").value }) });
  const div = document.createElement("div");
  div.innerHTML = `<div class="q">Q. ${esc(q)}</div><div class="a">${r.text.map((t) => `<p>${esc(t)}</p>`).join("")}
    ${r.evidence.length ? `<p class="hint">근거 수: ${evLinks(r.evidence)}</p>` : ""}
    ${r.suggestions ? `<p class="hint">예시: ${r.suggestions.map(esc).join(" / ")}</p>` : ""}</div>`;
  $("#chat").prepend(div);
  bindEv(div);
}
$("#ask-form").onsubmit = (e) => { e.preventDefault(); ask($("#question").value); $("#question").value = ""; };
api("/api/suggestions").then((s) => {
  $("#suggestions").innerHTML = s.map((q) => `<button type="button">${esc(q)}</button>`).join("");
  $("#suggestions").querySelectorAll("button").forEach((b) => (b.onclick = () => ask(b.textContent)));
});

// ---------------------------------------------------------------- 대시보드
// 범주 색은 엔티티에 고정(순위로 바꾸지 않음). dataviz 기본 팔레트, 검증 통과 순서.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const ERROR_COLOR = { all: SERIES[0], hanging_piece: SERIES[1], missed_capture: SERIES[2], missed_mate: SERIES[3], allowed_mate: SERIES[4], time_trouble: SERIES[5] };
const INK = { secondary: "#52514e", muted: "#898781", grid: "#e1e0d9" };
const charts = {};
const fmtSigned = (v) => (v > 0 ? `+${v}` : `${v}`);

function drawChart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}

function baseOptions(points, extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", align: "start", labels: { color: INK.secondary, boxWidth: 12, boxHeight: 2 } },
      tooltip: {
        callbacks: {
          title: (items) => {
            const p = points[items[0].dataIndex];
            return p ? `${p.date} vs ${p.opponent} (${RESULT[p.result]})` : items[0].label;
          },
          footer: (items) => {
            const p = points[items[0].dataIndex];
            return p ? `이동 집계 ${p.rolling.n}판${p.rolling.n < state.window ? " · 표본 부족" : ""}` : "";
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: INK.muted, maxRotation: 0, autoSkipPadding: 12 } },
      y: { grid: { color: INK.grid }, border: { display: false }, ticks: { color: INK.muted }, ...extra.y },
    },
    onClick: (evt, els) => { if (els.length && points[els[0].index]) openGame(points[els[0].index].game_id, 0); },
    onHover: (evt, els) => { evt.native.target.style.cursor = els.length && points.length ? "pointer" : "default"; },
  };
}

function lineSet(label, data, color, points, opts = {}) {
  return {
    label, data, borderColor: color, backgroundColor: color, borderWidth: 2,
    pointRadius: 2.5, pointHoverRadius: 5, pointHitRadius: 8, tension: 0, spanGaps: true,
    // 이동 집계 포함 판 수가 기준 미만인 구간은 점선
    segment: opts.rolling ? { borderDash: (ctx) => (points[ctx.p1DataIndex].rolling.n < state.window ? [4, 4] : undefined) } : undefined,
    ...opts.extra,
  };
}

async function loadDashboard() {
  state.window = 10;
  const d = await api(`/api/dashboard?window=${state.window}`);
  const pts = d.points;
  $("#dash-empty").hidden = pts.length > 0;
  $("#dash").hidden = pts.length === 0;
  if (!pts.length) return;
  $("#win-size").textContent = d.window;
  const o = d.overview;
  $("#kpis").innerHTML = `
    <div class="stat">분석 대국<b>${o.games}판</b><small>${pts[0].date} ~ ${pts[pts.length - 1].date}</small></div>
    <div class="stat">전적<b>${o.win}승 ${o.draw}무 ${o.loss}패</b></div>
    <div class="stat">현재 레이팅<b>${o.rating ?? "-"}</b><small>${o.rating_change != null ? `첫 대국 대비 ${fmtSigned(o.rating_change)}` : "레이팅 정보 없음"}</small></div>
    <div class="stat">최근 ${o.recent_n}판 정확도<b>${o.recent_accuracy ?? "-"}</b><small>전체 평균 ${o.accuracy ?? "-"}</small></div>`;

  const labels = pts.map((p) => p.date.slice(5));

  if (pts.some((p) => p.rating != null)) {
    drawChart("ch-rating", { type: "line", data: { labels, datasets: [
      lineSet("내 레이팅", pts.map((p) => p.rating), SERIES[0], pts),
      lineSet("상대 레이팅", pts.map((p) => p.opp_rating), SERIES[1], pts, { extra: { showLine: false, pointRadius: 3.5, pointStyle: "rectRot" } }),
    ] }, options: baseOptions(pts) });
  }

  drawChart("ch-perf", { type: "line", data: { labels, datasets: [
    lineSet("정확도", pts.map((p) => p.rolling.accuracy), SERIES[0], pts, { rolling: true }),
    lineSet("득점률(승=1, 무=0.5)", pts.map((p) => p.rolling.score_rate), SERIES[1], pts, { rolling: true }),
  ] }, options: baseOptions(pts, { y: { min: 0, max: 100 } }) });

  const usedTags = Object.keys(d.tag_labels).filter((t) => pts.some((p) => p.tags[t] > 0));
  drawChart("ch-errors", { type: "line", data: { labels, datasets: [
    lineSet("전체", pts.map((p) => p.rolling.error_rate), ERROR_COLOR.all, pts, { rolling: true }),
    ...usedTags.map((t) => lineSet(d.tag_labels[t], pts.map((p) => p.rolling.tag_rates[t]), ERROR_COLOR[t], pts, { rolling: true })),
  ] }, options: baseOptions(pts, { y: { min: 0 } }) });

  const months = d.phase_monthly;
  const PHASES = ["opening", "middlegame", "endgame"];
  const phaseOpts = baseOptions([], { y: { min: 0, max: 100 } });
  phaseOpts.plugins.tooltip.callbacks = {
    label: (ctx) => {
      const v = months[ctx.dataIndex][PHASES[ctx.datasetIndex]];
      return v ? `${ctx.dataset.label}: ${v.accuracy} (내 수 ${v.moves}수)` : `${ctx.dataset.label}: 데이터 없음`;
    },
  };
  drawChart("ch-phase", { type: "bar", data: { labels: months.map((m) => m.month), datasets:
    PHASES.map((ph, i) => ({
      label: d.phase_labels[ph], data: months.map((m) => m[ph]?.accuracy ?? null),
      backgroundColor: SERIES[i], borderRadius: 4, borderSkipped: "bottom",
      borderColor: "#fff", borderWidth: { left: 1, right: 1 }, maxBarThickness: 28,
    })) }, options: phaseOpts });

  $("#dash-table").innerHTML = `<thead><tr><th>날짜</th><th>상대</th><th>결과</th><th>내 레이팅</th><th>상대 레이팅</th><th>정확도</th><th>실수 이상</th>
    <th>이동 집계 판수</th><th>이동 정확도</th><th>이동 득점률</th><th>이동 실수율(100수당)</th></tr></thead><tbody>` +
    pts.slice().reverse().map((p) => `<tr class="clickable" data-id="${p.game_id}"><td>${p.date}</td><td>${esc(p.opponent)}</td><td>${RESULT[p.result]}</td>
      <td>${p.rating ?? "-"}</td><td>${p.opp_rating ?? "-"}</td><td>${p.accuracy ?? "-"}</td><td>${p.errors}</td>
      <td>${p.rolling.n}${p.rolling.n < d.window ? " (부족)" : ""}</td><td>${p.rolling.accuracy ?? "-"}</td><td>${p.rolling.score_rate}</td><td>${p.rolling.error_rate ?? "-"}</td></tr>`).join("") + "</tbody>";
  $("#dash-table").querySelectorAll("tr.clickable").forEach((tr) => (tr.onclick = () => openGame(+tr.dataset.id, 0)));
}

// ---------------------------------------------------------------- 정기 리포트
const KIND = { weekly: "주간", monthly: "월간" };

function verdictSummary(verdicts) {
  if (!verdicts.length) return "비교 대상 없음";
  if (verdicts.every((v) => v.startsWith("판단 보류"))) return "판단 보류(표본 부족)";
  const up = verdicts.filter((v) => v === "개선").length, down = verdicts.filter((v) => v === "악화").length;
  return [up && `개선 ${up}`, down && `악화 ${down}`].filter(Boolean).join(" · ") || "유의한 변화 없음";
}

async function loadReports() {
  const list = await api(`/api/reports?kind=${$("#period-kind").value}`);
  $("#report-list tbody").innerHTML = list.map((r) => {
    const o = r.overview;
    const rating = o.rating_start != null ? `${o.rating_start} → ${o.rating_end}` : "-";
    return `<tr class="clickable" data-id="${r.id}"><td>${r.period_start} ~ ${r.period_end}</td><td>${r.n_games}판</td>
      <td>${o.win}승 ${o.draw}무 ${o.loss}패</td><td>${o.accuracy ?? "-"}</td><td>${rating}</td><td>${verdictSummary(r.previous_verdicts)}</td></tr>`;
  }).join("") || "<tr><td colspan=6>생성된 리포트 없음. 대국 분석이 끝나면 자동 생성.</td></tr>";
  $("#report-list").querySelectorAll("tr.clickable").forEach((tr) => (tr.onclick = () => loadReportDetail(+tr.dataset.id)));
  if (list.length) loadReportDetail(list[0].id); else $("#report-detail").innerHTML = "";
}
$("#period-kind").onchange = loadReports;

let reportReq = 0;
async function loadReportDetail(id) {
  const req = ++reportReq;
  document.querySelectorAll("#report-list tr").forEach((tr) => tr.classList.toggle("sel", +tr.dataset.id === id));
  const r = await api(`/api/reports/${id}`);
  if (req !== reportReq) return; // 더 나중에 선택한 리포트가 있으면 무시
  const o = r.overview;
  const tcs = Object.entries(o.time_controls).map(([k, v]) => `${esc(k)} ${v}판`).join(", ");
  const ratingDelta = o.rating_start != null && o.rating_end != null ? ` (${fmtSigned(o.rating_end - o.rating_start)})` : "";
  const prev = r.previous;
  const verdictCls = (v) => (v === "개선" ? "verdict-개선" : v === "악화" ? "verdict-악화" : "");
  const statRows = (rows, withMoves) => rows.map((w) => `<tr><td>${esc(w.label)}</td>${withMoves ? `<td>${w.moves}</td>` : ""}
    <td>${w.errors}</td><td>${w.rate}</td><td>${w.confidence}</td><td>${evLinks(w.evidence.slice(0, 4))}</td></tr>`).join("");

  $("#report-detail").innerHTML = `
    <div class="card">
      <h2>${KIND[r.kind]} 리포트 · ${r.start} ~ ${r.end} <small>생성 ${esc(r.generated_at)} (UTC)</small></h2>
      <div class="summary">
        <div class="stat">대국<b>${o.games}판</b></div>
        <div class="stat">전적<b>${o.win}승 ${o.draw}무 ${o.loss}패</b></div>
        <div class="stat">평균 정확도<b>${o.accuracy ?? "-"}</b></div>
        <div class="stat">레이팅<b>${o.rating_start ?? "-"} → ${o.rating_end ?? "-"}${ratingDelta}</b></div>
        <div class="stat">상대 평균 레이팅<b>${o.opp_rating_avg ?? "-"}</b></div>
        <div class="stat">시간제어<b>${tcs || "-"}</b></div>
      </div>
      <p class="note">${esc(o.context_note)}</p>
    </div>
    <div class="card">
      <h2>직전 리포트 대비</h2>
      ${prev ? `<p class="hint">직전: ${prev.start} ~ ${prev.end} (${prev.games}판, 정확도 ${prev.accuracy ?? "-"}) → 이번: ${o.games}판, 정확도 ${o.accuracy ?? "-"}. 판정은 양쪽 모두 5판 이상일 때만 2-비율 z검정으로 산출.</p>
        <table><thead><tr><th>항목</th><th>직전 (100수당)</th><th>이번 (100수당)</th><th>판정</th></tr></thead><tbody>
        ${prev.rows.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.prev.rate} <small>(${x.prev.errors}/${x.prev.moves})</small></td>
          <td>${x.cur.rate} <small>(${x.cur.errors}/${x.cur.moves})</small></td><td class="${verdictCls(x.verdict)}">${x.verdict}</td></tr>`).join("")}
        </tbody></table>` : "<p class='msg'>첫 리포트라 비교 대상 없음.</p>"}
    </div>
    <div class="card">
      <h2>반복 약점 <small>실수·블런더 기준</small></h2>
      <table><thead><tr><th>유형</th><th>횟수</th><th>100수당</th><th>신뢰도</th><th>근거</th></tr></thead>
        <tbody>${statRows(r.weaknesses, false) || "<tr><td colspan=5>태그가 붙은 실수 없음</td></tr>"}</tbody></table>
      <h3>국면·색별</h3>
      <table><thead><tr><th>구분</th><th>내 수</th><th>실수 이상</th><th>100수당</th><th>신뢰도</th><th>근거</th></tr></thead>
        <tbody>${statRows([...r.phases, ...r.colors], true)}</tbody></table>
    </div>
    <div class="card">
      <h2>다음 훈련 권장</h2>
      <ul>${r.recommendations.map((x) => `<li><b>${esc(x.text)}</b><br><span class="hint">근거: ${esc(x.reason)}${x.note ? ` · ${esc(x.note)}` : ""}</span></li>`).join("") || "<li>추천할 데이터 부족</li>"}</ul>
    </div>`;
  bindEv($("#report-detail"));
}

refreshGames();
loadDashboard();
