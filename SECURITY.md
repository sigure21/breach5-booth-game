# Security boundary

BREACH//5에는 의도적으로 취약한 교육용 shell 경로와 unsafe pickle 동작이 포함됩니다. 이 스택은 일반 목적 sandbox가 아니며 엔진 서비스를 인터넷에 직접 노출해서는 안 됩니다.

## 공개 표면

Compose가 host port로 publish하는 서비스는 `game` coordinator 하나뿐입니다. 다음 adjudication 서비스는 internal Docker network에서만 coordinator와 통신합니다.

- Proxy Panic의 vulnerable/patched gateway와 worker
- Session Heist의 Python session engine

공개 API는 서버가 정의한 `scenarioId`, `difficulty`, task ID, semantic choice ID만 받습니다. 다음 값을 참가자가 자유 입력하는 endpoint는 없습니다.

- raw HTTP request-target 또는 URL
- shell command 또는 command argument
- session cookie 또는 signing key
- pickle bytes 또는 Python object
- 외부 hostname 또는 callback address

coordinator가 allowlist choice를 서버 소유 request/payload로 변환합니다. 이 입력 제한은 취약한 sink가 참가자의 임의 payload를 처리하지 못하게 하는 핵심 안전 경계입니다.

## Proxy Panic containment

Proxy 엔진은 교육용 raw/canonical path differential과 shell sink를 모델링합니다. vulnerable worker가 다루는 command string은 coordinator가 정한 유한한 카드 조합에서만 생성됩니다.

- gateway·worker backplane은 internal network입니다.
- worker에는 host mount, Docker socket, host network가 없습니다.
- 외부 네트워크 연결을 목적으로 한 카드나 API가 없습니다.
- proof는 런타임 환경에 생성되며 공개 API에는 boolean 도달 여부만 반환됩니다.

문자열 allowlist와 container hardening은 위험을 줄이지만 의도적 shell sink를 일반 목적 public sandbox로 만들지는 않습니다.

## Session Heist containment

Session Heist는 Flask signed-cookie와 pickle trust-boundary 실패를 모델링하지만 실제 Google 서비스와 통신하지 않습니다. UI와 sanitized request preview는 가상 호스트 `devsite-lab.invalid`만 사용합니다.

Python session engine은 다음 서버 소유 데이터만 생성·처리합니다.

- lab에서 발급한 compressed Flask session
- lab이 생성한 pickled OAuth-style flow
- lab이 생성한 forged session
- 정확히 50ms로 제한된 in-process timing probe pickle

UI에 포함된 decode 가능한 cookie/pickle artifact는 고정된 공개 demo fixture입니다. 그 안의 명시적 demo credential은 교육 데이터이며 `.runtime/booth.env`의 `SESSION_LAB_CLIENT_SECRET`과 동일하지 않습니다. 엔진은 런타임 fixture와 forged cookie 원문을 coordinator에 반환하지 않습니다.

브라우저나 coordinator 요청에서 cookie/pickle bytes, callable, delay, command, path, host를 받지 않습니다. 실행 가능한 pickle은 서버가 코드 안에서 생성하며 shell, 파일 접근, subprocess, socket 또는 외부 네트워크를 호출하지 않습니다.

다음 secret은 각기 다른 환경값으로 생성됩니다.

- `SESSION_ENGINE_TOKEN`: coordinator와 internal engine 사이 인증
- `SESSION_LAB_CLIENT_SECRET`: 취약한 교육용 OAuth/session 역할 재사용 모델
- `SESSION_SIGNING_SECRET`: 패치 후 독립 session signing key
- `SESSION_PROOF`: bounded timing probe의 내부 marker

의도적으로 취약한 lab client secret이 engine token이나 patched signing secret 역할을 겸하면 안 됩니다. 공개 API와 container log는 이 네 값을 반환하거나 출력해서는 안 됩니다.

## Container controls

Compose 정의는 서비스별로 가능한 범위에서 다음 제한을 사용합니다.

- 비권한 UID/GID
- read-only root filesystem
- Linux capability 전체 제거
- `no-new-privileges`
- PID, CPU, memory, file-descriptor, file-size 제한
- 필요한 서비스에 한정한 작은 `noexec,nosuid,nodev` tmpfs
- host mount와 Docker socket 미사용
- engine network의 `internal: true`
- engine host port 미공개

이 통제의 실제 적용 여부는 배포 전 `docker compose config`, container inspect, network inspect로 확인해야 합니다. 문서만으로 특정 Docker Desktop·Linux kernel·ingress 환경의 격리를 보증할 수 없습니다.

## Difficulty boundary

`BEGINNER`와 `ADVANCED`는 보안 엔진이나 정답을 분기하지 않습니다. 두 난이도는 같은 canonical choice와 같은 adjudicator를 사용하며, beginner response에만 추가 annotation과 설명을 제공합니다.

서로 다른 난이도에 서로 다른 취약 payload나 완화된 판정 규칙을 두지 않는 이유는 다음과 같습니다.

