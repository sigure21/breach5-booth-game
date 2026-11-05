# BREACH//5

**5분 안에 뚫거나 막아라.**

`BREACH//5`는 플래그 제출형 CTF가 아니라 OWASP Korea 2026 부스용으로 설계한 모바일 RED vs BLUE 보안 게임입니다. 참가자는 QR로 입장해 실제 HTTP 요청을 카드로 조립하고, 대형 화면에서는 격리된 취약 서버와 패치 서버의 판정이 실시간으로 진행됩니다.

현재 MVP에는 첫 번째 시나리오 **두 명의 경비원**만 구현되어 있습니다. 이 시나리오는 raw request-target과 canonical route의 해석 차이가 cold-start shell sink까지 이어지는 교육용 축소 모델입니다. 실제 제품 코드는 포함하지 않습니다.

## 지금 구현된 범위

- 서버 프로세스가 시작되면 JOIN부터 진행되는 정확한 300초 라운드
- 기동 시점을 기준으로 매 5분 자동 라운드 교체
- 익명 RED/BLUE 자동 배정과 6개 역할
- 브라우저에만 저장되는 익명 장치 ID를 이용한 새로고침·중복 탭 재접속
- 20초 JOIN 모집 구간이 끝나면 참가자를 다음 판으로 자동 배치하고 시작 시각·인원·완결형 연습 미션 제공
- 모바일 세로 화면, 한 손 조작, 키보드 입력 불필요
- 대형 관전자 화면과 QR 코드
- allowlist 카드 조합을 실제 raw HTTP request-target으로 변환
- 내부 취약 엔진에서 safe proof 실행
- 별도 패치 엔진에서 원본 및 변형 공격 재검증
- 취약·패치 엔진 외부 미노출
- 런타임 proof/token 자동 생성 및 Git 제외
- 한 명부터 16명까지 동작하는 deterministic fallback
- 단위·API·Docker live-contract·로그 비밀값 감사를 포함한 one-command 검증

GraphQL, AI 모델 로더, Flask cookie/pickle, Grafana/token pivot 라운드는 아직 구현되지 않았습니다.

## 빠른 실행

필수 조건:

- Node.js 22 이상
- Docker Engine 또는 Docker Desktop
- Docker Compose v2

```bash
npm ci
npm run up
```

실행 주소:

- 참가자: `http://127.0.0.1:18090/play`
- 대형 화면: `http://127.0.0.1:18090/screen`

`npm run up`은 다음 작업을 자동 수행합니다.

1. 오프라인 테스트 실행
2. `.runtime/booth.env`에 proof와 내부 토큰 생성
3. Compose 구성 검증
4. 이미지 빌드 및 서비스 시작
5. 취약·패치 엔진 health/readiness 확인

서버가 정상 기동된 순간이 첫 라운드의 `0:00 JOIN`입니다. 라운드는 벽시계의 `:00`·`:05`에 맞추지 않고 그 기동 시점부터 5분 주기로 이어집니다.

`5분`은 한 팀 라운드의 길이입니다. 증거와 역할 맥락을 보존하기 위해 `0:20` 이후 중간 참가는 허용하지 않습니다. 늦게 스캔한 방문자는 즉시 3단계 연습 사건과 해설을 완료한 뒤 다음 판에 자동 합류하므로, 전체 팀 라운드까지 기다리는 체류 시간은 다음 시작까지의 대기 시간이 추가될 수 있습니다. 대형 화면은 현재/다음 판 모집 상태와 시작 카운트다운을 표시합니다.

## 전체 검증

```bash
npm run verify
```

검증은 별도 Compose 프로젝트와 30초 가속 라운드를 사용합니다.

- 300초 상태머신 경계 단위 테스트
- 팀 균형, 역할, late join, 중복 행동, reconnect
- 참가자 API와 QR 생성
- Docker 격리 및 Compose 구성
- 실제 raw/canonical 공격의 safe proof 도달
- 원본 및 backtick 변형에 대한 패치 회귀 검증
- 6인 RED/BLUE 전체 라운드
- API 및 컨테이너 로그의 proof/token 비노출
- 검증 프로젝트 자동 종료 및 네트워크 정리

## 운영 명령

| 명령 | 기능 |
|---|---|
| `npm run up` | 테스트 후 5분 운영 스택 시작 |
| `npm run verify` | 가속된 전체 live contract 실행 후 정리 |
| `npm run status` | 운영 컨테이너 상태 확인 |
| `npm run logs` | 최근 운영 로그 확인 |
| `npm run down` | 이 저장소의 운영 Compose 스택만 종료 |
| `npm run reset` | 운영 스택과 런타임 비밀값 재생성 |
| `npm run doctor` | Node, Docker, Compose 및 구성 검사 |

`down`과 `verify`의 정리는 지정된 Compose 프로젝트에만 한정됩니다. 각 `verify`는 고유 Compose 프로젝트·이미지·원자적으로 생성된 환경 파일, 검증 전용 loopback 프록시, Docker가 배정한 임의 backend 포트를 사용하므로 동시 검증도 서로를 건드리지 않습니다. 별도 heartbeat가 장시간 빌드 중인 활성 manifest를 계속 갱신합니다. 종료된 PID의 manifest는 다음 실행이 즉시, PID가 재사용된 경우에도 heartbeat가 끊긴 manifest는 60초 후 정확한 프로젝트명으로 scoped cleanup합니다.

