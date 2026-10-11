# Implementation and acceptance matrix

อ้างอิง Notion HRM System Design Version 3. รุ่นนี้เป็นระบบ runnable พร้อมฐานข้อมูลและ automated tests สำหรับตรวจรับ **ยังไม่ครบทุกข้อของ Version 3 และยังไม่ผ่าน production acceptance ทั้งหมด**. รายการที่ยังไม่ครบระบุไว้ท้ายเอกสาร ไม่ถือว่าตารางที่มีอยู่แล้วหมายถึง feature ถูก implement แล้ว.

| Spec | Implementation | Validation |
|---|---|---|
| Multi-company / Tenant | Tenant login, explicit company access, scope on employee objects, switch company, default/pinned preferences, consolidated API | Cross-tenant/company tampering, own record, manager scope tests; browser switch clears data |
| Authentication | Argon2id, session hash, expiry, revoke, logout, lockout, origin checks | Login, hash storage, denied unauthenticated/cross-origin, wrong old password |
| Employee master | Transaction creates People/Employee/User/access/history; edit, termination validation, archive after termination | Rollback duplicate, encrypted ID, masking, hierarchy cycle, history periods |
| Sensitive fields / files | AES-GCM identity/passport/bank/tax/SS; encrypted attachments, protected downloads | Identity encryption and denied cross-company/other employee file routes |
| Self-service | Own contact form, encrypted profile requests, HR decision; append-only experience | Request/approval permission, experience cannot edit/delete; browser profile |
| Attendance / OT | Clock-in/out, admin reasoned corrections, correction approval, effective schedules, OT approval | Correction reason, worked minutes, approved minute bounds |
| Leave | Policy, annual allocation, periodic accrual API, ledger, holiday/workday/balance/staffing checks, two-step approvals, cancellation reversal | Weekend exclusion, overlap, sequence, no double debit, reversal, staffing |
| Payroll | Four cycle types, integer amounts, effective compensation, versions, idempotent calculation, blocking validation, adjustments, review/approve/paid/close | Reconciliation, immutable old runs, locked cycle, preparer/reviewer/approver separation |
| Payslips | Published after payroll approval, own access, YTD, views, revoke, print/save PDF via browser | Another employee denied; own payslip access; print CSS verified |
| Announcements | Company drafts/scheduled/published, targets via API, revisions, activity aggregated with list | Recipient creator exclusion, view count, no badge read on bell open |
| Notifications | Per-user/company, read only opened source, Bun WebSocket, server scheduler | Real browser WebSocket isolation and forbidden handshake |
| User / role | Invite token, single-use acceptance, suspend/unlock/reset/revoke, effective permissions, role/scope API | Invitation hash/replay, escalation denied, higher admin cannot be suspended |
| Audit / export | Secret redaction, immutable triggers, request ID, before/after JSON, reason/filter/expiry/download history, scoped CSV | Trigger mutation denied; export permission/company checks |
| UI | React/Tailwind, Thai/English shell, dark mode, desktop sidebar, mobile bottom nav/card lists/sheets, hidden mobile search, print profile, 5-digit internal screen IDs hidden in production | All admin pages load; mobile width/navigation; locale/theme; persisted employee |
| Database / operations | 67-table baseline + runtime tables, FK/WAL, migration versions, Docker single server, backup/rollback guide | FK check, backup reopen, integrity/row count, migration idempotence |

## ยังต้องพัฒนาเพื่อให้ครบทุกข้อ Version 3

1. **Advanced leave:** hourly start/end selection and multiple non-overlapping intervals per day; carry-forward expiry policy automation; week calendar. Current FULL/HALF/HOUR amounts are supported but requests reserve the selected calendar dates. Periodic accrual is an explicit audited API job, not automatically scheduled.
2. **Tenant-wide communication:** current UI/API announcement workflow is company-level. Cross-company tenant broadcasts, cover-image editor and multi-file announcement attachment/recipient builder are not yet provided. Employee documents are protected separately.
3. **Company governance / advanced permission UI:** APIs exist for company creation/deactivation, relationships, role/scope assignment, statutory rules, policy allocation/accrual; several still require API calls. The UI has core company catalogs, schedule creation/assignment, leave-policy creation and employee tax profile setup. Hierarchy editor and dedicated custom permission designer remain.
4. **Scheduled employment changes / transfers:** future employment edits are rejected explicitly; transfers can be approved on/after their effective date. Scheduled employment execution, full secondment return workflow and conflict reconciliation need implementation.
5. **Attendance integrations:** DEVICE/MOBILE/IMPORT source fields exist in schema, but production hardware/mobile/import connectors do not. Overnight shifts and non-Bangkok schedule conversions need wider coverage before use.
6. **Payroll production rules:** exact company/legal formulas, benefit/tax deductions, annual reconciliation, non-monthly progressive withholding and bank payment processes require verified configuration and reference fixtures. Non-monthly progressive tax is blocked. No actual transfer is performed. PDF is browser print/save rather than a server-generated signed PDF service.
7. **UI completeness:** most workflow forms are functional, but complex forms need further section/step refinement and complete domain-specific English text. Audit has search + before/after JSON; the full advanced filter and highlighted field-level diff UI remain. Dashboard/consolidated reporting needs branch/department/date drill-down refinements.
8. **Production acceptance:** full role/scope permutation tests, external penetration review, WCAG AA audit, representative payroll reconciliation, volume/performance tests, disaster restore with encrypted file volumes, deployment-provider verification and operational retention/key rotation remain.

## Acceptance boundary

Automated results demonstrate the listed tested flows with synthetic fixtures. They do not certify tax compliance, all permissions permutations, all 67 table workflows, or readiness to pay a real payroll. No deployment to a hosting provider is included in this request.
