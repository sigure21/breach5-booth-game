// 14 security topics x 5 decision modes = 70 paired questions.
// Combined with the original 30 concepts, this gives 100 playable variants per difficulty.

const STAGE_BY_MODE = Object.freeze({
  triage: 'LAUNCH', prevent: 'SECTOR', respond: 'PIT', verify: 'SPRINT', monitor: 'SECTOR',
});
const TIER_BY_MODE = Object.freeze({
  triage: 'FOUNDATION', prevent: 'APPLIED', respond: 'APPLIED', verify: 'ANALYST', monitor: 'ANALYST',
});
const TRACKS = Object.freeze({
  IDENTITY: Object.freeze(['human-firewall']),
  DEVICE: Object.freeze(['human-firewall', 'secure-builder']),
  WEB_APP: Object.freeze(['secure-builder']),
  CLOUD_SUPPLY: Object.freeze(['secure-builder']),
  INCIDENT: Object.freeze(['human-firewall']),
});
const MODE_PROMPTS = Object.freeze({
  triage: Object.freeze({
    BEGINNER: (topic) => `${topic} 상황에서 관찰된 증거가 의미하는 핵심 위험이나 원인은?`,
    ADVANCED: (topic) => `${topic} 공격 흐름의 성립 여부를 가르는 신뢰 경계 위반은 무엇인가?`,
  }),
  prevent: Object.freeze({
    BEGINNER: (topic) => `${topic} 사고를 재발하지 않게 만드는 가장 직접적인 예방 통제는?`,
    ADVANCED: (topic) => `${topic}의 공격 전제 자체를 제거하는 우선 완화책은 무엇인가?`,
  }),
  respond: Object.freeze({
    BEGINNER: (topic) => `${topic} 징후가 확인된 직후 가장 적절한 초동 대응은?`,
    ADVANCED: (topic) => `${topic} 문제가 확인된 직후 영향을 제한하고 근거를 보존하는 조치는?`,
  }),
  verify: Object.freeze({
    BEGINNER: (topic) => `${topic} 수정이 실제로 작동한다는 가장 강한 확인 방법은?`,
    ADVANCED: (topic) => `${topic} 통제·변경의 유효성을 입증할 양성·음성 대조 검증은 무엇인가?`,
  }),
  monitor: Object.freeze({
    BEGINNER: (topic) => `${topic} 재발을 가장 빨리 알아차릴 수 있는 관찰 항목은?`,
    ADVANCED: (topic) => `${topic} 탐지에서 단일 신호 오탐을 줄이면서 공격 사슬을 포착할 상관 규칙은?`,
  }),
});

const r = (title, url) => Object.freeze({ title, url });
const topic = (definition) => Object.freeze({
  ...definition,
  references: Object.freeze(definition.references),
  BEGINNER: Object.freeze({ ...definition.BEGINNER, evidence: Object.freeze(definition.BEGINNER.evidence), actions: Object.freeze(definition.BEGINNER.actions), wrongs: Object.freeze(definition.BEGINNER.wrongs) }),
  ADVANCED: Object.freeze({ ...definition.ADVANCED, evidence: Object.freeze(definition.ADVANCED.evidence), actions: Object.freeze(definition.ADVANCED.actions), wrongs: Object.freeze(definition.ADVANCED.wrongs) }),
});

