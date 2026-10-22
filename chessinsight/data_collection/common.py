"""수집 스크립트 공통: 경로, 레이팅 구간, 속도 판정, 가명화, 통계 저장."""
import hashlib
import json
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "raw")
PROCESSED = os.path.join(HERE, "data", "processed")
STATS = os.path.join(HERE, "data", "stats")
for _d in (RAW, PROCESSED, STATS):
    os.makedirs(_d, exist_ok=True)

# MVP의 PGN 파서(합법성 검증·메타데이터·해시) 재사용
sys.path.insert(0, os.path.join(HERE, "..", "mvp"))
from app.analysis import parse_pgn  # noqa: E402,F401

USER_AGENT = "ChessInsightAI-data-collection (education project)"

BANDS = [(0, 1199, "~1199"), (1200, 1399, "1200-1399"), (1400, 1599, "1400-1599"),
         (1600, 1799, "1600-1799"), (1800, 1999, "1800-1999"), (2000, 2199, "2000-2199"),
         (2200, 9999, "2200~")]
SPEEDS = ("blitz", "rapid", "classical")
SALT = os.environ.get("PSEUDONYM_SALT", "chessinsight-2026")


def band_of(elo):
    for lo, hi, name in BANDS:
        if lo <= elo <= hi:
            return name
    return None


def speed_of(time_control):
    """Lichess 기준 예상 대국 시간(base + 40*inc)으로 속도 구분."""
    if not time_control or time_control == "-" or "+" not in time_control:
        return "correspondence"
    base, inc = (int(x) for x in time_control.split("+"))
    t = base + 40 * inc
    if t < 30:
        return "ultrabullet"
    if t < 180:
        return "bullet"
    if t < 480:
        return "blitz"
    if t < 1500:
        return "rapid"
    return "classical"


def pseudonym(username):
    return "u_" + hashlib.sha256((SALT + username.lower()).encode()).hexdigest()[:10]


def save_stats(name, stats):
    stats["generated_at"] = datetime.now().isoformat(timespec="seconds")
    with open(os.path.join(STATS, f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    print(json.dumps(stats, ensure_ascii=False, indent=2))
