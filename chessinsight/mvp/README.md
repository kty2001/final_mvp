# ChessInsight AI MVP

`../ChessInsight_AI_v2.md` 8장 MVP 범위의 시연용 구현. Python 단일 서버(FastAPI + python-chess + Stockfish + SQLite) + 정적 HTML/JS.

## 실행

```powershell
cd chessinsight/mvp
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
# Stockfish: https://github.com/official-stockfish/Stockfish/releases 의 Windows zip을 engine/ 에 압축 해제
#            (또는 환경변수 STOCKFISH_PATH 로 실행 파일 경로 지정)
.venv\Scripts\python -m uvicorn app.main:app --port 8765
```

브라우저에서 http://localhost:8765 → "대국 업로드" 탭에서 "샘플 불러오기" 또는 PGN 업로드.

## 화면

| 탭 | 내용 |
|---|---|
| 대시보드 | KPI(전적·레이팅·최근 10판 정확도), 레이팅 추이, 10판 이동 정확도·득점률, 10판 이동 실수 빈도(유형별), 월별 국면 정확도, 데이터 표. 표본이 10판 미만인 구간은 점선, 점 클릭 시 해당 대국 리뷰 |
| 대국 업로드 | PGN 업로드, 대국 목록·분석 진행률 |
| 대국 리뷰 | 보드, 수별 분류, 승률 그래프, 실제 수 vs 엔진 추천 수, 근거 기반 해설 |
| 약점 분석 | 전체 기간 반복 약점·국면·색별 통계, 최근 N일 vs 이전 N일 비교, 질의 |
| 정기 리포트 | 주간·월간 리포트 목록·상세(요약·맥락, 약점, **직전 리포트 대비 판정**, 훈련 권장). 분석이 끝날 때마다 자동 생성·갱신 |

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `STOCKFISH_PATH` | `engine/**/stockfish*.exe` 자동 탐색 | 엔진 경로 |
| `ANALYSIS_TIME` | `0.1` | 포지션당 분석 시간(초) |
| `CHESSINSIGHT_DB` | `data/chessinsight.db` | SQLite 경로 |

## 구성

| 파일 | 역할 |
|---|---|
| `app/main.py` | API 라우트, 분석 작업 큐(백그라운드 스레드) |
| `app/analysis.py` | PGN 파싱, Stockfish 분석, 승률 손실·실수 분류·패턴 태그 |
| `app/report.py` | 대국 요약, 반복 약점 통계, 기간 비교, 훈련 추천, 대시보드 추이, 주간·월간 리포트 |
| `app/coach.py` | 근거 기반 템플릿 해설, 리포트 질의(닫힌 질문 유형) |
| `app/store.py` | SQLite 저장 |
| `static/` | 화면 5개 (vanilla JS + Chart.js CDN) |
| `sample/sample.pgn` | 데모 대국 36판 (`demo_user`, 2026-08~10, 점차 강해지고 레이팅 변동) |
| `sample/make_sample.py` | 샘플 생성 스크립트 (Stockfish Skill Level 0→7, Elo 갱신) |

## 판정 기준

- 승률: 센티폰 → 승률 변환(Lichess 공개 식). 실수 판정은 수 둔 쪽 기준 **승률 손실(%p)**: 부정확 ≥10, 실수 ≥20, 블런더 ≥30. 유일 합법 수는 제외.
- 정확도: 수별 승률 손실을 Lichess 정확도 식으로 환산해 평균(유일 수 제외).
- 국면: 20수(ply) 이하 오프닝, 킹·폰 제외 기물 가치 합 ≤13이면 종반, 그 외 중반.
- 패턴 태그: 기물 방치(상대 최선 응수가 3점 이상 기물 잡기), 득점 기회 놓침, 메이트 놓침/허용, 시간 부족(`%clk` 30초 미만). 응징 여부 = 상대 다음 수의 손실 < 10.
- 반복 약점: 실수·블런더만 집계. 분석 대국 < 5판 또는 해당 유형 < 3회면 "표본 부족".
- 기간 비교: 기준일(기본 = 최근 대국일)의 직전 N일 vs 그 이전 N일. 두 기간 모두 5판 이상일 때 2-비율 z검정(5%)으로 개선/악화/변화 없음, 아니면 판단 보류.
- 대시보드 추세: 대국별 값 + 직전 10판 이동 집계(정확도 평균, 득점률, 100수당 실수율). 포함 판 수 < 10이면 표본 부족 표시.
- 정기 리포트: 주(월요일 시작)·월 단위, 완료 대국이 있는 기간만 생성. 직전 같은 종류 리포트와 위 기간 비교와 같은 기준으로 판정(주간은 대개 5판 미만이라 판단 보류).
- 해설: 엔진 근거로만 템플릿 문장 생성. 센티폰 수치 미노출, 손실 < 5%p면 "사실상 같은 수"로 이유를 만들지 않음.

## 기획서 대비 미구현 (MVP 이후)

- LLM 해설·질의(현재 템플릿·키워드 분류), 서버 측 LLM 출력 검증
- Maia 기반 레이팅별 "찾기 어려움" 보정
- 게임 어댑터 계층, Spring Boot·React·PostgreSQL·RabbitMQ 구성
- Chess.com·Lichess API 연동, 인증·다중 사용자, Lichess 퍼즐 추천 연결
