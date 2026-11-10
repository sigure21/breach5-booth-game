# BREACH//5: NITRO GRID

**보안 판단이 맞으면 머신이 빨라지는 4인 모바일 security sprint.**

`NITRO GRID`는 OWASP Korea 2026 부스를 위한 비상업적 교육 게임입니다. 참가자는 휴대폰에서 팀, 선수, 보안 서킷, 난이도를 선택합니다. 서버는 **동일한 보안 서킷과 난이도**를 고른 참가자만 같은 heat에 배정하며, 정확히 4대가 출발합니다. 사람 4명이 30초 이후 모이면 바로 출발하고, 45초까지 자리가 비면 같은 조건의 AI racer가 채웁니다. 기다리지 않으려면 현재 참가자를 보존한 채 남은 자리만 AI로 채워 바로 출발할 수도 있습니다. 이후 2-lap 압축 레이스에서 서버가 고른 보안 문제 10~15개를 풉니다.

이 게임은 빠르게 찍는 퀴즈가 아닙니다. 화면에 제시된 요청, URL, 권한, 로그, 사고 상황을 읽어야 하며, 정확한 판단이 modeled pace, battery, pit time, Boost/Overtake Mode와 최종 순위에 반영됩니다. 오답에는 근거와 맞지 않는 이유가 즉시 표시되고 결과 화면에서 해당 heat의 모든 문항을 복기할 수 있습니다.

## 핵심 흐름

```text
팀·선수·보안 서킷·난이도 선택
        ↓
4-seat matchmaking (30초 minimum / 45초 AI fill)
        ↓
5-light grid start
        ↓
2 laps · random 10–15 security encounters · 4 racers
        ↓
P1–P4 또는 RETIRED · 전체 review · 재도전
```

- heat당 정확히 4대
- 사람은 최대 4명, 빈 좌석은 AI
- `난이도 + 보안 서킷`이 모두 같은 참가자만 같은 heat
- 다섯 번째 사람은 다음 heat로 배정
- 진행 중 heat 중간 난입 없음
- server-authoritative 순위, 속도, AI 판정
- production 기준 최대 5분, 전원이 빨리 제출하면 최소 노출 시간 이후 조기 진행

상세 상태 머신과 API 계약은 [Four-racer heat contract](docs/FIVE_MINUTE_FLOW.md)에 있습니다.

## 4팀 · 8선수 · 공식 2026 머신 사진

2026 시즌 line-up snapshot을 기준으로 다음 선택지를 제공합니다.

| 팀 | 머신 | GAME PERF | 선수와 GAME SKILL |
| --- | --- | ---: | --- |
| Red Bull Racing | RB22 | 88 | Max Verstappen 90 · Isack Hadjar 85 |
| Ferrari | SF-26 | 87 | Charles Leclerc 89 · Lewis Hamilton 89 |
| Mercedes | W17 | 86 | George Russell 88 · Kimi Antonelli 86 |
| McLaren | MCL40 | 88 | Lando Norris 90 · Oscar Piastri 89 |

팀 카드에는 각 팀 또는 Formula 1의 공식 공개 페이지에서 확인한 2026 머신 사진의 모바일 WebP 사본을 사용합니다. 경기 중 작은 차량 marker는 빠른 렌더링을 위해 오리지널 경량 SVG를 사용합니다. `GAME PERF`와 `GAME SKILL`은 보안 판단보다 훨씬 작은 비중으로 modeled pace와 최종 순위에 반영됩니다. 이 수치는 행사 게임의 밸런스 메타데이터이며 실제 시즌 성적, 공식 성능 지표 또는 선수 기량의 객관적 평가가 아닙니다.

