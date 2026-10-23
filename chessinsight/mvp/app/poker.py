"""포커(홀덤) 어댑터: 핸드 JSON 파싱, TexasSolver 해 풀이, 히어로 결정별 GTO 대비 EV 손실.

TexasSolver 출력에는 전략(빈도)만 있고 EV가 없으므로, 덤프된 양측 균형 전략으로 트리를
직접 평가해 행동별 EV를 계산함(히어로 핸드 고정, 상대는 레인지 전체).
검증 과정은 chessinsight/poker_poc/README.md 참고. 분석 범위는 턴·리버.
"""
import glob
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from datetime import date

from .analysis import BASE_DIR

RANKS = "23456789TJQKA"
SUITS = "cdhs"
OOP, IP = "oop", "ip"
PLAYER_ID = {1: OOP, 0: IP}  # 출력의 player 번호 (루트 = 먼저 행동하는 OOP = 1)
STREET_LABEL = {"turn": "턴", "river": "리버"}

# 해 풀이 기본 설정 (PoC와 동일). 레인지는 TexasSolver 동봉 6max BTN 오픈 / BB 콜 프리플랍 레인지
RANGE_FILES = {OOP: "ranges/6max_range/BTN/2.5bb/BB/Call/BB_range.txt",
               IP: "ranges/6max_range/BTN/2.5bb/BB/Call/BTN_range.txt"}
BET_SIZES = ["oop,turn,bet,50", "oop,turn,raise,100", "oop,turn,allin",
             "ip,turn,bet,75", "ip,turn,raise,100", "ip,turn,allin",
             "oop,river,bet,50", "oop,river,donk,50", "oop,river,raise,100", "oop,river,allin",
             "ip,river,bet,75", "ip,river,raise,100", "ip,river,allin"]
SOLVER = {"allin_threshold": 0.67, "raise_limit": 2, "threads": 8, "accuracy": 0.3, "max_iteration": 300}
ENGINE_NAME = "TexasSolver v0.2.0"

# 분류: EV 손실을 팟 대비 %로 (체스의 승률 손실 구간에 대응하는 임시 기준)
LOSS_BANDS = [(10, "blunder"), (5, "mistake"), (2, "inaccuracy")]
ERRORS = ("inaccuracy", "mistake", "blunder")


def engine_dir():
    path = os.environ.get("TEXASSOLVER_PATH")
    if path:
        return os.path.dirname(path)
    found = glob.glob(os.path.join(BASE_DIR, "engine", "TexasSolver*", "console_solver.exe"))
    if not found:
        raise RuntimeError("TexasSolver 없음. engine/ 에 압축 해제하거나 TEXASSOLVER_PATH 지정 필요")
    return os.path.dirname(found[0])


# ---------------------------------------------------------------- 카드·레인지

def valid_card(c):
    return isinstance(c, str) and len(c) == 2 and c[0] in RANKS and c[1] in SUITS


def range_text(side):
    with open(os.path.join(engine_dir(), RANGE_FILES[side])) as f:
        return f.read().strip()


def expand_range(text):
    """'AA:0.5,AKs,KQ' → {(c1, c2): weight}. 무늬 표기 없으면 수티드+오프수트 전부."""
    combos = {}
    for item in text.replace("\n", "").split(","):
        item = item.strip()
        if not item:
            continue
        hand, _, w = item.partition(":")
        w = float(w) if w else 1.0
        r1, r2, kind = hand[0], hand[1], hand[2:] or None
        if r1 == r2:
            pairs = [(r1 + s1, r2 + s2) for i, s1 in enumerate(SUITS) for s2 in SUITS[i + 1:]]
        else:
            pairs = [(r1 + s1, r2 + s2) for s1 in SUITS for s2 in SUITS
                     if not ((kind == "s" and s1 != s2) or (kind == "o" and s1 == s2))]
        for p in pairs:
            combos[p] = w
    return combos


def combo_key(cards, keys):
    """전략 딕셔너리의 콤보 키('JcTc' 등)를 카드 순서와 무관하게 찾기."""
    a, b = cards
    for k in (a + b, b + a):
        if k in keys:
            return k
    return None


def range_weight(side, cards):
    r = expand_range(range_text(side))
    return r.get(tuple(cards), r.get(tuple(reversed(cards)), 0.0))


# ---------------------------------------------------------------- 족보 평가 (7장)

