import {
  aggregateTaskChoices,
  publicTaskFrom,
  scoreChoices,
  taskIdsForPhaseTeam,
  validateTaskChoice,
} from './shared.mjs';

export const metadata = Object.freeze({
  id: 'session-heist',
  title: '$90K Session Heist',
  subtitle: '서명된 쿠키 안의 서명키',
  shortLabel: 'SESSION HEIST',
  category: 'Flask session / secret reuse / unsafe pickle',
  briefing: 'Google DevSite 사례를 바탕으로 signed cookie에서 시작해 안전한 timing proof까지 추적합니다.',
  source: 'Simon Koeck 공개 write-up 기반 교육용 모델',
  sourceUrl: 'https://simonkoeck.com/writeups/google-devsite-flask-session-pickle-rce',
  rewardClaim: '$90,000 reported by the researcher',
});

export const PUBLIC_DEMO_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const demoCookie = '.eJztkc1u4jAUhV9llHWRIJksQOoiFJKSwWZICP7ZIDt_TrCTiJgGqPrudVWp0oz6AF3g3Xd8ru8916_WoctPijV5o62ZPp3zB6ts21Lmh5adtbAPaX8qDro95o01s6q-P-fZqNdM59b_zkK2w-Efx-zV-sVNWenFe7Bdep_nCSwaKFMHdtx2C4rchiFXytUAdoFf7cb-JAtEwIOpI8NN8ocESUG3be2JIVVTm6FIpl0MgoR2xIk-3hD8ab6kmO4YjuRqCV-4ciVx4qT2ZM0DKXkTFQwZnndDhsKeIaCJfelM7_Fa-UP6DM4UC8HxvKc0BgsEjWd_zvzpjSJ4pThOtmPPDLi6wUViw1vpEhTWNNgrsFhewW07gXX6e4P8itiRpLV3ATUYwx1xNgspiIJHisi39R-5U7U_MhyamaMiw2FntL9reyoyHLVAQcGDS0UQPBndT51IZAEy2S6d2eGEoq3-0uZhze3JQHDUESV7sw8X2-7L5x38ym76an6dKIbF2PST8nlfrcvHR-vtwepYllVNaX5NVeWJ6aptRk2r89Ed73jHO_5YtN7eAS23joc.au4VSA.M4bQ7IPOmYPNelHqCtYzw6xSS3A';
const flowBytes = 'gASVMQEAAAAAAACMDnNlc3Npb25fZW5naW5llIwMTGFiT0F1dGhGbG93lJOUKYGUfZQojAhwcm92aWRlcpSMGUZpY3Rpb25hbCBEZXZTaXRlIENvbm5lY3SUjAljbGllbnRfaWSUjBpwdWJsaWMtY2xpZW50LmFwcHMuZXhhbXBsZZSMDWNsaWVudF9zZWNyZXSUQ0AwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmlIwMcmVkaXJlY3RfdXJplIwPL29hdXRoMmNhbGxiYWNrlIwFc3RhdGWUjAxpc3N1ZWQtc3RhdGWUjBJjb21wYXRpYmlsaXR5X25vdGWUjBNwdWJsaWMtZGVtby1maXh0dXJllHViLg==';
const cookieHeader = `Set-Cookie: session=${demoCookie}; HttpOnly; Path=/`;
const decodedSession = `# filtered decoded TaggedJSON (padding omitted)
{
  "_permanent": true,
  "google_oauth2_csrf_token": "issued-state",
  "google_oauth2_flow_issued-state": {
    " b": "${flowBytes}"
  }
}`;
const pickleOps = `0: PROTO 4
28: SHORT_BINUNICODE 'LabOAuthFlow'
90: SHORT_BINUNICODE 'client_id'
102: SHORT_BINUNICODE 'public-client.apps.example'
131: SHORT_BINUNICODE 'client_secret'
147: SHORT_BINBYTES b'${PUBLIC_DEMO_SECRET}'
214: SHORT_BINUNICODE 'redirect_uri'
229: SHORT_BINUNICODE '/oauth2callback'
247: SHORT_BINUNICODE 'state'
255: SHORT_BINUNICODE 'issued-state'
315: STOP`;
const safePickleOps = `# base64: gASVHwAAAAAAAACMBHRpbWWUjAVzbGVlcJSTlEc_qZmZmZmZmoWUUpQu
0: PROTO 4
11: SHORT_BINUNICODE 'time'
18: SHORT_BINUNICODE 'sleep'
26: STACK_GLOBAL
28: BINFLOAT 0.05
37: TUPLE1
39: REDUCE
41: STOP`;

