"""데모용 poker_hands.json 생성.

demo_user가 2026-09~10월에 둔 턴·리버 핸드 12개를 흉내 냄. 핸드마다 해를 풀고,
상대는 실제 카드의 GTO 빈도대로, 히어로는 일정 확률로 GTO가 거의 쓰지 않는 행동(빈도 10% 미만)을 골라
실수를 섞음. 이탈 확률을 9월 50% → 10월 15%로 낮춰 개선 추세가 보이게 함.
사용: python sample/make_poker_sample.py
"""
import datetime
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import poker  # noqa: E402
from app.poker import IP, OOP, PLAYER_ID, RANKS, SUITS  # noqa: E402

N_HANDS = 12
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "poker_hands.json")


def pick_combo(side, blocked):
    r = {c: w for c, w in poker.expand_range(poker.range_text(side)).items() if w > 0 and not (set(c) & blocked)}
    combos = list(r)
    return random.choices(combos, weights=[r[c] for c in combos])[0]


def play(tree, hand, villain_cards, p_dev):
    hero_cards = (hand["hero_cards"][:2], hand["hero_cards"][2:])
    actions = {"turn": [], "river": []}
    node, street = tree, "turn"
    while node and node.get("node_type") == "action_node":
        side = PLAYER_ID[node["player"]]
        strat = node["strategy"]["strategy"]
        cards = hero_cards if side == hand["hero"] else villain_cards
        freqs = strat[poker.combo_key(cards, strat)]
        label = random.choices(node["actions"], weights=freqs)[0]
        if side == hand["hero"] and random.random() < p_dev:
            off = [a for a, f in zip(node["actions"], freqs)
                   if f < 0.1 and poker.generic_action(node["actions"], a) != "ALLIN"]
            if off:
                label = random.choice(off)
        actions[street].append(poker.generic_action(node["actions"], label))
        if label == "FOLD":
            break
        child = node.get("childrens", {}).get(label)
        if child and child.get("node_type") == "chance_node":
            if street == "turn" and "dealcards" in child:
                child, street = child["dealcards"][hand["river"]], "river"
            else:
                child = None  # 올인 후 남은 카드만 깔리는 경우
        node = child
    return actions


def main():
    random.seed(11)
    deck = [r + s for r in RANKS for s in SUITS]
    hands = []
    for i in range(N_HANDS):
        recent = i >= N_HANDS // 2
        day = (datetime.date(2026, 10, 1) + datetime.timedelta(days=4 * (i - 6)) if recent
               else datetime.date(2026, 9, 2) + datetime.timedelta(days=4 * i))
        hero = OOP if i % 2 == 0 else IP
        cards = random.sample(deck, 5)
        board, river = cards[:4], cards[4]
        hero_cards = pick_combo(hero, set(cards))
        villain_cards = pick_combo(IP if hero == OOP else OOP, set(cards) | set(hero_cards))
        hand = {"date": day.isoformat(), "hero": hero, "hero_cards": "".join(hero_cards),
                "positions": {OOP: "BB", IP: "BTN"}, "pot": random.choice([6, 9]), "effective_stack": 95,
                "board": board, "river": river, "actions": {}}
        tree = poker.solve(hand)
        hand["actions"] = play(tree, hand, villain_cards, 0.15 if recent else 0.5)
        if not hand["actions"]["river"]:
            hand["river"] = None
        hands.append(hand)
        print(f"{i + 1}/{N_HANDS} {day} {hero} {hand['hero_cards']} {' '.join(board)} {river} {hand['actions']}")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"hands": hands}, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
