"""엔진 근거 → 템플릿 해설, 리포트에 대한 닫힌 질문 유형 응답. LLM 미사용."""
from .report import TAG_LABEL, move_label

SAME_LIMIT = 5  # 승률 손실이 이보다 작으면 "사실상 같은 수"로 보고 이유를 만들지 않음 (기획서 4.6 ③)


def _state(win):
    if win >= 80:
        return "크게 유리"
    if win >= 60:
        return "유리"
    if win > 40:
        return "비슷한 형세"
    if win > 20:
        return "불리"
    return "크게 불리"


def _loss_word(loss):
    if loss < SAME_LIMIT:
        return "사실상 차이 없음"
    if loss < 10:
        return "근소한 손해"
    if loss < 20:
        return "부정확한 수 수준의 손해"
    if loss < 30:
        return "실수 수준의 손해"
    return "결정적인 손해(블런더)"


def _line(start_ply, sans):
    """수순을 번호 붙은 표기로. start_ply = 첫 수의 ply."""
    out = []
    for i, san in enumerate(sans):
        ply = start_ply + i
        if i == 0 or ply % 2 == 1:
            out.append(move_label(ply, san))
        else:
            out.append(san)
    return " ".join(out)


def explain(m, kind="why_bad"):
    played = move_label(m["ply"], m["san"])
    best = move_label(m["ply"], m["best_san"]) if m["best_san"] else None
    evidence = {
        "fen": m["fen_before"], "played": played, "best": best,
        "best_line": _line(m["ply"], m["best_pv"]),
        "refutation": _line(m["ply"] + 1, m["refutation"]),
        "loss_word": _loss_word(m["loss"]), "tags": [TAG_LABEL[t] for t in m["tags"]],
    }
    lines = []

    if m["cls"] == "forced":
        lines.append(f"{played}: 둘 수 있는 수가 하나뿐인 포지션. 평가 대상에서 제외.")
        return {"kind": kind, "text": lines, "evidence": evidence}

    if kind == "best_move":
        if m["san"] == m["best_san"]:
            lines.append(f"실제로 둔 {played}가 엔진 최선 수.")
        else:
            lines.append(f"엔진 최선 수는 {best}.")
        if m["best_pv"]:
            lines.append(f"엔진 예상 수순: {evidence['best_line']}.")
        others = m["candidates"][1:]
        if others:
            parts = []
            top = m["candidates"][0]["win"]
            for c in others:
                parts.append(f"{move_label(m['ply'], c['san'])}({_loss_word(max(0.0, top - c['win']))})")
            lines.append("다른 후보: " + ", ".join(parts) + ".")
        if m["san"] != m["best_san"]:
            lines.append(f"실제 수 {played}와의 차이: {evidence['loss_word']}.")
        return {"kind": kind, "text": lines, "evidence": evidence}

    # why_bad: 내 수의 문제 — 최선 수 정보는 근거 확인용으로만 덧붙임
    if m["loss"] < SAME_LIMIT:
        lines.append(f"{played}는 엔진 최선 수와 사실상 같은 수준. 문제가 있다고 단정할 근거 없음.")
        return {"kind": kind, "text": lines, "evidence": evidence}

    before, after = _state(m["win_before"]), _state(m["win_after"])
    if before == after:
        lines.append(f"{played} 이후에도 형세는 '{after}'이지만 {evidence['loss_word']}가 발생.")
    else:
        lines.append(f"{played}로 형세가 '{before}'에서 '{after}'(으)로 바뀜({evidence['loss_word']}).")

    tags = m["tags"]
    if "allowed_mate" in tags:
        lines.append(f"이 수 뒤 상대에게 강제 메이트 수순이 생김: {evidence['refutation']}.")
    elif "hanging_piece" in tags and m["refutation"]:
        piece = m.get("refutation_capture") or "기물"
        lines.append(f"상대가 {move_label(m['ply'] + 1, m['refutation'][0])}로 {piece}을(를) 잡을 수 있게 됨.")
    elif m["refutation"]:
        lines.append(f"엔진이 본 상대의 최선 응수: {evidence['refutation']}.")
    if "missed_mate" in tags and best:
        lines.append(f"직전 포지션에는 {best}로 시작하는 메이트 수순이 있었음.")
    if "missed_capture" in tags and best:
        piece = m.get("best_capture") or "기물"
        lines.append(f"{best}로 상대 {piece}을(를) 잡을 기회가 있었음.")
    if "time_trouble" in tags:
        lines.append(f"남은 시간 {int(m['clock'])}초 상황에서 둔 수.")
    if m.get("punished") is True:
        lines.append("상대가 바로 다음 수로 이 실수를 응징함.")
    elif m.get("punished") is False:
        lines.append("상대가 응징하지 못해 손해가 바로 드러나지 않았음. 같은 실수는 강한 상대에게 통하지 않음.")
    if not (set(tags) & {"allowed_mate", "hanging_piece", "missed_mate", "missed_capture"}):
        lines.append("검출된 전술 패턴은 없음. 엔진 판단의 원인을 단정하지 않으며, 예상 수순으로 직접 확인 권장.")
    return {"kind": kind, "text": lines, "evidence": evidence}