export const tasks = Object.freeze({
  sh_surface: {
    phase: 'DISCOVER', team: 'RED', prompt: '세션 쿠키에서 클라이언트가 직접 관찰할 수 있는 보안 경계를 고르세요.',
    criterion: { beginner: 'Flask 기본 session은 서명되지만 payload는 암호화되지 않습니다.', advanced: 'Classify confidentiality and integrity properties of the cookie.' },
    evidence: [
      { id: 'authorize', source: 'HTTP', kind: 'http', label: 'request', value: 'GET /oauth2authorize?return_url=%2F HTTP/1.1\nHost: devsite-lab.invalid', annotation: '로그인 없이 세션 쿠키가 발급됩니다.' },
      { id: 'cookie', source: 'HTTP', kind: 'cookie', label: 'response', value: `HTTP/1.1 302 Found\n${cookieHeader}`, annotation: '세 점 구간은 payload·timestamp·signature입니다.' },
    ],
    options: [
      { id: 'signed_not_encrypted', label: 'payload is readable', technical: 'signed != encrypted', detail: '서명은 무결성을 제공하지만 기밀성을 제공하지 않습니다.', observation: { beginner: 'payload를 서명키 없이 디코딩할 수 있습니다.', advanced: 'confidentiality absent' } },
      { id: 'encrypted_cookie', label: 'payload is encrypted', technical: 'AEAD ciphertext', detail: '증거는 Flask signed-cookie 형식이며 암호문이 아닙니다.', observation: { beginner: '형식과 맞지 않습니다.', advanced: 'format mismatch' } },
      { id: 'opaque_reference', label: 'server-side opaque ID', technical: 'random session id', detail: '쿠키 크기와 세 부분 구조가 opaque ID가 아님을 보여줍니다.', observation: { beginner: '클라이언트 payload가 실제 데이터를 포함합니다.', advanced: 'not opaque' } },
    ],
  },
  sh_anomaly: {
    phase: 'DISCOVER', team: 'BLUE', prompt: '관측된 쿠키 구조에서 가장 먼저 검증할 trust assumption을 선택하세요.',
    criterion: { beginner: '쿠키 안의 credential이 쿠키 서명에도 재사용되는지 검증해야 합니다.', advanced: 'Identify the credential reuse hypothesis that collapses integrity.' },
    evidence: [
      { id: 'cookie', source: 'HTTP', kind: 'cookie', label: 'issued session', value: cookieHeader, annotation: 'payload는 클라이언트가 읽을 수 있습니다.' },
      { id: 'flow-hint', source: 'SESSION', kind: 'json', label: 'filtered TaggedJSON', value: decodedSession, annotation: '`" b"`는 Flask TaggedJSON의 bytes 표현이며 위 값은 실제 공개 demo fixture입니다.' },
    ],
    options: [
      { id: 'secret_reuse', label: 'OAuth secret == Flask signing key?', technical: 'OAUTH_CLIENT_SECRET === SECRET_KEY', detail: '노출 credential의 두 번째 역할을 검증합니다.', observation: { beginner: '무결성 붕괴 여부를 직접 결정하는 가설입니다.', advanced: 'critical hypothesis' } },
      { id: 'cookie_size', label: 'cookie exceeds browser limit?', technical: 'len(cookie) > 4096', detail: '크기는 단서지만 위조 가능성을 설명하지 않습니다.', observation: { beginner: '보안 경계 붕괴를 직접 검증하지 못합니다.', advanced: 'secondary concern' } },
      { id: 'tls_version', label: 'TLS negotiation?', technical: 'TLSv1.3', detail: '전송 보호와 애플리케이션 서명키 재사용은 별개입니다.', observation: { beginner: '쿠키 내부 trust chain과 관련이 없습니다.', advanced: 'orthogonal' } },
    ],
  },
  sh_decode: {
    phase: 'BUILD', team: 'RED', prompt: 'leading dot이 있는 Flask payload의 변환 순서를 선택하세요.',
    criterion: { beginner: '압축 플래그 제거 후 Base64URL을 디코딩하고 zlib을 풉니다.', advanced: 'Choose the transform pipeline for a compressed Flask session payload.' },
    evidence: [
      { id: 'cookie-shape', source: 'COOKIE', kind: 'cookie', label: 'complete public demo cookie', value: demoCookie, annotation: '복사해 직접 디코딩할 수 있는 공개 demo fixture입니다. leading `.`은 압축 payload를 뜻합니다.' },
      { id: 'expected-json', source: 'SESSION', kind: 'json', label: 'target representation', value: decodedSession, annotation: '최종 결과는 TaggedJSON 객체입니다.' },
    ],
    options: [
      { id: 'base64_zlib_tagged_json', label: 'strip "." → b64url → zlib → JSON', technical: 'b64url_decode | zlib.decompress | JSON.parse', detail: 'Flask 압축 session 형식과 일치합니다.', observation: { beginner: 'TaggedJSON flow bytes가 드러납니다.', advanced: 'decode pipeline valid' } },
      { id: 'json_first', label: 'JSON → Base64', technical: 'JSON.parse(payload)', detail: 'payload는 바로 JSON 문자열이 아닙니다.', observation: { beginner: '첫 바이트에서 JSON 파싱이 실패합니다.', advanced: 'decode error' } },
      { id: 'decrypt_aes', label: 'AES decrypt', technical: 'AES-GCM.decrypt', detail: '암호화 nonce/tag 증거가 없습니다.', observation: { beginner: 'signed cookie에는 해당 암호화 계층이 없습니다.', advanced: 'no ciphertext format' } },
    ],
  },
  sh_secret: {
    phase: 'BUILD', team: 'RED', prompt: 'pickletools 출력에서 서명키 재사용 가설을 시험할 값을 고르세요.',
    criterion: { beginner: '`client_secret` 바로 뒤의 bytes 값을 정적으로 읽습니다. 브라우저에서 unpickle하지 않습니다.', advanced: 'Recover the credential from opcodes without executing the pickle.' },
    evidence: [
      { id: 'session-json', source: 'SESSION', kind: 'json', label: 'decoded', value: decodedSession, annotation: '`" b"` 값을 Base64 디코딩해 정적 분석합니다.' },
      { id: 'pickletools', source: 'PICKLETOOLS', kind: 'pickle', label: 'disassembly', value: pickleOps, annotation: '`client_secret` 필드 다음 bytes가 후보입니다.' },
    ],
    options: [
      { id: 'pickle_client_secret', label: PUBLIC_DEMO_SECRET, technical: 'LabOAuthFlow.client_secret', detail: '공개 demo pickle 객체 안의 OAuth-style credential입니다.', observation: { beginner: 'demo cookie 서명을 검증할 후보를 얻었습니다.', advanced: 'credential recovered from opcode 147' } },
      { id: 'client_id', label: 'public-client.apps.example', technical: 'OAuth client_id', detail: '공개 식별자는 서명키 후보가 아닙니다.', observation: { beginner: 'HMAC 검증이 일치하지 않습니다.', advanced: 'signature mismatch' } },
      { id: 'csrf_token', label: 'issued-state', technical: 'state token', detail: '요청 상관관계 값이며 장기 secret이 아닙니다.', observation: { beginner: '서명 검증용 장기 키가 아닙니다.', advanced: 'not a signing key' } },
    ],
  },
  sh_forge: {
    phase: 'BUILD', team: 'RED', prompt: 'callback의 state lookup을 만족하는 세션 구조를 선택하세요.',
    criterion: { beginner: 'CSRF state와 `google_oauth2_flow_<state>` suffix가 같아야 합니다.', advanced: 'Satisfy the callback state-to-flow-key contract.' },
    evidence: [
      { id: 'callback-code', source: 'CALLBACK', kind: 'code', label: 'lookup', value: 'state = request.args["state"]\nflow_blob = session[f"google_oauth2_flow_{state}"]\npickle.loads(flow_blob)', annotation: '요청 state가 session key 이름을 결정합니다.' },
      { id: 'forge-shape', source: 'SESSION', kind: 'json', label: 'candidate', value: '{\n  "google_oauth2_csrf_token": "attacker-chosen",\n  "google_oauth2_flow_attacker-chosen": { " b": "<safe pickle>" }\n}', annotation: '두 위치의 state가 일치합니다.' },
    ],
    options: [
      { id: 'matching_state_flow', label: 'state와 flow suffix 일치', technical: 'state="attacker-chosen"; key="google_oauth2_flow_attacker-chosen"', detail: 'callback lookup이 공격자 소유 bytes에 도달합니다.', observation: { beginner: '서명 검증 뒤 pickle sink까지 데이터 흐름이 연결됩니다.', advanced: 'lookup contract satisfied' } },
      { id: 'mismatched_state', label: '서로 다른 state', technical: 'state="A"; key="..._B"', detail: 'callback이 flow key를 찾지 못합니다.', observation: { beginner: '`invalid_state` 대조군이 됩니다.', advanced: 'lookup miss' } },
      { id: 'missing_flow', label: 'flow key 생략', technical: 'no google_oauth2_flow_*', detail: '유효 서명이어도 역직렬화 입력이 없습니다.', observation: { beginner: '`missing_flow` 대조군이 됩니다.', advanced: 'missing input' } },
    ],
  },
  sh_gadget: {
    phase: 'BUILD', team: 'RED', prompt: '운영 명령 없이 역직렬화 실행을 입증할 안전한 pickle 동작을 선택하세요.',
    criterion: { beginner: '응답 시간과 인자 N의 상관관계로 `REDUCE` 실행을 입증합니다.', advanced: 'Choose a bounded, non-destructive execution oracle.' },
    evidence: [
      { id: 'opcode', source: 'PICKLETOOLS', kind: 'pickle', label: 'complete server-owned safe pickle', value: safePickleOps, annotation: '실제 protocol 4 opcode입니다. lab에서는 50ms로 고정하며 shell·파일·네트워크를 사용하지 않습니다.' },
      { id: 'controls', source: 'TEST PLAN', kind: 'timing', label: 'negative controls', value: 'no cookie → reject\nflipped signature → reject\nwrong state → reject\nsleep pickle → bounded delay', annotation: '단일 느린 응답이 아니라 음성 대조와 비교합니다.' },
    ],
    options: [
      { id: 'bounded_sleep_reduce', label: 'time.sleep(0.05)', technical: 'GLOBAL + REDUCE', detail: '비파괴 timing proof입니다.', observation: { beginner: 'callback의 pickle.loads 실행을 시간차로 확인합니다.', advanced: 'bounded oracle selected' } },
      { id: 'shell_command', label: 'os.system("id")', technical: 'shell execution', detail: '교육용 lab에서도 불필요하고 위험합니다.', observation: { beginner: '안전 정책에 의해 선택해서는 안 됩니다.', advanced: 'unsafe proof method' } },
      { id: 'network_callback', label: 'external callback', technical: 'socket.connect', detail: '외부 네트워크 proof는 격리 경계를 벗어납니다.', observation: { beginner: '안전 정책에 의해 선택해서는 안 됩니다.', advanced: 'out-of-scope egress' } },
    ],
  },
  sh_guard: {
    phase: 'BUILD', team: 'BLUE', prompt: '유출 OAuth credential이 세션 무결성까지 무너뜨리지 않게 할 즉시 control을 선택하세요.',
    criterion: { beginner: 'OAuth credential과 Flask signing key의 역할을 분리합니다.', advanced: 'Break credential-role reuse before evaluating the sink.' },
    evidence: [
      { id: 'config', source: 'CONFIG', kind: 'code', label: 'current', value: 'app.secret_key = oauth_client_secret', annotation: '한 값이 OAuth와 session signing 두 역할을 가집니다.' },
      { id: 'hmac', source: 'SIGNATURE', kind: 'code', label: 'Flask / itsdangerous settings', value: 'salt = "cookie-session"\nkey_derivation = "hmac"\ndigest_method = SHA-1\nserializer.loads(complete_demo_cookie) → ACCEPT', annotation: '공개 demo client_secret을 app.secret_key로 설정했을 때 실제 serializer가 쿠키를 검증합니다.' },
    ],
    options: [
      { id: 'separate_session_key', label: '독립 server-side SECRET_KEY', technical: '- SECRET_KEY = oauth_client_secret\n+ SECRET_KEY = random_server_secret', detail: '노출 OAuth secret으로 새 세션을 서명할 수 없게 합니다.', observation: { beginner: 'credential 역할 재사용이 끊어집니다.', advanced: 'key domains separated' } },
      { id: 'rotate_same_secret', label: 'OAuth secret만 교체 후 재사용', technical: 'SECRET_KEY = new_oauth_client_secret', detail: '새 값도 쿠키 안에 다시 노출되면 같은 문제가 반복됩니다.', observation: { beginner: '역할 재사용 구조가 남습니다.', advanced: 'reuse persists' } },
      { id: 'httponly_only', label: 'HttpOnly 추가', technical: 'Set-Cookie: HttpOnly', detail: 'HTTP 응답을 받은 클라이언트가 자기 쿠키를 분석하는 것을 막지 못합니다.', observation: { beginner: 'XSS 완화일 뿐 기밀성이나 서명키 재사용을 해결하지 않습니다.', advanced: 'wrong boundary' } },
    ],
  },
  sh_control: {
    phase: 'DUEL', team: 'RED', prompt: '지연이 네트워크 잡음이 아니라 pickle 실행임을 입증할 대조 세트를 선택하세요.',
    criterion: { beginner: '서명·state·정상 flow 대조군과 여러 sleep 값을 비교합니다.', advanced: 'Choose controls that isolate deserialization as the causal variable.' },
    evidence: [
      { id: 'timings', source: 'CALLBACK', kind: 'timing', label: 'engine observation', value: 'baseline 실행 뒤 실제 timing과 control 결과가 이 카드에 삽입됩니다.', annotation: '고정 50ms bounded sleep과 동일 프로세스의 음성 대조를 비교합니다.' },
      { id: 'rejects', source: 'CALLBACK', kind: 'log', label: 'required controls', value: 'no cookie → invalid_session\nflipped signature → invalid_session\nwrong state → invalid_state\nmissing flow → missing_flow\nreal flow → normal path\nbounded sleep → proof', annotation: '각 항목은 같은 callback evaluator에서 실제 실행됩니다.' },
    ],
    options: [
      { id: 'timing_and_negative_controls', label: 'bounded sleep + 5 controls', technical: 'no-cookie/signature/state/flow/normal + sleep(0.05)', detail: '고정 지연과 다섯 대조군으로 sink 실행과 다른 원인을 구분합니다.', observation: { beginner: '실제 callback evaluator의 여섯 결과가 모두 기대값과 일치합니다.', advanced: 'six callback controls complete' } },
      { id: 'single_slow_request', label: '느린 요청 1개', technical: 'one sample', detail: '네트워크 변동과 구분할 수 없습니다.', observation: { beginner: '증거가 부족합니다.', advanced: 'insufficient control' } },
      { id: 'status_only', label: 'HTTP status만 비교', technical: 'status code', detail: '역직렬화 중 실행 여부를 시간 상관관계 없이 입증하기 어렵습니다.', observation: { beginner: '실행 oracle이 부족합니다.', advanced: 'weak oracle' } },
    ],
  },
  sh_patch: {
    phase: 'DUEL', team: 'BLUE', prompt: 'secret reuse와 client-controlled pickle을 모두 제거할 patch bundle을 선택하세요.',
    criterion: { beginner: '독립 키, server-side flow, data-only schema가 함께 필요합니다.', advanced: 'Remove both integrity collapse and the unsafe client-boundary sink.' },
    evidence: [
      { id: 'chain', source: 'DATA FLOW', kind: 'code', label: 'current', value: 'cookie[pickle(client_secret)]\n  → leaked secret signs cookie\n  → callback pickle.loads(cookie bytes)', annotation: '두 trust failure가 연결되어 있습니다.' },
      { id: 'regression', source: 'TEST PLAN', kind: 'log', label: 'required', value: 'OAuth-secret forgery → REJECT\nvalid-key pickle → INERT\nnormal OAuth flow → PASS', annotation: '알려진 secret만 막는 패치는 두 번째 회귀에서 실패합니다.' },
    ],
    options: [
      { id: 'hide_errors', label: '오류 메시지 숨김', technical: '- detailed_error\n+ invalid_request', detail: '서명키 재사용과 pickle sink가 그대로입니다.', observation: { beginner: '공격 체인은 변하지 않습니다.', advanced: 'no trust-boundary fix' } },
      { id: 'separate_secret_only', label: 'SECRET_KEY만 분리', technical: '- SECRET_KEY = oauth_secret\n+ SECRET_KEY = server_secret', detail: '현재 OAuth-secret 위조는 막지만 유효 서명 pickle의 sink는 남습니다.', observation: { beginner: '즉시 containment지만 unsafe deserialization 잔여 위험이 있습니다.', advanced: 'residual sink' } },
      { id: 'pickle_blacklist', label: 'REDUCE 문자열 차단', technical: '+ if b"REDUCE" in blob: reject()', detail: 'pickle opcode는 문자열 검색으로 안전하게 검증할 수 없습니다.', observation: { beginner: 'binary opcode/다른 gadget에 우회됩니다.', advanced: 'syntax filter bypassed' } },
      { id: 'server_side_json_bundle', label: '독립 키 + server-side flow + schema', technical: '- cookie stores pickled flow\n+ cookie stores opaque flow_id\n- pickle.loads\n+ FlowSchema.validate', detail: '클라이언트 경계에서 credential과 executable serialization을 제거합니다.', observation: { beginner: '공격·variant를 막고 정상 OAuth 흐름을 유지합니다.', advanced: 'chain removed' } },
    ],
  },
});

