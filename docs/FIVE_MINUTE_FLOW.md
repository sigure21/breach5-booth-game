# Four-racer heat contract

## 목표

- 한 heat는 정확히 4대가 출발한다.
- 첫 참가자 입장 후 30초 전에는 출발하지 않으며, 45초를 넘겨 사람을 기다리지 않는다.
- 30초 이후 4명이 모이면 즉시 grid로 전환하고, 45초에도 빈 좌석이 있으면 서버가 AI racer로 채운다.
- 다섯 번째 사람은 진행 중인 heat에 난입하지 않고 다음 heat의 첫 참가자가 된다.
- 참가자는 2-lap 압축 sprint 동안 서버가 heat별로 정한 10~15개의 증거 기반 보안 판단을 수행한다.
- 클릭 속도가 아니라 정답과 근거 해석이 차량 성능과 순위를 결정한다.
- 초급~중급과 고급은 같은 보안 주제군에서 난이도별 질문·증거·선택지를 사용한다.
- 참가자는 `WHITE`, `RED`, `BLUE`, `FULL STACK` 보안 서킷 중 하나를 고른다.
- `난이도 + 보안 서킷`이 모두 같은 참가자만 같은 heat에 들어간다.
- 보안 판단이 순위의 주 입력이고 공개된 팀·드라이버 게임 수치는 작은 보정값이다.
- 사람은 오답 또는 시간 초과 5~6개면 P4, 사람과 AI 모두 7개 이상이면 무순위 `RETIRED`이며, 완벽한 사람보다 AI가 앞설 수 없다.

이 게임은 실제 Formula 1 경기나 telemetry를 재현하지 않는다. 공식 서킷의 일반적 특성에서 영감을 받은 오리지널 압축 시뮬레이션이며, 표시 속도와 경로는 교육 게임용 모델이다.

## Production timing

운영 Compose는 timing을 다음 명시적 환경변수로 고정한다.

```dotenv
MATCH_MIN_WAIT_MS=30000
MATCH_MAX_WAIT_MS=45000
GRID_COUNTDOWN_MS=5000
ENCOUNTER_DURATION_MS=15000
MIN_ENCOUNTER_MS=4000
RESULT_DURATION_MS=25000
```

| 구간 | 최대 시간 | 동작 |
| --- | ---: | --- |
| `MATCHING` | 45초 | 30초 minimum wait, 45초 AI fill deadline |
| `GRID` | 5초 | 5-light start sequence |
| `RACING` | 최대 225초 | 최대 15 encounter × 15초, 각 encounter 최소 노출 4초 |
| `RESULT` | 25초 | 4대 순위, 해당 heat 전체 review, 재도전 |
| 합계 | 최대 300초 | 45초 대기와 15개 encounter의 모든 deadline을 사용할 때 |

4명의 사람이 일찍 모여도 30초 minimum wait는 유지한다. 30초 이후 네 번째 사람이 들어오면 바로 `GRID`로 이동한다. 모든 사람이 답을 제출하면 최소 노출 시간 이후 다음 encounter로 일찍 넘어갈 수 있으므로 실제 소요 시간은 더 짧을 수 있다.

통합 검증은 동일 상태 전이를 빠르게 확인하기 위해 300/450ms wait, 100ms grid, 300ms encounter, 75ms minimum exposure, 300ms result를 명시한다. 이 축소는 검증 전용이며 운영 기본값이 아니다. 서버는 각 값의 정수 범위, encounter 10~15개, `minimum <= maximum` 관계와 최악 경로 `maximumHeatRuntime <= 300000ms`를 시작 시 검증하고 잘못된 설정이면 즉시 종료한다.

## Matchmaking

`POST /api/join`

```json
{
  "deviceId": "128-bit lowercase hex",
  "difficulty": "BEGINNER",
  "securityCircuitId": "RED",
  "crewId": "red-bull-racing",
  "driverId": "max-verstappen"
}
```

- 모든 필드는 allowlist로 검증한다.
- 선택한 선수는 선택한 팀 소속이어야 한다.
- `securityCircuitId`는 `WHITE`, `RED`, `BLUE`, `FULL_STACK`만 허용한다.
- 서버는 `(difficulty, securityCircuitId)`를 정확한 queue key로 사용한다. 둘 중 하나라도 다르면 별도 heat이며, 둘 다 같아야 기존 open heat에 합류한다.
- 보안 서킷과 별개인 시각적 race course는 서버가 heat 단위로 순환 배정한다.
- 같은 device/token 재접속은 원래 heat와 최초 선택을 유지한다.
- 한 heat의 human seat가 4개 차면 이후 참가자는 다음 heat로 배정된다.
- 전체 human capacity를 넘으면 `capacity` 오류를 반환한다. AI seat는 human capacity를 소비하지 않는다.

