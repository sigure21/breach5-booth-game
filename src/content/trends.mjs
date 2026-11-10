const REVIEWED_AT = '2026-11-10';
const t = (id, eyebrow, title, summary, actions, publisher, sourceTitle, url, publishedAt) => Object.freeze({
  id, eyebrow, title, summary, actions: Object.freeze(actions), scoring: false, reviewedAt: REVIEWED_AT,
  source: Object.freeze({ publisher, title: sourceTitle, url, publishedAt }),
});
export const TRENDS = Object.freeze([
  t('trend-ai-speed-foundations', '2026 SECURITY TREND', 'AI가 공격 속도를 높여도 출발점은 여전히 사람과 자격 증명',
    'Microsoft는 AI가 공격의 속도·규모·자동화를 높인다고 설명하면서도, 관측된 초기 접근에서 사용자 실행과 유효 계정이 계속 핵심이라고 강조합니다.',
    ['피싱 저항성 인증', '브라우저·엔드포인트 보호', '권한과 세션의 지속적 검증'],
    'Microsoft', 'Microsoft Digital Defense Report 2026', 'https://www.microsoft.com/en-us/security/security-insider/threat-landscape/2026-digital-defense-report', '2026-10-01'),
  t('trend-vishing-saas-identity', '2026 SECURITY TREND', '전화 한 통이 SaaS 세션과 OAuth 토큰으로 이어진다',
    'M-Trends 2026은 2025 조사에서 음성 피싱이 두 번째로 많이 관측된 초기 침투 벡터가 되었고, 장기 OAuth 토큰과 세션 쿠키가 연쇄 침해에 악용됐다고 보고했습니다.',
    ['헬프데스크 독립 신원 검증', 'SaaS 연동·토큰 정기 점검', '세션 폐기 훈련'],
    'Google Cloud / Mandiant', 'M-Trends 2026', 'https://cloud.google.com/blog/topics/threat-intelligence/m-trends-2026', '2026-03-24'),
  t('trend-kev-prioritization', 'OPERATIONAL TREND', '패치 경주는 CVSS 숫자 하나로 결정하지 않는다',
    'CISA의 KEV 카탈로그는 실제 악용이 확인된 취약점을 식별합니다. 우선순위는 KEV 여부에 더해 인터넷 노출, 자산 중요도, 영향과 보완 통제를 함께 판단해야 합니다.',
    ['KEV와 자산 목록 연결', '외부 노출 확인', '완화 후 검증'],
    'CISA', 'Known Exploited Vulnerabilities Catalog', 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', 'continuous'),
  t('trend-cyber-dependencies', '2026 SECURITY TREND', '내 시스템만 안전해도 끝이 아니다',
    'ENISA Threat Landscape 2026은 디지털 의존 관계가 공격 표면을 확장한다고 강조합니다. 공급업체, SaaS 연동, 인증 제공자와 빌드 시스템을 같은 위험 지도에 포함해야 합니다.',
    ['외부 의존성 목록화', '연동 권한 최소화', '공급자 장애·침해 대응 훈련'],
    'ENISA', 'ENISA Threat Landscape 2026', 'https://www.enisa.europa.eu/publications/enisa-threat-landscape-2026', '2026'),
  t('trend-owasp-supply-chain', 'APPSEC UPDATE', 'OWASP Top 10에 공급망 전체가 독립 위험으로 올라왔다',
    'OWASP Top 10:2025의 A03은 오래된 라이브러리뿐 아니라 의존성, 빌드 시스템, 배포 인프라와 구성요소 출처 전반의 실패를 Software Supply Chain Failures로 다룹니다.',
    ['직접·전이 의존성 추적', '공식 출처와 서명 확인', 'CI/CD 최소 권한과 변경 통제'],
    'OWASP Foundation', 'A03:2025 Software Supply Chain Failures', 'https://top10.owasp.org/2025/A03_2025-Software_Supply_Chain_Failures/', '2025'),
  t('trend-passkeys', 'AUTH UPDATE', 'OTP가 두 단계여도 피싱 저항성은 별개의 문제',
    'FIDO Alliance는 사용자가 피싱 사이트에 입력할 수 있는 SMS·TOTP 등을 피싱 가능 방식으로, 검증자 이름에 바인딩되는 패스키를 피싱 저항성 방식으로 분류합니다.',
    ['패스키/FIDO2 우선', '복구 절차도 피싱 저항성 점검', '기존 세션 폐기 지원'],
    'FIDO Alliance', 'Passkeys: The Journey to Prevent Phishing, Part 1', 'https://fidoalliance.org/wp-content/uploads/2025/03/Passkeys-The-Journey-to-Prevent-Phishing-Pt1.pdf', '2025-03'),
  t('trend-agent-identity', '2026 EMERGING RISK', 'AI 에이전트에도 고유 신원과 제한된 위임이 필요하다',
    'NIST는 에이전트 IAM 설계 원칙으로 고유 식별, 위임 범위 축소, 최소·제로 상시 권한, 결정론적 접근 결정과 변조 방지 증거 등을 제안했습니다.',
    ['사람 계정 공유 금지', '작업별 짧고 좁은 권한', '에이전트 밖의 변경 불가 감사 로그'],
    'NIST', 'Design Tenets for Agent Identity Management Systems', 'https://www.nist.gov/blogs/cybersecurity-insights/design-tenets-agent-identity-management-systems', '2026-10-27'),
  t('trend-dbir-fundamentals', '2026 INCIDENT DATA', '랜섬웨어·자격 증명·제3자 위험은 따로 움직이지 않는다',
    'Verizon DBIR 2026은 랜섬웨어, 자격 증명 악용, 제3자 공급망과 자동화된 AI 위협을 주요 침해 주제로 다룹니다. 기본 통제를 서로 연결해 보는 관점이 필요합니다.',
    ['계정·패치·백업 통제 연결', '제3자 접근 가시화', '복구 훈련과 탐지 함께 검증'],
    'Verizon', '2026 Data Breach Investigations Report', 'https://www.verizon.com/business/resources/reports/dbir/', '2026-05'),
]);
export const TREND_CARDS = TRENDS;
export const TRENDS_REVIEWED_AT = REVIEWED_AT;
const trendMap = new Map(TRENDS.map((trend) => [trend.id, trend]));
if (trendMap.size !== TRENDS.length) throw new Error('duplicate trend id');
export function getTrend(id) {
  const trend = trendMap.get(id);
  if (!trend) { const error = new Error('invalid trend'); error.code = 'invalid_trend'; throw error; }
  return trend;
}
