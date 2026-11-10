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

## Motorsport presentation references

These references affect presentation only; they do not determine whether a security answer is correct. Circuit paths, speed changes, energy effects and race outcomes are locally authored game models and must not be described as real telemetry or an official Formula 1 simulation.

| Game element | Official reference | Bounded use |
| --- | --- | --- |
| Temple Speed Ring | [Formula 1 — Autodromo Nazionale Monza](https://www.formula1.com/en/information/italy-autodromo-nazionale-monza.FiJN1jnQlRLeHqOxIt13m) | Public 5.793 km / 53-lap reference values and the general long-straight, high-speed character inform an original abstract profile. |
| Harbour Street Loop | [Formula 1 — Circuit de Monaco](https://www.formula1.com/en/information/monaco-circuit-de-monaco-monte-carlo.2ZWRtIcSI6ZzVGX1uGRpkJ) and [Formula 1 circuit guide](https://www.formula1.com/en/latest/article/circuit-guide-everything-you-need-to-know-about-the-circuit-de-monaco.vFsmfGHr6RWyLFtxi58wi) | Public 3.337 km / 78-lap reference values and the narrow, precision-oriented street-circuit character inform an original abstract profile. |
| Airfield Flow Circuit | [Formula 1 — 2026 British Grand Prix](https://www.formula1.com/en/racing/2026/great-britain) | Public 5.891 km / 52-lap reference values and the fast, flowing direction-change character inform an original abstract profile. |
| 2026 UI language | [Formula 1 — 2026 regulations terminology update](https://corp.formula1.com/f1-2026-regulations-terminology-update/) and [Formula 1 — 2026 regulations explained](https://www.formula1.com/en/latest/article/f1-2026-regulations-explained-the-key-terms-for-formula-1s-new-for-2026-rules.3T5BU6TC9quGcIpGzoWkY0) | Use Battery/Recharge, Boost Mode, Overtake Mode and Active Aero terminology; do not label the 2026 overtaking feature as DRS. |

The `officialLengthKm` and `officialRaceLaps` fields in the public catalog are reference metadata. The `speedRangeKph`, `speedZones`, two-lap distance, SVG paths and all car positions are design assumptions for this booth game.

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
