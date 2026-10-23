# ChessInsight AI

## 대화형 체스 코칭 및 실력 분석·자동 리포팅 플랫폼 기획안

- 문서 버전: 3.2 (이전 판 `ChessInsight_AI_v1.md`, `ChessInsight_AI_v2.md` 보존)
- 작성일: 2026-10-21 / 수정일: 2026-10-22
- 프로젝트 유형: AI 기반 데이터 분석 및 개인화 코칭 플랫폼

| 버전 | 주요 변경 |
|---|---|
| v2 | 다른 게임 확장 검토(12장), 게임 어댑터 계층(4.3), 경쟁 서비스 재조사와 차별점 재정의(3장) |
| v2.1 | 문제 정의에 근거 추가(1.2), 모델 선정·파인튜닝(4.5), API 정책·비용 추정(6·7장), 사실 오류 수정 |
| v3 | 봇 상대 연습 대국(2.3) |
| v3.1 | 현대 보드게임 **카탄** 확장 검토 추가(12.3), 문서 전체 압축 |
| v3.2 | 시장 조사 추가: Chess.com 이용자 규모, 유료·분석 기능 이용 비율, 국내 시장(7.1) |

---

## 1. 프로젝트 개요

### 1.1 한 줄 정의

체스 대국의 엔진 분석을 근거 기반 자연어로 설명하고, 여러 대국에 걸친 반복 약점을 찾아 훈련 방향과 정기 리포트를 제공하는 대화형 체스 코칭 플랫폼. 같은 구조(엔진이 근거를 만들고 LLM이 설명)를 강한 오픈 엔진이 있는 다른 게임으로 넓히는 방안도 검토(12장).

### 1.2 해결하려는 문제

**배경:** Chess.com 회원 약 2.69억 명, 월간 활성 이용자 약 3,800만 명, 유료 구독자 약 200만 명 [G48][G77]. 상세는 7.1.

**기존 서비스 현황:** 수별 해설과 대국 간 통계는 이미 보편화.

| 서비스 | 제공 기능 |
|---|---|
| Chess.com Game Review Coach | 수별 해설, 위협 설명, 화살표, 다시 두기 [G33] |
| Chess.com Insights (최상위 유료 등급 전용) | 국면별 정확도, 놓친 전술 포지션 목록, 직전 기간 비교, 비슷한 레이팅 비교 [G49] |
| Lichess | 엔진 분석, 실수 복기, Insights 모두 무료 [G50] |
| Take Take Take | Stockfish·패턴 검출기·Maia 근거로 LLM이 설명 [G31] |

따라서 문제는 "설명이 없음"이 아니라 기존 설명·통계의 아래 4가지 한계.

| 문제 | 근거 | 대응 |
|---|---|---|
| ① 설명을 믿기 어려움 | GPT-4o 단독 해설 정확성 0.36(사람 0.62, 엔진 개념 근거 제공 시 0.60) [G29]. 포지션을 함께 넣어도 환각은 남음 [G28]. 상용 코치도 자체 평가 통과율 약 75% [G31]. 이유 없는 일반적 코멘트에 대한 사용자 불만 [G53] | 응답마다 수의 합법성·근거 포함을 검사하는 서버 측 출력 검증(4.4) |
| ② 실력 수준을 반영하지 않은 실수 판정 | 엔진의 사람 수 일치율 최고 46%, 레이팅별 모델 Maia는 52% 이상 [G51]. 1800 레이팅 대국에서 13수 조합을 "놓친 승리"로 표시한다는 비판 [G52] | Maia로 "그 레이팅에서 찾을 수 있었던 수"만 약점으로 집계(2.2) |
| ③ 통계와 해설이 분리되고 변화 판정 근거 부족 | Insights는 지표 중심, 대국 연결은 놓친 전술·오프닝에 한정 [G49]. 기간 비교에 표본 신뢰도 표시 없음 | 모든 약점 태그에 근거 대국·수순·해설 연결, 기간 비교에 표본 신뢰도 판정 |
| ④ 분석이 훈련으로 이어지지 않음 | 사용자 44,213명 추적 연구: 시간의 90% 이상을 대국에 쓰지만 의도적 연습의 학습 효율이 3.61배 [G54][G55] | 약점 포지션 퀴즈·간격 반복, 약점 포지션에서 시작하는 연습 대국(2.3) |

### 1.3 목표 사용자

- 초기: 레이팅 향상을 원하는 초·중급자, 엔진 분석을 이해하기 어렵거나 반복 실수의 원인을 알고 싶은 플레이어
- 확장: 학생 대국을 검토하는 코치, 학습자 추이를 관리하는 교육 기관·클럽

### 1.4 핵심 가치

1. 엔진 최선 수와 실제 수의 차이를 포지션 근거와 함께 설명
2. 여러 대국에서 반복되는 약점 탐지
3. 분석 결과에 대한 후속 질문
4. 기간별 변화와 표본 충분성 판정
5. 주간·월간 자동 리포트와 훈련 권장
6. 반복 약점 포지션에서 시작하는 봇 상대 연습

---

## 2. 주요 기능

### 2.1 분석·리포트

| 기능 | 내용 |
|---|---|
| 대국 가져오기 | PGN 업로드(기본 경로), 지원 API 연동(정책 확인 후). 메타데이터 정리, 중복·파싱 오류 처리, 분석 진행률 표시 |
| 엔진 분석 | Stockfish 평가, 실제 수와 추천 수 비교, 블런더·실수·부정확 분류(기준 명시·일관 적용), 핵심 국면, 후보 수·변형 |
| 근거 기반 해설 | "왜 실수인가", "추천 수는 무엇을 막았나" 등에 답함. 엔진·분석 계층이 근거를 만들고 LLM은 문장으로만 변환 |
| 반복 약점 분석 | 전술 유형, 오프닝별 성과, 국면별 패턴, 시간 부족과의 동반 여부. 모든 발견을 관련 대국·수순으로 연결, 표본이 적으면 신뢰도 표시 |
| 기간별 리포트 | 주간·월간 요약, 레이팅·승률 추이, 실수 유형 빈도 변화, 이전 리포트와 비교. 레이팅 변화만으로 단정하지 않고 상대 수준·대국 수·시간제어를 함께 표시 |
| 훈련 추천 | 관찰된 데이터와 연결한 추천(전술 퍼즐, 오프닝 복습, 종반 학습, 시간 관리). 데이터가 부족하면 추가 관찰 제안 |

### 2.2 기본 품질 요건 (경쟁 서비스에서 가져오는 기능)

경쟁 서비스에도 있어 차별점이 아니라 갖춰야 할 기본 기능으로 다룸.

| 기능 | 출처 | 내용 |
|---|---|---|
| 레이팅별 "찾기 어려움" | Take Take Take + Maia [G30][G31] | 그 레이팅의 사람이 찾을 확률이 높았던 수를 놓친 경우만 반복 약점으로 집계 |
| 응징 여부 구분 | KaTrain [G35] | 상대가 놓친 실수와 실제로 응징된 실수를 따로 셈 |
| 뻔한 수를 뺀 손실 지표 | 백개먼 XG의 PR [G41] | 강제 수·유일한 합법 수를 빼고 승률 손실 평균. 게임 간 비교 가능 |
| 약 10판 단위 추세 | Mobalytics [G44] | 역량 점수를 일정 판 수 단위 추세로 표시 |
| 실수 퀴즈·간격 반복 | AI Sensei, Noctie, Chessiro [G32][G33][G34] | 약점 포지션을 다시 푸는 문제로 만들고 Lichess 퍼즐(CC0)의 같은 테마와 연결 |
| 물리고 다시 두기 | CORDOC ChessCoach, KaTrain [G26][G35] | 실수한 포지션으로 돌아가 다시 둠 |
| 봇 상대 연습·대국 중 피드백 | Chess.com Play Coach, Noctie, Lichess [G66]~[G69] | 2.3 연습 대국의 기본 형태 |

