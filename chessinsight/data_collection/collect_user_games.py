"""D4. 사용자별 대국 이력 수집(Lichess API, 공개 대국).

D1 표본에 등장한 사용자 중 레이팅 구간별 N명을 무작위로 골라 최근 대국을 직렬로 요청.
요청 규칙(기획서 6장): 한 번에 하나, 429 응답 시 60초 대기. 저장 시 사용자명은 가명화.
"""
import argparse
import csv
import glob
import os
import random
import time
from collections import Counter, defaultdict

import requests

from collect_lichess_games import EXCLUDED_TERMINATIONS, MIN_PLIES, iter_games
from common import (BANDS, PROCESSED, RAW, SPEEDS, USER_AGENT, band_of, parse_pgn, pseudonym,
                    save_stats, speed_of)

API = "https://lichess.org/api/games/user/{}"
MIN_GAMES = 30
GAME_FIELDS = ["user_id", "game_id", "user_color", "user_elo", "opponent_id", "opponent_elo", "result",
               "user_score", "termination", "played_at", "speed", "time_control", "eco", "opening", "n_plies",
               "has_eval", "has_clock", "pgn"]
USER_FIELDS = ["user_id", "rating_band", "n_games", "n_with_eval", "first_played", "last_played", "speeds"]


def candidates_by_band(raw_pgn):
    """D1 원본 표본에서 구간별 사용자명 목록."""
    users = defaultdict(set)
    with open(raw_pgn, encoding="utf-8") as f:
        for h, _, _ in iter_games(f):
            for side in ("White", "Black"):
                users[band_of(int(h[f"{side}Elo"]))].add(h[side])
    return {b: sorted(u) for b, u in users.items()}


def fetch(session, username, max_games):
    params = {"max": max_games, "rated": "true", "perfType": ",".join(SPEEDS), "clocks": "true",
              "evals": "true", "opening": "true"}
    while True:
        r = session.get(API.format(username), params=params, timeout=120,
                        headers={"Accept": "application/x-chess-pgn"})
        if r.status_code == 429:
            print("429 → 60초 대기", flush=True)
            time.sleep(60)
            continue
        return r


def score(result, color):
    if result == "1/2-1/2":
        return 0.5
    return 1.0 if (result == "1-0") == (color == "white") else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--users-per-band", type=int, default=5)
    ap.add_argument("--max-games", type=int, default=100)
    args = ap.parse_args()
    started = time.time()

    raw_pgn = sorted(glob.glob(os.path.join(RAW, "lichess_games_*_selected.pgn")))[-1]
    cands = candidates_by_band(raw_pgn)
    rng = random.Random(42)
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    reasons = Counter()
    used = set()
    user_rows, requests_made, fetched_games = [], 0, 0
    raw_out = open(os.path.join(RAW, "lichess_user_games.pgn"), "w", encoding="utf-8")
    games_f = open(os.path.join(PROCESSED, "user_games.csv"), "w", encoding="utf-8-sig", newline="")
    writer = csv.DictWriter(games_f, fieldnames=GAME_FIELDS)
    writer.writeheader()

    for _, _, band in BANDS:
        pool = cands.get(band, [])
        rng.shuffle(pool)
        accepted = 0
        for username in pool:
            if accepted >= args.users_per_band:
                break
            if username.lower() in used:
                continue
            used.add(username.lower())
            r = fetch(session, username, args.max_games)
            requests_made += 1
            if r.status_code != 200:
                reasons[f"http_{r.status_code}"] += 1
                continue
            uid = pseudonym(username)
            rows, seen = [], set()
            for h, header_lines, movetext in iter_games(r.text.splitlines(keepends=True)):
                fetched_games += 1
                if h.get("Variant", "Standard") != "Standard" or speed_of(h.get("TimeControl")) not in SPEEDS:
                    reasons["variant_or_speed"] += 1
                    continue
                if h.get("Termination") in EXCLUDED_TERMINATIONS:
                    reasons["termination"] += 1
                    continue
                original = "\n".join(header_lines) + "\n\n" + movetext + "\n"
                games, errors = parse_pgn(original)
                if errors or not games:
                    reasons["parse_error"] += 1
                    continue
                g = games[0]
                if g["n_plies"] < MIN_PLIES:
                    reasons["too_short"] += 1
                    continue
                game_id = h.get("Site", "").rsplit("/", 1)[-1]
                if game_id in seen:
                    reasons["duplicate"] += 1
                    continue
                seen.add(game_id)
                color = "white" if h["White"].lower() == username.lower() else "black"
                opp = h["Black"] if color == "white" else h["White"]
                oid = pseudonym(opp)
                pgn = original.replace(f'[White "{h["White"]}"]', f'[White "{uid if color == "white" else oid}"]') \
                              .replace(f'[Black "{h["Black"]}"]', f'[Black "{oid if color == "white" else uid}"]')
                rows.append({
                    "user_id": uid, "game_id": game_id, "user_color": color,
                    "user_elo": h.get(f"{color.title()}Elo"), "opponent_id": oid,
                    "opponent_elo": h.get(("Black" if color == "white" else "White") + "Elo"),
                    "result": h.get("Result"), "user_score": score(h.get("Result"), color),
                    "termination": h.get("Termination"), "played_at": g["played_at"],
                    "speed": speed_of(h["TimeControl"]), "time_control": h["TimeControl"], "eco": h.get("ECO"),
                    "opening": h.get("Opening"), "n_plies": g["n_plies"], "has_eval": "%eval" in movetext,
                    "has_clock": "%clk" in movetext, "pgn": pgn, "_raw": original,
                })
            if len(rows) < MIN_GAMES:
                reasons["user_under_min_games"] += 1
                continue
            for row in rows:
                raw_out.write(row.pop("_raw") + "\n")
                writer.writerow(row)
            dates = sorted(r["played_at"] for r in rows if r["played_at"])
            user_rows.append({
                "user_id": uid, "rating_band": band, "n_games": len(rows),
                "n_with_eval": sum(r["has_eval"] for r in rows), "first_played": dates[0], "last_played": dates[-1],
                "speeds": " ".join(f"{k}:{v}" for k, v in Counter(r["speed"] for r in rows).most_common()),
            })
            accepted += 1
            print(band, uid, len(rows), flush=True)
            time.sleep(1)
    raw_out.close()
    games_f.close()

    with open(os.path.join(PROCESSED, "user_profiles.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=USER_FIELDS)
        w.writeheader()
        w.writerows(user_rows)

    save_stats("user_games", {
        "source": API.format("{username}"), "candidate_source": os.path.basename(raw_pgn),
        "users_per_band_target": args.users_per_band, "max_games_per_user": args.max_games,
        "requests": requests_made, "fetched_games": fetched_games,
        "users": len(user_rows), "users_by_band": dict(Counter(u["rating_band"] for u in user_rows)),
        "games": sum(u["n_games"] for u in user_rows), "games_with_eval": sum(u["n_with_eval"] for u in user_rows),
        "games_per_user_min": min(u["n_games"] for u in user_rows),
        "games_per_user_max": max(u["n_games"] for u in user_rows),
        "rejected": dict(reasons.most_common()), "elapsed_sec": round(time.time() - started),
    })


if __name__ == "__main__":
    main()
