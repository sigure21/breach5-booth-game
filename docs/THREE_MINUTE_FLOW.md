# Three-minute interaction contract

This document is the product contract for the dual-scenario booth game. The 180-second schedule is a maximum, not a forced wait: a cohort advances after all required responses are present and the minimum evidence-exposure interval has elapsed.

## Visitor funnel

1. The spectator screen advertises both incident lanes and one fixed participant QR.
2. A visitor scans the QR without creating an account.
3. The lobby requires one scenario and one difficulty before enabling join.
4. The browser supplies a locally stored random device ID. The server assigns an anonymous callsign, cohort, and provisional team role.
5. A visitor joining during the first 15-second `JOIN` window enters the selected scenario in the current global round.
6. A later visitor is assigned to the selected scenario in the next server-anchored round. Mid-round entry is not allowed because it would skip evidence and change team context.
7. At join seal, one participant becomes `FULL_STACK`; two or more participants become balanced RED/BLUE teams.
8. Each technical task is assigned once. No missing team response is replaced by a hidden default.
9. The coordinator translates allowlisted semantic choices into server-owned requests or session payloads and asks the scenario adjudicator for a verdict.
10. The result explains the observed input, broken assumption, trust boundary, negative controls, patch, and normal-path regression.

The first cycle starts at `JOIN` when the coordinator starts. Later enrollment boundaries are calculated in exact 180-second intervals from that epoch and are not aligned to wall-clock minutes. A duplicate tab or refresh using the same active device ID reconnects to the same participant, scenario, and difficulty instead of consuming another slot.

## Lobby contract

The join request has the following bounded shape:

```json
{
  "deviceId": "<32 lowercase hex characters>",
  "scenarioId": "proxy-panic | session-heist",
  "difficulty": "BEGINNER | ADVANCED"
}
```

`scenarioId` and `difficulty` are server-side enums. They are not free-form routing, module, or class names. Once a participant is active, reconnect cannot change these selections.

The lobby must contain no text field. Scenario and difficulty controls, including their confirm action, must remain usable at 360 CSS pixels and have at least 44 CSS-pixel touch targets.

## Difficulty invariants

Both difficulty modes submit the same semantic choice IDs to the same adjudicator.

### BEGINNER / Guided

- shows short annotations on relevant evidence lines;
- explains what each literal or diff changes;
- reports which observed boundary contradicts a failed choice;
- retains the same raw artifacts and final regression requirements.

### ADVANCED / Analyst

- prioritizes raw HTTP, logs, opcodes, traces, and diffs;
- removes answer-oriented annotations;
- reports sanitized engine outcomes with less interpretation;
- does not unlock arbitrary cookie, pickle, path, or command input.

A difficulty parameter must never choose a weaker engine, a different correct answer, or a less complete patch regression.

## Maximum phase budget

| Maximum interval | Phase | Required outcome |
|---:|---|---|
| 0:00–0:15 | `JOIN` | enrollment only |
| 0:15–0:23 | `BRIEF` | incident and objective exposure |
| 0:23–0:48 | `DISCOVER` | trust-boundary hypothesis from evidence |
| 0:48–1:28 | `BUILD` | request/session chain and immediate control |
| 1:28–1:43 | `EXECUTE` | baseline adjudicator verdict |
| 1:43–2:18 | `DUEL` | variant/control and patch selection |
| 2:18–2:43 | `REVERIFY` | attack and normal-path regression |
| 2:43–3:00 | `RESULT` | evidence-backed debrief |

Task phases advance when every assigned response is complete and the minimum exposure interval has passed, or when the phase deadline expires. Engine phases advance after a trustworthy verdict and the minimum result exposure. Missing input remains explicit and produces an incomplete result; it is not randomized.

The UI should group the eight server phases into a smaller participant-facing progression such as `입장 → 분석 → 조립 → 검증 → 결과` while retaining the precise server phase in accessibility text and API state.

## Scenario evidence contract

Every scored conclusion must be derivable from visible evidence before selection. Evidence must be rendered as text, never interpreted as HTML.

### Proxy Panic

At minimum, the participant sees:

- the raw request-target;
- Gateway canonicalization code or trace;
- Gateway allowlist result;
- Worker raw-path data source;
- the shell-backed bootstrap sink;
- a literal blacklist diff and an equivalent shell variant;
- a regression requirement covering original, variant, and normal bootstrap.

