# Business Module Index

- 2026-11-16 MOD-20 egress implementation: readCache.ts, dashboardData.ts, browser.watchVisibleData and Manager/Admin/App/Report integration verified by test-dashboard-egress, related stock/revenue regressions, TypeScript and final build/public-key guard. Local fix verified; hosted release/measurement tracked in SESSION_HANDOFF.md. No production data/schema changes.

Last updated: 2026-09-10. This is the source-backed inventory and remains subject to discovery refinement.

| ID | Module | Primary source evidence | Risk | Status |
|---|---|---|---|---|
| MOD-01 | Authentication, session lifecycle, account activation | `App.tsx`, `LoginPage.tsx`, `LauncherPage.tsx`, Supabase Auth/function | Critical | In progress — BUG-049 production Supabase bundle outage fixed/verified; authorization blockers remain |
| MOD-02 | Authorization, roles, page/branch/data scope | `lib/access.ts`, `App.tsx`, RLS migrations, role QA scripts | Critical | In progress — BUG-003 Critical and BUG-002 High blocked; UI integration blocked |
| MOD-03 | Branch configuration and lifecycle | `lib/branches.ts`, `AdminPage.tsx`, branch migrations | High | In progress — static controls checked; BUG-031 closed; live integration pending |
| MOD-04 | Employee/account administration | `AdminPage.tsx`, `manage-employee`, profile migrations | Critical | In progress — isolated lifecycle passes; BUG-102 deleted-detail blank state fixed locally; signed-in permanent-delete/Edge verification pending |
| MOD-05 | Scheduling and registrations | `AttendancePage.tsx`, schedule migrations | High | In progress — static controls/date guard checked; business/integration pending |
| MOD-06 | Attendance, selfie, geotag, adjustments | `lib/attendance*.ts`, attendance pages/components/migrations | Critical | In progress — open shifts no longer count as late and completed shifts retain the check-in/start/grace calculation locally; selectable photo filters and staff late drill-down pass; signed-in/multi-device physical QA remains pending |
| MOD-07 | Payroll, KPI, commission | `lib/payroll.ts`, `lib/commission.ts`, `PayrollPage.tsx`, `MyPayslipsPage.tsx`, admin/records pages, migrations | High | In progress — Admin batch selection/send plus employee own-payslip notification/read flow passes focused, 24-route authorization, button, TypeScript and production-build checks locally; additive migration and signed-in visual review pending |
| MOD-08 | Shift opening/closing and bag handover | `lib/shiftLedger.ts`, `operationalShiftAssignment.ts`, `ShiftHandoverPage.tsx`, close RPC migrations | Critical | In progress — BUG-100 explicit owner guard and BUG-101 custom/all-day coverage are production verified; two-leader LAN flow passes, signed-in Ca 1/Ca 2 finalization and n8n/device confirmation pending |
| MOD-09 | Sales/POS receipts and staff history | `SalesPage.tsx`, `lib/salesReceipts.ts`, POS migrations | Critical | In progress — BUG-137 mobile menu/bill/history redesign passes focused regressions/build locally; signed-in 360/390px visual QA and deploy pending; BUG-038 DB timezone remains blocked |
| MOD-10 | Inventory movements and stock reports | `InventoryPage.tsx`, focused inventory in `AdminPage.tsx`, `lib/store.ts`, inventory migrations | Critical | In progress — BUG-055/057/060/061 deployed; numeric clarity and period-wide sale-out/handover live; visual/workbook verification pending |
| MOD-11 | Kitchen production/batches | `KitchenPage.tsx`, store/schema/migrations | High | In progress — desired delivery/order-date visibility and classified history filters active; BUG-059 idle ringtone remains deployed pending physical audible verification |
| MOD-12 | Supply requests/orders | `OrdersPage.tsx`, `lib/supplyRequests.ts`, request migrations | High | In progress — receiving/status contracts retained; BUG-105 compact history and BUG-110 six-column mobile report pass regressions; BUG-110 deployed/live-asset verified, signed-in phone visual pending |
| MOD-13 | Daily shift report/finalization/archive | `ReportPage.tsx`, `ReportArchivePage.tsx`, `lib/reportSync.ts`, `lib/reportDeliveryIntent.ts`, report APIs/RPCs | Critical | In progress — exact handover intent and Ca 1 versus Ca 2/day immediate n8n scopes pass locally; `Lưu ảnh` recurrence fixed; real Vũng Tàu receipt and midnight cron pending |
| MOD-14 | Revenue/restaurant/manager dashboards | dashboard pages, `lib/revenue.ts`, `lib/shiftCompetition.ts` | High | In progress — BUG-126/127 Overview receipt history and direct Thi đua route deployed; prior post-snapshot/realtime reconciliation remains green; signed-in live-data pending |
| MOD-15 | Products/master data/soft deletion | `lib/products.ts`, admin/inventory pages, product migrations | High | In progress — BUG-069 fixed locally; cake linkage/tombstone regressions pass; historical movements intact |
| MOD-16 | Control center/audit/reconciliation | `ControlCenterPage.tsx`, control-center migration | High | In progress — static destructive/sync controls checked; dynamic RBAC enforcement needs business confirmation |
| MOD-17 | Export/report files (CSV/XLSX/PDF/image) | attendance/report/order pages, ExcelJS/jsPDF/html2canvas | Medium | In progress — inventory export has unambiguous numeric formatting plus period-wide handover/sale-out, complete ledger, current stock and count-voucher sheets; actual workbook-open/device verification pending |
| MOD-18 | Reverse geocoding and degraded external-service behavior | `api/reverse-geocode.ts`, attendance flow | Medium | In progress — concurrent detailed-source preference and fallback regressions pass in cloud/LAN; physical HTTPS GPS/address pending |
| MOD-19 | Local demo/LAN synchronization and persistence | `lib/supabase.ts`, `lib/store.ts`, LAN/dev scripts | High | In progress — syntax/data completeness checked; BUG-003 auth blocked; integration pending |
| MOD-20 | Frontend load performance and perceived responsiveness | `App.tsx`, lazy-route recovery, `GlobalLoadingOverlay.tsx`, management/attendance/orders pages, export helpers | High | In progress — BUG-109 section-title and BUG-110 order-table horizontal-text fixes deployed/live-asset verified; 72-file audit passes, signed-in visual verification pending |