# ---------------------------------------------------------------- 리포트 질의

QUESTION_TYPES = [
    ("time", ["시간", "초읽기", "타임"]),
    ("period", ["개선", "악화", "비교", "지난", "변화", "달라", "나아"]),
    ("color", ["백", "흑", "색"]),
    ("phase", ["종반", "엔드", "중반", "오프닝", "초반", "국면"]),
    ("top", ["자주", "반복", "가장", "약점", "많이"]),
    ("summary", ["요약", "전체", "성적", "정확도"]),
]

SUGGESTIONS = ["가장 자주 반복된 실수는?", "종반전에서 실수가 많은가?", "백과 흑 중 어디서 실수가 더 많은가?",
               "최근 기간에 개선된 부분은?", "시간 부족 때 실수가 많은가?", "전체 성적 요약해줘"]


def classify_question(q):
    for qtype, words in QUESTION_TYPES:
        if any(w in q for w in words):
            return qtype
    return None


def _ev(rows):
    out = []
    for r in rows:
        out.extend(r["evidence"][:3])
    return out[:6]


def _conf(r):
    return "" if r["confidence"] == "충분" else f" (신뢰도: {r['confidence']})"


def answer(q, rep):
    qtype = classify_question(q)
    ov = rep["overview"]
    if ov["games"] == 0:
        return {"type": qtype, "text": ["분석이 끝난 대국이 없음. PGN 업로드 후 다시 질문 필요."], "evidence": []}
    lines, evidence = [], []
    note = [ov["sample_note"]] if ov["sample_note"] else []

    if qtype is None:
        return {"type": None, "text": ["지원하는 질문 유형이 아님. 아래 예시처럼 질문 필요."],
                "suggestions": SUGGESTIONS, "evidence": []}

    if qtype == "summary":
        lines.append(f"분석 대국 {ov['games']}판: {ov['win']}승 {ov['draw']}무 {ov['loss']}패, 평균 정확도 {ov['accuracy']}.")
        if rep["all"]:
            a = rep["all"]
            lines.append(f"실수 이상 {a['errors']}회 / 내 수 {a['moves']}수 (100수당 {a['rate']}회).")
        if rep["weaknesses"]:
            w = rep["weaknesses"][0]
            lines.append(f"가장 많이 반복된 유형: {w['label']} {w['errors']}회{_conf(w)}.")
            evidence = _ev([w])

    elif qtype == "top":
        ws = [w for w in rep["weaknesses"] if w["errors"]]
        if not ws:
            lines.append("반복 약점 태그가 붙은 실수 없음.")
        for w in ws[:3]:
            lines.append(f"{w['label']}: {w['errors']}회, 대국 {w['games_with']}판에서 발생, "
                         f"그중 상대가 응징한 경우 {w['punished']}회{_conf(w)}.")
        evidence = _ev(ws[:2])

    elif qtype == "phase":
        ps = sorted(rep["phases"], key=lambda p: -p["rate"])
        for p in ps:
            lines.append(f"{p['label']}: 내 수 {p['moves']}수 중 실수 이상 {p['errors']}회 (100수당 {p['rate']}회){_conf(p)}.")
        if ps:
            lines.append(f"실수 비율이 가장 높은 국면: {ps[0]['label']}.")
            evidence = _ev(ps[:1])

    elif qtype == "color":
        cs = sorted(rep["colors"], key=lambda c: -c["rate"])
        for c in cs:
            lines.append(f"{c['label']}일 때: 내 수 {c['moves']}수 중 실수 이상 {c['errors']}회 (100수당 {c['rate']}회){_conf(c)}.")
        if len(cs) == 2 and cs[0]["rate"] != cs[1]["rate"]:
            lines.append(f"{cs[0]['label']}일 때 실수 비율이 더 높음.")
        evidence = _ev(cs[:1])

    elif qtype == "time":
        t = next((w for w in rep["weaknesses"] if w["key"] == "time_trouble"), None)
        if t is None:
            lines.append("시간 부족(30초 미만) 상황의 실수 없음. PGN에 시계 기록(%clk)이 없으면 판단 불가.")
        else:
            lines.append(f"시간 부족 중 실수 {t['errors']}회, 대국 {t['games_with']}판{_conf(t)}.")
            evidence = _ev([t])

    elif qtype == "period":
        p = rep["period"]
        lines.append(f"비교 구간: 이전 {p['prev_range'][0]}~{p['prev_range'][1]} ({p['prev_games']}판) vs "
                     f"최근 {p['cur_range'][0]}~{p['cur_range'][1]} ({p['cur_games']}판).")
        for r in p["rows"]:
            if r["kind"] in ("all", "phase", "tag"):
                lines.append(f"{r['label']}: 100수당 {r['prev']['rate']} → {r['cur']['rate']}, {r['verdict']}.")

    return {"type": qtype, "text": note + lines, "evidence": evidence}

