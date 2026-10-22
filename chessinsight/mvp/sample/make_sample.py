"""데모용 sample.pgn 생성.

demo_user가 2026-08~10월 36판을 두며 점차 강해지는 상황을 Stockfish Skill Level로 흉내 냄.
레이팅은 결과에 따라 Elo 식으로 갱신, 시계(%clk)는 임의 생성.
사용: python sample/make_sample.py  (STOCKFISH_PATH 또는 engine/ 자동 탐색)
"""
import datetime
import os
import random
import sys

import chess
import chess.engine
import chess.pgn

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.analysis import engine_path  # noqa: E402

N_GAMES = 36
START = datetime.date(2026, 8, 3)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample.pgn")
OPENINGS = [("Italian Game", ["e4", "e5", "Nf3", "Nc6", "Bc4"]), ("Sicilian Defense", ["e4", "c5"]),
            ("Queen's Gambit", ["d4", "d5", "c4"]), ("French Defense", ["e4", "e6"]),
            ("London System", ["d4", "d5", "Bf4"]), ("Caro-Kann Defense", ["e4", "c6"])]
OPPONENTS = ["knight_rider", "pawnstorm", "bishop_pair", "rookie99", "castle_king", "endgame_fan"]


def play(engine, user_white, user_skill, opp_skill, book):
    board, game = chess.Board(), chess.pgn.Game()
    node, clocks = game, {chess.WHITE: 300.0, chess.BLACK: 300.0}
    while not board.is_game_over() and board.ply() < 110:
        if board.ply() < len(book):
            move = board.parse_san(book[board.ply()])
        else:
            is_user = (board.turn == chess.WHITE) == user_white
            engine.configure({"Skill Level": user_skill if is_user else opp_skill})
            move = engine.play(board, chess.engine.Limit(time=0.02)).move
        clocks[board.turn] = max(1.0, clocks[board.turn] - random.uniform(1, 9 if board.ply() > 40 else 5))
        node = node.add_variation(move)
        node.set_clock(round(clocks[board.turn]))
        board.push(move)
    if board.is_game_over():
        result = board.result()
    else:  # 110수 제한: 평가로 판정
        cp = engine.analyse(board, chess.engine.Limit(time=0.1))["score"].white().score(mate_score=10000)
        result = "1-0" if cp > 300 else "0-1" if cp < -300 else "1/2-1/2"
    return game, result


def main():
    random.seed(7)
    rating = 1250
    games = []
    with chess.engine.SimpleEngine.popen_uci(engine_path()) as engine:
        for i in range(N_GAMES):
            day = START + datetime.timedelta(days=round(i * 2.2))
            user_white = i % 2 == 0
            user_skill = round(7 * i / (N_GAMES - 1))  # 0 → 7
            opp_rating = random.randint(1180, 1380)
            name, book = OPENINGS[i % len(OPENINGS)]
            opp = OPPONENTS[i % len(OPPONENTS)]
            game, result = play(engine, user_white, user_skill, 3, book)
            game.headers.update({
                "Event": "Rated Blitz game", "Site": "sample", "Date": day.strftime("%Y.%m.%d"),
                "White": "demo_user" if user_white else opp, "Black": opp if user_white else "demo_user",
                "WhiteElo": str(rating if user_white else opp_rating),
                "BlackElo": str(opp_rating if user_white else rating),
                "TimeControl": "300+0", "Opening": name, "Result": result})
            score = 0.5 if result == "1/2-1/2" else float((result == "1-0") == user_white)
            expected = 1 / (1 + 10 ** ((opp_rating - rating) / 400))
            rating = round(rating + 20 * (score - expected))
            games.append(str(game))
            print(f"{i + 1}/{N_GAMES} {day} skill={user_skill} {result} -> {rating}")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n\n".join(games) + "\n")


if __name__ == "__main__":
    main()
