import {
  aggregateTaskChoices,
  publicTaskFrom,
  scoreChoices,
  taskIdsForPhaseTeam,
  validateTaskChoice,
} from './shared.mjs';

export const metadata = Object.freeze({
  id: 'proxy-panic',
  title: '두 명의 경비원',
  subtitle: '같은 URL, 서로 다른 해석',
  shortLabel: 'PROXY PANIC',
  category: 'HTTP parser differential / command injection',
  briefing: 'Raw request-target을 Gateway와 Worker가 다르게 해석하는 경계를 추적합니다.',
  source: '교육용 Proxy Panic 시나리오',
  rewardClaim: null,
});

const gatewayLog = `request_id=7f2a\nraw=/documents/%2e%2e/apps/builtin-code/proxy.php\ncanonical=/apps/builtin-code/proxy.php\nallowlist=ACCEPT`;
const workerLog = `request_id=7f2a\nsource=rawPath\nmount_prefix=documents\nsink=/bin/sh -c`;

export const tasks = Object.freeze({
  trust_boundary: {
    phase: 'DISCOVER', team: 'RED', prompt: '동일한 request_id에서 신뢰가 갈라지는 필드를 찾으세요.',
    criterion: { beginner: '두 로그에서 값이 달라진 경로 필드를 비교하세요.', advanced: 'Identify the first divergent representation.' },
    evidence: [
      { id: 'gateway-log', source: 'GATEWAY', kind: 'log', label: 'access.log', value: gatewayLog, annotation: '`canonical`은 allowlist 검사에 사용됩니다.' },
      { id: 'worker-log', source: 'WORKER', kind: 'log', label: 'bootstrap.log', value: workerLog, annotation: 'Worker는 별도의 `rawPath`에서 prefix를 추출합니다.' },
    ],
    options: [
      { id: 'parser_mismatch', label: 'rawPath ↔ canonical', technical: 'validate(canonical); execute(rawPath)', detail: '검증값과 실행값이 다릅니다.', observation: { beginner: '두 로그의 경로 표현이 request_id는 같지만 서로 다릅니다.', advanced: 'representation mismatch confirmed' } },
      { id: 'backend_down', label: 'health status', technical: 'backend=down', detail: '상태 코드만으로는 두 경로 표현의 차이를 설명하지 못합니다.', observation: { beginner: '증거에 backend down 값은 없습니다.', advanced: 'unsupported by trace' } },
      { id: 'slow_network', label: 'latency', technical: 'duration_ms', detail: '지연은 parser view 차이와 직접 관련되지 않습니다.', observation: { beginner: '두 로그에 지연 증거가 없습니다.', advanced: 'unsupported by trace' } },
    ],
  },
  anomaly: {
    phase: 'DISCOVER', team: 'BLUE', prompt: '방어자가 우선 경보로 만들어야 할 불변식 위반을 고르세요.',
    criterion: { beginner: '같은 요청이 계층별로 다른 경로가 되면 경보가 필요합니다.', advanced: 'Choose the invariant violated across the trust boundary.' },
    evidence: [
      { id: 'gateway-log', source: 'GATEWAY', kind: 'log', label: 'access.log', value: gatewayLog, annotation: 'Gateway가 본 canonical path입니다.' },
      { id: 'worker-log', source: 'WORKER', kind: 'log', label: 'bootstrap.log', value: workerLog, annotation: 'Worker가 사용한 raw source입니다.' },
    ],
    options: [
      { id: 'route_views_differ', label: 'path views differ', technical: 'gateway.canonical != worker.source', detail: '동일 request_id의 경로 표현 불일치입니다.', observation: { beginner: '탐지 가능한 직접 증거와 일치합니다.', advanced: 'invariant matched' } },
      { id: 'many_404s', label: '404 rate', technical: 'status=404', detail: '현재 증거에는 404 비율이 없습니다.', observation: { beginner: '제공된 두 로그로 입증되지 않습니다.', advanced: 'not evidenced' } },
      { id: 'missing_tls', label: 'internal TLS', technical: 'scheme=http', detail: 'TLS 여부는 이번 데이터 흐름 결함과 별개입니다.', observation: { beginner: '파서 불일치 원인을 설명하지 못합니다.', advanced: 'orthogonal control' } },
    ],
  },
  prefix: {
    phase: 'BUILD', team: 'RED', prompt: 'Worker의 double-quoted shell 위치에서 평가될 prefix literal을 선택하세요.',
    criterion: { beginner: '따옴표 안에서도 command substitution은 평가됩니다.', advanced: 'Select a literal that survives path transport and expands in a double-quoted shell word.' },
    evidence: [
      { id: 'sink-code', source: 'WORKER', kind: 'code', label: 'bootstrap.mjs', value: 'const command = `printf \'%s\\n\' "${mountPrefix}" > ${logPath}`;\nexecFile("/bin/sh", ["-c", command]);', annotation: '`mountPrefix`가 shell command 문자열 안에 삽입됩니다.' },
      { id: 'env', source: 'RUNTIME', kind: 'log', label: 'allowed proof', value: 'BREACH5_PROOF=<isolated-placeholder>', annotation: '실제 proof 값은 공개되지 않습니다.' },
    ],
    options: [
      { id: 'command_substitution', label: 'x$(printenv${IFS}BREACH5_PROOF)x', technical: '$(...) + ${IFS}', detail: '공백 없이 환경값 조회를 구성합니다.', observation: { beginner: 'shell 평가 지점에 도달하면 command substitution이 실행됩니다.', advanced: 'shell expansion candidate' } },
      { id: 'literal_marker', label: 'documents', technical: 'documents', detail: '일반 문자열은 그대로 기록됩니다.', observation: { beginner: '실행 가능한 shell 표현이 없습니다.', advanced: 'literal only' } },
      { id: 'status_probe', label: 'status', technical: 'status', detail: '상태 문자열은 proof에 도달하지 않습니다.', observation: { beginner: '실행 가능한 shell 표현이 없습니다.', advanced: 'literal only' } },
    ],
  },
  normalization: {
    phase: 'BUILD', team: 'RED', prompt: 'Gateway 정규화 뒤 앞 segment를 제거할 literal을 선택하세요.',
    criterion: { beginner: '`decodeURIComponent` 뒤 `..`가 되면 앞 segment가 제거됩니다.', advanced: 'Choose a segment whose decoded dot-segment semantics change the route.' },
    evidence: [
      { id: 'canonicalizer', source: 'GATEWAY', kind: 'code', label: 'canonicalRoute()', value: 'decoded = decodeURIComponent(rawPath);\nif (segment === "..") stack.pop();', annotation: '디코딩 이후 dot-segment 제거가 실행됩니다.' },
      { id: 'trace', source: 'TRACE', kind: 'log', label: 'transform', value: '%2e%2e → .. → pop(previous segment)', annotation: '한 번의 디코딩으로 `..`가 됩니다.' },
    ],
    options: [
      { id: 'encoded_parent', label: '%2e%2e', technical: '%2e%2e', detail: '한 번 디코딩하면 상위 경로 segment가 됩니다.', observation: { beginner: '앞의 공격 prefix가 canonical view에서 제거됩니다.', advanced: 'dot-segment active' } },
      { id: 'plain_segment', label: 'archive', technical: 'archive', detail: '일반 segment는 유지됩니다.', observation: { beginner: 'Gateway allowlist 경로가 되지 않습니다.', advanced: 'segment retained' } },
      { id: 'query_only', label: 'preview', technical: 'preview', detail: 'query 변경은 path stack을 바꾸지 않습니다.', observation: { beginner: '경로 정규화 결과가 바뀌지 않습니다.', advanced: 'path unchanged' } },
    ],
  },
  sink: {
    phase: 'BUILD', team: 'RED', prompt: 'Gateway allowlist를 통과하며 Worker bootstrap을 호출할 target을 선택하세요.',
    criterion: { beginner: 'allowlist와 bootstrap route가 동시에 일치해야 합니다.', advanced: 'Select the allowed route wired to the bootstrap sink.' },
    evidence: [
      { id: 'route-map', source: 'GATEWAY', kind: 'code', label: 'routes', value: '/healthz → health\n/assets/office.js → static\n/apps/builtin-code/proxy.php → coldStartBootstrap', annotation: '마지막 route만 취약한 bootstrap sink로 연결됩니다.' },
      { id: 'allowlist', source: 'GATEWAY', kind: 'log', label: 'policy', value: 'allowed=/apps/builtin-code/proxy.php', annotation: '정규화 결과가 이 값과 같아야 합니다.' },
    ],
    options: [
      { id: 'cold_start', label: '/apps/builtin-code/proxy.php', technical: 'coldStartBootstrap()', detail: 'allowlist와 sink가 일치합니다.', observation: { beginner: '요청이 bootstrap 처리로 연결됩니다.', advanced: 'sink selected' } },
      { id: 'healthcheck', label: '/healthz', technical: 'health()', detail: '정상 상태 확인만 수행합니다.', observation: { beginner: 'shell sink로 연결되지 않습니다.', advanced: 'non-sink route' } },
      { id: 'static_asset', label: '/assets/office.js', technical: 'static()', detail: '정적 파일 처리입니다.', observation: { beginner: 'shell sink로 연결되지 않습니다.', advanced: 'non-sink route' } },
    ],
  },
  guard: {
    phase: 'BUILD', team: 'BLUE', prompt: '검증한 표현과 실행할 표현을 일치시키는 1차 control을 선택하세요.',
    criterion: { beginner: '한 번 파싱한 값을 다음 계층까지 전달해야 합니다.', advanced: 'Restore the validate/use invariant.' },
    evidence: [
      { id: 'data-flow', source: 'CODE REVIEW', kind: 'code', label: 'current flow', value: 'route = canonicalRoute(rawPath);\nassertAllowed(route);\nworker({ rawPath, canonicalPath: route });', annotation: '검증 후에도 rawPath가 Worker에 남아 있습니다.' },
      { id: 'invariant', source: 'POLICY', kind: 'log', label: 'required invariant', value: 'validated_value === executed_value', annotation: '검사와 실행 대상이 같아야 합니다.' },
    ],
    options: [
      { id: 'canonical_once', label: 'worker({ sourcePath: route })', technical: '- rawPath\n+ canonicalPath', detail: '정규화한 값을 유일한 실행 입력으로 전달합니다.', observation: { beginner: '검증/실행 불변식이 복원됩니다.', advanced: 'invariant restored' } },
      { id: 'canonical_only', label: 'assertAllowed(route)', technical: 'gateway-only validation', detail: 'Worker가 rawPath를 계속 쓰면 불일치는 남습니다.', observation: { beginner: '실행값이 바뀌지 않아 근본 원인이 남습니다.', advanced: 'use-site unchanged' } },
      { id: 'raw_blacklist', label: 'rawPath.includes("$(")', technical: 'literal blacklist', detail: '다른 shell 표기로 우회할 수 있습니다.', observation: { beginner: '특정 문자열만 막는 불완전한 control입니다.', advanced: 'syntax-specific filter' } },
    ],
  },
  bypass: {
    phase: 'DUEL', team: 'RED', prompt: '아래 임시 hotfix를 실제 shell 문법으로 우회할 variant를 선택하세요.',
    criterion: { beginner: '`$(`만 차단하며 shell sink 자체는 그대로입니다.', advanced: 'Bypass the literal filter without changing the semantic action.' },
    evidence: [
      { id: 'hotfix', source: 'PATCH v0', kind: 'diff', label: 'worker.mjs', value: '+ if (rawPath.includes("$(")) return reject();\n  execFile("/bin/sh", ["-c", command]);', annotation: 'filter는 `$(`만 검사합니다.' },
      { id: 'shell', source: 'SHELL', kind: 'code', label: 'equivalent forms', value: '$(command)\n`command`', annotation: '두 표현 모두 command substitution입니다.' },
    ],
    options: [
      { id: 'backtick_variant', label: 'x`printenv${IFS}BREACH5_PROOF`x', technical: '`command`', detail: '필터 문자열 없이 같은 shell 동작을 만듭니다.', observation: { beginner: 'literal filter를 통과하지만 shell에서 평가됩니다.', advanced: 'filter bypass candidate' } },
      { id: 'original', label: 'x$(printenv${IFS}BREACH5_PROOF)x', technical: '$(command)', detail: '임시 hotfix가 직접 차단합니다.', observation: { beginner: '필터에 걸립니다.', advanced: 'literal matched' } },
      { id: 'double_encoded', label: '%252e%252e', technical: 'double encoding', detail: '한 번 디코딩 뒤에도 `%2e%2e`라 allowlist에 도달하지 않습니다.', observation: { beginner: 'Gateway 단계에서 route가 거부됩니다.', advanced: 'canonical route rejected' } },
    ],
  },
  patch: {
    phase: 'DUEL', team: 'BLUE', prompt: '원본·variant를 막고 정상 bootstrap을 유지할 실제 diff를 선택하세요.',
    criterion: { beginner: 'parser 불일치 제거 또는 shell sink 제거는 모두 유효한 근본 방어입니다.', advanced: 'Choose a semantic fix that passes attack and normal-path regression.' },
    evidence: [
      { id: 'regression', source: 'TEST PLAN', kind: 'log', label: 'required', value: 'original $() → BLOCK\nbacktick → BLOCK\nnormal bootstrap → PASS', annotation: '공격 차단과 정상 기능 보존을 함께 검증합니다.' },
      { id: 'sink', source: 'WORKER', kind: 'code', label: 'current sink', value: 'execFile("/bin/sh", ["-c", command])', annotation: '구조화 API로 바꾸면 shell 해석 자체가 사라집니다.' },
    ],
    options: [
      { id: 'hide_errors', label: '오류 응답만 일반화', technical: '- detailedError\n+ genericError', detail: '실행 경로는 그대로입니다.', observation: { beginner: '정보 노출만 줄고 proof 도달은 남습니다.', advanced: 'no control at sink' } },
      { id: 'block_subshell', label: '특정 표현 blacklist', technical: '+ rawPath.includes("$(")', detail: 'backtick variant가 남습니다.', observation: { beginner: '원본은 막지만 variant 회귀가 실패합니다.', advanced: 'variant fails regression' } },
      { id: 'canonical_once', label: 'canonical 값만 전달', technical: '- sourcePath = rawPath\n+ sourcePath = canonicalPath', detail: '검증값과 실행값을 일치시킵니다.', observation: { beginner: '원본과 variant를 막고 정상 bootstrap을 유지합니다.', advanced: 'parser differential removed' } },
      { id: 'structured_exec', label: 'shell sink 제거', technical: '- execFile("/bin/sh", ["-c", command])\n+ writeFile(logPath, mountPrefix)', detail: 'shell 해석을 제거합니다.', observation: { beginner: '두 공격 표현이 데이터로만 기록됩니다.', advanced: 'shell sink removed' } },
    ],
  },
});

