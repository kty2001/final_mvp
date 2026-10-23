"""ChessInsight AI MVP API 서버."""
import os
import queue
import threading
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import analysis, coach, poker, report, store
from .analysis import BASE_DIR

app = FastAPI(title="ChessInsight AI MVP")
_jobs: "queue.Queue[int]" = queue.Queue()

# 게임 어댑터 (기획서 4.5의 최소 형태): 게임마다 다른 부분은 기록 파싱·분석·엔진 이름뿐이고
# 저장·집계·리포트·질의는 공통 코드를 그대로 씀
GAMES = {
    "chess": {"parse": analysis.parse_pgn, "analyze": analysis.analyze_game, "format": "pgn",
              "engine": lambda: os.path.basename(analysis.engine_path()), "sample": "sample.pgn"},
    "poker": {"parse": poker.parse_hands, "analyze": poker.analyze_hand, "format": "hand-json",
              "engine": lambda: poker.ENGINE_NAME, "sample": "poker_hands.json"},
}


def _game_type(game_type):
    if game_type not in GAMES:
        raise HTTPException(400, f"game_type은 {', '.join(GAMES)} 중 하나")
    return game_type


@app.middleware("http")
async def _no_cache(request, call_next):
    """정적 파일 수정이 브라우저 캐시 때문에 반영되지 않는 문제 방지 (매번 재검증)."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache"
    return response


def _worker():
    """분석 작업 큐를 순서대로 처리 (기획서 4.3의 단순화: 단일 프로세스 내 스레드)."""
    while True:
        game_id = _jobs.get()
        g = store.get_game(game_id, with_raw=True)
        if not g:
            continue
        adapter = GAMES[g["game_type"]]
        store.update(game_id, status="analyzing", progress=0, error=None)
        try:
            moves = adapter["analyze"](g["record_raw"], lambda p: store.update(game_id, progress=p))
            store.update(game_id, status="done", progress=100, analysis=moves, engine_name=adapter["engine"]())
        except Exception as e:
            store.update(game_id, status="error", error=str(e))
        if _jobs.empty():  # 대기 중인 분석이 없으면 정기 리포트 갱신
            generate_reports()


def generate_reports():
    """완료된 대국이 있는 모든 주·월 리포트를 게임 종류별·시간순으로 (재)생성. 직전 리포트와 비교 포함."""
    for game_type in GAMES:
        games = store.done_games(game_type)
        for kind in ("weekly", "monthly"):
            prev = None
            for start, end in report.periods(games, kind):
                data = report.period_report(games, kind, start, end, prev)
                store.upsert_report(game_type, kind, data["start"], data["end"], data["overview"]["games"], data)
                prev = data


@app.on_event("startup")
def _startup():
    store.init()
    generate_reports()
    for game_id in store.pending_ids():  # 재시작 시 미완료 작업 재등록
        _jobs.put(game_id)
    threading.Thread(target=_worker, daemon=True).start()


def _import(text, username, game_type):
    adapter = GAMES[game_type]
    games, errors = adapter["parse"](text)
    name = username.strip().lower()
    added, duplicates, unmatched = [], 0, 0
    for g in games:
        if "user_color" in g:  # 포커: 핸드 기록에 히어로 위치가 들어 있음
            color = g["user_color"]
        elif name and g["white"].lower() == name:
            color = "white"
        elif name and g["black"].lower() == name:
            color = "black"
        else:
            color, unmatched = "white", unmatched + 1
        game_id = store.add_game(g, color, game_type, adapter["format"])
        if game_id is None:
            duplicates += 1
        else:
            added.append(game_id)
            _jobs.put(game_id)
    return {"added": len(added), "duplicates": duplicates, "errors": errors,
            "unmatched": unmatched,
            "note": f"닉네임과 일치하지 않는 {unmatched}판은 백 기준으로 분석" if unmatched else None}


@app.post("/api/games/upload")
async def upload(file: UploadFile = File(...), username: str = Form(""), game_type: str = Form("chess")):
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "UTF-8 텍스트 파일만 지원")
    return _import(text, username, _game_type(game_type))


@app.post("/api/games/sample")
def load_sample(game_type: str = "chess"):
    adapter = GAMES[_game_type(game_type)]
    with open(os.path.join(BASE_DIR, "sample", adapter["sample"]), encoding="utf-8") as f:
        return _import(f.read(), "demo_user", game_type)


@app.get("/api/games")
def games(game_type: str = "chess"):
    return store.list_games(_game_type(game_type))


@app.get("/api/games/{game_id}")
def game(game_id: int):
    g = store.get_game(game_id)
    if not g:
        raise HTTPException(404, "대국 없음")
    g["summary"] = report.game_summary(g) if g["analysis"] else None
    return g


@app.get("/api/games/{game_id}/moves/{ply}/explain")
def explain(game_id: int, ply: int, type: str = "why_bad"):
    g = store.get_game(game_id)
    if not g or not g["analysis"] or not 1 <= ply <= len(g["analysis"]):
        raise HTTPException(404, "분석된 수 없음")
    if type not in ("why_bad", "best_move"):
        raise HTTPException(400, "type은 why_bad 또는 best_move")
    return coach.explain(g["analysis"][ply - 1], type, g["game_type"])


@app.get("/api/report")
def get_report(days: int = 30, end: Optional[str] = None, game_type: str = "chess"):
    return report.build_report(store.done_games(_game_type(game_type)), days, end)


@app.get("/api/dashboard")
def dashboard(window: int = 10, game_type: str = "chess"):
    return report.trend(store.done_games(_game_type(game_type)), max(1, window))


@app.get("/api/reports")
def reports(kind: str = "monthly", game_type: str = "chess"):
    if kind not in ("weekly", "monthly"):
        raise HTTPException(400, "kind는 weekly 또는 monthly")
    return store.list_reports(kind, _game_type(game_type))


@app.post("/api/reports/generate")
def regenerate_reports():
    generate_reports()
    return {"ok": True}


@app.get("/api/reports/{report_id}")
def get_period_report(report_id: int):
    r = store.get_report(report_id)
    if not r:
        raise HTTPException(404, "리포트 없음")
    return r


class Question(BaseModel):
    question: str
    days: int = 30
    game_type: str = "chess"


@app.post("/api/ask")
def ask(q: Question):
    return coach.answer(q.question, report.build_report(store.done_games(_game_type(q.game_type)), q.days), q.game_type)


@app.get("/api/suggestions")
def suggestions(game_type: str = "chess"):
    return coach.SUGGESTIONS[_game_type(game_type)]


app.mount("/", StaticFiles(directory=os.path.join(BASE_DIR, "static"), html=True), name="static")
