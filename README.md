# BREACH//5: NITRO GRID

**보안 판단이 맞으면 머신이 빨라지는 4인 모바일 security sprint.**

`NITRO GRID`는 OWASP Korea 2026 부스를 위한 비상업적 교육 게임입니다. 참가자는 휴대폰에서 팀, 선수, 난이도를 선택하고 정확히 4대가 출발하는 heat에 들어갑니다. 사람 4명이 30초 이후 모이면 바로 출발하고, 45초까지 자리가 비면 서버가 AI racer로 채웁니다. 이후 2-lap 압축 레이스에서 증거 기반 보안 문제 10개를 풉니다.

이 게임은 빠르게 찍는 퀴즈가 아닙니다. 화면에 제시된 요청, URL, 권한, 로그, 사고 상황을 읽어야 하며, 정확한 판단이 modeled pace, battery, pit time, Boost/Overtake Mode와 최종 순위에 반영됩니다. 오답에는 근거와 맞지 않는 이유가 즉시 표시되고 결과 화면에서 10문항을 복기할 수 있습니다.

## 핵심 흐름

```text
팀·선수·난이도 선택
        ↓
4-seat matchmaking (30초 minimum / 45초 AI fill)
        ↓
5-light grid start
        ↓
2 laps · 10 security encounters · 4 racers
        ↓
P1–P4 결과 · 10문항 review · 재도전
```

- heat당 정확히 4대
- 사람은 최대 4명, 빈 좌석은 AI
- 다섯 번째 사람은 다음 heat로 배정
- 진행 중 heat 중간 난입 없음
- server-authoritative 순위, 속도, AI 판정
- production 기준 최대 약 4분 15초, 정답 제출이 빠르면 조기 진행

상세 상태 머신과 API 계약은 [Four-racer heat contract](docs/FIVE_MINUTE_FLOW.md)에 있습니다.

## 4팀 · 8선수 · 공식 2026 머신 사진

2026 시즌 line-up snapshot을 기준으로 다음 선택지를 제공합니다.

| 팀 | 머신 | 선수 |
| --- | --- | --- |
| Red Bull Racing | RB22 | Max Verstappen #3 · Isack Hadjar #6 |
| Ferrari | SF-26 | Charles Leclerc #16 · Lewis Hamilton #44 |
| Mercedes | W17 | George Russell #63 · Kimi Antonelli #12 |
| McLaren | MCL40 | Lando Norris #1 · Oscar Piastri #81 |

팀 카드에는 각 팀 또는 Formula 1의 공식 공개 페이지에서 확인한 2026 머신 사진의 모바일 WebP 사본을 사용합니다. 경기 중 작은 차량 marker는 빠른 렌더링을 위해 오리지널 경량 SVG를 사용합니다. 팀과 선수 선택은 시각적 선택이며 문제 난이도나 정답 점수에 영향을 주지 않습니다.

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

이 설계는 한 명도 오래 기다리지 않게 하면서, 사람이 몰릴 때는 4명씩 끊어 독립 heat를 계속 생성합니다. AI의 선택과 성능은 서버 seed에서 결정되어 새로고침이나 polling 타이밍으로 변하지 않습니다.

## 3개 오리지널 circuit profile

참가자가 circuit을 직접 골라 queue를 쪼개지 않습니다. 서버가 heat마다 순환 배정합니다.

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

문제은행은 30문항이며 한 heat에는 중복 없는 10문항이 배정됩니다.

| 분야 | 문항 수 | 예시 |
| --- | ---: | --- |
| 계정·인증·피싱 | 6 | 패스키, OAuth 동의 피싱, 세션 탈취 |
| 기기·업데이트·백업 | 5 | 패치 우선순위, 복구 테스트, 분실 기기 |
| 웹·애플리케이션 | 7 | SQL injection, XSS, CSRF, SSRF, IDOR |
| 클라우드·공급망·데이터 | 7 | OIDC, package provenance, SBOM, 공유 링크 |
| 사고 대응·업무 보안 | 5 | 랜섬웨어, BEC, Git secret, 이상 로그인 |

서버는 HMAC seed와 category round-robin으로 deck을 만듭니다. 같은 heat의 사람은 동일 encounter 순서를 받아 비교할 수 있고, 정답 ID와 해설은 제출 전 API에 포함되지 않습니다. 최신 동향 정보는 비채점 briefing으로 분리되어 있습니다. 콘텐츠의 공식 출처와 검토일은 [CONTENT_SOURCES.md](docs/CONTENT_SOURCES.md)에 있습니다.

## 난이도

초급과 고급은 **정답, 선택지, 점수 엔진이 같습니다.** 차이는 증거에 제공되는 안내량뿐입니다.

| 난이도 | 증거 표시 |
| --- | --- |
| 초급 · Guided | 핵심 줄과 판단 기준에 짧은 주석 제공 |
| 고급 · Analyst | 같은 증거를 원문 기술 표현 중심으로 제공 |

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

- 30문항 content schema와 공식 출처 기록
- production 30/45초 matchmaking 비율과 accelerated integration timing
- 정확히 4 seat, AI fill, 다섯 번째 사람의 새 heat 배정
- 2 laps, 중복 없는 10 encounter, 4대 final standing
- 제출 전 정답·해설 비노출과 action idempotency
- 팀·선수·난이도 allowlist와 재접속 불변성
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
                    ├─ heat queue와 4-seat grid
                    ├─ 30문항 / 10-encounter HMAC deck
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
