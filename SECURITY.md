# Security model

`BREACH//5: NITRO GRID`는 실제 공격을 실행하는 CTF 엔진이 아니라 보안 판단을 연습하는 모바일 퀴즈 게임입니다.

## 신뢰 경계

- 공개 HTTP 표면: `/play`, `/screen`, allowlist된 정적 자산과 `/api/*`
- 서버 소유 상태: 익명 참가 토큰, 라운드 덱, 제출 기록, 점수
- 비밀값: `.runtime/booth.env`의 `NITRO_GRID_SEED_SECRET`
- 외부 미디어: 저장소에 출처와 함께 포함된 애니메이션 패널

브라우저는 `trackId`, `difficulty`, `crewId`, `driverId`, 현재 공개된 `task`와 그 task의 `choice`만 제출할 수 있습니다. 임의 코드, URL, 파일 경로, 명령 또는 템플릿은 받지 않습니다.

## 서버 판정

- 문제 덱은 서버 HMAC으로 결정되며 `Math.random()`에 의존하지 않습니다.
- 제출 전 API에는 `correctOptionId`, 정답 해설 또는 결과 review가 포함되지 않습니다.
- 답변은 현재 phase에 공개된 task와 그 task의 allowlist 선택지에 한해 1회 저장됩니다.
- `actionId`는 참가자별 멱등성 키입니다. 동일 본문의 재전송은 최초 판정을 그대로 재생하고, 같은 키를 다른 task/choice에 재사용하면 거부합니다.
- 재접속 시 최초 팀·선수·서킷·난이도와 덱이 유지됩니다.

정답은 비밀 플래그가 아닙니다. 문제은행은 교육 콘텐츠이므로 저장소 소스에서 읽을 수 있습니다. 행사 중 브라우저 API가 조기 노출하지 않는 것이 위협 경계입니다.

## 컨테이너 경계

기본 Compose는 서비스 하나만 실행합니다.

- 비권한 `node` 사용자
- read-only root filesystem
- 모든 Linux capability 제거
- `no-new-privileges`
- PID, 파일 크기, 메모리, CPU 제한
- Docker socket과 host mount 없음
- 기본 publish 주소 `127.0.0.1`

운영자가 `BREACH5_BIND=0.0.0.0`으로 변경하면 참가자망의 모든 호스트에서 포트에 접근할 수 있습니다. 행사 AP, 방화벽, reverse proxy 및 HTTPS 종료 정책은 저장소 밖 운영 책임입니다.

## 익명 세션의 한계

- `deviceId`는 128-bit 임의값이지만 인증이나 사람 식별 수단이 아닙니다.
- 참가 bearer token은 `sessionStorage`, device ID는 `localStorage`에 저장됩니다.
- 슬라이딩 세션 TTL은 해당 라운드 보관 만료를 넘을 수 없고, 정상 UI는 `COMPLETE` 이후 상태 polling을 중단합니다.
- 결과 화면에서 사용자가 재도전을 명시하면 기존 재접속용 device ID를 버리고 새 ID로 다음 그리드에 예약합니다.
- 새 브라우저 프로필이나 저장소 삭제로 새 ID를 만들 수 있어 악의적 정원 소진을 막지 못합니다.
- 이름, 이메일, 전화번호를 받지 않지만 reverse proxy나 플랫폼은 별도 access log를 남길 수 있습니다.

## 미디어

미디어 파일은 실행 가능한 콘텐츠로 처리하지 않으며 정적 allowlist 경로로만 제공합니다. 출처와 운영 주체의 권리 전제는 `docs/MEDIA_SOURCES.md`에 기록합니다. 이 저장소는 Formula 1, EA, 각 팀 또는 선수의 공식 승인·제휴를 주장하지 않습니다.

## 신고

보안 문제를 공개 issue로 재현하기 전에 저장소 소유자에게 비공개로 알려 주세요. 보고에는 영향 받는 commit, 재현 단계, 기대 동작, 실제 동작과 최소 PoC를 포함해 주세요. 실제 제3자 시스템에 대한 테스트는 이 프로젝트 범위가 아닙니다.
