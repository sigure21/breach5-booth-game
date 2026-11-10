// Additional circuit-specific content: 12 WHITE assessment-practice concepts and
// 12 RED adversary-path concepts. These are deliberately one concept per topic
// family so a 10-15 encounter heat cannot repeat the same lesson under a new stem.

const REFS = Object.freeze({
  NIST_800_115: Object.freeze({
    title: 'NIST SP 800-115 Technical Guide to Information Security Testing and Assessment',
    url: 'https://csrc.nist.gov/pubs/sp/800/115/final',
  }),
  NIST_PRIVACY: Object.freeze({
    title: 'NIST Privacy Framework',
    url: 'https://www.nist.gov/privacy-framework',
  }),
  NIST_800_86: Object.freeze({
    title: 'NIST SP 800-86 Guide to Integrating Forensic Techniques into Incident Response',
    url: 'https://csrc.nist.gov/pubs/sp/800/86/final',
  }),
  CISA_VDP: Object.freeze({
    title: 'CISA Vulnerability Disclosure Policy Template',
    url: 'https://www.cisa.gov/vulnerability-disclosure-policy-template',
  }),
  RFC_9112: Object.freeze({
    title: 'RFC 9112 HTTP/1.1',
    url: 'https://www.rfc-editor.org/rfc/rfc9112.html',
  }),
  RFC_9111: Object.freeze({
    title: 'RFC 9111 HTTP Caching',
    url: 'https://www.rfc-editor.org/rfc/rfc9111.html',
  }),
  RFC_8725: Object.freeze({
    title: 'RFC 8725 JSON Web Token Best Current Practices',
    url: 'https://www.rfc-editor.org/rfc/rfc8725.html',
  }),
  RFC_8707: Object.freeze({
    title: 'RFC 8707 Resource Indicators for OAuth 2.0',
    url: 'https://www.rfc-editor.org/rfc/rfc8707.html',
  }),
  GRAPHQL_AUTH: Object.freeze({
    title: 'GraphQL Authorization Guidance',
    url: 'https://graphql.org/learn/authorization/',
  }),
  CWE_362: Object.freeze({
    title: 'CWE-362 Concurrent Execution using Shared Resource with Improper Synchronization',
    url: 'https://cwe.mitre.org/data/definitions/362.html',
  }),
  CWE_502: Object.freeze({
    title: 'CWE-502 Deserialization of Untrusted Data',
    url: 'https://cwe.mitre.org/data/definitions/502.html',
  }),
  CWE_1336: Object.freeze({
    title: 'CWE-1336 Improper Neutralization of Special Elements Used in a Template Engine',
    url: 'https://cwe.mitre.org/data/definitions/1336.html',
  }),
  CWE_78: Object.freeze({
    title: 'CWE-78 OS Command Injection',
    url: 'https://cwe.mitre.org/data/definitions/78.html',
  }),
  MITRE_T1550: Object.freeze({
    title: 'MITRE ATT&CK T1550 Use Alternate Authentication Material',
    url: 'https://attack.mitre.org/techniques/T1550/',
  }),
  SLSA: Object.freeze({
    title: 'SLSA Specification',
    url: 'https://slsa.dev/spec/',
  }),
  AWS_IMDS: Object.freeze({
    title: 'AWS EC2 Instance Metadata Service Configuration',
    url: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html',
  }),
});

const TRACKS_BY_CIRCUIT = Object.freeze({
  WHITE: Object.freeze(['human-firewall', 'secure-builder']),
  RED: Object.freeze(['secure-builder']),
});
const OPTION_IDS = Object.freeze(['choice-a', 'choice-b', 'choice-c', 'choice-d']);

const evidence = (label, value) => Object.freeze({ label, value });
const freezeReferences = (references) => Object.freeze(references.map((reference) => Object.freeze({ ...reference })));

function makeVariant(definition, level, definitionIndex) {
  const source = definition[level];
  const correctPosition = (definitionIndex + (level === 'ADVANCED' ? 1 : 0)) % OPTION_IDS.length;
  const ordered = source.distractors.map(([label, feedback]) => ({ label, feedback }));
  ordered.splice(correctPosition, 0, {
    label: source.correct[0],
    feedback: source.correct[1],
  });
  const technical = definition.securityCircuitId === 'WHITE'
    ? '승인·범위·증거 판단'
    : '전제·경계·공격 흐름 판단';
  const options = Object.freeze(ordered.map((option, index) => Object.freeze({
    id: OPTION_IDS[index],
    label: option.label,
    technical,
    feedback: option.feedback,
  })));
  return Object.freeze({
    question: source.question,
    evidence: Object.freeze(source.evidence.map(([label, value]) => evidence(label, value))),
    options,
    answerId: OPTION_IDS[correctPosition],
    correctOptionId: OPTION_IDS[correctPosition],
    takeaway: source.takeaway,
    explanation: source.takeaway,
    references: freezeReferences(definition.references),
    serverTier: level === 'ADVANCED' ? 'ANALYST' : 'APPLIED',
  });
}

function makeQuestion(definition, definitionIndex) {
  const variants = Object.freeze({
    BEGINNER: makeVariant(definition, 'BEGINNER', definitionIndex),
    ADVANCED: makeVariant(definition, 'ADVANCED', definitionIndex),
  });
  return Object.freeze({
    id: definition.id,
    conceptId: definition.id,
    topicFamily: definition.id,
    category: definition.category,
    topic: definition.topic,
    tracks: TRACKS_BY_CIRCUIT[definition.securityCircuitId],
    securityCircuitId: definition.securityCircuitId,
    stages: Object.freeze(definition.stages),
    variants,
    question: variants.BEGINNER.question,
    evidence: Object.freeze({
      BEGINNER: variants.BEGINNER.evidence,
      ADVANCED: variants.ADVANCED.evidence,
    }),
    options: variants.BEGINNER.options,
    answerId: variants.BEGINNER.answerId,
    correctOptionId: variants.BEGINNER.answerId,
    takeaway: variants.BEGINNER.takeaway,
    explanation: variants.BEGINNER.explanation,
    references: variants.BEGINNER.references,
    serverTiers: Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  });
}