## 2026-07-20 status refinement

- MOD-04/MOD-07: employee sales detail now exposes daily revenue chart/table; KPI guide explains existing day-based calculations and uses the shared filters. Local/type/build passed; visual verification pending.
- MOD-10: manual sale-out remains confirmable; the corrected local fix defaults sub-kilogram entries to grams and marks unsellable packing residue without changing physical quantity. Menu SKUs are visibly separated. BUG-091 RPC migration-order drift is blocked pending direct schema approval.
- MOD-12/MOD-17: Admin purchasing is read-only and exports filtered Excel. Workbook-open verification pending.
- MOD-06/MOD-18: reverse-geocode providers now race within a client timeout longer than each provider bound; handler/source regressions pass, while physical HTTPS GPS remains pending.
- MOD-20: scoped overflow hardening, mobile-header logo removal and competition-table tablet/card treatment passed source/type regressions; Browser is unavailable for visual verification.

Priority rationale: MOD-02 is first because authorization failures can expose or mutate cross-role/cross-branch business data and invalidate every downstream module test.

- 2026-09-12 MOD-07: Added authorized Admin revoke/delete detail actions and employee reconciliation. Automated adapter and payroll/KPI regressions pass; 144 route/role checks pass. Signed-in database revoke/delete and visual QA remain pending; see test-cases/MOD-07-payslip-revoke-delete.md.

- 2026-09-12 MOD-07 extension: employee confirms own current published slip using separate timestamp/RPC. Adapter and UI/security contracts pass; full build pending. New confirmation migration unapplied; isolated database/phone confirmation QA pending.

- 2026-09-12 MOD-21 Messaging: new MessagesPage/lib/messages and standalone admin_employee_messages SQL implement Admin↔employee, Admin broadcast, participant-only SELECT and narrow send/read/history RPCs. Adapter + actual isolated PostgreSQL security/history tests and reachable-button audit pass. Production migration, release and signed-in desktop/mobile/realtime QA pending; see test-cases/MOD-21-messaging.md.


## 2026-09-12 - Supabase egress review only

- Source inventory completed; see SUPABASE_EGRESS_REVIEW_2026-09-12.md. User requested review before changes; no app/SQL/config/deploy edits.
- Source-confirmed excess refresh: Admin per-event whole-section, Report per-event whole-ledger, Today new sessions array triggers full snapshot history. Attendance branches/employees reads fan out. No fixed 2-3-second cloud timer or proven infinite effect loop found.
- Static review only; no runtime egress/regression/production tests claimed. Preserve full stock/revenue/payroll inputs.
- Next: user reviews diff fragments, then implement approved minimal changes and run targeted regression/request-count and byte measurements in isolation.

## 2026-09-12 - Egress regression evidence
- Actual behavior harness SUPABASE_EGRESS_REFRESH_OK passed after handling absent/partial payloads safely. Report complete snapshots and operation-day payloads now update local state without follow-up reads; joined/DELETE/partial ledger events debounce400ms.
- attendance-realtime-next-day produced identical nine failures on HEAD baseline; unrelated existing failure, not introduced. Legacy realtime-reminders requires literal8000 polling contrary to new authorized behavior; old test preserved and conflict documented in test-cases/MOD-20-supabase-egress-refresh.md.
- No production bytes/UI/multi-device claim. Build in progress. Next final build and diff-check, then deliver savings estimates and limitations.


## 2026-09-12 - Egress fixes final local handoff
- All six authorized changes implemented. Final SUPABASE_EGRESS_REFRESH_OK and diff-check pass; TypeScript and elevated full production build pass (733 modules; PRODUCTION_SUPABASE_BUNDLE_OK index-AqLpUzXF.js). Six relevant existing regressions pass. Legacy continuous-polling contract conflicts with explicit request; attendance-next-day nine failures are identical against HEAD baseline. No test expectations overwritten.
- Changed application files: TodayPage, KitchenPage, AdminPage, ReportPage, AttendancePage, SalesPage, lib/attendance, lib/supplyRequests. Added isolated behavior regression and MOD-20-supabase-egress-refresh.md case/estimate record; tracking updated throughout.
- Expected savings are per-flow request/row estimates, not measured production egress. Kitchen history still loads permitted full scope only while opened (and realtime updates while open); LAN server contract unchanged and active filtering local. No Supabase/schema/deploy/data write occurred.
- Next exact action: authorized frontend release, then signed-in two-device validation and request/byte before-after measurement including socket disconnect/rejoin, history close/open, scope changes, and stock/POS/report/attendance reliability. Existing separate timers outside the six requested targets remain for a later reviewed batch.
