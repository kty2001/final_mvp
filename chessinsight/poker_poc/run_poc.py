"""포커 엔진 PoC: TexasSolver 해 → 히어로 결정마다 GTO 빈도·EV 손실 계산.

TexasSolver 출력에는 전략(빈도)만 있고 EV가 없으므로, 덤프된 양측 균형 전략으로
트리를 직접 평가해 행동별 EV를 계산함 (히어로 핸드 고정, 상대는 레인지 전체).

사용: python run_poc.py [spot.json] [--resolve]
"""
import hashlib
import json
import os
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.join(BASE, "engine", "TexasSolver-v0.2.0-Windows")
OUT_DIR = os.path.join(BASE, "out")
RANKS = "23456789TJQKA"
OOP, IP = "oop", "ip"
PLAYER_ID = {1: OOP, 0: IP}  # TexasSolver 출력의 player 번호 (루트 = 먼저 행동하는 OOP = 1)

# 결정 분류 임시 기준: EV 손실을 팟 대비 %로 (체스의 승률 손실 구간에 대응)
LOSS_BANDS = [(10, "블런더"), (5, "실수"), (2, "부정확")]


# ---------------------------------------------------------------- 카드·레인지

def card(c):
    return RANKS.index(c[0]), c[1]


def expand_range(text):
    """'AA:0.5,AKs,KQ' → {(c1, c2): weight}. 무늬 표기 없으면 수티드+오프수트 전부."""
    combos = {}
    suits = "cdhs"
    for item in text.replace("\n", "").split(","):
        item = item.strip()
        if not item:
            continue
        hand, _, w = item.partition(":")
        w = float(w) if w else 1.0
        r1, r2, kind = hand[0], hand[1], hand[2:] or None
        pairs = []
        if r1 == r2:
            pairs = [(r1 + s1, r2 + s2) for i, s1 in enumerate(suits) for s2 in suits[i + 1:]]
        else:
            for s1 in suits:
                for s2 in suits:
                    if (kind == "s" and s1 != s2) or (kind == "o" and s1 == s2):
                        continue
                    pairs.append((r1 + s1, r2 + s2))
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


# ---------------------------------------------------------------- 족보 평가 (7장)

def hand_rank(cards):
    """비교 가능한 튜플. 클수록 강함."""
    rs = sorted((card(c)[0] for c in cards), reverse=True)
    by_suit = {}
    for c in cards:
        r, s = card(c)
        by_suit.setdefault(s, []).append(r)

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
        kicker = max(r for r in rs if r != groups[0][0])
        return (7, groups[0][0], kicker)
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


def _self_test():
    assert hand_rank("As Ks Qs Js Ts 2c 3d".split())[0] == 8
    assert hand_rank("Ah 2s 3d 4c 5h Kd Qc".split()) == (4, 3)
    assert hand_rank("Kh Kd Kc 9s 9d 2c 3h".split())[0] == 6
    assert hand_rank("Kh Kd 9c 9s 4d 4c 2h".split()) == (2, 11, 7, 2)
    assert hand_rank("2h 5h 9h Jh Kh Ad Ac".split())[0] == 5
    assert hand_rank("Tc 9c Kh 9d 4c 7s 2h".split()) > hand_rank("8c 8d Kh 9d 4c 7s 2h".split())


# ---------------------------------------------------------------- 해 풀이

def solver_input(spot, out_path):
    lines = [
        f"set_pot {spot['pot']}",
        f"set_effective_stack {spot['effective_stack']}",
        f"set_board {','.join(spot['board'])}",
        f"set_range_oop {read_range(spot, OOP)}",
        f"set_range_ip {read_range(spot, IP)}",
        *[f"set_bet_sizes {b}" for b in spot["bet_sizes"]],
        f"set_allin_threshold {spot['allin_threshold']}",
        f"set_raise_limit {spot['raise_limit']}",
        "build_tree",
        f"set_thread_num {spot['solver']['threads']}",
        f"set_accuracy {spot['solver']['accuracy']}",
        f"set_max_iteration {spot['solver']['max_iteration']}",
        "set_print_interval 10",
        "set_use_isomorphism 0",  # 무늬 동형 축약을 끄고 모든 카드를 그대로 덤프
        "start_solve",
        f"set_dump_rounds {3 if len(spot['board']) == 3 else 2}",
        f"dump_result {out_path}",
    ]
    return "\n".join(lines) + "\n"


def read_range(spot, side):
    with open(os.path.join(BASE, spot["ranges"][side])) as f:
        return f.read().strip()


