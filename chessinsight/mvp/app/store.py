"""SQLite 저장소. 대국 원본·메타데이터·분석 결과(JSON)·작업 상태를 한 테이블에 보관."""
import json
import os
import sqlite3
import threading

from .analysis import BASE_DIR

DB_PATH = os.environ.get("CHESSINSIGHT_DB", os.path.join(BASE_DIR, "data", "chessinsight.db"))
_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT UNIQUE NOT NULL,
    game_type TEXT NOT NULL DEFAULT 'chess',
    record_format TEXT NOT NULL DEFAULT 'pgn',
    record_raw TEXT NOT NULL,
    white TEXT, black TEXT, white_elo TEXT, black_elo TEXT,
    user_color TEXT NOT NULL,
    result TEXT, played_at TEXT, opening TEXT, time_control TEXT, n_plies INTEGER,
    status TEXT NOT NULL DEFAULT 'queued',   -- queued | analyzing | done | error
    progress INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    engine_name TEXT,
    analysis TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS period_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,                      -- weekly | monthly
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    n_games INTEGER NOT NULL,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    data TEXT NOT NULL,
    UNIQUE (kind, period_start)
);
"""

COLUMNS = ["id", "white", "black", "white_elo", "black_elo", "user_color", "result", "played_at",
           "opening", "time_control", "n_plies", "status", "progress", "error", "engine_name", "created_at"]


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with _lock, _conn() as c:
        c.executescript(SCHEMA)


def add_game(g, user_color):
    """새 대국이면 id, 중복이면 None."""
    with _lock, _conn() as c:
        try:
            cur = c.execute(
                "INSERT INTO games (hash, record_raw, white, black, white_elo, black_elo, user_color, result,"
                " played_at, opening, time_control, n_plies) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (g["hash"], g["record_raw"], g["white"], g["black"], g["white_elo"], g["black_elo"], user_color,
                 g["result"], g["played_at"], g["opening"], g["time_control"], g["n_plies"]))
            return cur.lastrowid
        except sqlite3.IntegrityError:
            return None


def update(game_id, **fields):
    if "analysis" in fields:
        fields["analysis"] = json.dumps(fields["analysis"], ensure_ascii=False)
    sets = ", ".join(f"{k} = ?" for k in fields)
    with _lock, _conn() as c:
        c.execute(f"UPDATE games SET {sets} WHERE id = ?", (*fields.values(), game_id))


def list_games():
    with _conn() as c:
        rows = c.execute(f"SELECT {', '.join(COLUMNS)} FROM games ORDER BY played_at DESC, id DESC").fetchall()
    return [dict(r) for r in rows]


def get_game(game_id, with_raw=False):
    cols = COLUMNS + ["analysis"] + (["record_raw"] if with_raw else [])
    with _conn() as c:
        row = c.execute(f"SELECT {', '.join(cols)} FROM games WHERE id = ?", (game_id,)).fetchone()
    if not row:
        return None
    g = dict(row)
    g["analysis"] = json.loads(g["analysis"]) if g["analysis"] else None
    return g


def done_games():
    with _conn() as c:
        rows = c.execute(f"SELECT {', '.join(COLUMNS)}, analysis FROM games WHERE status = 'done'").fetchall()
    out = []
    for r in rows:
        g = dict(r)
        g["analysis"] = json.loads(g["analysis"])
        out.append(g)
    return out


def upsert_report(kind, start, end, n_games, data):
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO period_reports (kind, period_start, period_end, n_games, data) VALUES (?,?,?,?,?)"
            " ON CONFLICT (kind, period_start) DO UPDATE SET period_end = excluded.period_end,"
            " n_games = excluded.n_games, data = excluded.data, generated_at = datetime('now')",
            (kind, start, end, n_games, json.dumps(data, ensure_ascii=False)))


def list_reports(kind):
    with _conn() as c:
        rows = c.execute("SELECT id, kind, period_start, period_end, n_games, generated_at, data FROM period_reports"
                         " WHERE kind = ? ORDER BY period_start DESC", (kind,)).fetchall()
    out = []
    for r in rows:
        r = dict(r)
        data = json.loads(r.pop("data"))
        r["overview"] = data["overview"]
        r["previous_verdicts"] = [row["verdict"] for row in (data["previous"] or {}).get("rows", [])]
        out.append(r)
    return out


def get_report(report_id):
    with _conn() as c:
        row = c.execute("SELECT id, generated_at, data FROM period_reports WHERE id = ?", (report_id,)).fetchone()
    if not row:
        return None
    data = json.loads(row["data"])
    data.pop("raw")
    return {"id": row["id"], "generated_at": row["generated_at"], **data}


def pending_ids():
    with _conn() as c:
        rows = c.execute("SELECT id FROM games WHERE status IN ('queued', 'analyzing') ORDER BY id").fetchall()
    return [r["id"] for r in rows]