### 2.3 연습 대국

봇과 두면서 매 수 평가·해설을 받는 기능. 문제 ④에 대응해 분석을 실전형 연습으로 연결.

| 항목 | 내용 |
|---|---|
| 상대 봇 | 기본 Maia-2(사용자 레이팅대의 사람형 수). 강도 선택 시 Stockfish `UCI_Elo`(1320~3190), 1320 미만은 `Skill Level`(0~20) [G70] |
| 즉시 피드백 | 수마다 2.1의 분류와 짧은 해설. 4.4의 질문 유형·설명 거부 기준·출력 검증을 그대로 적용 |
| 물리기 | 실수·블런더면 다시 둘지 선택, 다시 둔 수도 재평가 |
| 종료 후 | `source = practice`인 Game으로 저장, 일반 분석 큐로 정밀 분석 |
| 통계 분리 | 물리기·봇 상대라 실전과 조건이 달라 반복 약점·기간 리포트 집계에서 기본 제외 |

- **처음부터 하기:** 초기 포지션에서 색·봇 강도를 골라 한 판 전체를 둠
- **약점 극복하기:** 반복 약점 태그를 고르면 그 실수가 나온 내 대국의 실수 직전 포지션에서 시작. 포지션이 부족하면 Lichess 공개 데이터의 같은 테마로 보충. N수 안에 해당 유형 실수 없이 넘기면 성공 `[측정 예정]`, 실패는 간격 반복에 재등록, 태그별 성공률을 리포트에 실전 재발률과 함께 표시
- 새로 만드는 것은 봇 착수, 연습 세션 관리, 성공 판정뿐. 나머지는 기존 기능 재사용
- 시작 포지션은 초기 포지션, 종료된 내 대국, 공개 데이터로 한정. 다른 플랫폼의 진행 중 대국 포지션 입력 경로는 만들지 않음(12.5)

---

## 3. 경쟁 서비스와 차별점

### 3.1 경쟁 현황 (2026-10 조사)

| 구분 | 대상 | 핵심 |
|---|---|---|
| 플랫폼 | Chess.com | Game Review Coach, Insights(대국 간 약점 추적), Play Coach(봇 연습·수별 피드백) [G33][G49][G66] |
| 플랫폼 | Lichess | 분석·실수 복기·Insights·컴퓨터 연습 전부 무료 [G50][G69] |
| 상용 | DecodeChess, Aimchess | 서술형 해설(월 $8.25), 여러 대국 통계·훈련 리포트(월 $7.99) [G57][G65] |
| 상용 | Take Take Take | Stockfish·검출기·Maia 근거 + Gemini 3 Flash 설명, 시나리오 16개와 LLM 심판으로 평가, 목표 응답 3초 [G31] |
| 상용 | Chessiro, Noctie, Chess Coach 앱 | 반복 실수 반영, 사람형 봇, 실수 퍼즐 간격 반복 [G32][G68] |
| 오픈소스 | loocookie/ChessGPT | 같은 수 차례 비교, 숫자를 뺀 근거로 LLM이 한국어 3문장 작성, 한국어 용어집 내장. 라이선스 없어 설계만 참고 [G47] |
| 오픈소스 | CORDOC ChessCoach, thinkfish 등 | 기기 안 Stockfish 판정 + LLM 설명, 물리기. thinkfish는 "LLM 출력은 판과 따로 대조해야 함"을 보여 줌 [G26][G27][G28] |
| 연구 | CCC(NAACL 2025), Maia-2 | 엔진 개념 점수를 LLM에 전달(정확성 0.60), 레이팅별 사람 수 예측 [G29][G30] |

**결론:** "엔진이 판정하고 LLM은 설명만 한다"는 2026년 기준 업계 표준. 수별 등급, 대국 요약, 후속 질문, 실수 퍼즐, 대국 간 약점 통계, 봇 연습, 한국어 설명까지 이미 존재.

### 3.2 차별점

조사 범위에서 아래 조합을 모두 가진 서비스는 확인하지 못함.

| 차별점 | 기존 서비스와의 차이 |
|---|---|
| ① 모든 약점에 근거 대국·수순·해설 연결 | Insights는 놓친 전술과 오프닝만 대국 목록으로 연결 [G49]. 전략·종반을 포함한 모든 태그에 연결하고 후속 질문까지 이어 감 |
| ② 기간 비교에 표본 신뢰도 판정 | Insights도 직전 기간 비교는 제공하나 표본이 결론을 내리기에 충분한지 판정하지 않음 |
| ③ 서버 측 출력 검증 후 재생성 | 공개 사례는 화면 표시 단계에서만 거르거나(loocookie) 오프라인 평가만 함(Take Take Take) |
| ④ 레이팅을 반영한 약점 정의 | Take Take Take는 Maia를 수 설명에만 사용, 대국 간 집계에 썼다는 언급 없음 |
| ⑤ 같은 구조로 다른 게임 확장 | 조사한 체스 서비스는 모두 체스 전용(12장) |

- 한국어 설명은 차별점이 아니라 국내 시장의 기본 요건
- **검증할 가설:** 반복 약점에서 연습 시작 포지션을 자동으로 고르고, 연습 성공률을 실전 재발률과 표본 신뢰도 기준으로 비교하는 조합은 확인되지 않음 `[확인 필요]`. 사용자 테스트 전까지 차별점에 넣지 않음

---

## 4. 기술 아키텍처

### 4.1 구성 요소

| 계층 | 기술 후보 | 역할 |
|---|---|---|
| 프론트엔드 | React, TypeScript | 체스판, 분석 결과, 대화 UI, 차트·리포트 |
| 백엔드 API | Spring Boot | 인증, 사용자·대국 관리, 분석 요청, 리포트 API |
| 데이터 처리 | Python, python-chess | PGN 파싱, FEN 변환, 수순 검증 |
| 엔진 | Stockfish | 평가, 최선 수, 후보 수·변형 |
| 분석 계층 | Python 분석 모듈 | 실수 분류, 패턴 집계, 기간별 통계 |
| LLM 계층 | LLM API, tool calling | 검증된 근거의 자연어 설명, 질의, 리포트 작성 |
| 데이터베이스 | PostgreSQL | 사용자, 대국, 분석 결과, 리포트 |
| 메시지 브로커 | RabbitMQ | 장시간 분석 작업의 비동기 처리 |
| 배포 | Docker, 추후 Kubernetes | 실행 환경 표준화, 확장 |

초기에는 모듈을 논리적으로만 분리하고 독립 마이크로서비스 배포는 하지 않음.

### 4.2 처리 흐름

**분석 흐름 (비동기):** 업로드 → API가 검증·저장 후 큐에 등록 → 워커가 Stockfish 분석 → 분석 계층이 근거 구조화 → LLM 해설 생성 → 저장, 프론트는 진행 상태 조회(폴링 또는 SSE) → 결과가 쌓이면 반복 패턴·기간 변화 집계 → 리포트 생성과 질의.

**연습 흐름 (동기):** 모드 선택(약점 극복하기는 약점 태그에서 시작 포지션 선택) → 연습 세션 생성 → 사용자 수를 짧은 분석 시간·평가 캐시로 즉시 평가·해설 → 봇 응수 → 종료 시 Game으로 저장해 분석 큐로 정밀 분석. 응답 시간 목표 `[측정 예정]`.

### 4.3 게임 어댑터 계층

다른 게임 추가 시 분석·LLM·리포트 계층을 다시 만들지 않도록 게임마다 다른 부분만 어댑터로 분리. MVP는 체스 어댑터만 구현하되 인터페이스는 이 형태로 둠.

