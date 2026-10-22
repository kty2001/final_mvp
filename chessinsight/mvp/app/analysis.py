"""PGN 파싱과 Stockfish 기반 수별 분석."""
import glob
import hashlib
import io
import math
import os

import chess
import chess.engine
import chess.pgn

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIME_LIMIT = float(os.environ.get("ANALYSIS_TIME", "0.1"))
MULTIPV = 3
PV_LEN = 6

# 승률 손실(수 둔 쪽 기준, %p) 구간
THRESHOLDS = [(30, "blunder"), (20, "mistake"), (10, "inaccuracy")]
PIECE_VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def engine_path():
    path = os.environ.get("STOCKFISH_PATH")
    if path:
        return path
    found = glob.glob(os.path.join(BASE_DIR, "engine", "**", "stockfish*.exe"), recursive=True)
    found += glob.glob(os.path.join(BASE_DIR, "engine", "**", "stockfish*"), recursive=True)
    files = [f for f in found if os.path.isfile(f)]
    if not files:
        raise RuntimeError("Stockfish 실행 파일 없음. engine/ 폴더에 두거나 STOCKFISH_PATH 지정 필요")
    return files[0]


def win_prob(cp):
    """센티폰(백 기준) → 백 승률(%). Lichess 공개 식."""
    cp = max(-1000, min(1000, cp))
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


# ---------------------------------------------------------------- PGN

def _played_at(headers):
    date = headers.get("UTCDate") or headers.get("Date") or ""
    parts = date.split(".")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return f"{parts[0]}-{parts[1]}-{parts[2]}"
    return None


def parse_pgn(text):
    """여러 대국이 든 PGN 텍스트 → (대국 목록, 오류 목록)."""
    games, errors = [], []
    stream = io.StringIO(text)
    index = 0
    while True:
        try:
            game = chess.pgn.read_game(stream)
        except Exception as e:  # 손상된 입력
            errors.append({"index": index, "error": str(e)})
            break
        if game is None:
            break
        index += 1
        if game.errors:
            errors.append({"index": index, "error": str(game.errors[0])})
            continue
        moves = [m.uci() for m in game.mainline_moves()]
        if not moves:
            errors.append({"index": index, "error": "수순 없음"})
            continue
        h = game.headers
        key = "|".join([h.get("White", ""), h.get("Black", ""), h.get("Date", ""),
                        h.get("UTCTime", ""), " ".join(moves)])
        games.append({
            "hash": hashlib.sha256(key.encode()).hexdigest(),
            "record_raw": str(game),
            "white": h.get("White", "?"),
            "black": h.get("Black", "?"),
            "white_elo": h.get("WhiteElo"),
            "black_elo": h.get("BlackElo"),
            "result": h.get("Result", "*"),
            "played_at": _played_at(h),
            "opening": h.get("Opening") or h.get("ECO"),
            "time_control": h.get("TimeControl"),
            "n_plies": len(moves),
        })
    return games, errors


# ---------------------------------------------------------------- 분석

def _pv_san(board, pv):
    b = board.copy()
    out = []
    for move in pv[:PV_LEN]:
        if move not in b.legal_moves:
            break
        out.append(b.san(move))
        b.push(move)
    return out


def _pv_fens(board, pv):
    b = board.copy()
    out = []
    for move in pv[:PV_LEN]:
        if move not in b.legal_moves:
            break
        b.push(move)
        out.append(b.fen())
    return out


def _evaluate(engine, board):
    """포지션 평가. 반환: 백 승률, 백 기준 메이트 수, 후보 수 목록."""
    if board.is_game_over():
        outcome = board.outcome()
        win = 50.0 if outcome.winner is None else (100.0 if outcome.winner == chess.WHITE else 0.0)
        return {"win_white": win, "mate_white": None, "cands": []}
    infos = engine.analyse(board, chess.engine.Limit(time=TIME_LIMIT), multipv=MULTIPV)
    cands = []
    for info in infos:
        if "pv" not in info or not info["pv"]:
            continue
        score = info["score"].white()
        cands.append({
            "move": info["pv"][0],
            "pv": info["pv"],
            "win_white": win_prob(score.score(mate_score=100000)),
            "mate_white": score.mate(),
        })
    top = cands[0]
    return {"win_white": top["win_white"], "mate_white": top["mate_white"], "cands": cands}


def _phase(board, ply):
    if ply <= 20:
        return "opening"
    material = sum(PIECE_VALUE[p.piece_type] for p in board.piece_map().values()
                   if p.piece_type not in (chess.PAWN, chess.KING))
    return "endgame" if material <= 13 else "middlegame"


