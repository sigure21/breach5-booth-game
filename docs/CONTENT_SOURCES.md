# Security content sources

Last reviewed: **2026-11-10**

## Scope and method

The 30 encounters are short educational decisions, not organization-specific
incident-response instructions. Each answer is based on a visible fact in the
scenario and a broadly accepted control: phishing-resistant authentication,
independent verification, server-side authorization, parameterized queries,
context-aware output encoding, allowlisted outbound access, least privilege,
credential rotation, tested recovery, or containment followed by investigation.

The beginner and advanced modes use the same question, choices, correct answer,
and score. Only the amount of annotation around the evidence changes. Trend
cards never affect scoring. Statistics are not used to decide whether a player
answer is correct.

## Baseline guidance for the question bank

| Area | Primary reference | Used for |
|---|---|---|
| Authentication and authenticators | [NIST SP 800-63B-4](https://csrc.nist.gov/pubs/sp/800/63/b/4/final) | passwords, session-aware account recovery, phishing-resistant authenticators |
| Passkeys and phishing resistance | [FIDO Alliance Passkeys](https://fidoalliance.org/passkeys/) and [Passkeys: The Journey to Prevent Phishing, Part 1](https://fidoalliance.org/wp-content/uploads/2025/03/Passkeys-The-Journey-to-Prevent-Phishing-Pt1.pdf) | passkeys versus phishable OTP methods |
| Exploited-vulnerability priority | [CISA Known Exploited Vulnerabilities Catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) | active exploitation as one patch-priority signal |
| Web application controls | [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) | SQL injection, XSS, CSRF, SSRF, object authorization, secrets, deserialization |
| Application-risk framing | [OWASP Top 10:2025](https://top10.owasp.org/2025/) | access control, injection, authentication, supply-chain and integrity failures |
| Secure software lifecycle | [NIST SP 800-218 SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final) | dependency provenance, build controls, and secure development practices |
| Incident response | [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final) | preparation, detection, response, recovery, and post-incident improvement |
| Ransomware response | [CISA #StopRansomware Guide](https://www.cisa.gov/stopransomware/ransomware-guide) | containment, evidence preservation, recovery planning, and tested backups |

The scenarios intentionally omit vendor-specific procedures. In a real event,
the organization's approved playbook, legal obligations, asset context, and
incident commander take precedence.

## Trend cards

| Card | Official source | Source date | Bounded claim used in the game |
|---|---|---:|---|
| AI speed and security fundamentals | [Microsoft Digital Defense Report 2026](https://www.microsoft.com/en-us/security/security-insider/threat-landscape/2026-digital-defense-report) | 2026-10-01 | AI increases attack speed and scale, while user execution and valid accounts remain material initial-access paths. |
| Vishing and SaaS identity | [Google Cloud/Mandiant M-Trends 2026](https://cloud.google.com/blog/topics/threat-intelligence/m-trends-2026) | 2026-03-24 | Voice phishing rose to the second-most observed initial infection vector in the cited investigations; stolen OAuth tokens and session cookies can enable downstream access. |
| Exploited-vulnerability prioritization | [CISA KEV Catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) | continuously updated | KEV records vulnerabilities with evidence of exploitation; operational priority still needs asset and exposure context. |
| Cyber dependencies | [ENISA Threat Landscape 2026](https://www.enisa.europa.eu/publications/enisa-threat-landscape-2026) | 2026-09-22 | Digital dependencies expand the attack surface and need to be considered in resilience planning. |
| Software supply chain | [OWASP Top 10:2025 A03](https://top10.owasp.org/2025/A03_2025-Software_Supply_Chain_Failures/) | 2025 | Supply-chain risk covers dependencies, build/distribution systems, provenance, and change controls, not only outdated packages. |
| Passkeys | [FIDO Alliance phishing-resistance paper](https://fidoalliance.org/wp-content/uploads/2025/03/Passkeys-The-Journey-to-Prevent-Phishing-Pt1.pdf) | 2025-03 | SMS and TOTP can be relayed by phishing; passkeys use verifier name binding and are classified as phishing-resistant. |
| Agent identity | [NIST, Design Tenets for Agent Identity Management Systems](https://www.nist.gov/blogs/cybersecurity-insights/design-tenets-agent-identity-management-systems) | 2026-10-27 | Agents need distinct identity, bounded delegation, least privilege, deterministic access decisions, and tamper-resistant evidence. |
| Incident data | [Verizon 2026 DBIR](https://www.verizon.com/business/resources/reports/dbir/) | 2026-05 | The report tracks vulnerability exploitation, ransomware, credentials, third parties, and AI-assisted activity as connected defensive concerns. |

## Review rule

Before an event release, an operator should open every trend-card URL, confirm
that the title and claim still match the primary source, update `reviewedAt` in
`src/content/trends.mjs`, and run `npm run check`. If a report moves or a claim
cannot be verified, remove or replace the card rather than preserving a stale
statistic.
