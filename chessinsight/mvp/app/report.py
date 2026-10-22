"""대국별 요약, 여러 대국의 반복 약점 통계, 기간 비교."""
import math
from datetime import date, timedelta

ERRORS = ("inaccuracy", "mistake", "blunder")
SERIOUS = ("mistake", "blunder")
MIN_GAMES = 5          # 이보다 적으면 결론 보류
MIN_TAG_COUNT = 3

TAG_LABEL = {
    "hanging_piece": "기물을 잡히게 둠",
    "missed_capture": "기물 득점 기회 놓침",
    "missed_mate": "메이트 기회 놓침",
    "allowed_mate": "메이트 허용",
    "time_trouble": "시간 부족(30초 미만) 중 실수",
}
PHASE_LABEL = {"opening": "오프닝", "middlegame": "중반", "endgame": "종반"}
COLOR_LABEL = {"white": "백", "black": "흑"}
CLS_LABEL = {"best": "최선", "good": "양호", "inaccuracy": "부정확", "mistake": "실수",
             "blunder": "블런더", "forced": "유일 수"}
TRAINING = {
    "hanging_piece": "수를 두기 전 '내 기물 중 지켜지지 않은 것'을 확인하는 습관, 기물 방치 테마 퍼즐",
    "missed_capture": "상대의 무방비 기물을 찾는 전술 퍼즐(잡히는 기물·이중 공격)",
    "missed_mate": "메이트 패턴 퍼즐(1~3수 메이트)",
    "allowed_mate": "킹 안전 점검: 상대 체크·잡기·위협 수를 먼저 확인",
    "time_trouble": "시간 관리 연습: 오프닝·쉬운 수에서 시간 아끼기, 증분 있는 시간제어로 연습",
    "endgame": "기본 종반 학습(킹 활용, 폰 종반, 룩 종반)",
    "opening": "주로 쓰는 오프닝의 첫 10수 복습",
    "middlegame": "중반 계획 세우기·전술 퍼즐",
}


def move_label(ply, san):
    n = (ply + 1) // 2
    return f"{n}.{san}" if ply % 2 == 1 else f"{n}...{san}"


def accuracy(loss):
    """수 하나의 정확도(0~100). Lichess 공개 식."""
    return max(0.0, min(100.0, 103.1668 * math.exp(-0.04354 * loss) - 3.1669))


def _user_moves(game):
    return [m for m in game["analysis"] if m["color"] == game["user_color"]]


def _user_result(game):
    r = game["result"]
    if r == "1/2-1/2":
        return "draw"
    if r not in ("1-0", "0-1"):
        return "unknown"
    won = (r == "1-0") == (game["user_color"] == "white")
    return "win" if won else "loss"


def game_summary(game):
    moves = _user_moves(game)
    scored = [m for m in moves if m["cls"] != "forced"]
    counts = {k: sum(1 for m in moves if m["cls"] == k) for k in CLS_LABEL}
    by_phase = {}
    for phase in PHASE_LABEL:
        pm = [m for m in scored if m["phase"] == phase]
        if pm:
            by_phase[phase] = {"moves": len(pm), "errors": sum(m["cls"] in ERRORS for m in pm),
                               "accuracy": round(sum(accuracy(m["loss"]) for m in pm) / len(pm), 1)}
    critical = sorted((m for m in moves if m["cls"] in ERRORS), key=lambda m: -m["loss"])[:3]
    return {
        "user_color": game["user_color"],
        "result": _user_result(game),
        "accuracy": round(sum(accuracy(m["loss"]) for m in scored) / len(scored), 1) if scored else None,
        "counts": counts,
        "by_phase": by_phase,
        "critical": [{"ply": m["ply"], "label": move_label(m["ply"], m["san"]), "cls": m["cls"]} for m in critical],
    }


def _evidence(game, m):
    opponent = game["black"] if game["user_color"] == "white" else game["white"]
    return {"game_id": game["id"], "ply": m["ply"], "label": move_label(m["ply"], m["san"]),
            "cls": m["cls"], "loss": m["loss"], "opponent": opponent, "played_at": game["played_at"]}


