# BREACH//5: NITRO GRID

**보안 판단이 맞으면 머신이 빨라지는 5분 모바일 레이스.**

`NITRO GRID`는 OWASP Korea 2026 부스용 비상업적 교육 게임입니다. 참가자는 휴대폰으로 QR을 스캔하고 서킷·난이도·팀·선수를 고른 뒤, 최대 5분 동안 7개의 보안 인카운터를 해결합니다. 빠르게 누르는 게임이 아닙니다. 화면에 제시된 로그, 요청, 권한, 주소와 상황 증거를 읽어야 정답을 고를 수 있습니다.

정답은 레이스 효과로 즉시 바뀝니다.

- 출발 판단 성공 → `LAUNCH BOOST`
- Sector 1 정답 → `NITRO` 충전
- 근본 대응 선택 → `FAST PIT`
- Sector 2 연속 정답 → `AERO BOOST`
- 마지막 사고 대응 성공 → `NITRO DEPLOY`

오답은 무작위 패널티가 아닙니다. 선택 직후 왜 근거와 맞지 않는지 설명하고, 결과 화면에서 7문항 전체를 복기합니다.

## 4팀 · 8선수

2026 시즌 공식 라인업을 기준으로 다음 선택지를 제공합니다.

| 팀 | 선수 |
|---|---|
| Red Bull Racing | Max Verstappen · Isack Hadjar |
| Ferrari | Charles Leclerc · Lewis Hamilton |
| Mercedes | George Russell · Kimi Antonelli |
| McLaren | Lando Norris · Oscar Piastri |

팀과 선수는 시각적 선택이며 문제 난이도나 점수에 영향을 주지 않습니다. F1 또는 팀 공식 로고는 게임 브랜드로 사용하지 않습니다.

이 프로젝트는 Formula 1, EA, 각 팀 또는 선수의 공식 제품이나 승인·후원 프로젝트가 아닙니다. 운영 주체는 비상업적 교육 목적의 2차 창작 사용 권한을 확인했다고 밝혔습니다. 미디어 출처와 권리 고지는 [MEDIA_SOURCES.md](docs/MEDIA_SOURCES.md)를 확인하세요. 미디어 파일은 이 저장소의 MIT 라이선스 적용 대상이 아닙니다.

## 문제 구성

문제은행은 총 30문항이며 한 레이스에는 서버가 7문항을 결정론적으로 구성합니다.

| 분야 | 문항 수 | 예시 |
|---|---:|---|
| 계정·인증·피싱 | 6 | 패스키, OAuth 동의 피싱, 세션 탈취 |
| 기기·업데이트·백업 | 5 | 패치 우선순위, 복구 테스트, 분실 기기 |
| 웹·애플리케이션 | 7 | SQLi, XSS, CSRF, SSRF, IDOR |
| 클라우드·공급망·데이터 | 7 | OIDC, 패키지 출처, SBOM, 공유 링크 |
| 사고 대응·업무 보안 | 5 | 랜섬웨어, BEC, Git 비밀값, 이상 로그인 |

문항 선택은 서버 HMAC 시드로 결정됩니다. 같은 라운드·서킷의 덱은 재접속해도 바뀌지 않으며, 정답 여부에 무작위성이 개입하지 않습니다. 두 개의 2026 보안 동향 카드가 레이스 중간과 결과에 표시되지만 점수에는 반영되지 않습니다.

보안 콘텐츠의 공식 출처와 검토 기준은 [CONTENT_SOURCES.md](docs/CONTENT_SOURCES.md)를 참고하세요.

## 두 서킷

- `Human Firewall Circuit`: 계정, 피싱, 기기, 사고 대응 중심
- `Secure Builder Circuit`: 웹, 클라우드, 데이터, 공급망 중심

각 덱은 한 주제에 몰리지 않도록 카테고리를 순환 선택합니다.

## 난이도

초급과 고급은 **정답·선택지·점수 엔진이 같습니다.** 차이는 증거 설명량뿐입니다.

| 난이도 | 증거 표시 |
|---|---|
| 초급 · Guided | 핵심 줄과 판단 기준에 짧은 주석 제공 |
| 고급 · Analyst | 같은 증거를 원문 기술 표현 중심으로 제공 |

## 최대 5분 흐름

