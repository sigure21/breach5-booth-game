# BREACH//5

**최대 3분 안에 증거를 읽고, 요청을 조립하고, 패치를 검증하라.**

`BREACH//5`는 플래그 문자열을 찾는 CTF가 아니라 OWASP Korea 2026 부스용 모바일 RED vs BLUE 보안 게임입니다. 참가자는 QR로 입장한 뒤 사건과 난이도를 직접 고르고, Raw HTTP·로그·코드·diff를 근거로 allowlist 카드만 조합합니다. 서버는 선택을 격리된 교육용 엔진에 전달하고, 원본 공격·변형 공격·정상 요청의 실제 회귀 결과를 보여줍니다.

## 시나리오

### 1. Proxy Panic — 두 명의 경비원

Gateway가 검사한 canonical path와 Worker가 실행에 사용한 raw path가 다른 상황을 추적합니다.

```text
percent decode / dot-segment 정규화
→ Gateway allowlist 통과
→ Worker가 raw prefix 재사용
→ shell command substitution
→ 격리된 safe proof
```

참가자는 Gateway·Worker 로그에서 parser differential을 찾고, 실제 request-target을 조립한 뒤 문자열 blacklist와 근본 패치를 원본·backtick 변형·정상 bootstrap으로 비교합니다. 이 시나리오는 교육용으로 새로 구성한 모델이며 특정 제품 취약점의 재현을 주장하지 않습니다.

### 2. Session Heist — `$90K` 사례