| 구성 | 체스 | 바둑 | 장기·샹치 | 쇼기 |
|---|---|---|---|---|
| 기록 파서 | PGN (python-chess) | SGF | GIB, 샹치 PGN 변형 (pyffish) | KIF·CSA·USI |
| 규칙 엔진 | python-chess | 바둑 규칙(룰·덤) | Fairy-Stockfish (pyffish) | Fairy-Stockfish, YaneuraOu |
| 엔진 프로토콜 | UCI (Stockfish) | GTP, KataGo JSON 분석 | UCI/UCCI (Fairy-Stockfish, Pikafish) | USI (YaneuraOu) |
| 평가 정규화 | 센티폰 → 승률 | 승률 + 집 차이 | 센티폰 → 승률 | 평가값 → 승률 |
| 패턴 태그 사전 | 전술 모티프, 국면 | 사활·행마·끝내기 | `[정의 필요]` | `[정의 필요]` |

- 공통 평가 단위: "그 수로 잃은 승률". 확률 게임(백개먼·마작)은 기대값(에퀴티) 손실
- 게임별로 새로 만들 것: 패턴 태그 사전, 실수 기준표, LLM 용어집(확장 비용의 대부분)
- 그대로 재사용: 작업 큐, 결과 저장, 기간 비교, 리포트, 근거 검증, 질의

### 4.4 LLM 근거 연결

loocookie/ChessGPT, Take Take Take, CCC, thinkfish의 설계·실패 사례를 반영 [G28][G29][G31][G47].

| 단계 | 설계 |
|---|---|
| ① 근거 만들기 | 최선 라인과 실제 수 라인을 같은 수 차례에서 비교. 그 수로 가장 크게 변한 특징만 전달. 포크·핀은 노린 기물이 실제로 잡혀야 근거로 인정. 수 전후 포지션과 공격 관계 목록 함께 전달. 오프닝 이론 수는 "이론"이라고만 설명 |
| ② LLM 입력 정리 | 센티폰 등 인용하면 안 되는 값은 데이터에서 제거하고 단어로 대체. 질문을 닫힌 유형(최선 수, 형세, 내 수의 문제, 대신 둘 수, 수순 검증, 반복 약점, 기간 비교)으로 분류해 유형마다 다른 증거 전달. 질문에 없는 정보는 보내지 않음 |
| ③ 설명 거부 | 평가 차이가 기준 미만이면 "사실상 같은 수"로 답하고 이유를 만들지 않음 `[측정 예정]`. 근거가 평가 차이의 절반 미만만 설명하면 원인을 말하지 않음. 표본이 부족하면 결론 보류 |
| ④ 서버 측 출력 검증 | 언급한 수의 합법성, 증거(엔진 변형·후보 수) 포함 여부, 숫자 혼입, 증거에 없는 오프닝 이름을 검사. 실패 시 재생성(최대 N회), 그래도 실패하면 템플릿 설명. 수는 번호 붙은 표기(`7...Qd5`)로 쓰게 해 기계 검증 |
| ⑤ 평가·개선 | 실제 대국에서 뽑은 시나리오 평가셋(전술, 블런더, 동등한 수, 환각 유도)을 LLM 심판이 "주어진 사실만 썼는가"로 채점. 사용자 신고를 검출기·프롬프트 개선 과제로 등록 후 사람 검토 |

### 4.5 모델 선정과 실험적 파인튜닝

| 역할 | 모델 |
|---|---|
| 평가·최선 수·변형 | Stockfish |
| 레이팅별 사람의 수 확률 | Maia-2 (MIT, CPU 실행 가능. 기대 점수는 보정된 승률이 아니라 승률로 쓰지 않음) [G30] |
| 연습 봇 | Maia-2 기본, Stockfish 강도 제한 [G70] |
| 전술·구조 패턴 | 규칙 기반 검출기(python-chess) |
| 설명 | 상용 LLM API |

| LLM 후보 | 가격(100만 토큰당 입력/출력) |
|---|---|
| Claude Haiku 5.5 | $0.10 / $0.50 [G60] |
| Claude Sonnet 5.5 | $2 / $10 [G60] |
| Gemini 3 Flash | $0.50 / $3.00 (제3자 집계, 공식 확인 필요) [G61] |

- 선정 기준: 시나리오 평가셋 통과율, 출력 검증 실패율, 한국어 품질, 응답 3초 이내, 대국당 비용
- 실험적 파인튜닝: Kanana 1.5(2.1B·8B, Apache-2.0)·Qwen3-8B(Apache-2.0)를 출력 검증을 통과한 "근거 → 한국어 해설" 쌍으로 LoRA 학습 [G62][G63]. 목적은 비용·지연 절감과 용어 일관성. MVP 완성 후 진행하고, 기준 미달이면 상용 LLM 유지. 상용 LLM 출력을 학습에 쓰면 제공사 약관 확인

---

## 5. 데이터 모델 초안

| 엔터티 | 주요 필드 | 목적 |
|---|---|---|
| User | id, email, preferences | 사용자·설정 |
| Game | id, user_id, game_type, record_format, ruleset, record_raw, source(upload·api·practice), played_at, result, time_control | 기록 원본·메타데이터. 게임 종류·형식 구분 |
| PositionAnalysis | id, game_id, ply, position, played_move, best_move, eval_unit, win_prob_before, win_prob_after | 수별 분석, 공통 평가 단위 |
| Variation | id, position_analysis_id, rank, moves, evaluation | 후보 수·변형 |
| MistakeTag | id, position_analysis_id, category, confidence, tag_dictionary_version | 실수 유형, 게임별 태그 사전 버전 |
| GameReport / PeriodReport | game_id 또는 user_id·기간, summary·findings | 대국별·기간별 리포트 |
| TrainingRecommendation | id, user_id, category, rationale | 훈련 권장 |
| AnalysisJob | id, game_id, status, engine_name, engine_version, network_id, engine_license, error | 작업 상태, 재현성, 라이선스 추적 |
| PracticeSession | id, user_id, mode, start_position, source_ref, weakness_tag, bot_engine, bot_strength, status, success | 연습 세션 |
| PracticeMove | id, session_id, ply, move, win_prob_loss, grade, explanation, retried | 연습 중 즉시 평가 |

스키마는 MVP의 조회 패턴과 분석 비용을 확인한 뒤 구체화. 엔진 설정·분석 버전을 함께 보존해 재현성 확보.

---

## 6. 데이터 수집 및 정책

| 경로 | 요청 규칙 | 이용 조건 |
|---|---|---|
| 사용자 PGN 업로드 | — | 기본 경로. 외부 API에 의존하지 않음 |
| Lichess API | 요청 하나씩, 429 응답 시 1분 대기 [G59] | 데이터베이스는 CC0 [G1] |
| Chess.com Published Data API | 직렬 요청 제한 없음, 병렬은 429 가능 [G58] | "자사 기능·IP 복제 금지" 조건 → 상업 연동 전 약관 검토 |

**Lichess 공개 데이터 (CC0, 2026-10 확인) [G1]**

| 데이터 | 규모 | 용도 |
|---|---|---|
| 포지션 평가 | 약 4.16억 | 평가 캐시로 분석 비용·지연 감소 |
| 대국 | 월별 PGN | 레이팅대별 실수율·오프닝 기준선 |
| 퍼즐 | 약 616만, 테마 태그 | 약점 태그와 같은 테마 퍼즐 추천 |

- 수집 목표 `[가설]`: 레이팅 구간별 균등 표본(구간당 예: 1만 판), 시나리오 평가셋(예: 100개 이상), 인터뷰 참가자 최근 대국(예: 1인당 30판 이상)
- 전처리: 파싱·합법 수 검증 → 중복 제거 → 메타데이터 정규화 → 짧은 대국 제외 → 캐시 미적중 포지션만 분석 → 엔진·캐시 버전과 함께 저장
- 라벨링: 숙련 플레이어가 해설을 정답·오답·모호로 분류 [G37], LLM 심판과의 일치도 측정
- 개인정보: 계정 연동은 명시적 동의 후 필요한 범위만 수집, 삭제 요청 시 원본·분석 결과 삭제