def solve(spot, force=False):
    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, "solution.json")
    text = solver_input(spot, out_path)
    digest = hashlib.sha256(text.encode()).hexdigest()[:12]
    meta_path = os.path.join(OUT_DIR, "solution.meta.json")
    if not force and os.path.exists(out_path) and os.path.exists(meta_path):
        meta = json.load(open(meta_path))
        if meta.get("input_hash") == digest:
            return out_path, meta
    in_path = os.path.join(OUT_DIR, "solver_input.txt")
    with open(in_path, "w") as f:
        f.write(text)
    t = time.time()
    p = subprocess.run([os.path.join(ENGINE_DIR, "console_solver.exe"), "-i", in_path],
                       cwd=ENGINE_DIR, capture_output=True, text=True)
    log = [l for l in p.stdout.replace("\r", "\n").splitlines() if l.strip() and "%]" not in l and "] " not in l]
    expl = [l for l in log if l.startswith("Total exploitability")]
    meta = {"input_hash": digest, "seconds": round(time.time() - t, 1), "exit": p.returncode,
            "final_exploitability": expl[-1] if expl else None,
            "json_bytes": os.path.getsize(out_path) if os.path.exists(out_path) else None}
    if p.returncode != 0 or not os.path.exists(out_path):
        raise RuntimeError(f"solver 실패: {meta}\n" + "\n".join(log[-20:]))
    json.dump(meta, open(meta_path, "w"), ensure_ascii=False, indent=2)
    return out_path, meta


# ---------------------------------------------------------------- EV 계산

class Evaluator:
    """히어로 핸드 고정, 상대 레인지 콤보별 가치 벡터(히어로 기준 칩 손익)를 계산."""

    def __init__(self, spot, hero_cards, villain_combos):
        self.spot = spot
        self.hero = spot["hero"]
        self.villain = IP if self.hero == OOP else OOP
        self.hero_cards = hero_cards
        self.vc = villain_combos  # [(c1, c2)]
        self.pot = spot["pot"]
        self.stack = spot["effective_stack"]

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
            if k is None:  # 보드·히어로 카드와 겹쳐 레인지에서 빠진 콤보
                out.append(0.0)
                continue
            out.append(sum(f * child_vals[a][i] for f, a in zip(strat[k], node["actions"])))
        return out

    def after_action(self, node, action, side, board, contrib, street):
        other = IP if side == OOP else OOP
        contrib, street = dict(contrib), dict(street)
        name, _, amount = action.partition(" ")
        if name == "FOLD":
            return self.fold(side, contrib)
        if name in ("BET", "RAISE"):
            amt = float(amount)
            contrib[side] += amt - street[side]
            street[side] = amt
        elif name == "CALL":
            contrib[side] += street[other] - street[side]
            street[side] = street[other]
        child = node.get("childrens", {}).get(action)
        if child is None:
            return self.showdown(board, contrib)
        if child.get("node_type") == "chance_node":
            street = {OOP: 0.0, IP: 0.0}
        return self.value(child, board, contrib, street)

    def chance(self, node, board, contrib):
        used = set(board) | set(self.hero_cards)
        cards = [c for c in node["dealcards"] if c not in used]
        sums = [0.0] * len(self.vc)
        counts = [0] * len(self.vc)
        for c in cards:
            vals = self.value(node["dealcards"][c], board + [c], contrib, {OOP: 0.0, IP: 0.0})
            for i, vcards in enumerate(self.vc):
                if c in vcards:
                    continue
                sums[i] += vals[i]
                counts[i] += 1
        return [s / n if n else 0.0 for s, n in zip(sums, counts)]

    def runout(self, board, contrib):
        """남은 카드를 모두 깔아 본 쇼다운 평균 (콤보별로 겹치는 카드 제외)."""
        if len(board) == 5:
            return self.showdown(board, contrib)
        used = set(board) | set(self.hero_cards)
        deck = [r + s for r in RANKS for s in "cdhs" if r + s not in used]
        sums = [0.0] * len(self.vc)
        counts = [0] * len(self.vc)
        for c in deck:
            vals = self.runout(board + [c], contrib)
            for i, vcards in enumerate(self.vc):
                if c not in vcards:
                    sums[i] += vals[i]
                    counts[i] += 1
        return [s / n if n else 0.0 for s, n in zip(sums, counts)]

    def fold(self, folder, contrib):
        # 히어로 손익 = 받은 칩 - 해석 시작 후 넣은 칩 (시작 팟은 이미 들어간 돈으로 취급)
        h, v = contrib[self.hero], contrib[self.villain]
        val = -h if folder == self.hero else self.pot + v
        return [val] * len(self.vc)

    def showdown(self, board, contrib):
        if len(board) != 5:  # 덤프가 리버 전에 끊긴 경우를 쇼다운으로 오인하지 않도록
            raise ValueError(f"보드 {len(board)}장에서 쇼다운 도달: set_dump_rounds 부족")
        h, v = contrib[self.hero], contrib[self.villain]
        total = self.pot + h + v
        hr = hand_rank(list(self.hero_cards) + board)
        out = []
        for c in self.vc:
            vr = hand_rank(list(c) + board)
            share = 1.0 if hr > vr else 0.0 if hr < vr else 0.5
            out.append(share * total - h)
        return out