`POST /api/start-with-ai`는 bearer가 속한 `MATCHING` heat에 사람 1~3명이 있을 때만 허용한다. 요청 본문의 heat나 AI 수는 신뢰하지 않으며, 최신 사람을 모두 보존하고 비어 있는 자리만 해당 heat와 동일한 난이도·보안 서킷의 AI로 채운다. 이미 4명이거나 `GRID` 이후이면 `409 solo_start_unavailable`을 반환한다.

응답은 bearer token과 참가자가 배정된 `matchId`를 포함한다. 브라우저가 순위나 AI 결과를 제출하는 경로는 없다.

## 상태 모델

`GET /api/state`의 공개 모델은 현재 참가자에게 필요한 정보만 포함한다.

```text
player: callsign, crew/driver, difficulty, securityCircuitId
match: id, status, difficulty, securityCircuitId, humanCount, aiCount, seats, wait/countdown fields,
       encounterIndex, totalEncounters, circuit
tasks: 현재 encounter의 task 0개 또는 1개
observations: 제출 후 공개되는 판정과 설명
race: lap, totalLaps, position, modeled speed, battery, boost/overtake/aero,
      pit time, progress, track progress, four racers
result: RESULT 이후의 final standing과 review
```

상태 전이는 다음과 같다.

```text
MATCHING -> GRID -> RACING -> RESULT -> COMPLETE
```

`MATCHING` 이외의 match에는 새 사람이 들어오지 않는다. 화면 애니메이션은 서버 상태를 표현할 뿐이며, 순위와 차량 상태의 authoritative source는 서버다.

## 보안 서킷과 race course

참가자가 선택하는 보안 서킷은 문제 관점이다.

- `WHITE`: 허가 범위, Rules of Engagement, 안전한 검증, 증거 보존, 수정 확인
- `RED`: 공격자 관점, 악용 전제, 신뢰 경계, 공격 사슬
- `BLUE`: 탐지, 차단, 사고 대응, 복구, 재발 방지
- `FULL_STACK`: WHITE를 제외한 RED/BLUE 문제를 문항 수 차이 1개 이내로 혼합

한 heat의 전 참가자와 AI는 같은 보안 서킷과 난이도, 문제 ID, race phase, 선택지 순서, 정답과 서버 전용 배점을 공유한다.

서버는 보안 서킷과 별개로 heat마다 다음 오리지널 race-course profile을 순환 배정한다.

- `Temple Speed Ring`: Monza의 고속·저다운포스 성격에서 영감
- `Harbour Street Loop`: Monaco의 저속·정밀 street-circuit 성격에서 영감
- `Airfield Flow Circuit`: Silverstone의 빠른 방향 전환 성격에서 영감

SVG 경로는 이 게임을 위해 새로 만든 추상 경로이며 공식 circuit outline을 복제하지 않는다. km/h 표시는 문제 결과와 circuit profile을 입력으로 한 모델값이지 실제 차량 측정값이 아니다.

## Deck

서버는 question-bank version, match ID, race-course ID, 난이도, 보안 서킷, runtime seed secret을 입력으로 HMAC 순위를 만든다. 먼저 heat의 encounter 수를 10~15에서 정하고, 난이도별 128문항 중 선택한 보안 서킷의 풀에서 topic family가 겹치지 않게 선택한다. 각 난이도의 primary pool은 WHITE 30, RED 30, BLUE 68문항이다. `FULL_STACK`은 RED/BLUE 슬롯을 교대로 배치해 두 관점의 문항 수 차이를 최대 1개로 제한한다. 선택지 순서도 같은 seed로 섞기 때문에 재접속 시에는 유지되지만 다른 heat에서는 정답 위치가 바뀐다.

`LAUNCH`, `PIT_STOP`, `SPRINT`는 선택된 문항을 레이스 화면과 효과에 배치하는 **시각적 phase**다. 특정 보안 주제를 특정 phase에 고정하면 작은 서킷 풀의 일부 문항이 도달 불가능해지므로, 문항의 작성 모드와 phase를 출제 eligibility로 결합하지 않는다.