const TOPICS = Object.freeze([
  topic({
    id: 'oauth-pkce', category: 'IDENTITY', name: 'OAuth 코드 흐름과 PKCE',
    BEGINNER: {
      context: '모바일 로그인 뒤 인증 코드가 설치한 적 없는 앱의 링크 처리기로 전달됐다.',
      evidence: { triage: '낯선 앱이 같은 계정으로 연결됨', prevent: '모바일 앱은 클라이언트 비밀을 안전하게 보관할 수 없음', respond: '낯선 앱 세션과 갱신 토큰이 활성 상태', verify: '정상 앱과 공격 앱의 코드 교환을 각각 재현 가능', monitor: '코드 발급 기기와 교환 기기가 다름' },
      actions: { risk: '인증 코드가 공격 앱에 가로채져 토큰으로 교환될 수 있다', prevent: 'S256 PKCE와 정확한 리디렉션 URI 검증을 적용한다', respond: '의심 토큰 계열을 폐기하고 연결된 세션을 조사한다', verify: '정상 verifier만 성공하고 틀린 verifier·재사용은 거부되는지 시험한다', monitor: '코드 발급 기기와 교환 기기의 불일치를 경보한다' },
      wrongs: ['로그인 화면 색상만 바꾼다', '클라이언트 ID를 비밀처럼 숨긴다', '오류 로그를 삭제한다'],
      takeaway: '모바일·SPA OAuth에는 S256 PKCE와 엄격한 리디렉션 검증이 필요합니다.',
    },
    ADVANCED: {
      context: 'public client가 고정 redirect URI를 쓰지만 code_challenge 없이 authorization code를 교환한다.',
      evidence: { triage: 'code issued to client=A; token redeemed by device=B; PKCE absent', prevent: 'grant_type=authorization_code; code_challenge_method missing', respond: 'refresh-token family active after suspicious redemption', verify: 'S256 valid control vs wrong-verifier and replay negative controls', monitor: 'authorization device_id != token device_id; verifier telemetry absent' },
      actions: { risk: 'PKCE 없는 public-client code는 탈취자가 token으로 교환할 수 있다', prevent: 'code를 S256 verifier·정확한 redirect_uri에 결속한다', respond: 'token family를 폐기하고 authorization·token 로그를 보존한다', verify: 'valid verifier만 성공하고 wrong·replay는 거부되는지 시험한다', monitor: 'grant별 client·redirect_uri·device 불일치를 상관한다' },
      wrongs: ['consent UI 테마만 교체한다', '번들에서 public client_id를 난독화한다', 'token endpoint 실패 로그 수집을 중단한다'],
      takeaway: 'authorization code를 verifier와 redirect URI에 결속하고 grant 전 구간을 상관 분석합니다.',
    },
    references: [r('RFC 9700 OAuth 2.0 Security BCP', 'https://www.rfc-editor.org/rfc/rfc9700.html'), r('RFC 7636 PKCE', 'https://www.rfc-editor.org/rfc/rfc7636.html')],
  }),
  topic({
    id: 'api-bola', category: 'WEB_APP', name: 'API 객체 권한(BOLA)',
    BEGINNER: {
      context: '내 주문 URL의 숫자를 바꾸자 다른 고객의 주소와 주문이 보였다.',
      evidence: { triage: '주문 4012를 4013으로 바꾸자 타인 데이터가 200으로 응답', prevent: '로그인은 확인하지만 주문 소유자는 확인하지 않음', respond: '한 계정이 여러 고객 주문을 순차 조회', verify: '본인 주문과 타인 주문 요청을 나눠 시험 가능', monitor: '짧은 시간에 순차 주문 번호 수백 개 조회' },
      actions: { risk: '로그인만 확인하고 객체 주인을 확인하지 않아 타인 정보가 노출된다', prevent: '모든 객체 조회·수정에서 서버가 소유권과 권한을 검사한다', respond: '악용 계정을 차단하고 조회 범위와 노출 데이터를 조사한다', verify: '본인 객체는 허용하고 타인 객체는 거부되는 대조 시험을 한다', monitor: '순차 ID 조회와 소유권 불일치를 함께 경보한다' },
      wrongs: ['주문 번호를 더 긴 숫자로 바꾼다', '프런트엔드에서 타인 주문 버튼만 숨긴다', '응답 필드 이름만 줄인다'],
      takeaway: 'API는 로그인 여부뿐 아니라 요청한 객체의 소유권과 권한을 매번 확인해야 합니다.',
    },
    ADVANCED: {
      context: 'GET /api/orders/{id}가 JWT subject와 object.owner를 비교하지 않는다.',
      evidence: { triage: 'sub=user-A; object.owner=user-B; response=200', prevent: 'route authn=true; object-level authz=false', respond: 'principal scanned 800 object IDs; token still valid', verify: 'owner=200; peer/cross-tenant expected 403 or 404', monitor: 'ownership mismatch plus enumeration velocity' },
      actions: { risk: 'subject·object.owner 불일치를 허용한 객체 권한 결함이다', prevent: 'subject·tenant·action·resource를 정책 계층에서 평가한다', respond: '토큰을 폐기하고 access trail로 tenant 간 노출을 산정한다', verify: 'owner는 허용하고 peer·cross-tenant는 거부되는지 시험한다', monitor: 'principal·tenant·owner·응답량·ID 열거를 상관한다' },
      wrongs: ['순차 ID를 UUID로만 교체한다', 'React 라우트 가드만 추가한다', 'JSON 키를 난독화한다'],
      takeaway: 'subject-action-resource-tenant 정책을 중앙에서 강제하고 권한 행렬로 음성 대조 검증합니다.',
    },
    references: [r('OWASP API1:2023 BOLA', 'https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/')],
  }),
  topic({
    id: 'api-abuse', category: 'WEB_APP', name: 'API 자동화 남용과 속도 제한',
    BEGINNER: {
      context: '한 계정이 1분에 인증 코드 요청을 수천 번 받아 알림이 마비됐다.',
      evidence: { triage: '같은 계정에 인증 코드 2,000건', prevent: '요청 제한과 점진 지연이 없음', respond: '자동화 요청이 현재도 계속됨', verify: '정상 사용자와 봇 트래픽을 나눠 재현 가능', monitor: '여러 IP가 한 계정을 동시에 호출' },
      actions: { risk: '분산 IP를 이용한 인증 코드 폭탄·계정 추측 자동화다', prevent: '계정·IP·기기 제한과 점진 지연·재인증을 함께 적용한다', respond: '요청을 제한하고 대상 계정과 세션을 보호한다', verify: '정상 요청은 통과하고 폭주·분산 요청은 제한되는지 시험한다', monitor: '계정별 속도·기기 교체·IP 분산을 함께 본다' },
      wrongs: ['응답 문구만 천천히로 바꾼다', '첫 IP 하나만 영구 차단한다', '로그를 끈다'],
      takeaway: '남용 방지는 IP뿐 아니라 계정·기기·행동 기준과 정상 사용자 보호를 함께 봅니다.',
    },
    ADVANCED: {
      context: 'credential endpoint가 principal·IP·device별 예산 없이 수평 확장된다.',
      evidence: { triage: 'account=U1; requests=2000/min; IP fan-out=450', prevent: 'rate_limit_key=IP only; distributed bypass observed', respond: 'campaign active; token bucket unconfigured', verify: 'burst·sustained·rotating-IP profiles available', monitor: 'principal velocity + device churn + ASN spread' },
      actions: { risk: 'principal 중심 예산이 없어 IP 회전으로 제어를 우회한다', prevent: 'principal·device·network별 quota와 risk step-up을 결합한다', respond: 'campaign을 제한하고 영향 principal의 세션을 검토한다', verify: 'burst·지속·IP 회전 quota와 Retry-After를 시험한다', monitor: 'principal 속도와 ASN·device 분산을 시간창으로 상관한다' },
      wrongs: ['429 문구만 추가하고 quota는 적용하지 않는다', '첫 source IP만 denylist에 넣는다', 'abuse telemetry sampling을 0으로 만든다'],
      takeaway: '다차원 quota와 위험 기반 step-up을 적용하고 분산 우회 프로파일로 검증합니다.',
    },
    references: [r('OWASP API4:2023 Resource Consumption', 'https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/')],
  }),
  topic({
    id: 'file-upload', category: 'WEB_APP', name: '파일 업로드 경계',
    BEGINNER: {
      context: '프로필 사진으로 image.php.jpg를 올리자 웹 주소에서 서버 코드로 실행됐다.',
      evidence: { triage: '확장자는 jpg지만 실제 내용은 서버 스크립트', prevent: '파일 이름과 브라우저 형식만 확인', respond: '업로드 주소에 낯선 명령 요청 발생', verify: '정상 이미지와 위장 파일을 각각 업로드 가능', monitor: '업로드 직후 같은 객체에서 실행 요청' },
      actions: { risk: '사용자 파일이 서버 코드로 실행될 수 있다', prevent: '내용을 검사·재인코딩하고 실행 불가 저장소에 새 이름으로 보관한다', respond: '업로드 경로를 격리하고 실행 흔적과 파생 접근을 조사한다', verify: '정상 이미지는 표시되고 위장·다중확장 파일은 실행 없이 거부되는지 시험한다', monitor: '업로드 직후 객체 접근과 서버 프로세스 생성을 연결한다' },
      wrongs: ['파일 이름 끝에 .safe를 붙인다', '브라우저 Content-Type만 믿는다', '목록 화면에서 파일만 숨긴다'],
      takeaway: '업로드 파일은 실제 내용을 검증하고 실행할 수 없는 위치에 저장해야 합니다.',
    },
    ADVANCED: {
      context: 'multipart Content-Type만 검사하고 업로드 디렉터리가 실행 가능한 web root다.',
      evidence: { triage: 'client MIME=image/jpeg; magic=PHP; execution=enabled', prevent: 'validation=extension; storage=/var/www/uploads', respond: 'uploaded object received command-like queries', verify: 'polyglot·MIME mismatch·parser bomb controls available', monitor: 'upload event -> executable response -> child process' },
      actions: { risk: 'MIME 신뢰와 실행 저장소가 위장 파일을 RCE로 연결한다', prevent: '허용 디코더로 정규화하고 비실행 object storage에 둔다', respond: '제공을 차단하고 hash·access log·process tree로 범위를 산정한다', verify: 'polyglot·MIME 불일치·이중 확장·parser bomb을 음성 시험한다', monitor: 'object hash·uploader·응답·process ancestry를 상관한다' },
      wrongs: ['원본 이름을 UUID로만 치환한다', 'multipart 헤더 일치만 검사한다', 'directory index만 비활성화한다'],
      takeaway: '파서 기반 canonicalization, 비실행 저장 경계, 공격 샘플 회귀 검증을 결합합니다.',
    },
    references: [r('OWASP File Upload Cheat Sheet', 'https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html')],
  }),
  topic({
    id: 'path-traversal', category: 'WEB_APP', name: '경로 탐색과 파일 접근',
    BEGINNER: {
      context: '다운로드 이름에 ../를 넣자 서비스 설정 파일이 내려왔다.',
      evidence: { triage: 'file=../../config.env 요청이 200', prevent: '사용자 파일 이름을 경로에 직접 연결', respond: '여러 상위 폴더 파일이 조회된 로그', verify: '정상 보고서와 ../ 입력을 비교 가능', monitor: '인코딩된 점·슬래시 조합 반복' },
      actions: { risk: '허용 폴더 밖의 비밀 파일을 읽을 수 있다', prevent: '파일 ID를 서버 목록에 매핑하고 정규화 뒤 허용 루트 내부인지 확인한다', respond: '기능을 제한하고 접근 파일과 노출 비밀을 조사·회전한다', verify: '정상 파일만 성공하고 ../·인코딩·심볼릭 링크는 거부되는지 시험한다', monitor: '정규화 전후 경로 차이와 민감 파일 응답을 경보한다' },
      wrongs: ['../ 문자열 한 번만 지운다', '오류 메시지만 숨긴다', '파일 이름을 길게 만든다'],
      takeaway: '사용자 입력을 경로로 직접 연결하지 말고 허용 목록과 정규화된 루트 검사를 사용합니다.',
    },
    ADVANCED: {
      context: 'decode 후 canonical path가 허용 root 밖인데 문자열 prefix 검사만 통과한다.',
      evidence: { triage: 'raw=%252e%252e%252f; second decode=../; path escapes root', prevent: 'startsWith check occurs before canonicalization', respond: 'responses contained secrets and key material', verify: 'double encoding·mixed separator·symlink controls available', monitor: 'decode anomaly + canonical root escape + sensitive response' },
      actions: { risk: '다중 디코딩·정규화 순서 차이로 root confinement가 우회된다', prevent: '단일 정규화 후 descriptor allowlist로 root 밖 접근을 막는다', respond: 'endpoint를 격리하고 노출 범위 산정 후 자격 증명을 폐기한다', verify: '이중 인코딩·혼합 구분자·symlink race의 root 탈출을 시험한다', monitor: 'raw input·decode 수·resolved inode·허용 root를 기록한다' },
      wrongs: ['raw URL에서 첫 ../만 replace한다', '404 메시지만 일반화한다', 'download token 길이만 늘린다'],
      takeaway: '검사와 사용이 동일 canonical 객체를 사용하며 인코딩·symlink·경합 음성 대조를 거쳐야 합니다.',
    },
    references: [r('OWASP Path Traversal', 'https://owasp.org/www-community/attacks/Path_Traversal')],
  }),
  topic({
    id: 'cloud-iam', category: 'CLOUD_SUPPLY', name: '클라우드 IAM 최소 권한',
    BEGINNER: {
      context: '이미지 변환 함수가 모든 저장소와 관리자 작업 권한을 갖고 있다.',
      evidence: { triage: '사진 한 폴더만 필요하지만 관리자 권한 보유', prevent: '업무는 입력 읽기와 결과 쓰기뿐', respond: '낯선 지역에서 역할 사용 기록', verify: '필요 작업과 금지 작업을 각각 시험 가능', monitor: '평소 쓰지 않는 관리자 API 호출' },
      actions: { risk: '함수 침해가 계정 전체 관리자 권한으로 확대될 수 있다', prevent: '필요한 폴더·동작만 허용하고 역할을 맡을 주체도 제한한다', respond: '역할 세션을 차단하고 정책·신뢰 관계와 변경 내역을 조사한다', verify: '필요 작업은 성공하고 관리자 작업은 거부되는지 시험한다', monitor: '새 주체의 역할 사용과 평소 없는 관리자 API를 함께 경보한다' },
      wrongs: ['역할 이름에서 admin 글자만 지운다', '키를 Base64로 저장한다', '감사 로그를 끈다'],
      takeaway: '워크로드에도 필요한 리소스와 동작만 주고 역할을 맡을 주체를 제한합니다.',
    },
    ADVANCED: {
      context: 'workload role에 Action=* Resource=*가 있고 외부 계정도 조건 없이 assume할 수 있다.',
      evidence: { triage: 'policy Action=* Resource=*; trust Principal=*; ExternalId absent', prevent: 'observed actions=GetObject(input),PutObject(output)', respond: 'unknown account AssumeRole followed by IAM changes', verify: 'allowed object controls plus iam:CreateUser negative control', monitor: 'new principal + privilege API + trust-policy anomaly' },
      actions: { risk: 'wildcard 권한과 열린 trust가 confused-deputy 상승 경로를 만든다', prevent: 'action·resource를 줄이고 trust 조건·workload ID를 강제한다', respond: 'STS를 무효화하고 control-plane·data access를 재구성한다', verify: '정상 object는 허용하고 IAM·cross-account assume은 거부한다', monitor: 'AssumeRole trust와 후속 control-plane API를 세션별 상관한다' },
      wrongs: ['role display name만 service로 변경한다', 'credential material을 난독화한다', 'CloudTrail data event를 비활성화한다'],
      takeaway: 'permission·trust policy를 함께 축소하고 연합 세션부터 control plane 행동까지 상관합니다.',
    },
    references: [r('NIST SP 800-207 Zero Trust Architecture', 'https://csrc.nist.gov/pubs/sp/800/207/final')],
  }),
  topic({
    id: 'k8s-workload', category: 'CLOUD_SUPPLY', name: '컨테이너·Kubernetes 워크로드 격리',
    BEGINNER: {
      context: '웹 컨테이너가 root로 실행되고 호스트 폴더와 관리 토큰을 읽을 수 있다.',
      evidence: { triage: '웹 취약점 하나로 서버 전체 파일 접근 가능', prevent: 'root·호스트 공유·관리 토큰이 모두 불필요', respond: '컨테이너에서 낯선 호스트 파일 읽기', verify: '정상 웹 요청과 권한 상승 동작을 비교 가능', monitor: '컨테이너 쉘 뒤 호스트 경로 접근' },
      actions: { risk: '컨테이너 침해가 호스트·클러스터 전체로 확대될 수 있다', prevent: '비root·읽기 전용·최소 권한으로 실행하고 불필요한 토큰·호스트 공유를 제거한다', respond: '의심 pod를 격리하고 토큰을 폐기하며 노드·클러스터 접근을 조사한다', verify: '정상 서비스는 되고 root·hostPath·관리 API 동작은 거부되는지 시험한다', monitor: '컨테이너 쉘·호스트 마운트·API 열거를 한 세션으로 연결한다' },
      wrongs: ['컨테이너 이름만 바꾼다', '같은 설정으로 pod를 재시작한다', '대시보드에서 pod를 숨긴다'],
      takeaway: '컨테이너도 비root·최소 권한·불필요한 호스트와 토큰 접근 제거가 기본입니다.',
    },
    ADVANCED: {
      context: 'privileged pod가 hostPath /와 automounted cluster-admin service-account token을 가진다.',
      evidence: { triage: 'privileged=true; hostPath=/; SA=cluster-admin', prevent: 'required capabilities=none; API access=none', respond: 'pod exec -> host read -> secrets list', verify: 'restricted baseline plus escape negative controls', monitor: 'unexpected execve + namespace crossover + API enumeration' },
      actions: { risk: 'privileged·hostPath·cluster-admin이 control-plane을 노출한다', prevent: 'restricted Pod Security·scoped SA·seccomp를 강제한다', respond: 'pod 격리 후 SA·node를 교체하고 audit·runtime 로그를 보존한다', verify: 'admission·runtime에서 privileged·mount·token abuse를 거부한다', monitor: 'process·namespace·SA·audit verb를 workload UID로 상관한다' },
      wrongs: ['image tag 표시만 변경한다', '같은 manifest로 redeploy한다', 'namespace label만 private로 바꾼다'],
      takeaway: 'admission과 runtime 양쪽에서 workload identity·namespace·control plane 경계를 강제합니다.',
    },
    references: [r('Kubernetes Pod Security Standards', 'https://kubernetes.io/docs/concepts/security/pod-security-standards/')],
  }),
  topic({
    id: 'build-provenance', category: 'CLOUD_SUPPLY', name: '빌드 provenance와 서명',
    BEGINNER: {
      context: '공식 이름의 설치 파일이지만 누가 어떤 소스로 만들었는지 확인할 수 없다.',
      evidence: { triage: '배포 해시는 게시됐지만 파일과 같은 서버에서 함께 변경 가능', prevent: '신뢰한 빌드와 소스 커밋 연결 정보 없음', respond: '공식 저장소와 다른 해시의 파일 배포', verify: '정상 서명 파일과 변조 파일 비교 가능', monitor: '승인되지 않은 빌더가 만든 산출물' },
      actions: { risk: '파일 이름과 해시만으로 신뢰한 빌드 산출물인지 알 수 없다', prevent: '격리된 빌드가 provenance를 서명하고 배포 전에 검증하게 한다', respond: '의심 산출물 배포를 중단하고 신뢰한 digest로 교체해 영향 범위를 조사한다', verify: '정상 서명·출처는 통과하고 변조 digest·다른 빌더는 거부되는지 시험한다', monitor: '배포 digest와 provenance의 빌더·소스 불일치를 경보한다' },
      wrongs: ['파일 이름에 official을 붙인다', '해시를 파일과 같은 서버에만 둔다', '경고를 무시하고 일정대로 배포한다'],
      takeaway: '공급망에서는 파일 이름뿐 아니라 서명된 출처·빌드·digest 연결을 검증합니다.',
    },
    ADVANCED: {
      context: 'artifact digest는 있으나 builder identity·source commit·build parameters를 증명하는 attestation이 없다.',
      evidence: { triage: 'digest present; provenance subject/builder/source missing', prevent: 'release gate trusts filename and mutable tag', respond: 'deployed digest absent from transparency log; signer unknown', verify: 'valid attestation vs altered subject digest', monitor: 'builder.id/source.ref/predicate mismatch at admission' },
      actions: { risk: 'artifact가 source·builder identity에 결속되지 않았다', prevent: 'trusted builder의 SLSA attestation을 admission에서 강제한다', respond: '불일치 digest를 차단하고 배포 그래프로 소비 서비스를 찾는다', verify: 'subject digest·builder.id·source ref 변조를 음성 시험한다', monitor: 'CI attestation·registry digest·admission을 subject로 상관한다' },
      wrongs: ['release tag를 latest-official로 바꾼다', 'unsigned checksum manifest만 신뢰한다', 'policy failure를 allow override로 처리한다'],
      takeaway: '불변 artifact identity와 provenance 정책을 CI부터 admission까지 end-to-end로 강제합니다.',
    },
    references: [r('SLSA Specification', 'https://slsa.dev/spec/'), r('NIST SSDF SP 800-218', 'https://csrc.nist.gov/pubs/sp/800/218/final')],
  }),
  topic({
    id: 'kev-priority', category: 'DEVICE', name: '실제 악용 기반 취약점 우선순위',
    BEGINNER: {
      context: '인터넷 공개 장비 취약점이 실제 공격에 쓰이지만 점수만 더 높은 내부 항목이 먼저다.',
      evidence: { triage: '외부 장비에 실제 악용 경보와 관리자 영향 확인', prevent: '자산 노출·악용·영향 정보를 함께 볼 수 있음', respond: '패치 전에도 외부 접근 제한 가능', verify: '취약 버전과 수정 버전 스캔 비교', monitor: '공개 장비에서 알려진 공격 패턴' },
      actions: { risk: '실제 악용 중인 외부 노출 취약점이 현재 우선 위험이다', prevent: '악용·노출·자산 중요도·영향을 결합해 패치 순위를 정한다', respond: '외부 접근을 제한하고 침해 흔적을 조사하면서 긴급 패치한다', verify: '수정 버전과 실제 공격 경로 차단을 함께 시험한다', monitor: '외부 장비의 악용 패턴과 후속 관리자 행동을 함께 본다' },
      wrongs: ['CVSS 숫자 하나만 보고 결정한다', '제품 배너만 숨긴다', '패치 후 과거 로그를 삭제한다'],
      takeaway: '패치 순위는 점수뿐 아니라 실제 악용, 노출, 자산 영향과 보완 통제를 함께 봅니다.',
    },
    ADVANCED: {
      context: 'KEV 등재·reachable exploit path·privileged impact가 있으나 CVSS-only SLA가 순위를 뒤집는다.',
      evidence: { triage: 'KEV=true; internet=true; reachable=true; impact=admin', prevent: 'queue sorted by base score only', respond: 'compensating control available before patch window', verify: 'version plus exploit-path negative control', monitor: 'edge exploit signature + post-auth privilege activity' },
      actions: { risk: '실제 악용과 reachable privileged path가 현재 위험을 지배한다', prevent: '위협·reachability·업무 영향·보완 통제로 SLA를 정한다', respond: 'edge ACL로 차단하고 IOC hunt 후 검증된 fix를 배포한다', verify: 'vulnerable 양성·patched 음성·회귀를 분리 시험한다', monitor: 'edge IOC와 process·auth·control-plane을 자산별 상관한다' },
      wrongs: ['base score 내림차순만 사용한다', 'HTTP Server 헤더만 제거한다', 'remediation 이전 telemetry를 삭제한다'],
      takeaway: 'threat-informed exploitability와 침해 평가를 A/B 패치 검증에 연결합니다.',
    },
    references: [r('CISA KEV Catalog', 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog')],
  }),
  topic({
    id: 'infostealer', category: 'INCIDENT', name: '인포스틸러와 세션 토큰 탈취',
    BEGINNER: {
      context: '개인 PC에서 업무 메일에 로그인한 뒤 브라우저 쿠키와 저장 비밀번호가 유출됐다.',
      evidence: { triage: '비밀번호 변경 뒤에도 낯선 세션에서 메일 접근', prevent: '업무 계정과 개인 브라우저 프로필이 섞임', respond: '감염 PC가 온라인이고 세션 활성', verify: '오래된 쿠키와 깨끗한 기기 로그인을 비교 가능', monitor: '새 기기·새 지역에서 쿠키 로그인' },
      actions: { risk: '비밀번호뿐 아니라 세션·저장 자격 증명이 함께 탈취됐다', prevent: '업무용 관리 기기·프로필을 분리하고 토큰 수명과 기기 조건을 제한한다', respond: '기기를 격리하고 모든 세션·토큰을 폐기한 뒤 지속성을 조사한다', verify: '오래된 쿠키·토큰은 실패하고 깨끗한 기기 재인증만 성공하는지 확인한다', monitor: '새 기기 토큰 재사용과 계정 내 지속성 행동을 함께 경보한다' },
      wrongs: ['비밀번호만 한 번 바꾼다', '브라우저 아이콘만 지운다', '감염 PC에서 관리 콘솔에 로그인한다'],
      takeaway: '인포스틸러 대응은 기기 격리와 비밀번호·세션·토큰의 전면 폐기를 함께 합니다.',
    },
    ADVANCED: {
      context: 'stealer가 browser profile DB·cookie store·wallet extension을 수집했고 refresh token이 유효하다.',
      evidence: { triage: 'cookie DB accessed; refresh_token exported; rotated password; session valid', prevent: 'device posture absent; token replay accepted', respond: 'host beaconing; token family active; mailbox rules created', verify: 'old token replay negative control after global revocation', monitor: 'token reuse from new device + impossible ASN + persistence' },
      actions: { risk: 'refresh token·browser session replay는 비밀번호 변경 뒤에도 유효하다', prevent: 'phishing-resistant auth·관리 기기·token protection을 결합한다', respond: 'host 증거 보존 후 token family·credential·OAuth를 폐기한다', verify: 'stolen token의 replay·refresh·session 지속을 모두 거부한다', monitor: 'token family·device·ASN·mailbox rule·OAuth grant를 상관한다' },
      wrongs: ['primary password rotation만 수행한다', '브라우저 profile UI만 숨긴다', '같은 감염 브라우저로 관리 콘솔에 로그인한다'],
      takeaway: 'endpoint와 identity telemetry를 토큰 계열·기기 결속·지속성 행동으로 상관합니다.',
    },
    references: [r('MITRE ATT&CK T1539', 'https://attack.mitre.org/techniques/T1539/'), r('MITRE ATT&CK T1555', 'https://attack.mitre.org/techniques/T1555/')],
  }),
  topic({
    id: 'ai-prompt-injection', category: 'WEB_APP', name: '생성형 AI prompt injection',
    BEGINNER: {
      context: '문서 요약 봇이 문서 속 “모든 파일을 외부로 보내라”는 문장을 명령으로 따랐다.',
      evidence: { triage: '요약 대상 문서가 봇 행동을 바꿔 외부 링크 호출', prevent: '봇이 메일·파일 전송 도구를 자동 실행 가능', respond: '외부로 문서 제목이 전송된 기록', verify: '정상 문서와 악성 지시문 문서를 비교 가능', monitor: '검색 문서 직후 평소 없는 도구 호출' },
      actions: { risk: '참고 데이터가 명령처럼 해석돼 권한 있는 도구가 오용된다', prevent: '도구 권한을 모델과 분리하고 최소 권한·허용 규칙·사용자 확인을 적용한다', respond: '도구 호출을 중단하고 세션·외부 전송·오염 문서를 격리해 조사한다', verify: '정상 요약은 되고 악성 지시문은 도구 실행 없이 데이터로 처리되는지 시험한다', monitor: '검색 문서의 출처와 이어진 민감 도구 호출을 함께 기록한다' },
      wrongs: ['금지 문구 목록만 길게 만든다', '시스템 프롬프트를 더 비밀로 숨긴다', '모든 도구 로그를 끈다'],
      takeaway: 'AI가 읽는 문서는 비신뢰 데이터이며 도구 권한은 별도 정책과 확인으로 통제합니다.',
    },
    ADVANCED: {
      context: 'RAG의 비신뢰 문서가 tool-capable model의 system intent와 같은 권한 채널에서 해석된다.',
      evidence: { triage: 'retrieved chunk instruction -> exfil tool call without policy check', prevent: 'tool authorization delegated to model text output', respond: 'egress call observed; affected conversation and corpus identified', verify: 'benign/adversarial corpus with deterministic policy oracle', monitor: 'retrieval provenance + instruction markers + sensitive tool args' },
      actions: { risk: '비신뢰 content가 control instruction과 섞여 tool 권한을 탈취한다', prevent: '모델 밖 정책이 principal·provenance·tool args를 검증한다', respond: 'tool 자격을 폐기하고 대화·retrieval·egress trace를 보존한다', verify: 'indirect injection에서 정책 거부와 정상 tool 허용을 시험한다', monitor: 'provenance·prompt role·policy·tool args를 trace별 상관한다' },
      wrongs: ['prompt regex만 추가한다', 'system prompt 난독화에 의존한다', 'model/tool trace를 저장하지 않는다'],
      takeaway: '모델 밖 authorization boundary와 retrieval-to-tool trace로 agentic 공격을 제한·검증합니다.',
    },
    references: [r('OWASP GenAI LLM01 Prompt Injection', 'https://genai.owasp.org/llmrisk/llm01-prompt-injection/'), r('NIST AI Agent Identity Concept', 'https://www.nist.gov/news-events/news/2026/02/new-concept-paper-identity-and-authority-software-agents')],
  }),
  topic({
    id: 'ai-data-governance', category: 'CLOUD_SUPPLY', name: '생성형 AI 민감정보 거버넌스',
    BEGINNER: {
      context: '직원이 공개형 AI 채팅에 고객 계약서와 운영 API 키를 붙여 넣었다.',
      evidence: { triage: '대화 기록에 고객 정보와 유효한 키 포함', prevent: '승인 내부 도구와 입력 금지 기준 없음', respond: '공유 링크로 대화가 외부 공개', verify: '가짜 비밀·허용 문서로 정책 시험 가능', monitor: 'AI 도메인으로 비밀 패턴 업로드' },
      actions: { risk: '민감정보와 유효한 비밀이 통제 밖 외부 서비스로 전송됐다', prevent: '승인 도구·데이터 분류·DLP·비밀 차단과 입력 기준을 적용한다', respond: '공유를 중단하고 키를 폐기하며 제공자 삭제·노출 범위를 조사한다', verify: '허용 데이터는 통과하고 가짜 비밀·민감 문서는 차단되는지 시험한다', monitor: '민감도·비밀 패턴과 비승인 AI 목적지를 함께 경보한다' },
      wrongs: ['대화 제목만 confidential로 바꾼다', 'API 키 앞부분만 가린다', '직원 교육만 하고 기술 통제는 두지 않는다'],
      takeaway: 'AI 입력도 외부 전송이므로 민감정보·비밀은 승인된 통제 경로에서만 처리합니다.',
    },
    ADVANCED: {
      context: 'DLP·retention·training opt-out 검토 없이 regulated data가 외부 model-provider tenant로 전송된다.',
      evidence: { triage: 'egress to third-party model; DLP=none; secret active; retention unknown', prevent: 'data classification not enforced at prompt boundary', respond: 'conversation shared publicly; provider deletion path exists', verify: 'canary secrets and classified fixtures through allow/deny paths', monitor: 'classification label + secret match + unsanctioned destination' },
      actions: { risk: '분류·계약·retention 미확인 data가 제3자 경계로 이동한다', prevent: 'prompt gateway에서 분류·secret scan·provider policy를 강제한다', respond: 'provider 삭제·link 폐기·credential 회전·audit 복원을 수행한다', verify: 'canary secret·PII·public data로 gateway·retention을 시험한다', monitor: 'DLP label·gateway decision·provider tenant·공유를 상관한다' },
      wrongs: ['chat title에 DLP를 적는다', 'UI viewer에서만 마스킹한다', 'policy PDF만 배포한다'],
      takeaway: '분류·DLP·provider policy·retention을 prompt-to-provider 데이터 계보 전체에 강제합니다.',
    },
    references: [r('NIST AI RMF', 'https://www.nist.gov/itl/ai-risk-management-framework'), r('OWASP GenAI LLM02 Sensitive Information Disclosure', 'https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/')],
  }),
  topic({
    id: 'pqc-migration', category: 'CLOUD_SUPPLY', name: '포스트양자 암호 전환',
    BEGINNER: {
      context: '장기 기밀 문서가 어디에서 어떤 공개키 암호로 보호되는지 조직이 모른다.',
      evidence: { triage: '10년 보관 데이터와 오래된 장비가 같은 방식 사용', prevent: '암호 사용 위치·라이브러리·키 수명 목록 없음', respond: '시험 교체 뒤 일부 장비 연결 실패', verify: '기존·하이브리드·새 알고리즘 상호운용 시험 가능', monitor: '허용되지 않은 오래된 알고리즘 사용' },
      actions: { risk: '장기 기밀 데이터와 교체 어려운 시스템의 전환 우선순위를 알 수 없다', prevent: '암호 자산·데이터 수명·의존성을 목록화하고 단계별 전환 계획을 세운다', respond: '실패한 전환을 제한된 파일럿으로 되돌리고 강등·노출을 조사한다', verify: '표준 시험·상호운용·성능·강등 거부를 함께 검증한다', monitor: '실제 협상 알고리즘과 강등·오래된 키 사용을 수집한다' },
      wrongs: ['모든 시스템의 알고리즘 이름만 한 번에 바꾼다', '자체 암호 알고리즘을 만든다', '연결만 되면 안전하다고 본다'],
      takeaway: 'PQC 전환은 암호 자산·데이터 수명·호환성을 파악한 뒤 단계적으로 진행합니다.',
    },
    ADVANCED: {
      context: 'crypto inventory와 data lifetime 없이 PQC algorithm swap을 일괄 적용하려 한다.',
      evidence: { triage: 'confidentiality=15y; KEM usage unknown; firmware agility=false', prevent: 'no CBOM; negotiation and rollback undocumented', respond: 'pilot caused handshake failures and downgrade fallback', verify: 'known-answer·interop·downgrade negative controls', monitor: 'negotiated suite + downgrade + certificate/key lifecycle' },
      actions: { risk: 'data 수명·crypto 의존성·agility 부재로 장기 복호화 위험을 모른다', prevent: 'CBOM·agility·hybrid 전환·rollback을 자산별 설계한다', respond: '영향을 격리하고 negotiation으로 downgrade·key reuse를 분석한다', verify: 'NIST KAT·interop·downgrade 음성·key lifecycle을 시험한다', monitor: 'suite·certificate·key age·data class를 자산별 상관한다' },
      wrongs: ['configuration string을 전역 치환한다', '비공개 PQC primitive를 설계한다', 'handshake success만 합격 기준으로 둔다'],
      takeaway: 'CBOM과 crypto agility를 기반으로 표준 적합성·상호운용·강등 거부를 검증합니다.',
    },
    references: [r('NIST IR 8547 Transition to Post-Quantum Cryptography Standards', 'https://csrc.nist.gov/pubs/ir/8547/final'), r('NIST PQC Publications', 'https://csrc.nist.gov/projects/post-quantum-cryptography/publications')],
  }),
  topic({
    id: 'email-auth', category: 'IDENTITY', name: '이메일 도메인 인증과 BEC',
    BEGINNER: {
      context: '회사 대표 주소처럼 보이는 메일이 새 계좌로 긴급 송금을 요구했다.',
      evidence: { triage: '주소 철자 한 글자 다르고 전화 확인 금지 요구', prevent: '계좌 변경에 독립 확인 절차 없음', respond: '일부 직원이 링크를 열고 송금 준비', verify: '정상 도메인과 사칭 도메인 메일 비교 가능', monitor: '새 계좌·긴급·회신 금지와 유사 도메인' },
      actions: { risk: '사칭 도메인과 긴급함으로 독립 확인을 우회하려는 BEC다', prevent: 'DMARC 정렬을 강화하고 계좌 변경은 알려진 번호 콜백·2인 승인으로 검증한다', respond: '송금을 중단하고 메일·토큰을 격리하며 거래 회수를 요청한다', verify: '정상 정렬 메일은 통과하고 spoof·유사 도메인은 차단되며 콜백이 작동하는지 시험한다', monitor: '유사 도메인·표시 이름 사칭과 송금 의도를 함께 경보한다' },
      wrongs: ['발신자 표시 이름만 확인한다', '같은 메일에 진짜인지 답장한다', '소액을 먼저 보낸다'],
      takeaway: 'BEC는 발신 주소와 긴급함을 의심하고 알려진 연락처·이중 승인으로 거래를 검증합니다.',
    },
    ADVANCED: {
      context: 'look-alike domain은 SPF pass지만 조직 도메인은 DMARC p=none이고 거래 변경 콜백이 없다.',
      evidence: { triage: 'From=ceo@cornpany.example; SPF=pass attacker; DMARC alignment=false', prevent: 'DMARC p=none; no callback for beneficiary change', respond: 'messages delivered; OAuth click and payment workflow started', verify: 'aligned control vs spoof/look-alike negative samples', monitor: 'display-name impersonation + domain distance + payment intent' },
      actions: { risk: '공격자 SPF pass를 조직 신원으로 오인해 alignment·업무 통제를 놓친다', prevent: 'DMARC alignment 강제와 별도 채널 2인 승인을 결합한다', respond: '지급 중단·메일 삭제·session/OAuth 폐기·header 보존을 병행한다', verify: 'SPF·DKIM·DMARC 조합과 수취인 변경 절차를 시험한다', monitor: '인증 결과·유사 domain·thread·수취인 변경을 상관한다' },
      wrongs: ['friendly From만 allowlist한다', 'existing thread reply만으로 승인한다', 'micro-transfer로 계좌를 검증한다'],
      takeaway: 'DMARC alignment와 결제 업무 통제를 결합하고 유사 도메인·thread·거래 맥락을 상관합니다.',
    },
    references: [r('CISA Phishing Guidance', 'https://www.cisa.gov/secure-our-world/recognize-and-report-phishing'), r('NIST SP 800-177 Rev.1 Trustworthy Email', 'https://csrc.nist.gov/pubs/sp/800/177/r1/final')],
  }),
]);

const MODE_KEYS = Object.freeze(['triage', 'prevent', 'respond', 'verify', 'monitor']);
const ACTION_BY_MODE = Object.freeze({ triage: 'risk', prevent: 'prevent', respond: 'respond', verify: 'verify', monitor: 'monitor' });

function rotate(values, offset) {
  const amount = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(amount), ...values.slice(0, amount)];
}

function makeOption(id, label, topicName, mode, level, correct) {
  const objective = level === 'ADVANCED' ? '공격 전제·신뢰 경계·완화 우선순위' : '요청·로그·권한 근거';
  return Object.freeze({
    id,
    label,
    technical: `${mode} 판단 · ${objective}`,
    feedback: correct
      ? `정답입니다. ${topicName}의 ${objective}를 직접 다룹니다.`
      : `“${label}” 선택은 ${topicName}의 ${objective}를 해결하거나 검증하지 못합니다.`,
  });
}

function lifecycleChoices(data, mode, offset) {
  const actionKey = ACTION_BY_MODE[mode];
  const correct = data.actions[actionKey];
  const alternatives = rotate(
    Object.entries(data.actions)
      .filter(([key, label]) => key !== actionKey && typeof label === 'string' && label.length > 0)
      .map(([, label]) => label),
    offset,
  ).slice(0, 3);
  if (!correct || alternatives.length !== 3) throw new Error(`incomplete lifecycle actions for ${mode}`);
  return [correct, ...alternatives];
}

function makeVariant(definition, mode, level, topicIndex, modeIndex) {
  const data = definition[level];
  const optionIds = rotate(
    ['choice-a', 'choice-b', 'choice-c', 'choice-d'],
    topicIndex + modeIndex + (level === 'ADVANCED' ? 2 : 0),
  );
  const choices = lifecycleChoices(data, mode, topicIndex + modeIndex).map((label, index) => makeOption(
    optionIds[index],
    label,
    definition.name,
    mode,
    level,
    index === 0,
  ));
  const prompt = MODE_PROMPTS[mode][level](definition.name);
  const evidence = Object.freeze([
    Object.freeze({
      label: level === 'ADVANCED' ? 'telemetry' : '상황',
      value: data.context,
      annotation: level === 'ADVANCED' ? '공격 흐름의 전제와 자산 경계를 확인합니다.' : '실제 요청·로그·권한의 맥락입니다.',
    }),
    Object.freeze({
      label: level === 'ADVANCED' ? 'trust-boundary' : '근거',
      value: data.evidence[mode],
      annotation: level === 'ADVANCED' ? 'exploitability와 완화 우선순위를 판단합니다.' : '정답 선택을 뒷받침하는 관찰 증거입니다.',
    }),
  ]);
  return Object.freeze({
    question: prompt,
    evidence,
    options: Object.freeze(rotate(choices, topicIndex + modeIndex)),
    answerId: optionIds[0],
    correctOptionId: optionIds[0],
    takeaway: data.takeaway,
    explanation: data.takeaway,
    references: definition.references,
    serverTier: TIER_BY_MODE[mode],
  });
}

function makePairedQuestion(definition, mode, topicIndex, modeIndex) {
  const variants = Object.freeze({
    BEGINNER: makeVariant(definition, mode, 'BEGINNER', topicIndex, modeIndex),
    ADVANCED: makeVariant(definition, mode, 'ADVANCED', topicIndex, modeIndex),
  });
  const id = `${definition.id}-${mode}`;
  return Object.freeze({
    id,
    conceptId: id,
    topicFamily: definition.id,
    category: definition.category,
    topic: definition.name,
    tracks: TRACKS[definition.category],
    stages: Object.freeze([STAGE_BY_MODE[mode]]),
    variants,
    question: variants.BEGINNER.question,
    evidence: Object.freeze({ BEGINNER: variants.BEGINNER.evidence, ADVANCED: variants.ADVANCED.evidence }),
    options: variants.BEGINNER.options,
    answerId: variants.BEGINNER.answerId,
    correctOptionId: variants.BEGINNER.answerId,
    takeaway: variants.BEGINNER.takeaway,
    explanation: variants.BEGINNER.takeaway,
    references: definition.references,
    serverTiers: Object.freeze({ BEGINNER: TIER_BY_MODE[mode], ADVANCED: TIER_BY_MODE[mode] }),
  });
}

export const EXPANDED_TOPIC_DEFINITIONS = TOPICS;
export const EXPANDED_QUESTIONS = Object.freeze(TOPICS.flatMap((definition, topicIndex) => (
  MODE_KEYS.map((mode, modeIndex) => makePairedQuestion(definition, mode, topicIndex, modeIndex))
)));

if (TOPICS.length !== 14 || EXPANDED_QUESTIONS.length !== 70) {
  throw new Error('expanded question pool must contain 14 topics x 5 modes');
}