[Simon Koeck의 공개 write-up](https://simonkoeck.com/writeups/google-devsite-flask-session-pickle-rce)을 바탕으로 다음 trust chain을 축소 모델링합니다.

```text
읽을 수 있는 signed Flask session
→ zlib / Base64URL / TaggedJSON decode
→ pickled OAuth flow의 client_secret 관찰
→ OAuth secret과 session signing key의 역할 재사용
→ 회수 secret만 사용한 별도 공격자 signer로 세션 위조
→ 취약 서버 signer가 위조 쿠키를 검증
→ state와 flow key가 일치하는 flow lookup
→ callback의 unsafe pickle load
→ STACK_GLOBAL/REDUCE가 Python callable과 인자를 결정
→ 실제 bounded callable 실행으로 RCE primitive 확인
```

`$90,000`은 해당 연구자가 write-up에서 설명한 `$75,000 × 1.2` 보상 주장입니다. 이 저장소가 독립적으로 보상액을 검증했다는 뜻이 아니며, 이 사례를 CVE로 표기하지 않습니다. 게임은 `devsite-lab.invalid`라는 가상 호스트만 표시하고 실제 Google 호스트에 요청하지 않습니다.

Evidence Deck의 쿠키·TaggedJSON·pickletools 출력은 참가자가 직접 디코딩할 수 있는 완전한 공개 demo fixture입니다. 여기에 표시된 demo credential은 런타임 secret이 아닙니다. 실제 판정 엔진은 매 기동 시 별도로 생성된 lab secret으로 같은 구조를 다시 만들며, 그 값과 forged cookie bytes는 공개 API에 반환하지 않습니다.

판정 엔진은 쿠키에서 정적으로 회수한 secret만 넣은 별도 공격자 signer로 forged session을 만들고, 취약 서버 signer가 이를 실제 수락한 뒤 callback의 `pickle.loads()`까지 연결합니다. 이어 서버 소유 `time.sleep(0.05)` callable이 실제 호출되고, no-cookie·변조 서명·wrong-key·wrong-state·missing-flow·정상 flow 대조군까지 모두 일치해야만 `RCE primitive CONFIRMED`를 반환합니다. 원 사건에서는 이 pickle 위치가 원격 세션의 제어를 받았지만, 이 lab은 같은 sink에 서버 소유 safe payload만 대입해 primitive를 검증합니다. OS 명령·파일·subprocess·socket은 실행하지 않습니다.

## 난이도

입장 전에 시나리오와 난이도를 모두 선택해야 합니다.

| 구분 | 초급 · Guided | 고급 · Analyst |
|---|---|---|
| 증거 | 중요한 줄의 짧은 주석 제공 | 원문 artifact 중심 |
| 요청 조립 | 선택지의 기술적 의미와 영향 설명 | 리터럴 token·Raw HTTP 중심 |
| 실패 근거 | 어떤 증거와 모순되는지 설명 | 정제된 엔진 결과 중심 |
| 패치 | diff와 보안 효과를 함께 표시 | diff와 회귀 행렬 중심 |
| 판정 | 실제 시나리오 엔진 | 초급과 동일한 엔진·정답 |

난이도에 따라 취약점, 정답 ID, 엔진 판정이 달라지지 않습니다. 초급은 근거를 더 설명하고 고급은 같은 증거를 덜 해설할 뿐입니다.

## 플레이 규칙

- 첫 15초 `JOIN` 구간에서만 현재 판에 들어갈 수 있습니다.
- `JOIN` 종료 뒤 스캔한 참가자는 선택한 시나리오의 다음 판에 배치됩니다. 증거를 건너뛰는 중간 난입은 없습니다.
- 한 명만 참가하면 `FULL_STACK` 모드로 RED 공격과 BLUE 패치를 모두 수행합니다. 부재한 팀의 숨은 기본 선택은 사용하지 않습니다.
- 두 명 이상이면 RED/BLUE로 균형 배정하고, 각 기술 과제를 팀원에게 한 번씩 분배합니다.
- 필수 응답이 끝나고 최소 노출 시간이 지나면 즉시 다음 단계로 이동합니다. 아래 시간은 기다려야 하는 시간이 아니라 단계별 최대 제한입니다.
- 미응답 과제는 자동 정답이나 임의 선택으로 대체하지 않고 `incomplete_submission`으로 판정합니다.
- 브라우저는 raw path, cookie, pickle, 명령을 직접 제출할 수 없습니다. 서버가 검증한 semantic choice ID만 받습니다.

## 최대 180초 흐름

| 최대 구간 | Phase | 참가자 활동 |
|---:|---|---|
| 0:00–0:15 | JOIN | 시나리오·난이도 선택, 익명 입장 |
| 0:15–0:23 | BRIEF | 사건과 목표 확인 |
| 0:23–0:48 | DISCOVER | 독립 증거에서 trust boundary 식별 |
| 0:48–1:28 | BUILD | 실제 요청·session chain과 1차 control 조립 |
| 1:28–1:43 | EXECUTE | 취약 엔진 판정과 음성 대조 확인 |
| 1:43–2:18 | DUEL | 변형 공격과 실제 patch diff 선택 |
| 2:18–2:43 | REVERIFY | 원본·variant·normal 회귀 검증 |
| 2:43–3:00 | RESULT | 원인, 증거, 차단 결과 정리 |

빠르게 근거를 찾은 참가자는 최대 시간을 모두 기다리지 않습니다. 다음 판의 전역 경계는 서버 기동 시점부터 180초 간격으로 유지하므로 late join 배치는 예측 가능합니다. 상세 계약은 [3분 상호작용 문서](docs/THREE_MINUTE_FLOW.md)를 참고하세요.

## 빠른 실행

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
- 관전자 화면: `http://127.0.0.1:18090/screen`

`npm run up`은 정적·단위 검사를 실행하고, `.runtime/booth.env`에 서로 독립적인 내부 토큰과 lab secret을 생성한 뒤 Compose 스택을 기동합니다. 첫 판은 coordinator가 시작될 때 `JOIN`으로 시작합니다.

## 전체 검증

```bash
npm run verify
```

이 명령은 별도 Compose 프로젝트와 가속 라운드를 사용해 다음 계약을 검사하도록 구성되어 있습니다.

- 두 시나리오 catalog와 초급/고급 입장 계약
- reconnect 고정, global capacity, late join, 1인 `FULL_STACK`, 2인 이상 팀 분배
- evidence 기반 allowlist 선택과 phase-bound action
- Proxy Panic 원본·backtick·정상 bootstrap 회귀
- Session Heist 서명·state·flow·실제 bounded callable·RCE primitive 판정과 완전 패치 회귀
- 브라우저·공개 API·컨테이너 로그의 runtime secret 비노출
- 내부 네트워크, 비권한 사용자, read-only filesystem 등 Compose 격리
- 검증 프로젝트·네트워크·이미지의 scoped cleanup

검증 명령이 특정 환경에서 실제로 통과했는지는 그 실행 결과를 확인해야 합니다. 문서만으로 현재 Docker 또는 행사장 네트워크 상태를 보증하지 않습니다.

## 운영 명령

| 명령 | 기능 |
|---|---|
| `npm run up` | 검사 후 최대 3분 운영 스택 시작 |
| `npm run verify` | 가속된 Docker live contract 실행 후 scoped cleanup |
| `npm run status` | 운영 컨테이너 상태 확인 |
| `npm run logs` | 최근 운영 로그 확인 |
| `npm run down` | 이 저장소의 운영 Compose 스택만 종료 |
| `npm run reset` | 운영 스택 종료 후 runtime 비밀값 재생성 |
| `npm run doctor` | Node, Docker, Compose 및 구성 확인 |

`down`과 `verify`는 지정된 Compose 프로젝트만 정리하며 broad Docker prune을 실행하지 않습니다.

## 실제 휴대폰 연결

기본값은 `127.0.0.1` 바인딩이므로 다른 휴대폰에서 접근할 수 없습니다. 검증된 참가자망에서 시험할 때는 `.runtime/booth.env`의 secret을 그대로 두고 다음 비밀값이 아닌 설정만 변경합니다.

```dotenv
BREACH5_BIND=0.0.0.0
BREACH5_PORT=18090
PUBLIC_BASE_URL=http://192.0.2.10:18090
```

`192.0.2.10`은 문서용 예시 주소입니다. 실제 PC의 검증된 주소로 바꾼 뒤 기존 secret을 유지한 채 스택을 다시 시작합니다.

```bash
npm run down
npm run up
```

QR과 관전자 화면은 모두 `PUBLIC_BASE_URL`에서 `/play` 주소를 만듭니다. 실제 행사에서는 검토된 HTTPS ingress 또는 참가자 전용 네트워크를 사용하고, AP·방화벽·reverse proxy 정책을 사전에 확인해야 합니다. 네트워크 실측 전에는 모바일 접근성과 회전율을 확정할 수 없습니다.

## 구조

```text
휴대폰 /play ─┐
관전자 /screen ──> game coordinator
                      ├─ proxy-panic adjudicator
                      │    ├─ vulnerable gateway ─> vulnerable worker
                      │    └─ patched gateway ────> patched worker
                      └─ session-heist adjudicator
                           └─ internal Python session engine
```

- 외부에 publish되는 서비스는 coordinator 하나뿐입니다.
- Proxy와 Session 엔진은 서로 분리된 internal Docker network에 있습니다.
- Session 엔진은 서버가 만든 lab cookie와 pickle만 처리하고, 50ms로 제한된 로컬 callable proof만 실행합니다.
- Session 엔진은 실제 OAuth 교환, 외부 callback, shell, 파일 읽기, 외부 네트워크를 사용하지 않습니다.
- OAuth 역할의 lab secret, patched signing secret, engine token, proof marker는 독립 생성됩니다.
- 공개 API에는 secret 값이 아니라 boolean 판정과 정제된 trace만 반환됩니다.

구체적인 위협 경계와 잔여 위험은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 익명 참가와 한계

- 브라우저는 임의의 128-bit device ID를 `localStorage`에 보관하고, 참가 bearer token은 `sessionStorage`에만 보관합니다.
- 같은 device의 새로고침·중복 탭은 최초 시나리오와 난이도를 유지한 채 같은 참가자로 재연결됩니다.
- device ID는 인증 수단이나 강한 개인 식별자가 아닙니다. 저장소 삭제나 새 브라우저 프로필로 새 ID를 만들 수 있습니다.
- 애플리케이션 join 제한과 정원은 우발적 중복을 줄이지만 악의적 multi-ID 소진을 막는 Sybil 방어가 아닙니다.
- reverse proxy, CDN, Docker 또는 호스팅 환경은 별도 access log를 남길 수 있으므로 실제 운영 설정을 감사해야 합니다.

## 라이선스

MIT. npm 의존성과 Proxy Panic 설계 계보 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요. Python package license는 설치된 package metadata와 각 upstream 고지를 별도로 확인해야 합니다.