## 5분 라운드

| 시간 | Phase | RED | BLUE |
|---:|---|---|---|
| 0:00–0:20 | JOIN | QR 입장·역할 배정 | QR 입장·역할 배정 |
| 0:20–0:50 | BRIEF | 사건 단서 수신 | 로그·구조 단서 수신 |
| 0:50–1:35 | DISCOVER | 신뢰 오류 발견 | 이상 징후 발견 |
| 1:35–2:35 | BUILD | 요청 카드 조립 | 1차 차단 경계 선택 |
| 2:35–3:05 | EXECUTE | 취약 서버 실전 판정 | 침투 결과 확인 |
| 3:05–4:05 | DUEL | 변형 요청 선택 | 근본 패치 선택 |
| 4:05–4:35 | REVERIFY | 변형 공격 재전송 | 패치 회귀 검증 |
| 4:35–5:00 | RESULT | 원인·Raw HTTP 확인 | 원인·통제 확인 |

## 실제 휴대폰 연결

기본값은 안전을 위해 `127.0.0.1`에만 바인딩됩니다. 이 상태에서는 다른 휴대폰이 QR 주소에 접근할 수 없습니다.

검증된 내부망에서 시험할 경우 `.runtime/booth.env`의 비밀값은 그대로 두고 다음 비밀값이 아닌 설정만 변경할 수 있습니다.

```dotenv
BREACH5_BIND=0.0.0.0
BREACH5_PORT=18090
PUBLIC_BASE_URL=http://192.0.2.10:18090
```

`192.0.2.10`은 문서용 예시 주소이므로 실제 PC의 검증된 주소로 바꿔야 합니다. 변경 후 `npm run reset`이 아니라 다음처럼 기존 비밀값을 유지한 채 스택만 다시 시작합니다.

```bash
npm run down
npm run up
```

실제 행사에서는 공용 Wi-Fi만 가정하지 말고 유효한 HTTPS 주소 또는 행사장 정책에 맞는 전용 AP를 사전에 검증해야 합니다. 네트워크 정책을 확인하기 전에는 현장 모바일 접속 가능성을 확정할 수 없습니다.

QR과 대형 화면의 주소는 모두 `PUBLIC_BASE_URL`을 기준으로 생성됩니다. 이 값은 참가자의 휴대폰에서 실제로 접근 가능한 coordinator 주소여야 하며, 경로는 자동으로 `/play`가 사용됩니다. 공용 인터넷에 직접 노출하지 말고, 참가자망에서만 접근 가능한 방화벽 또는 검토된 HTTPS ingress를 사용하세요. 행사장 ingress에는 연결·요청 속도 제한을 별도로 두는 것을 권장합니다.

## 구조

```text
휴대폰 /play ─┐
대형화면 /screen ──> game coordinator
                         ├─> vulnerable gateway ─> vulnerable worker
                         └─> patched gateway ────> patched worker
```

- 외부에 노출되는 것은 coordinator 하나뿐입니다.
- 모바일은 raw path나 shell 문자열을 제출할 수 없습니다.
- coordinator가 allowlist 카드 ID를 정해진 raw request-target으로 변환합니다.
- worker는 외부 네트워크, host mount, Docker socket을 받지 않습니다.
- 브라우저에는 proof 값이 아니라 boolean 판정과 정제된 trace만 반환됩니다.

## 익명 참가와 한계

- 브라우저는 임의의 128-bit 장치 ID를 생성해 `localStorage`에 보관합니다. 서버는 같은 ID의 중복 탭이나 새로고침을 같은 참가자로 재연결합니다.
- bearer 참가 토큰은 `sessionStorage`에만 보관되며 이름, 이메일, 계정 입력은 받지 않습니다.
- 장치 ID는 인증 수단이나 강한 개인 식별자가 아닙니다. 저장소 삭제나 새 브라우저 프로필로 새 ID를 만들 수 있습니다.
- coordinator의 짧은 join 속도 제한과 라운드 정원은 우발적인 중복을 줄이지만, 악의적인 참가자가 여러 장치 ID를 만들어 현재 판과 다음 판의 슬롯을 소진하는 것을 완전히 막지는 못합니다.

따라서 공용 인스턴스에서는 신뢰된 행사장 네트워크, ingress 단위 속도 제한, 현장 모니터링을 함께 사용해야 합니다. 자세한 잔여 위험은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 사실 범위

이 저장소는 `ctf-proxy-panic`에서 사용한 신뢰 경계 모델을 부스 게임용으로 새로 구성한 교육용 코드입니다. 실제 Collabora 또는 Nextcloud 제품 코드를 포함하지 않으며, 실제 제품 배포를 재현한다고 주장하지 않습니다. 관련 출처를 설명할 때는 각 advisory의 정확한 범위와 확인 날짜를 별도로 검증해야 합니다.

## 라이선스

MIT. 파생 설계와 npm 의존성 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.
