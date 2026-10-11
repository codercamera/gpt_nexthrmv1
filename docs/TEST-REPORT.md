# Test report

Date: 2026-10-11

| Check | Result |
|---|---|
| `bun install --frozen-lockfile` | Validated; registry dependencies, no `file:` links |
| `bun run build` | TypeScript strict check + Vite production bundle pass |
| `bun run test` | 57 integration/security/workflow tests pass; 136 assertions |
| Playwright desktop/mobile | 8 tests pass |
| SQLite foreign keys / backup | Enabled, no orphans, VACUUM backup/reopen/integrity/row count pass |

## Integration/security coverage

Authentication, session hashes, company and tenant UUID tampering, employee ownership, manager payroll denial, blocked privilege escalation, same-origin mutations, transaction rollback, AES-GCM storage/masking, employment/compensation history dates, manager cycles, append-only work experience, leave overlap/weekend/minimum staffing, sequential approvals/debit/cancellation reversal, payroll integer reconciliation and historical snapshots, idempotency, blocking attendance/schedule checks, duty separation, payslip ownership, announcement recipient/view counts/creator exclusion, export scope/download audit, protected file access, immutable audit/results, invitations and replay rejection, profile change workflow, attendance correction and overtime bounds, dual employment transfer.

## Browser coverage

1. Desktop login, every admin page, language switch and dark mode
2. Employee creation via form persists after reload
3. Company switch clears previous company records
4. Mobile bottom navigation/cards, hidden search, settings menu, no horizontal page overflow
5. Employee profile and forbidden admin/payroll navigation
6. Print profile contains visible report content
7. Live WebSocket A/B company isolation and denied employee cross-company handshake
8. Login from Vite on port 5173 and its proxied WebSocket connection; regression also verified with the previous `APP_ORIGIN=http://localhost:3000` setting

Origin regression checks cover local Vite (including loopback aliases), request host in development, normalized configured public origin behind a reverse proxy, strict production checks, unexpected ports, malicious lookalike hosts, malformed/null origins and invalid configuration paths. API and WebSocket share this policy; no arbitrary forwarded headers are trusted.

Test data is synthetic; tests use isolated in-memory DB or explicitly seeded demo browser DB. Local Chromium 153 used through `CHROMIUM_EXECUTABLE` because the default Playwright CDN download was unavailable. CI uses Playwright's normal Chromium installation.

See [ACCEPTANCE.md](ACCEPTANCE.md) for unimplemented requirements and production verification limits. These results are not a production/security certification.