export const correct = Object.freeze({
  sh_surface: 'signed_not_encrypted', sh_anomaly: 'secret_reuse',
  sh_decode: 'base64_zlib_tagged_json', sh_secret: 'pickle_client_secret',
  sh_forge: 'matching_state_flow', sh_gadget: 'bounded_sleep_reduce',
  sh_guard: 'separate_session_key', sh_control: 'timing_and_negative_controls',
  sh_patch: 'server_side_json_bundle',
});

export function preview(choices) {
  const state = choices.sh_forge === 'matching_state_flow' ? 'attacker-chosen' : '[STATE]';
  const flowKey = choices.sh_forge === 'matching_state_flow'
    ? 'google_oauth2_flow_attacker-chosen'
    : 'google_oauth2_flow_[STATE]';
  const decode = choices.sh_decode === 'base64_zlib_tagged_json'
    ? 'strip "." → base64url → zlib → TaggedJSON'
    : '[DECODE PIPELINE]';
  const secret = choices.sh_secret === 'pickle_client_secret' ? '<recovered client_secret>' : '[SIGNING KEY]';
  return {
    title: 'SESSION FORGE',
    request: `GET /oauth2callback?state=${state}&code=demo HTTP/1.1\nHost: devsite-lab.invalid\nCookie: session=<forged with ${secret}>`,
    trace: [
      `DECODE    ${decode}`,
      `SESSION   csrf=${state}`,
      `FLOW KEY  ${flowKey}`,
      `PICKLE    ${choices.sh_gadget === 'bounded_sleep_reduce' ? 'GLOBAL time.sleep; REDUCE(0.05)' : '[SAFE GADGET]'}`,
    ],
  };
}