def _confidence(n_games, count):
    if n_games < MIN_GAMES or count < MIN_TAG_COUNT:
        return "표본 부족"
    if n_games < 15:
        return "참고 수준"
    return "충분"


def _stats(games):
    """태그·국면·색별 집계. 실수(mistake 이상)만 약점으로 셈."""
    rows = {}

    def add(key, label, kind, game, m, is_err, count_move=True):
        r = rows.setdefault(key, {"key": key, "label": label, "kind": kind, "moves": 0,
                                  "errors": 0, "punished": 0, "games": set(), "evidence": []})
        r["moves"] += 1 if count_move else 0
        if is_err:
            r["errors"] += 1
            r["games"].add(game["id"])
            r["punished"] += 1 if m.get("punished") else 0
            r["evidence"].append(_evidence(game, m))

    total_moves = 0
    for g in games:
        for m in _user_moves(g):
            if m["cls"] == "forced":
                continue
            total_moves += 1
            is_err = m["cls"] in SERIOUS
            add(m["phase"], PHASE_LABEL[m["phase"]], "phase", g, m, is_err)
            add(m["color"], COLOR_LABEL[m["color"]], "color", g, m, is_err)
            add("all", "전체", "all", g, m, is_err)
            if is_err:
                for t in m["tags"]:
                    add(t, TAG_LABEL[t], "tag", g, m, True, count_move=False)
    # 태그 비율의 분모는 전체 내 수
    for r in rows.values():
        if r["kind"] == "tag":
            r["moves"] = total_moves
    return rows


def _finalize(rows, n_games):
    out = []
    for r in rows.values():
        out.append({
            "key": r["key"], "label": r["label"], "kind": r["kind"],
            "errors": r["errors"], "moves": r["moves"], "games_with": len(r["games"]),
            "rate": round(100 * r["errors"] / r["moves"], 1) if r["moves"] else 0.0,
            "punished": r["punished"],
            "confidence": _confidence(n_games, r["errors"]),
            "evidence": sorted(r["evidence"], key=lambda e: -e["loss"])[:5],
        })
    return out


def _compare(prev_rows, cur_rows, n_prev, n_cur):
    out = []
    for key in sorted(set(prev_rows) | set(cur_rows)):
        p, c = prev_rows.get(key), cur_rows.get(key)
        kind = (p or c)["kind"]
        # 한 기간에 태그가 없으면 실수 0회, 분모는 그 기간 전체 내 수
        default = lambda rows: (0, rows["all"]["moves"] if kind == "tag" and "all" in rows else 0)
        e1, n1 = (p["errors"], p["moves"]) if p else default(prev_rows)
        e2, n2 = (c["errors"], c["moves"]) if c else default(cur_rows)
        label = (p or c)["label"]
        r1 = e1 / n1 if n1 else 0.0
        r2 = e2 / n2 if n2 else 0.0
        if n_prev < MIN_GAMES or n_cur < MIN_GAMES or not n1 or not n2:
            verdict = "판단 보류(표본 부족)"
        else:
            pooled = (e1 + e2) / (n1 + n2)
            se = math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2)) if 0 < pooled < 1 else 0
            z = (r2 - r1) / se if se else 0
            verdict = "유의한 변화 없음" if abs(z) < 1.96 else ("개선" if z < 0 else "악화")
        out.append({"key": key, "label": label, "kind": kind,
                    "prev": {"errors": e1, "moves": n1, "rate": round(100 * r1, 1)},
                    "cur": {"errors": e2, "moves": n2, "rate": round(100 * r2, 1)},
                    "verdict": verdict})
    return out


def _game_date(g):
    return date.fromisoformat(g["played_at"] or g["created_at"][:10])


def _recommend(stats):
    tags = sorted((s for s in stats if s["kind"] == "tag"), key=lambda s: -s["errors"])
    phases = [s for s in stats if s["kind"] == "phase"]
    weak_phase = max(phases, key=lambda s: s["rate"], default=None)
    recs = []
    for s in tags[:2] + ([weak_phase] if weak_phase else []):
        if s["errors"] == 0:
            continue
        reason = f"{s['label']}: 실수 {s['errors']}회(대국 {s['games_with']}판)"
        note = "표본이 적어 단정하지 않음. 대국을 더 쌓아 재확인 권장" if s["confidence"] == "표본 부족" else None
        recs.append({"key": s["key"], "text": TRAINING[s["key"]], "reason": reason, "note": note})
    return recs