def hand_rank(cards):
    """비교 가능한 튜플. 클수록 강함."""
    rs = sorted((RANKS.index(c[0]) for c in cards), reverse=True)
    by_suit = {}
    for c in cards:
        by_suit.setdefault(c[1], []).append(RANKS.index(c[0]))

    def straight_high(ranks):
        u = set(ranks)
        if 12 in u:
            u.add(-1)  # A를 1로도 사용
        for hi in range(12, 2, -1):
            if all(hi - k in u for k in range(5)):
                return hi
        return None

    for rlist in by_suit.values():
        if len(rlist) >= 5:
            sf = straight_high(rlist)
            if sf is not None:
                return (8, sf)
    counts = {}
    for r in rs:
        counts[r] = counts.get(r, 0) + 1
    groups = sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=True)
    if groups[0][1] == 4:
        return (7, groups[0][0], max(r for r in rs if r != groups[0][0]))
    if groups[0][1] == 3 and len(groups) > 1 and groups[1][1] >= 2:
        return (6, groups[0][0], groups[1][0])
    for rlist in by_suit.values():
        if len(rlist) >= 5:
            return (5, *sorted(rlist, reverse=True)[:5])
    st = straight_high(rs)
    if st is not None:
        return (4, st)
    if groups[0][1] == 3:
        return (3, groups[0][0], *[r for r in rs if r != groups[0][0]][:2])
    if groups[0][1] == 2 and groups[1][1] == 2:
        hi, lo = groups[0][0], groups[1][0]
        return (2, hi, lo, max(r for r in rs if r not in (hi, lo)))
    if groups[0][1] == 2:
        return (1, groups[0][0], *[r for r in rs if r != groups[0][0]][:3])
    return (0, *rs[:5])


# ---------------------------------------------------------------- 핸드 JSON

def _normalize(h):
    """필수 필드 검증 후 정규화한 핸드. 잘못되면 ValueError."""
    for key in ("date", "hero", "hero_cards", "pot", "effective_stack", "board", "actions"):
        if key not in h:
            raise ValueError(f"필드 누락: {key}")
    date.fromisoformat(h["date"])
    if h["hero"] not in (OOP, IP):
        raise ValueError("hero는 oop 또는 ip")
    hero_cards = [h["hero_cards"][:2], h["hero_cards"][2:]]
    board = list(h["board"])
    river = h.get("river")
    cards = hero_cards + board + ([river] if river else [])
    if len(board) != 4 or not all(valid_card(c) for c in cards) or len(set(cards)) != len(cards):
        raise ValueError("카드 오류: 히어로 2장 + 보드 4장(플랍·턴) + 리버, 중복 불가")
    acts = h["actions"]
    if not acts.get("turn") or (acts.get("river") and not river):
        raise ValueError("actions.turn 필수, actions.river가 있으면 river 카드 필요")
    if range_weight(h["hero"], hero_cards) <= 0:
        raise ValueError(f"히어로 핸드 {h['hero_cards']}가 {h['hero']} 레인지에 없음")
    return {
        "date": h["date"], "hero": h["hero"], "hero_cards": "".join(hero_cards),
        "positions": h.get("positions") or {OOP: "BB", IP: "BTN"},
        "pot": float(h["pot"]), "effective_stack": float(h["effective_stack"]),
        "board": board, "river": river,
        "actions": {"turn": list(acts["turn"]), "river": list(acts.get("river") or [])},
        "note": h.get("note", ""),
    }