def _captured_value(board, move):
    if not board.is_capture(move):
        return 0
    if board.is_en_passant(move):
        return 1
    return PIECE_VALUE[board.piece_at(move.to_square).piece_type]


def classify(loss, forced):
    if forced:
        return "forced"
    for limit, name in THRESHOLDS:
        if loss >= limit:
            return name
    return "good"


def analyze_game(record_raw, progress=None):
    """대국 전체 분석. 수별 결과 목록 반환."""
    game = chess.pgn.read_game(io.StringIO(record_raw))
    nodes = list(game.mainline())
    board = game.board()
    boards = [board.copy()]
    for node in nodes:
        board.push(node.move)
        boards.append(board.copy())

    evals = []
    with chess.engine.SimpleEngine.popen_uci(engine_path()) as engine:
        for i, b in enumerate(boards):
            evals.append(_evaluate(engine, b))
            if progress:
                progress(int(100 * (i + 1) / len(boards)))

    moves = []
    for i, node in enumerate(nodes):
        before, after = boards[i], boards[i + 1]
        ev_b, ev_a = evals[i], evals[i + 1]
        white = before.turn == chess.WHITE
        pov = (lambda w: w) if white else (lambda w: 100 - w)
        win_before, win_after = pov(ev_b["win_white"]), pov(ev_a["win_white"])
        loss = max(0.0, win_before - win_after)
        forced = before.legal_moves.count() == 1
        best = ev_b["cands"][0] if ev_b["cands"] else None
        reply = ev_a["cands"][0] if ev_a["cands"] else None
        sign = 1 if white else -1

        tags = []
        cls = classify(loss, forced)
        if cls in ("inaccuracy", "mistake", "blunder"):
            mate_b = ev_b["mate_white"]
            mate_a = ev_a["mate_white"]
            if mate_b is not None and mate_b * sign > 0 and not (mate_a is not None and mate_a * sign > 0):
                tags.append("missed_mate")
            if mate_a is not None and mate_a * sign < 0:
                tags.append("allowed_mate")
            if reply and _captured_value(after, reply["move"]) >= 3:
                tags.append("hanging_piece")
            if best and best["move"] != node.move and _captured_value(before, best["move"]) >= 3:
                tags.append("missed_capture")
            clock = node.clock()
            if clock is not None and clock < 30:
                tags.append("time_trouble")

        moves.append({
            "ply": i + 1,
            "color": "white" if white else "black",
            "san": before.san(node.move),
            "uci": node.move.uci(),
            "fen_before": before.fen(),
            "fen_after": after.fen(),
            "win_before": round(win_before, 1),
            "win_after": round(win_after, 1),
            "win_white_after": round(ev_a["win_white"], 1),
            "loss": round(loss, 1),
            "cls": "best" if best and best["move"] == node.move and not forced else cls,
            "phase": _phase(before, i + 1),
            "clock": node.clock(),
            "tags": tags,
            "best_san": before.san(best["move"]) if best else None,
            "best_uci": best["move"].uci() if best else None,
            "best_pv": _pv_san(before, best["pv"]) if best else [],
            "best_pv_fens": _pv_fens(before, best["pv"]) if best else [],
            "refutation": _pv_san(after, reply["pv"]) if reply else [],
            "refutation_capture": PIECE_NAME.get(
                after.piece_at(reply["move"].to_square).piece_type) if reply and after.is_capture(reply["move"])
                and not after.is_en_passant(reply["move"]) else None,
            "best_capture": PIECE_NAME.get(
                before.piece_at(best["move"].to_square).piece_type) if best and before.is_capture(best["move"])
                and not before.is_en_passant(best["move"]) else None,
            "candidates": [{
                "san": before.san(c["move"]),
                "win": round(pov(c["win_white"]), 1),
                "pv": _pv_san(before, c["pv"]),
            } for c in ev_b["cands"]],
        })

    # 응징 여부: 상대의 바로 다음 수가 근소한 손실(<10) 이내면 응징한 것으로 봄
    for i, m in enumerate(moves):
        if m["cls"] in ("inaccuracy", "mistake", "blunder"):
            nxt = moves[i + 1] if i + 1 < len(moves) else None
            m["punished"] = None if nxt is None else nxt["loss"] < 10
    return moves


PIECE_NAME = {chess.PAWN: "폰", chess.KNIGHT: "나이트", chess.BISHOP: "비숍",
              chess.ROOK: "룩", chess.QUEEN: "퀸", chess.KING: "킹"}