The request preview must update from the same server-owned literals used by adjudication. A patch is effective only when original and variant proof attempts fail and the normal bootstrap still runs.

### Session Heist

At minimum, the participant sees:

- a fictional unauthenticated OAuth-start request and `Set-Cookie` shape;
- signed-cookie payload, timestamp, and signature boundaries;
- zlib/Base64URL/TaggedJSON decode evidence;
- static pickle opcode evidence identifying an OAuth-style client secret;
- the hypothesis that this secret also signs Flask sessions;
- the state-to-flow-key lookup contract;
- a bounded timing gadget and signature/state/flow negative controls;
- patch diffs for independent keys, server-side flow state, and data-only schema validation.

The scenario is based on [Simon Koeck's public write-up](https://simonkoeck.com/writeups/google-devsite-flask-session-pickle-rce). The `$90,000` label is the researcher's reported `$75,000 × 1.2` reward, not an independently verified payment claim and not a CVE identifier.

All request previews use `devsite-lab.invalid`. No code may contact a real Google host. The browser cannot supply a cookie or pickle; the internal engine constructs both from allowlisted semantic choices. The only executable pickle is engine-owned and invokes a fixed, bounded local timing probe.

## Mobile interaction contract

The core participant components are:

1. `EvidenceDeck`: source-labelled raw HTTP, log, code, cookie, pickle, timing, or diff artifacts.
2. `TokenBuilder`: bounded choices that update a real request/session trace preview.
3. `PatchLab`: patch diff selection followed by original, variant, and normal regression results.
4. `Result`: outcome, score against possible evidence tasks, incomplete task list, and concise root-cause explanation.

Choosing an option changes only a local pending selection. A separate confirm control submits it. This prevents an exploratory first tap from becoming an irreversible server action.

The document must have no horizontal overflow at 360, 390, or 412 CSS pixels. Wide code artifacts may scroll inside their own code pane. All actions must have a tap alternative; dragging and software-keyboard input are not required.

## Team and solo semantics

### FULL_STACK

When a scenario cohort contains exactly one participant at join seal:

- the participant receives every RED and BLUE task in phase order;
- action records retain each task's technical team ownership;
- the result uses only submitted actions;
- no absent-team fallback is synthesized.

### TEAMS

When a cohort contains two or more participants:

- participants are balanced between RED and BLUE;
- scenario tasks are distributed round-robin within their technical team;
- a task is required once, not once per team member;
- scenario cohorts keep independent actions, progress, engines, and results.

The maximum player count applies across all scenario cohorts in the same ordinal so selecting a different lane cannot bypass capacity.

## Result semantics

- `BREACHED`: the baseline safe proof was reached and the selected patch regression failed.
- `BLOCKED`: the baseline safe proof was not reached and the selected patch passed regression.
- `BREACHED_THEN_CONTAINED`: the baseline safe proof was reached, then the patch blocked original and variant attacks while preserving the normal path.
- `STALEMATE`: neither technical objective was completed.
- `ENGINE_ERROR`: an adjudication service did not return a trustworthy result.

Random winner selection is prohibited. A visually blocked request does not count as containment if the adjudicator failed, the variant remains viable, or the normal path is broken.

## Spectator contract

The spectator page shows both lanes, with beginner/advanced counts, active phase, sanitized progress, current/next enrollment state, and result when available. It must not reveal:

- runtime proof values;
- lab or engine secrets;
- bearer tokens;
- a correct patch before result;
- full forged cookies or executable pickle bytes.

The QR and printed join URL use the same server-supplied canonical value derived from `PUBLIC_BASE_URL`. Client-side `location.origin` is not authoritative because the spectator browser may use loopback while phones use a reviewed LAN or HTTPS address.

## Safety and abuse limitations

The coordinator accepts semantic IDs only. The vulnerable shell and pickle behavior remains internal, unprivileged, network-isolated, and server-owned. These controls are educational containment, not authorization to expose engines directly or to treat them as general-purpose sandboxes.

The local device ID provides reconnect semantics, not identity proof. Application rate limits and global capacity do not prevent deliberate multi-ID slot exhaustion. Shared event deployment requires a reviewed participant network or ingress rate limiting, operator monitoring, and a scoped restart procedure.