---

## 7. 시장성 및 수익 모델

### 7.1 시장 조사: Chess.com 이용자와 유료·분석 이용 비율 (2026-10-22 확인)

| 지표 | 수치 | 출처 |
|---|---|---|
| 누적 가입 회원 | 2.52억+(2026-03-31), 2.69억(2026-07) | [G48] |
| 월간 활성 이용자(MAU) | 약 3,800만 | [G77] |
| 일평균 활성 이용자(DAU) | 970만(2026 Q1, 전년 대비 +17.7%), 신규 가입 1,490만(+23.8%) | [G48] |
| 유료 구독자 | 약 200만(3개 유료 등급 합계) | [G77] |
| 최상위 등급 Diamond 연간 구독(연 $119) | 유료 구독자의 절반 이상 | [G77] |
| 매출 구성 | 약 $1.5억 중 구독 88%, 광고 약 10%, 후원 2% | [G77] |
| 새 코치 기능 이용자 | 약 100만 명 | [G48] |
| Chessable(강의) 활성 이용자 | 63만(전년 대비 +132%) | [G48] |
| Game Review·Insights 이용 횟수 | 공개 안 됨(무료는 하루 1회 리뷰) | [G48][G56] |
| Aimchess·DecodeChess 이용자 수 | 공개 안 됨. DecodeChess 웹 방문 월 약 20만(2025-05) | [G81] |
| 엔진 복기 습관 설문 | 확인 안 됨 | — |

**계산한 비율** (출처·시점이 달라 근사치)

| 비율 | 값 | 의미 |
|---|---|---|
| 유료 / MAU | 약 5.3% | 활성 이용자 중 돈을 내는 비율 |
| 유료 / 누적 가입 | 약 0.8% | 가입자 기준 전환율 |
| DAU / MAU | 약 26% | 월간 이용자의 매일 접속 비율 |
| Diamond 연간 / MAU | 약 2.6% 이상 | 코치 설명·Insights 등 분석 기능 전체를 쓰는 유료층 |
| 새 코치 기능 / MAU | 약 2.6% | 코칭 기능 이용층 |
| Chessable 활성 / MAU | 약 1.7% | 유료 강의 학습층 |

**국내 시장**

- Chess.com의 국가별 이용자 수는 공개 안 됨. 트래픽 상위 5개국(미국 약 18%, 인도, 독일, 프랑스, 브라질)에 한국 없음 [G78]
- 한국 스포츠 분야 사이트 중 Chess.com 6위(2024-03, 월 약 39.8만 방문) [G79]
- 국내 FIDE 활성 선수 약 700명 [G80], 유소년선수권 참가 220여 명 [G64]. 체스 인구 공식 통계는 없음

**시사점**

- 활성 이용자의 약 5%가 유료이고 그 절반 이상이 분석 기능 전체가 포함된 최상위 등급 → "깊은 분석에 돈을 내는 층"이 유료 시장의 핵심
- 분석·학습 기능을 적극 쓰는 층은 MAU의 약 2~3%로 추정 → 본 서비스의 직접 대상 규모 추정 근거
- 국내만으로는 시장이 작을 가능성. 국내 수요는 7.4 인터뷰로 검증하고, 해외(영어) 이용자 포함 여부를 함께 검토
- 경쟁 서비스의 존재는 유료 시장이 있다는 신호일 뿐 신규 서비스의 수요를 입증하지 않음

### 7.2 수익 모델과 경쟁 가격

- B2C 프리미엄: 무료는 월 분석 수 제한, 유료는 장기 분석·질의·상세 리포트
- B2B 코치용: 학생별 약점·추이, 리포트 내보내기, 대시보드
- 유료 전환율 목표는 Chess.com의 유료/MAU 약 5%를 상한 참고치로 둠

| 서비스 | 무료 | 유료 |
|---|---|---|
| Chess.com | Game Review 하루 1회 | 상위 등급에서 무제한 리뷰·코치 설명·Insights [G56], 가격 `[확인 필요]` |
| Lichess | 전 기능 | 없음(후원) [G50] |
| DecodeChess | 하루 1판 | 월 $8.25 / 연 $84 [G57] |
| Aimchess | 월 1회 40판 리포트 | 월 $7.99 / 연 $57.99 [G65] |

### 7.3 단위 비용 `[가설]`

해설 1회 입력 3,000·출력 300 토큰, 대국당 10회 가정.

| LLM | 대국당 비용 |
|---|---|
| Claude Haiku 5.5 | 약 $0.0045 |
| Gemini 3 Flash | 약 $0.024 |
| Claude Sonnet 5.5 | 약 $0.09 |

소형 모델 기준 LLM 비용은 월 구독료 대비 작음. 불확실성은 재생성 비율, Stockfish 서버 비용, 캐시 적중률에 있어 MVP에서 측정. 가격은 해외 유료 요금(월 $7.99~8.25)을 참고하되 지불 의사 조사로 결정.

### 7.4 초기 검증 계획

초·중급 사용자 10~15명 인터뷰 → 본인 기보로 프로토타입 제공 → 이해도·신뢰도·유용성 평가 → 재사용 의향·지불 의사 조사.

---

## 8. MVP 범위

- **포함:** PGN 업로드·파싱, Stockfish 분석, 실수·핵심 국면 탐지, 추천 수 비교, 근거 기반 해설, 대국별 요약, 반복 약점 기초 통계, 기간별 비교 리포트, 리포트 기본 질의, 연습 대국(처음부터 하기, 약점 극복하기)
- **제외:** 실시간 대국 중 코칭(공정성·플랫폼 정책 문제), 자체 엔진 개발, 멀티에이전트, 완전한 마이크로서비스 분리, 소셜·랭킹, 모든 외부 플랫폼 연동
- 게임은 체스 하나. 단 어댑터 인터페이스(4.3)와 확장 필드(5장)는 MVP부터 적용해 바둑 추가 시 재작업 방지

---

## 9. 개발 일정 (약 11주)

| 기간 | 작업 | 산출물 |
|---|---|---|
| 1~2주 | 요구사항 확정, PGN 파싱, 체스판 UI, Stockfish 연동 | 기보 업로드·기본 분석 |
| 3~4주 | 실수 탐지, 평가 변화, 후보 수·변형 저장 | 대국별 분석 결과 |
| 5~6주 | 근거 구조 설계, LLM 해설, 수순 검증 | 근거 기반 해설 |
| 7~8주 | 대국별 리포트, 통계 집계, 반복 약점 | 개인별 분석 리포트 |
| 9주 | 기간별 비교, 후속 질문 | 통합 분석 흐름 |
| 10주 | 봇 착수, 연습 중 평가·물리기, 약점 포지션 시작 | 연습 대국 |
| 11주 | 품질 평가, 비용 측정, 사용자 테스트 | MVP 시연·평가 결과 |

엔진 분석과 근거 검증을 먼저 완성하고 LLM을 연결하는 순서로 리스크를 줄임. 연습 대국은 해설·반복 약점 기능을 재사용하므로 마지막에 둠.

---

## 10. 품질 평가 및 KPI

- **기술 품질:** PGN 분석 성공률, 수순 합법성, 근거 일치율, 숙련자 판정 설명 정확도, 반복 약점 탐지 정확도, 대국당 분석 지연·비용, 연습 피드백 응답 시간
- **사용자·사업:** 분석 열람률, 리포트 재방문율, 후속 질문 사용률, 훈련 추천 완료율, 연습 시작·완료율, 약점 극복 성공률과 실전 재발률 변화, 유료 전환율(참고: Chess.com 유료/MAU 약 5%, 7.1), 유료 고객당 기여이익
- 목표 수치는 고정하지 않고 베이스라인 측정 후 사용자 테스트를 거쳐 설정