def match_action(actions, wanted):
    """'BET' 또는 'BET 6.75'를 실제 행동 라벨에 대응 (금액은 가장 가까운 것)."""
    name, _, amt = wanted.partition(" ")
    cands = [a for a in actions if a.split()[0] == name]
    if not cands:
        raise ValueError(f"행동 {wanted} 없음. 가능: {actions}")
    if amt and len(cands) > 1:
        return min(cands, key=lambda a: abs(float(a.split()[1]) - float(amt)))
    if len(cands) > 1:
        raise ValueError(f"행동 {wanted}가 모호함. 금액 지정 필요: {cands}")
    return cands[0]


def classify(loss_pct):
    for limit, label in LOSS_BANDS:
        if loss_pct >= limit:
            return label
    return "양호"


def analyze(spot, tree, ev_streets=("turn", "river")):
    hero_cards = (spot["hero_cards"][:2], spot["hero_cards"][2:])
    hero, villain = spot["hero"], IP if spot["hero"] == OOP else OOP
    board = list(spot["board"])
    villain_range = expand_range(read_range(spot, villain))
    blocked = set(board) | set(hero_cards)
    vc = [c for c in villain_range if not (set(c) & blocked)]
    reach = [villain_range[c] for c in vc]
    ev = Evaluator(spot, hero_cards, vc)

    node = tree
    contrib, street = {OOP: 0.0, IP: 0.0}, {OOP: 0.0, IP: 0.0}
    streets = [("turn", spot["actions"]["turn"])]
    if "river" in spot["actions"]:
        streets.append(("river", spot["actions"]["river"]))
    decisions, history = [], []
    for street_name, acts in streets:
        if street_name == "river":
            if node.get("node_type") != "chance_node" or "dealcards" not in node:
                raise ValueError("리버 카드를 딜할 노드가 아님")
            rc = spot["river"]
            node = node["dealcards"][rc]
            board = board + [rc]
            reach = [0.0 if rc in c else w for c, w in zip(vc, reach)]
            street = {OOP: 0.0, IP: 0.0}
            history.append(f"리버 {rc}")
        for wanted in acts:
            side = PLAYER_ID[node["player"]]
            label = match_action(node["actions"], wanted)
            strat = node["strategy"]["strategy"]
            if side == hero and street_name in ev_streets:
                key = combo_key(hero_cards, strat)
                if key is None:
                    raise ValueError(f"히어로 핸드 {spot['hero_cards']}가 {hero} 레인지에 없음")
                freqs = dict(zip(node["actions"], strat[key]))
                vals = {a: ev.after_action(node, a, side, board, contrib, street) for a in node["actions"]}
                total_w = sum(reach)
                evs = {a: sum(r * x for r, x in zip(reach, v)) / total_w for a, v in vals.items()}
                pot_now = spot["pot"] + contrib[OOP] + contrib[IP]
                best = max(evs, key=evs.get)
                loss = evs[best] - evs[label]
                mixed = [a for a, f in freqs.items() if f >= 0.1]
                decisions.append({
                    "street": street_name, "history": " → ".join(history) or "(턴 시작)",
                    "pot": round(pot_now, 2), "played": label, "freqs": freqs, "evs": evs,
                    "best": best, "loss": loss, "loss_pct": 100 * loss / pot_now,
                    "class": classify(100 * loss / pot_now),
                    "mix_ev": sum(freqs[a] * evs[a] for a in node["actions"]),
                    # 균형 전략에서 섞어 쓰는 행동들은 EV가 거의 같아야 함 (검증용)
                    "indifference_gap": (max(evs[a] for a in mixed) - min(evs[a] for a in mixed)) if len(mixed) > 1 else None,
                    "villain_combos": sum(1 for r in reach if r > 0),
                })
            elif side != hero:
                strat_freq = node["actions"].index(label)
                reach = [r * strat[k][strat_freq] if (k := combo_key(c, strat)) else 0.0 for c, r in zip(vc, reach)]
            history.append(f"{spot['positions'][side]} {label}")
            # 다음 노드로 이동하며 칩 반영
            name, _, amount = label.partition(" ")
            other = IP if side == OOP else OOP
            if name in ("BET", "RAISE"):
                contrib[side] += float(amount) - street[side]
                street[side] = float(amount)
            elif name == "CALL":
                contrib[side] += street[other] - street[side]
                street[side] = street[other]
            if name == "FOLD":
                node = None
                break
            node = node.get("childrens", {}).get(label)
    return decisions


