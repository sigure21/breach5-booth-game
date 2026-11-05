export const SCENARIO = Object.freeze({
  id: 'two-guards',
  title: '두 명의 경비원',
  subtitle: '같은 URL, 서로 다른 해석',
  briefing: '문서 변환 서비스의 Gateway와 Worker가 같은 요청 경로를 다르게 보고 있습니다.',
  proofLabel: '격리된 cold-start proof',
});

const TASKS = Object.freeze({
  trust_boundary: {
    phase: 'DISCOVER', team: 'RED', roles: ['SCOUT', 'BUILDER', 'RUNNER'],
    prompt: '어디에서 신뢰가 갈라졌을까요?',
    options: [
      ['parser_mismatch', '두 컴포넌트의 경로 해석', 'Gateway 로그와 Worker 로그의 경로 표기가 다릅니다.'],
      ['backend_down', '백엔드 장애 상태', 'Backend health 응답은 down 상태를 표시합니다.'],
      ['slow_network', '느린 네트워크', '최근 요청의 응답 시간이 증가했습니다.'],
    ],
  },
  anomaly: {
    phase: 'DISCOVER', team: 'BLUE', roles: ['MONITOR', 'GATEKEEPER', 'PATCHER'],
    prompt: '가장 중요한 이상 징후는 무엇일까요?',
    options: [
      ['route_views_differ', 'Gateway와 Worker의 경로가 다름', '두 로그가 서로 다른 request-target을 기록했습니다.'],
      ['many_404s', '404 응답 증가', '최근 404 응답 비율이 기준선을 넘었습니다.'],
      ['missing_tls', '내부 TLS 미사용', 'Gateway와 Worker 연결은 내부 평문 HTTP입니다.'],
    ],
  },
  prefix: {
    phase: 'BUILD', team: 'RED', roles: ['BUILDER'],
    prompt: 'Worker까지 전달할 mount prefix를 고르세요.',
    options: [
      ['command_substitution', '환경값을 읽는 command substitution', 'mount prefix에 런타임 환경 조회 표현을 배치합니다.'],
      ['literal_marker', '일반 텍스트 마커', '고정된 문서 식별자를 mount prefix에 배치합니다.'],
      ['status_probe', '상태 확인 문자열', '상태 확인용 문자열을 mount prefix에 배치합니다.'],
    ],
  },
  normalization: {
    phase: 'BUILD', team: 'RED', roles: ['SCOUT'],
    prompt: 'Gateway에서만 사라질 경로 조각을 고르세요.',
    options: [
      ['encoded_parent', '인코딩된 상위 경로', 'percent-encoded 상위 경로 segment를 배치합니다.'],
      ['plain_segment', '일반 폴더 이름', '일반 archive 디렉터리 segment를 배치합니다.'],
      ['query_only', '쿼리 문자열만 변경', 'path는 유지하고 query 값만 변경합니다.'],
    ],
  },
  sink: {
    phase: 'BUILD', team: 'RED', roles: ['RUNNER'],
    prompt: '어떤 처리 경로를 호출할까요?',
    options: [
      ['cold_start', 'Cold-start bootstrap', 'built-in proxy의 bootstrap 경로를 호출합니다.'],
      ['healthcheck', 'Health check', '서비스 상태 확인 경로를 호출합니다.'],
      ['static_asset', '정적 자산', '브라우저용 JavaScript 자산을 요청합니다.'],
    ],
  },
  guard: {
    phase: 'BUILD', team: 'BLUE', roles: ['MONITOR', 'GATEKEEPER', 'PATCHER'],
    prompt: '1차 차단은 어느 값에 적용해야 할까요?',
    options: [
      ['canonical_once', '한 번 해석한 canonical 값', 'Gateway가 만든 route 값을 다음 계층에 전달합니다.'],
      ['canonical_only', 'Gateway 검사만 강화', 'Gateway의 route 검사 규칙만 강화합니다.'],
      ['raw_blacklist', 'raw 문자열 일부 차단', 'raw request-target에서 특정 표현을 거부합니다.'],
    ],
  },
  bypass: {
    phase: 'DUEL', team: 'RED', roles: ['SCOUT', 'BUILDER', 'RUNNER'],
    prompt: '불완전한 문자열 차단을 시험할 변형을 고르세요.',
    options: [
      ['backtick_variant', '다른 shell 표현 사용', '동일한 환경 조회를 다른 shell 표기로 구성합니다.'],
      ['original', '원본 요청 재전송', '첫 실행에서 사용한 요청을 그대로 재전송합니다.'],
      ['double_encoded', '이중 인코딩', '상위 경로 segment를 한 번 더 인코딩합니다.'],
    ],
  },
  patch: {
    phase: 'DUEL', team: 'BLUE', roles: ['MONITOR', 'GATEKEEPER', 'PATCHER'],
    prompt: '근본적으로 공격 체인을 끊을 패치를 고르세요.',
    options: [
      ['hide_errors', '오류 메시지만 숨김', '외부 응답에서 bootstrap 오류 상세를 제거합니다.'],
      ['block_subshell', '특정 shell 표현 차단', 'raw 경로에서 한 종류의 shell 표현을 거부합니다.'],
      ['canonical_once', '파싱 결과를 전 계층에서 공유', 'Gateway의 canonical route를 Worker에 전달합니다.'],
      ['structured_exec', 'shell sink 제거', 'bootstrap을 구조화된 인자 호출로 교체합니다.'],
    ],
  },
});

