"""D3. lichess-org/chess-openings(CC0) 오프닝 목록 수집: ECO·이름·수순 → 합법성 검증, UCI·최종 포지션 추가."""
import csv
import io
import os
import time
from collections import Counter

import chess
import chess.pgn
import requests

from common import PROCESSED, RAW, USER_AGENT, save_stats

BASE = "https://raw.githubusercontent.com/lichess-org/chess-openings/master/{}.tsv"
FIELDS = ["eco", "name", "family", "pgn", "uci", "epd", "n_plies"]


def main():
    started = time.time()
    rows, invalid = [], Counter()
    for vol in "abcde":
        text = requests.get(BASE.format(vol), timeout=30, headers={"User-Agent": USER_AGENT}).text
        with open(os.path.join(RAW, f"chess_openings_{vol}.tsv"), "w", encoding="utf-8", newline="") as f:
            f.write(text)
        rows += list(csv.DictReader(io.StringIO(text), delimiter="\t"))

    out, seen = [], set()
    for r in rows:
        if not (r.get("eco") and r.get("name") and r.get("pgn")):
            invalid["missing_field"] += 1
            continue
        key = (r["eco"], r["name"], r["pgn"])
        if key in seen:
            invalid["duplicate"] += 1
            continue
        seen.add(key)
        game = chess.pgn.read_game(io.StringIO(r["pgn"]))
        if game is None or game.errors:
            invalid["illegal_moves"] += 1
            continue
        board = game.board()
        ucis = []
        for move in game.mainline_moves():
            ucis.append(move.uci())
            board.push(move)
        out.append({"eco": r["eco"], "name": r["name"], "family": r["name"].split(":")[0], "pgn": r["pgn"],
                    "uci": " ".join(ucis), "epd": board.epd(), "n_plies": len(ucis)})

    with open(os.path.join(PROCESSED, "openings.csv"), "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(out)

    epd_counts = Counter(o["epd"] for o in out)
    save_stats("openings", {
        "source": BASE.format("{a..e}"), "total_rows": len(rows), "invalid": dict(invalid), "usable_rows": len(out),
        "families": len({o["family"] for o in out}),
        "eco_groups": dict(sorted(Counter(o["eco"][0] for o in out).items())),
        "shared_epd_positions": sum(1 for c in epd_counts.values() if c > 1),
        "max_plies": max(o["n_plies"] for o in out),
        "elapsed_sec": round(time.time() - started),
    })


if __name__ == "__main__":
    main()