def report(spot, meta, decisions):
    u = spot["unit"]
    print(f"[해 풀이] {meta['seconds']}초, {meta['final_exploitability']}, 결과 JSON {meta['json_bytes'] / 1e6:.1f}MB")
    print(f"[핸드] 히어로 {spot['positions'][spot['hero']]} {spot['hero_cards']}, 보드 {' '.join(spot['board'])} {spot.get('river', '')}")
    for i, d in enumerate(decisions, 1):
        print(f"\n결정 {i} ({d['street']}, 팟 {d['pot']}{u}) 경로: {d['history']}")
        print(f"  상대 레인지 남은 콤보: {d['villain_combos']}")
        for a in d["freqs"]:
            mark = " ← 실제" if a == d["played"] else ""
            print(f"  {a:<16} GTO 빈도 {d['freqs'][a] * 100:5.1f}%  EV {d['evs'][a]:+7.2f}{u}{mark}")
        print(f"  최선 {d['best']}, 실제 {d['played']}: EV 손실 {d['loss']:.2f}{u} (팟 대비 {d['loss_pct']:.1f}%) → {d['class']}")
        if d["indifference_gap"] is not None:
            print(f"  [검증] 혼합 행동 간 EV 차이 {d['indifference_gap']:.3f}{u} (균형이면 0에 가까워야 함)")


def validate(spot, tree, limit=8):
    """EV 계산 검증: 히어로의 마지막 리버 결정에서 GTO가 두 행동 이상을 섞는 콤보는 그 행동들의 EV가 거의 같아야 함."""
    path = spot["actions"]
    node = tree
    for a in path["turn"]:
        node = node["childrens"][match_action(node["actions"], a)]
    node = node["dealcards"][spot["river"]]
    for a in path["river"][:-1]:
        node = node["childrens"][match_action(node["actions"], a)]
    if PLAYER_ID[node["player"]] != spot["hero"]:
        print("[검증] 마지막 행동이 히어로 결정이 아니라 생략")
        return
    strat = node["strategy"]["strategy"]
    board = set(spot["board"]) | {spot["river"]}
    # 보드 카드와 겹치는 콤보는 불가능한 핸드라 해가 기본값(균등)으로 채워져 있으므로 제외
    mixed = [k for k, f in strat.items()
             if sum(1 for x in f if x >= 0.2) >= 2 and not ({k[:2], k[2:]} & board)]
    print(f"\n[검증] 리버 베팅을 마주한 결정에서 GTO가 섞는 콤보 {len(mixed)}개 중 {min(limit, len(mixed))}개 확인")
    gaps = []
    for k in mixed[:limit]:
        s = dict(spot, hero_cards=k)
        d = analyze(s, tree, ev_streets=("river",))[-1]
        mixed_actions = [a for a, f in d["freqs"].items() if f >= 0.2]
        gap = max(d["evs"][a] for a in mixed_actions) - min(d["evs"][a] for a in mixed_actions)
        gaps.append(100 * gap / d["pot"])
        freqs = ", ".join(f"{a.split()[0]} {d['freqs'][a] * 100:.0f}% EV {d['evs'][a]:+.2f}" for a in mixed_actions)
        print(f"  {k}: {freqs} → 차이 {gap:.3f}{spot['unit']} (팟 대비 {gaps[-1]:.2f}%)")
    if gaps:
        print(f"  최대 차이 팟 대비 {max(gaps):.2f}% (해의 exploitability 수준이면 정상)")


def main():
    _self_test()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    spot = json.load(open(args[0] if args else os.path.join(BASE, "spot.json"), encoding="utf-8"))
    out_path, meta = solve(spot, force="--resolve" in sys.argv)
    t = time.time()
    tree = json.load(open(out_path))
    decisions = analyze(spot, tree)
    report(spot, meta, decisions)
    print(f"\n[EV 계산] {time.time() - t:.1f}초")
    if "--validate" in sys.argv:
        validate(spot, tree)


if __name__ == "__main__":
    main()