def _overview(games):
    results = [_user_result(g) for g in games]
    accs = [a for a in (game_summary(g)["accuracy"] for g in games) if a is not None]
    return {
        "games": len(games),
        "win": results.count("win"), "draw": results.count("draw"), "loss": results.count("loss"),
        "accuracy": round(sum(accs) / len(accs), 1) if accs else None,
    }


def _sections(stats):
    return {
        "weaknesses": sorted((s for s in stats if s["kind"] == "tag"), key=lambda s: -s["errors"]),
        "phases": [s for s in stats if s["kind"] == "phase"],
        "colors": [s for s in stats if s["kind"] == "color"],
        "all": next((s for s in stats if s["kind"] == "all"), None),
        "recommendations": _recommend(stats),
    }


def build_report(games, days=30, end=None):
    games = [g for g in games if g["analysis"]]
    n = len(games)
    stats = _finalize(_stats(games), n)

    # 기간 비교: 기준일(기본 = 가장 최근 대국일)부터 직전 days일 vs 그 이전 days일
    end_d = date.fromisoformat(end) if end else max((_game_date(g) for g in games), default=date.today())
    cur_start = end_d - timedelta(days=days)
    prev_start = cur_start - timedelta(days=days)
    cur = [g for g in games if cur_start < _game_date(g) <= end_d]
    prev = [g for g in games if prev_start < _game_date(g) <= cur_start]
    comparison = _compare(_stats(prev), _stats(cur), len(prev), len(cur))

    overview = _overview(games)
    overview["sample_note"] = None if n >= MIN_GAMES else f"분석된 대국 {n}판: 반복 약점 판단에는 최소 {MIN_GAMES}판 필요"
    return {
        "overview": overview,
        **_sections(stats),
        "period": {
            "days": days, "end": end_d.isoformat(),
            "cur_range": [(cur_start + timedelta(days=1)).isoformat(), end_d.isoformat()],
            "prev_range": [(prev_start + timedelta(days=1)).isoformat(), cur_start.isoformat()],
            "cur_games": len(cur), "prev_games": len(prev),
            "rows": comparison,
        },
    }


# ---------------------------------------------------------------- 대시보드 추이

def _ratings(game):
    """(내 레이팅, 상대 레이팅). 헤더가 없거나 숫자가 아니면 None."""
    mine, theirs = ("white_elo", "black_elo") if game["user_color"] == "white" else ("black_elo", "white_elo")
    as_int = lambda v: int(v) if v and str(v).isdigit() else None
    return as_int(game[mine]), as_int(game[theirs])


def _chrono(games):
    return sorted((g for g in games if g["analysis"]), key=lambda g: (_game_date(g), g["id"]))


