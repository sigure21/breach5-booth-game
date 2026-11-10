# 5-minute interaction contract

## 목표

- 설명 없이 QR을 스캔한 참가자가 30초 안에 출발할 수 있어야 한다.
- 한 레이스는 최대 5분이며 7개의 증거 기반 판단을 포함한다.
- 클릭 속도가 아닌 정답 정확도가 성능 효과와 결과를 결정한다.
- 초급과 고급은 같은 문항·선택지·정답을 사용한다.
- 진행 중인 레이스에는 중간 난입하지 않는다.

## 서버 상태 머신

| Phase | 기준 구간 | 문항 수 | 완료 조건 |
|---|---:|---:|---|
| `JOIN` | 0–30초 | 0 | 30초 경계 도달 |
| `LAUNCH` | 30–55초 | 1 | 전원 제출 + 최소 노출 또는 deadline |
| `SECTOR_1` | 55–105초 | 2 | 전원 제출 + 최소 노출 또는 deadline |
| `PIT_STOP` | 105–140초 | 1 | 전원 제출 + 최소 노출 또는 deadline |
| `SECTOR_2` | 140–195초 | 2 | 전원 제출 + 최소 노출 또는 deadline |
| `SPRINT` | 195–250초 | 1 | 전원 제출 + 최소 노출 또는 deadline |
| `RESULT` | 250–300초 | 0 | 다음 전역 라운드 경계 |

가속 검증은 같은 비율과 순서를 유지합니다. production 상수는 300,000ms이며 허용되는 검증 최솟값은 3,000ms입니다.

## 입장

`POST /api/join`

```json
{
  "deviceId": "128-bit lowercase hex",
  "trackId": "human-firewall",
  "difficulty": "BEGINNER",
  "crewId": "red-bull-racing",
  "driverId": "max-verstappen"
}
```

- 모든 필드는 allowlist로 검증합니다.
- 선택한 선수는 선택한 팀 소속이어야 합니다.
- `JOIN` 경계 이후 입장은 `ordinal + 1`에 예약합니다.
- 같은 device/token 재접속은 최초 선택을 바꾸지 않습니다.
- 현재와 다음 라운드가 모두 정원이면 `capacity`를 반환합니다.

## 덱

서버는 다음 입력으로 HMAC 순위를 만듭니다.

```text
question-bank-version + round ordinal + track id + runtime seed secret
```

카테고리 round-robin으로 7개를 선택한 뒤 고정 슬롯에 배치합니다.

```text
LAUNCH ×1 → SECTOR_1 ×2 → PIT_STOP ×1 → SECTOR_2 ×2 → SPRINT ×1
```

같은 라운드·서킷의 참가자는 비교 가능한 덱을 받습니다. 다른 서킷은 별도 덱과 제출 상태를 가집니다.

## 공개 task

제출 전 task는 다음 필드만 포함합니다.

```text
id, category, question, difficulty-filtered evidence,
option id/label/technical detail, racePhase, gridPosition
```

정답 ID, 선택지 feedback, 해설, 결과 review는 포함하지 않습니다.

## 제출과 즉시 피드백

`POST /api/action`

```json
{
  "roundId": "r12-human-firewall",
  "task": "account-passkey",
  "choice": "use-passkey",
  "actionId": "client-generated idempotency id"
}
```

서버는 현재 phase, task 존재, 선택지 allowlist와 최초 제출 여부를 검증합니다. 성공 후에만 `correct`, 선택지별 설명, 올바른 선택지 ID와 레이스 효과를 반환합니다.

## 레이스 점수

| 조건 | 효과 |
|---|---|
| Launch 정답 | `launchBoost=true` |
| Sector 1 정답 | 정답 수 + Launch에 따라 Nitro 최대 3 |
| Pit 정답 | `pitTimeMs=1900`; 오답은 4100 |
| Sector 2 두 문제 정답 | `aeroActive=true` |
| Sprint 정답 + 저장된 가속 | `nitroDeploy=true` |

finish band:

- 7/7: `POLE_POSITION`
- 5–6: `PODIUM`
- 3–4: `POINTS_FINISH`
- 0–2: `GARAGE_REVIEW`

미응답은 정답으로 대체하지 않습니다.

## 동향 카드

- `PIT_STOP`: 첫 번째 카드
- `RESULT`: 두 번째 카드
- 카드 자체는 `scoring=false`
- 제목, 요약, 참가자가 취할 행동, 공식 출처 URL, 기준일, 검토일을 표시

## 모바일 UI 검증 지점

- 320×568: 차고 전체 선택, 초급·고급 모든 phase, 답변 feedback, 결과 review
- 모든 `pre`, 긴 URL, 선수 이름, 기술 표현은 자동 줄바꿈
- 문서 폭뿐 아니라 모든 가시 element의 `scrollWidth/clientWidth` 검사
- 장식용 pseudo-element와 track line도 실제 container를 넓히지 않아야 함
- 44px 이상 터치 target과 `:focus-visible`
- `prefers-reduced-motion`에서는 animated driver panel을 요청하지 않고 CSS car motion도 최소화
- 카운트다운은 DOM 전체를 다시 렌더링하지 않고 timer text만 갱신
