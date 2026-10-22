"""ChessInsight AI MVP API 서버."""
import os
import queue
import threading
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import coach, report, store
from .analysis import BASE_DIR, analyze_game, engine_path, parse_pgn

app = FastAPI(title="ChessInsight AI MVP")
_jobs: "queue.Queue[int]" = queue.Queue()


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
        store.update(game_id, status="analyzing", progress=0, error=None)
        try:
            moves = analyze_game(g["record_raw"], lambda p: store.update(game_id, progress=p))
            store.update(game_id, status="done", progress=100, analysis=moves,
                         engine_name=os.path.basename(engine_path()))
        except Exception as e:
            store.update(game_id, status="error", error=str(e))
        if _jobs.empty():  # 대기 중인 분석이 없으면 정기 리포트 갱신
            generate_reports()


def generate_reports():
    """완료된 대국이 있는 모든 주·월 리포트를 시간순으로 (재)생성. 직전 리포트와 비교 포함."""
    games = store.done_games()
    for kind in ("weekly", "monthly"):
        prev = None
        for start, end in report.periods(games, kind):
            data = report.period_report(games, kind, start, end, prev)
            store.upsert_report(kind, data["start"], data["end"], data["overview"]["games"], data)
            prev = data


@app.on_event("startup")
def _startup():
    store.init()
    generate_reports()
    for game_id in store.pending_ids():  # 재시작 시 미완료 작업 재등록
        _jobs.put(game_id)
    threading.Thread(target=_worker, daemon=True).start()


def _import(text, username):
    games, errors = parse_pgn(text)
    name = username.strip().lower()
    added, duplicates, unmatched = [], 0, 0
    for g in games:
        if name and g["white"].lower() == name:
            color = "white"
        elif name and g["black"].lower() == name:
            color = "black"
        else:
            color, unmatched = "white", unmatched + 1
        game_id = store.add_game(g, color)
        if game_id is None:
            duplicates += 1
        else:
            added.append(game_id)
            _jobs.put(game_id)
    return {"added": len(added), "duplicates": duplicates, "errors": errors,
            "unmatched": unmatched,
            "note": f"닉네임과 일치하지 않는 {unmatched}판은 백 기준으로 분석" if unmatched else None}


@app.post("/api/games/upload")
async def upload(file: UploadFile = File(...), username: str = Form("")):
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "UTF-8 PGN 파일만 지원")
    return _import(text, username)


@app.post("/api/games/sample")
def load_sample():
    with open(os.path.join(BASE_DIR, "sample", "sample.pgn"), encoding="utf-8") as f:
        return _import(f.read(), "demo_user")


@app.get("/api/games")
def games():
    return store.list_games()


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
    return coach.explain(g["analysis"][ply - 1], type)


@app.get("/api/report")
def get_report(days: int = 30, end: Optional[str] = None):
    return report.build_report(store.done_games(), days, end)


@app.get("/api/dashboard")
def dashboard(window: int = 10):
    return report.trend(store.done_games(), max(1, window))


@app.get("/api/reports")
def reports(kind: str = "monthly"):
    if kind not in ("weekly", "monthly"):
        raise HTTPException(400, "kind는 weekly 또는 monthly")
    return store.list_reports(kind)


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


@app.post("/api/ask")
def ask(q: Question):
    return coach.answer(q.question, report.build_report(store.done_games(), q.days))


@app.get("/api/suggestions")
def suggestions():
    return coach.SUGGESTIONS


app.mount("/", StaticFiles(directory=os.path.join(BASE_DIR, "static"), html=True), name="static")