이 프로젝트는 Formula 1, Formula One Management, FIA, EA, 각 팀 또는 선수의 공식 제품이나 승인·후원 프로젝트가 아닙니다. 운영 주체는 이 비상업적 교육 목적 사용에 필요한 재사용 권한을 확인했다고 밝혔습니다. 정확한 원본 페이지, delivery rendition과 권리 전제는 [MEDIA_SOURCES.md](docs/MEDIA_SOURCES.md)에 기록되어 있습니다. 제3자 사진, 애니메이션, 이름, likeness와 mark는 이 저장소의 MIT 라이선스 적용 대상이 아닙니다.

## Matchmaking과 회전율

첫 참가자가 들어오면 heat queue가 열립니다.

| 시점 | 동작 |
| ---: | --- |
| 0–30초 | 사람을 모으되 출발하지 않음 |
| 30초 | 이미 4명이면 grid로 전환 |
| 30–45초 | 네 번째 사람이 들어오는 즉시 grid로 전환 |
| 45초 | 빈 좌석을 deterministic AI로 채우고 grid로 전환 |
| +5초 | 4대가 동시에 출발 |

`남은 자리에 AI 투입 · 바로 출발`을 누르면 현재 heat의 사람 1~3명은 그대로 두고 비어 있는 자리만 **해당 heat와 같은 보안 서킷·난이도**의 AI로 채운 뒤 5초 grid로 이동합니다. 사람이 몰릴 때는 동일 조건별로 4명씩 독립 heat를 생성합니다. 서킷 또는 난이도 중 하나라도 다르면 별도 heat가 열립니다. AI의 선택과 성능은 서버 seed에서 결정되어 새로고침이나 polling 타이밍으로 변하지 않습니다.

## 4개 보안 서킷

보안 서킷은 주행 맵이 아니라 출제 관점을 뜻합니다. 참가자가 직접 선택하며, 같은 서킷과 난이도를 고른 참가자끼리만 경쟁합니다.

| 보안 서킷 | 출제 관점 |
| --- | --- |
| WHITE | 난이도별 30문항 · 허가 범위, Rules of Engagement, 안전한 검증, 증거 보존과 수정 확인 |
| RED | 난이도별 30문항 · 공격자 관점, 악용 전제, 신뢰 경계와 공격 사슬 |
| BLUE | 난이도별 68문항 · 탐지, 차단, 사고 대응, 복구와 재발 방지 |
| FULL STACK | WHITE를 제외하고 RED와 BLUE 문제를 문항 수 차이 1개 이내로 혼합 |

한 heat에서는 문제 ID, 문항 순서, 선택지 순서와 숨은 배점까지 동일합니다. 참가자나 합류 순서에 따라 덱이 달라지지 않습니다.

## 3개 오리지널 race-course profile

보안 서킷과 별개인 시각적 주행 코스입니다. 참가자가 고르지 않으며 서버가 heat마다 순환 배정합니다.

| 게임 circuit | 영감을 받은 특성 | modeled speed band |
| --- | --- | --- |
| Temple Speed Ring | Monza의 긴 직선, 강한 제동, 저다운포스 성격 | 85–345 km/h |
| Harbour Street Loop | Monaco의 좁고 느린 street circuit, 정밀 제어 성격 | 60–285 km/h |
| Airfield Flow Circuit | Silverstone의 빠르고 연속적인 방향 전환 성격 | 90–325 km/h |

SVG 경로는 게임을 위해 새로 만든 추상 경로입니다. 공식 circuit outline을 복제하지 않으며 표시 속도는 실제 telemetry가 아닌 교육 게임 모델입니다.

## 2026 race terminology

UI에는 2026 규정 설명에서 사용하는 용어를 반영합니다.

- `Battery / Recharge`
- `Boost Mode`
- `Overtake Mode`
- `Active Aero`

DRS는 사용하지 않습니다. 이 표시는 보안 답변 효과를 이해시키기 위한 모델이며 실제 F1 제어 소프트웨어나 성능 로직을 재현하지 않습니다.

## 문제 구성

문제은행은 난이도별 128문항, 총 256개의 플레이 가능한 변형으로 구성됩니다. 한 heat의 문제 수는 서버가 10~15개 중 하나로 정하고, 선택한 보안 서킷 풀에서 같은 주제군이 겹치지 않게 선택합니다.