export const correct = Object.freeze({
  trust_boundary: 'parser_mismatch', anomaly: 'route_views_differ',
  prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start',
  guard: 'canonical_once', bypass: 'backtick_variant', patch: ['canonical_once', 'structured_exec'],
});

const tokenFor = (choice, map, placeholder) => map[choice] ?? placeholder;

export function preview(choices) {
  const prefix = tokenFor(choices.prefix, {
    command_substitution: 'x$(printenv${IFS}BREACH5_PROOF)x', literal_marker: 'documents', status_probe: 'status',
  }, '[PREFIX]');
  const segment = tokenFor(choices.normalization, {
    encoded_parent: '%2e%2e', plain_segment: 'archive', query_only: 'preview',
  }, '[SEGMENT]');
  const target = tokenFor(choices.sink, {
    cold_start: '/apps/builtin-code/proxy.php', healthcheck: '/healthz', static_asset: '/assets/office.js',
  }, '/[TARGET]');
  const rawPath = `/${prefix}/${segment}${target}?status=1`;
  let canonical = rawPath;
  try {
    const decoded = decodeURIComponent(rawPath.split('?', 1)[0]);
    const stack = [];
    for (const value of decoded.split('/')) {
      if (!value || value === '.') continue;
      if (value === '..') stack.pop(); else stack.push(value);
    }
    canonical = `/${stack.join('/')}`;
  } catch { canonical = '[INVALID ENCODING]'; }
  return {
    title: 'REQUEST ASSEMBLY',
    request: `GET ${rawPath} HTTP/1.1\nHost: internal-engine\nConnection: close`,
    trace: [
      `RAW       ${rawPath}`,
      `CANONICAL ${canonical}`,
      `WORKER    prefixFrom(rawPath) = ${prefix}`,
    ],
  };
}