def trend(games, window=10):
    """대국별 포인트 + 직전 window판 이동 집계(n < window면 표본 부족)."""
    games = _chrono(games)
    points = []
    for g in games:
        s = game_summary(g)
        moves = [m for m in _user_moves(g) if m["cls"] != "forced"]
        errors = [m for m in moves if m["cls"] in SERIOUS]
        rating, opp_rating = _ratings(g)
        points.append({
            "game_id": g["id"], "date": _game_date(g).isoformat(), "result": s["result"],
            "opponent": g["black"] if g["user_color"] == "white" else g["white"],
            "rating": rating, "opp_rating": opp_rating, "time_control": g["time_control"],
            "accuracy": s["accuracy"], "moves": len(moves), "errors": len(errors),
            "tags": {t: sum(t in m["tags"] for m in errors) for t in TAG_LABEL},
        })
    for i, p in enumerate(points):
        win = points[max(0, i - window + 1): i + 1]
        moves = sum(w["moves"] for w in win)
        accs = [w["accuracy"] for w in win if w["accuracy"] is not None]
        p["rolling"] = {
            "n": len(win),
            "score_rate": round(100 * sum({"win": 1, "draw": 0.5}.get(w["result"], 0) for w in win) / len(win), 1),
            "accuracy": round(sum(accs) / len(accs), 1) if accs else None,
            "error_rate": round(100 * sum(w["errors"] for w in win) / moves, 2) if moves else None,
            "tag_rates": {t: round(100 * sum(w["tags"][t] for w in win) / moves, 2) if moves else None
                          for t in TAG_LABEL},
        }

    # 월별 국면 정확도 (수 개수 가중 평균)
    by_month = {}
    for g in games:
        for phase, v in game_summary(g)["by_phase"].items():
            acc = by_month.setdefault(_game_date(g).strftime("%Y-%m"), {}).setdefault(phase, [0.0, 0])
            acc[0] += v["accuracy"] * v["moves"]
            acc[1] += v["moves"]
    phase_monthly = [{"month": m, **{ph: {"accuracy": round(a / n, 1), "moves": n} for ph, (a, n) in v.items()}}
                     for m, v in sorted(by_month.items())]

    rated = [p for p in points if p["rating"] is not None]
    recent_acc = [p["accuracy"] for p in points[-window:] if p["accuracy"] is not None]
    return {
        "window": window,
        "overview": {
            **_overview(games),
            "rating": rated[-1]["rating"] if rated else None,
            "rating_change": rated[-1]["rating"] - rated[0]["rating"] if len(rated) > 1 else None,
            "recent_accuracy": round(sum(recent_acc) / len(recent_acc), 1) if recent_acc else None,
            "recent_n": len(points[-window:]),
        },
        "points": points,
        "phase_monthly": phase_monthly,
        "tag_labels": TAG_LABEL,
        "phase_labels": PHASE_LABEL,
    }


# ---------------------------------------------------------------- 정기 리포트

def period_bounds(kind, d):
    """d가 속한 주(월요일 시작) 또는 월의 (시작일, 종료일)."""
    if kind == "weekly":
        start = d - timedelta(days=d.weekday())
        return start, start + timedelta(days=6)
    start = d.replace(day=1)
    return start, (start + timedelta(days=32)).replace(day=1) - timedelta(days=1)


def periods(games, kind):
    """완료된 대국이 있는 기간 목록(시간순)."""
    return sorted({period_bounds(kind, _game_date(g)) for g in games if g["analysis"]})


def period_report(games, kind, start, end, prev=None):
    """start~end(포함) 대국으로 리포트 생성. prev = 직전 같은 종류 리포트의 data."""
    games = [g for g in _chrono(games) if start <= _game_date(g) <= end]
    rows = _stats(games)
    stats = _finalize(rows, len(games))
    ratings = [_ratings(g) for g in games]
    mine = [r for r, _ in ratings if r is not None]
    opp = [o for _, o in ratings if o is not None]
    tcs = {}
    for g in games:
        tcs[g["time_control"] or "?"] = tcs.get(g["time_control"] or "?", 0) + 1
    note = "레이팅 변화만으로 실력 변화를 단정하지 않음. 상대 수준·대국 수·시간제어를 함께 확인 필요."
    if len(games) < MIN_GAMES:
        note += f" 대국 {len(games)}판으로 표본 부족."
    data = {
        "kind": kind, "start": start.isoformat(), "end": end.isoformat(),
        "overview": {
            **_overview(games),
            "rating_start": mine[0] if mine else None, "rating_end": mine[-1] if mine else None,
            "opp_rating_avg": round(sum(opp) / len(opp)) if opp else None,
            "time_controls": tcs, "context_note": note,
        },
        **_sections(stats),
        # 다음 리포트의 비교 기준으로 쓰는 원시 집계
        "raw": {k: {"label": r["label"], "kind": r["kind"], "errors": r["errors"], "moves": r["moves"]}
                for k, r in rows.items()},
        "previous": None,
    }
    if prev:
        data["previous"] = {
            "start": prev["start"], "end": prev["end"], "games": prev["overview"]["games"],
            "accuracy": prev["overview"]["accuracy"],
            "rows": _compare(prev["raw"], rows, prev["overview"]["games"], len(games)),
        }
    return data