const DEFINITIONS = Object.freeze([
  {
    id: 'white-asset-ownership-delegation', securityCircuitId: 'WHITE', category: 'CLOUD_SUPPLY',
    topic: '자산 소유권과 위임 확인', stages: ['LAUNCH', 'SECTOR'], references: [REFS.NIST_800_115],
    BEGINNER: {
      question: '협력사 엔지니어가 운영 API 점검을 부탁했지만 자산 소유자와 위임 문서가 확인되지 않았다. 첫 조치는?',
      evidence: [['요청', '협력사 메신저 계정이 오늘 안에 API를 확인해 달라고 요청'], ['자산 기록', 'CMDB 소유 부서와 요청자의 위임 관계를 확인할 자료가 없음']],
      correct: ['자산 소유자와 요청자의 위임 관계를 확인하고 서면 승인 범위를 확정한다', '정답입니다. 요청자의 신원과 자산 소유권, 위임 권한을 모두 확인해야 승인 효력이 생깁니다.'],
      distractors: [
        ['협력사 회사 메일이면 충분하므로 읽기 요청부터 점검을 시작한다', '회사 계정은 신원 단서일 뿐 자산 소유권이나 테스트 위임을 증명하지 않습니다.'],
        ['DNS 등록 정보에 회사명이 보이면 관련 하위 자산까지 범위를 넓힌다', '등록 정보만으로 실제 통제권이나 능동 테스트 승인을 판단할 수 없습니다.'],
        ['먼저 취약 여부를 확인한 뒤 결과가 있으면 소유자 승인을 요청한다', '사후 승인은 이미 수행한 무단 테스트를 소급해 정당화하지 못합니다.'],
      ],
      takeaway: '화이트햇 검증은 요청자의 신원뿐 아니라 자산 소유권과 위임 권한을 서면으로 확인한 뒤 시작합니다.',
    },
    ADVANCED: {
      question: '재판매 파트너가 SaaS 테넌트 점검을 요청했지만 계약·CMDB의 통제 주체가 서로 다르다. 유효한 승인 경계를 어떻게 확정해야 하는가?',
      evidence: [['ticket', 'requester=reseller; tenant=customer-prod; signed_delegation=absent'], ['ownership', 'contract_owner=customer; platform_operator=vendor; emergency_contact=unset']],
      correct: ['위임 사슬을 확인해 서명 RoE에 테넌트·기간·연락망을 고정한다', '정답입니다. 여러 주체가 얽힌 환경은 권한 위임 사슬과 구체적 RoE가 모두 확인돼야 합니다.'],
      distractors: [
        ['재판매 계약이 존재하므로 고객 테넌트의 기술 통제권도 자동 위임된 것으로 본다', '상업 계약이 곧 운영 자산의 보안 테스트 위임을 의미하지는 않습니다.'],
        ['플랫폼 운영사가 응답하면 고객 소유 데이터까지 같은 승인 범위에 포함한다', '플랫폼 운영 권한과 고객 데이터에 대한 테스트 권한은 별도 경계입니다.'],
        ['비상 연락망 없이 낮은 요청률만 약속하고 운영 테넌트에서 검증을 진행한다', '운영 영향 시 중단·에스컬레이션할 연락 경로가 없는 RoE는 불완전합니다.'],
      ],
      takeaway: '복수 조직 환경에서는 자산 소유자, 통제 주체, 위임 사슬과 비상 연락망을 RoE에 명시합니다.',
    },
  },
  {
    id: 'white-data-minimization', securityCircuitId: 'WHITE', category: 'INCIDENT',
    topic: '검증 데이터 최소화', stages: ['SECTOR', 'PIT'], references: [REFS.NIST_PRIVACY, REFS.NIST_800_115],
    BEGINNER: {
      question: '권한 오류로 다른 고객 기록이 보이는 사실을 입증할 때 가장 안전한 증거 수집 방법은?',
      evidence: [['관찰', '테스트 계정 A에서 계정 B의 주문 제목 한 건이 노출'], ['목표', '권한 결함은 입증하되 실제 고객 정보를 더 수집할 필요는 없음']],
      correct: ['추가 열람을 멈추고 최소 필드만 가린 캡처와 요청 식별자·시각을 남긴다', '정답입니다. 결함 입증에 필요한 최소 정보만 보존하고 추가 개인정보 접근을 피합니다.'],
      distractors: [
        ['영향 규모를 정확히 세기 위해 가능한 고객 기록을 모두 내려받아 보관한다', '대량 수집은 입증에 불필요한 개인정보 노출과 2차 위험을 만듭니다.'],
        ['재현성을 높이기 위해 원본 응답을 편집 없이 팀 채팅방 전체에 공유한다', '원본 공유는 접근 범위를 넓히며 마스킹과 제한된 전달 경로가 필요합니다.'],
        ['민감 필드를 눈으로 확인했으므로 식별자와 시각 없이 현상만 구두 보고한다', '최소화는 증거를 없애는 것이 아니며 재현 가능한 메타데이터는 남겨야 합니다.'],
      ],
      takeaway: '취약점 증거는 재현에 필요한 최소 필드와 메타데이터만 수집하고 민감정보는 가립니다.',
    },
    ADVANCED: {
      question: '교차 테넌트 조회가 확인됐을 때 개인정보를 확장 수집하지 않고 영향과 재현성을 입증하는 증거 설계는?',
      evidence: [['control', 'authorized test tenants=A,B; canary records available'], ['exposure', 'production query returned foreign tenant metadata; bulk endpoint also present']],
      correct: ['canary 대조와 요청 ID·해시·마스킹 표본만 보존한다', '정답입니다. 통제된 대조군과 최소화된 메타데이터로 원인과 영향을 충분히 입증합니다.'],
      distractors: [
        ['전체 테넌트 수를 산정할 때까지 페이지를 순회하고 원본 응답을 암호화해 보관한다', '암호화 보관도 불필요한 대량 수집을 정당화하지 않으며 영향 산정은 소유자가 수행할 수 있습니다.'],
        ['운영 데이터는 저장하지 않고 테스트 테넌트 한 건의 성공 응답만 근거로 제출한다', '음성 대조와 요청 경계가 없으면 교차 테넌트 결함인지 충분히 구분하기 어렵습니다.'],
        ['민감 필드만 삭제한 뒤 전체 응답 본문을 외부 이슈 추적기에 그대로 첨부한다', '비민감처럼 보이는 메타데이터도 결합 식별 위험이 있어 전달 범위를 최소화해야 합니다.'],
      ],
      takeaway: 'canary와 권한 대조군을 사용하고 운영 데이터는 해시·요청 ID·마스킹 표본으로 최소화합니다.',
    },
  },
  {
    id: 'white-availability-rate-safety', securityCircuitId: 'WHITE', category: 'DEVICE',
    topic: '가용성·요청률 안전 경계', stages: ['LAUNCH', 'PIT'], references: [REFS.NIST_800_115],
    BEGINNER: {
      question: '승인된 점검 중 오류율과 지연이 정한 중단 기준을 넘었다. 다음 행동은?',
      evidence: [['RoE', '초당 5회 제한 · 오류율 3% 초과 시 즉시 중단'], ['운영 지표', '초당 5회 요청에서 오류율 7% · 지연 3배']],
      correct: ['요청을 중단하고 운영 연락망에 지표와 마지막 테스트 시각을 즉시 알린다', '정답입니다. 사전에 합의한 중단 조건은 결과 유무와 관계없이 즉시 적용해야 합니다.'],
      distractors: [
        ['오류가 취약점 신호일 수 있으므로 같은 속도로 한 번 더 반복해 확인한다', '중단 기준을 넘긴 상태에서 반복하면 가용성 영향을 키울 수 있습니다.'],
        ['요청 출발지를 바꾸면 부하가 분산되므로 같은 총 요청률로 계속 진행한다', '출발지 분산은 서비스가 받는 총부하와 합의된 제한을 줄이지 않습니다.'],
        ['결과 화면만 저장하고 운영 지표가 정상화될 때까지 별도 통보 없이 기다린다', '운영팀이 원인을 구분하고 대응하도록 즉시 통보해야 합니다.'],
      ],
      takeaway: '가용성 지표가 RoE의 중단 기준을 넘으면 즉시 멈추고 운영 연락망으로 상황을 공유합니다.',
    },
    ADVANCED: {
      question: '부하 영향이 보이기 시작한 운영 검증에서 안전 예산과 증거 보존을 함께 만족하는 판단은?',
      evidence: [['budget', 'rate<=5 rps; error_budget=3%; stop_on_latency=2x'], ['telemetry', 'error=7%; p95_latency=3x; test_trace_id known']],
      correct: ['즉시 중단하고 trace·시계열을 보존해 비상 연락망에 알린다', '정답입니다. 가용성 보호를 우선하면서 운영팀이 원인을 재구성할 최소 증거를 남깁니다.'],
      distractors: [
        ['동시성만 낮추고 총요청 수를 유지해 임계값 아래로 내려가는지 계속 관찰한다', '이미 중단 조건을 초과했으므로 임의 조정 후 계속하는 것은 RoE 위반입니다.'],
        ['테스트 IP를 여러 구간으로 분산해 개별 출발지 제한을 만족하도록 재개한다', '분산은 대상 서비스의 안전 예산을 우회하며 합의된 총부하를 지키지 못합니다.'],
        ['관측 오염을 피하려고 테스트 trace와 시계열을 삭제한 뒤 운영팀에 장애만 알린다', '원인 구분에 필요한 추적 정보를 삭제하면 안전한 복구와 검증을 방해합니다.'],
      ],
      takeaway: '중단 기준 초과 시 트래픽을 멈추고 trace와 시계열을 보존해 운영팀에 즉시 에스컬레이션합니다.',
    },
  },
  {
    id: 'white-social-engineering-authorization', securityCircuitId: 'WHITE', category: 'IDENTITY',
    topic: '사회공학 테스트 승인', stages: ['LAUNCH', 'SECTOR'], references: [REFS.NIST_800_115],
    BEGINNER: {
      question: '피싱 모의훈련에 포함할 직원과 연락 수단을 정하기 전에 반드시 확인할 것은?',
      evidence: [['초안', '전 직원에게 실제 비밀번호 입력을 요구하는 문자 발송 계획'], ['승인', '대상 부서·채널·수집 금지 정보·중단 절차가 문서에 없음']],
      correct: ['대상·채널·시나리오·수집 금지 정보·중단/지원 절차를 서면 승인받는다', '정답입니다. 사람을 대상으로 한 테스트는 기술 범위 외에 안전·개인정보·지원 절차도 승인돼야 합니다.'],
      distractors: [
        ['훈련 효과를 높이기 위해 보안팀 외에는 알리지 않고 전 직원에게 발송한다', '기습성은 승인과 안전 절차를 생략할 근거가 되지 않습니다.'],
        ['실제 비밀번호를 받지 않도록 저장만 안 하면 별도 대상 승인은 필요 없다', '자격 증명 입력 유도 자체가 위험하며 대상과 수집 방식을 사전에 통제해야 합니다.'],
        ['회사 소유 휴대폰만 대상으로 하면 문자 채널은 자동으로 승인된 것으로 본다', '기기 소유권과 사회공학 테스트 동의·업무 영향 승인은 별개입니다.'],
      ],
      takeaway: '사회공학 테스트는 대상, 채널, 시나리오, 수집 금지 정보와 중단·지원 절차를 명시적으로 승인받습니다.',
    },
    ADVANCED: {
      question: '고위험 부서를 포함한 사회공학 평가의 RoE에서 안전성과 측정 타당성을 함께 보장하는 항목은?',
      evidence: [['population', 'finance+helpdesk; contractors mixed; union notice unknown'], ['collection', 'credential capture proposed; support/escalation path absent']],
      correct: ['모집단·pretext·금지 데이터·중단·지원 절차를 RoE에 고정한다', '정답입니다. 측정 목표와 사람·데이터 안전 경계를 함께 문서화해야 합니다.'],
      distractors: [
        ['클릭률 비교가 목적이므로 대상 범위를 넓히고 실제 자격 증명 수집 여부만 사후 결정한다', '측정 편의를 위해 수집 경계와 대상 승인을 사후로 미룰 수 없습니다.'],
        ['경영진 한 명의 구두 동의가 있으면 계약직과 외부 협력사도 같은 모집단에 포함한다', '고용·계약 경계가 다른 대상은 별도 권한과 통지 요건을 확인해야 합니다.'],
        ['현실성을 위해 헬프데스크 비상 절차를 실제로 우회하되 성공 시에만 담당자에게 알린다', '비상 절차 우회는 명시적 허용과 안전한 중단·복구 계획 없이는 수행할 수 없습니다.'],
      ],
      takeaway: '사회공학 RoE는 모집단, pretext, 데이터 금지선, 중단 조건과 사후 지원까지 포함해야 합니다.',
    },
  },
  {
    id: 'white-dedicated-test-credentials', securityCircuitId: 'WHITE', category: 'IDENTITY',
    topic: '전용 테스트 자격 증명', stages: ['SECTOR', 'PIT'], references: [REFS.NIST_800_115],
    BEGINNER: {
      question: '권한 검증을 위해 계정이 필요할 때 가장 안전한 준비 방법은?',
      evidence: [['요구', '일반 사용자와 관리자 역할의 차이를 확인해야 함'], ['제안', '퇴사자 계정을 잠시 되살리거나 현직자 비밀번호를 공유하자는 의견']],
      correct: ['역할별 전용 테스트 계정을 만들고 최소 권한·만료 시각·담당자를 지정한다', '정답입니다. 전용 계정은 실제 사용자 피해 없이 권한 경계를 재현하고 종료 후 폐기할 수 있습니다.'],
      distractors: [
        ['퇴사자 계정은 사용자가 없으므로 비밀번호만 바꿔 테스트에 재사용한다', '과거 권한과 데이터가 남아 있을 수 있어 테스트 격리와 추적성이 부족합니다.'],
        ['현직자 계정을 빌리되 비밀번호를 테스트 종료 직후 변경하도록 약속한다', '자격 증명 공유는 사용자 행위와 테스트 행위를 구분하지 못하게 합니다.'],
        ['관리자 계정 하나로 모든 역할을 흉내 내고 요청 헤더만 바꿔 비교한다', '실제 역할·주체별 권한 경계를 재현하지 못해 검증 결과가 부정확합니다.'],
      ],
      takeaway: '역할별 전용 테스트 계정에 최소 권한과 만료·소유자를 설정하고 실제 사용자 자격 증명은 공유하지 않습니다.',
    },
    ADVANCED: {
      question: '다중 테넌트 권한 행렬을 재시험할 때 계정 오염과 권한 잔존을 막는 자격 증명 설계는?',
      evidence: [['matrix', 'tenant A/B x viewer/editor/admin; cross-tenant negative controls required'], ['lifecycle', 'shared admin proposed; expiry and owner tags absent']],
      correct: ['테넌트·역할별 합성 계정에 최소 scope·기기 결속·자동 만료를 강제한다', '정답입니다. 각 권한 셀을 독립 주체로 재현하고 테스트 후 자동으로 수명을 끝낼 수 있습니다.'],
      distractors: [
        ['공용 관리자 토큰 하나를 복사해 클레임만 바꾼 뒤 모든 권한 셀을 대표하게 한다', '서명된 실제 권한과 세션 경계를 재현하지 못하며 공유 토큰 위험도 커집니다.'],
        ['운영 사용자 세션을 익명화해 수집하고 테스트 도구에서 역할별로 재생한다', '실제 세션 재사용은 동의·추적·오남용 위험이 있어 전용 principal을 대신할 수 없습니다.'],
        ['테넌트 A의 계정만 만들고 교차 테넌트 거부는 코드 리뷰 결과로 대체한다', '음성 대조 principal이 없으면 런타임 인가 경계를 직접 검증할 수 없습니다.'],
      ],
      takeaway: '테넌트·역할별 합성 principal에 최소 scope, 결속, 자동 만료와 소유자 태그를 적용합니다.',
    },
  },
  {
    id: 'white-coordinated-disclosure', securityCircuitId: 'WHITE', category: 'INCIDENT',
    topic: '조정된 취약점 공개', stages: ['PIT', 'SPRINT'], references: [REFS.CISA_VDP],
    BEGINNER: {
      question: '공개 VDP 범위 안에서 취약점을 확인했다. 가장 책임 있는 첫 보고 방법은?',
      evidence: [['정책', 'security@example 신고 채널 · 고객 데이터 접근 금지 · 5영업일 접수 안내'], ['증거', '합성 계정으로 최소 재현 완료 · 실제 고객 데이터 미수집']],
      correct: ['정책 채널로 최소 증거를 보내고 조정 기간에는 공개를 보류한다', '정답입니다. 정책 채널과 조정 기간을 지키며 필요한 최소 증거만 전달합니다.'],
      distractors: [
        ['빠른 수정을 유도하려고 전체 재현 영상을 공개 게시한 뒤 회사 계정을 태그한다', '선공개는 악용 위험을 높이고 제공된 조정 절차를 무력화할 수 있습니다.'],
        ['접수 확인 전까지 같은 취약점을 여러 직원 개인 계정으로 반복 전송한다', '중복·분산 연락은 대응을 방해하며 정책이 지정한 채널을 사용해야 합니다.'],
        ['영향을 강조하려고 실제 고객 계정에서도 같은 현상이 보이는지 추가 확인한다', '정책이 금지한 데이터 접근은 보고 품질을 높인다는 이유로 확장할 수 없습니다.'],
      ],
      takeaway: 'VDP의 범위·채널·응답 기간을 따르고 최소 재현과 영향만 전달하며 공개 시점을 조정합니다.',
    },
    ADVANCED: {
      question: 'VDP에 따라 재현된 취약점을 악용 가능성을 키우지 않으면서 조정·에스컬레이션하는 보고 흐름은?',
      evidence: [['policy', 'in_scope=true; initial_response=5 business days; public_disclosure=coordinate'], ['artifact', 'synthetic PoC trace; secret material redacted; reproducible negative control']],
      correct: ['최소 증거를 비공개 제출하고 수정·재검증·공개 일정을 합의한다', '정답입니다. 재현 가능성과 악용 억제를 함께 만족하도록 정보량과 공개 시점을 조정합니다.'],
      distractors: [
        ['재현성을 보장하려고 원본 비밀과 자동화 코드를 공개 링크로 제공하고 삭제 시각만 예약한다', '공개 링크는 통제되지 않은 접근과 조기 악용을 초래할 수 있습니다.'],
        ['정책 응답 기간 안에도 확인 답변이 없으면 기술 세부 전체를 즉시 공개해 우선순위를 높인다', '정책 기간과 에스컬레이션 채널을 먼저 사용해야 하며 자동 선공개는 책임 있는 조정이 아닙니다.'],
        ['공급자에게는 영향 요약만 보내고 재현 조건과 음성 대조는 공개 글에서 처음 설명한다', '공급자가 수정·검증할 충분한 비공개 증거를 먼저 받아야 합니다.'],
      ],
      takeaway: '최소 증거와 대조군을 비공개 채널로 전달하고 접수·수정·재검증·공개 일정을 조정합니다.',
    },
  },
  {
    id: 'white-evidence-integrity-redaction', securityCircuitId: 'WHITE', category: 'INCIDENT',
    topic: '증거 무결성과 마스킹', stages: ['SECTOR', 'SPRINT'], references: [REFS.NIST_800_86, REFS.NIST_PRIVACY],
    BEGINNER: {
      question: '민감한 응답이 포함된 검증 자료를 팀에 전달할 때 가장 적절한 처리 방법은?',
      evidence: [['원본', '응답에 고객 이메일·세션 식별자 포함'], ['요구', '재현 시각과 요청 흐름은 보존하되 불필요한 개인정보 공유 금지']],
      correct: ['원본은 접근 제한·해시·시각과 함께 보존하고 공유본은 민감 필드를 가린다', '정답입니다. 원본 무결성과 검토용 최소화 자료를 분리하면 증거성과 개인정보 보호를 함께 지킬 수 있습니다.'],
      distractors: [
        ['민감 필드를 직접 덮어쓴 같은 파일을 원본으로 삼고 별도 해시는 남기지 않는다', '원본을 변경하면 이후 자료가 같은 증거인지 검증하기 어렵습니다.'],
        ['재현에 필요할 수 있으므로 원본 응답을 제한 없는 팀 메신저에 그대로 올린다', '필요성 검토 없이 접근 범위를 넓히면 2차 노출을 만듭니다.'],
        ['개인정보 보호를 위해 원본과 요청 시각을 모두 삭제하고 요약 문장만 남긴다', '원본의 통제 보존과 최소 메타데이터가 없으면 재현성과 무결성을 잃습니다.'],
      ],
      takeaway: '원본은 해시와 접근 통제로 보존하고 공유본은 민감정보를 마스킹해 증거성과 최소화를 함께 지킵니다.',
    },
    ADVANCED: {
      question: '여러 분석자가 다루는 취약점 증거에서 무결성, 계보, 개인정보 최소화를 동시에 입증하는 절차는?',
      evidence: [['artifact', 'HAR+response body contains PII and bearer token'], ['workflow', 'three analysts; external vendor needs redacted reproduction package']],
      correct: ['암호화 원본에 해시·타임스탬프·인수 기록을 남기고 파생본만 마스킹한다', '정답입니다. 원본 계보와 파생본 변환 기록이 있어야 각 자료의 무결성과 공개 범위를 설명할 수 있습니다.'],
      distractors: [
        ['분석자마다 필요한 부분을 수동 편집하고 최종 파일 하나만 공유 저장소에 남긴다', '서로 다른 편집 과정과 원본 연결이 사라져 계보와 일관성을 입증할 수 없습니다.'],
        ['원본 해시만 기록하면 충분하므로 접근 로그와 파생본 마스킹 규칙은 생략한다', '해시는 파일 동일성만 보여 주며 누가 접근·변환했는지와 민감정보 최소화는 설명하지 못합니다.'],
        ['외부 공급자가 원인을 찾아야 하므로 토큰을 비활성화한 뒤 원본 전체를 이메일로 전송한다', '토큰 폐기와 별개로 개인정보·계약 데이터의 불필요한 전송은 피해야 합니다.'],
      ],
      takeaway: '암호화 원본, 해시·타임스탬프·인수 기록과 일관된 마스킹 파생본으로 증거 계보를 유지합니다.',
    },
  },
  {
    id: 'white-third-party-reporting', securityCircuitId: 'WHITE', category: 'CLOUD_SUPPLY',
    topic: '제3자 자산 발견과 보고', stages: ['SECTOR', 'PIT'], references: [REFS.CISA_VDP, REFS.NIST_800_115],
    BEGINNER: {
      question: '승인된 서비스 흐름에서 외부 결제사의 별도 호스트 문제가 의심된다. 다음 행동은?',
      evidence: [['승인 범위', 'shop.company.example만 능동 테스트 허용'], ['발견', '결제 단계가 vendor-pay.example로 이동 · 외부 회사 소유']],
      correct: ['외부 호스트 능동 테스트를 멈추고 의뢰 조직에 발견 사실과 소유권 확인을 요청한다', '정답입니다. 연동 관계만으로 제3자 자산에 대한 테스트 권한이 생기지 않습니다.'],
      distractors: [
        ['사용자 흐름에 포함되므로 같은 테스트 강도로 외부 결제 호스트까지 확인한다', '서비스 연동과 자산 소유·테스트 승인은 별도입니다.'],
        ['외부 회사에 알리기 전에 증거를 만들기 위해 계정 생성과 결제를 반복한다', '승인 없는 추가 행위는 제3자와 실제 거래에 영향을 줄 수 있습니다.'],
        ['회사 이름을 숨긴 개인 계정으로 외부 호스트를 확인한 뒤 결과만 전달한다', '신원을 숨겨도 무단 테스트의 범위 문제는 해결되지 않습니다.'],
      ],
      takeaway: '제3자 자산은 능동 검증을 중단하고 소유권과 별도 승인·공식 신고 채널을 확인합니다.',
    },
    ADVANCED: {
      question: '공급망 조사 중 범위 밖 제3자 자산에서 위험 신호가 보일 때 책임 있는 라우팅 절차는?',
      evidence: [['scope', 'allow=first-party domains; vendor assets explicitly excluded'], ['signal', 'first-party trace references vendor object; exploitability not independently confirmed']],
      correct: ['추가 요청을 멈추고 소유권·계약 연락망·제3자 VDP를 확인한다', '정답입니다. 불확실한 신호를 최소화해 전달하고 권한 있는 주체가 검증 경로를 정하게 합니다.'],
      distractors: [
        ['위험도가 높아 보이면 제외 조항보다 공익이 우선이므로 제3자에서 직접 재현한다', '긴급성 판단만으로 명시적 범위 제외와 제3자 권리를 무시할 수 없습니다.'],
        ['원 조직에 알리기 전 제3자 직원의 공개 연락처로 상세 요청 로그를 일괄 전송한다', '소유권·채널 확인 전 상세 자료 전송은 민감정보와 계약 정보를 노출할 수 있습니다.'],
        ['검증하지 않은 신호는 오탐일 수 있으므로 어떤 기록도 남기지 않고 무시한다', '추가 테스트 없이도 최소 신호와 경계를 기록해 권한 있는 주체에 전달할 수 있습니다.'],
      ],
      takeaway: '범위 밖 신호는 더 검증하지 말고 최소 정보로 소유권·계약 연락망·공식 VDP 경로에 라우팅합니다.',
    },
  },
  {
    id: 'white-sandbox-reproduction', securityCircuitId: 'WHITE', category: 'WEB_APP',
    topic: '격리된 재현 환경', stages: ['SECTOR', 'SPRINT'], references: [REFS.NIST_800_115],
    BEGINNER: {
      question: '운영 서비스에서 파일 처리 오류를 한 번 확인했다. 다음 재현은 어디서 해야 하는가?',
      evidence: [['운영 관찰', '특정 형식 파일에서 처리 프로세스가 재시작'], ['준비 가능', '같은 버전과 설정의 로컬 컨테이너·합성 파일 사용 가능']],
      correct: ['같은 버전·설정의 격리 환경에서 합성 파일과 정상 대조 파일로 재현한다', '정답입니다. 운영 영향을 더 만들지 않고 원인과 대조 결과를 반복 확인할 수 있습니다.'],
      distractors: [
        ['운영에서 한 번 더 같은 파일을 올려 동일 재시작이 나는지 우선 확인한다', '이미 운영 영향이 관찰됐으므로 반복 전에 격리된 환경으로 옮겨야 합니다.'],
        ['버전이 다른 개인 PC에서 파일 확장자만 같게 바꿔 결과를 비교한다', '버전과 설정이 다르면 원인 조건을 분리하기 어렵습니다.'],
        ['정상 대조 없이 오류 파일만 여러 번 실행해 재현 횟수를 늘린다', '양성 사례만 반복하면 파일 조건과 환경 문제를 구분하기 어렵습니다.'],
      ],
      takeaway: '운영 영향 신호가 있으면 같은 버전·설정의 격리 환경과 합성 데이터·정상 대조군으로 이동합니다.',
    },
    ADVANCED: {
      question: '운영에서 관찰된 처리기 충돌을 위험 확장 없이 원인 조건까지 재현하는 실험 설계는?',
      evidence: [['production', 'worker_restart correlated with one object; customer data involved'], ['fixture', 'image digest+config captured; isolated network and synthetic corpus available']],
      correct: ['동일 digest·설정의 격리 fixture에서 합성 표본과 대조군을 실행한다', '정답입니다. 환경 동등성과 대조군을 유지하면서 고객 데이터와 외부 영향 없이 원인 조건을 좁힙니다.'],
      distractors: [
        ['운영 트래픽 복제본을 그대로 외부 테스트 서비스에 보내 파서 차이를 비교한다', '고객 데이터와 운영 요청을 승인되지 않은 외부 경계로 이동시킬 수 있습니다.'],
        ['최신 버전 컨테이너만 사용해 충돌이 사라지면 원인이 수정됐다고 판단한다', '환경이 달라진 단일 결과로 원인이나 수정 유효성을 입증할 수 없습니다.'],
        ['격리 환경에서는 네트워크 제한을 풀어 운영 의존성과 같은 조건을 완전히 재현한다', '불필요한 외부 연결은 격리 목적을 깨며 필요한 의존성만 통제해 모사해야 합니다.'],
      ],
      takeaway: '동일 artifact·설정, 네트워크 격리, 합성 최소 표본과 양성·음성 대조로 운영 관찰을 재현합니다.',
    },
  },
  {
    id: 'white-retest-window', securityCircuitId: 'WHITE', category: 'WEB_APP',
    topic: '수정 재검증 기간과 범위', stages: ['PIT', 'SPRINT'], references: [REFS.NIST_800_115],
    BEGINNER: {
      question: '수정 완료 연락을 받았지만 원래 테스트 기간이 끝났다. 재검증 전에 무엇을 해야 하는가?',
      evidence: [['기존 승인', '테스트 종료=어제 18:00'], ['수정 알림', '개발팀이 오늘 운영 배포 완료 · 재검증 요청 문서 없음']],
      correct: ['재검증 대상·기간·환경을 다시 승인받고 기존 최소 재현과 정상 대조를 수행한다', '정답입니다. 수정 확인도 새로운 실행 시점과 범위에 맞는 승인이 필요합니다.'],
      distractors: [
        ['기존 취약점과 같은 요청이면 기간이 지나도 원래 승인에 포함된 것으로 본다', '승인 기간이 끝났다면 같은 요청이라도 새 실행은 범위 밖입니다.'],
        ['수정팀이 배포했다고 했으므로 코드 차이만 읽고 재검증 성공으로 기록한다', '실제 적용과 회귀 여부는 승인된 런타임 대조로 확인해야 합니다.'],
        ['운영에서 오류 응답 한 번만 확인하고 정상 기능 대조 없이 수정 완료로 판정한다', '단일 거부 응답은 올바른 권한 검사나 정상 회귀를 입증하지 못합니다.'],
      ],
      takeaway: '재검증도 유효한 기간·대상·환경 승인을 받고 기존 최소 재현과 정상 회귀를 함께 확인합니다.',
    },
    ADVANCED: {
      question: '수정 배포 뒤 원래 RoE가 만료된 상태에서 증거 연속성과 안전한 회귀 검증을 보장하는 절차는?',
      evidence: [['original', 'finding=tenant authz; test_window expired; request IDs archived'], ['change', 'policy middleware replaced; production deploy claimed; retest approval absent']],
      correct: ['새 retest 범위를 승인받고 동일 oracle·trace·정상 회귀를 비교한다', '정답입니다. 승인 갱신과 동일 oracle을 통해 수정 전후 증거를 연결하고 회귀를 분리합니다.'],
      distractors: [
        ['원 발견의 요청 ID가 있으므로 만료된 RoE로 수정된 운영 경로를 자동 재생한다', '기존 증거는 새 실행 권한이 아니며 운영 재생에는 별도 승인과 안전 조건이 필요합니다.'],
        ['정책 코드의 단위 테스트가 통과하면 운영 배포와 교차 테넌트 거부도 입증된 것으로 본다', '단위 테스트는 실제 라우팅·정책 조합과 배포 상태를 대체하지 못합니다.'],
        ['비인가 요청 거부만 확인하고 소유자 요청과 인접 정상 기능은 이전 결과를 그대로 인용한다', '수정으로 정상 경로가 깨지지 않았는지 같은 배포에서 회귀 검증해야 합니다.'],
      ],
      takeaway: '새 재검증 승인과 동일한 oracle·추적 기준으로 수정 전후 및 정상 회귀를 비교합니다.',
    },
  },
  {
    id: 'white-test-cleanup', securityCircuitId: 'WHITE', category: 'CLOUD_SUPPLY',
    topic: '테스트 산출물 정리', stages: ['SECTOR', 'SPRINT'], references: [REFS.NIST_800_115],
    BEGINNER: {
      question: '승인된 검증이 끝난 뒤 남긴 테스트 계정과 파일은 어떻게 처리해야 하는가?',
      evidence: [['생성 항목', '테스트 계정 3개 · 임시 토큰 2개 · canary 파일 4개'], ['보존 요구', '서버 감사 로그와 최종 보고 근거는 유지']],
      correct: ['계정·토큰·canary를 폐기·확인하고 감사 로그는 보존한다', '정답입니다. 테스트로 만든 접근 수단과 데이터만 정리하고 조사·감사 증거는 유지합니다.'],
      distractors: [
        ['다음 점검에서 재사용할 수 있도록 계정과 토큰을 비활성 표시만 하고 남긴다', '장기 잔존 자격 증명은 새 공격면이 되며 재사용 전 새로 발급해야 합니다.'],
        ['흔적을 모두 없애기 위해 서버 감사 로그와 접근 기록도 함께 삭제 요청한다', '감사 로그는 테스트와 운영 행위를 구분하고 결과를 검증하는 증거입니다.'],
        ['canary 파일만 지우고 계정과 토큰은 자연 만료될 때까지 기다린다', '명시적 폐기와 잔존 확인 없이는 만료 전 오용 가능성을 남깁니다.'],
      ],
      takeaway: '테스트 계정·토큰·데이터는 목록대로 폐기하고 잔존을 확인하며 서버 감사 증거는 보존합니다.',
    },
    ADVANCED: {
      question: '다중 환경 평가 종료 시 접근 수단과 테스트 artifact를 제거하면서 감사 가능성을 유지하는 종료 기준은?',
      evidence: [['inventory', 'ephemeral principals, API tokens, uploaded canaries, temporary allow rules'], ['audit', 'server logs and evidence hashes required for final report and dispute handling']],
      correct: ['artifact 목록으로 폐기·회수·규칙 복원을 확인하고 감사 trail은 보존한다', '정답입니다. 운영 공격면을 원상복구하면서 결과의 감사·추적 가능성을 유지합니다.'],
      distractors: [
        ['클라이언트 도구의 로컬 파일만 삭제하면 서버 측 계정과 정책도 정리된 것으로 간주한다', '서버에 남은 principal·토큰·정책 변경은 별도 확인해야 합니다.'],
        ['향후 회귀 시험 효율을 위해 임시 allow rule과 토큰을 비밀 저장소에 영구 보관한다', '임시 권한은 평가 종료와 함께 회수하고 다음 시험에는 새 승인·자격 증명을 사용해야 합니다.'],
        ['개인정보 최소화를 위해 테스트 trace와 증거 해시를 포함한 모든 감사 자료를 파기한다', '민감 원본 최소화와 검증 가능한 해시·감사 trail 보존은 함께 설계할 수 있습니다.'],
      ],
      takeaway: 'artifact inventory로 폐기와 원상복구를 검증하고 증거 해시·감사 trail은 통제 보존합니다.',
    },
  },
  {
    id: 'white-false-positive-impact-controls', securityCircuitId: 'WHITE', category: 'WEB_APP',
    topic: '오탐과 영향 대조 검증', stages: ['LAUNCH', 'SPRINT'], references: [REFS.NIST_800_115],
    BEGINNER: {
      question: '스캐너가 관리자 페이지 노출을 경고했지만 실제 권한 상승은 확인되지 않았다. 다음 검증은?',
      evidence: [['스캐너', 'URL 응답 200 · 제목에 Admin 포함'], ['수동 확인', '테스트 일반 계정에 표시된 데이터와 가능한 동작은 아직 비교하지 않음']],
      correct: ['일반/관리 테스트 계정의 자원·동작 차이를 직접 비교한다', '정답입니다. 상태 코드나 제목이 아니라 권한별 자원·행동 차이를 대조해야 영향을 판단할 수 있습니다.'],
      distractors: [
        ['관리자라는 제목이 보이므로 최고 심각도 권한 상승으로 바로 보고한다', '화면 제목만으로 보호 자원 접근이나 관리자 행동 가능성을 입증할 수 없습니다.'],
        ['오탐 가능성이 있으므로 수동 대조 없이 스캐너 결과를 전부 폐기한다', '자동 신호는 가설이며 승인된 대조 검증으로 사실 여부를 판단해야 합니다.'],
        ['영향을 확실히 보이기 위해 운영 관리자 기능으로 실제 설정을 변경한다', '영향 입증에 불필요한 운영 변경은 피해를 만들며 최소 검증 원칙을 위반합니다.'],
      ],
      takeaway: '자동 경고는 가설로 취급하고 승인된 권한 대조와 최소 영향 확인으로 오탐·실제 영향을 구분합니다.',
    },
    ADVANCED: {
      question: '자동 탐지 결과의 exploitability와 실제 영향을 과장 없이 입증하는 대조 설계는?',
      evidence: [['signal', 'HTTP 200; admin-like route; response size equal for guest/user'], ['controls', 'test viewer/admin principals available; destructive actions prohibited']],
      correct: ['viewer/admin·비인증 대조로 자원·행동 차이와 영향 상한을 기록한다', '정답입니다. 주체별 oracle과 금지선을 사용해 접근 차이와 입증 가능한 영향 범위를 분리합니다.'],
      distractors: [
        ['라우트 이름과 상태 코드가 일치하므로 인증 우회와 관리자 권한을 동시에 성립한 것으로 본다', '명칭과 상태는 실제 자원·행동 권한의 충분한 증거가 아닙니다.'],
        ['관리자 principal 없이 viewer 응답만 반복해 안정적으로 200이면 취약점으로 확정한다', '권한 대조가 없으면 공개 의도, 공통 shell, 실제 인가 실패를 구분하기 어렵습니다.'],
        ['심각도 산정을 위해 금지된 변경 API를 실행하고 성공 후 즉시 원상복구한다', '원상복구 계획이 있어도 금지된 파괴적 검증은 승인 범위를 넘습니다.'],
      ],
      takeaway: '주체·자원·행동 행렬과 비인증 대조를 사용하고 최소 증거로 확인된 영향 상한만 보고합니다.',
    },
  },
  {
    id: 'red-request-parser-discrepancy', securityCircuitId: 'RED', category: 'WEB_APP',
    topic: 'HTTP 요청 경계 불일치', stages: ['LAUNCH', 'SECTOR'], references: [REFS.RFC_9112],
    BEGINNER: {
      question: '게이트웨이와 애플리케이션이 한 요청의 끝을 다르게 판단할 때 생기는 핵심 공격 경로는?',
      evidence: [['게이트웨이', '요청 본문 길이를 한 헤더 기준으로 계산'], ['애플리케이션', '같은 연결에서 다른 프레이밍 규칙으로 다음 바이트를 해석']],
      correct: ['앞단과 뒷단의 요청 경계가 어긋나 다음 바이트의 요청 소유자가 바뀔 수 있다', '정답입니다. 연결을 재사용할 때 서로 다른 프레이밍 판단이 요청 대기열의 경계를 흔듭니다.'],
      distractors: [
        ['TLS 인증서 이름이 달라 브라우저가 다른 사이트로 자동 이동할 수 있다', '증거는 인증서나 브라우저 이동이 아니라 서버 간 메시지 프레이밍 차이를 가리킵니다.'],
        ['응답 압축률이 달라 같은 본문에서 비밀 길이가 추측될 수 있다', '압축 부채널은 요청 경계 해석 불일치와 다른 전제입니다.'],
        ['URL 대소문자 정규화 차이로 정적 파일 캐시만 두 벌 생성될 수 있다', '경로 정규화보다 한 연결에서 요청 시작·종료를 다르게 보는 것이 핵심입니다.'],
      ],
      takeaway: '앞단과 뒷단이 동일한 HTTP 프레이밍 규칙으로 요청 경계를 해석하지 않으면 연결 대기열의 요청 소유권이 흔들립니다.',
    },
    ADVANCED: {
      question: '재사용 연결에서 프록시와 origin의 메시지 길이 판정이 다를 때 성립하는 신뢰 경계 실패는?',
      evidence: [['proxy_trace', 'framing decision=A; forwards connection keep-alive'], ['origin_trace', 'framing decision=B; residual bytes parsed as a subsequent request']],
      correct: ['서로 다른 프레이밍 oracle이 공유 연결의 요청 귀속을 비동기화한다', '정답입니다. 두 parser의 메시지 길이 판정 차이가 공유 연결에서 요청 귀속을 바꿉니다.'],
      distractors: [
        ['프록시의 캐시 키가 origin의 응답 변형 헤더를 포함하지 않아 객체가 공유된다', '캐시 키 문제는 응답 저장 경계이며 제시된 잔여 바이트 파싱과 다릅니다.'],
        ['origin 인증서 검증이 생략돼 프록시가 임의 백엔드와 TLS 세션을 맺는다', '증거는 TLS peer 검증이 아니라 HTTP 메시지 길이 oracle 불일치입니다.'],
        ['서버가 압축 응답과 비압축 응답을 같은 ETag로 처리해 조건 요청이 어긋난다', 'ETag·표현 선택은 요청 큐 비동기화의 직접 원인이 아닙니다.'],
      ],
      takeaway: '프록시와 origin의 메시지 길이 oracle을 일치시키고 모호한 프레이밍을 거부해야 요청 큐 경계를 보존할 수 있습니다.',
    },
  },
  {
    id: 'red-cache-key-poisoning', securityCircuitId: 'RED', category: 'WEB_APP',
    topic: '캐시 키와 응답 변형 입력', stages: ['SECTOR', 'PIT'], references: [REFS.RFC_9111],
    BEGINNER: {
      question: '사용자 입력이 응답을 바꾸지만 공유 캐시 키에는 포함되지 않을 때 가장 중요한 위험은?',
      evidence: [['origin', '특정 요청 헤더 값이 페이지 링크 생성에 반영됨'], ['cache', '키는 scheme+host+path만 사용 · 여러 사용자에게 HIT']],
      correct: ['한 사용자가 바꾼 응답이 같은 캐시 키의 다른 사용자에게 재사용될 수 있다', '정답입니다. 응답을 변화시키는 입력이 키에 없으면 공격자 변형이 공유 객체가 될 수 있습니다.'],
      distractors: [
        ['Cache-Control이 public이면 응답을 바꾼 모든 요청 헤더도 자동으로 키에 포함된다', 'public 지시는 저장 가능성을 말할 뿐 응답 변형 입력을 키에 자동 추가하지 않습니다.'],
        ['origin이 Host만 검증하면 다른 헤더가 응답을 바꿔도 공유 캐시는 안전하다', 'Host 검증만으로 캐시 키 밖의 응답 변형 입력을 통제할 수 없습니다.'],
        ['캐시 HIT가 빠르면 origin과 같은 응답이므로 키 구성을 따로 확인할 필요가 없다', '응답 속도는 어떤 입력이 cache identity에 포함됐는지 증명하지 않습니다.'],
      ],
      takeaway: '응답을 변화시키는 입력은 캐시 키 또는 Vary 정책에 반영하고 비공개 응답의 공유 저장을 막아야 합니다.',
    },
    ADVANCED: {
      question: 'origin 응답을 바꾸는 비키 입력과 공유 HIT가 관찰될 때 공격 사슬의 핵심 결속 실패는?',
      evidence: [['request', 'header X-Forwarded-Host changes canonical link'], ['cache', 'key={scheme,host,path}; Vary excludes input; public HIT across principals']],
      correct: ['응답 변형 입력이 cache identity에 빠져 다른 principal에게 재사용된다', '정답입니다. origin의 표현 선택과 캐시 객체 identity가 같은 입력 집합을 사용하지 않습니다.'],
      distractors: [
        ['조건 요청 validator가 약해 같은 사용자의 오래된 표현이 재검증 없이 남는다', 'staleness 문제만으로 교차 principal 변형 응답의 원인을 설명하지 못합니다.'],
        ['캐시 저장소 암호화가 없어 운영자가 저장된 응답을 읽을 수 있다', '저장 암호화와 비키 입력에 의한 공유 객체 오염은 다른 경계입니다.'],
        ['origin의 DNS TTL이 캐시 TTL보다 짧아 백엔드 주소 전환이 늦게 반영된다', 'DNS 주소 전환은 제시된 응답 변형 헤더와 cache identity 불일치가 아닙니다.'],
      ],
      takeaway: 'origin 표현을 바꾸는 입력과 cache identity를 일치시키고 principal별 응답은 공유 캐시에서 분리합니다.',
    },
  },
  {
    id: 'red-jwt-trust-selection', securityCircuitId: 'RED', category: 'IDENTITY',
    topic: 'JWT 검증 신뢰 선택', stages: ['LAUNCH', 'SPRINT'], references: [REFS.RFC_8725],
    BEGINNER: {
      question: 'API가 토큰 안의 알고리즘·키 위치 정보를 그대로 따라 검증할 때 생기는 핵심 위험은?',
      evidence: [['token', '헤더가 검증 알고리즘과 키 식별 정보를 제시'], ['verifier', '서버 고정 정책 없이 토큰 값으로 검증 방식을 선택']],
      correct: ['공격자가 검증에 사용할 신뢰 기준을 토큰 입력으로 바꾸게 될 수 있다', '정답입니다. 검증 알고리즘과 키 신뢰는 서버 정책으로 고정돼야 합니다.'],
      distractors: [
        ['토큰 본문이 Base64 형식이면 네트워크 구간에서 자동으로 암호화된다', 'Base64는 표현 형식이며 기밀성이나 검증 신뢰를 제공하지 않습니다.'],
        ['토큰 만료 시간이 짧으면 발급자와 대상 서비스 확인을 생략해도 안전하다', '짧은 수명은 issuer·audience·키 신뢰 검증을 대신하지 못합니다.'],
        ['서명 길이가 길수록 어떤 키로 검증해도 동일한 발급자임을 보장한다', '서명 길이는 신뢰할 발급자와 키 선택 정책을 보장하지 않습니다.'],
      ],
      takeaway: 'JWT 검증 알고리즘·키·발급자·대상은 토큰이 아니라 서버의 고정된 허용 정책으로 선택합니다.',
    },
    ADVANCED: {
      question: '다중 issuer 환경에서 token-controlled key selection이 권한 검증을 무너뜨리는 전제 조합은?',
      evidence: [['header', 'alg and key reference accepted without configured allowlist'], ['claims', 'issuer lookup is dynamic; audience accepted by default; key provenance unpinned']],
      correct: ['토큰 입력이 키·알고리즘을 고르고 issuer/audience 결속도 우회한다', '정답입니다. 알고리즘·키 provenance와 issuer/audience를 함께 고정하지 않으면 다른 신뢰 도메인이 섞일 수 있습니다.'],
      distractors: [
        ['토큰 압축을 사용하지 않아 클레임 크기가 커지고 검증 지연이 발생한다', '성능 특성은 key selection과 trust domain 혼합의 원인이 아닙니다.'],
        ['서명 토큰에 암호화를 추가하지 않아 모든 클레임 이름이 사용자에게 보인다', '기밀성 문제와 서명 검증의 신뢰 기준 선택은 구분해야 합니다.'],
        ['refresh token 회전이 없어 access token 만료 뒤 새 토큰이 재사용될 수 있다', '갱신 토큰 수명주기는 제시된 JWT verifier trust-selection 경로와 다릅니다.'],
      ],
      takeaway: 'JWT는 알고리즘 허용 목록, 고정된 키 provenance, issuer와 audience 결속을 하나의 검증 정책으로 강제합니다.',
    },
  },
  {
    id: 'red-oauth-audience-boundary', securityCircuitId: 'RED', category: 'IDENTITY',
    topic: 'OAuth 토큰 audience 경계', stages: ['SECTOR', 'PIT'], references: [REFS.RFC_8707],
    BEGINNER: {
      question: '서비스 A용 접근 토큰이 서비스 B에서도 받아들여진다면 어떤 경계가 빠진 것인가?',
      evidence: [['token', '발급 목적은 files-api'], ['service B', 'issuer와 서명만 확인하고 자신의 대상 서비스인지 확인하지 않음']],
      correct: ['토큰이 어느 리소스 서버를 위한 것인지 audience를 서비스가 확인하지 않는다', '정답입니다. 서명이 유효해도 다른 리소스용 토큰은 현재 서비스에서 거부해야 합니다.'],
      distractors: [
        ['같은 issuer의 유효 서명이면 모든 API가 같은 scope 의미로 받아도 된다', '같은 issuer라도 resource와 API별 scope 의미는 별도로 검증해야 합니다.'],
        ['토큰 수명을 짧게 하면 audience 확인 없이도 서비스 간 재사용이 막힌다', '짧은 수명은 재사용 시간을 줄일 뿐 잘못된 대상 서비스 수락을 막지 못합니다.'],
        ['두 API가 같은 client ID를 쓰면 서비스 B의 audience도 자동으로 일치한다', 'client ID와 리소스 서버 audience는 같은 신뢰 경계가 아닙니다.'],
      ],
      takeaway: '리소스 서버는 서명과 issuer뿐 아니라 토큰 audience가 자기 서비스인지 확인해야 합니다.',
    },
    ADVANCED: {
      question: '여러 리소스 서버가 같은 issuer를 신뢰할 때 토큰 전용 공격을 막는 핵심 검증 조건은?',
      evidence: [['grant', 'resource=files-api; scope=read:file'], ['billing-api', 'signature valid; issuer trusted; aud/resource not enforced; scope name overlaps']],
      correct: ['API가 issuer·audience/resource·scope를 함께 검증하지 않는다', '정답입니다. 같은 issuer와 비슷한 scope 이름만으로 토큰의 대상 경계를 공유할 수 없습니다.'],
      distractors: [
        ['모든 API가 동일한 scope 문자열을 쓰면 토큰 교환 없이도 권한 의미가 자동 통일된다', 'scope 이름이 같아도 resource와 정책 의미는 서비스마다 다를 수 있습니다.'],
        ['access token을 JWT로 만들면 서명 검증만으로 대상 API와 권한이 모두 확정된다', 'JWT 형식 자체는 audience·resource·scope 정책 검증을 대신하지 않습니다.'],
        ['토큰 수명을 더 짧게 하면 다른 API가 잘못 수락하는 문제도 성립하지 않는다', '짧은 수명은 오용 시간을 줄일 뿐 대상 서비스 검증 누락을 제거하지 않습니다.'],
      ],
      takeaway: '공유 issuer 환경에서는 audience/resource와 서비스별 scope 의미를 함께 검증해 토큰 전용을 막습니다.',
    },
  },
  {
    id: 'red-graphql-object-authorization', securityCircuitId: 'RED', category: 'WEB_APP',
    topic: 'GraphQL resolver 인가', stages: ['SECTOR', 'PIT'], references: [REFS.GRAPHQL_AUTH],
    BEGINNER: {
      question: 'GraphQL 최상위 요청은 로그인 검사를 하지만 중첩된 주문 항목이 다른 고객 데이터까지 반환된다. 핵심 결함은?',
      evidence: [['query', 'viewer가 자신의 account를 통해 order(id)를 요청'], ['resolver', 'order resolver가 로그인만 확인하고 order.owner는 비교하지 않음']],
      correct: ['중첩 resolver가 요청 주체와 개별 객체 소유권을 확인하지 않는다', '정답입니다. GraphQL도 각 객체와 필드 경계에서 현재 주체의 권한을 확인해야 합니다.'],
      distractors: [
        ['한 요청에서 필드를 여러 개 선택할 수 있어 응답 JSON 크기가 달라진다', '필드 수 자체보다 다른 소유자의 객체를 허용한 resolver 인가가 핵심입니다.'],
        ['스키마 이름이 공개돼 공격자가 Order 타입의 철자를 알 수 있다', '스키마 가시성과 객체 단위 권한 검증은 별도 문제입니다.'],
        ['POST 요청을 사용해 브라우저 주소창에 query 문자열이 보이지 않는다', 'HTTP 메서드는 resolver의 객체 소유권 검사를 대신하지 않습니다.'],
      ],
      takeaway: 'GraphQL 인가는 진입점뿐 아니라 각 resolver의 주체·테넌트·객체·필드 경계에서 수행합니다.',
    },
    ADVANCED: {
      question: '별칭·중첩 조회에서 교차 테넌트 객체가 섞일 때 공격 사슬을 만드는 권한 경계는?',
      evidence: [['operation', 'principal tenant=A; aliases request orders from A and B'], ['resolver_trace', 'root authn=true; child resolver loads by global ID; owner/tenant policy absent']],
      correct: ['child resolver가 principal·tenant·object 정책 없이 global ID를 읽는다', '정답입니다. 실행 그래프의 각 데이터 로더와 resolver가 객체 정책을 강제해야 합니다.'],
      distractors: [
        ['별칭이 같은 필드를 여러 이름으로 반환해 클라이언트 캐시 키가 늘어난다', '별칭으로 인한 클라이언트 표현과 서버의 교차 테넌트 인가 실패는 다릅니다.'],
        ['query depth가 깊어져 CPU 사용량이 증가하고 응답 시간이 길어진다', '자원 소비 문제만으로 다른 테넌트 객체 반환을 설명할 수 없습니다.'],
        ['스키마 introspection이 켜져 타입과 필드 설명을 조회할 수 있다', '스키마 발견 가능성은 resolver의 principal-object 정책 누락과 별개입니다.'],
      ],
      takeaway: 'root 인증을 하위 resolver 인가로 간주하지 말고 데이터 로더마다 principal·tenant·object 정책을 강제합니다.',
    },
  },
  {
    id: 'red-race-idempotency', securityCircuitId: 'RED', category: 'WEB_APP',
    topic: '동시성·멱등성 경계', stages: ['PIT', 'SPRINT'], references: [REFS.CWE_362],
    BEGINNER: {
      question: '한 번만 쓸 수 있는 쿠폰을 동시에 두 번 요청했더니 둘 다 성공했다. 핵심 원인은?',
      evidence: [['처리', '각 요청이 used=false를 읽은 뒤 할인 적용'], ['저장', '두 요청이 끝에서 각각 used=true를 기록']],
      correct: ['상태 확인과 변경이 원자적이지 않아 두 요청이 함께 통과한다', '정답입니다. 경쟁 요청이 공유 상태를 읽고 바꾸는 구간을 원자적으로 보호해야 합니다.'],
      distractors: [
        ['쿠폰 문자열이 짧아 두 사용자가 우연히 같은 코드를 입력할 수 있다', '증거는 코드 충돌이 아니라 같은 쿠폰 상태를 병렬로 처리한 흐름입니다.'],
        ['응답 압축이 켜져 두 성공 응답의 크기가 동일하게 보인다', '응답 표현은 중복 상태 변경의 원인이 아닙니다.'],
        ['브라우저가 완료 화면을 새로고침해 이전 성공 화면을 다시 표시한다', '서버에 두 번 적용된 상태 변경이 확인됐으므로 단순 화면 재표시가 아닙니다.'],
      ],
      takeaway: '일회성 작업은 상태 확인과 변경을 원자적으로 묶고 요청의 멱등성 식별자를 서버에서 강제합니다.',
    },
    ADVANCED: {
      question: '병렬 요청에서 동일 자원 전이가 두 번 커밋될 때 공격 가능성을 만드는 선형화 실패는?',
      evidence: [['trace', 'R1 read version=7; R2 read version=7; both authorize'], ['commit', 'two side effects emitted; final version=8; idempotency key not enforced']],
      correct: ['인가 전제와 side effect가 한 선형화 지점에 결속되지 않는다', '정답입니다. 원자적 조건부 갱신이나 멱등성 키가 공유 상태 전이를 한 번으로 제한해야 합니다.'],
      distractors: [
        ['두 요청의 TLS 세션이 달라 서버가 같은 사용자를 서로 다른 principal로 해석한다', '세션이 달라도 trace는 같은 자원 version의 비원자적 전이를 보여 줍니다.'],
        ['최종 version이 8이라 감사 로그가 첫 번째 요청만 기록하고 두 번째를 숨긴다', '로그 표현보다 두 side effect가 모두 인가·커밋된 선형화 실패가 핵심입니다.'],
        ['응답 순서가 요청 순서와 달라 클라이언트가 성공 상태를 두 번 렌더링한다', '서버 side effect 중복은 화면 렌더링 순서만으로 발생하지 않습니다.'],
      ],
      takeaway: '조건부 원자 갱신과 멱등성 키로 인가 전제·상태 전이·side effect를 하나의 선형화 지점에 묶습니다.',
    },
  },
  {
    id: 'red-deserialization-preconditions', securityCircuitId: 'RED', category: 'WEB_APP',
    topic: '역직렬화 실행 전제', stages: ['SECTOR', 'SPRINT'], references: [REFS.CWE_502],
    BEGINNER: {
      question: '외부에서 받은 객체 데이터를 복원하는 기능이 코드 실행으로 이어지려면 어떤 전제가 함께 필요할 수 있는가?',
      evidence: [['입력', '사용자가 보낸 바이트가 객체 역직렬화 함수로 전달'], ['환경', '복원 과정에서 호출되는 클래스 동작이 허용 목록 없이 로드 가능']],
      correct: ['비신뢰 데이터와 실행 가능한 복원 동작이 함께 존재한다', '정답입니다. 입력 도달성과 복원 과정의 실행 가능한 동작이 함께 있어야 공격 사슬이 완성됩니다.'],
      distractors: [
        ['직렬화 데이터가 Base64로 보이면 전송 중 자동으로 신뢰된 객체가 된다', 'Base64는 표현 방식이며 입력 신뢰나 실행 안전성을 제공하지 않습니다.'],
        ['복원 오류를 try/catch로 감싸면 어떤 클래스가 로드돼도 실행 경로가 사라진다', '예외 처리는 오류 표시를 바꿀 뿐 복원 중 이미 실행되는 동작을 막지 못할 수 있습니다.'],
        ['파일 확장자가 데이터 전용이면 내부 객체 형식과 상관없이 실행되지 않는다', '확장자는 실제 parser와 객체 복원 동작을 제한하지 않습니다.'],
      ],
      takeaway: '역직렬화 위험은 비신뢰 입력의 sink 도달성과 복원 중 실행 가능한 클래스·hook 전제가 결합될 때 성립합니다.',
    },
    ADVANCED: {
      question: '비신뢰 직렬화 입력이 실행 영향으로 이어지는 공격 사슬을 입증하는 최소 전제 집합은?',
      evidence: [['dataflow', 'external bytes -> generic object deserializer; integrity check absent'], ['runtime', 'class allowlist absent; reachable callback performs privileged operation']],
      correct: ['비신뢰 object graph가 callback을 거쳐 권한 sink에 도달한다', '정답입니다. 입력 무결성, 타입 제약, callback 도달성과 sink 권한을 함께 확인해야 합니다.'],
      distractors: [
        ['직렬화 포맷 버전이 오래돼 parser가 최신 필드를 무시할 수 있다', '호환성 차이만으로 callback과 권한 sink의 실행 경로가 성립하지 않습니다.'],
        ['응답에 복원된 객체 클래스 이름이 노출돼 내부 패키지 구조를 알 수 있다', '정보 노출은 단서지만 실행 영향에는 callback과 sink 도달성이 추가로 필요합니다.'],
        ['객체 데이터가 압축돼 있어 해제 뒤 메모리 사용량이 늘어날 수 있다', '자원 소비 가능성과 객체 callback을 통한 실행 사슬은 다른 전제입니다.'],
      ],
      takeaway: 'object graph 제어, 실행형 deserializer 도달, callback 가용성과 권한 sink 연결을 분리해 검증합니다.',
    },
  },
  {
    id: 'red-template-evaluation-boundary', securityCircuitId: 'RED', category: 'WEB_APP',
    topic: '서버 템플릿 평가 경계', stages: ['LAUNCH', 'SECTOR'], references: [REFS.CWE_1336],
    BEGINNER: {
      question: '사용자 메시지를 화면 데이터가 아니라 새 템플릿 원문으로 만들어 렌더링할 때 생기는 핵심 위험은?',
      evidence: [['코드 흐름', '사용자 문자열을 template engine의 compile 입력으로 전달'], ['요구', '원래 목적은 메시지를 일반 텍스트로 표시']],
      correct: ['비신뢰 텍스트가 템플릿 문법으로 평가돼 서버 렌더링 권한을 사용할 수 있다', '정답입니다. 데이터로 표시할 문자열이 코드 성격의 템플릿으로 해석되는 경계 전환이 핵심입니다.'],
      distractors: [
        ['템플릿 파일 이름이 길어져 운영체제의 경로 길이 제한을 넘을 수 있다', '증거는 파일 경로가 아니라 비신뢰 문자열의 템플릿 평가를 가리킵니다.'],
        ['메시지에 HTML이 없으면 브라우저가 글꼴을 선택하지 못할 수 있다', '표시 형식과 서버 템플릿 문법 평가 경계는 다른 문제입니다.'],
        ['렌더링 결과가 캐시되면 같은 사용자가 이전 메시지를 다시 볼 수 있다', '캐시 staleness만으로 서버 권한의 템플릿 평가를 설명하지 못합니다.'],
      ],
      takeaway: '사용자 값은 템플릿 원문으로 컴파일하지 말고 고정 템플릿의 데이터 변수로 전달합니다.',
    },
    ADVANCED: {
      question: '동적 템플릿 컴파일이 서버 실행 영향으로 이어지는 신뢰 경계 위반은?',
      evidence: [['sink', 'compile(untrusted_message) then render(server_context)'], ['context', 'template helpers expose filesystem-backed loader and privileged application objects']],
      correct: ['비신뢰 문자열이 template AST와 privileged context를 함께 제어한다', '정답입니다. 문법 제어와 권한 있는 render context 도달성이 결합돼 실행 영향이 생깁니다.'],
      distractors: [
        ['동적 템플릿의 캐시 키가 짧아 서로 다른 메시지가 같은 compiled object를 공유한다', '캐시 충돌 가능성보다 AST 제어와 privileged context 노출이 직접 공격 경계입니다.'],
        ['렌더링 결과의 Content-Type이 text/html이라 브라우저가 markup을 해석한다', '클라이언트 HTML 해석은 서버 템플릿 평가와 별도의 후속 경계입니다.'],
        ['template loader가 상대 경로를 사용해 배포 환경마다 파일 위치가 달라진다', '경로 이식성만으로 비신뢰 AST와 권한 객체 연결을 설명하지 못합니다.'],
      ],
      takeaway: '템플릿 소스는 신뢰된 고정 자산으로 제한하고 비신뢰 값은 권한 없는 데이터 변수로만 전달합니다.',
    },
  },
  {
    id: 'red-command-execution-boundary', securityCircuitId: 'RED', category: 'WEB_APP',
    topic: '명령 실행 데이터 경계', stages: ['SECTOR', 'PIT'], references: [REFS.CWE_78],
    BEGINNER: {
      question: '사용자 파일 이름을 셸 명령 문자열에 이어 붙일 때 핵심 공격 전제는?',
      evidence: [['구현', '프로그램과 인자를 분리하지 않고 하나의 문자열을 shell에 전달'], ['입력', '사용자가 파일 이름의 일부를 선택 가능']],
      correct: ['비신뢰 문자열이 데이터가 아니라 셸 문법으로 다시 해석될 수 있다', '정답입니다. 셸 interpreter가 사용자 조각을 명령 문법으로 해석하는 경계가 생깁니다.'],
      distractors: [
        ['인자 전체를 따옴표로 한 번 감싸면 어떤 셸 문법도 항상 데이터가 된다', '셸별 인용·확장 규칙이 달라 단순 문자열 감싸기를 안전 경계로 볼 수 없습니다.'],
        ['파일 이름에서 공백만 제거하면 나머지 입력은 안전한 명령 인자가 된다', '셸은 공백 외에도 여러 문법 요소를 해석하므로 부분 필터로 경계를 보장할 수 없습니다.'],
        ['실행 계정을 비root로 바꾸면 사용자 입력의 셸 해석 문제도 함께 사라진다', '최소 권한은 영향을 줄이지만 command grammar 제어 자체를 제거하지 않습니다.'],
      ],
      takeaway: '외부 프로그램은 셸 문자열이 아니라 실행 파일과 검증된 인자 배열로 호출하고 입력을 문법에서 분리합니다.',
    },
    ADVANCED: {
      question: '프로세스 실행 API 사용에서 데이터가 명령 문법으로 승격되는 정확한 신뢰 경계는?',
      evidence: [['call', 'shell=true; command assembled from fixed prefix + user-controlled filename'], ['privilege', 'worker account can read service secrets; allowlist and argument separation absent']],
      correct: ['사용자 조각이 shell parser에서 worker 권한의 command grammar가 된다', '정답입니다. 데이터 흐름이 interpreter grammar와 권한 있는 프로세스 경계에 동시에 도달합니다.'],
      distractors: [
        ['프로세스 표준 출력이 애플리케이션 로그에 기록돼 파일 이름이 노출된다', '로그 노출은 후속 정보 문제이며 명령 grammar 제어의 핵심 전제가 아닙니다.'],
        ['worker가 별도 계정이어서 운영체제 스케줄러 우선순위가 웹 서버와 달라진다', '프로세스 우선순위 차이는 shell parser의 입력 신뢰와 관계없습니다.'],
        ['명령 실행 시간이 길어 reverse proxy timeout보다 늦게 응답한다', '시간 제한은 가용성 현상이며 비신뢰 command grammar 형성을 막지 않습니다.'],
      ],
      takeaway: 'shell interpreter를 제거하고 실행 파일·인자를 구조화해 검증하며 worker 권한과 비밀 접근도 축소합니다.',
    },
  },
  {
    id: 'red-lateral-credential-reuse', securityCircuitId: 'RED', category: 'IDENTITY',
    topic: '재사용 자격 증명과 수평 이동', stages: ['PIT', 'SPRINT'], references: [REFS.MITRE_T1550],
    BEGINNER: {
      question: '한 PC에서 탈취된 관리 자격 증명이 여러 서버에서 그대로 통한다면 어떤 공격 경로가 열린 것인가?',
      evidence: [['호스트 A', '로컬 관리 계정 자격 증명이 노출'], ['호스트 B/C', '같은 계정·동일 인증 재료를 원격 관리에 허용']],
      correct: ['한 호스트의 인증 재료를 재사용해 다른 호스트의 관리 세션으로 이동할 수 있다', '정답입니다. 여러 자산이 같은 인증 재료를 신뢰하면 한 번의 노출이 수평 이동으로 확장됩니다.'],
      distractors: [
        ['같은 사용자 이름을 쓰면 각 서버의 비밀번호가 달라도 자동으로 로그인된다', '사용자 이름만으로 인증되지 않으며 증거는 인증 재료 자체의 재사용입니다.'],
        ['서버 이름이 비슷하면 DNS가 항상 같은 IP 주소를 반환해 접속이 합쳐진다', '이름 유사성과 자격 증명 신뢰 경계는 다른 문제입니다.'],
        ['관리 포트가 열려 있으면 자격 증명 없이도 운영체제가 원격 명령을 허용한다', '열린 포트는 도달성일 뿐 인증 우회를 자동으로 의미하지 않습니다.'],
      ],
      takeaway: '호스트별 관리 자격 증명을 분리·회전하고 원격 관리 권한과 네트워크 도달성을 함께 제한합니다.',
    },
    ADVANCED: {
      question: '초기 호스트 침해가 여러 서버의 관리 권한으로 확장되는 credential trust 경로는?',
      evidence: [['source', 'host A exposes reusable admin authentication material'], ['targets', 'hosts B/C accept same material; admin share reachable; device/session binding absent']],
      correct: ['재사용 인증 재료·공통 관리자 신뢰·네트워크 도달성이 결합한다', '정답입니다. 인증 재료 재사용, 대상 신뢰, 도달성이 모두 이어져 lateral movement가 성립합니다.'],
      distractors: [
        ['호스트 A와 B의 시간대가 달라 인증 로그의 시각이 서로 다르게 보인다', '시간대 차이는 조사 단서지만 원격 인증 권한을 만들지는 않습니다.'],
        ['관리 공유의 파일 목록이 커서 원격 세션의 응답 시간이 길어진다', '성능 현상은 인증 재료가 다른 호스트에서 수락되는 이유가 아닙니다.'],
        ['대상 서버가 같은 운영체제 버전이라 취약점 패치 수준도 항상 동일하다', '버전 유사성만으로 credential trust와 원격 principal 승격이 성립하지 않습니다.'],
      ],
      takeaway: '호스트 고유 자격 증명, 기기·세션 결속, 원격 관리 최소 권한과 네트워크 분리로 수평 이동 고리를 끊습니다.',
    },
  },
  {
    id: 'red-ci-artifact-substitution', securityCircuitId: 'RED', category: 'CLOUD_SUPPLY',
    topic: 'CI 산출물 치환 경계', stages: ['SECTOR', 'SPRINT'], references: [REFS.SLSA],
    BEGINNER: {
      question: 'CI에서 검사한 파일과 실제 배포 파일을 태그 이름으로만 연결할 때 생기는 핵심 위험은?',
      evidence: [['CI', '검사 시 artifact digest 기록'], ['배포', 'release-latest 태그를 나중에 다시 조회 · digest 고정 없음']],
      correct: ['검사 뒤 태그가 다른 파일을 가리켜 검증하지 않은 산출물이 배포될 수 있다', '정답입니다. 검증한 digest와 배포한 digest를 동일하게 결속해야 합니다.'],
      distractors: [
        ['CI와 배포가 같은 레지스트리를 쓰면 mutable 태그도 검증된 digest처럼 불변이다', '같은 저장소를 사용해도 태그가 가리키는 digest는 나중에 바뀔 수 있습니다.'],
        ['배포 계정이 읽기 전용이면 어떤 태그를 선택해도 CI 검증 결과가 자동 상속된다', '읽기 권한과 검증한 artifact identity의 결속은 별도 조건입니다.'],
        ['서명 확인이 한 번 성공하면 이후 태그가 가리키는 파일도 같은 서명 대상으로 본다', '서명은 특정 artifact identity에 대한 것이며 태그의 미래 대상을 포괄하지 않습니다.'],
      ],
      takeaway: 'CI가 검증한 digest·provenance를 배포 단계까지 고정하고 mutable tag를 신뢰 경계로 사용하지 않습니다.',
    },
    ADVANCED: {
      question: '서명·provenance 검증을 통과한 빌드와 실제 배포 사이에 artifact substitution이 가능한 경계는?',
      evidence: [['build', 'attestation subject=digest D1; policy pass'], ['deploy', 'manifest references mutable tag; admission resolves D2; D1==D2 check absent']],
      correct: ['승인 subject digest가 deploy/admission identity에 결속되지 않는다', '정답입니다. provenance subject와 실제 admission digest를 같은 불변 identity로 비교해야 합니다.'],
      distractors: [
        ['빌드 로그에 source commit 메시지가 없어 릴리스 설명을 자동 생성하지 못한다', '설명 메타데이터 부족은 D1에서 D2로 치환되는 trust gap을 만들지 않습니다.'],
        ['서명 알고리즘 검증 시간이 길어 배포 파이프라인 timeout이 발생한다', '성능 문제는 승인 subject와 실제 digest 불일치의 원인이 아닙니다.'],
        ['registry가 여러 지역에 복제돼 같은 digest 다운로드 속도가 달라진다', '불변 digest의 지역 복제는 mutable tag 재해석과 구분됩니다.'],
      ],
      takeaway: 'attestation subject digest, registry object와 admission digest를 동일 identity로 강제해 빌드 후 치환을 막습니다.',
    },
  },
  {
    id: 'red-cloud-metadata-pivot', securityCircuitId: 'RED', category: 'CLOUD_SUPPLY',
    topic: '서버 요청에서 클라우드 권한으로의 피벗', stages: ['PIT', 'SPRINT'], references: [REFS.AWS_IMDS],
    BEGINNER: {
      question: '외부 URL을 대신 요청하는 서버가 인스턴스 자격 증명 서비스에도 닿을 수 있을 때 가장 큰 위험은?',
      evidence: [['웹 기능', '사용자가 지정한 목적지로 서버가 요청'], ['클라우드', '서버에서 인스턴스 자격 증명 서비스 도달 가능 · 역할 권한 넓음']],
      correct: ['서버 요청 기능이 임시 자격 증명을 얻어 클라우드 API 권한으로 확장될 수 있다', '정답입니다. 내부 메타데이터 도달성과 과도한 역할 권한이 웹 요청을 클라우드 피벗으로 연결합니다.'],
      distractors: [
        ['목적지를 HTTPS로 제한하면 내부 메타데이터 주소도 외부 서비스처럼 안전해진다', 'scheme 제한만으로 내부 주소 도달성과 metadata 신뢰 경계를 차단할 수 없습니다.'],
        ['역할 이름을 읽기 전용으로 바꾸면 기존 정책이 넓어도 임시 자격 증명은 쓸 수 없다', '표시 이름이 아니라 실제 role policy가 자격 증명의 권한을 결정합니다.'],
        ['메타데이터 응답을 로그에 남기지 않으면 자격 증명 획득 경로도 차단된다', '로깅 여부는 탐지에 영향을 주지만 요청 도달성과 자격 증명 발급을 막지 않습니다.'],
      ],
      takeaway: '서버 측 요청의 내부 목적지를 제한하고 메타데이터 보호와 워크로드 역할 최소 권한을 함께 적용합니다.',
    },
    ADVANCED: {
      question: '서버 측 fetch 결함이 cloud control-plane 영향으로 이어지는 최소 공격 사슬은?',
      evidence: [['network', 'application can reach instance metadata path; egress filtering absent'], ['identity', 'metadata issues workload credentials; role permits sensitive control-plane actions; session telemetry sparse']],
      correct: ['비신뢰 목적지 제어가 metadata credential과 과도한 role policy에 이어진다', '정답입니다. SSRF 도달성, 자격 증명 발급, 역할 권한이 모두 연결돼야 cloud pivot이 완성됩니다.'],
      distractors: [
        ['애플리케이션이 공인 인증서를 사용해 metadata 응답도 같은 인증서로 서명된다', '서비스 TLS 인증서와 metadata credential 발급 경계는 별개입니다.'],
        ['인스턴스 이름이 DNS에 등록돼 공격자가 내부 호스트 이름을 추측할 수 있다', '이름 추측만으로 metadata 도달성과 role credential 획득이 성립하지 않습니다.'],
        ['control-plane API 응답이 JSON이라 애플리케이션 parser와 형식이 호환된다', '응답 형식 호환성은 principal 전환과 권한 상승의 핵심 전제가 아닙니다.'],
      ],
      takeaway: '목적지·egress·metadata token 경계를 제한하고 role policy와 세션 telemetry로 cloud pivot 사슬을 끊습니다.',
    },
  },
]);

export const CIRCUIT_QUESTIONS = Object.freeze(DEFINITIONS.map(makeQuestion));

if (CIRCUIT_QUESTIONS.length !== 24) {
  throw new Error(`circuit question extension must contain exactly 24 concepts; got ${CIRCUIT_QUESTIONS.length}`);
}
if (new Set(CIRCUIT_QUESTIONS.map(({ id }) => id)).size !== CIRCUIT_QUESTIONS.length) {
  throw new Error('duplicate circuit question id');
}
