import { EXPANDED_QUESTIONS } from './expanded-questions.mjs';
import { CIRCUIT_QUESTIONS } from './circuit-questions.mjs';

export const QUESTION_CATEGORIES = Object.freeze({
  IDENTITY: '계정 · 인증', DEVICE: '기기 · 복구', WEB_APP: '웹 · 앱 보안',
  CLOUD_SUPPLY: '클라우드 · 공급망', INCIDENT: '업무 · 사고 대응',
});
export const QUESTION_STAGES = Object.freeze({ LAUNCH: 'LAUNCH', SECTOR: 'SECTOR', PIT: 'PIT', SPRINT: 'SPRINT' });
const e = (label, value, annotation) => Object.freeze({ label, value, ...(annotation ? { annotation } : {}) });
const o = (id, label, technical, feedback) => Object.freeze({ id, label, technical, feedback });
const TRACKS_BY_CATEGORY = Object.freeze({
  IDENTITY: Object.freeze(['human-firewall']), DEVICE: Object.freeze(['human-firewall', 'secure-builder']),
  WEB_APP: Object.freeze(['secure-builder']), CLOUD_SUPPLY: Object.freeze(['secure-builder']),
  INCIDENT: Object.freeze(['human-firewall']),
});
const DEFAULT_REFERENCES = Object.freeze({
  IDENTITY: Object.freeze([{ title: 'NIST SP 800-63B-4 Authentication and Authenticator Management', url: 'https://pages.nist.gov/800-63-4/sp800-63b.html' }]),
  DEVICE: Object.freeze([{ title: 'CISA Secure Our World', url: 'https://www.cisa.gov/secure-our-world' }]),
  WEB_APP: Object.freeze([{ title: 'OWASP Top 10', url: 'https://owasp.org/www-project-top-ten/' }]),
  CLOUD_SUPPLY: Object.freeze([{ title: 'NIST SP 800-218 Secure Software Development Framework', url: 'https://csrc.nist.gov/pubs/sp/800/218/final' }]),
  INCIDENT: Object.freeze([{ title: 'NIST SP 800-61 Rev. 3 Incident Response Recommendations', url: 'https://csrc.nist.gov/pubs/sp/800/61/r3/final' }]),
});
const rotate = (values, amount) => {
  const offset = ((amount % values.length) + values.length) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
};
const optionOffset = (id) => [...id].reduce((sum, character) => sum + character.codePointAt(0), 0) % 4;
const q = (id, category, topic, stages, question, beginner, advanced, options, answerId, takeaway, references = []) => {
  const sourceReferences = references.length ? references : DEFAULT_REFERENCES[category];
  const frozenReferences = Object.freeze(sourceReferences.map((reference) => Object.freeze({ ...reference })));
  const beginnerOptions = rotate(options.map((x) => o(...x)), optionOffset(id));
  const advancedOptions = rotate(options.map(([optionId, label, technical, feedback]) => o(
    optionId,
    `${technical || label} · 공격 흐름 기준`,
    `${label} · ${technical || 'technical decision'}`,
    `고급 검토: ${feedback}`,
  )), optionOffset(id) + 1);
  const beginnerTier = stages.includes(QUESTION_STAGES.PIT) || stages.includes(QUESTION_STAGES.SPRINT)
    ? 'APPLIED' : 'FOUNDATION';
  const advancedTier = stages.includes(QUESTION_STAGES.PIT) || stages.includes(QUESTION_STAGES.SPRINT)
    ? 'ANALYST' : 'APPLIED';
  const variants = Object.freeze({
    BEGINNER: Object.freeze({
      question,
      evidence: Object.freeze(beginner.map((x) => e(...x))),
      options: Object.freeze(beginnerOptions),
      answerId,
      correctOptionId: answerId,
      takeaway,
      explanation: takeaway,
      references: frozenReferences,
      serverTier: beginnerTier,
    }),
    ADVANCED: Object.freeze({
      question: `${topic}: 아래 요청·로그·권한 증거에서 확인되는 공격 경로 또는 통제 실패를 가장 직접적으로 끊는 판단은 무엇인가?`,
      evidence: Object.freeze(advanced.map((x) => e(...x))),
      options: Object.freeze(advancedOptions),
      answerId,
      correctOptionId: answerId,
      takeaway: `고급 분석: ${takeaway}`,
      explanation: `고급 분석: ${takeaway}`,
      references: frozenReferences,
      serverTier: advancedTier,
    }),
  });
  return Object.freeze({
    id,
    conceptId: id,
    topicFamily: id,
    category,
    topic,
    tracks: TRACKS_BY_CATEGORY[category],
    stages: Object.freeze(stages),
    variants,
    question: variants.BEGINNER.question,
    evidence: Object.freeze({ BEGINNER: variants.BEGINNER.evidence, ADVANCED: variants.ADVANCED.evidence }),
    options: variants.BEGINNER.options,
    answerId,
    correctOptionId: answerId,
    takeaway,
    explanation: takeaway,
    references: frozenReferences,
    serverTiers: Object.freeze({ BEGINNER: beginnerTier, ADVANCED: advancedTier }),
  });
};
const { LAUNCH, SECTOR, PIT, SPRINT } = QUESTION_STAGES;
const legacyQuestions = [
  q('identity-password-reuse', 'IDENTITY', '비밀번호 재사용', [LAUNCH, SECTOR], '이 계정의 추가 탈취 가능성을 가장 크게 줄이는 조치는?',
    [['유출 알림', '외부 쇼핑몰에서 user@company.kr 비밀번호 유출', '같은 비밀번호를 쓴 다른 서비스도 자동 대입 공격을 받을 수 있습니다.'], ['사용자 진술', '회사 메일과 쇼핑몰에 같은 비밀번호 사용', '한 곳의 사고가 여러 계정으로 번지는 상태입니다.']],
    [['breach-monitor', 'principal=user@company.kr source=external-shop credential=password'], ['interview', 'credential_reuse=mail,external-shop']],
    [['rotate-unique', '두 계정의 비밀번호를 각각 고유하게 바꾸고 비밀번호 관리자를 사용한다', 'unique credentials + password manager', '정답입니다. 한 곳에서 유출된 비밀번호가 다른 서비스에 통하지 않게 재사용 고리를 끊습니다.'], ['add-symbol', '모든 계정에 기존 비밀번호와 같은 어근을 유지한 기호·숫자 변형을 각각 적용한다', 'same-root credential mutation across accounts', '규칙적인 변형은 쉽게 추측되고 재사용 문제도 남습니다.'], ['mail-only', '회사 메일 비밀번호만 바꾼다', 'partial rotation', '유출된 자격 증명을 쓴 전체 계정을 처리하지 못합니다.'], ['hide-alert', '유출 알림을 삭제한다', 'dismiss alert', '알림 삭제는 노출된 자격 증명을 무효화하지 않습니다.']],
    'rotate-unique', '서비스마다 고유한 비밀번호를 쓰고, 유출 시 재사용된 모든 계정을 함께 교체합니다.'),
  q('identity-phishing-resistant-mfa', 'IDENTITY', '피싱 방지 인증', [LAUNCH, SECTOR], '가짜 로그인 페이지에 속아도 인증 정보를 넘기기 가장 어려운 방식은?',
    [['피싱 화면', '공격자가 비밀번호와 6자리 코드를 실시간 중계', '사용자가 입력할 수 있는 코드는 가짜 사이트에도 입력할 수 있습니다.'], ['보안 요구', '정식 사이트 주소와 인증을 묶어야 함', '사이트가 바뀌면 인증 자체가 실패해야 합니다.']],
    [['attack', 'adversary-in-the-middle; credential+TOTP relay'], ['requirement', 'verifier-bound, origin-bound authentication']],
    [['passkey', '정식 도메인에 바인딩된 패스키/FIDO2를 사용한다', 'WebAuthn / FIDO2', '정답입니다. 패스키는 검증자 이름 바인딩으로 피싱 사이트에서 재사용하기 어렵습니다.'], ['sms', '문자 코드와 비밀번호를 서로 다른 기기에서 확인하고 순서대로 입력한다', 'password + SMS OTP on separate devices', '문자 코드는 피싱 사이트에 입력되거나 중계될 수 있습니다.'], ['totp', '앱의 6자리 일회용 코드를 사용한다', 'TOTP', 'TOTP도 가짜 사이트에 입력하면 실시간 중계될 수 있습니다.'], ['question', '기억하기 쉬운 보안 질문을 추가한다', 'knowledge-based auth', '추측 가능한 지식 기반 질문은 피싱 방지 수단이 아닙니다.']],
    'passkey', 'MFA의 개수보다 피싱 저항성이 중요합니다. 가능하면 패스키/FIDO2를 우선합니다.', [{ title: 'FIDO Alliance Passkeys', url: 'https://fidoalliance.org/passkeys/' }]),
  q('identity-oauth-consent', 'IDENTITY', 'OAuth 동의 피싱', [SECTOR, PIT], '업무 파일 접근 권한을 요구하는 이 앱에 가장 안전하게 대응하려면?',
    [['앱 이름', 'Payroll Preview 2026 · 사내 승인 목록에 없음', '승인되지 않은 앱입니다.'], ['요구 권한', '모든 파일 읽기 · 오프라인 접근', '기능보다 훨씬 넓고 오래가는 권한입니다.']],
    [['client', 'publisher=unverified; tenant_allowlist=false'], ['scope', 'Files.Read.All offline_access']],
    [['reject-report', '동의를 거부하고 보안팀에 앱과 요청 URL을 신고한다', 'deny consent + report', '정답입니다. 과도한 권한 부여를 막고 조사 근거를 남깁니다.'], ['approve-once', '업무 필요성을 확인한 뒤 모든 파일 권한을 한 번만 쓸 목적으로 승인한다', 'one-time broad consent after business-purpose review', '오프라인 권한은 브라우저를 닫아도 지속될 수 있습니다.'], ['remove-icon', '승인한 뒤 앱 아이콘만 삭제한다', 'hide app', '아이콘을 지워도 권한과 토큰은 취소되지 않습니다.'], ['share-link', '동료도 필요한지 확인하려고 링크를 전달한다', 'propagate lure', '검증되지 않은 동의 링크를 확산시킵니다.']],
    'reject-report', 'OAuth 동의도 권한 부여입니다. 게시자·업무 필요성·요구 범위를 확인합니다.'),
  q('identity-qr-phishing', 'IDENTITY', 'QR 피싱', [LAUNCH, SECTOR], '메일의 QR 코드가 “계정 만료”를 경고할 때 가장 안전한 다음 행동은?',
    [['메일', '10분 안에 QR로 로그인하지 않으면 계정 만료', '긴급함을 강조해 확인 절차를 건너뛰게 합니다.'], ['QR 미리보기', 'https://company-login.help/...', '공식 도메인 company.kr과 다릅니다.']],
    [['message', 'urgency=10m; action=scan_qr'], ['decoded-uri', 'https://company-login.help/auth']],
    [['official-entry', 'QR을 쓰지 않고 저장된 공식 포털 주소나 앱에서 상태를 확인한다', 'trusted-path verification', '정답입니다. 메일과 분리된 신뢰 가능한 진입점에서 확인합니다.'], ['scan-phone', '휴대폰의 브라우저 보호 기능을 켠 뒤 QR을 스캔하고 로그인 주소를 확인한다', 'scan first, then rely on mobile browser protection', 'QR은 링크를 숨길 뿐이며 휴대폰도 피싱 대상입니다.'], ['reply-password', '발신 메일에 비밀번호를 답장한다', 'send credential', '정상 서비스도 답장으로 비밀번호를 요구하지 않습니다.'], ['share-group', '동료 단체방에 QR 이미지를 공유한다', 'propagate lure', '의심 링크를 다른 사람에게 확산시킵니다.']],
    'official-entry', 'QR도 링크입니다. 디코딩된 목적지와 독립된 공식 경로를 확인합니다.'),
  q('identity-stolen-session', 'IDENTITY', '세션 탈취', [PIT, SPRINT], '비밀번호를 바꾼 뒤에도 낯선 브라우저 세션이 살아 있다. 가장 직접적인 추가 조치는?',
    [['계정 보안', '비밀번호 변경 완료', '서비스가 기존 세션을 자동 종료하지 않았습니다.'], ['활성 세션', 'Unknown Chrome · 마지막 활동 1분 전', '탈취된 세션 토큰이 아직 유효할 수 있습니다.']],
    [['credential', 'password_rotated=true'], ['session', 'sid=unknown-browser valid=true last_seen=60s']],
    [['revoke-sessions', '모든 기존 세션과 토큰을 폐기하고 다시 로그인한다', 'global session/token revocation', '정답입니다. 이미 탈취된 세션 토큰을 직접 무효화합니다.'], ['password-again', '모든 서비스 비밀번호를 다시 바꾸고 새 브라우저에서 계정에 로그인한다', 'second credential rotation from a clean browser', '증거상 비밀번호 변경이 세션을 끊지 않았습니다.'], ['clear-cache', '내 브라우저 캐시만 지운다', 'local cache clear', '공격자 쪽 서버 세션은 폐기되지 않습니다.'], ['wait', '자연 만료될 때까지 기다린다', 'passive expiry', '그동안 공격자가 계속 접근할 수 있습니다.']],
    'revoke-sessions', '비밀번호와 세션은 별개일 수 있습니다. 교체와 세션·토큰 폐기를 함께 수행합니다.'),
  q('identity-helpdesk-reset', 'IDENTITY', '헬프데스크 사칭', [SECTOR, SPRINT], '“임원”이 전화로 긴급 MFA 초기화를 요구한다. 헬프데스크의 올바른 대응은?',
    [['통화', '목소리는 비슷하지만 등록되지 않은 번호', '목소리와 직급만으로 신원을 확인할 수 없습니다.'], ['요청', '정상 절차를 생략하고 새 휴대폰 등록', '보안 절차 우회 자체가 위험 신호입니다.']],
    [['caller', 'claimed_role=executive; phone=unregistered'], ['request', 'bypass_verification=true; enroll_new_mfa=true']],
    [['independent-verify', '요청을 보류하고 등록된 연락처와 정식 절차로 독립 검증한다', 'out-of-band identity verification', '정답입니다. 공격자가 통제하지 않는 채널과 정식 절차로 검증합니다.'], ['trust-voice', '등록되지 않은 번호라도 목소리와 임원 일정이 맞으면 즉시 초기화한다', 'voice and schedule corroboration without registered-channel callback', '목소리는 흉내 내거나 합성할 수 있습니다.'], ['birthday', '생년월일만 묻는다', 'weak knowledge check', '공개 정보 하나로는 신원 검증이 되지 않습니다.'], ['temp-code', '통화 중 임시 코드를 불러 준다', 'disclose recovery code', '확인되지 않은 호출자에게 복구 수단을 넘깁니다.']],
    'independent-verify', '긴급함·직급·익숙한 목소리는 인증이 아닙니다. 정해진 독립 검증 절차를 지킵니다.'),

  q('device-patch-priority', 'DEVICE', '패치 우선순위', [PIT, SPRINT], '제한된 시간에 어떤 항목을 먼저 패치해야 하는가?',
    [['취약점 A', 'CVSS 9.8 · 내부 테스트 서버 · 외부 비노출 · 악용 증거 없음', '점수는 높지만 현재 공격 경로가 제한됩니다.'], ['취약점 B', 'CVSS 8.1 · 인터넷 공개 VPN · 실제 악용 확인 · 관리자 권한 영향', '이미 공격되고 있고 중요한 시스템이 노출됐습니다.']],
    [['A', 'cvss=9.8; exposure=internal; exploitation=none-observed'], ['B', 'cvss=8.1; exposure=internet; exploitation=confirmed; impact=admin']],
    [['patch-b', 'B를 우선 완화·패치하고 A도 계획에 따라 처리한다', 'risk-based prioritization', '정답입니다. 실제 악용, 외부 노출, 자산 영향이 결합된 B의 현재 위험이 더 큽니다.'], ['patch-a', '인터넷 노출 여부와 무관하게 CVSS가 더 높은 A부터 우선 패치한다', 'CVSS-first prioritization without exposure context', 'CVSS만으로 현재 노출과 실제 악용 가능성을 대체할 수 없습니다.'], ['neither', '둘 다 10.0이 아니므로 다음 분기로 미룬다', 'defer remediation', '실제 악용 중인 인터넷 공개 취약점을 방치합니다.'], ['hide-banner', 'VPN 제품 배너만 숨긴다', 'security by obscurity', '제품 식별만 어렵게 할 뿐 취약 코드를 제거하지 않습니다.']],
    'patch-b', '패치 우선순위는 실제 악용, 노출, 자산 중요도, 영향과 보완 통제를 함께 봅니다.', [{ title: 'CISA KEV Catalog', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog' }]),
  q('device-backup-restore', 'DEVICE', '백업 복구 검증', [SECTOR, PIT], '랜섬웨어 대비가 실제로 작동하는지 가장 잘 확인하는 방법은?',
    [['대시보드', '매일 백업 작업 성공', '파일 저장 기록만으로 복구 가능성까지 보장되지는 않습니다.'], ['운영 기록', '최근 12개월 복구 훈련 없음', '필요한 시간과 절차를 실제 확인하지 못했습니다.']],
    [['backup-job', 'status=success; daily=true'], ['recovery-test', 'last_test=none_in_12_months; rto=unknown; rpo=unknown']],
    [['restore-test', '격리된 환경에서 정기적으로 복구하고 무결성·RTO·RPO를 확인한다', 'isolated restore exercise', '정답입니다. 백업이 읽히고 목표 시간·시점에 복구되는지 검증합니다.'], ['trust-green', '최근 백업 작업이 성공으로 표시됐으므로 대시보드 기록과 파일 목록만 확인한다', 'job-status and inventory review without restore exercise', '작업 성공은 전체 복구 성공을 증명하지 않습니다.'], ['same-share', '운영 서버와 같은 공유 폴더에 한 벌 더 복사한다', 'co-located copy', '같은 장애와 권한 범위에서 함께 손상될 수 있습니다.'], ['screenshot', '백업 파일 목록을 캡처해 둔다', 'inventory screenshot', '목록은 파일 내용과 복구 가능성을 검증하지 않습니다.']],
    'restore-test', '백업은 존재가 아니라 복구 성공으로 검증하며 격리·불변 복사본과 정기 훈련을 갖춥니다.'),
  q('device-browser-extension', 'DEVICE', '브라우저 확장 권한', [LAUNCH, SECTOR], '쿠폰 확장 프로그램 설치 전 가장 합리적인 판단은?',
    [['기능', '쇼핑몰에서 쿠폰 코드 표시', '일부 쇼핑 페이지 접근은 관련될 수 있습니다.'], ['요구 권한', '방문하는 모든 사이트의 데이터 읽기 및 변경', '메일·사내 포털까지 읽을 수 있는 넓은 권한입니다.']],
    [['declared-purpose', 'coupon suggestions on shopping sites'], ['permission', '<all_urls>; read_and_change_site_data']],
    [['decline-review', '설치를 보류하고 게시자·권한 필요성·제한 가능한 대안을 검토한다', 'least-privilege review', '정답입니다. 기능 대비 과도한 권한을 확인하고 제한적인 대안을 찾습니다.'], ['rating', '사용자 수와 별점이 높고 스토어 심사를 통과했으므로 업무용 브라우저에 바로 설치한다', 'store reputation and review as authorization basis', '평점은 현재 코드와 권한의 안전성을 보증하지 않습니다.'], ['incognito', '시크릿 모드에서만 쓰면 권한이 사라진다', 'misunderstood incognito', '시크릿 모드는 확장 권한을 자동으로 안전하게 만들지 않습니다.'], ['popup', '팝업 알림만 끄고 설치한다', 'notification setting', '알림 설정은 사이트 데이터 권한과 무관합니다.']],
    'decline-review', '확장 프로그램도 코드입니다. 게시자, 업데이트 기록, 요구 권한과 업무 필요성을 확인합니다.'),
  q('device-lost-phone', 'DEVICE', '분실 기기 대응', [PIT, SPRINT], '업무용 휴대폰을 택시에 두고 내렸을 때 가장 먼저 해야 할 대응 묶음은?',
    [['기기 상태', '회사 MDM 등록 · 메일 로그인 상태 · 화면 잠금 설정', '원격 잠금이 가능하지만 활성 세션도 따로 처리해야 합니다.'], ['분실 시점', '약 10분 전', '추측보다 신속한 신고와 계정 보호가 우선입니다.']],
    [['endpoint', 'managed=true; mail_session=active; screen_lock=true'], ['event', 'lost; elapsed=10m']],
    [['report-lock-revoke', '즉시 신고하고 MDM 원격 잠금·필요 시 삭제와 업무 세션 폐기를 진행한다', 'report + MDM contain + revoke', '정답입니다. 기기와 계정 양쪽의 접근을 신속히 차단합니다.'], ['wait', '하루 기다렸다가 못 찾으면 신고한다', 'delayed response', '활성 세션이 있는 기기를 방치해 대응 시간을 잃습니다.'], ['call-only', '전화 연결과 위치 찾기 기능을 먼저 확인하고 응답이 없으면 퇴근 후 신고한다', 'recovery-first workflow with delayed enterprise containment', '찾기 시도와 별개로 신고·잠금·세션 폐기가 필요합니다.'], ['wallpaper', '클라우드에서 배경화면만 바꾼다', 'cosmetic action', '배경화면은 업무 데이터 접근을 차단하지 않습니다.']],
    'report-lock-revoke', '분실 기기는 신고, 원격 기기 통제, 세션·토큰 폐기를 함께 수행합니다.'),
  q('device-ransomware-first', 'DEVICE', '랜섬웨어 초동 대응', [PIT, SPRINT], '파일 확장자가 바뀌고 랜섬 노트가 나타난 PC의 첫 대응으로 가장 적절한 것은?',
    [['현상', '공유 폴더 파일 이름이 빠르게 변경 중', '다른 시스템으로 확산될 가능성이 있습니다.'], ['대응 체계', '사내 사고 신고 채널과 격리 절차 존재', '혼자 해결하기보다 정해진 절차로 확산을 막아야 합니다.']],
    [['telemetry', 'mass_file_rename=true; network_share_writes=increasing'], ['playbook', 'IR_channel=available; endpoint_isolation=approved']],
    [['isolate-report', '네트워크에서 격리하고 즉시 대응팀에 신고해 증거를 보존한다', 'contain + escalate + preserve', '정답입니다. 확산을 줄이고 검증된 대응 절차를 시작합니다.'], ['pay', '개인 카드로 바로 몸값을 지불한다', 'unauthorized payment', '복구를 보장하지 않고 조직 절차를 우회합니다.'], ['delete-note', '랜섬 노트와 의심 파일을 삭제한 뒤 백신 전체 검사를 마치고 업무를 재개한다', 'local cleanup and antivirus scan before reconnecting', '악성 동작을 멈추지 못하고 조사 단서를 훼손할 수 있습니다.'], ['email-file', '동료에게 암호화된 파일을 이메일로 보낸다', 'propagate artifact', '의심 파일을 확산시키며 신고와 격리를 늦춥니다.']],
    'isolate-report', '랜섬웨어 징후에는 확산 차단, 신고, 증거 보존을 우선합니다.'),

  q('web-sql-injection', 'WEB_APP', 'SQL 인젝션', [SECTOR, PIT], '검색 API의 SQL 인젝션을 근본적으로 막는 코드 변경은?',
    [['현재 코드', 'SQL 문자열에 사용자 input을 직접 연결', '입력이 데이터가 아니라 SQL 문법으로 해석됩니다.'], ['재현', "input=' OR '1'='1 → 모든 행 반환", '조건식이 공격자 입력으로 바뀌었습니다.']],
    [['sink', 'db.query("... name = \'" + input + "\'")'], ['probe', "payload=' OR '1'='1; rows=all"]],
    [['parameterize', '준비된 문장/파라미터 바인딩으로 입력을 데이터로 전달한다', 'prepared statement', '정답입니다. 입력과 SQL 구조를 분리합니다.'], ['block-quote', '작은따옴표만 문자열 치환으로 삭제한다', 'blacklist filter', 'DB 문법과 인코딩에 따라 우회될 수 있습니다.'], ['hide-error', '오류 메시지만 숨긴다', 'suppress error', '취약한 SQL 실행은 그대로 남습니다.'], ['client-check', '브라우저 JavaScript에서 허용 문자와 숫자 형식을 모두 검사한 뒤 서버로 전송한다', 'comprehensive client-side allowlist validation', '공격자는 API 요청을 직접 보낼 수 있습니다.']],
    'parameterize', 'SQL 명령과 입력 데이터를 파라미터 바인딩으로 분리하고 서버 측 허용값 검증을 보완합니다.'),
  q('web-xss-output', 'WEB_APP', 'XSS', [SECTOR, PIT], '사용자 닉네임을 화면에 안전하게 표시하는 가장 적절한 변경은?',
    [['현재 코드', 'profile.innerHTML = nickname', '닉네임 속 HTML이 실행될 수 있습니다.'], ['요구사항', '서식 없이 일반 글자만 표시', 'HTML 해석 자체가 필요하지 않습니다.']],
    [['sink', 'element.innerHTML = untrustedNickname'], ['context', 'plain-text only; markup=false']],
    [['text-content', 'textContent 같은 텍스트 전용 API로 출력한다', 'safe text sink', '정답입니다. 값을 HTML이 아닌 텍스트로 취급합니다.'], ['strip-script', 'script 태그와 onerror 문자열을 입력 단계에서 삭제한 뒤 기존 HTML 출력을 유지한다', 'expanded tag and event-handler blacklist', '이벤트 핸들러 등 다른 표현을 놓칩니다.'], ['base64', 'Base64로 인코딩했다가 디코딩한다', 'reversible encoding', '디코딩 후 innerHTML에 넣으면 위험이 돌아옵니다.'], ['short-limit', '닉네임을 20자로 제한한다', 'length limit only', '짧은 XSS 페이로드도 가능합니다.']],
    'text-content', '출력 맥락에 맞는 안전한 API·인코딩을 사용하고 HTML이 필요할 때만 검증된 sanitizer를 사용합니다.'),
  q('web-csrf', 'WEB_APP', 'CSRF', [SECTOR, PIT], '로그인 쿠키를 쓰는 송금 요청의 CSRF 위험을 줄이는 핵심 조합은?',
    [['요청', 'POST /transfer · 브라우저가 세션 쿠키 자동 첨부', '다른 사이트가 요청을 유도할 수 있습니다.'], ['현재 검증', '금액만 확인 · 요청 출처 토큰 없음', '사용자가 의도한 요청인지 구분할 근거가 없습니다.']],
    [['endpoint', 'POST /transfer; auth=cookie; state_change=true'], ['controls', 'csrf_token=none; origin_check=none; SameSite=unset']],
    [['csrf-token', '서버 검증 CSRF 토큰과 적절한 SameSite/Origin 검증을 적용한다', 'anti-CSRF defenses', '정답입니다. 요청 의도를 검증하고 교차 사이트 쿠키 전송을 제한합니다.'], ['post-only', '민감 요청을 POST로 제한하고 로그인 쿠키와 폼 content-type이 맞는 요청만 처리한다', 'POST + authenticated cookie + form content-type gate', '공격 사이트도 POST를 유도할 수 있습니다.'], ['hide-button', '송금 버튼을 CSS로 숨긴다', 'UI concealment', 'UI 없이 HTTP 요청을 만들 수 있습니다.'], ['rename-path', '/transfer 경로를 복잡하게 바꾼다', 'obscure endpoint', '요청의 정당성을 검증하지 않습니다.']],
    'csrf-token', '상태 변경 요청은 서버 측 CSRF 토큰을 중심으로 SameSite와 Origin 검증을 함께 설계합니다.'),
  q('web-ssrf', 'WEB_APP', 'SSRF', [SECTOR, PIT], 'URL 미리보기 기능의 SSRF를 방어하는 가장 강한 설계는?',
    [['기능', '서버가 사용자가 입력한 URL을 직접 요청', '외부 사용자가 서버의 네트워크 위치를 이용합니다.'], ['재현', 'http://169.254.169.254 요청이 서버에서 성공', '클라우드 메타데이터 주소에 접근했습니다.']],
    [['fetcher', 'server_side_fetch(user_url)'], ['probe', 'target=169.254.169.254; response=200']],
    [['allowlist-egress', '필요 대상만 허용하고 해석 IP·리다이렉트마다 내부 IP를 차단하며 egress도 제한한다', 'allowlist + resolved-IP validation + egress', '정답입니다. 입력 검증과 네트워크 경계를 함께 적용합니다.'], ['localhost', 'localhost와 127.0.0.1 문자열을 차단하고 URL 파서가 허용한 주소만 요청한다', 'hostname/loopback string denylist + URL syntax validation', 'IP·IPv6·DNS 우회가 남습니다.'], ['https-only', 'HTTPS URL만 허용하고 최초 DNS 결과가 공개 IP인지 확인한 뒤 이후 리다이렉트는 그대로 따른다', 'scheme gate + one-time public-IP check before unrestricted redirects', 'HTTPS 내부 서비스나 리다이렉트에 접근할 수 있습니다.'], ['client-url', '브라우저에서 URL 형식만 검사한다', 'client-only validation', '직접 API 요청으로 우회됩니다.']],
    'allowlist-egress', 'SSRF는 최종 해석 IP, 리다이렉트, 허용 목적지와 네트워크 egress를 함께 통제합니다.'),
  q('web-idor', 'WEB_APP', '객체 단위 인가', [SECTOR, SPRINT], '다른 사용자의 주문서를 볼 수 있는 IDOR를 올바르게 고치는 방법은?',
    [['요청 A', 'GET /orders/4812 → 내 주문서', 'URL 숫자가 조회 객체를 고릅니다.'], ['요청 B', 'GET /orders/4813 → 다른 고객 주문서 200 OK', '로그인만 확인하고 소유권은 확인하지 않습니다.']],
    [['request', 'principal=userA; object=order:4813'], ['response', 'owner=userB; status=200; authorization_check=missing']],
    [['object-authz', '서버가 매 요청마다 현재 사용자의 해당 주문 접근 권한을 검사한다', 'object-level authorization', '정답입니다. 서버가 주체-객체 권한을 강제합니다.'], ['hide-id', '화면에서 주문 번호를 숨긴다', 'UI concealment', '네트워크 요청 식별자를 직접 바꿀 수 있습니다.'], ['uuid-only', '주문 번호를 예측하기 어려운 긴 UUID로 바꾸고 URL 화면에서는 직접 노출하지 않는다', 'opaque UUID plus hidden identifier without per-object authorization', '유출된 UUID에 대한 인가 부재는 남습니다.'], ['referer', 'Referer가 내 사이트인지 확인한다', 'referer-only check', 'Referer는 객체 소유권을 증명하지 않습니다.']],
    'object-authz', '식별자는 권한이 아닙니다. 서버가 모든 객체 접근의 사용자·역할·소유권을 검증합니다.'),
  q('web-frontend-secret', 'WEB_APP', '클라이언트 비밀정보', [SECTOR, PIT], '프런트엔드 번들에서 유료 API의 관리자 키가 발견됐다. 올바른 조치는?',
    [['번들', 'app.js 안에 ADMIN_API_KEY="sk_live_..."', '브라우저 코드는 누구나 내려받아 볼 수 있습니다.'], ['권한', '전체 고객 데이터 조회 가능', '공개되면 영향이 큰 서버용 자격 증명입니다.']],
    [['artifact', 'public/app.js contains live admin credential'], ['scope', 'customers:read:*; billing:write:*']],
    [['revoke-server', '키를 폐기·교체하고 서버 측 최소 권한 호출로 이동하며 로그를 조사한다', 'revoke + rotate + server mediation', '정답입니다. 키를 무효화하고 신뢰 경계를 서버로 옮깁니다.'], ['obfuscate', '키를 난독화하고 소스맵을 제거한 뒤 허용 도메인을 제한해 번들에 다시 넣는다', 'obfuscation + source-map removal + domain restriction', '브라우저가 쓸 수 있으면 공격자도 추출할 수 있습니다.'], ['rename', '변수 이름만 TOKEN_X로 바꾼다', 'rename secret', '이름 변경은 값과 권한을 숨기지 못합니다.'], ['source-map', '소스맵 파일만 삭제한다', 'remove source map', '번들 자체에 키가 남습니다.']],
    'revoke-server', '브라우저에 전달되는 값은 비밀이 아닙니다. 서버용 키는 폐기·회전하고 최소 권한으로 보관합니다.'),
  q('web-unsafe-deserialization', 'WEB_APP', '안전하지 않은 역직렬화', [PIT, SPRINT], '외부 입력을 복원하는 기능의 코드 실행 위험을 줄이는 가장 적절한 변경은?',
    [['현재 구현', '사용자가 보낸 직렬화 객체를 그대로 역직렬화', '복원 과정에서 특수 메서드가 실행될 수 있습니다.'], ['실제 필요', 'theme, language 두 문자열만 저장', '임의 객체를 복원할 이유가 없습니다.']],
    [['sink', 'deserialize(untrusted_bytes); class_allowlist=none'], ['schema', '{theme: enum, language: enum}']],
    [['data-schema', '실행 기능 없는 데이터 형식과 엄격한 스키마/허용값 검증으로 바꾼다', 'data-only + schema', '정답입니다. 필요한 값만 데이터로 처리해 코드 실행 경로를 제거합니다.'], ['base64', '직렬화 바이트를 Base64로 감싼다', 'encoding only', '인코딩은 객체 구조를 바꾸지 않습니다.'], ['hide-format', '직렬화 형식 이름을 숨긴다', 'security by obscurity', '형식 은닉은 공격 표면을 제거하지 않습니다.'], ['catch', '신뢰한 패키지 버전으로 갱신하고 예외 처리를 켠 뒤 기존 객체 복원 형식은 유지한다', 'library upgrade + exception handling with object format retained', '성공적으로 복원되는 위험 객체를 막지 못합니다.']],
    'data-schema', '외부 입력에는 임의 객체 역직렬화를 피하고 실행 기능 없는 데이터 형식과 엄격한 스키마를 사용합니다.'),

  q('cloud-public-storage', 'CLOUD_SUPPLY', '공개 클라우드 저장소', [SECTOR, PIT], '고객 문서 저장소의 노출을 가장 먼저 차단하는 조치는?',
    [['저장소 설정', 'Public read: Enabled', '로그인하지 않은 인터넷 사용자도 읽을 수 있습니다.'], ['데이터', '고객 계약서와 신분 확인 문서', '공개 접근이 필요하지 않은 민감 자료입니다.']],
    [['bucket-policy', 'principal=*; action=GetObject; condition=none'], ['classification', 'contracts=confidential; KYC=restricted']],
    [['block-review', '공개 접근을 차단하고 최소 권한 정책으로 교체한 뒤 접근 로그와 노출 범위를 조사한다', 'contain + least privilege + investigate', '정답입니다. 노출을 막고 필요한 주체만 허용하며 과거 접근을 확인합니다.'], ['rename', '버킷 이름만 복잡하게 바꾼다', 'obscure name', '공개 정책은 그대로 남습니다.'], ['robots', 'robots.txt에 검색 금지를 적는다', 'crawler hint', 'robots.txt는 접근 통제가 아닙니다.'], ['zip', '공개 링크는 유지하되 객체를 암호 없는 ZIP으로 묶고 다운로드 경로와 파일 이름을 무작위로 바꾼다', 'public archive + randomized object names with unchanged access policy', '압축은 기밀성을 제공하지 않습니다.']],
    'block-review', '클라우드 저장소는 기본 비공개, 명시적 최소 권한과 접근 로그 모니터링을 적용합니다.'),
  q('cloud-ci-credential', 'CLOUD_SUPPLY', 'CI/CD 자격 증명', [SECTOR, SPRINT], 'CI가 클라우드에 배포할 때 자격 증명 위험을 가장 잘 줄이는 방식은?',
    [['현재 방식', '관리자 API 키를 저장소 시크릿에 넣고 2년간 사용', '유출되면 오래 사용할 수 있고 권한도 과도합니다.'], ['배포 필요', 'production-web 서비스 갱신만 필요', '전체 관리자 권한이 필요하지 않습니다.']],
    [['credential', 'type=static_key; age=730d; role=admin'], ['job', 'repo=web; env=prod; action=deploy_service:web']],
    [['oidc', 'CI 워크로드 신원을 검증해 작업별 최소 권한 단기 토큰을 발급한다', 'federated OIDC + short-lived token', '정답입니다. 장기 비밀을 없애고 좁은 단기 권한만 부여합니다.'], ['base64', '관리자 키를 Base64로 인코딩하고 보호된 CI 변수에 저장해 모든 작업에서 사용한다', 'protected CI variable with encoded long-lived admin key', 'Base64는 암호화가 아닙니다.'], ['rename', '시크릿 이름을 RANDOM_VALUE로 바꾼다', 'rename secret', '이름은 수명과 권한을 줄이지 못합니다.'], ['share', '모든 저장소가 같은 키를 쓴다', 'shared credential', '한 저장소 침해가 전체 환경으로 번집니다.']],
    'oidc', 'CI/CD는 장기 공유 키보다 워크로드 신원 기반의 짧고 좁은 권한을 사용합니다.'),
  q('cloud-typosquat-package', 'CLOUD_SUPPLY', '패키지 타이포스쿼팅', [LAUNCH, SECTOR], '새 의존성을 추가하기 전 가장 먼저 확인할 것은?',
    [['공식 패키지', '@company/auth-client', '사내 문서의 정확한 이름입니다.'], ['검색 결과', '@company/auth-cllent · 어제 생성 · 다운로드 12회', 'i 대신 l이 들어간 유사 이름입니다.']],
    [['expected', '@company/auth-client; registry=internal; signed=true'], ['candidate', '@company/auth-cllent; created=1d; publisher=unknown']],
    [['verify', '설치하지 말고 공식 저장소·게시자·정확한 이름·서명/출처를 검증한다', 'identity and provenance verification', '정답입니다. 유사 이름 패키지를 차단하고 출처를 확인합니다.'], ['try', '내 PC에서 한 번 실행해 본다', 'execute untrusted package', '설치 스크립트만으로도 비밀정보를 탈취할 수 있습니다.'], ['search', '검색 결과 상단이고 다운로드 수와 별점이 높으므로 격리 환경에 먼저 설치한다', 'search rank + popularity + sandbox-first execution', '검색 순위는 게시자 신원을 보증하지 않습니다.'], ['both', '두 패키지를 모두 설치한다', 'install both', '악성 후보를 함께 실행합니다.']],
    'verify', '패키지 이름, 게시자, 공식 레지스트리, 서명·provenance와 변경 이력을 설치 전에 확인합니다.'),
  q('cloud-sbom-use', 'CLOUD_SUPPLY', 'SBOM 활용', [SECTOR, PIT], '새 라이브러리 취약점 발표 직후 SBOM의 가장 실용적인 용도는?',
    [['보안 공지', 'lib-image 4.2 이하 원격 코드 실행', '영향 버전이 구체적으로 공개됐습니다.'], ['조직 환경', '서비스 200개 · 직접/간접 의존성 불명확', '어디에 어떤 버전이 있는지 찾아야 합니다.']],
    [['advisory', 'component=lib-image; affected<=4.2; impact=RCE'], ['estate', 'services=200; transitive_dependencies=unknown']],
    [['map', '영향 버전과 전이 의존성을 쓰는 서비스·소유자를 찾아 노출 기준으로 조치한다', 'inventory-to-remediation mapping', '정답입니다. 목록을 영향 식별과 담당자별 조치로 연결합니다.'], ['publish', 'SBOM 파일을 공개하고 끝낸다', 'publish without action', '목록 게시만으로 수정되지 않습니다.'], ['delete', '공격자가 볼까 봐 SBOM을 삭제한다', 'remove inventory', '자산 가시성을 잃습니다.'], ['direct-only', '직접 의존성과 현재 배포 이미지에 이름이 없으면 전이 의존성 영향은 제외한다', 'direct-dependency and image-name screening only', '간접 의존성으로 포함될 수 있습니다.']],
    'map', 'SBOM은 버전·전이 의존성·배포 위치·소유자를 조치 흐름에 연결할 때 가치가 있습니다.'),
  q('cloud-sensitive-logs', 'CLOUD_SUPPLY', '로그의 비밀정보', [SECTOR, PIT], '운영 로그에 인증 토큰이 기록된 사실을 발견했다. 올바른 대응은?',
    [['로그 예시', 'Authorization: Bearer eyJ...', '로그 조회자가 토큰을 재사용할 수 있습니다.'], ['토큰', '유효기간 30일 · 고객 API 읽기 권한', '이미 기록된 값은 삭제만으로 안전하지 않습니다.']],
    [['log-field', 'request.headers.authorization=Bearer <live-token>'], ['token', 'ttl=30d; scope=customer.read; revocation=available']],
    [['redact-revoke', '기록을 중단·마스킹하고 토큰을 폐기한 뒤 접근과 사용 흔적을 조사한다', 'redact + revoke + investigate', '정답입니다. 추가 노출을 막고 자격 증명을 무효화합니다.'], ['rename', '로그 파일 이름만 바꾼다', 'rename artifact', '토큰 유효성과 접근 권한은 그대로입니다.'], ['compress', '기존 로그를 암호화 ZIP으로 보관하고 새 로그는 접근 제한 저장소로 이동한다', 'encrypted archive + restricted storage without token rotation', '저장 위치를 제한해도 이미 노출된 토큰은 폐기되지 않고 민감값 기록도 중단되지 않습니다.'], ['wait', '30일 뒤 만료되므로 기다린다', 'passive expiry', '그동안 재사용 가능합니다.']],
    'redact-revoke', '비밀정보는 로그에 남기지 않고, 노출 시 폐기·회전과 접근 조사까지 수행합니다.'),
  q('cloud-stale-oauth-app', 'CLOUD_SUPPLY', '오래된 SaaS 연동', [SECTOR, SPRINT], '퇴사자가 만든 미사용 SaaS 연동을 어떻게 처리해야 하는가?',
    [['앱 상태', '마지막 정상 사용 14개월 전 · 소유자 퇴사', '업무 필요성과 책임자가 사라졌습니다.'], ['권한', '모든 메일 읽기 · 오프라인 접근', '장기 토큰은 접근 경로로 남습니다.']],
    [['integration', 'owner=departed; last_business_use=14mo'], ['grant', 'Mail.Read; offline_access; active=true']],
    [['revoke', '업무 필요성을 확인하고 불필요하면 권한·토큰을 폐기하며 소유자 목록을 정비한다', 'revoke stale grant + governance', '정답입니다. 사용하지 않는 장기 접근 경로를 제거합니다.'], ['hide', '화면에서 앱 아이콘만 숨긴다', 'UI hide only', '표시 여부와 토큰 유효성은 별개입니다.'], ['rename', '앱 이름에 OLD를 붙인다', 'label only', '이름은 메일 권한을 제거하지 않습니다.'], ['leave', '최근 90일 사용 기록이 없으면 위험이 낮으므로 소유자 확인 전까지 기존 권한을 유지한다', 'retain dormant grant pending owner review', '미사용 장기 토큰은 침해 경로가 됩니다.']],
    'revoke', 'SaaS 연동도 소유자·목적·권한·마지막 사용을 정기 검토하고 불필요한 토큰을 폐기합니다.'),
  q('cloud-share-link', 'CLOUD_SUPPLY', '공유 링크 통제', [LAUNCH, SECTOR], '외부 회계사와 민감한 파일을 공유할 때 가장 적절한 설정은?',
    [['현재 링크', '링크를 아는 모든 사람 · 만료 없음 · 다운로드 가능', '전달되면 누구나 계속 접근할 수 있습니다.'], ['업무 필요', '지정 회계사 2명이 7일 동안 검토', '대상과 기간이 명확합니다.']],
    [['current-acl', 'principal=anonymous-link; expiry=none; download=true'], ['requirement', 'recipients=2 named users; duration=7d; review-only']],
    [['named-expiring', '지정 계정만 허용하고 7일 만료·필요 최소 권한을 설정한다', 'named + expiry + least privilege', '정답입니다. 대상·기간·행동을 업무 범위에 맞춥니다.'], ['anonymous', '익명 링크에 짧은 만료 시간을 설정하고 메신저의 승인된 채널로 전달한다', 'anonymous link + short expiry in approved channel', '재전송되면 접근자가 통제되지 않습니다.'], ['short-url', '짧은 URL로 바꾼다', 'URL shortening', '익명·무기한 권한은 그대로입니다.'], ['rename', '파일 이름만 secret-final로 바꾼다', 'rename file', '파일 이름은 접근 통제가 아닙니다.']],
    'named-expiring', '공유는 지정된 사람, 필요한 기간, 필요한 동작만 허용합니다.'),

  q('incident-suspicious-attachment', 'INCIDENT', '의심 첨부파일', [LAUNCH, SECTOR], '예상하지 못한 “세금계산서.zip”을 받았을 때 가장 안전한 행동은?',
    [['발신', '평소 거래처와 철자가 한 글자 다른 도메인', '사칭 도메인일 수 있습니다.'], ['첨부', 'ZIP 안에 Invoice.pdf.exe', '실행 파일인데 PDF처럼 꾸몄습니다.']],
    [['sender-domain', 'supp1ier.co != supplier.co'], ['archive', 'Invoice.pdf.exe; PE executable']],
    [['report', '열지 말고 격리·신고한 뒤 알려진 거래처 연락처로 별도 확인한다', 'quarantine + report + verify', '정답입니다. 실행을 피하고 독립 검증을 시작합니다.'], ['open', '내 PC에서 실행한다', 'execute file', '실행 순간 감염될 수 있습니다.'], ['rename', '확장자를 PDF로 바꾸고 백신과 샌드박스에서 이상이 없으면 내 PC에서 연다', 'rename + antivirus + sandbox screening before local execution', '이름 변경은 파일 형식과 코드를 바꾸지 않습니다.'], ['forward', '동료에게 전달해 열어 보게 한다', 'forward artifact', '의심 파일을 확산시킵니다.']],
    'report', '의심 첨부는 실행하지 않고 공식 신고 채널과 공격자가 통제하지 않는 연락처로 검증합니다.'),
  q('incident-bec-payment', 'INCIDENT', 'BEC 송금 사기', [SECTOR, SPRINT], '대표 명의의 긴급 송금 메일을 받은 재무 담당자의 올바른 대응은?',
    [['메일', '회의 중이니 전화 금지 · 30분 안에 새 계좌로 송금', '검증을 막고 긴급함을 이용합니다.'], ['업무 절차', '계좌 변경은 등록 번호 콜백과 2인 승인 필요', '요청 메일과 분리된 절차가 있습니다.']],
    [['request', 'new_beneficiary=true; urgency=30m; prohibit_callback=true'], ['policy', 'known-number callback + dual approval required']],
    [['verify', '송금을 보류하고 등록된 번호 콜백과 2인 승인을 수행한다', 'known-channel + dual control', '정답입니다. 정해진 독립 통제로 요청을 검증합니다.'], ['reply', '같은 메일 스레드에서 송금 계좌·금액·마감 시각을 다시 확인한 뒤 승인한다', 'detailed same-channel confirmation before approval', '공격자가 메일을 통제하면 확인해 줄 수 있습니다.'], ['send', '긴급하므로 송금 후 승인받는다', 'bypass control', '회수하기 어려운 거래를 검증 없이 실행합니다.'], ['small', '소액을 먼저 보내 본다', 'test payment', '금액이 작아도 공격자에게 송금합니다.']],
    'verify', '송금·계좌 변경은 알려진 채널의 독립 검증과 이중 승인을 지킵니다.'),
  q('incident-secret-in-git', 'INCIDENT', 'Git 비밀정보 노출', [PIT, SPRINT], '공개 저장소 커밋에 클라우드 키가 들어갔다가 5분 뒤 삭제됐다. 다음 조치는?',
    [['Git 기록', '현재 파일에서는 삭제됐지만 이전 커밋에 키 존재', '기록과 복제본에서 값을 찾을 수 있습니다.'], ['키 상태', '유효 · 운영 데이터 읽기/쓰기 가능', '짧은 노출이어도 자동 수집될 수 있습니다.']],
    [['repository', 'visibility=public; secret_in_commit=true; head_removed=true'], ['credential', 'active=true; scope=prod:data:rw']],
    [['revoke', '즉시 키를 폐기·교체하고 사용 로그를 조사한 뒤 필요하면 기록도 정리한다', 'revoke + investigate + cleanup', '정답입니다. 기록 삭제보다 먼저 키를 무효화합니다.'], ['head-only', '최신 커밋에서 삭제했으니 끝낸다', 'remove from HEAD only', '이전 기록과 복제본에 남고 키도 유효합니다.'], ['private', '저장소를 즉시 비공개로 바꾸고 해당 커밋을 삭제한 뒤 접근 권한을 재검토한다', 'visibility + history cleanup + repository access review', '이미 수집된 키를 회수할 수 없습니다.'], ['rename', '변수 이름을 OLD_KEY로 바꾼다', 'rename variable', '키 값과 권한에 영향이 없습니다.']],
    'revoke', '공개된 비밀정보는 먼저 폐기·회전하고 사용 흔적과 파생 피해를 조사합니다.'),
  q('incident-impossible-travel', 'INCIDENT', '의심 로그인 대응', [PIT, SPRINT], '불가능 이동 경보와 데이터 다운로드가 함께 발생했다. 가장 적절한 대응은?',
    [['로그인', '서울 로그인 5분 뒤 해외 익명 VPN 로그인', '정상 이동으로 설명하기 어렵습니다.'], ['행동', '해외 세션에서 고객 파일 3,000개 다운로드', '단순 오탐보다 계정 침해 가능성이 큽니다.']],
    [['auth', 'Seoul → anonymizer-exit in 5m; new_device=true'], ['activity', 'bulk_download=3000; baseline=12/day']],
    [['contain', '의심 세션·토큰을 폐기하고 계정을 보호한 뒤 다운로드와 인증 경로를 조사한다', 'contain + investigate', '정답입니다. 활성 접근을 차단하고 범위를 확인합니다.'], ['dismiss', '사용자가 평소 VPN을 쓴다는 이유로 새 기기와 대량 다운로드는 별도 확인하지 않고 경보를 닫는다', 'known-VPN hypothesis without new-device or bulk-download validation', '새 기기와 대량 다운로드를 설명하지 못합니다.'], ['email', '해외 세션과 같은 계정의 등록 이메일로 본인 여부와 다운로드 목적을 확인한다', 'same-account confirmation of login and download intent', '공격자가 메일을 읽을 수 있습니다.'], ['delete', '로그인 로그를 삭제한다', 'destroy evidence', '사고 범위 확인 증거를 훼손합니다.']],
    'contain', '위치·기기·세션·행동 증거를 결합해 신속히 차단하고 범위를 조사합니다.'),
  q('incident-https-domain', 'INCIDENT', 'HTTPS와 도메인 확인', [LAUNCH, SECTOR], '자물쇠 아이콘이 있는 로그인 페이지가 진짜인지 판단할 때 가장 중요한 확인은?',
    [['주소', 'https://accounts-company.kr.evil.example/login', '연결은 암호화됐지만 실제 등록 도메인은 evil.example입니다.'], ['화면', '회사 로고와 동일한 디자인', '로고와 화면은 복사할 수 있습니다.']],
    [['url', 'scheme=https; host=accounts-company.kr.evil.example'], ['registrable-domain', 'evil.example']],
    [['verify-domain', '실제 등록 도메인이 공식 도메인인지 확인하고 공식 북마크로 다시 접속한다', 'registrable-domain verification', '정답입니다. HTTPS와 별개로 도메인 신원을 확인합니다.'], ['lock', '자물쇠를 눌러 인증서가 유효한지 확인하고 화면의 회사 이름·로고가 맞으면 입력한다', 'valid TLS certificate + displayed-brand consistency check', '공격자도 자기 도메인에 인증서를 받을 수 있습니다.'], ['logo', '회사 로고가 선명하므로 진짜다', 'trust branding', '디자인은 쉽게 복제됩니다.'], ['prefix', '주소 앞에 company가 있으므로 진짜다', 'substring check', '앞부분 문자열은 공격자가 선택할 수 있습니다.']],
    'verify-domain', '자물쇠는 연결 암호화 표시이지 사이트의 업무상 진위를 보증하지 않습니다.'),
];
const whitePracticeQuestions = [
  q('white-authorization-roe', 'WEB_APP', '화이트햇 사전 승인과 RoE', [LAUNCH, SECTOR], '운영 API 보안 검증을 시작하기 전에 가장 먼저 확인해야 할 것은?',
    [['요청', '담당자가 메신저로 "한번 봐 달라"고 요청', '비공식 요청만으로는 허가 범위와 책임자를 입증할 수 없습니다.'], ['문서', '서면 승인·대상·기간·금지 행위·연락망이 아직 없음', '검증 전에 Rules of Engagement를 확정해야 합니다.']],
    [['authorization', 'written_approval=false; asset_owner=unknown'], ['roe', 'targets=unset; test_window=unset; prohibited_actions=unset; emergency_contact=unset']],
    [['document-roe', '자산 소유자의 서면 승인과 대상·기간·허용 기법·금지 행위·비상 연락망을 확정한다', 'written authorization + Rules of Engagement', '정답입니다. 허가와 중단 기준이 없는 테스트는 시작하지 않습니다.'], ['start-passive', '공개 페이지와 DNS 정보만 수집해 가능성을 문서화하고 서면 승인은 후속 단계에서 받는다', 'passive reconnaissance before written authorization and RoE', '수동 정찰도 계약과 정책의 범위를 벗어날 수 있습니다.'], ['ask-later', '취약점을 찾은 뒤 승인 문서를 받는다', 'retroactive authorization', '사후 승인은 테스트 당시의 무권한 행위를 정당화하지 않습니다.'], ['scan-all', '관련 있어 보이는 회사 도메인을 모두 스캔한다', 'unbounded scope', '자산 소유권과 범위를 확인하지 않은 확장은 금지해야 합니다.']],
    'document-roe', '화이트햇 검증은 기술보다 먼저 서면 승인, 정확한 범위, 금지 행위와 비상 연락망을 고정합니다.', [{ title: 'NIST SP 800-115 Technical Guide to Information Security Testing and Assessment', url: 'https://csrc.nist.gov/pubs/sp/800/115/final' }]),
  q('white-scope-boundary', 'CLOUD_SUPPLY', '범위 경계와 제3자 자산', [SECTOR, PIT], '승인된 도메인 조사 중 별도 사업자가 운영하는 연관 호스트를 발견했다. 다음 행동은?',
    [['승인 범위', 'api.company.example만 명시', '연관성만으로 다른 호스트가 자동 포함되지는 않습니다.'], ['발견 호스트', 'payments.vendor.example · 제3자 소유', '제3자 자산은 별도 허가가 필요합니다.']],
    [['scope', 'allow=api.company.example'], ['discovery', 'host=payments.vendor.example; owner=external-vendor']],
    [['pause-confirm', '능동 검증을 멈추고 소유권과 서면 범위 확장을 확인한다', 'pause + ownership validation + scope change', '정답입니다. 제3자 자산은 승인 없이 테스트하지 않습니다.'], ['follow-chain', '승인된 서비스의 결제 흐름에 포함되므로 외부 호스트도 같은 범위로 간주해 테스트한다', 'scope inheritance through application data flow', '기술적 연결은 법적·계약상 허가가 아닙니다.'], ['low-rate', '속도를 낮추면 괜찮으므로 스캔한다', 'unauthorized low-rate scan', '낮은 속도도 범위 밖 검증이라는 사실은 바뀌지 않습니다.'], ['hide-source', '출발 IP를 숨기고 확인한다', 'attribution evasion', '출처 은닉은 승인 문제를 악화합니다.']],
    'pause-confirm', '새 자산은 연관성으로 추정하지 말고 소유권과 명시적 범위 확장을 확인합니다.', [{ title: 'NIST SP 800-115 Technical Guide to Information Security Testing and Assessment', url: 'https://csrc.nist.gov/pubs/sp/800/115/final' }]),
  q('white-stop-condition', 'INCIDENT', '테스트 중단 조건', [PIT, SPRINT], '검증 중 운영 지연과 실제 고객 정보 노출 징후가 나타났다. 가장 적절한 즉시 조치는?',
    [['운영 지표', '오류율 상승·응답 지연 4배', '서비스 영향이 중단 기준을 충족할 수 있습니다.'], ['응답 샘플', '실제 고객 식별정보 포함', '민감정보 접근은 최소화하고 즉시 보고해야 합니다.']],
    [['availability', 'error_rate=12%; latency=4x baseline'], ['data', 'production_pii_observed=true']],
    [['stop-escalate', '테스트를 중단하고 추가 데이터 접근을 막은 뒤 비상 연락망으로 증거와 영향을 보고한다', 'stop condition + minimize + emergency escalation', '정답입니다. 안전 중단과 즉시 보고가 우선입니다.'], ['finish-poc', '재현성을 확정하려고 고객 기록 몇 건을 더 수집하고 요청률을 낮춰 테스트를 마무리한다', 'reduced-rate continued testing to complete impact proof', '중단 조건 이후 추가 수집은 피해를 키웁니다.'], ['delete-local', '로컬 기록만 지우고 테스트를 계속한다', 'conceal evidence', '운영 영향과 노출 사실을 숨기면 대응할 수 없습니다.'], ['wait-window', '승인된 테스트 시간이 남았으므로 요청 간격을 늘리고 종료 시점에 운영 영향과 노출을 보고한다', 'slower requests with deferred end-of-window escalation', '테스트 시간 승인은 안전 중단 기준을 무효화하지 않습니다.']],
    'stop-escalate', '가용성 저하·민감정보 노출 등 RoE 중단 조건이 충족되면 즉시 멈추고 최소 증거로 보고합니다.', [{ title: 'NIST SP 800-115 Technical Guide to Information Security Testing and Assessment', url: 'https://csrc.nist.gov/pubs/sp/800/115/final' }]),
  q('white-remediation-validation', 'WEB_APP', '수정 검증과 대조군', [SECTOR, SPRINT], '권한 우회 수정이 실제로 작동하면서 정상 기능을 깨뜨리지 않았음을 가장 강하게 입증하는 방법은?',
    [['수정 내용', '서버 권한 검사 추가', '설정 존재만으로 실행 경로의 차단을 증명할 수 없습니다.'], ['검증 요구', '정상 사용자 회귀와 비인가 사용자 음성 대조 필요', '성공·실패 대조를 같은 빌드에서 확인해야 합니다.']],
    [['patch', 'server_authorization_check=added'], ['oracle', 'owner=allow; peer=cross-tenant=deny; regression=required']],
    [['controlled-retest', '승인된 환경에서 정상 요청은 성공하고 타인·교차 테넌트 요청은 거부되는지 재시험해 증거를 남긴다', 'authorized positive + negative controls', '정답입니다. 양성·음성 대조와 정상 회귀를 함께 입증합니다.'], ['code-present', '수정 코드의 권한 검사 분기와 단위 테스트가 추가된 사실만 검토하고 배포를 승인한다', 'static branch + unit-test evidence without deployed-path retest', '실제 라우팅·정책 경로에서 강제되는지 알 수 없습니다.'], ['error-only', '수정 배포 후 비인가 계정에서 403을 여러 번 확인하고 서버 로그에도 같은 결과가 남는지 검토한다', 'repeated negative-only 403 checks plus server-log confirmation', '반복된 음성 대조만으로는 정상 요청 성공과 회귀 부재를 입증하지 못합니다.'], ['expand-prod', '운영 전체 계정으로 대량 재시험한다', 'unsafe production expansion', '검증도 승인 범위와 최소 영향 원칙을 지켜야 합니다.']],
    'controlled-retest', '수정 검증은 승인된 범위에서 양성·음성 대조와 정상 회귀를 함께 남겨야 합니다.', [{ title: 'NIST SP 800-115 Technical Guide to Information Security Testing and Assessment', url: 'https://csrc.nist.gov/pubs/sp/800/115/final' }]),
];
const BLUE_GOVERNANCE_TOPICS = new Set(['kev-priority', 'ai-data-governance', 'pqc-migration']);
const RED_LEGACY_IDS = new Set([
  'web-sql-injection', 'web-xss-output', 'web-csrf', 'web-ssrf', 'web-idor',
  'web-frontend-secret', 'web-unsafe-deserialization',
]);

function securityCircuitFor(question) {
  if (['WHITE', 'RED', 'BLUE'].includes(question.securityCircuitId)) return question.securityCircuitId;
  if (question.id.startsWith('white-')) return 'WHITE';
  const generatedMode = question.id.match(/-(triage|prevent|respond|verify|monitor)$/)?.[1];
  if (generatedMode === 'verify') return 'WHITE';
  if (generatedMode === 'triage') {
    const topicFamily = question.topicFamily ?? question.id.slice(0, -'-triage'.length);
    return BLUE_GOVERNANCE_TOPICS.has(topicFamily) ? 'BLUE' : 'RED';
  }
  if (generatedMode) return 'BLUE';
  return RED_LEGACY_IDS.has(question.id) ? 'RED' : 'BLUE';
}

const rawQuestions = [
  ...legacyQuestions,
  ...whitePracticeQuestions,
  ...CIRCUIT_QUESTIONS,
  ...EXPANDED_QUESTIONS,
].map((question) => Object.freeze({
  ...question,
  securityCircuitId: securityCircuitFor(question),
}));

export const QUESTIONS = Object.freeze(rawQuestions);
export const QUESTION_BANK = QUESTIONS;
export const QUESTION_BANK_VERSION = '2026-11-11-v4';
const questionMap = new Map(QUESTIONS.map((question) => [question.id, question]));
const LEVELS = Object.freeze(['BEGINNER', 'ADVANCED']);
const WEIGHT_TIERS = new Set(['FOUNDATION', 'APPLIED', 'ANALYST']);

function flattenPlayable(question, level) {
  const variant = question.variants[level];
  return Object.freeze({
    id: `${question.id}--${level.toLowerCase()}`,
    conceptId: question.id,
    topicFamily: question.topicFamily ?? question.id,
    difficulty: level,
    category: question.category,
    topic: question.topic,
    tracks: question.tracks,
    securityCircuitId: question.securityCircuitId,
    // Authoring metadata only. Race LAUNCH/PIT/SPRINT phases are assigned after selection.
    authoringStages: question.stages,
    question: variant.question,
    evidence: variant.evidence,
    options: variant.options,
    answerId: variant.answerId,
    correctOptionId: variant.answerId,
    takeaway: variant.takeaway,
    explanation: variant.explanation,
    references: variant.references,
    // This field is for server scoring only. Public serializers below explicitly omit it.
    serverTier: variant.serverTier,
  });
}

export const QUESTION_BANKS = Object.freeze({
  BEGINNER: Object.freeze(QUESTIONS.map((question) => flattenPlayable(question, 'BEGINNER'))),
  ADVANCED: Object.freeze(QUESTIONS.map((question) => flattenPlayable(question, 'ADVANCED'))),
});

const flattenedQuestionMap = new Map(LEVELS.flatMap((level) => (
  QUESTION_BANKS[level].map((question) => [question.id, question])
)));

if (QUESTIONS.length !== 128) throw new Error(`paired question pool must contain exactly 128 concepts; got ${QUESTIONS.length}`);
if (questionMap.size !== QUESTIONS.length) throw new Error('duplicate question id');
if (flattenedQuestionMap.size !== 256) throw new Error('flattened question ids must be unique across both levels');
for (const level of LEVELS) {
  if (QUESTION_BANKS[level].length !== 128) throw new Error(`${level} pool must contain exactly 128 questions`);
  const prompts = new Set();
  const correctPositions = new Set();
  for (const question of QUESTION_BANKS[level]) {
    if (!(question.category in QUESTION_CATEGORIES)) throw new Error(`invalid category: ${question.id}`);
    if (!['WHITE', 'RED', 'BLUE'].includes(question.securityCircuitId)) {
      throw new Error(`invalid security circuit: ${question.id}`);
    }
    if (!Array.isArray(question.authoringStages) || question.authoringStages.length === 0) {
      throw new Error(`missing authoring stages: ${question.id}`);
    }
    if (!question.question.trim() || prompts.has(question.question)) throw new Error(`duplicate or empty prompt: ${question.id}`);
    prompts.add(question.question);
    if (!Array.isArray(question.evidence) || question.evidence.length < 2) throw new Error(`missing evidence: ${question.id}`);
    if (question.options.length !== 4) throw new Error(`question must have four options: ${question.id}`);
    if (new Set(question.options.map((option) => option.id)).size !== 4) throw new Error(`duplicate option id: ${question.id}`);
    if (new Set(question.options.map((option) => option.label)).size !== 4) throw new Error(`duplicate option label: ${question.id}`);
    if (!question.options.every((option) => option.label && option.technical && option.feedback)) throw new Error(`incomplete option: ${question.id}`);
    const correctPosition = question.options.findIndex((option) => option.id === question.correctOptionId);
    if (correctPosition < 0) throw new Error(`missing answer: ${question.id}`);
    correctPositions.add(correctPosition);
    if (!question.takeaway || !question.explanation) throw new Error(`missing explanation: ${question.id}`);
    if (!Array.isArray(question.references) || question.references.length === 0) throw new Error(`missing references: ${question.id}`);
    if (!question.references.every((reference) => /^https:\/\//.test(reference.url))) throw new Error(`invalid reference: ${question.id}`);
    if (!WEIGHT_TIERS.has(question.serverTier)) throw new Error(`invalid server tier: ${question.id}`);
  }
  if (correctPositions.size !== 4) throw new Error(`${level} correct answers must rotate through all four positions`);
}
for (const question of QUESTIONS) {
  if (question.variants.BEGINNER.question === question.variants.ADVANCED.question) throw new Error(`difficulty prompts must differ: ${question.id}`);
  const beginnerLabels = question.variants.BEGINNER.options.map(({ label }) => label).join('\u0000');
  const advancedLabels = question.variants.ADVANCED.options.map(({ label }) => label).join('\u0000');
  if (beginnerLabels === advancedLabels) throw new Error(`difficulty options must differ: ${question.id}`);
}
export function getQuestion(id) {
  const question = questionMap.get(id) ?? flattenedQuestionMap.get(id);
  if (!question) { const error = new Error('invalid question'); error.code = 'invalid_question'; throw error; }
  return question;
}
export function getQuestionVariant(id, difficulty = 'BEGINNER') {
  const level = difficulty === 'ADVANCED' ? 'ADVANCED' : 'BEGINNER';
  const flattened = flattenedQuestionMap.get(id);
  if (flattened) return flattened;
  const paired = questionMap.get(id);
  if (!paired) { const error = new Error('invalid question'); error.code = 'invalid_question'; throw error; }
  return QUESTION_BANKS[level].find(({ conceptId }) => conceptId === paired.id);
}
export function publicQuestion(id, difficulty = 'BEGINNER', { revealAnswer = false } = {}) {
  const level = difficulty === 'ADVANCED' ? 'ADVANCED' : 'BEGINNER';
  const question = getQuestionVariant(id, level);
  const result = { id: question.id, conceptId: question.conceptId, difficulty: level, category: question.category, categoryLabel: QUESTION_CATEGORIES[question.category], topic: question.topic, tracks: question.tracks, question: question.question, evidence: question.evidence, options: question.options.map(({ id: optionId, label, technical }) => ({ id: optionId, label, technical })) };
  if (revealAnswer) Object.assign(result, { answerId: question.answerId, takeaway: question.takeaway, feedback: Object.fromEntries(question.options.map((option) => [option.id, option.feedback])), references: question.references });
  return result;
}
export const questionsForStage = (stage) => QUESTIONS.filter((question) => question.stages.includes(stage));