---

## 11. 주요 리스크와 대응

| 리스크 | 대응 |
|---|---|
| LLM의 잘못된 체스 설명 | 엔진 근거 기반 생성, 서버 측 출력 검증, 설명 거부 기준(4.4) |
| 평가 차이의 원인 과잉 단정 | 근거가 충분할 때만 원인 제시 |
| 표본 부족으로 약점·추세 오판 | 표본 신뢰도 표시, 기준 미만이면 결론 보류 |
| 분석 비용·지연 | 비동기 큐, 평가 캐시, 분석 깊이 조절 |
| 외부 API 정책 변경 | PGN 업로드를 기본 경로로 유지. Chess.com은 "기능·IP 복제 금지" 조건 검토 후 연동 [G58] |
| 경쟁 서비스와 기능 중복 | 차별점을 3.2로 좁히고 근거 연결·변화 판정의 체감 가치를 우선 검증 |
| 파인튜닝 데이터 약관 | 학습 전 제공사 약관 확인, 숙련자 작성 해설 비중 확보 |
| 연습 결과가 실전 통계 왜곡 | 연습 대국은 실전 집계에서 제외, 별도 표시 |
| 연습 기능의 실시간 보조 악용 | 시작 포지션을 초기·종료된 내 대국·공개 데이터로 한정 |
| 엔진·네트워크 라이선스 | 엔진은 서버에서만 실행, 라이선스를 AnalysisJob에 기록, 상업 조건 미확인 네트워크(KataGo 외부 기여, Pikafish 가중치)는 사용 보류 |
| 게임마다 다른 "실수"의 의미 | 게임별 기준표·태그 사전을 숙련자 검수 후 적용 |
| 확장으로 초점 분산 | 체스에서 재방문율·지불 의사 확인 후 확장 |
| 게임 지식재산권 | 부루마블·카탄 등 상표·디자인은 사용하지 않음(12.3) |
| 플랫폼의 공식 AI 분석 탑재 | 엔진 리뷰가 아닌 근거 연결·변화 판정·출력 검증에 집중, 플랫폼 독립적인 업로드 경로 유지 |

---

## 12. 다른 게임으로의 확장

> 2026-10-21~22 웹 조사 기준. 엔진 강도는 대부분 프로젝트 자체 주장이며 독립 검증 수치는 확인하지 못함.

### 12.1 판단 기준

| 기준 | 질문 | 없을 때 |
|---|---|---|
| ① 오픈 엔진 (필수) | 사람보다 강하고, 결정마다 평가·후보·변형을 내며, 상업 이용 가능한 엔진이 있는가 | "최선 대비 손실"을 못 구해 실수 판정·근거 검증 불가. **확장 불가** |
| ② 공개 데이터 (보조) | 사람 기록을 공개 라이선스로 얻거나 사용자가 기록을 내보낼 수 있는가 | 본인 기록 분석은 가능. 같은 레이팅대 비교, 수준별 기준, 사람형 대안, 퍼즐은 약해지거나 늦어짐 → 출시 범위·일정을 정하는 조건 |

보조 기준: 라이선스, 한국 수요, 기록 형식·규칙 엔진(어댑터 가능 여부), 실시간 보조 금지 등 플랫폼 정책.

### 12.2 고전 보드게임

| 게임 | 엔진 | 데이터 | 라이선스 | 한국 수요 | 판정 |
|---|---|---|---|---|---|
| **바둑** | KataGo: 공개 엔진 최상위권, 승률·집 차이 출력 [G2][G3] | 자가 대국 7천만 판 이상 공개. 인간 공개 기보 `[확인 필요]`. SGF 내보내기 쉬움 | 코드 MIT. 공식 kata1·g170 네트워크 상업 이용 가능, 외부 기여 네트워크는 확인 필요 [G3][G4] | 높음. 단 국내 앱이 이미 KataGo 분석을 무료 탑재 [G5][G36] | **1순위.** LLM 설명 제품 없음 → 한국어 설명 + 반복 약점으로 차별화. 바둑 특화 LLM도 설명 정답률 55.6%라 개념 검출기 선행 필요 [G37] |
| **장기** | Fairy-Stockfish 장기 NNUE [G6] | 공개 기보 데이터셋 없음 [G7] | GPL-3(서버 실행 시 공개 의무 없음) | 한국 고유. AI 수별 분석 서비스 없음 [G38] | **2순위(조건부).** 본인 대국 분석으로 시작. 경쟁 공백이 약한 수요의 신호일 수 있어 인터뷰가 진입 조건 |
| 체스 변형 | Fairy-Stockfish, Stockfish [G6] | Lichess CC0 [G1] | GPL-3 / CC0 | 낮음 | 2순위. 체스 어댑터 재사용 |
| 샹치 | Pikafish [G8] | 연구용 14만~18만 판 [G9] | 코드 GPL-3, 가중치 라이선스 명시 없음 [G8] | 낮음 | 해외 확장 시 |
| 쇼기 | YaneuraOu [G10] | 이용 조건 미확인 | GPL-3 | 낮음 | 해외 확장 시 |
| 백개먼 | GNU Backgammon [G11] | 없음 | GPL-3 | 낮음 | 기술 검증용(기대값 손실 설명) |
| 리치 마작 | Mortal [G12] | 이용 조건 미확인 | AGPL-3(네트워크 서비스도 공개 의무) | 낮음 | 기술 검증용 |

샹치·쇼기·마작은 플랫폼이 공식 AI 분석을 직접 탑재하는 흐름이 뚜렷해 서드파티 여지가 작음(12.7).

### 12.3 현대 보드게임 (부루마블, 뱅!, 카탄)

| 항목 | 부루마블 | 뱅! | **카탄** |
|---|---|---|---|
| 게임 특성 | 주사위 + 다인원 + 거래·건설 | 다인원 + 숨겨진 역할 + 속임·협상 | 3~4인 + 주사위 + 자원 거래·건설 |
| 엔진 | 없음. 모노폴리 강화학습 연구는 고정 정책 상대 승률만 보고 [G13] | 없음. 비슷한 정체 숨김 게임은 LLM이 규칙 봇보다 약함 [G14] | **있으나 사람 기준 강도 미검증.** catanatron: 시뮬레이터 + 알파베타 탐색·수작업 가치 함수 봇, 최강 봇이 다른 봇에 1대1 약 80% 승(25판) [G71]. JSettlers2: 사람과 대전 가능한 봇 내장 [G72]. 2024 연구에서 "프로를 이기는 알고리즘은 아직 없음" [G73] |
| 데이터 | 없음 | 없음 | 공개 데이터셋 없음. 최대 온라인 플랫폼 Colonist는 공식 기록 내보내기 없음(요청만 접수, 제3자 확장 프로그램으로 저장) [G74] |
| 라이선스 | — | — | catanatron·JSettlers2 모두 GPL-3(서버 실행 가능) [G71][G72] |
| 지식재산권 | 순회형 게임 규칙은 창작성 인정 어려움, 명칭·디자인은 확인 필요 [G16] | 명칭·디자인 권리자 확인 필요 | "CATAN" 상표는 Catan GmbH 소유 [G75]. 일반 명칭으로만 사용 |
| 한국 수요 | — | — | 코리아보드게임즈가 유통 중, 확장판 품절 사례 [G76]. 판매 통계 없음 |
| 판정 | **확장 대상 아님** | **확장 대상 아님** | **연구·시연 과제(정식 확장 기준 미달)** |

**카탄 상세**

