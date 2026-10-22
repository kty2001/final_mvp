"""D2. Lichess 퍼즐 DB(CC0) 수집: 원본 다운로드 → 검증·중복 제거 → 서비스 전술 태그 매핑."""
import csv
import io
import os
import random
import time
from collections import Counter

import chess
import requests
import zstandard

from common import PROCESSED, RAW, USER_AGENT, save_stats

URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
REQUIRED = ["PuzzleId", "FEN", "Moves", "Rating", "RatingDeviation", "Popularity", "NbPlays", "Themes"]
MAX_RD, MIN_PLAYS = 100, 100
SAMPLE_SIZE = 100_000

# Lichess 테마 → 서비스 전술 태그 ID(요구사항 FAD-03·MVP 실수 태그와 같은 체계)
TACTIC_MAP = {
    "fork": "fork", "pin": "pin", "skewer": "skewer", "discoveredAttack": "discovered_attack",
    "doubleCheck": "double_check", "backRankMate": "back_rank_mate", "deflection": "deflection",
    "attraction": "decoy", "intermezzo": "intermezzo", "hangingPiece": "hanging_piece",
    "trappedPiece": "trapped_piece", "capturingDefender": "capturing_defender", "xRayAttack": "x_ray",
    "clearance": "clearance", "interference": "interference", "sacrifice": "sacrifice",
    "mate": "mate", "zugzwang": "zugzwang", "promotion": "promotion",
}
PHASES = ("opening", "middlegame", "endgame")
FIELDS = ["puzzle_id", "fen", "moves", "rating", "rating_deviation", "popularity", "nb_plays",
          "phase", "tactic_tags", "themes", "game_url", "opening_tags"]


def download(path):
    if os.path.exists(path):
        return
    with requests.get(URL, stream=True, timeout=60, headers={"User-Agent": USER_AGENT}) as r:
        r.raise_for_status()
        with open(path + ".part", "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    os.replace(path + ".part", path)


def legal_line(fen, moves):
    try:
        board = chess.Board(fen)
        for uci in moves.split():
            move = chess.Move.from_uci(uci)
            if move not in board.legal_moves:
                return False
            board.push(move)
        return True
    except ValueError:
        return False


def main():
    started = time.time()
    raw_path = os.path.join(RAW, "lichess_db_puzzle.csv.zst")
    download(raw_path)

    total = 0
    invalid = Counter()
    seen = set()
    theme_counts, tag_counts = Counter(), Counter()
    usable = 0
    rng = random.Random(42)
    sample, sample_fail = 0, 0

    with open(raw_path, "rb") as fh, \
            open(os.path.join(PROCESSED, "lichess_puzzles.csv"), "w", encoding="utf-8-sig", newline="") as out_f:
        text = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(fh), encoding="utf-8")
        writer = csv.DictWriter(out_f, fieldnames=FIELDS)
        writer.writeheader()
        for row in csv.DictReader(text):
            total += 1
            if any(not row.get(k) for k in REQUIRED):
                invalid["missing_field"] += 1
                continue
            try:
                rating, rd = int(row["Rating"]), int(row["RatingDeviation"])
                popularity, plays = int(row["Popularity"]), int(row["NbPlays"])
            except ValueError:
                invalid["bad_type"] += 1
                continue
            if row["PuzzleId"] in seen:
                invalid["duplicate"] += 1
                continue
            seen.add(row["PuzzleId"])
            themes = row["Themes"].split()
            theme_counts.update(themes)
            # 무작위 표본 합법성 검증(전수는 시간 비용이 커 표본 검증)
            if rng.random() < SAMPLE_SIZE / 6_000_000:
                sample += 1
                if not legal_line(row["FEN"], row["Moves"]):
                    sample_fail += 1
                    invalid["illegal_in_sample"] += 1
                    continue
            if rd > MAX_RD or plays < MIN_PLAYS:
                continue
            tags = sorted({TACTIC_MAP[t] for t in themes if t in TACTIC_MAP})
            tag_counts.update(tags)
            usable += 1
            writer.writerow({
                "puzzle_id": row["PuzzleId"], "fen": row["FEN"], "moves": row["Moves"], "rating": rating,
                "rating_deviation": rd, "popularity": popularity, "nb_plays": plays,
                "phase": next((p for p in PHASES if p in themes), ""), "tactic_tags": " ".join(tags),
                "themes": row["Themes"], "game_url": row.get("GameUrl", ""), "opening_tags": row.get("OpeningTags", ""),
            })

    save_stats("lichess_puzzles", {
        "source": URL, "compressed_bytes": os.path.getsize(raw_path), "total_rows": total,
        "invalid": dict(invalid), "unique_valid": len(seen) - invalid["illegal_in_sample"],
        "usable_filter": f"RatingDeviation <= {MAX_RD} and NbPlays >= {MIN_PLAYS}", "usable_rows": usable,
        "legality_sample": sample, "legality_sample_fail": sample_fail,
        "tactic_tag_counts": dict(tag_counts.most_common()),
        "top_themes": dict(theme_counts.most_common(30)), "n_themes": len(theme_counts),
        "elapsed_sec": round(time.time() - started),
    })


if __name__ == "__main__":
    main()