- 참가자가 보는 설명량과 실제 보안 결론을 분리합니다.
- 같은 라운드의 초급·고급 결과가 기술적으로 일치합니다.
- 난이도 파라미터를 이용한 판정 우회를 막습니다.

서버는 `scenarioId`와 `difficulty`를 enum으로 검증하고 참가자가 라운드에 들어간 뒤 해당 값을 고정합니다. 같은 device의 reconnect는 최초 선택을 유지합니다.

## Round and action integrity

- 현재 판 입장은 처음 15초에만 열립니다.
- JOIN 종료 뒤 참가자는 선택한 scenario의 다음 cohort에만 들어갑니다.
- scenario cohort 사이에서 action과 결과를 공유하지 않습니다.
- 한 명이면 `FULL_STACK`으로 모든 RED/BLUE task를 직접 제출합니다.
- 미응답 task를 숨은 기본값으로 채우지 않습니다.
- action은 round, phase, player assignment, task choice allowlist에 묶입니다.
- idempotency ID 재전송은 같은 결과를 반환하고, 첫 확정 choice를 다른 값으로 바꾸지 않습니다.

이 규칙은 게임 판정의 일관성을 위한 것이며 악의적인 클라이언트에 대한 강한 신원 인증은 아닙니다.

## Secrets and participant data

- `.runtime/booth.env`는 로컬에서 생성되며 Git에 포함하지 않습니다.
- proof, engine token, lab secret, bearer token을 공개 API나 log에 기록하지 않아야 합니다.
- 이름, 이메일, 계정 입력을 받지 않습니다.
- 익명 callsign은 서버에서 생성합니다.
- browser device ID는 `localStorage`, bearer participant token은 `sessionStorage`에 보관합니다.
- in-memory session은 제한된 TTL 뒤 만료됩니다.

device ID는 refresh와 duplicate tab의 reconnect를 위한 client-controlled 값입니다. 인증 요소나 지속적인 개인 식별자로 취급하면 안 됩니다. site data 삭제 또는 새 browser profile은 새 ID를 만듭니다.

reverse proxy, CDN, Docker, hosting provider는 별도 access log를 남길 수 있습니다. 실제 설정을 감사하기 전에는 IP address를 수집하지 않는다고 주장할 수 없습니다.

## Capacity and abuse boundary

coordinator는 짧은 join rate limit와 전역 round capacity를 적용합니다. scenario를 나누어도 capacity는 전체 cohort 합계에 적용되어야 합니다. 이 통제는 우발적인 중복과 과부하를 줄일 뿐 Sybil 방어가 아닙니다.

행사 배포에서는 다음 통제가 별도로 필요합니다.

- 검토된 참가자 전용 network 또는 HTTPS ingress
- ingress의 connection/request rate limit
- 실제 AP·reverse proxy·방화벽을 포함한 mobile 사전 점검
- 관전자 화면의 현재/다음 판 capacity 모니터링
- 문제 발생 시 정확한 Compose project만 재시작할 운영 절차

악의적 multi-ID 참가자가 여러 slot을 소진하는 것을 application device ID만으로 완전히 막을 수 없습니다.

## Source and claim boundary

Session Heist의 교육적 흐름은 [Simon Koeck의 공개 write-up](https://simonkoeck.com/writeups/google-devsite-flask-session-pickle-rce)을 참고했습니다. `$90,000`은 연구자가 `$75,000`에 `1.2` multiplier가 적용됐다고 설명한 값입니다.

- 이 저장소는 원 사건의 보상 기록을 독립 검증하지 않았습니다.
- 해당 사례를 CVE로 표기하지 않습니다.
- 게임은 실제 Google host, account, OAuth credential 또는 production code를 사용하지 않습니다.
- 교육용 모델의 동작을 원 서비스의 현재 상태에 대한 증거로 사용하면 안 됩니다.

Proxy Panic도 교육용 trust-boundary 모델이며 특정 상용 제품 배포를 재현한다고 주장하지 않습니다.

## Deployment and cleanup

기본 공개 주소는 loopback입니다. 다중 device 부스에서는 참가자 device가 실제로 접근 가능한 검토된 `PUBLIC_BASE_URL`을 사용하고, engine network나 host/Docker socket mount를 publish하지 마세요.

`npm run down`은 명명된 운영 Compose project만 종료합니다. `npm run verify`는 실행별 고유 project·image·runtime env를 사용하고 성공·실패 시 해당 scope만 정리하도록 구성되어 있습니다. broad `docker system prune`은 이 프로젝트의 정상 cleanup 절차가 아닙니다.

Compose interpolation에 영향을 주는 ambient 환경값은 선택된 runtime env와 충돌하지 않도록 도구에서 제거합니다. 실제 secret set과 network binding은 기동 전 rendered Compose config로 확인하세요.

## Reporting

공개 issue에 다음 값을 포함하지 마세요.

- `.runtime/booth.env` 내용
- runtime proof 또는 lab secret
- engine token 또는 participant bearer token
- 실제 행사장 내부 주소·access log

보고에는 영향받은 public route, 기대 동작, 관찰 동작, 재현 단계, redacted evidence만 포함하세요.