- **평가 가능한 결정:** 초기 정착지 배치, 건설 순서, 은행·항구 교환처럼 혼자 내리는 결정은 봇 가치 함수로 "선택별 가치 손실"을 계산할 수 있음. 초기 배치는 연구가 가장 많이 진행된 영역 [G73]
- **평가 불가능한 결정:** 플레이어 간 거래·협상은 상대 성향에 따라 최선이 달라 손실을 정의할 수 없음. 다인원·주사위라 판 결과로 결정의 질을 판단하기도 어려움
- **기준 ① 미충족:** 엔진이 사람보다 강하다는 근거가 없어 판정을 "봇 기준 참고값"으로만 표시해야 함. 체스·바둑처럼 "엔진이 판정한다"는 원칙(2.1)을 그대로 적용할 수 없음
- **기록 확보:** 사용자가 기록을 내보낼 표준 경로가 없음 → 서비스 안에서 봇과 둔 대국만 분석하거나 Colonist의 공식 내보내기를 기다려야 함
- **장점:** 오픈 시뮬레이터·봇·연구 생태계가 있어 부루마블·뱅!보다 구현 기반이 좋고, 국내 인지도가 높음. Python 패키지로 설치돼 어댑터 시험이 쉬움(Python 3.12 호환 `[확인 필요]`)
- **정식 확장 조건:** 사람 상대 강도가 검증된 엔진 확보, 기록 수집 경로 확보, 상표를 쓰지 않는 명칭·디자인

엔진이 없는 부루마블·뱅!은 규칙 기반 확률 계산(칸별 도착 확률 등) 정도의 전략 콘텐츠만 가능해 핵심 구조를 재사용하지 못함. 범용 연구 도구(TAG, OpenSpiel, Ludii)로 평가 엔진을 직접 만드는 것은 별도 프로젝트 규모 [G15].

### 12.4 온라인 게임 (스타크래프트, LoL, Dota 2)

| 항목 | 스타크래프트 II·브루드 워 | LoL·Dota 2 |
|---|---|---|
| 엔진 | 사람 플레이 평가 엔진 없음. 공개 도구는 봇 대전용 [G17][G18][G19] | 없음 |
| 데이터 | SC2 리플레이 팩(AI·ML 라이선스 동의 필요), sc2reader로 파싱 가능 [G17][G18] | Riot API, OpenDota API [G20][G21] |
| 경쟁 | Starcraft2.ai가 리플레이 → LLM 총평을 이미 무료 제공 [G43] | Mobalytics, OP.GG AI(실시간 음성 코치), STRATZ [G44][G45][G46] |
| 정책 | 진행 중 경기 보조 불가 [G19] | Riot은 게임 중 판단을 대신하는 앱 금지 [G20] |
| 판정 | **별도 제품 검토.** 엔진 대신 상위 플레이어와의 벤치마크 비교라 분석 계층이 다름 | **비추천.** 엔진 없음, 대형 경쟁, 정책 제약 |

### 12.5 공통 정책: 종료된 기록만 분석

Chess.com은 대국 중 엔진·확장 프로그램 사용을 금지하고 [G22], Riot도 게임 중 판단을 대신하는 앱을 금지 [G20]. 모든 게임에서 종료된 기록·리플레이만 분석하고, 진행 중 화면 인식·메모리 읽기·오버레이는 만들지 않음.

### 12.6 확장 로드맵 `[가설]`

| 단계 | 게임 | 진입 조건 |
|---|---|---|
| 1 (MVP) | 체스 | — |
| 2 | 바둑 | 체스에서 재방문율·지불 의사 확인, 사활·행마 태그 사전 숙련자 검수, 개념 검출기 구축 후 설명 정확도 기준 충족 `[측정 예정]` |
| 3 | 장기, 체스 변형 | 장기 사용자 인터뷰로 수요 확인, 기보 파서 구현 |
| 4 (해외) | 샹치, 쇼기 | 해외 진출 결정, 엔진·가중치 상업 조건 확인 |
| 연구 | 백개먼, 마작 | 기대값 손실 설명 실험. 라이선스 검토 후 내부 실험만 |
| 연구·시연 | **카탄** | 혼자 내리는 결정(초기 배치·건설·교환)만 봇 기준 참고값으로 시연. 정식 확장은 12.3의 세 조건 충족 시 |
| 별도 제품 | 스타크래프트 | 리플레이 상업 이용 조건 확인, Starcraft2.ai 대비 차별점 검증 |
| 제외 | 부루마블, 뱅!, LoL, Dota 2 | 범용 평가 엔진 공개 시 재검토 |

확장 단계별 검증 지표: 게임 추가 시 신규 코드 비율, 게임별 근거 일치율, 태그 사전 숙련자 일치도, 게임별 재방문율, 게임당 엔진 비용.

### 12.7 게임별 기존 분석 서비스 (2026-10)

| 게임 | 대표 서비스 | LLM 설명 | 대국 간 추적·훈련 |
|---|---|---|---|
| 바둑 | AI Sensei(KataGo 실수 표시) [G34], KaTrain(손실·응징 표시) [G35], 타이젬 등(6단계 등급) [G36] | 없음 | 실수 퀴즈·복습 일정, 물리고 다시 두기 |
| 장기 | 타이젬·한게임·카카오 장기 [G38] | 없음 | AI 수별 분석 없음 |
| 쇼기 | 棋神アナリティクス(월 1.1만 엔) [G39] | 棋神チャット: 중계 해설용 | 확인 안 됨 |
| 샹치 | 天天象棋 [G40] | 확인 안 됨 | 대국 품질 보고서, 유료 분석 카드 |
| 백개먼 | eXtreme Gammon(PR 지표), Backgammon Galaxy [G41] | 대화형 AI 튜터 | 확인 안 됨 |
| 마작 | NAGA, mjai-reviewer, 작혼 MAKA [G42] | 없음 | — |
| 카탄 | 분석 코치 제품 없음. Colonist 결과·통계 수집 확장 프로그램만 존재 [G74] | 없음 | 확인 안 됨 |
| 스타크래프트 | Starcraft2.ai [G43], sc2replaystats [G18] | Claude 총평 | 확인 안 됨 |
| LoL·Dota 2 | Mobalytics, OP.GG AI, STRATZ [G44][G45][G46] | 실시간 음성 코치 | 약 10판 단위 추세 |

- 엔진 복기는 플랫폼이 직접 탑재하는 기본 기능이 되어 엔진 리뷰만으로는 서드파티 여지가 작음
- LLM 설명은 중계 해설·대화형 튜터·리플레이 총평으로 갈림. **개인 기록을 모아 반복 약점을 근거와 함께 설명하는 형태는 어느 게임에서도 확인하지 못함** → 3.2 차별점이 다른 게임에서도 유효
- 엔진이 없는 게임의 AI 리뷰는 통계만 읽어 흐름이 넘어간 순간과 원인을 놓친다는 평가가 있음 [G45]

---

## 13. 최종 제안

- **핵심:** 엔진 최선 수 안내가 아니라, 검증 가능한 근거로 설명하고 여러 대국의 반복 약점을 찾아 개선 여부를 추적하는 학습 흐름
- **기술:** Stockfish 분석, Python 데이터 처리, Spring Boot API, 비동기 큐, PostgreSQL, LLM 설명. 엔진 판정과 생성형 AI 설명을 분리해 신뢰도를 평가할 수 있음
- **사업:** 기능 중복을 인정하고 차별점을 근거 연결, 표본 신뢰도 판정, 출력 검증, 레이팅 반영 약점으로 좁힘(3.2). MVP는 분석·해설·반복 약점·기간 리포트·연습 대국에 집중하고 사용자 테스트로 우선순위 결정
- **확장:** 강한 오픈 엔진이 있는 게임만 같은 구조로 옮길 수 있음. 바둑 → 장기·체스 변형 순. 카탄은 엔진·기록 경로·상표 조건이 미충족이라 연구·시연 과제로 둠. 스타크래프트는 별도 제품, 부루마블·뱅!·LoL은 제외

