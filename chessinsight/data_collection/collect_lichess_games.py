"""D1. Lichess 월별 표준 대국 DB(CC0)에서 레이팅 구간별 대국 표본 수집.

월별 .pgn.zst를 HTTP 스트리밍으로 해제하며 헤더로 1차 필터 → 선정 대국만 python-chess 검증.
전체 파일은 저장하지 않고, 선정 대국 원본만 data/raw에 보존.
"""
import argparse
import csv
import io
import os
import re
import time
from collections import Counter

import requests
import zstandard

from common import (BANDS, PROCESSED, RAW, SPEEDS, USER_AGENT, band_of, parse_pgn, pseudonym,
                    save_stats, speed_of)

LIST_URL = "https://database.lichess.org/standard/list.txt"
EXCLUDED_TERMINATIONS = {"Abandoned", "Rules infraction", "Unterminated"}
MIN_PLIES = 20
HEADER_RE = re.compile(r'^\[(\w+) "(.*)"\]$')
FIELDS = ["game_id", "rating_band", "speed", "white_id", "black_id", "white_elo", "black_elo", "result",
          "termination", "played_at", "time_control", "eco", "opening", "n_plies", "has_eval", "has_clock", "pgn"]


class CountingReader:
    def __init__(self, raw):
        self.raw, self.n = raw, 0

    def read(self, size=-1):
        data = self.raw.read(size)
        self.n += len(data)
        return data


def iter_games(text_stream):
    """Lichess PGN(헤더 블록 + 한 줄 수순) → (헤더 dict, 헤더 원문, 수순 원문)."""
    headers, header_lines, moves = {}, [], []
    for line in text_stream:
        line = line.rstrip("\n")
        if line.startswith("["):
            if moves:
                yield headers, header_lines, " ".join(moves)
                headers, header_lines, moves = {}, [], []
            m = HEADER_RE.match(line)
            if m:
                headers[m.group(1)] = m.group(2)
            header_lines.append(line)
        elif line:
            moves.append(line)
    if moves:
        yield headers, header_lines, " ".join(moves)


def reject_reason(h, movetext):
    if "Rated" not in h.get("Event", ""):
        return "not_rated"
    if h.get("Variant", "Standard") != "Standard":
        return "variant"
    if speed_of(h.get("TimeControl")) not in SPEEDS:
        return "speed"
    if h.get("Termination") in EXCLUDED_TERMINATIONS:
        return "termination"
    try:
        we, be = int(h["WhiteElo"]), int(h["BlackElo"])
    except (KeyError, ValueError):
        return "no_elo"
    if band_of(we) != band_of(be):
        return "band_mismatch"
    if "%eval" not in movetext:
        return "no_eval"
    if "%clk" not in movetext:
        return "no_clock"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="YYYY-MM (기본: 최신)")
    ap.add_argument("--per-band", type=int, default=2000)
    ap.add_argument("--max-gb", type=float, default=3.0, help="압축 기준 최대 읽기량")
    args = ap.parse_args()

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    urls = session.get(LIST_URL, timeout=30).text.split()
    url = next(u for u in urls if args.month is None or args.month in u)
    month = re.search(r"(\d{4}-\d{2})", url).group(1)
    print("source:", url)

    target = {name: args.per_band for _, _, name in BANDS}
    selected = Counter()
    reasons = Counter()
    seen = set()
    streamed = 0
    started = time.time()

    raw_path = os.path.join(RAW, f"lichess_games_{month}_selected.pgn")
    out_path = os.path.join(PROCESSED, "lichess_games.csv")
    resp = session.get(url, stream=True, timeout=60)
    resp.raise_for_status()
    counter = CountingReader(resp.raw)
    reader = zstandard.ZstdDecompressor().stream_reader(counter)
    text = io.TextIOWrapper(reader, encoding="utf-8", errors="replace")

    with open(raw_path, "w", encoding="utf-8") as raw_f, \
            open(out_path, "w", encoding="utf-8-sig", newline="") as out_f:
        writer = csv.DictWriter(out_f, fieldnames=FIELDS)
        writer.writeheader()
        for h, header_lines, movetext in iter_games(text):
            streamed += 1
            if streamed % 200000 == 0:
                print(f"{streamed:,} games, {counter.n / 1e9:.2f} GB, {dict(selected)}", flush=True)
            if counter.n > args.max_gb * 1e9 or all(selected[b] >= target[b] for b in target):
                break
            reason = reject_reason(h, movetext)
            if reason:
                reasons[reason] += 1
                continue
            band = band_of(int(h["WhiteElo"]))
            if selected[band] >= target[band]:
                reasons["band_full"] += 1
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
            if game_id in seen or g["hash"] in seen:
                reasons["duplicate"] += 1
                continue
            seen.update((game_id, g["hash"]))

            raw_f.write(original + "\n")
            wid, bid = pseudonym(h["White"]), pseudonym(h["Black"])
            pgn = original.replace(f'[White "{h["White"]}"]', f'[White "{wid}"]') \
                          .replace(f'[Black "{h["Black"]}"]', f'[Black "{bid}"]')
            writer.writerow({
                "game_id": game_id, "rating_band": band, "speed": speed_of(h["TimeControl"]),
                "white_id": wid, "black_id": bid, "white_elo": int(h["WhiteElo"]), "black_elo": int(h["BlackElo"]),
                "result": h.get("Result"), "termination": h.get("Termination"), "played_at": g["played_at"],
                "time_control": h["TimeControl"], "eco": h.get("ECO"), "opening": h.get("Opening"),
                "n_plies": g["n_plies"], "has_eval": True, "has_clock": True, "pgn": pgn,
            })
            selected[band] += 1
    resp.close()

    save_stats("lichess_games", {
        "source": url, "month": month, "per_band_target": args.per_band,
        "streamed_games": streamed, "compressed_bytes_read": counter.n,
        "selected_total": sum(selected.values()),
        "selected_by_band": {name: selected[name] for _, _, name in BANDS},
        "rejected": dict(reasons.most_common()),
        "elapsed_sec": round(time.time() - started),
    })


if __name__ == "__main__":
    main()