export const ALLOWED_CHOICES = Object.freeze(Object.fromEntries(
  Object.entries(TASKS).map(([id, task]) => [id, new Set(task.options.map(([value]) => value))]),
));

export function publicTask(taskId, selected = null) {
  const task = TASKS[taskId];
  if (!task) throw new Error(`unknown task ${taskId}`);
  return {
    id: taskId,
    prompt: task.prompt,
    selected,
    options: task.options.map(([id, label, detail]) => ({ id, label, detail })),
  };
}

export function taskIdsFor({ phase, team, role, teamSize }) {
  return Object.entries(TASKS)
    .filter(([, task]) => task.phase === phase && task.team === team)
    .filter(([, task]) => teamSize < 3 || task.roles.includes(role))
    .map(([id]) => id);
}

export function validateChoice(taskId, choice) {
  return typeof choice === 'string' && ALLOWED_CHOICES[taskId]?.has(choice) === true;
}

export const DEFAULT_CHOICES = Object.freeze({
  trust_boundary: 'backend_down',
  anomaly: 'many_404s',
  prefix: 'literal_marker',
  normalization: 'plain_segment',
  sink: 'healthcheck',
  guard: 'canonical_only',
  bypass: 'original',
  patch: 'hide_errors',
});

export function buildAttackPath({ prefix, normalization, sink, variant = 'original' }) {
  const route = sink === 'cold_start'
    ? '/apps/builtin-code/proxy.php'
    : sink === 'healthcheck' ? '/healthz' : '/assets/office.js';
  const prefixValue = prefix === 'command_substitution'
    ? (variant === 'backtick_variant'
      ? 'x`printenv${IFS}BREACH5_PROOF`x'
      : 'x$(printenv${IFS}BREACH5_PROOF)x')
    : prefix === 'status_probe' ? 'status' : 'documents';
  const segment = normalization === 'encoded_parent'
    ? (variant === 'double_encoded' ? '%252e%252e' : '%2e%2e')
    : normalization === 'query_only' ? 'preview' : 'archive';
  return `/${prefixValue}/${segment}${route}?status=1`;
}

export function rawHttpPreview(path) {
  return `GET ${path} HTTP/1.1\nHost: internal-engine\nConnection: close`;
}

export function scenarioExplanation() {
  return [
    '두 컴포넌트가 같은 URL을 다르게 해석했습니다.',
    '검사는 canonical 값에, 실행은 raw 값에 적용됐습니다.',
    '한 번 파싱한 값을 공유하고 shell sink를 제거해야 합니다.',
  ];
}