def parse_hands(text):
    """핸드 JSON(리스트 또는 {"hands": [...]}) → (체스 parse_pgn과 같은 키의 dict 목록, 오류 목록)."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        return [], [{"index": 0, "error": f"JSON 오류: {e}"}]
    hands = data if isinstance(data, list) else data.get("hands", [])
    games, errors = [], []
    for i, h in enumerate(hands, 1):
        try:
            n = _normalize(h)
        except (ValueError, TypeError, KeyError) as e:
            errors.append({"index": i, "error": str(e)})
            continue
        raw = json.dumps(n, ensure_ascii=False, sort_keys=True)
        games.append({
            "hash": hashlib.sha256(raw.encode()).hexdigest(),
            "record_raw": raw,
            "white": n["positions"][OOP], "black": n["positions"][IP],
            "white_elo": None, "black_elo": None, "result": "*",
            "played_at": n["date"],
            "opening": " ".join(n["board"][:3]) + " " + n["board"][3] + (" " + n["river"] if n["river"] else ""),
            "time_control": f"{n['effective_stack']:g}bb",
            "n_plies": len(n["actions"]["turn"]) + len(n["actions"]["river"]),
            "user_color": n["hero"],
        })
    return games, errors


# ---------------------------------------------------------------- 해 풀이

def solver_input(hand, out_path):
    lines = [
        f"set_pot {hand['pot']:g}",
        f"set_effective_stack {hand['effective_stack']:g}",
        f"set_board {','.join(hand['board'])}",
        f"set_range_oop {range_text(OOP)}",
        f"set_range_ip {range_text(IP)}",
        *[f"set_bet_sizes {b}" for b in BET_SIZES],
        f"set_allin_threshold {SOLVER['allin_threshold']}",
        f"set_raise_limit {SOLVER['raise_limit']}",
        "build_tree",
        f"set_thread_num {SOLVER['threads']}",
        f"set_accuracy {SOLVER['accuracy']}",
        f"set_max_iteration {SOLVER['max_iteration']}",
        "set_print_interval 10",
        "set_use_isomorphism 0",  # 무늬 동형 축약 없이 모든 카드를 그대로 덤프
        "start_solve",
        "set_dump_rounds 2",      # 턴 + 리버
        f"dump_result {out_path}",
    ]
    return "\n".join(lines) + "\n"


def solve(hand, progress=None):
    """해 풀이 후 트리(dict) 반환. 결과 JSON(약 50MB)은 임시 폴더에 쓰고 바로 삭제."""
    tmp = tempfile.mkdtemp(dir=os.path.join(BASE_DIR, "data"))
    try:
        out_path = os.path.join(tmp, "solution.json")
        in_path = os.path.join(tmp, "input.txt")
        with open(in_path, "w") as f:
            f.write(solver_input(hand, out_path))
        proc = subprocess.Popen([os.path.join(engine_dir(), "console_solver.exe"), "-i", in_path],
                                cwd=engine_dir(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:  # "Iter: N" 로 진행률 추정
            if line.startswith("Iter:") and progress:
                progress(min(60, int(60 * int(line.split()[1]) / SOLVER["max_iteration"])))
        if proc.wait() != 0 or not os.path.exists(out_path):
            raise RuntimeError("TexasSolver 해 풀이 실패")
        with open(out_path) as f:
            return json.load(f)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- EV 계산

class Evaluator:
    """히어로 핸드 고정, 상대 레인지 콤보별 가치 벡터(히어로 기준 칩 손익)를 계산."""

    def __init__(self, hand, villain_combos):
        self.hero = hand["hero"]
        self.villain = IP if self.hero == OOP else OOP
        self.hero_cards = (hand["hero_cards"][:2], hand["hero_cards"][2:])
        self.vc = villain_combos
        self.pot = hand["pot"]

    def value(self, node, board, contrib, street):
        """contrib = {side: 해석 시작 후 넣은 칩}, street = {side: 이번 스트리트 누적 베팅}."""
        t = node.get("node_type")
        if t == "chance_node":
            if "dealcards" not in node:  # 올인 후처럼 이후 결정이 없어 덤프되지 않은 딜
                return self.runout(board, contrib)
            return self.chance(node, board, contrib)
        if t != "action_node":
            return self.showdown(board, contrib)
        side = PLAYER_ID[node["player"]]
        child_vals = {a: self.after_action(node, a, side, board, contrib, street) for a in node["actions"]}
        strat = node["strategy"]["strategy"]
        if side == self.hero:
            freqs = strat[combo_key(self.hero_cards, strat)]
            return [sum(f * child_vals[a][i] for f, a in zip(freqs, node["actions"])) for i in range(len(self.vc))]
        out = []
        for i, c in enumerate(self.vc):
            k = combo_key(c, strat)
            out.append(sum(f * child_vals[a][i] for f, a in zip(strat[k], node["actions"])) if k else 0.0)
        return out

    def after_action(self, node, action, side, board, contrib, street):
        contrib, street = dict(contrib), dict(street)
        if action == "FOLD":
            return self.fold(side, contrib)
        apply_action(action, side, contrib, street)
        child = node.get("childrens", {}).get(action)
        if child is None:  # 자식이 없으면 쇼다운 (폴드는 위에서 처리)
            return self.showdown(board, contrib)
        if child.get("node_type") == "chance_node":
            street = {OOP: 0.0, IP: 0.0}
        return self.value(child, board, contrib, street)

    def _average(self, cards, board, value_of):
        sums, counts = [0.0] * len(self.vc), [0] * len(self.vc)
        for c in cards:
            vals = value_of(c)
            for i, vcards in enumerate(self.vc):
                if c not in vcards:
                    sums[i] += vals[i]
                    counts[i] += 1
        return [s / n if n else 0.0 for s, n in zip(sums, counts)]

    def chance(self, node, board, contrib):
        used = set(board) | set(self.hero_cards)
        cards = [c for c in node["dealcards"] if c not in used]
        return self._average(cards, board, lambda c: self.value(node["dealcards"][c], board + [c], contrib,
                                                                 {OOP: 0.0, IP: 0.0}))

    def runout(self, board, contrib):
        if len(board) == 5:
            return self.showdown(board, contrib)
        used = set(board) | set(self.hero_cards)
        deck = [r + s for r in RANKS for s in SUITS if r + s not in used]
        return self._average(deck, board, lambda c: self.runout(board + [c], contrib))

    def fold(self, folder, contrib):
        # 히어로 손익 = 받은 칩 - 해석 시작 후 넣은 칩 (시작 팟은 이미 들어간 돈으로 취급)
        h, v = contrib[self.hero], contrib[self.villain]
        return [-h if folder == self.hero else self.pot + v] * len(self.vc)

    def showdown(self, board, contrib):
        if len(board) != 5:
            raise ValueError(f"보드 {len(board)}장에서 쇼다운 도달")
        h, v = contrib[self.hero], contrib[self.villain]
        total = self.pot + h + v
        hr = hand_rank(list(self.hero_cards) + board)
        out = []
        for c in self.vc:
            vr = hand_rank(list(c) + board)
            out.append((1.0 if hr > vr else 0.0 if hr < vr else 0.5) * total - h)
        return out


def apply_action(action, side, contrib, street):
    """칩 반영. BET/RAISE 금액은 그 스트리트 누적 금액(raise-to)."""
    other = IP if side == OOP else OOP
    name, _, amount = action.partition(" ")
    if name in ("BET", "RAISE"):
        contrib[side] += float(amount) - street[side]
        street[side] = float(amount)
    elif name == "CALL":
        contrib[side] += street[other] - street[side]
        street[side] = street[other]


def match_action(actions, wanted):
    """CHECK/BET/RAISE/CALL/FOLD/ALLIN (또는 'BET 7'처럼 금액 지정)을 트리의 행동 라벨에 대응."""
    name, _, amt = wanted.upper().partition(" ")
    sized = sorted((a for a in actions if a.split()[0] in ("BET", "RAISE")), key=lambda a: float(a.split()[1]))
    if name == "ALLIN":
        if not sized:
            raise ValueError(f"올인 행동 없음. 가능: {actions}")
        return sized[-1]
    cands = [a for a in actions if a.split()[0] == name]
    if not cands:
        raise ValueError(f"행동 {wanted} 없음. 가능: {actions}")
    if amt:
        return min(cands, key=lambda a: abs(float(a.split()[1]) - float(amt)))
    return cands[0] if len(cands) == 1 or name not in ("BET", "RAISE") else min(cands, key=lambda a: float(a.split()[1]))


def generic_action(actions, label):
    """트리 라벨 → 핸드 JSON에 쓰는 일반 표기 (match_action의 역)."""
    name = label.split()[0]
    sized = sorted((a for a in actions if a.split()[0] in ("BET", "RAISE")), key=lambda a: float(a.split()[1]))
    if name in ("BET", "RAISE") and len(sized) > 1 and label == sized[-1]:
        return "ALLIN"
    return name


def action_text(label, side, contrib, street, stack):
    name, _, amount = label.partition(" ")
    if name in ("BET", "RAISE"):
        amt = float(amount)
        allin = contrib[side] + amt - street[side] >= stack - 0.5
        return f"{'올인' if allin else '베팅' if name == 'BET' else '레이즈'} {amt:g}bb"
    return {"CHECK": "체크", "CALL": "콜", "FOLD": "폴드"}[name]


def _kind(label):
    n = label.split()[0]
    return "aggr" if n in ("BET", "RAISE") else n.lower()


def tag_decision(played, best):
    p, b = _kind(played), _kind(best)
    if p == "call" and b == "fold":
        return "overcall"
    if p == "fold":
        return "overfold"
    if p in ("check", "call") and b == "aggr":
        return "missed_aggression"
    if p == "aggr" and b != "aggr":
        return "overaggression"
    return "sizing"


def classify(loss_pct, is_best, forced):
    if forced:
        return "forced"
    if is_best:
        return "best"
    for limit, name in LOSS_BANDS:
        if loss_pct >= limit:
            return name
    return "good"


def analyze_hand(record_raw, progress=None):
    """핸드 분석. 행동마다 엔트리(히어로 결정은 EV·분류·태그 포함) 목록 반환."""
    hand = json.loads(record_raw)
    tree = solve(hand, progress)
    hero, villain = hand["hero"], IP if hand["hero"] == OOP else OOP
    hero_cards = (hand["hero_cards"][:2], hand["hero_cards"][2:])
    board = list(hand["board"])
    vrange = expand_range(range_text(villain))
    vc = [c for c in vrange if not (set(c) & (set(board) | set(hero_cards)))]
    reach = [vrange[c] for c in vc]
    ev = Evaluator(hand, vc)
    stack = hand["effective_stack"]

    node = tree
    contrib, street = {OOP: 0.0, IP: 0.0}, {OOP: 0.0, IP: 0.0}
    entries, history = [], []
    n_hero = sum(1 for _ in hand["actions"]["turn"] + hand["actions"]["river"]) or 1
    plan = [("turn", hand["actions"]["turn"]), ("river", hand["actions"]["river"])]
    for street_name, acts in plan:
        if not acts:
            continue
        if street_name == "river":
            if node is None or node.get("node_type") != "chance_node" or "dealcards" not in node:
                raise ValueError("리버 행동이 있으나 리버로 이어지는 노드가 아님")
            node = node["dealcards"][hand["river"]]
            board = board + [hand["river"]]
            reach = [0.0 if hand["river"] in c else w for c, w in zip(vc, reach)]
            street = {OOP: 0.0, IP: 0.0}
            history.append(f"리버 {hand['river']}")
        for wanted in acts:
            if node is None or node.get("node_type") != "action_node":
                raise ValueError(f"{STREET_LABEL[street_name]} 행동 {wanted}: 핸드가 이미 끝났거나 행동할 차례가 아님")
            side = PLAYER_ID[node["player"]]
            label = match_action(node["actions"], wanted)
            text = action_text(label, side, contrib, street, stack)
            pos = hand["positions"][side]
            entry = {
                "ply": len(entries) + 1, "color": side, "phase": street_name, "san": text,
                "label": f"{STREET_LABEL[street_name]}: {pos} {text}",
                "history": list(history), "board": list(board), "pot": round(hand["pot"] + contrib[OOP] + contrib[IP], 2),
                "cls": None, "tags": [], "loss": 0.0,
            }
            strat = node["strategy"]["strategy"]
            if side == hero:
                key = combo_key(hero_cards, strat)
                vals = {a: ev.after_action(node, a, side, board, contrib, street) for a in node["actions"]}
                total_w = sum(reach) or 1.0
                evs = {a: sum(r * x for r, x in zip(reach, v)) / total_w for a, v in vals.items()}
                best = max(evs, key=evs.get)
                loss_bb = evs[best] - evs[label]
                loss_pct = 100 * loss_bb / entry["pot"]
                cls = classify(loss_pct, label == best, len(node["actions"]) == 1)
                entry.update({
                    "hero_cards": hand["hero_cards"], "played": label, "best": best,
                    "options": [{"action": a, "text": action_text(a, side, contrib, street, stack),
                                 "freq": round(f, 4), "ev": round(evs[a], 3)}
                                for a, f in zip(node["actions"], strat[key])],
                    "loss_bb": round(loss_bb, 3), "loss": round(loss_pct, 2), "cls": cls,
                    "tags": [tag_decision(label, best)] if cls in ERRORS else [],
                    "villain_combos": sum(1 for r in reach if r > 0),
                })
                if progress:
                    progress(min(99, 60 + int(40 * sum(1 for e in entries if e["cls"]) / n_hero)))
            else:
                i = node["actions"].index(label)
                reach = [r * strat[k][i] if (k := combo_key(c, strat)) else 0.0 for c, r in zip(vc, reach)]
            entries.append(entry)
            history.append(f"{pos} {text}")
            if label == "FOLD":
                node = None
                break
            apply_action(label, side, contrib, street)
            node = node.get("childrens", {}).get(label)
    return entries