| 구간 | Phase | 문항 | 레이스 효과 |
|---:|---|---:|---|
| 0:00–0:30 | GARAGE | 선택 | 팀·선수·서킷·난이도 확정 |
| 0:30–0:55 | LAUNCH | 1 | Launch Boost |
| 0:55–1:45 | SECTOR 1 | 2 | Nitro 충전 |
| 1:45–2:20 | PIT STOP | 1 | Pit 시간 단축 + 동향 카드 |
| 2:20–3:15 | SECTOR 2 | 2 | Aero Boost |
| 3:15–4:10 | FINAL SPRINT | 1 | Nitro Deploy |
| 4:10–5:00 | RESULT | 복기 | 결과·7문항 해설·동향 카드 |

같은 그리드의 필수 응답이 모두 모이면 최소 노출 시간 후 다음 구간으로 일찍 넘어갈 수 있습니다. 출발 30초가 지나면 진행 중인 레이스에는 난입하지 않고 다음 그리드에 예약됩니다. 상세 계약은 [FIVE_MINUTE_FLOW.md](docs/FIVE_MINUTE_FLOW.md)에 있습니다.

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

기본 바인딩은 loopback입니다. 다른 휴대폰에서 접속하려면 검증된 참가자망에서 `.runtime/booth.env`의 다음 비밀값이 아닌 설정만 변경하세요.

```dotenv
BREACH5_BIND=0.0.0.0
PUBLIC_BASE_URL=http://192.0.2.10:18090
```

`192.0.2.10`은 문서용 예시 주소입니다. 실제 운영 PC의 검증된 주소로 바꾼 뒤 스택을 다시 시작해야 합니다.

## 검증

```bash
npm run check
npm run verify
```

검증 범위:

- 30문항/8개 동향 카드 스키마와 출처
- 5분 상태 머신과 가속 라운드 순서
- 7문항 중복 방지와 단계별 문항 수
- 제출 전 정답·해설 비노출
- 팀·선수·서킷·난이도 allowlist와 재접속 불변성
- 정답별 Launch/Nitro/Pit/Aero/Sprint 효과
- 320px 참가 전체 흐름과 전광판의 중첩 가로 overflow
- 단일 비권한·read-only 컨테이너와 loopback 기본 노출
- 런타임 HMAC 시드의 공개 응답·로그 비노출
- 검증 전용 Compose 프로젝트의 범위 제한 정리

현재 환경에서 실제로 통과했는지는 명령 출력으로 판단해야 합니다. 문서만으로 행사장 네트워크나 브라우저 호환성을 보증하지 않습니다.

## 운영 명령

| 명령 | 기능 |
|---|---|
| `npm run up` | 검사 후 운영 스택 시작 |
| `npm run verify` | 가속 Docker 통합 검증 후 범위 제한 정리 |
| `npm run status` | 운영 컨테이너 상태 |
| `npm run logs` | 최근 운영 로그 |
| `npm run down` | 이 저장소의 운영 Compose 프로젝트만 종료 |
| `npm run reset` | 운영 스택 종료, 런타임 시드 재생성, 재시작 |
| `npm run doctor` | Node·Docker·Compose 사전 점검 |

광범위한 `docker system prune`은 실행하지 않습니다.

## 구조와 신뢰 경계

```text
휴대폰 /play ─┐
전광판 /screen ──> NITRO GRID coordinator
                    ├─ 30문항 콘텐츠
                    ├─ HMAC 결정론적 덱
                    ├─ 레이스 상태·점수
                    └─ 익명 재접속 세션
```

- 외부에 공개되는 컨테이너는 Node.js 게임 서비스 하나뿐입니다.
- 브라우저는 문제 ID와 allowlist 선택지 ID만 제출합니다.
- 정답 ID와 해설은 제출 전 공개 상태에 포함하지 않습니다.
- 기기 ID는 인증 수단이 아니라 우발적 중복을 줄이는 익명 재접속 키입니다.
- 서버 메모리 상태이므로 프로세스 재시작 시 진행 중 레이스와 누적 통계는 초기화됩니다.
- 실제 공격 실행, 명령 실행, 취약 제품, 플래그 비밀값은 포함하지 않습니다.

잔여 위험과 운영 고려사항은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 라이선스

- 애플리케이션 코드와 오리지널 UI: MIT
- 선수 영상·이미지, 팀·선수 이름과 관련 표장: 각 권리자에게 귀속되며 MIT 대상이 아님
- npm 의존성: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
