# Five-minute interaction contract

This document is the product contract for the first booth MVP.

## Visitor funnel

1. The large screen advertises the current incident and a fixed QR.
2. A visitor scans the QR without creating an account.
3. The browser supplies a locally stored random device ID and the server assigns an anonymous callsign, team, role, and round.
4. A visitor joining during the 20-second `JOIN` phase enters the current round. Mid-round entry is not allowed because it would skip evidence and change role context.
5. A later visitor is queued for the next server-anchored five-minute boundary and sees the next-round countdown, queued headcount, and a self-contained three-step practice incident with its own debrief.
6. Player actions are aggregated by role and team.
7. The baseline engine and patch engine are evaluated separately.
8. The result teaches the input, server assumption, broken boundary, and control.

The first cycle starts at `JOIN` when the coordinator process starts. Later boundaries are calculated in exact five-minute intervals from that start time; they are not aligned to wall-clock `:00` or `:05` values. A duplicate tab or refresh using the same device ID must reconnect to the same participant instead of consuming another slot.

## Mobile screens

- `JOIN`: identity and team
- `QUEUED`: next-round status and a non-scoring three-step practice incident
- `EVIDENCE`: role-specific clue
- `TRACE`: trust-boundary choice
- `BUILD`: allowlisted protocol-card selection
- `DUEL`: bypass or patch selection
- `RESULT`: verdict, three-line debrief, optional raw request

The default interaction must not require a software keyboard. Dragging may be added later, but every action must retain a tap-based alternative.

## Result semantics

- `BREACHED`: baseline proof reached and patch regression failed
- `BLOCKED`: baseline proof was not reached and the selected patch passed regression
- `BREACHED_THEN_CONTAINED`: baseline proof reached and the patch later blocked original and variant attacks while preserving normal bootstrap behavior
- `STALEMATE`: neither side completed its technical objective
- `ENGINE_ERROR`: an adjudication service did not return a trustworthy result

Random winner selection is not allowed.

## Public address contract

The participant QR and the text printed below it must use the same server-supplied canonical URL derived from `PUBLIC_BASE_URL`. Client-side `location.origin` is not authoritative because the large screen may be opened through loopback while phones use a LAN or HTTPS address.

## Abuse limitation

The local device ID provides reconnect semantics, not identity proof. The application rate limit and round capacity do not prevent deliberate multi-ID slot exhaustion. A shared event deployment therefore requires a reviewed participant network or ingress-level rate limiting and operator monitoring.