| 분야 | 난이도별 문항 수 | 예시 |
| --- | ---: | --- |
| 계정·인증·피싱 | 21 | 패스키, OAuth/PKCE, JWT trust, 세션·자격 증명 경계 |
| 기기·업데이트·백업 | 11 | KEV 우선순위, 복구 테스트, 분실 기기, 가용성 안전 |
| 웹·API·애플리케이션 | 44 | SQLi, XSS, SSRF, BOLA, parser/cache 차이, race, 승인된 재검증 |
| 클라우드·공급망·AI | 38 | IAM, Kubernetes, provenance, artifact substitution, prompt injection, PQC |
| 사고 대응·업무 보안 | 14 | 랜섬웨어, BEC, infostealer, Git secret, 증거 최소화·중단 조건 |

서버는 비공개 runtime seed를 입력으로 문제 수, deck, 선택지 순서를 결정합니다. 같은 heat에서는 전원이 동일한 문제와 선택지 순서를 받고 새로고침해도 유지되지만, 다른 heat에서는 바뀝니다. `WHITE`, `RED`, `BLUE`는 해당 관점의 풀만 사용하고 `FULL STACK`은 RED와 BLUE를 균형 혼합합니다. 정답 ID와 해설은 제출 전 API에 포함되지 않으며 최신 동향 정보는 비채점 briefing으로 분리되어 있습니다. 콘텐츠의 공식 출처와 검토일은 [CONTENT_SOURCES.md](docs/CONTENT_SOURCES.md)에 있습니다.

문항을 `LAUNCH`, `PIT_STOP`, `SPRINT`에 놓는 것은 레이스 연출과 효과를 위한 시각적 배치입니다. 특정 보안 주제를 특정 레이스 phase에 고정하지 않아 모든 서킷 문항이 반복 플레이에서 도달 가능하도록 합니다.

## 난이도

두 난이도는 주제군을 공유하되 질문, 증거 표현과 선택지가 다릅니다. 점수는 각 heat에서 정규화되므로 문제 수가 10~15개로 달라도 비교할 수 있습니다.

| 난이도 | 증거 표시 |
| --- | --- |
| 초급~중급 | 핵심 개념뿐 아니라 요청·로그·권한 근거를 읽는 응용 판단 |
| 고급 | 공격 흐름, 신뢰 경계, 양성·음성 대조와 완화 우선순위 판단 |

## 서버 전용 점수와 순위

- 문항별 난이도 가중치, 정규화 점수와 AI 기준점은 브라우저/API 응답에 포함하지 않습니다.
- 보안 판단이 순위의 주 입력이며 공개된 `GAME PERF`와 `GAME SKILL`은 작은 보정값입니다.
- 사람 참가자는 오답 또는 시간 초과가 5~6개면 내부 점수와 관계없이 P4입니다.
- 사람과 AI 모두 오답 또는 시간 초과가 7개 이상이면 `RETIRED`이며 P1~P4 순위를 받지 않습니다.
- 한 사람이라도 모든 문제를 맞히면 AI가 그 사람보다 앞서 P1이 될 수 없습니다.
- AI와 사람은 같은 순위를 가질 수 없고, 같은 최종 내부 점수의 사람끼리는 `P1, P1, P3` 방식 공동순위가 가능합니다.

이 저장소는 public이므로 소스 코드를 직접 읽는 사람에게 내부 상수까지 비밀로 유지할 수는 없습니다. 보장 범위는 정상 참가자 UI와 공개 API에서 점수 세부값을 내보내지 않는 것입니다. 소스 열람자에게도 비밀이어야 하는 운영은 별도의 비공개 서버 설정·배포가 필요합니다.

## 실행

필수 조건:

- Node.js 22 이상
- Docker Engine 또는 Docker Desktop
- Docker Compose v2

```bash
npm ci
npm run up
```

기본 주소:

- 참가자: `http://127.0.0.1:18090/play`
- 전광판: `http://127.0.0.1:18090/screen`

기본 bind는 loopback입니다. 다른 휴대폰에서 접속하려면 검증된 참가자망에서 `.runtime/booth.env`의 다음 비밀값이 아닌 설정만 변경합니다.

```dotenv
BREACH5_BIND=0.0.0.0
PUBLIC_BASE_URL=http://192.0.2.10:18090
```

`192.0.2.10`은 문서 예시 주소입니다. 실제 운영 PC 주소로 바꾼 뒤 스택을 다시 시작해야 합니다. 공용망 노출에는 별도 firewall, reverse proxy와 HTTPS 정책이 필요합니다.

## 검증

```bash
npm run check
npm run verify
```

검증 범위:

- 난이도별 128문항 content schema, WHITE/RED/BLUE 분리, FULL STACK 균형, 주제 중복 방지와 공식 출처 기록
- production 30/45초 matchmaking 비율과 accelerated integration timing
- 정확히 4 seat, AI fill, 다섯 번째 사람의 새 heat 배정
- 2 laps, HMAC으로 정한 10~15 encounter, 4대 final standing
- 제출 전 정답·해설 비노출과 action idempotency
- 팀·선수·보안 서킷·난이도 allowlist, 정확한 heat-key 분리와 재접속 불변성
- server-authoritative AI, 순위, speed/energy state
- Overtake Mode/Active Aero 사용과 DRS 제거
- 320px 참가 전체 흐름과 전광판의 중첩 가로 overflow
- 공식 car photo 4개와 driver panel 8개의 로컬 delivery
- 비권한 read-only 컨테이너와 loopback 기본 노출
- runtime HMAC seed의 공개 응답·로그 비노출
- 검증 전용 Compose project의 범위 제한 정리

실제 통과 여부는 현재 checkout에서 명령을 실행한 출력으로 판단해야 합니다. 문서만으로 행사장 네트워크, 동시 접속량 또는 모든 모바일 브라우저 호환성을 보증하지 않습니다.

## 운영 명령

| 명령 | 기능 |
| --- | --- |
| `npm run up` | offline 검사 후 운영 stack 시작 |
| `npm run verify` | 가속 Docker 통합 검증 후 검증 project만 정리 |
| `npm run status` | 운영 container 상태 |
| `npm run logs` | 최근 운영 log |
| `npm run down` | 이 저장소의 운영 Compose project만 종료 |
| `npm run reset` | 운영 stack 종료, runtime seed 재생성, 재시작 |
| `npm run doctor` | Node, Docker, Compose 사전 점검 |

광범위한 `docker system prune`은 실행하지 않습니다.

## 구조와 신뢰 경계

```text
휴대폰 /play ─┐
전광판 /screen ──> NITRO GRID coordinator
                    ├─ (난이도 + 보안 서킷)별 heat queue와 4-seat grid
                    ├─ 난이도별 128문항 / 서킷별 random 10–15 HMAC deck
                    ├─ deterministic AI racers
                    ├─ server-owned race state
                    └─ anonymous reconnect sessions
```

- 외부에 공개되는 container는 Node.js 게임 서비스 하나뿐입니다.
- 브라우저는 task ID와 allowlist된 choice ID만 제출합니다.
- 브라우저는 순위, 속도, AI 결과를 직접 정하지 않습니다.
- device ID는 인증 수단이 아니라 우발적 중복을 줄이는 anonymous reconnect key입니다.
- 상태는 server memory에 있으므로 process restart 시 진행 중 heat와 누적 통계가 초기화됩니다.
- 실제 공격 실행, 명령 실행, 취약 제품 또는 flag secret은 포함하지 않습니다.

잔여 위험과 운영 고려사항은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 라이선스

- application code와 오리지널 UI/track/car marker: MIT
- 공식 car 사진, driver panel, 이름, likeness, 관련 표장: 각 권리자에게 귀속되며 MIT 대상이 아님
- npm dependency: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