function publicTask(taskId, context) {
  const task = publicTaskFrom(tasks, taskId, context);
  if (taskId !== 'sh_control' || !Array.isArray(context?.execution?.controls)) return task;
  const observed = context.execution.controls.map((control) => {
    const timing = Number.isFinite(control.timingMs) ? ` ${control.timingMs.toFixed(1)}ms` : '';
    return `${control.id ?? 'control'} → ${control.passed ? 'PASS' : 'FAIL'} / ${control.reason ?? 'unknown'}${timing}`;
  }).join('\n');
  return {
    ...task,
    evidence: task.evidence.map((item) => item.id === 'timings'
      ? { ...item, value: `bounded callback: ${context.execution.timingMs ?? '?'}ms\n${observed}` }
      : item),
  };
}

export const scenario = Object.freeze({
  ...metadata,
  tasks,
  correct,
  publicTask,
  validateChoice: (taskId, choice) => validateTaskChoice(tasks, taskId, choice),
  taskIdsFor: (phase, team) => taskIdsForPhaseTeam(tasks, phase, team),
  aggregate: (actions) => aggregateTaskChoices(tasks, actions),
  preview,
  baselineInput: (choices) => ({
    surface: choices.sh_surface,
    decode: choices.sh_decode,
    secret: choices.sh_secret,
    forge: choices.sh_forge,
    gadget: choices.sh_gadget,
  }),
  patchInput: (choices) => ({ patch: choices.sh_patch, control: choices.sh_control }),
  explanation: () => [
    'Flask signed cookie는 읽을 수 있었고 그 안의 pickled OAuth flow가 client_secret을 노출했습니다.',
    '동일한 secret이 session signing에도 재사용되어 공격자가 유효한 state/flow 세션을 위조했습니다.',
    '독립 signing key, server-side flow state, data-only schema로 client-controlled pickle sink를 제거해야 합니다.',
  ],
  scores(choices) {
    return {
      RED: scoreChoices(correct, choices, Object.keys(tasks).filter((id) => tasks[id].team === 'RED')),
      BLUE: scoreChoices(correct, choices, Object.keys(tasks).filter((id) => tasks[id].team === 'BLUE')),
    };
  },
});