export const scenario = Object.freeze({
  ...metadata,
  tasks,
  correct,
  publicTask: (taskId, context) => publicTaskFrom(tasks, taskId, context),
  validateChoice: (taskId, choice) => validateTaskChoice(tasks, taskId, choice),
  taskIdsFor: (phase, team) => taskIdsForPhaseTeam(tasks, phase, team),
  aggregate: (actions) => aggregateTaskChoices(tasks, actions),
  preview,
  baselineInput: (choices) => ({
    prefix: choices.prefix,
    normalization: choices.normalization,
    sink: choices.sink,
  }),
  patchInput: (choices) => ({ patch: choices.patch, bypass: choices.bypass }),
  explanation: () => [
    'Gateway는 canonical route를 검사했지만 Worker는 rawPath에서 prefix를 추출했습니다.',
    '검증값과 실행값이 달라 shell command substitution이 proof까지 도달했습니다.',
    '한 번 파싱한 값을 공유하거나 shell sink를 제거해야 합니다.',
  ],
  scores(choices) {
    return {
      RED: scoreChoices(correct, choices, Object.keys(tasks).filter((id) => tasks[id].team === 'RED')),
      BLUE: scoreChoices(correct, choices, Object.keys(tasks).filter((id) => tasks[id].team === 'BLUE')),
    };
  },
});