---

## 14. 참고 자료

기능·라이선스·약관은 바뀔 수 있으므로 도입 전 공식 페이지에서 다시 확인.

- [G1] Lichess 공개 데이터베이스(CC0, 대국·퍼즐·포지션 평가): https://database.lichess.org/
- [G2] KataGo 분산 학습(kata1, 네트워크·자가 대국, 아카이브): https://katagotraining.org/ , https://katagoarchive.org/
- [G3] KataGo 저장소(GTP·JSON 분석 엔진, MIT 라이선스): https://github.com/lightvector/KataGo , https://raw.githubusercontent.com/lightvector/KataGo/master/LICENSE
- [G4] KataGo 네트워크 라이선스: https://katagotraining.org/network_license/
- [G5] 국내 KataGo 탑재 앱: 대한바둑협회 기보뷰어 https://apps.apple.com/kr/app/%EB%8C%80%ED%95%9C%EB%B0%94%EB%91%91%ED%98%91%ED%9A%8C-%EA%B8%B0%EB%B3%B4%EB%B7%B0%EC%96%B4/id6446690204 , AI 카타고 바둑 https://apps.apple.com/kr/app/ai-%EC%B9%B4%ED%83%80%EA%B3%A0-%EB%B0%94%EB%91%91/id1560986333
- [G6] Fairy-Stockfish(장기·샹치·쇼기 NNUE): https://github.com/fairy-stockfish/Fairy-Stockfish , https://github.com/fairy-stockfish/Fairy-Stockfish/wiki/NNUE , https://pypi.org/project/fairyfishnet
- [G7] 장기 기보(GIB) 관련 사용자 언급: https://mwm.ai/apps/janggidosa/489271306
- [G8] Pikafish(코드 GPL-3, 학습 데이터 ODbL, 가중치 라이선스 명시 없음 — 2026-10-22 재확인): https://github.com/official-pikafish/Pikafish , https://github.com/official-pikafish/Pikafish/wiki
- [G9] 샹치 기보 데이터셋 연구: https://arxiv.org/pdf/2506.15880 , https://arxiv.org/pdf/2507.12215
- [G10] YaneuraOu(GPL-3, Lishogi 분석): https://en.wikipedia.org/wiki/YaneuraOu , https://chessprogramming.org/YaneuraOu
- [G11] GNU Backgammon: https://www.slackbuilds.org/repository/13.0/games/gnubg/ , https://madb.mageia.org/package/show/name/gnubg
- [G12] Mortal(AGPL-3)·mjai-reviewer: https://github.com/Equim-chan/mjai-reviewer , https://huggingface.co/haor/Mortal-S42
- [G13] Decision Making in Monopoly using a Hybrid Deep Reinforcement Learning Approach: https://arxiv.org/pdf/2103.00683
- [G14] AvalonBench: https://ar5iv.labs.arxiv.org/html/2310.05036 , 늑대인간 강화학습 에이전트: https://arxiv.org/pdf/2310.18940
- [G15] TAG 프레임워크: https://github.com/GAIGResearch/TabletopGames , https://arxiv.org/pdf/2009.12065 , OpenSpiel: https://arxiv.org/pdf/1908.09453v5
- [G16] 부루마불·모두의 마블 저작권 소송(대법원 확정): https://news.mtn.co.kr/news-detail/2018091913574246160 , https://www.etoday.co.kr/news/view/1618440
- [G17] StarCraft II API·리플레이 팩: https://news.blizzard.com/en-gb/article/20944009/iiapi , https://github.com/inspirai/s2client-proto , SC2ReSet: https://zenodo.org/records/14963356
- [G18] sc2reader(MIT): https://sc2reader.readthedocs.io/ , Spawning Tool: https://pypi.org/project/spawningtool/ , python-sc2(MIT): https://awesome.ecosyste.ms/projects/github.com%2FBurnySc2%2Fpython-sc2 , 리플레이 리뷰 도구 소개: https://guildorder.com/th/games/sc2/guides/replay-review-workflow
- [G19] StarCraft AI 대회(BWAPI)와 리플레이 데이터: https://www.cs.mun.ca/~dchurchill/starcraftaicomp/report2015.shtml , https://cilab.gist.ac.kr/sc_competition2019/ , https://ar5iv.arxiv.org/html/1712.10179
- [G20] Riot 서드파티 앱 정책: https://support.riotgames.com/hc/en-us/articles/225266848
- [G21] OpenDota FAQ: https://blog.opendota.com/2014/08/01/faq/
- [G22] Chess.com 페어플레이 정책: https://www.chess.com/fair-play
- [G26] CORDOC-LLC/ChessCoach(GPL-3): https://github.com/CORDOC-LLC/ChessCoach
- [G27] Iamsdt/chess(Chess King): https://github.com/Iamsdt/chess , LLM-ChessCoach(MIT): https://github.com/ai-chess-training/LLM-ChessCoach
- [G28] thinkfish(MIT): https://github.com/ronaldsuwandi/thinkfish
- [G29] Concept-guided Chess Commentary(NAACL 2025): https://arxiv.org/html/2410.20811v2 , https://github.com/ml-postech/concept-guided-chess-commentary
- [G30] Maia-2(MIT): https://github.com/CSSLab/maia2 , https://arxiv.org/pdf/2409.20553
- [G31] Take Take Take, Building a Chess Coach(AI Engineer Europe 2026): https://ai.engineer/talks/building-a-chess-coach
- [G32] AI 체스 코치 앱 9종 비교(2026-10, 제3자): https://aitoolsbakery.com/blog/best-ai-chess-coach-apps/
- [G33] Chessiro 소개(2026-03): https://www.chess.com/blog/TastyWinter/we-built-an-ai-that-explains-chess-positions , Chess.com Game Review v2: https://www.chess.com/news/view/chesscom-launches-game-review-v2
- [G34] AI Sensei: https://ai-sensei.com/ , 바둑 분석 도구 가이드(2026-06): https://ai-sensei.com/news/sf4Pj/the-best-go-analysis-tools-in-2026-a-complete-guide
- [G35] KaTrain(MIT): https://pypi.org/project/katrain
- [G36] 타이젬 바둑 앱: https://apps.apple.com/kr/app/%ED%83%80%EC%9D%B4%EC%A0%AC%EB%B0%94%EB%91%91-%EC%9B%B9%EB%B2%84%EC%A0%84-%EC%8A%B9%EB%B6%80%EC%98%88%EC%B8%A1/id634756931 , 바둑 플랫폼 비교(블로그): https://dnublog.co.kr/2026/03/25/%EB%B0%94%EB%91%91%EA%B2%8C%EC%9E%84-%ED%83%80%EC%9D%B4%EC%A0%AC-%EC%82%AC%EC%9D%B4%EB%B2%84%EC%98%A4%EB%A1%9C-%EB%84%B7%EB%A7%88%EB%B8%94-%ED%95%9C%EA%B2%8C%EC%9E%84-%ED%94%BC%EB%A7%9D-%EB%B0%94/
- [G37] 바둑 LLM 설명 연구(LoGos, 설명 정답률 55.6%): https://arxiv.org/pdf/2601.16447 , https://arxiv.org/pdf/2606.21678
- [G38] 장기 플랫폼 비교(블로그): https://dnublog.co.kr/2026/03/25/%EC%9E%A5%EA%B8%B0-%EA%B2%8C%EC%9E%84-%EC%B6%94%EC%B2%9C-%EB%84%B7%EB%A7%88%EB%B8%94-%ED%83%80%EC%9D%B4%EC%A0%AC-%ED%95%9C%EA%B2%8C%EC%9E%84-%EC%97%A0%EA%B2%8C%EC%9E%84-%ED%94%BC%EB%A7%9D-%EC%B9%B4/ , 한국장기 앱: https://mwm.ai/apps/ai/6761374546
- [G39] 棋神チャット: https://pc.watch.impress.co.jp/docs/news/1422489.html , https://prtimes.jp/main/html/rd/p/000000112.000081022.html , 棋神アナリティクス: https://aismiley.co.jp/ai_news/heroz_analytics/
- [G40] 天天象棋: https://apps.apple.com/cn/app/%E5%A4%A9%E5%A4%A9%E8%B1%A1%E6%A3%8B-%E6%96%B0%E5%A2%9E%E4%BA%94%E5%AD%90%E6%A3%8B%E7%8E%A9%E6%B3%95/id403941510 , 복기 공략: https://www.toutiao.com/zixun/7546074533329979418/
- [G41] eXtreme Gammon(PR): https://en.wikipedia.org/wiki/EXtreme_Gammon , Backgammon Galaxy: https://www.backgammongalaxy.com/backgammon-galaxy-engine-analysis , https://www.backgammongalaxy.com/llms.txt
- [G42] NAGA: https://dmv.nico/en/articles/mahjong_ai_naga/ , 작혼 MAKA: https://automaton-media.com/articles/newsjp/jantama-ai-maka-20250227-329876/
- [G43] Starcraft2.ai: https://korben.info/en/starcraft2-ai-sc2-ai-coach.html , SC2 코칭 에이전트 개발기: https://tomkit08.substack.com/p/building-a-starcraft-ii-coaching
- [G44] Mobalytics GPI: https://mobalytics.gg/gpi/
- [G45] OP.GG AI: https://op.gg/ai , LoL AI 코치 한계(WeCoach): https://wecoach.gg/blog/article/what-is-a-league-of-legends-ai-coach
- [G46] STRATZ: https://stratz.com/ , https://medium.com/@STRATZ/introducing-your-dashboard-1dc33cabad3d
- [G47] loocookie/ChessGPT(라이선스 없음): https://github.com/loocookie/ChessGPT
- [G48] Chess.com 2026 Q1 Board Report: https://www.chess.com/board-reports/2026-q1 , 회원 수(2026-07): https://en.wikipedia.org/wiki/Chess.com
- [G49] Chess.com Insights 도움말: https://support.chess.com/en/articles/8708925-what-is-insights
- [G50] Lichess 기능 목록: https://lichess.org/features
- [G51] Aligning Superhuman AI with Human Behavior: Chess as a Model System(KDD 2020): https://arxiv.org/abs/2006.01855 , https://maiachess.com/blog/introducing_maia
- [G52] Chess.com 사용자 블로그, Why the Game Review is Not Very Helpful(2023-06): https://www.chess.com/blog/DSTirana1/why-the-game-review-is-not-very-helpful
- [G53] Chess.com 포럼(개별 사용자 의견): https://www.chess.com/forum/view/help-support/the-review-system-made-a-mistake , https://www.chess.com/forum/view/general/chesscoms-new-game-review-what-the-heck-happened
- [G54] Not All Practice Is Created Equal: Longitudinal Evidence From Over 40,000 Chess Players(Psychological Science, 2026): https://www.psychologicalscience.org/journals/psychological-science/09567976261452568/
- [G55] The Role of Deliberate Practice in Chess Expertise(Applied Cognitive Psychology, 2005): https://repub.eur.nl/pub/14116
- [G56] Chess.com 멤버십 등급별 기능: https://support.chess.com/en/articles/8562418
- [G57] DecodeChess 가격: https://decodechess.com/pricing/
- [G58] Chess.com Published Data API: https://support.chess.com/en/articles/9650547-published-data-api
- [G59] Lichess API 이용 팁: https://lichess.org/page/api-tips
- [G60] Anthropic API 가격: https://platform.claude.com/docs/en/about-claude/pricing
- [G61] Gemini 3 Flash 가격(제3자 집계): https://anotherwrapper.com/llm-pricing/gemini-3-flash-preview
- [G62] Kanana 1.5 공개(카카오, 2025-05, Apache-2.0): https://www.kakaocorp.com/page/detail/11654
- [G63] Qwen3-8B 모델 카드(Apache-2.0): https://huggingface.co/Qwen/Qwen3-8B
- [G64] 대한체스연맹 유소년선수권 기사(쿠키뉴스): https://www.kukinews.com/article/view/kuk202503090038
- [G65] Aimchess 가격: https://aimchess.com/
- [G66] Chess.com Play Coach 도움말: https://support.chess.com/en/articles/10877257-how-do-i-play-against-the-coach , https://www.chess.com/news/view/announcing-play-coach
- [G67] Chess.com 커스텀 포지션에서 봇과 대국: https://support.chess.com/en/articles/8572788-how-can-i-play-the-computer-from-a-custom-position
- [G68] Noctie Chess Trainer(스토어 소개 문구): https://apps.appfollow.io/ios/noctie-chess-trainer/6444289077?country=us
- [G69] Lichess "Practice with computer"(포럼 기준, 공식 문서 확인 필요): https://lichess.org/forum/general-chess-discussion/play-computer-with-instant-evaluations-and-takebacks
- [G70] Stockfish UCI 옵션(`UCI_Elo` 1320~3190, `Skill Level` 0~20): https://github.com/official-stockfish/Stockfish/wiki/UCI-&-Commands
- [G71] catanatron(GPL-3, 최종 릴리스 3.2.1·2022-07, 봇 순위표): https://github.com/bcollazo/catanatron , https://pypi.org/project/catanatron/
- [G72] JSettlers2(GPL-3, 사람·봇 대전 서버): https://github.com/jdmonin/JSettlers2 , https://www.sourceforge.net/projects/jsettlers2
- [G73] 카탄 AI 연구: 크레타공대 학위논문(2024, 초기 배치 탐색, "프로를 이기는 알고리즘 없음") https://dias.library.tuc.gr/view/99217 , 레이던대 학위논문(2025, Colonist 랭크전에서 사람과 대전) https://theses.liacs.nl/pdf/2024-2025-PiszczekWWiktor.pdf , LLM 에이전트 대 catanatron(2025) https://arxiv.org/pdf/2506.04651v2
- [G74] Colonist 기록 내보내기 요청(검토 중): https://colonist.featureupvote.com/suggestions/87602/data-api-or-ability-to-export-data-after-games-for-analysis , 제3자 기록 저장 확장 프로그램 ColonyHistorian: https://github.com/lemeryfertitta/ColonyHistorian
- [G75] Catan GmbH 상표 목록: https://trademarks.justia.com/owners/catan-gmbh-4318411
- [G76] 국내 유통(코리아보드게임즈 카탄): https://www.coupang.com/vp/products/4728994364 , 보드라이프 확장판 재고 문의(2026-02): https://boardlife.co.kr/game/1982/board/talk
- [G77] Adweek, Chess.com Surpassed 250 Million Users And Is Launching a New Advertising Gambit(2026-05-01, 유료 구독자 약 200만·MAU 약 3,800만·매출 구성): https://finance.yahoo.com/markets/stocks/articles/chess-com-surpassed-250-million-200425425.html
- [G78] Semrush chess.com 국가별 트래픽(2025-08): https://cw.semrush.com/website/chess.com/overview
- [G79] Semrush 한국 스포츠 사이트 순위(2024-03): https://www.semrush.com/website/top/south-korea/sports/
- [G80] 국내 FIDE 활성 선수(chessstats.app): https://chessstats.app/top/kor
- [G81] Semrush DecodeChess 트래픽(2025-05): https://tr.semrush.com/website/decodechess.com/competitors