같은 heat의 human racer와 AI racer는 공통 gate 타임라인과 동일한 deck을 사용한다. 난이도나 보안 서킷이 다른 참가자는 애초에 이 heat에 들어올 수 없다. AI racer의 답과 성능도 서버가 seed로 결정되므로 새로고침이나 polling 횟수로 바뀌지 않는다.

제출 전 task는 다음 필드만 포함한다.

```text
id, category, question, difficulty-filtered evidence,
option id/label/technical detail, encounter index
```

정답 ID, 선택지 feedback, 해설, 최종 review는 제출 전에 포함하지 않는다.

## 제출과 피드백

`POST /api/action`

```json
{
  "matchId": "m-example",
  "task": "account-passkey",
  "choice": "use-passkey",
  "actionId": "client-generated idempotency id"
}
```

서버는 bearer token, match, 현재 encounter, task, choice allowlist, 최초 제출 여부를 검증한다. 성공한 제출 뒤에만 정오답, 선택지별 설명, 올바른 선택과 race effect를 공개한다.

`actionId`는 참가자별 멱등성 키다. 같은 본문의 재전송은 최초 응답을 재생하고, 같은 키를 다른 task/choice에 재사용하면 거부한다.

## Race effects

10~15개 encounter는 출발, straight, braking, pit, aero, incident-response 성격의 이벤트로 배치된다. 정답은 서버 계산에 다음과 같이 반영된다.

- 정확한 판단: modeled pace와 battery/boost 기회 향상
- 잘못된 판단: 설명 가능한 time loss 또는 pit/pace 불이익
- 미응답: 정답으로 대체하지 않음
- 누적 정확도: 최종 순위의 주요 입력

문항별 난이도 가중치와 정규화된 race score는 서버 내부에서만 사용하며 task, action, state, screen, result 응답에 포함하지 않는다. 최종 순위에는 보안 지식이 지배적으로 반영되고 팀 `GAME PERF`와 드라이버 `GAME SKILL`이 작게 반영된다. 두 수치는 행사 게임용이며 실제 팀·선수의 공식 평가가 아니다.

- 사람끼리 최종 내부 점수가 같으면 표준 경쟁 순위(`P1, P1, P3`)를 사용한다.
- AI와 사람의 최종 점수는 공동순위가 생기지 않도록 서버가 구분한다.
- 5~6개 오답·시간 초과인 사람은 다른 계산과 무관하게 P4다. 이 강제 P4 규칙은 AI에는 적용하지 않는다.
- 사람과 AI 모두 7개 이상 오답·시간 초과이면 `position: null`, `classificationStatus: RETIRED`로 분류하며 등수를 부여하지 않는다.
- 어떤 팀·드라이버를 선택해도 전 문항 정답인 사람은 가장 강한 AI보다 높은 내부 점수를 갖는다.

2026 용어를 사용한다.

- `Boost Mode`: 추가 battery deployment
- `Overtake Mode`: 추월 조건에서 사용할 수 있는 에너지 기반 효과
- `Active Aero`: straight/corner 상태를 표현하는 UI
- `Battery / Recharge`: 에너지 상태

DRS는 2026 표현으로 사용하지 않는다. 효과명은 교육용 모델이며 공식 경기 제어 로직의 복제본이 아니다.

## Screen

`/screen`은 다음 정보만 표시한다.

- 현재 `MATCHING` heat의 4-seat grid와 남은 wait
- 진행 중 heat의 보안 서킷·난이도, race course, lap, P1–P4/RET, gap, modeled speed와 energy 상태
- 다음 security encounter 번호
- QR과 운영 상태

다수 heat가 동시에 존재할 수 있으므로 screen은 대표 pending/active heat를 명시적으로 선택해 보여 준다. 다른 heat의 bearer token이나 정답은 노출하지 않는다.

## 모바일 검증 지점

- 320×568에서 팀·선수 선택, matching, grid, 10~15 encounter, feedback, result가 가로 overflow 없이 동작해야 한다.
- 긴 URL, 선수 이름, 기술 표현, evidence, option text는 자동 줄바꿈한다.
- 모든 가시 element의 `scrollWidth/clientWidth`를 검사한다.
- 최소 44px touch target과 `:focus-visible`을 제공한다.
- `prefers-reduced-motion`에서는 주행과 driver-panel motion을 줄이되 진행 상태를 숨기지 않는다.
- countdown tick마다 DOM 전체를 다시 만들지 않고 필요한 텍스트와 telemetry만 갱신한다.
- 공식 2026 car 사진이 로드되지 않아도 팀명과 색상으로 선택할 수 있어야 한다.
