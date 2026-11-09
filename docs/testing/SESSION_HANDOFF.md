# Session Handoff

## 2026-10-09 — Production employee payslip RLS verified
- User applied the supplied SQL restoring employee SELECT for `employee_id = auth.uid()` and `published_at is not null`.
- Read-only verification signed in as Đình Phát and returned the exact September payslip with populated net salary; auth/profile/payroll IDs match. The production RLS blocker is resolved.
- Separate local notification-history UI changes remain unpushed/undeployed and still require release for viewed notifications to remain visible in the bell dropdown.

## 2026-10-09 — Payslip notification retention
- Active fix: viewed payslip notifications remain in the bell dropdown; unread count still drives the badge.
- Ordering is unread first, then newest publication timestamp. Rows show `Chưa xem` or `Đã xem`; clicking either opens the selected payslip period.
- Changed application files: `src/components/AppShell.tsx`, `src/lib/payroll.ts`, `src/styles.css`; notification contract updated.
- Focused payroll regressions, TypeScript and the full 733-module production build/bundle guard pass (`index-BZ0axhOE.js`). Next exact action: diff check, then signed-in visual verification and authorized push/deploy.

## 2026-10-09 — Production payslip period correction complete
- User reported the newly entered September payroll was mistakenly saved under October. Audit identified 38 published rows sharing the same update timestamp in `2026-10`.
- One target conflict existed for Trần Minh Lý; user identified it as a test row and authorized overwrite. That exact test row was deleted and all 38 audited source IDs were moved to `2026-09`.
- Verification result: `MOVED_PAYROLL_PERIOD_OK 38 2026-10 -> 2026-09`; ID-scoped counts were October 0 and September 38. No deploy/schema/formula/code behavior change was involved.

## 2026-10-09 — MOD-07 Admin payslip editing
- Active request: Admin must be able to enter and edit payslip values.
- Root cause/fix: removed `readOnly` from system-prefilled payslip inputs and changed overtime/KPI save mapping to use the Admin draft. Source values remain initial suggestions with an explicit editable label.
- Changed files: `src/pages/PayrollPage.tsx`, `scripts/test-admin-payslip-editable.mjs`, and testing trackers.
- Last verification: focused editable test, Admin contract, delivery/notification, revoke/delete/confirmation/viewed tests, `tsc --noEmit` and the full 733-module production build/bundle guard passed (`PayrollPage-Cew5bi88.js`; `index-CK96Q1jK.js`).
- Next exact action: verify signed-in Admin edit/save/reopen visually when a browser session is available, then release only under deployment authorization. No deployment or database write authorized/performed.

## 2026-09-10 — BUG-141/142 local handoff

- Active modules: MOD-06 attendance and MOD-07 KPI/commission.
- Completed locally: `Xem công` shows the signed-in staff/shift leader's monthly `Thưởng KPI`, using the same day + week composition as the management column and filtering every source back to the current account. Open shifts no longer contribute to `Đi trễ`; the existing late calculation runs after check-out.
- Passed: `node scripts/test-my-timesheet-kpi-and-late.mjs`, KPI clarity, attendance duration, TypeScript, diff check and the 728-module production build (`MyTimesheetPage-DLlQ-syf.js`; bundle guard `index-DuCRtBTK.js` + `revenue-8F_j3M4k.js`).
- Changed: `src/lib/attendance.ts`, `src/lib/commission.ts`, `src/pages/MyTimesheetPage.tsx`, `src/styles.css`, `scripts/test-my-timesheet-kpi-and-late.mjs`, and testing trackers.
- Remaining: signed-in phone verification and deployment only if explicitly requested. No migration/schema/API-contract/production-data action occurred.

## 2026-09-08 — BUG-140 local handoff

- Production evidence: Trần Minh Lý at Gold Coast has an open attendance for the approved 07:00–14:30 registration (check-in 09:44), but retry reports the schedule is unapproved/not the next operational shift.
- Confirmed source mismatch: authenticated profile role is Ca trưởng, while operational assignment trusts the registration's older employment snapshot; employee editing updates profile/schedule directory but not an existing registration snapshot.
- Fix normalizes only the authenticated `shift_leader` registration during auto-open/reclaim; current Ca phó title still blocks primary ownership and no persisted record is rewritten.
- All focused regressions, TypeScript, diff check and production build Passed. Changed source: `operationalShiftAssignment.ts`, `shiftAutoOpen.ts`; added focused test and updated two source-contract regressions.
- Deployed: commit `76c3e5b`; live Vercel bundle matches local production build (`index-DakAhWGH.js`, `TodayPage-PCnDfdBW.js`). Remaining: on the existing checked-in phone session reload once for the new bundle, then press `Thử mở ca lại`. Do not check in/out again. No production data or migration was changed.

## 2026-09-08 — BUG-139 local handoff

- Active module: MOD-08 operational shift opening / Today dashboard.
- User evidence: Gold Coast Nha Trang, Trần Minh Lý, 08/09/2026 11:30 remained at `Chờ mở ca` and `0/6 bước` after an action.
- Root cause: Today polled missing sessions but did not rerun the operation that creates one; App's 60-second reconciler swallowed failures. Realtime being disabled can delay UI events but does not explain a permanently missing session.
- Fix: Today reconciles immediately on entry, reads back sessions, displays precise eligibility/error feedback and offers `Thử mở ca lại`; all current business gates remain intact.
- Passed: new recovery test, handover recovery, auto-second-shift test, TypeScript, diff check, and 728-module production build (`TodayPage-vBr-cZBa.js`; bundle guard green).
- Changed: `src/pages/TodayPage.tsx`, `scripts/test-today-shift-open-recovery.mjs`, and testing trackers.
- Remaining: not pushed/deployed. Next action is an explicitly authorized push/deploy followed by signed-in phone verification with Realtime disabled. No production data was mutated.

## 2026-09-08 — BUG-138 local handoff

- Cloud follow-up completed: local function existed; CLI login was valid; stale project link was changed to `ppglstwhnzdgnowhdomm`; `manage-employee` deployed successfully and is `ACTIVE` version 1 with `verify_jwt=true`. Live preflight returned 200 and unauthenticated POST returned the expected 401 with CORS. The user chose to perform the signed-in UI action personally. No SQL/migration/data write was run by Codex.
- Active module: MOD-04 Admin employee/account management.
- Completed: non-Response Supabase Functions contexts no longer receive an unconditional `.clone()` call; HTTP status/JSON handling remains, and employee profile/CRM saves clear stale banners.
- Passed: new error-context regression, account-orphan regression, safe-branch-remove regression, TypeScript, diff check, and 728-module production build (`index-CXoRf18a.js`; bundle guard green).
- Test infrastructure: legacy Admin CRM directory script imports absent `src/lib/payroll.ts`; preserve this unrelated worktree condition.
- Changed files: `src/lib/functionsError.ts`, `src/lib/attendance.ts`, `src/lib/branches.ts`, `src/pages/AdminPage.tsx`, `scripts/test-functions-error-context.mjs`, and testing trackers.
- Remaining: frontend defensive parser deployment (only if requested) and the user's signed-in runtime/SQL confirmation. No schema/API/business-rule change or production data write occurred.
- Next action: user retries the employee profile/status save, checks Console for CORS errors, then runs the requested read-only `employment_status` SQL query.

## 2026-08-27 — POS currency label normalized locally

- All `formatMoney` output now uses `33.000 đ` rather than `33.000d`, across menu, cart, totals, history, messages and printable receipt. Numeric values and sales logic are unchanged. Mobile POS regression/TypeScript/diff/build Passed; asset `SalesPage-D2RLDOGk.js`, bundle guard green. Not deployed.

## 2026-08-27 — POS product display names capitalized locally

- `shortProductName` capitalizes the first displayed character with Vietnamese locale across menu, current bill, action labels and receipt details. Stored catalog/receipt names, search, grouping, sorting and checkout logic are unchanged. Mobile POS regression/TypeScript/diff/build Passed; asset `SalesPage-DITwA_n-.js`, bundle guard green. Not deployed.

## 2026-08-27 — Selectable attendance photo filters added locally

- Employee check-in/out now offers `Tự nhiên`, `Mịn da`, `Sáng`, `Ấm`, and `Tươi`, defaulting to `Mịn da`. An in-app selfie camera defaults to the front lens and shows the selected filter live; native camera remains available for HTTP/192.168, denied permission and device failures. The selected preset is passed into `stampAttendancePhoto`; “baby skin” smoothing now uses a `0.2` downscale/upscale overlay at `0.34` opacity so Safari/iPhone does not depend on canvas blur support.
- Canvas alpha/filter reset before the evidence overlay; face geometry and timestamp/GPS/upload/outbox behavior are unchanged. Selectable-filter/front+native-camera/idempotency/outbox/TypeScript/diff/build Passed. Latest assets: `AttendancePage-DpHb_yf2.js`, `index-NBTzGi1f.css`, bundle guard `index-mvhMW5P-.js` + `revenue-C__TVl8Q.js`. Not deployed.

## 2026-08-27 — Self-service avatar removed

- Owner reversed the self-service avatar request. Removed the account-menu entry, image processing helper, narrow RPC migration, related CSS and focused test; restored the original static desktop account header and mobile language/logout menu.
- Existing Admin-managed employee avatars remain intact. TypeScript/load/build Passed; latest main asset `index-51oz6Wja.js`, CSS `index-BljT9b9r.css`, bundle guard green. Nothing deployed.

## 2026-08-26 — Completed attendance duration added locally

- `AttendancePage.tsx` completed-shift rows now append `Đã làm {formatWorkDurationBetween(checkIn, checkOut)}` after actual in/out times. This is display-only and reuses the existing cross-midnight-safe duration helper.
- Duration/search, schedule sync, late-checkout, TypeScript and build Passed. Asset: `AttendancePage-Ll2Nz0uG.js`; bundle guard `index-51oz6Wja.js` + `revenue-DseUdpdv.js`. Not deployed.

## 2026-08-26 — MyTimesheet late detail added locally

- `MyTimesheetPage.tsx` now lets staff click the monthly `Đi trễ` KPI to expand read-only rows containing work date, scheduled shift, actual check-in and existing `lateMinutes`; zero disables the drill-down.
- No attendance calculation or persistence changed. Added `scripts/test-my-timesheet-late-details.mjs`; focused attendance regressions, TypeScript and build Passed. Assets: `MyTimesheetPage-D6Zhaa_G.js`, `index-BljT9b9r.css`, bundle guard `index-C2TF6PgQ.js` + `revenue-C9p3SREv.js`. Not deployed.

## 2026-08-26 — BUG-137 fixed locally: POS mobile ba màn

- Active module: MOD-09 Sales/POS. User-provided mockup defines three in-app surfaces only; surrounding callouts are documentation, not UI content.
- Changed `SalesPage.tsx`: mobile view state (`menu/bill/history`), real product search/family filter, real receipt search, fixed cart CTA, mobile view header, customer card and direct line removal. Product cards are intentionally text-only (name + price); whole-card tap adds exactly one. No glyph/image, quick quantity buttons or unlimited-sale copy remains. Existing checkout/delete/seller/date behavior is reused.
- Changed `styles.css`: ≤640px view switching, touch-sized controls, two-column menu, fixed one-hand cart bar, focused bill editor, history cards and receipt bottom sheet. Desktop declarations remain active outside the media query.
- Added `scripts/test-sales-mobile-three-view.mjs`. Focused POS/cashier/load/stock tests and TypeScript Passed. Final build Passed 727 modules with `SalesPage-D9gmPuu5.js`, `index-myx9pIAJ.css` and `PRODUCTION_SUPABASE_BUNDLE_OK (index-DwPqCKyr.js; revenue-BTFfGPE7.js)`.
- Unrelated baseline: `test-core-business-button-guards.mjs` reports four existing failures in Inventory/Admin payroll guards; no implicated file was changed. Browser skill bootstrap failed because the environment could not create kernel assets, so no signed-in phone screenshot claim. No deploy, schema, API, Supabase row or production-data change occurred.
- Exact next action: when Browser is available, verify menu → bill → history at 360/390px with a signed-in staff account, including search, repeated whole-card taps (+1 each), line removal, back navigation and receipt detail. Deploy only after explicit release request.
- Responsive follow-up: final EOF guard now wins older `.pos-workspace` rules, forces one product column, removes the duplicate shell header only on phone POS, constrains panels/controls to viewport, respects safe-area insets and compacts ≤380px. The POS hamburger programmatically invokes the existing AppShell menu toggle. Regression/build Passed; latest assets are `SalesPage-BtXxWqiM.js`, `index-8LsDzhsh.css`, bundle guard `index-ynRRFmUC.js` + `revenue-DUP2u7Vq.js`.
- Bill row follow-up: fixed the screenshot-evidenced empty left column by overriding the generic direct-span grid rule for `.bill-line-index`; mobile bill rows now have only index, text, quantity, total and remove cells, with no image slot and no forced list height. Latest build: `SalesPage-CcJOaZkh.js`, `index-BIEAC-Dc.css`, bundle guard `index-DN26rQrH.js` + `revenue-IVeYuWaB.js`.
- Duplicate stats follow-up: global mobile `display:grid !important` had resurrected desktop topbar/KPIs above the mobile copies. Final POS guard now hides the direct desktop topbar/summary in menu, bill and history, leaving one mobile set. Latest build: `SalesPage-DE0KIe-U.js`, `index-CD8OxaZw.css`, bundle guard `index-DY-PGznq.js` + `revenue-Bk0bptY3.js`.
- Hamburger follow-up: local POS click now stops propagation before invoking the existing hidden AppShell toggle, preventing the shell click-away handler from immediately closing the drawer. Latest build: `SalesPage-Q4rJ3jb1.js`, bundle guard `index-CnRv4uvQ.js` + `revenue-Dzd9wZQd.js`.

## 2026-08-25 — BUG-136 fixed locally: bổ sung công chọn ca, giờ thực tế độc lập

- Active module: MOD-06 Attendance/Admin. User reports deleting and restoring one employee-day causes scheduled shift hours to become check-in/check-out hours.
- Root cause confirmed in source: the supplement form/RPC reused one time pair for both registration lookup/creation and attendance timestamps.
- Changed: `AttendanceAdjustmentArchive` loads the employee's registrations for the selected date and offers either an existing shift or `Tự nhập ca bổ sung`; an empty list automatically selects manual mode and reveals separate scheduled start/end fields. Actual check-in/out remain separate and empty. The RPC leaves selected registrations untouched and creates an approved supplemental registration only in explicit manual mode.
- Tests: `ATTENDANCE_SUPPLEMENT_REGISTERED_SHIFT_OK`, `ADMIN_ATTENDANCE_24H_NOTES_OK`, `npx.cmd tsc --noEmit`, and final production build 727 modules with `PRODUCTION_SUPABASE_BUNDLE_OK (index-MzDDWSPE.js; revenue-DwSHGGED.js)` all Passed. Initial build failed only because sandbox denied Vite config access; approved identical retry Passed.
- Changed files in this batch: `src/components/AttendanceAdjustmentArchive.tsx`, `src/components/Time24Field.tsx`, `src/lib/attendance.ts`, `supabase/migrations/20260825_attendance_supplement_uses_registered_shift.sql`, `scripts/test-attendance-supplement-registered-shift.mjs`, and testing trackers.
- Production RPC migration is now applied through linked `db query` only; `db push` was deliberately avoided because local eight-digit and remote fourteen-digit histories remain mismatched. Before: one legacy 6-argument signature. After: one 9-argument signature with `security_definer`, authenticated execute, existing/manual branches and actual-time separation all verified true. No business RPC call, attendance/registration row mutation, or frontend deploy occurred. Exact next action: refresh/retry the already-open Admin form; if the UI bundle is the pictured version, the prior missing-RPC error should be gone.

## 2026-08-05 — BUG-134 + BUG-135 deployed: kho hiển thị đồng bộ + sổ kho cân sau khi sửa tồn

- Chủ quán báo "dữ liệu kho không đồng bộ sau khi tôi chỉnh sửa". Không phải lỗi đồng bộ: mọi màn dùng chung một mảng `movements` và chung `calculateStock`. Bản vá BUG-133 sáng cùng ngày chỉ đổi bộ hiển thị của riêng `InventoryPage` nên cùng một tồn 5,123 kg đọc ra 4 kiểu (`5.123` dấu chấm ở màn Kho, `5,123` ở Quản trị, `5,12` ở Báo cáo/Bàn giao, `5,1` ở Nhà hàng). BUG-134: gom về một bộ hiển thị dùng chung trong `lib/inventoryEntry.ts` (`formatQuantity` chuẩn vi-VN 3 số lẻ) + tách `quantityInputValue` cho ô nhập.
- BUG-135 (4 lỗi tìm ra khi truy vết, chủ quán yêu cầu xử hết): (1) `count` không thuộc cột Nhập lẫn Xuất ⇒ thêm `stockAdjustmentDeltas`/`sumStockAdjustments` (`store.ts`) và cột Điều chỉnh ở sổ kho theo kỳ + Excel; (2) đối soát ca đổi sang `opening + additions + adjust − closing − waste`, loại phiếu kiểm đếm cuối ca khỏi `adjust`; (3) bỏ dấu thời gian phía máy cho phiếu `count` cuối ca (máy lệch giờ làm mốc reset sai chỗ); (4) `calculateStock` đổi `<`/`>` thành `<=` để dòng trùng đúng micro-giây với mốc kiểm kê không bị bỏ khỏi bảng tồn.
- Kiểm chứng: 2 test mới (`test-inventory-display-consistency`, `test-stock-adjustment-consistency`, cả hai đã chứng minh đỏ với bản cũ) + 7 hồi quy kho/báo cáo/bàn giao Passed; `tsc -b` + build 723 modules + `PRODUCTION_SUPABASE_BUNDLE_OK`. `test-owner-ux-inventory-admin-20260720` đỏ sẵn từ đợt BUG-133 (còn đòi nhóm "Món trong menu bán" đã bị bỏ) — đã sửa assert theo hiện trạng.
- Deploy `dpl_ARZoTemEtDAhnRwJrsirL3SkQnWM` READY/aliased. Live main `index-DtrbyXjx.js` TRÙNG HỆT hash build tại máy (⇒ env production khớp `.env.local`), bundle trỏ Supabase thật (không rơi về LAN), `sd=3` (số lẻ dùng chung) có trong bundle, 4 marker giao diện đều có mặt (`Sửa tồn trong kỳ`, `Điều chỉnh kiểm kê`, `Sửa tồn trong ca`, `Sửa tồn trong ngày`), index + `/api/server-time` trả 200.
- Audit SELECT-only trước/sau deploy: không bảng nào giảm. profiles 41→41, chấm công 808→808, đăng ký ca 926→926, báo cáo kho 11→11, phiên ca 184→184, snapshot 93→93; hóa đơn 3794→3797, dòng hóa đơn 4051→4054, phiếu kho 6641→6646 (bán hàng thật trong lúc deploy). Không migration, không ghi/xóa dữ liệu, không ép tab đang mở tải lại.
- Lưu ý cho phiên sau: hai biến `VITE_SUPABASE_*` được đánh dấu **Sensitive** trên Vercel nên `vercel pull` chỉ trả `"[SENSITIVE]"` ⇒ **không prebuild tại máy được** (`vercel build` chết ở guard bundle với `TypeError: Invalid URL`). Dùng `npx vercel deploy --prod --yes` để Vercel tự build bằng env thật; đối chiếu hash asset live với hash build tại máy để biết chắc ship đúng bản đã kiểm.
- Còn lại: `qa-handover-cross-shift` (Playwright) cần app đang chạy nên chưa chạy được. Chủ quán mở app, vào Quản trị → Kho xác nhận cột "Sửa tồn trong kỳ" và bảng đối soát ca có cột "Sửa tồn".

## 2026-08-03 — BUG-129 deployed: "Xóa dòng" for empty registrations (resolves BUG-125)

- Owner pointed at a `Vắng / Chưa có bản ghi` row and asked for a delete button there. The old `Xóa ca` action only handles `attendance_records`; the row has only a `shift_registrations` entry, and the FK is `on delete cascade`, so an unguarded registration delete would cascade-delete attendance evidence.
- Shipped: migration `20260803_admin_delete_empty_shift_registration.sql` (Admin-only + active check, `for update` lock, hard block when any attendance record exists, full `control_audit_entries` audit with `to_jsonb(registration)`, deletes exactly one registration); client `deleteEmptyShiftRegistrationByAdmin`; AdminPage `Xóa dòng` + `Xem các ca của nhân viên` on no-record rows with a kind-aware confirm form matched by `registrationId`. Scope decision: applies to any empty registration per the owner's latest request, superseding the supplement-marker-only plan in BUG-125.
- Verification: `ADMIN_ATTENDANCE_DELETE_OK` (pre-written red-first test from previous session) plus 7 more attendance/Admin regressions Passed; TypeScript/build 723 modules with `PRODUCTION_SUPABASE_BUNDLE_OK`. Migration applied to production via linked `db query` (function-only); `pg_proc` confirms both delete RPCs with `security definer`.
- Data-safe release: prebuilt gate green (128 files/7 functions/unchanged cron/no forbidden artifact); `dpl_CPCmpEeWLM8E4gRG5ydNVpX8LivH` READY/aliased; live assets serve all three feature markers; SELECT-only audit before/after shows no table decreased (41/636→638/811→813/3547→3550/3800→3803/6209→6215/87/173 — increases are live operations). No forced reload of open tabs.
- Remaining: owner signs in, visually confirms the new button, and personally deletes the specific 01/07/2026 orphan row through the UI if desired — no production business-data delete was performed by the assistant.

## 2026-08-03 — BUG-128 active: Admin correction filters lose context

- Owner reports repeated correction by day/branch is slow because every `Chỉnh công` forces employee mode and clears search context. Source confirms the unconditional state changes; the correction workspace has no independent branch filter, and range changes clear the selected employee.
- Red-first `scripts/test-admin-attendance-filter-context.mjs` now specifies: inline edits preserve the current mode/filter, external error links reveal the exact day/branch, branch filtering is independent in both modes, and employee history is an explicit action. Its required pre-fix run exits 1 at the missing `revealTarget = false` contract and shows the unconditional employee-mode switch.
- Exact next action: run the red test, implement only filter-state/UI changes in `AdminPage.tsx`/CSS, then run focused attendance regressions, TypeScript/build and Browser verification if an in-app session is available. Do not change attendance records/RPCs/payroll formulas/permissions or include BUG-125 schema work.
- Focused implementation now passes `ADMIN_ATTENDANCE_FILTER_CONTEXT_OK`: visible-row edits preserve context; error-table deep links reveal date/branch; a persistent local branch selector works in both modes; changing month retains employee/search; employee-history navigation is explicit. Next: related attendance/UI regressions, TypeScript/build and Browser check if available.
- Final local gate is green: six related regression scripts, TypeScript, 253-button/247-reachable contract, diff check and the 723-module production build/bundle guard Passed. Assets: main `index-Cvwp_dRu.js`, Admin `AdminPage-5oDwtGdj.js`, CSS `index-DMh4vtZt.css`; requested markers are present. `test-admin-attendance-delete` remains the unrelated BUG-125 schema blocker. Browser setup/troubleshooting completed and discovery returned `[]`, so signed-in visual QA remains. No deploy/schema/data action occurred; deploy only on a new explicit request.
- Owner now explicitly requests deploy with strict preservation of data being entered. Prebuild inspection Passed: 128 files/seven expected functions/unchanged midnight cron/zero forbidden artifact, and package scripts have no database hook. SELECT-only predeploy counts are profiles 41, attendance 632, registrations 806, receipts/items 3545/3798, movements 6207, reports 87, sessions 173. Exact next action: deploy the inspected prebuilt output only, verify READY/alias/assets/API, rerun the same SELECT-only audit and require every count to be unchanged or increased by normal concurrent operations. Do not run migration/cron/webhook/seed/restore.
- Production release complete: `dpl_CuLBRp2irftLEya4r2c8jt6Rgj1v` READY/aliased at the main URL. Index/main/Admin/CSS/server-time return 200 and live filter markers match the inspected package. Postdeploy counts exactly equal the predeploy baseline for profiles/attendance/registrations/receipts/items/movements/reports/sessions (41/632/806/3545/3798/6207/87/173). No migration/cron/webhook/data write or forced reload occurred. Remaining only: after finishing any unsaved form, owner refreshes Admin and visually confirms the new correction controls; Browser discovery remains `[]`.

## 2026-08-03 — BUG-127 deployed: competition discoverability and evidence workbook

- Production complete on `dpl_D15LGnaenGLd2qW48hiUcgoFGh1Q`: alias/index/main/Admin/CSS/server-time and all requested markers are green after propagation settled. Remaining only: owner hard-refreshes Admin, opens `Thi đua nhân viên`, exports a real month and visually confirms the three sheets in desktop Excel. No schema/data action occurred.
- Deployment `dpl_D15LGnaenGLd2qW48hiUcgoFGh1Q` is READY/aliased after all local/prebuild gates. The first immediate live read got index 200 but the parsed main asset returned propagation/cache `NOT_FOUND`; do not claim live markers yet. Next exact action: inspect uncached index asset tags, retry exact asset/API URLs, then update BUG-126/127 as deployed if green.
- Owner added this to the pending BUG-126 frontend release. Red-first `test-admin-competition-workbook-clarity.mjs` fails at the missing `Thi đua nhân viên` navigation label. Existing screen is present but inconsistently named and absent from Overview shortcuts.
- Current workbook exposes long technical ID columns and lacks month/day employee separation. Next exact action: rename/direct-link the Admin view, make monthly export rows independent of the currently selected daily display, add authoritative daily KPI rows, rebuild the workbook into three concise sheets with hidden reconciliation keys, then execute real XLSX inspection plus KPI/competition regressions.
- No KPI/revenue formula, database/schema/data or permission change is authorized/needed. Spreadsheet renderer and Browser are unavailable; record those visual limitations and use real workbook parse/build plus source/UI contracts.

## 2026-08-03 — BUG-126 deployed: Overview recent history uses POS bills

- Production complete in the same deployment: live Admin/CSS assets contain the bill-history markers and all reads are 200. Remaining only: signed-in Admin confirms real receipt rows in the selected date/branch range; Browser discovery is unavailable.
- Local fix is green for the new regression, Admin ERP regression, TypeScript and 9/9 related POS/revenue/realtime/pagination/error/role/button/attendance-month checks. `overviewBillRows` is selected-range/branch scoped and newest-first; Dashboard shows the last 30 with complete bill identity/amount. Next exact action: production build/prebuild/deploy and live marker checks.
- Screenshot and source reproduce the issue: Overview `Lịch sử gần đây` renders only inventory-count archive rows, so it can be empty even when POS receipts/revenue exist. Existing Overview data needs/realtime already load `sales_receipts`.
- Red-first `scripts/test-admin-overview-bill-history.mjs` exits 1 at missing scoped bill rows. Next exact action: build `overviewBillRows` from `salesReceipts` using current date/branch filters and descending creation time, pass it to `DashboardPage`, render bill details, then run Admin/POS/revenue/UI regressions, TypeScript/build and deploy under the owner's standing request.
- Browser discovery is `[]`; do not claim signed-in visual verification. BUG-125 remains separately blocked on explicit database approval and must not be included in this frontend change.

## 2026-08-03 — BUG-125 active: mistaken supplement registration survives attendance deletion

- Screenshot/source evidence confirms the row is not stale UI: the authoritative supplemental registration remains by the old delete contract and is rebuilt as absent. Red-first delete regression fails on the missing conditional migration/client/UI action.
- Implement locally only: conditional cleanup for exact Admin-supplement markers, orphan cleanup RPC/button, normal-registration protection/audit, and attendance-only future-date clamping. Run focused/full gates. Applying the production RPC is a schema action and requires explicit owner approval even though frontend redeploy was previously authorized.
- Future-date clamping is locally green (`ADMIN_ATTENDANCE_HISTORY_MONTH_OK`, TypeScript). Migration creation was blocked before any file/schema change due missing direct approval. Await explicit approval for (1) RPC create/apply and optionally (2) deletion of the exact 01/07/2026 Đặng Thị Khánh Linh orphan after read-only identification.

## 2026-08-03 — BUG-124 deployed: historical-month correction + paired supplement times

- Deployment `dpl_5ey5DqMEitLPwswkMFzqL2rKUSHg` is READY/aliased. Live index/Admin/Archive/CSS/server-time checks are green with exact month-navigation and paired-time markers. No schema/data action occurred. Remaining step is only the owner's signed-in hard-refresh/visual confirmation because in-app Browser discovery remains `[]`.
- Local implementation is green 7/7: direct month picker, previous/next navigation, current-month maximum, exact month data range and selected-day synchronization. Next exact action: production build/prebuild/deploy/live markers under the owner's standing request to redeploy after the fix.
- Before deployment, owner added screenshot evidence that Supplement Attendance splits check-in/check-out controls across rows. Red-first 24h regression now fails on the absent paired-time wrapper. The first month-only build is superseded and must not be deployed; group both controls in one desktop row, rerun, then rebuild.
- Paired-time implementation is now green with the month regression, button contract and TypeScript. Exact next action: rebuild the combined month + paired-time source, create/inspect a fresh Vercel prebuild, deploy, and verify both markers live.
- Combined production build is green (723 modules; main `index-BHsywUyW.js`). Next exact action is fresh Vercel prebuild inspection and production redeploy.
- Fresh prebuild inspection is green: 128 files, seven functions, zero forbidden artifacts, exact month-navigation and paired-time markers. Next exact action: deploy prebuilt production and verify live index/Admin/Archive/CSS.
- Production feedback reproduced in source: correction date is bounded by current global `from/to`, and the correction panel has no local month selector. Red-first `test-admin-attendance-history-month.mjs` fails on the missing month input.
- Next exact action: add local previous/month-picker/next controls that set the authoritative `from/to` query range and selected correction date, then run focused attendance/Admin regressions, build, deploy the verified prebuilt package and confirm live markers. Browser discovery is still `[]`; no alternative browser backend may be used.

## 2026-08-03 — BUG-122/123 deployed: attendance reliability/Admin UX/notes + daily KPI Excel

- Deployment `dpl_2FJLJyP4RqkmpxEzGv2vXHchkv6S` is READY/production and aliased to `https://gustino-operations.vercel.app`. Live 200 checks cover index/main/CSS/Admin/Attendance/AdjustmentArchive/server-time; requested markers are present and employee make-up checkout is absent. Auto-close unauthenticated read returns 401. No migration, cron invocation, synthetic attendance or production data write occurred. Remaining external step is a signed-in Admin/employee hard-refresh and physical-device visual check.
- Owner now explicitly requests deploy. Final build/prebuild is green: 723 modules, main `index-W_K4MjaO.js`, 128 prebuilt files, seven expected functions, midnight cron, public Supabase config and all requested markers; forbidden artifact count is zero. Exact next action is `vercel deploy --prebuilt --prod`, then READY/alias/live asset/API verification. No migration or production data write is authorized/needed.
- Final local release gate Passed: 723-module production build and Supabase bundle guard (`index-I-j_zW9M.js`; Attendance `AttendancePage-DXRI7P4s.js`; Admin `AdminPage-BoX8M-qt.js`). The sandbox attempt failed only at Vite temp-file EPERM after TypeScript, and the approved retry passed. No deployment or production/schema/data action followed. Remaining external QA is signed-in/physical-device visual use because Browser discovery is unavailable.
- Cloud load hardening is green: eligible stale records run in bounded concurrency 12, and one failed row no longer aborts later employees. The 201-row/two-page runtime fixture observes 14 attempts, 13 closes, one isolated failure and max concurrency 12; auto-close handler regression and TypeScript also pass.
- KPI/Admin related gates are green across 10 applicable checks (KPI formulas/export, Admin/report/roles/business buttons/UI reachability). Two repository-wide checks remain unrelated baselines and were not edited: obsolete inventory-category expectation versus the current intentional warehouse/POS separation, and a deploy-polish data-URL harness that cannot resolve the new relative `shiftReportScope` import. Continue with TypeScript/build/scoped review; do not change Inventory/shift-report code for BUG-123.
- Broad attendance/load regression is green 22/22 after the final usability fallback that pre-fills missing correction times from the registered schedule (including overnight next-day end). Next exact action: KPI/Admin related regressions, TypeScript/build and scoped diff/syntax review.
- Focused integration is now green 8/8: single-open, retired make-up flow contract, auto-close/Admin errors, Admin 24h/notes, KPI daily Excel, cron handler, LAN integration and TypeScript. The two stale legacy assertions were updated to enforce the owner's new rule; no product behavior was reverted. Next exact action: broad attendance/Admin/KPI regressions, then production build and scoped final review.
- 24-hour/note follow-up is implemented and green: `ADMIN_ATTENDANCE_24H_NOTES_OK`, TypeScript Passed. Components: `Time24Field`/`DateTime24Field`; notes: `attendanceNotes.ts`; Admin loads paginated/realtime adjustment requests and passes them to `buildAttendanceDetailRows`.
- New owner follow-up is active: redesign Admin correction/supplement forms for fast 24-hour entry and join early/late adjustment requests into attendance row/Excel notes with requester + submission datetime. Red-first `test-admin-attendance-24h-notes.mjs` fails on the missing 24-hour component.
- Implementation checkpoint is green: `ATTENDANCE_AUTO_CLOSE_ADMIN_ERRORS_OK` + `KPI_DAILY_EXCEL_OK`. Cloud pagination/idempotent return count, LAN request-time reconciliation, employee read-only overdue copy, Admin unresolved-error list/deep-link and daily KPI workbook are implemented locally.
- Legacy BUG-113 regressions are aligned with the replacement rule and Passed. Do not restore the retired employee make-up UI in later work.
- Direct owner decision supersedes the old BUG-113 employee make-up-checkout flow: no `Check-out bù` or employee `missing_checkout` form; stale open attendance closes after day rollover at scheduled end and remains an Admin correction concern.
- Red-first evidence exists in `scripts/test-attendance-auto-close-admin-errors.mjs` (fails on current visible `Check-out bù`) and `scripts/test-kpi-daily-excel.mjs` (expects the new dedicated workbook/button).
- Existing cloud `api/auto-close-day.ts` is partial: correct midnight Vietnam schedule and scheduled-end/admin-close behavior, but only first 200 rows. LAN still lacks auto-close. Existing daily KPI calculation in `AdminPage` is authoritative and must be reused without formula changes.
- Exact next work: implement cloud pagination + LAN equivalent + machine marker/error helper, remove employee actions, render Admin error list linked to existing correction form, add/verify daily KPI workbook, then run focused attendance/KPI regressions, TypeScript/build and update trackers.
- Safety: no production data/schema/deploy action. Browser remains unavailable (`[]`); preserve the heavily dirty user-owned worktree.

## 2026-08-03 — BUG-122 attendance next-day/realtime fix in progress

- Active module: MOD-06 Attendance. Owner reports repeated Check-in state the day after a completed attempt and requests reliable realtime behavior for many employees.
- Confirmed causes: `AttendancePage` shadows the Vietnam date helper with device-local getters; its Check-in action ignores any other own-open record and pending outbox check-in; `AppShell` reads today only and permits stale overlapping responses; attendance realtime is unfiltered and reloads full datasets for every employee event.
- Pre-fix evidence: `node scripts/test-attendance-realtime-next-day.mjs` → `ATTENDANCE_REALTIME_NEXT_DAY_FAIL` with 26 named contract failures. Ten existing focused attendance tests pass, proving this is a previously uncovered state/realtime gap rather than a broken baseline.
- Worktree already contained user-owned uncommitted attendance/outbox/single-open work before this session. Preserve it; edit only targeted hunks and do not reset. Browser discovery is `[]`, so signed-in visual/multi-device QA is unavailable.
- Safety: no production read/write, migration, deployment or webhook. The current `20260727_attendance_single_open_session.sql` must not be applied as-is; schema audit/change requires direct owner approval.
- Implemented locally: centralized UTC+7 dates; pre-render open/outbox guard; versioned/deadlined reminder; own-user/authorized-branch realtime with burst coalescing; paginated cloud reads keyed to registration work date; write/flush notification; stable retry image path and IndexedDB-memory fallback. New regression, outbox, single-open and TypeScript are green.
- Focused/static attendance batch is now 15/15 green. Two stale assertions in the combined resilience harness were aligned to existing template-literal/concurrent-provider behavior; the specialized reverse-geocode regression remained green.
- Additional performance/regression gate is green: stock/sync, pagination, shift realtime reminders and TypeScript, alongside the new attendance/outbox/single-open checks.
- Production build Passed outside sandbox after the sandbox-only `.vite-temp` EPERM: 719 modules, bundle guard green, Attendance chunk `AttendancePage-Di7NygDA.js`. No deployment followed.
- Independent review found and closed unsafe outbox edges: authoritative IndexedDB state, truthful RAM durability, no age-based evidence deletion, exact-registration `23505` read-back, and terminal `needs-review` for stale/open-session conflicts. Records refresh now fails closed; redundant board/AppShell reads are reduced. Focused outbox/next-day/single-open and TypeScript are green after these changes.
- LAN outbox replay now preserves the validated time the employee pressed Check-in/Check-out instead of replacing it with the later reconnect time. Check-in replay validates the registered UTC+7 date (not a newly invented shift-hour gate); ordinary LAN writes still use server time, future replay timestamps are rejected, and permanent rejections become `needs-review`. `LAN_ATTENDANCE_API_INTEGRATION_OK`, next-day regression and TypeScript pass.
- Final pre-build rerun Passed 19/19 commands: 15 focused attendance regressions, isolated LAN attendance integration, performance/sync, pagination and shift realtime reminders.
- Pre-final-review build Passed with 719 modules; the later LAN selfie idempotency change was followed by the newer final build below.
- Final diff review additionally made LAN selfie retry idempotent: the same outbox operation now overwrites one sanitized stable file instead of creating a new `Date.now()` file.
- Post-selfie-path affected tests Passed: LAN integration, next-day, outbox, intermittent/idempotent/native attendance and TypeScript.
- Intermediate build after the selfie-path correction Passed; the later integrity/load hardening received the newer final build below.
- Independent final review then reproduced additional integrity/load gaps before patching: IndexedDB transaction-abort durability, deletion of orphaned checkout evidence, permanent-op head-of-line blocking, LAN client-field/path trust and unbounded Board-week reads/subscriptions. New regressions are intentionally red with exact evidence.
- Minimal hardening is implemented and the affected batch is green: outbox abort behavior, next-day/integrity/load contract, LAN integration and TypeScript. No role, formula, schedule rule, schema or normal timestamp behavior changed.
- Full post-hardening attendance/load batch Passed 19/19 commands.
- Final post-hardening production build Passed: 719 modules, `PRODUCTION_SUPABASE_BUNDLE_OK (index-NBfg362C.js; revenue-D3COWfrX.js)`, Attendance chunk `AttendancePage-Cs_zPtp1.js`. No deployment followed.
- Final scoped diff/syntax/source-pattern review Passed. BUG-122 is locally complete; no deployment, production query/write or migration occurred.
- Exact next action: physical multi-device QA when Browser/devices are available, then separately obtain explicit approval for production catalog/index audit and deployment. Do not apply the untracked migration as-is because it contains historical data mutation.

## 2026-07-22 — BUG-110 deployed; signed-in phone confirmation next

- Active modules: MOD-12 Orders and MOD-20 responsive text/layout.
- Owner screenshot shows the visible six-column order-report table, not the compact order-history row from BUG-105, collapsing Vietnamese text into character columns.
- Source cause: `.order-report-table` has no phone layout and late global `overflow-wrap:anywhere` applies to every page table cell. BUG-105's selector scopes only `.supply-request-list.compact`.
- Last command/result: `node scripts/test-orders-report-mobile-layout.mjs` exits 1 at missing mobile field label `STT` before implementation. This is expected reproduction evidence, not a test-infrastructure failure.
- Implemented: semantic `data-label` fields plus a ≤720px label/value record layout only for `.order-report-sheet:not(.order-report-sheet-export)`. Cell content uses normal word wrapping and horizontal writing; quantity may wrap. The 1080×1350 export table, order data/status/actions/permissions and business flow are unchanged.
- Last focused result: seven commands Passed — order-report/compact-order/sitewide/section-title/supply-delivery/report-toolbar/handover-overflow. Related 9/9 Passed: UI-button, core guards, owner UX, role/sidebar/deploy/pagination, TypeScript and diff check. Isolated Vercel prebuild Passed with 714 modules and `PRODUCTION_SUPABASE_BUNDLE_OK (index-C-_zOd5P.js; revenue-BmeCb_ZO.js)`; Orders/CSS are `OrdersPage-Dye4rRXr.js` / `index-B0QqMGy2.css`.
- Release isolation: packaged `HEAD` and overlaid only `OrdersPage.tsx`/`styles.css`; hashes prove the user's unrelated modified Report/Handover files were excluded. Inspection found 129 files, seven expected API functions, the unchanged cron and zero forbidden archive/database/env artifact.
- Production: deployment `dpl_6B9dCSaYLtfQSXPQ5L7PT6asvHUu` is READY/aliased to `https://gustino-operations.vercel.app`. Uncached live index/CSS/Orders/API are HTTP 200 and contain every BUG-110 marker including the export exclusion and `STT`/`Người đặt` labels.
- Build environment note: deleted only the untracked generated `tsconfig.app.tsbuildinfo` cache after validating its exact path; the build recreated it. Sandboxed Vite could not write `.vite-temp`, so the same required build succeeded with approved outside-sandbox access.
- Browser setup/troubleshooting was followed; discovery returned `[]`, so signed-in screenshot automation is unavailable. Exact next action: hard-refresh Orders on the affected phone and confirm the report rows display as horizontal label/value cards.

## 2026-07-22 — BUG-109 deployed; signed-in hard-refresh confirmation next

- Active modules: MOD-07 KPI/revenue presentation and MOD-20 responsive shell/text layout.
- Owner evidence: signed-in production Manager sidebar is still navy. Root cause is release drift: shared light-sidebar commit `b595fca` is newer than documented live release `70377fa`. No role/permission change is required.
- Vertical-text root cause/fix: mobile `.section-title` no longer uses squeeze-prone `1fr auto`; it wraps actions below a 180px horizontal title/eyebrow region. Source audit covers 72 `.css/.ts/.tsx` files and rejects vertical writing modes and `break-all`.
- Last tests: focused text/sidebar checks plus Admin ERP, owner UX, KPI/reward/competition, Orders/report overflow and button contract pass. `test-fixed-sidebar-navigation.mjs` and `test-role-specific-admin-manager-ui.mjs` were stale and were corrected to enforce the owner's current shared-light rule. Isolated TypeScript/714-module build passes `PRODUCTION_SUPABASE_BUNDLE_OK`.
- Browser: mandatory connection/troubleshooting was attempted once; `agent.browsers.list()` returned `[]`. Do not substitute another browser backend; signed-in visual verification remains pending.
- Released from isolated `HEAD + BUG-109` only; unrelated modified `ReportPage.tsx`, `ShiftHandoverPage.tsx`, documents and handover helpers were excluded. Prebuilt inspection: 129 files, seven functions, unchanged cron, zero forbidden archive/database/env artifact.
- Production: `dpl_9rCoxcfRbna4Pu3r4hkxJrZp3mAS` READY/aliased. Live index/CSS/server-time are 200; assets are `index-CZbVOwX_.js`, `index-C3TRry9Y.css`, and the live CSS contains the intended shared-light and horizontal-text markers with no Manager-dark override.
- Exact next action: Manager hard-refreshes `https://gustino-operations.vercel.app` once and confirms the sidebar is white plus KPI/Revenue headings wrap horizontally. If contrary evidence remains, attach that fresh screenshot/viewport; do not redeploy the old `70377fa` artifact.

## 2026-07-21 (tiếp) — gỡ blocker deploy của BUG-106: 6/6 QA xanh trên cây làm việc hiện tại

- Không sửa thêm dòng source nào trong lượt này. Chỉ chạy lại kiểm chứng để xác minh hai QA từng hỏng.
- `qa-admin.mjs` → `MANAGEMENT_QA_OK` và `qa-mobile-shift-setup.mjs` → `MOBILE_SHIFT_AUDIT_OK` (9 ảnh audit). Kết luận: hai lỗi ghi ở BUG-106 là trạng thái dev server cũ/HMR hỏng, KHÔNG phải trang dashboard admin hỏng. Ghi chú cũ trong BUG_TRACKER đã được sửa lại.
- Toàn bộ kiểm chứng trên cây làm việc hiện tại: `npx tsc -b` exit 0; `npm run build` pass → `PRODUCTION_SUPABASE_BUNDLE_OK (index-Ce1y8mkT.js; revenue-BIBA5MGD.js)`; QA `ROLE_ACCESS_QA_OK`, `APP_NAVIGATION_QA_OK`, `ATTENDANCE_QA_OK`, `HANDOVER_QA_OK`, `MANAGEMENT_QA_OK`, `MOBILE_SHIFT_AUDIT_OK` — 6/6 pass.
- Chủ quán cho phép phát hành cả lô. Commit `70377fa` (bản vá BUG-106 + BUG-102/103/104/105 + `operationalShiftAssignment.ts`; bỏ theo dõi `.npm-cache/`, thêm nó vào `.vercelignore`). Deployment `dpl_EesrhTX12smQRLsyy1JYSaYC6pnV` READY và đã trỏ alias `https://gustino-operations.vercel.app`.
- Xác minh live: `index-Ce1y8mkT.js` / `index-BKrERcAQ.css` đang phục vụ, `/api/server-time` 200, bundle chứa đủ marker hạn chót chấm công + hướng dẫn quyền GPS riêng Android/iPhone. Không migration, không ghi dữ liệu production, không gọi n8n, không push GitHub.
- Việc kế tiếp chính xác: nhờ cô Cao Bảo Trân check-in lại, và xử lý bản ghi mở treo `775de9ab-e18c-424f-8820-0c191b46166e` bằng chức năng chỉnh công có ghi lý do của Admin, KHÔNG sửa thẳng DB.

## 2026-07-21 — current incident fixes verified locally; device/live confirmation pending

- Active modules: MOD-04 employee deletion, MOD-06/MOD-18 attendance/GPS/address, MOD-08/MOD-13 Vũng Tàu handover/n8n, MOD-14 revenue Dashboard and MOD-12/MOD-20 Orders mobile.
- Last completed case: `MOD20-TC-ORDERS-01`; last focused result: 27/27 related commands Passed. The batch includes `ACCOUNT_ORPHAN_RECOVERY_OK`, `ADMIN_CRM_DIRECTORY_OK`, `AUTO_SECOND_SHIFT_START_OK`, `SHIFT_CLOSE_REPORT_REALTIME_OK`, `HANDOVER_DAILY_REPORT_ACCESS_OK`, report finalization/Zalo/n8n runtime/queue, revenue/sales, attendance reverse-geocode/intermittent/idempotent/native/LAN, management realtime, order delivery/mobile, business guard/KPI and owner UX checks.
- Last command/result: `npx.cmd tsc --noEmit`; `node --check scripts/lan-server.mjs`; `git diff --check`; `npm.cmd run build` → all exit 0. Build transformed 712 modules and ended `PRODUCTION_SUPABASE_BUNDLE_OK (index-jz17XQYv.js; revenue-C18zbwoe.js)`.
- Confirmed/fixed locally: BUG-102 deleted employee route no longer renders blank; BUG-103 street/ward provider gets bounded preference over coarse city/province; BUG-104 snapshot+post-snapshot revenue and Manager fallback reconciliation; BUG-105 mobile order text no longer stays in a squeezed third-column layout. Existing BUG-096/099/100/101 handover/n8n fixes remain intact; work-shift load errors now surface and `Lưu ảnh` regression is restored.
- Browser blocker: required in-app Browser setup/troubleshooting completed; the one allowed list returned `[]`. Physical 320/360/390 px Orders, HTTPS phone GPS/address, signed-in deletion, live Manager Dashboard and real Vũng Tàu Ca 2/n8n receipt remain pending. Do not substitute another browser backend.
- Production safety: no employee deletion, report finalization, n8n webhook, migration, database write or deployment occurred. Existing live production claims from earlier tracker entries are not extended to this local batch.
- Combined changed source/test files for the active incident: `api/reverse-geocode.ts`, `scripts/lan-server.mjs`, `src/lib/attendance.ts`, `src/lib/revenue.ts`, `src/lib/shiftLedger.ts`, `src/lib/operationalShiftAssignment.ts`, `src/pages/AdminPage.tsx`, `AttendancePage.tsx`, `ManagerDashboardPage.tsx`, `ReportPage.tsx`, `ShiftHandoverPage.tsx`, `TodayPage.tsx`, `src/styles.css`, updated focused scripts plus `scripts/test-auto-second-shift-start.mjs`, `test-shift-close-report-realtime.mjs`, `test-dashboard-orders-mobile-recovery.mjs` and trackers. Preserve all unrelated pre-existing worktree changes.
- Open blockers unchanged: BUG-002/003 require authorization/business decisions; BUG-091 requires direct schema approval. Exact next action: attach a signed-in in-app Browser/physical HTTPS phone for non-destructive visual/device checks, then deploy only if the owner explicitly requests release. For Vũng Tàu, let the signed-in assigned leader perform the real close/finalize and confirm the n8n execution rather than invoking it synthetically.

## 2026-07-21 — Thanh Ngân custom/all-day shift receive failure fixed

- Read-only production diagnosis proves Thanh Ngân is active, approved and checked in at Vũng Tàu for 2026-07-21, 07:15–22:15. Her registration intentionally has `shift_id=null`; Ca 1 and Ca 2 leader templates remain 07:15–15:15 / 14:15–22:15. This was not a missing schedule, missing attendance, account state or existing-open-session problem.
- Root cause: the prior explicit-ID guard returned no allowed sequence for every null `shift_id`, so it blocked valid custom/all-day leader registrations before the ledger start call.
- Fix: explicit IDs remain strict; no-ID custom shifts may open only leader sequence(s) fully covered by their registered clock range. All-day 07:15–22:15 covers Ca 1 then Ca 2, while a non-covering custom shift remains rejected. This prevents Ca 1-only theft of Ca 2.
- Evidence: `AUTO_SECOND_SHIFT_START_OK` includes 07:15–22:15 coverage for both sequences and unmatched-custom rejection; `HANDOVER_QA_OK`, realtime, close/report, finalization, Zalo and TypeScript pass. Clean production deployment `dpl_2eh2EKsoszEHxyindTti9K2zCdcp` is Ready/aliased. Its asset/API reads return 200; temporary read-only endpoint is 404 and its deployment was deleted. Next: Thanh Ngân reloads Handover once; Ca 1 should auto-open.

## 2026-07-20 — root cause confirmed: Ca 1 auto-created Ca 2 under the wrong leader

- Read-only Vũng Tàu audit is conclusive: Dương Minh Tú has approved Ca 1 07:15–15:15; Lưu Thị Thanh Ngân has approved and checked-in Ca 2 14:15–22:15. The ledger nevertheless created and closed sequence 2 under Dương immediately after sequence 1 closed. This is why Thanh Ngân sees no handover/finalization control.
- Fixed both automatic entry points, not just the button: `src/lib/operationalShiftAssignment.ts` resolves the registration `shift_id` through the branch's configured leader shifts and only allows the matching next sequence. `AttendancePage` and `ShiftHandoverPage` share it. A lingering Ca 1 attendance cannot create Ca 2; the checked-in scheduled Ca 2 leader receives Ca 2 automatically.
- Evidence: `node --experimental-strip-types scripts/test-auto-second-shift-start.mjs` → `AUTO_SECOND_SHIFT_START_OK`; updated two-leader browser LAN workflow → `HANDOVER_QA_OK` (Ca 1 leader stays checked in, cannot start Ca 2; Ca 2 leader owns/closes/finalizes sequence 2). Realtime, Zalo workflow, close/report, finalization retry and TypeScript pass.
- Deployment completed: guarded 712-module build passes `PRODUCTION_SUPABASE_BUNDLE_OK`; `dpl_Qy4TD2WKpD3vSW4TodUfoVvdJQTo` is Ready and aliased. Live `ShiftHandoverPage-Cg2YFRwR.js`, `AttendancePage-DJLDbPko.js`, `operationalShiftAssignment-ANSXmhJI.js` and server-time return 200; the handover bundle contains the exact Ca 1→Ca 2 owner rejection.
- Owner-authorized production correction completed: exact session `be3c2aaf-097f-4caa-86c6-81d2e7a20c7a` now belongs to `ae914636-b1af-4e32-9044-5d693acce7c3` / Lưu Thị Thanh Ngân. Its original close/open timestamps were returned unchanged; no revenue, inventory, allocation, snapshot or operation-day row was touched. The short-lived token-protected correction endpoint was removed, its temporary deployment deleted, and clean deployment `dpl_FYrs6wHGuuew9PviuJ4rpYC9NW6k` is Ready/aliased. Live guard assets/server-time are 200; the temporary route is 404. Next: Thanh Ngân reloads Report and completes the existing Ca 2/day finalization; confirm n8n receipt.

## 2026-07-20 — urgent Ca 2/report/realtime/account correction ready for production

- Confirmed production causes with read-only data before changing code: 23/10's persisted snapshot is 554,000đ/10 items at 08:14 UTC but later POS now totals 1,798,000đ/35; Vũng Tàu Ca 2 is closed without a final snapshot; normal Admin removal called `hard_delete` although a safe `delete` action already exists.
- Changed implementation only: ID-first shift ownership and latest owned sequence, owner-gated handover controls, existing handover intent consumed by Report automatic finalization, Ca 1 n8n shift-only versus Ca 2+day scopes, post-snapshot receipt deltas, and the then-current deactivation behavior with safe CRM routing.
- Last verification: `HANDOVER_QA_OK` in a fresh isolated LAN store persisted Ca 1, then persisted Ca 2 together with Ca 1 and closed the operation day. `SHIFT_CLOSE_REPORT_REALTIME_OK`, `REVENUE_PARTIAL_SNAPSHOT_FALLBACK_OK`, sales/finalization/n8n/Zalo/realtime/mobile/account regressions, TypeScript and diff check pass.
- Production completed: guarded build passed (`index-DAt8YTlx.js`; `ReportPage-CzAWdwSD.js`; `revenue-LFwMiet_.js`). Vercel production alias now serves all three uncached; Report has handover intent/n8n queue/ID-owner markers, revenue has its snapshot guard/post-snapshot filter, and `/api/server-time` is HTTP 200. `.vercelignore` excludes the unrelated `supabase.zip` archive.
- Production follow-up completed: deployment `dpl_5pa2cKuBJMM3MvAAxueaeSfhad1R` is Ready and aliased. Live bundles confirm immediate n8n send intent, `Hoàn tất bàn giao Ca 2 & chốt ngày`, permanent `Xóa nhân viên` and no deactivation label; `/api/server-time` is HTTP 200.
- Exact next action: the signed-in Vũng Tàu Ca 2 user reloads once and presses the renamed completion button; confirm the n8n execution/recipient. Do not invoke the report on their behalf without explicit historical business-data authorization.

## 2026-07-20 — follow-up owner evidence: Vũng Tàu finalization/n8n and permanent employee deletion

- Owner screenshot at 22:40 is the Report finalization screen, not an open shift screen. Read-only production audit proves both Vũng Tàu shifts are closed, only Ca 1 exists in `shiftReports`, and the operation day is open. There is no additional handover to create; the existing Ca 2/day finalization must be completed.
- Root cause for missed n8n delivery: the existing finalization queued a 22:40 closure at fixed 22:00/22:15 schedule times. It now passes `sendNow=true`; the Ca 2 button explicitly says `Hoàn tất bàn giao Ca 2 & chốt ngày`.
- Owner explicitly changed the account rule: normal employee deletion must permanently delete, not deactivate. One two-step `Xóa nhân viên` action now invokes the existing permanent cloud/LAN path and the inactive/test-delete variants are gone.
- Last verification: n8n config/runtime queue, finalization, sales/revenue, account orphan and TypeScript all pass. Production n8n variable names exist as encrypted Production values. No production data write or webhook call occurred.
- Exact next action: guarded build + deploy, verify production bundle/API, then the signed-in Vũng Tàu Ca 2 user reloads once and presses the renamed completion button. Do not invoke the report on their behalf without explicit historical business-data authorization.

## 2026-07-20 — MOD-04 isolated LAN account lifecycle passed

- Active module: MOD-04 employee/account administration. `qa-shared-schedule-accounts.mjs` was aligned to the current durable Admin route/create panel; no application code changed.
- Last integration command/result: `QA_BASE_URL=http://127.0.0.1:5173`, `QA_ACCOUNT_API=http://127.0.0.1:5177/api/attendance`, then `node scripts/qa-shared-schedule-accounts.mjs` → `SHARED_SCHEDULE_ACCOUNTS_QA_OK` on a fresh isolated store.
- Verified flow: Admin login/create, employee login, reset, old-password rejection, new-password acceptance, deactivate, post-deactivation login rejection; browser also rendered the staff vertical weekly board and Admin employee create form. Final QA profile is inactive with `deletedAt` and no password hash; API error log is empty.
- Last regression batch: account orphan recovery, Admin CRM, cashier POS, sidebar navigation and schedule-registration synchronization all Passed (5/5).
- Open scope is unchanged: production `manage-employee` Edge deployment and real Auth verification remain pending; BUG-091 remains blocked for direct schema approval; physical-device checks remain pending. No production query/write, Auth mutation, migration or deploy occurred.
- Changed in this batch: `scripts/qa-shared-schedule-accounts.mjs`, MOD-04 test cases and testing trackers/profile/index. QA services are stopped, generated run directories are removed, both changed harnesses pass syntax checks and scoped `git diff --check` passes. Exact next action: keep production Edge/Auth verification pending until explicitly authorized, or select the next safe incomplete module; do not infer cloud success from the isolated LAN result.

## 2026-07-20 — MOD-08 isolated LAN handover integration passed

- Active module: MOD-08 automatic shift workflow and handover. The stale `qa-handover.mjs` harness was updated; no application code changed.
- Current contracts exercised: leader and staff create only their own registrations, leader check-in automatically opens Ca sáng, an in-shift staff POS receipt appears in Handover, close navigates to Report, returning to Handover opens Ca tối from the still-active leader attendance, and the second close reaches Report.
- Last integration command/result: `node scripts/qa-handover.mjs` → `HANDOVER_QA_OK` on a fresh isolated LAN store. Persisted evidence: 2 sessions/2 closed, 1 receipt (3 items, 90,000đ), 2 registrations, 1 attendance row, 3 movements, 1 operation day and no API error log.
- Last regression batch: shift realtime reminders, handover report access, sales/report consistency, report finalization retry, mobile handover/report overflow and daily-report employee attendance all Passed (6/6).
- Open bugs/blockers are unchanged: BUG-091 still requires direct schema approval; physical attendance/ranking and cloud/multi-device handover checks still require real connected devices/accounts. No production query/write, Supabase mutation, migration or deployment occurred.
- Changed in this batch: `scripts/qa-handover.mjs`, MOD-08 test cases and testing trackers/profile/index. Exact next action: cleanly stop the isolated QA services/remove only their generated `.qa-handover-run-*` directories, then continue the highest-risk automatable incomplete flow without changing business rules.

## 2026-07-20 — corrected stock-unit flow, attendance provider race and ranking clipping

- Owner clarified that stock issue beyond displayed balance must remain possible after explicit confirmation. Reverted the prior hard block and corrected the actual screenshot path: `0.005 kg` displayed as `5 g`, but outbound input defaulted to kg; entering 5 could therefore subtract 5 kg. Sub-kilogram kg stock now defaults to grams, and intentional kg selection/confirm-and-continue remains available.
- Bulk residue stays numerically visible and is classified from existing packing sources. Example: 5 g potato is below the configured 0.5 kg package and now reads `Còn dư, chưa đủ đóng gói`, not `Đủ bán`. No stock movement/formula/schema/history changed.
- BUG-093 extended root cause: `/api/reverse-geocode` used sequential 5-second providers behind a 4-second client timeout. Providers now race and client timeout is 6.5 seconds. Real-handler mock regression passes with primary failure plus fallback success.
- BUG-094 fixed locally: ranking table no longer clips overflow, and 721–1180 px renders labelled record cards. No competition revenue/KPI/reward logic changed.
- Current evidence: focused owner/core/inventory/attendance/competition tests and related manager/report/native/idempotent/mobile/Admin/UI regressions pass; app TypeScript and `git diff --check` pass. Final guarded build transforms 706 modules and passes `PRODUCTION_SUPABASE_BUNDLE_OK` with `index-CTGtiVtI.js`, `InventoryPage-CJItJLTy.js`, `AttendancePage-DtfVkSrH.js` and `AdminPage-B7byW0KQ.js`.
- Browser retry followed the required setup/troubleshooting flow; `agent.browsers.list()` returned `[]`. This means no browser window is attached to the current Codex session, not that the phone website is unreachable. Physical HTTPS phone check-in/out and signed-in ranking visual QA remain pending.
- Changed in this correction: `src/pages/InventoryPage.tsx`, `src/lib/store.ts`, `src/lib/attendance.ts`, `api/reverse-geocode.ts`, `src/styles.css`, three test scripts plus trackers. No deployment, migration, production query/write or external workflow invocation.

## 2026-07-20 — cleanup removal and intermittent attendance follow-up

- Owner directly requested removal of Admin cleanup UI and diagnosis of intermittent check-in/check-out.
- Removed rendered `Dọn dữ liệu` tab/panel/button only. No purge/cleanup action, RPC, script, migration or data write ran.
- BUG-093 source cause fixed locally: saved attendance now drives optimistic UI before refresh/realtime, check-out returns the completed record, final success feedback is written after best-effort refresh, and concrete-address lookup gets two bounded local attempts.
- Existing selfie, fresh GPS, ≤150m accuracy, concrete address, registration ownership, idempotent retry/read-back and payroll semantics remain unchanged.
- Evidence: `ADMIN_CLEANUP_ATTENDANCE_RESILIENCE_OK`; attendance idempotency/native camera/location, cloud presence, schedule sync, Admin ERP, sidebar, core guards, TypeScript, 217-button audit and guarded 706-module build pass. Local assets: `index-D9p2XKsY.js`, `AttendancePage-MU5pfDQN.js`, `ControlCenterPage-YBT5S0H_.js`. Browser is unavailable (`[]`); physical device validation pending.
- Combined changed files now also include `src/lib/attendance.ts`, `src/pages/AttendancePage.tsx`, `src/pages/ControlCenterPage.tsx` and `scripts/test-admin-cleanup-and-attendance-resilience.mjs`.
- No deployment.
- Exact next verification is a real employee phone check-in and check-out on HTTPS plus a signed-in 768/1024px competition view after an in-app Browser window is attached. Observe GPS/address, immediate saved state, sub-kilogram outbound unit and table visibility; do not issue synthetic production stock merely for testing.

## 2026-07-20 — active owner UX/inventory/Admin batch

- Active modules: MOD-10 inventory quantity/unit/catalog display, MOD-04 employee detail, MOD-06/MOD-18 attendance reliability, MOD-07 KPI/competition, MOD-12/MOD-17 purchasing export, MOD-20 responsive UI.
- Last completed tests: revised `ADMIN_CRM_DIRECTORY_OK` and `CORE_BUSINESS_BUTTON_GUARDS_OK`; the focused owner batch, 16 related regressions, app TypeScript and the guarded 706-module build all pass. Local assets: `index-CWL1xV1V.js`, `index-CExEMiwh.css`, `AdminPage-CsxZ378m.js`, `InventoryPage-DW9BUPpf.js`.
- Open bugs: BUG-088/089/090/093/094 fixed locally and not deployed; BUG-091 remains blocked pending explicit authorization for a replacement database-function migration.
- Browser: required in-app Browser setup/troubleshooting completed; `agent.browsers.list()` returned `[]`. Do not substitute another browser backend; signed-in mobile/desktop visual checks remain pending.
- Changed in this batch: `src/lib/store.ts`, `src/pages/InventoryPage.tsx`, `src/components/AppShell.tsx`, `src/pages/AdminPage.tsx`, `src/styles.css`, new `scripts/test-owner-ux-inventory-admin-20260720.mjs`, and testing trackers.
- No deployment, production write, migration, request status mutation or historical stock rewrite occurred.
- Site-wide source-backed backlog is recorded in `docs/testing/FEATURE_RECOMMENDATIONS_2026-07-20.md`; none of those recommendations were silently implemented beyond the owner's explicit batch.
- Exact next action: inspect the final scoped diff, update module test cases/profile/index, then provide the owner the source-backed site-wide feature recommendations. Only after explicit schema approval, add/apply a targeted replacement for `create_stock_movements_checked` and verify its catalog body without issuing stock movements.

- Closed BUG-085: phone overflow is fixed by scoped Bàn giao action stacking, report action/poster single-column layouts, report-stage overflow locks and viewport-independent `left:-10000px` placement for both unchanged 1080px capture frames. Broad regressions, TypeScript, diff check, normal build and guarded Vercel prebuild pass. Deployment `dpl_5nenFYDNPLVQYXw82nQkzbCDTkqY` is Ready/aliased; live index/CSS/Handover/Report/revenue/API markers pass and unauthenticated n8n revenue remains 401. No migration, business-data write or n8n invocation ran. Browser remained `[]`, so the only remaining confirmation is an owner hard refresh on the physical phone.

- Closed BUG-084: after at least one same-day closed shift, Bàn giao shows one `Xem báo cáo ngày` action that opens the existing current-day report; its connected export always says `Lưu ảnh`. Broad regression, TypeScript/diff and both 706-module production builds pass. Inspected 123-file output contains no database/data/env/archive artifact. Deployment `dpl_CVAFxe8L3YxUqQUtTJadGh3vXJVQ` is Ready/aliased; live main/Handover/Report/revenue/API markers pass and unauthenticated n8n revenue remains 401. No migration, snapshot edit, n8n invocation or business-data write ran. In-app Browser remained unavailable, so final signed-in visual confirmation is the owner's hard refresh.

- Closed BUG-083: targeted production replacement of `delete_pos_receipt(uuid)` now uses the established UTC+7 business date. Catalog verification proves security-definer/search-path/execute/management/ownership invariants remain. The function was not invoked and no receipt was deleted.
- BUG-082 is deployed in final Ready deployment `dpl_29oz46e4FAu4Rwodk48QgU9GuJcG`: Manager legacy shell opens the daily archive; valid POS sellers are not filtered by attendance registration; missing-shift staff are routed to the existing weekly registration flow; old archive snapshots are enriched read-only from same-day POS and no longer truncate after six employees. Live main/Report/Attendance/Archive/Manager/revenue/CSS/API markers pass. The affected eight receipts/544,000đ remain intact. No snapshot, receipt or attendance row was rewritten. Remaining action is only owner hard-refresh + signed-in device confirmation; if check-in still fails, capture the exact employee and visible error because production evidence does not support a blanket RLS/write outage.

- Completed role-specific production correction: Admin stays on the new ERP workspace; Manager once again uses the repository's existing `ManagerDashboardPage`, `#dashboard` default and legacy Revenue/Business/Inventory menu. Manager receives a role-scoped legacy dark shell, while Admin Odoo CSS is not applied through the `management-workspace` class to Manager. On ≤640px the mobile header is now relative/static in a column shell and the main content has no artificial top padding; the Admin filter is explicitly non-sticky at every width. Removed only the global preload for `capy-attendance-camera.png`, which generated console warnings on pages that do not use it; attendance still references the asset on demand and the live file returns 200. Focused role/auth/Admin/Capy/cashier/button/lazy/attendance/revenue/n8n regressions and the 706-module build pass with distinct Manager/Admin chunks. The inspected 123-file Vercel output has six API functions, the expected cron and no SQL/migration/data-repair payload. Deployment `dpl_SeewScbBPsqksQKRb5hs3qBD4Q6g` is Ready and aliased to `https://gustino-operations.vercel.app`; live assets are main `index-BqUCycAl.js`, CSS `index-bMrd_ukc.css`, Manager `ManagerDashboardPage-B1LspX5q.js`, Admin `AdminPage-DOf8Rbih.js`, Attendance `AttendancePage-CttkrJMS.js` and guarded revenue `revenue-Do35TKM9.js`. Main/CSS/chunks/mascot/server-time return 200 and unauthenticated n8n revenue returns 401. Browser is `[]`; no synthetic attendance or business-data write ran. Exact next action: owner hard-refreshes once, then confirms one Admin and one Manager login on a phone; investigate only if that real signed-in run provides contrary evidence.
- Completed owner-authorized production release: the screenshot-defined Admin corrections are live. Removed the duplicate module toolbar and desktop branch/language/bell controls; revenue branch rows no longer pretend to be clickable; the revenue summary is a compact pale-lime ERP ledger; Overview contains exactly Total revenue, Total employees and Branch count; primary/hover colors are in the requested order. Root request-aware Capy loading is mounted again and persistent mascots float subtly with reduced-motion support. Report retains `Lưu ảnh` and its functional `Gửi Zalo` action. Eight attendance/check-in/out regressions plus Admin/Capy/sidebar/button/report/revenue/n8n tests pass. The first Vercel prebuild caught missing Node `process` typing in `api/n8n/revenue.ts`; the minimal declaration/name-contract repair passes and the second prebuild completed without TypeScript errors. Inspected `.vercel/output`: 121 files, six API functions, correct cron and zero SQL/migration/seed/purge/ZIP/env artifacts. Deployment `dpl_CPBrJmskV2tTRMED4PGiPpRY9BMN` is Ready/aliased; live main `index-Dw-f9uls.js`, CSS `index-DeQgcovy.css`, Admin `AdminPage-BAgT0KMt.js`, Report and Attendance assets return 200 with intended markers. `/api/server-time` is 200 and unauthenticated `/api/n8n/revenue` is 401. Browser runtime is `[]`; no synthetic production check-in or business write ran. Exact next action: owner hard-refreshes and performs one normal physical-device check-in/out; investigate only if that real action produces evidence.
- Latest local screenshot correction: Admin sidebar now has one `Đơn hàng` item (duplicate `Nhập hàng` removed); mobile workspace toolbar is static so it no longer covers filters or leaves a sticky gap. Visible attendance deletion copy is `Xóa ca`; the exact audited delete RPC and payroll synchronization are unchanged. Post-handover report action says `Lưu ảnh`. Revenue summary uses lime branding and a structurally correct branch list, with numeric names displayed as `Chi nhánh N`. Existing Capy assets decorate sidebar/module toolbar/Dashboard in addition to loader/attendance. Background refresh/presence failures retry silently instead of raising recurring warning bars; explicit user actions still report errors. Focused regressions, TypeScript, diff check and 129-module build passed (`index-DHfPZIwH.js`, guarded `revenue-CbsImFYD.js`). Browser `[]`; local only, not deployed.
- Latest mobile correction: owner screenshot showed 2-column KPI mini-cards and duplicated stock/order totals at ~253px. Dashboard now has one KPI set only; shift and hour metrics were merged into it, while the duplicate `admin-business-stats` block was removed. At ≤640px KPIs render as full-width compact ERP rows (label left, value right), with flat activity/waste/online lists. Focused Admin/button/revenue checks, TypeScript, diff check and 129-module build passed (`index-hJs3kw5n.js`, guarded `revenue-ZLfN47kO.js`). Browser remains `[]`; local only and not deployed.
- Latest local functional batch: Admin Orders was visible in the sidebar but rejected by `canAccessPage` because the default fallback allowed only shift leaders. The explicit Orders rule now allows Management or Operations roles. Orders uses branch-scoped realtime plus silent focus/visibility/30-second reconciliation and authoritative refresh after writes. Decorative toolbar buttons now render only with real handlers; the unimplemented notification affordance is no longer a button. Mobile Management toolbar is sticky and visible. Report infographic export changes to `Lưu ảnh backup` after handover and remains independent of n8n. AST audit found 223 buttons and zero missing/no-op actions. Focused regressions, TypeScript, diff check and 129-module build passed (`index-B4wBIMO0.js`, guarded `revenue-C14FR9AB.js`). Existing sales/report finalization-refresh contract remains separately open. Browser is `[]`; no signed-in/mobile visual verification and no deploy.
- Toolbar correction: owner reported all Admin tools disappeared after the workspace flattening. The root cause was structural—the outer title wrappers were removed without a module-level replacement. Every Management route now renders `admin-workspace-toolbar` with breadcrumb/title and functional Filter/Today/Refresh controls; existing per-table export actions remain unchanged. Focused Admin/sidebar/CRM/revenue/POS tests, TypeScript, diff check and revenue bundle guard passed. Local only; no deploy.
- Latest local Admin continuation: Revenue, Attendance, KPI, Payroll, Inventory and Purchasing now use flat ERP workspace panels rather than outer cards. Daily revenue is an eight-column dense data table and the branch summary is a flat ledger. `ADMIN_ERP_WORKSPACES_OK`, existing sidebar/CRM/revenue/POS checks, TypeScript, diff check and the 129-module production build passed (`index-DjjHOXFC.js`, `AdminPage-DlsUlxKR.js`, guarded `revenue-mo2ggvB5.js`). Browser list remains `[]`; signed-in visual QA is pending. This Admin build was not deployed; production remains pinned to safe revenue deployment `dpl_FndraMf5uHZY5HrWTS6HwL4qyuUP`.
- Second BUG-077 recurrence and mitigation: `dpl_H49JQJEVPS8hrNQuHH6yf7mBc7H4` (17:13) silently replaced the alias with a revenue chunk lacking the partial-snapshot guard. Owner reported zero revenue again. Alias was immediately reassigned to safe `dpl_FndraMf5uHZY5HrWTS6HwL4qyuUP`; live assets are again `index-CgsZ5_xj.js` / `revenue-DAOjZKDM.js`, guard/fallback markers are present, server-time is 200 and three cache-busted index reads agree. `scripts/test-production-supabase-bundle.mjs` now blocks any future build whose revenue chunk lacks `hasRevenueSummary` plus receipt fallback. Do not deploy any artifact that has not passed this enhanced guard.
- Latest local CRM correction: removed `MANAGEMENT_FUNCTIONS` and the entire secondary card-menu column. Sidebar defaults expanded with labels; header owns branch/language/notification/avatar/account; Settings/Logout remain at the sidebar foot; Dashboard metrics no longer navigate. Focused navigation/CRM/cashier/revenue regressions, TypeScript and build Passed (`index-BYtnJwjo.js`). Browser visual runtime remains unavailable. Do not deploy this local UI batch implicitly; production must stay on the revenue-safe rollback until explicitly released and reverified.
- Emergency production state: deployment `dpl_G3HdvAvMkjN3ZACFxjgxPBDKodQ8` reintroduced the old revenue precedence bug and was rolled back. Production alias now targets Ready deployment `dpl_FndraMf5uHZY5HrWTS6HwL4qyuUP`; live main/revenue assets are `index-CgsZ5_xj.js` and `revenue-DAOjZKDM.js`, with the partial-snapshot guard present. `REVENUE_PARTIAL_SNAPSHOT_FALLBACK_OK` Passed. No DB mutation occurred. Do not promote the regressed deployment again.

## 2026-07-18 — Urgent BUG-077 Vũng Tàu apparent revenue loss

- CRM work was immediately paused for the owner-reported revenue incident.
- Production read-only evidence: `lotte-vt` on 2026-07-18 has 23 receipts, 27 units, 1,260,000đ; every inspected receipt header equals its item total. Prior days: 17/07 1,547,000đ; 16/07 2,070,000đ.
- Root cause is display precedence, not deleted data: snapshot `7b872807-1463-4c01-9dd7-46e1bf28ba41` exists for 18/07 but has no summary revenue/totalSold. It shadowed authoritative POS rows and rendered zero.
- Local fix in `src/lib/revenue.ts`: incomplete snapshots cannot reserve the branch/day against POS; complete snapshots retain existing priority.
- Passed focused regression, TypeScript and isolated 700-module build/bundle guard. One older broad sales/report source-contract test still reports its existing finalization-refresh expectation and was not altered to hide the failure.
- Owner authorized immediate deploy. Isolated deployment `dpl_FndraMf5uHZY5HrWTS6HwL4qyuUP` is READY and aliased to `https://gustino-operations.vercel.app`. Live main `index-CgsZ5_xj.js`, revenue `revenue-DAOjZKDM.js` and server-time return 200; revenue chunk contains the fallback marker.
- CRM/database work was excluded from the deployment. No production DB write, snapshot change, restore or data fabrication occurred. Remaining check: signed-in dashboard hard refresh confirms Vũng Tàu 1,260,000đ for 18/07.

## 2026-07-18 — Admin CRM follow-up and login blank-screen recurrence

- Owner found the first CRM pass still mixed the legacy always-visible account form with the new directory and did not perceive a back control.
- The create form is now closed by default behind `+ Thêm nhân viên`, rendered in the same CRM panel language, and closes after successful creation. Branch and employee profiles use explicit sticky `← Quay lại…` buttons.
- BUG-076 adds a bounded one-time route-load watchdog for lazy imports that remain pending without throwing; successful rendering removes the marker and prevents reload loops.
- Passed CRM, lazy-route, account orphan, core/UI-button, operations/performance, critical-load, TypeScript, diff check and 700-module production build/bundle guard.
- Real signed-in visual/login verification remains pending because the in-app Browser surface is unavailable. No deploy.

## 2026-07-18 — Active local Admin CRM directory/detail redesign

- Owner requires compact employee/restaurant lists outside and dedicated detail pages after selection.
- Employee directory rows now show only identity, assignment, status and open-profile affordance. Avatar, work-profile editor, role, password reset and deletion actions exist only inside the selected employee profile.
- Branch rows open a restaurant profile with period revenue/staff metrics, chart and employee sub-list.
- Passed `ADMIN_CRM_DIRECTORY_OK`, account orphan recovery, core/UI button, operations/performance, critical-load, deploy-polish, app TypeScript, diff check and production build (700 modules) with bundle guard.
- Browser discovery returned `[]`; signed-in desktop/mobile visual verification remains pending.
- Changed application/test files: `src/pages/AdminPage.tsx`, `src/styles.css`, `scripts/test-admin-crm-directory.mjs`. Pre-existing `supabase/.temp/cli-latest` and `supabase.zip` remain unrelated.
- Exact next action: owner reviews the local Accounts page; adjust spacing if needed. Do not deploy.

## 2026-07-18 — Active local redesign plus urgent BUG-072 fix

- Active modules: MOD-13 handover/report UX, MOD-04/MOD-14 CRM presentation, MOD-10/MOD-15 shared SKU reliability.
- Latest completed batch: BUG-072 custom `TP-BANH` recurrence root cause fixed locally by durable last-known-good catalog+tombstone fallback.
- Latest commands: processing linkage, product tombstone, report/inventory UX, and app TypeScript all passed.
- No production read/write, migration, webhook call, deployment, or Git push occurred.
- In-progress files for the owner-requested preview: `ShiftHandoverPage.tsx`, `ReportPage.tsx`, and `AppShell.tsx`; exact next action is targeted report-flow regression, then Admin CRM drill-down and local visual preview.
- Report/CRM implementation is now locally buildable. Local dev is running at `http://localhost:5173` with LAN API on 5177 (exec session 45180). In-app Browser is unavailable (`[]`), so exact next action is owner visual review or opening a Codex in-app Browser, followed by UI iteration. Do not deploy until explicit approval.
- Owner subsequently approved deployment and GitHub push. Production deployment `dpl_DVUDaw7pumgDSEkU9Mc1Rpb2CmLd` is READY/live with `index-DLIBEm1N.js`; HTTP checks passed. Exact next action is commit the reviewed source/test/migration set (excluding `supabase.zip` and `supabase/.temp/cli-latest`) and push `main`.

## Active release — BUG-074 shared SKU visibility

- Owner clarified the catalog is company-wide: every active SKU must appear at every branch, even when that branch has zero stock.
- Production read-only audit proves `custom-tp-banh` (`TP-BANH`, `Thành phẩm bánh hạt dẻ`, unit `cái`, category `finished`) is active. Lotte 23/10 has a 10-piece `processing_in` on 2026-07-18; the old system `cake-ready` remains tombstoned and historical movements are preserved.
- Root cause: `InventoryPage` filtered catalog-derived stock rows through `isVisibleStockLine`, so zero-stock SKUs disappeared at branches without movements/counts. The overview now renders all active catalog SKUs with branch quantity 0. Outbound options still require positive stock, count-form defaults still include only positive stock, and movement/formula logic is unchanged.
- Processing linkage, product tombstone, report/inventory, manager workspace, core business guards, TypeScript and diff safety pass. Next: build, inspected prebuild, production deploy and live asset verification.
- Production build/prebuild passed with 700 modules and `PRODUCTION_SUPABASE_BUNDLE_OK (index-B_0LI7gf.js)`; inspected output has 123 files and zero forbidden database/env/archive artifacts. Deployment `dpl_9Nys88HQDf8YAwTPGAbV9YmirXK2` is Ready and aliased to the main URL. Live index, server-time, main and `InventoryPage-Bl68jXbz.js` return 200. Signed-in branch-by-branch visual verification remains pending.

## Active release — BUG-072/073 loading and inactive-account cleanup

- Owner reports excessive loading and says “Xóa sạch test” removed an account from view while its username remained occupied.
- Source root cause for loading: the mounted global overlay associated every fetch within 900 ms of any click/select/file change, including unrelated polling/realtime reconciliation. The root interceptor is now unmounted; explicit auth, lazy-route/page and local button loaders remain.
- Production read-only account audit: 37 Auth users and 37 profiles, zero Auth/profile orphans, zero tombstoned Auth rows and zero orphan identities. Four inactive Auth/profile pairs remain and reserve usernames: `nhanvien1`, `catruong1`, `catruong2`, `nhanvien2`.
- Source root cause for cleanup: inactive profiles are visible in account administration but “Xóa sạch test” was disabled for `active=false`. The button is now available for inactive accounts, the UI explicitly warns that the username remains reserved until hard-delete, and the signed-in account remains protected. The deployed Edge Function already deletes Auth before profile and refuses partial hidden success.
- Focused loading/account/performance/lazy-route/business regressions, app TypeScript and diff safety pass. No legacy inactive account was automatically deleted; Admin must choose exact accounts after deployment. Next: build, inspected Vercel prebuild, production deploy and live readback.
- Production build/prebuild passed with 700 modules and `PRODUCTION_SUPABASE_BUNDLE_OK (index-BT7XTrnq.js)`; inspected output has 123 files and no SQL/migration/seed/purge/env/archive artifact. Deployment `dpl_7Ux5BJabP5Ljowiq6d2B4zpB1hLr` is Ready and aliased to the main URL. Live index, server-time, main and Admin assets return 200 with the intended loading/account markers.
- During the deploy window account counts changed from 37/37 to 32/32, consistent with concurrent Admin cleanup rather than the frontend package (which invokes no delete on load). Postdeploy audit has zero inactive profiles, Auth/profile orphans, tombstoned Auth users or orphan identities. Do not restore the five intentionally/concurrently removed accounts.

## Active diagnosis — BUG-071 schedule/attendance mismatch

- Owner screenshots show Phạm Đình Phát scheduled 09:00–13:00 on 2026-07-18 while attendance shows both 09:00–13:00 and an open 09:00–17:00 row checked in at 09:02.
- Production read-only audit proves the 09:00–17:00 registration `0a054d1f-4a55-4909-83e3-bcf118ca4cef` was created 2026-07-13 and is the exact foreign-key owner of attendance record `5c1a8847-e4d9-4ee1-9f13-9e66612c9e2a`. A second 09:00–13:00 registration was created at 09:47 local time on 2026-07-18 and has no attendance.
- Root cause is `set_schedule_registration_safe`: it preserves any attended main registration, then inserts the newly selected shift. The board chooses the newest main registration while attendance renders both legitimate IDs. This is not a timezone, photo, GPS or realtime-read failure.
- Do not mutate the current records until the owner confirms whether 09:00–17:00 or 09:00–13:00 is authoritative. Safe implementation direction for future edits is to reject a main-shift change once attendance exists and direct Admin to the audited correction flow; add a regression before migration.
- The white-screen stale-chunk recovery is present in the deployed source, but Browser runtime discovery is still `[]`; a real signed-in reproduction remains unavailable. Old tabs may need one hard refresh to enter the new bundle, after which recognized stale chunks should auto-reload once.
- Owner confirmed 09:00–13:00 as authoritative and requested a definitive fix. Migration `20260718_schedule_attendance_registration_sync.sql` replaces the RPC so an edit updates the one attended main registration in place, preserves attendance evidence, deletes only unattached duplicate main rows, blocks OFF after check-in and refuses ambiguous multiple-attended-main days.
- During the repair window Phát checked in to the correct 09:00–13:00 registration at 10:01, so the first guarded repair correctly aborted when its expected “unattended replacement” condition was no longer true. A fresh audit proved two attendance rows; the revised exact-ID/time guarded transaction saved the stale 09:00–17:00 attendance/registration before-state to `control_audit_entries`, deleted only those two stale rows and preserved the correct 09:00–13:00 attendance.
- Final production audit: 18/07 contains only registration `a2fdc682-bc53-448f-944c-61dcca1cb703` (09:00–13:00) and attendance `144a046e-0c5d-4b15-a0ea-46cae9c4f8ed` (local check-in 10:01, open). The 19/07 14:15–22:15 registration remains unchanged. BUG-071 is closed.

## Active 2026-07-18 reliability/data-synchronization batch

- Owner re-authorized migration audit, production deployment and GitHub publication. Production read-only predeploy baseline is 37 profiles, 280 attendance records, 367 registrations, 879 receipts/1,016 items, 832 stock movements, 57 bag sessions and 4 inventory reports; all eight required realtime tables remain published.
- The latest-object audit proved only the nullable supply delivery columns/constraint were absent. Applied only `20260717_supply_request_delivery_schedule.sql` through targeted linked SQL; post-apply catalog audit proves both columns and `supply_requests_delivery_period_check` are installed. No history repair, bulk push, data update/delete or replay occurred.
- Post-migration verification passed: eight focused regressions, app TypeScript, LAN syntax, `git diff --check`, 700-module production build and `PRODUCTION_SUPABASE_BUNDLE_OK (index-Bz5nGoeM.js)`. Next: deploy `manage-employee`, produce/inspect the Vercel prebuilt output, deploy production and run live/postdeploy read-only checks.
- GitHub publication is currently blocked because required GitHub CLI `gh` is not installed; do not stage/commit the mixed worktree until the publish prerequisite is available.
- `manage-employee` Edge Function deployed successfully. The inspected Vercel prebuilt output contains 123 files, the expected cron, zero SQL/migration/seed/purge/env/archive artifacts and passes the Supabase bundle guard. Production deployment `dpl_AamLCSkfjbCL9yQe94oNo2rSWwzW` is Ready and aliased to `https://gustino-operations.vercel.app`; live index, server-time and the new main/Kitchen/Orders assets all return 200.
- Postdeploy read-only counts are 36 profiles/Auth users, 281 attendance records, 367 registrations, 886 receipts/1,023 items, 834 stock movements, 56 bag sessions and 4 inventory reports. Compared with the predeploy baseline, business rows increased while one synchronized Auth+profile and one bag session disappeared during the release window. The deployed package contains no database action and account audit proves 36/36 synchronization with zero orphan rows; treat these as concurrent production operations, not deployment-caused loss. No restore/recreation was attempted.
- Owner requests less intrusive loading, account username/data synchronization, cake SKU linkage, migration reconciliation, reliable check-in/out and redeploy.
- Pre-fix tests failed as expected. Targeted fixes now pass loading, account orphan, processing linkage/tombstone, attendance idempotency/native/mobile, supply schedule and app TypeScript regressions.
- Read-only production account audit: 37 `auth.users`, 37 `profiles`, zero Auth-without-profile and zero profile-without-Auth. Source additionally proves the account list hid all inactive login profiles despite fetching them; this is fixed locally without adding inactive staff to operational reports. Do not delete or recreate a production account without an exact username.
- Read-only cake audit: historical `cake-ready` movements remain; the system row has `deleted_at=2026-07-09`, while active custom `TP-BANH` (`custom-tp-banh`, unit `cái`, price-zero warehouse SKU) was created 2026-07-18. The UI filters mapped outputs through kg-only products and classifies every non-kg finished SKU as menu; BUG-069 is active. Do not rewrite prior movements, including 2026-07-17 cake inputs that were posted to chestnut output.
- Read-only attendance audit: zero duplicate registration records, zero completed checkout evidence gaps, 19 currently open rows and 9 older than 18 hours. Preserve them for owner review; BUG-070 adds bounded retry and checkout read-back without changing evidence/business rules.
- BUG-067 removed the 700 ms click pulse and delays the overlay until an associated fetch remains pending beyond 280 ms. Explicit auth/lazy route loaders remain.
- BUG-068–070 are fixed locally; no synchronized account, product history or attendance history was mutated. Twenty focused/cross-module tests, TypeScript, LAN syntax, `git diff --check`, 700-module build and production Supabase bundle guard pass; only unchanged BUG-002 failed when deliberately executed. Browser discovery is `[]`.
- Migration history is still unaligned; never bulk push/repair. The linked audit and Vercel prebuild escalations were rejected by the execution platform's tool-usage limit, so production remains unchanged. Resume only after fresh explicit approval/capacity: read-only runtime audit → apply only the reviewed nullable supply-delivery migration if absent → deploy `manage-employee` → rebuild/inspect Vercel output → deploy frontend → live read-only verification.

## Active feature — MOD11/MOD12 requested delivery schedule and classified Kitchen history

- Direct owner scope: order form captures desired receiving date and morning/noon/afternoon; both leader and Kitchen see order date plus receiving schedule; Kitchen exposes a review list filterable by status/date/period/search.
- Direct owner status wording: Kitchen confirms then marks sent; leader must see both. Reuse current `acknowledged` and `fulfilled` states as `Bếp đã xác nhận` and `Bếp đã gửi`, preserving database enum and transitions.
- New delivery columns must be nullable for historical records; legacy orders render `Chưa chọn` instead of fabricated dates. The migration/schema/LAN/Supabase paths all need the same fields.
- Pre-fix `node scripts/test-supply-request-delivery-schedule.mjs` fails 24 expected assertions. Next: implement migration/model/LAN/Orders/Kitchen/history filters, then run pagination/business/UI/type/build regression. Owner authorized deploy and GitHub push after verification.

## Active diagnosis — BUG-066 blank screen immediately after login

- Owner screenshot: production `#kitchen` becomes entirely blank immediately after login and works only after manual reload.
- Live read-only evidence: obsolete `/assets/KitchenPage-D0nm0nQ8.js` returns 404 while current `/assets/KitchenPage-BgTVD0Dy.js` returns 200. This matches a tab opened before deployment requesting its old lazy chunk only after login.
- Source evidence: all business pages use raw `React.lazy`; Suspense only handles pending imports, not rejected imports; there is no route error boundary. `App` also renders `null` while correcting a route that the newly logged-in role cannot access.
- Pre-fix `node scripts/test-login-lazy-route-recovery.mjs` fails ten expected assertions. Authorized fix scope is implementation-only: one automatic reload for recognized stale-chunk errors, marker cleanup after success, an actionable persistent-failure boundary and visible route-correction loading. Preserve all auth/session/role/permission/default-page logic.
- In-app Browser runtime discovery returned `[]`; no alternate browser backend was used. Next: implement, run focused/auth/performance regressions and TypeScript/build, update tracking immediately. Do not deploy/push without owner request.

## Active implementation — MOD13 per-shift report close/Zalo intent

- Direct owner rule: `Chốt báo cáo` is the business trigger for a future Zalo send. Ca 1 records only `shift-1`, completes its own handover and leaves Ca 2/day open; Ca 2 records `shift-2` plus `day` and closes that operation day.
- The owner explicitly reserves the external Zalo connection for a collaborator. This change must create a durable `pending_connection` intent but must not invoke n8n/Zalo from the finalize action. Existing integration modules may remain as the handoff seam/manual compatibility path.
- Preserve required inventory/photo handover before report finalization, shift ownership, stored snapshot, Ca 2 no-open-shift guard, report formulas and all historical delivery fields.
- Pre-fix `node scripts/test-report-close-zalo-intent.mjs` exits 1 with eight expected contract failures covering the missing intent/seam, external call inside finalize, scope-specific button copy and snapshot types.
- Minimal implementation complete: `reportDeliveryIntent.ts` maps sequence 1 to `shift-1` and sequence 2 to `shift-2` + `day`; `ReportPage.saveCloud()` stores a `pending_connection` intent and no longer invokes an external sender. Ca 1 still uses the per-shift snapshot save; Ca 2 still uses atomic daily finalization.
- UI buttons now state `Chốt báo cáo Ca 1 & bàn giao Ca 2` versus `Chốt báo cáo Ca 2 & kết thúc ngày`; success feedback names the recorded Zalo package and waiting-connection state.
- `REPORT_CLOSE_ZALO_INTENT_OK`, `SHIFT_REPORT_ZALO_WORKFLOW_OK`, `N8N_REPORT_IMAGE_QUEUE_OK`, `REPORT_FINALIZATION_RETRY_OK` and app TypeScript Passed. Next: broad report/operations regressions, production build/diff check and final documentation update. No external request, data write, deploy, commit or push occurred.
- Broad report toolbar/inventory, realtime reminder, sales/report, midnight auto-close, core guard and 207-button contracts now all Pass. One stale reminder assertion was aligned to the already-committed owner-selected image-3 Capy asset; no application behavior changed for that test maintenance.
- Production build Passed with 698 modules and `PRODUCTION_SUPABASE_BUNDLE_OK (index-DMYHLV-_.js)`. `git diff --check` and built asset inspection confirm the pending intent plus both scope-specific labels. Browser skill discovery returned `[]`, so rendered button verification remains pending. Implementation is ready for owner review; do not deploy, commit or push unless the owner requests it.
- Owner then requested commit/deploy. Commit `33e51d6` contains the 12 intended application/test/tracking files and no secret/file-temp path. Inspected Vercel prebuilt output contains 123 files, all six existing API functions, zero forbidden database/archive/env artifacts and zero configured sensitive-value matches.
- Production deployment `dpl_ANEHJkw8rJw6Ls62ETWekK8FMMie` is Ready and aliased to `https://gustino-operations.vercel.app`. Live index, `ReportPage-B8dx4RVC.js` and server-time return 200; the live ReportPage bundle contains `pending_connection` plus both Ca 1/Ca 2 labels. No migration, external Zalo/webhook call or production data mutation ran. GitHub push was not requested and was not performed.

## Active diagnosis — BUG-062 work-duration clarity and employee search

- Owner required pulling commit `c6e98c8` before edits. `git fetch` verified it is the direct child of `bfcf04c`; `git pull --ff-only origin main` succeeded. The pulled commit adds only `api/n8n/revenue.ts`. Pre-existing `supabase/.temp/cli-latest` and untracked `supabase.zip` are preserved.
- Reproduction fixture for 2026-07-04 13:55–22:20 returns 505 elapsed minutes, `8.42` decimal hours and the correct human duration `8 giờ 25 phút`.
- Source confirms Admin renders `formatNumber(row.totalHours) giờ`; employee overtime display also uses two-decimal hours. Therefore payroll math is correct and the UI label is ambiguous, not a 17-minute calculation overcount.
- Authorized scope: keep authoritative timestamps, decimal-hour payroll/export inputs, work-day credit, correction RPC/audit and permissions unchanged; replace human-facing duration labels with hours/minutes, label wage arithmetic as decimal hours, add diacritic-insensitive name search and decorate only the relevant attendance surface with existing Capy art/CSS.
- Local implementation is complete: shared hours/minutes formatter, accent-insensitive name/branch search, scoped Capy attendance styling, and Admin-only inline exact-record deletion confirmation. Numeric payroll/export inputs and formulas remain decimal; CSV/XLSX headings now identify decimal-hour columns.
- The new `admin_delete_attendance_record(uuid,text)` migration requires Admin, reason length >= 3, locks/deletes only the selected attendance row, retains the registration and saves the full before-state in `control_audit_entries`. It was applied as the only targeted SQL after linked history inspection; catalog assertions prove function/security/grant/guard/delete/audit contracts. Installation and verification invoked no attendance deletion.
- Focused duration/search and delete contracts now pass together with Admin list, mobile/export, native camera/location and no-emit TypeScript. Next: broad attendance/payroll/button regression, build, migration safety/catalog application, Browser-skill check if available, inspected Vercel deploy/live verification, commit and push.
- Owner additionally reports Đặng Thị Khánh Linh is in Top but has no reward. Source diagnosis: Top sorts monthly revenue; reward is a separate sum of daily/weekly threshold bonuses. BUG-064 tracks the missing reward/condition visibility; preserve all thresholds and add clarity only. Exact employee production totals require explicit approval for the existing Admin read-only audit login.
- BUG-064 clarity implementation is local and tested: the table says `Xếp hạng doanh thu`, explains that Top does not itself award money, and shows the existing computed daily/weekly reward per employee; the leader table explains its revenue is shift-owned, not personal reward. KPI formulas are unchanged. Browser-skill discovery returned `[]`, so no visual claim is made.
- Production release complete: final `dpl_FKKWNtVzvCHXgyvq4PGusy87evnv` is Ready and aliased to `https://gustino-operations.vercel.app`. Live assets are `index-CV3eRp25.js`, `AdminPage-DGNAv-1Q.js`, `AttendancePage-C7XDDx2C.js`, `index-DJLr6MCV.css`; all return 200 with intended feature markers. Server-time is 200 and unauthenticated n8n revenue is 401. Browser discovery remains `[]`; no data mutation/test deletion/authenticated revenue request occurred.
- Added owner scope while the batch is active: BUG-063 requires a per-row `Xóa ca công` action for records created against the wrong employee/day. Implement only as Admin-only, reason-required, exact-record deletion with employee/date confirmation and full before-state audit; retain the associated shift registration and all other attendance data.

## Active production batch — BUG-060/061 inventory Excel clarity and period export

- Owner screenshot shows mixed number separators such as `2,019.915` and requests one consistent convention. Inventory workbook cells remain numeric but all six quantity groups now use `0.####`; POS revenue uses `0`, eliminating the grouping symbol without changing any value/formula/unit.
- Owner additionally requests date/month selection for “Xuất bán và tồn bàn giao” because the prior export included only `inventorySalesDate`.
- The section now exposes `Từ ngày`/`Đến ngày` bound to the existing authoritative report range. `sale_out` movements and handover sessions use inclusive range checks, rows display their business date, and the Excel sheets/titles cover the full period.
- Focused pre-fix regressions failed and now report `INVENTORY_EXCEL_NUMBER_FORMAT_OK` and `INVENTORY_EXPORT_DATE_RANGE_OK`. Manager inventory, shift reconciliation, product tombstone, sales/report consistency, pagination, core business guards, 204-button contract and no-emit TypeScript pass.
- No inventory formula, movement/status rule, permission, API, schema, migration or data changed. Production build Passed with 697 modules and `PRODUCTION_SUPABASE_BUNDLE_OK (index-G-HQ_UuZ.js)`; built `AdminPage-DHtc8ikq.js` contains the period UI/sheet label and single numeric format, with no legacy single-day state or mixed quantity format.
- Inspected Vercel output has 65 files, five existing API functions and zero SQL/migration/seed/purge artifacts. Owner follow-up authorized immediate deployment.
- Deployment `dpl_CV4n9oaG27ciC3KQRCEYELXNA1T7` is Ready and aliased to `https://gustino-operations.vercel.app`. Live assets are `index-G-HQ_UuZ.js`, `index-CmEMlQd6.css` and HTTP-200 `AdminPage-DHtc8ikq.js`; live Admin contains both range labels and period sheet name, with neither the mixed format nor legacy single-day state.
- Required in-app Browser discovery returned `[]`, so no click/viewport claim is made. Actual downloaded-workbook verification remains pending.

## Active production batch — BUG-059 silent Kitchen audio priming

- Root cause confirmed: the first Kitchen interaction always primes `/audio/hachimi-mambo.mp3`; the prior code relied only on `volume = 0`, which is not reliable on older/volume-locked Apple media stacks and could be audible with zero pending orders.
- Minimal fix: set `audio.muted = true` before `audio.play()`, pause and seek to zero, then restore the previous volume/mute state. The separate new-pending-order alert and 60-second reminder guarded by pending requests are unchanged.
- `KITCHEN_IDLE_BELL_OK`, core business guards, 204-button/198-reachable UI contract, no-emit TypeScript, diff check and the 697-module production build Passed. Existing build warnings are unchanged.
- Linked production audit was read-only: 30/30 required public tables, 17/17 required functions and every latest migration object checked by `db_audit_latest_migrations_20260717.sql` are present. No required runtime migration is missing for this release.
- Migration history remains intentionally/unavoidably unaligned: local files use repeated eight-digit date versions while remote history uses fourteen-digit versions through `20260624003000`; exact version matches are zero and `db push --dry-run` refuses. No history repair, pull, force, bulk push, SQL write or migration application was performed.
- Inspected prebuilt output contains 60 files, five existing API functions and no SQL/migration/seed/purge artifact. Production deployment `dpl_CgasdGCNoQyu2nSq6sQeUu2yKDZY` is Ready and aliased to `https://gustino-operations.vercel.app`.
- Live verification serves `index-00Pews68.js`, `index-CvUuwReK.css` and HTTP-200 `KitchenPage-D0nm0nQ8.js`; the Kitchen chunk contains the mute assignment. Remaining check: hard-refresh on the reporting phone/tablet, open Kitchen with zero pending orders and tap once to verify physical silence.

## Active local batch — global Capy loading and attendance reminder art

- Owner requested a small centered Capy loading window for site actions, clarified that loading must randomly choose reference image 1, 2 or 4, and requested reference image 3 in the check-in/check-out reminder.
- Implemented `GlobalLoadingOverlay` at the application root. Every enabled actionable click/form submit/file-or-select change gets a minimum 700 ms overlay; network calls started by that user interaction keep it open until settlement. A short activity window prevents periodic background refreshes from opening the loader.
- Each distinct loading session randomly renders exactly one 256×256 RGBA asset: `capy-loading-1.png`, `capy-loading-2.png` or `capy-loading-4.png`. All loading assets are high-priority HTML preloads, synchronously decoded and selected in a layout effect before overlay paint to prevent the window appearing before Capy. Reduced-motion users receive a static mascot. Auth and lazy-route fallbacks use the same window.
- Replaced the CSS-drawn mascot only on the two attendance reminder surfaces (`AppShell` popup and Today card) with `capy-attendance-camera.png`; Sunday registration reminder is unchanged. Attendance checks, refresh cadence, navigation and business rules are unchanged.
- Verification Passed: `node scripts/test-capybara-loading-ui.mjs` (`CAPYBARA_LOADING_UI_OK`), `npx.cmd tsc -p tsconfig.app.json --noEmit --incremental false`, 204-button contract, idle-disabled regression, `git diff --check`, and both local/prebuilt production builds with 697 modules plus `PRODUCTION_SUPABASE_BUNDLE_OK (index-DyOxfcGs.js)`. Existing Browserslist/Tailwind/ExcelJS/large-chunk warnings remain.
- Browser runtime setup and required troubleshooting were followed; the single availability read returned `[]`. No alternate browser backend was used and no live visual/viewport pass is claimed.
- Inspected `.vercel/output` contained 60 files, five expected API functions, all four optimized mascots, and no SQL/migration/seed/purge artifact. Owner-authorized prebuilt production deployment `dpl_6SBUcHGg1VckVodC8oioWZAQoDiu` is Ready and aliased to `https://gustino-operations.vercel.app`; live HTML serves `index-DyOxfcGs.js`/`index-CvUuwReK.css`, contains preload 1/2/4 and all four PNGs return HTTP 200 `image/png`.
- No schema, business logic or database data changed. Changed application files: `index.html`, `src/components/GlobalLoadingOverlay.tsx`, `src/main.tsx`, `src/App.tsx`, `src/components/AppShell.tsx`, `src/pages/TodayPage.tsx`, `src/styles.css`, four `public/mascots/*.png`, and `scripts/test-capybara-loading-ui.mjs`, plus this tracking batch.
- Exact next action: owner hard-refreshes production and triggers several actions to observe random 1/2/4 selection at desktop/phone widths, then uses a signed-in account with an active attendance reminder to verify the camera mascot in both reminder surfaces. In-app Browser visual verification remains pending.

## Active production batch — BUG-057/058 deployed with schema/data gate

- Owner authorized production deployment with a strict no-data-loss/migration gate.
- Linked migration history names do not align with local filenames. `db push --dry-run` correctly refuses; no repair/force/bulk push was used. Runtime audits prove 30/30 required tables, 17/17 functions, realtime/RLS/policies and `products.deleted_at` are already installed. BUG-057/058 require zero new migrations.
- Eight focused regressions, TypeScript/Vite 696 modules and the mandatory Supabase bundle guard pass. Inspected prebuilt output has 61 files, five API functions and no SQL/migration/seed/purge/local-data artifact.
- Production deployment `dpl_GEMYw5wPiK7fTSK5j6wjG9WBbgAX` is Ready and aliased to the main URL. Live assets are `index-DOyCiHFj.js`/`index-CMcoy5E8.css`; the Admin chunk contains `Đối chiếu ca` and main JS contains the SKU tombstone contract.
- Profiles, attendance, registrations, stock, reports and shift-session counts stayed exactly at baseline; product rows/tombstones stayed 34/9.
- During the deploy window, receipt headers/items decreased by one and Lotte Vũng Tàu revenue decreased by 33,000đ. The deployment contains no DB write and no migration ran. Source exposes an explicit user-confirmed POS delete RPC; pg statistics show this RPC is used, but the current function records neither actor nor timestamp. Treat this as a disclosed concurrent POS deletion, not proven deployment loss. Do not fabricate/restore an unknown receipt.
- Required remaining checks: owner hard-refreshes and verifies the deleted SKU disappears on Admin/kho/POS and that per-shift reconciliation/workbook render correctly. In-app Browser remains unavailable, so real signed-in multi-device visual verification is pending.

## Previous batch — BUG-057 handover-based Out reconciliation

- Owner initially authorized implementation locally, then explicitly authorized the production deployment above.
- Formula for a closed shift: opening handover + additions during shift − closing handover − separately recorded waste. POS is converted to the counted source SKU and used only for comparison.
- Open shift: display POS provisional; official Out/difference remain unavailable until closing balance exists.
- Targeted implementation complete: inventory scope now reads/realtime-subscribes to sessions/POS, converts POS packages through configured packing sources, calculates only closed shifts, exposes SKU detail and adds the Excel sheet `Đối chiếu ca`.
- Focused test reports `INVENTORY_SHIFT_RECONCILIATION_OK`; app TypeScript exits 0. No schema/data/write change occurred.
- Related regression and final 696-module build pass; local assets are `index-CcbqSOlp.js`/`index-CMcoy5E8.css`. Local web/API return 200 and serve the new reconciliation.
- Required in-app Browser has no available session, so visual click/viewport verification remains pending and is not claimed Passed.
- Production now contains this batch; visual/workbook verification remains.

## Active diagnosis — POS sales do not currently create warehouse `sale_out`

- Production 2026-07-16 currently has 30 receipts/30 item lines, 31 products and 1,458,000đ, but zero receipt lines link to a bag allocation, today's allocation set is empty and `sale_out` is empty.
- All three branch sessions are open. Historical/closed-session audit finds no missing movement for a sold allocation because allocations themselves are absent.
- Source contract: POS saves only `sales_receipts`/`sales_receipt_items`; warehouse “Xuất bán” creates `sale_out` directly; shift close creates `sale_out` only from positive `bag_allocations.sold_quantity`.
- Conclusion: not a display/realtime failure. It is an unlinked workflow. Do not implement automatic POS stock deduction until the owner confirms whether warehouse issue and customer sale should be the same event and how to prevent double deduction.
- Owner clarification: remaining goods are already captured by `closing_balances` in handover; do not add a return function. For closed shifts, derive out/consumption from opening + additions − closing − waste, then reconcile against POS. Open shifts can show only a provisional POS quantity until closing count exists.
- No production write, shift close or inventory correction was performed.

## Active batch — BUG-056 daily competition and management realtime resilience

- Owner requires daily competition as a classification within one table, not another card, plus a final warehouse/attendance/realtime/data-loss audit before migration/deploy.
- Source reproduction: daily competition was a fixed Top 3 for today; management realtime had no focus/visibility or periodic fallback after websocket interruption. Focused pre-fix test exited 1.
- Authorized implementation scope: presentation/date selection and refresh resilience only. Preserve revenue/KPI/payroll/stock formulas, permissions, movement types, writes and historical data.
- Required in-app Browser remains unavailable (`[]`) after skill troubleshooting; do not substitute another browser backend. Static/type/build/read-only production evidence can continue, visual/mobile click verification remains explicit.
- Implemented one classified ranking table with exact-day selection and a coalesced silent 30-second/focus/visibility fallback around the existing realtime subscriptions. Focused, inventory, Admin attendance and app TypeScript checks pass.
- Broad related regression Passed 12/12. Linked read-only audit confirms all eight required realtime tables are published, required 20260716 policy/RPC are installed, and records/receipts/stock history remain present. Today's `sale_out` count is zero, so the new daily table correctly has no rows until an inventory sale-out or closed-shift posting is recorded.
- No new schema migration belongs to BUG-055/056. Linked migration history remains intentionally unaligned, so never use bulk `db push`; required prior targeted migrations are already proven installed.
- Production build/prebuilt guard, 12 related regressions and package inspection Passed. Deployment `dpl_9zfvjMPrFbzzuFrzF5P3mnk4moDM` is Ready and aliased to the main production URL.
- Live readback proves `index-C9vho61t.js`, `index-CCcaMT4s.css`, `AdminPage-DoM6UbAd.js`, warehouse sale-out, competition classification and realtime fallback. Auto-close rejects unauthenticated requests with 401.
- Postdeploy linked read-only counts show no decrease; two additional receipts arrived normally while deploying. No schema/data migration or synthetic business write was performed.
- Exact next action: owner hard-refreshes production and checks the manager inventory, competition classification and employee attendance on a real phone/account. Actual workbook-open and forced realtime-disconnect UI checks remain pending because the in-app Browser is unavailable.

## Active batch — BUG-055 manager inventory quantity/export clarity

- Owner requests exact-day goods-issued-for-sale visibility, explicit kg/g/item units, larger text, no threshold column and a complete inventory workbook.
- Source-backed defect: branch card totals add quantities across incompatible `product.unit` values and render the result without a unit. `sale_out` is the existing movement meaning goods removed from stock for sale.
- Authorized scope: presentation, exact-day `sale_out` aggregation and export completeness only. Preserve movement types/signs, stock/count/waste formulas, permissions, writes and historical data.
- Required Browser connection remains unavailable after skill setup/troubleshooting; no alternate browser backend. Visual desktop/phone verification remains pending.
- Pre-fix focused test exited 1 with 13 expected failures. Targeted implementation is complete and now reports `MANAGER_INVENTORY_WORKSPACE_OK`; app TypeScript exits 0 after correcting one helper import caught by the first type run.
- Implemented: grouped unit summaries, kg→g display below 1 kg, selected-day `sale_out` aggregation, larger responsive cards/tables, threshold-column removal with status retained, and five-sheet inventory XLSX.
- Related regression Passed: manager inventory, report/inventory, data pagination, operations performance, deploy polish, business guards, 204-button contract, prior Admin polish and app TypeScript.
- Exact next action: scoped diff check and production build. Do not deploy without a new owner request.

## Active batch — BUG-054 attendance correction list scalability

- Owner requests editing attendance by exact day or selected employee because rendering a multi-month list is not usable.
- Source reproduction: `attendanceListRows.map(...)` renders the entire global range; no exact-day/employee/list pagination control exists even though employee filter state is present.
- Authorized scope: list-only view mode and pagination. Preserve the global report/Excel date range, Admin-only RPC, required reason/time validation, audit log, realtime refresh and payroll formulas.
- Required in-app Browser connection remains unavailable (`[]`) after skill setup/troubleshooting; do not use an alternate browser backend. Static/type/build verification can continue, visual phone verification remains pending.
- Pre-fix focused regression exited 1 on the missing 20-row contract. Targeted implementation is complete and the same command now reports `ADMIN_ATTENDANCE_REPORT_POLISH_OK`.
- Implemented: exact-day default with range clamping, required employee selection for per-person history, newest-first order, 20-row pagination and responsive filter/pager layout. Filter/page changes close a stale editor; save behavior is unchanged.
- Related verification Passed: focused attendance correction, mobile attendance/export, cloud-only presence, operations performance, core business guards, KPI/payroll reverse audit, app TypeScript and UI-button contract (204 total/198 reachable).
- Final production build Passed with 696 modules and `PRODUCTION_SUPABASE_BUNDLE_OK (index-72SMd5zB.js)`; CSS is `index-CLMsA5QW.css`. Scoped diff check has no whitespace error beyond existing line-ending notices.
- Exact next action: owner visually checks `/#manager-attendance` on desktop/phone. Do not deploy without a new owner request.

## Latest 2026-07-16 attendance/report/order batch

- Owner correction completed before deployment: inventory-count PNG now measures rendered content height and follows the supplied compact white-paper reference. Focused/inventory tests and TypeScript pass.
- Normal build and eight related suites pass. The first Vercel prebuild was stopped by `test-production-supabase-bundle.mjs` because isolated build env omitted the configured public Supabase values; no bad bundle was deployed. The corrected prebuild explicitly loaded only the two public `VITE_` values.
- Linked migration history is not aligned with the later local migration filenames, so `db push` was intentionally not used. Only `20260716_active_session_own_read.sql` and `20260716_admin_attendance_correction.sql` were applied with targeted linked SQL execution; both exited 0.
- Post-migration catalog assertions passed: owner/Admin active-session SELECT policy is installed, the obsolete policy is absent, the Admin correction RPC is `security definer`, and `authenticated` has execute permission. No attendance correction RPC or production data mutation was invoked.
- Corrected Vercel prebuild was deployed as `dpl_Cnc2dpznvj7TqPUGWXR7cagXKmBn`; Vercel reports `READY` and aliased to `https://gustino-operations.vercel.app`.
- Migration static safety audit passed: no destructive data DDL/DML. The single attendance-record update exists only inside the new Admin RPC body and runs later only after an explicit Admin correction.

- BUG-052 migration/client are deployed and production catalog verification passed. A real signed-in browser heartbeat is still required before closure.
- BUG-053 is deployed with a fixed 9:16 stock poster, content-height count poster, prominent branch/reporter metadata and 2× PNG export. Browser/device visual QA remains pending.
- Admin-only attendance correction now edits authoritative `attendance_records` through `admin_update_attendance_record`, requires a reason, validates time bounds, writes `control_audit_entries`, refreshes the list and feeds the existing payroll calculation. The RPC is installed; it was not invoked during migration verification.
- The two redundant KPI summary cards are removed. Order entry is table-like; order report export is fixed 1080×1350 PNG.
- Focused test, TypeScript, eight directly related suites and eleven extended business regressions pass. The only exercised known failure is unchanged BUG-038 (`current_date` in the Supabase POS delete rule), still blocked for a business/database decision. Live assets are `index-CrBhvNaD.js`/`index-NumTK3Ca.css`; direct reads return 200 and the cron endpoint without secret returns 401. Post-deploy SQL guards confirm profiles, attendance, 2026-07-16 sales and stock history remain at or above the verified baselines. No restore, seed, purge, manual cron invocation or synthetic business write occurred. Browser skill setup returned `[]`.

## Active batch — BUG-051 manager inventory workspace

- Owner requests a professional warehouse-style manager/admin inventory UI and reports that opening detail makes other branches appear hidden.
- Reproduction: `node scripts/test-manager-inventory-workspace.mjs` exits 1 with 15 expected pre-fix failures. Source cause is inline native `details`: large SKU content is inserted between branch rows and pushes later branches beyond the viewport.
- Authorized scope: presentation and stable disclosure state only. Preserve global branch/date filters, inventory reads, stock/low-stock/waste/movement formulas, roles, schema and writes.
- Intended fix: persistent responsive branch-card grid; one controlled detail workspace below the full grid; SKU rows with current stock, warning threshold and status; separate loss attention panel.
- Browser skill setup was retried on 2026-07-16; selection failed, troubleshooting was read and the single discovery call returned `[]`. Do not substitute another browser backend. Real visual/mobile clicking remains pending.
- Targeted fix complete: `AdminPage.tsx` uses a controlled `inventoryDetailBranchId`; every branch stays in the card grid while one detail workspace renders below it. `styles.css` adds desktop/tablet/phone layouts, status chips and a non-overflowing mobile SKU presentation.
- Last test: `node scripts/test-manager-inventory-workspace.mjs` → `MANAGER_INVENTORY_WORKSPACE_OK` after 15 expected pre-fix failures.
- Final local verification: six focused suites Passed (`MANAGER_INVENTORY_WORKSPACE_OK`, report/inventory, operations, deploy polish, 197-button contract and core business guards); app TypeScript and scoped diff check Passed. Production build Passed with 696 modules, local assets `index-BCcSFfiz.js`/`index-qJ54xsYb.css`, and the mandatory Supabase guard Passed.
- Changed files for this batch: `src/pages/AdminPage.tsx`, `src/styles.css`, new `scripts/test-manager-inventory-workspace.mjs`, and testing tracking files. No deploy or data/service mutation occurred.
- Exact next action: owner visually checks `/#manager-inventory` on desktop/phone or provides a controllable in-app Browser. If approved for release later, rebuild/prebuild with explicit public Supabase values and follow the established data-safe deploy gate; deployment is not authorized by this request.

## Active batch — BUG-047 idle disabled-button spinner

- Owner reports buttons continuously spinning while no action is running and asks whether to deploy.
- Source-backed reproduction: pre-fix `node scripts/test-idle-button-loading-state.mjs` failed four assertions because global CSS assigned `gustino-spin` plus `cursor: progress` to every disabled primary/secondary/mini button, including idle prerequisite-disabled buttons.
- Fix/result: removed only that global visual rule. `IDLE_BUTTON_LOADING_STATE_OK`, the 195-button contract, operations performance and core business guards all pass; disabled conditions/handlers are unchanged.
- Production verification: 696-module build Passed; latest assets are `index-MmS9OiBJ.js` and `index-BKCLRZa3.css`.
- Auto-close environment update: `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are now configured as Sensitive Production variables through direct CLI piping; neither value was printed or saved to the repository/local env. A new production deployment is still required before the function receives them.
- Corrected data-safe deployment completed: production `dpl_BwWRkaTpos7Nvf4D7L6gRve5gv2y` is `READY` at `https://gustino-operations.vercel.app`, serving `index-MmS9OiBJ.js`/`index-BKCLRZa3.css`. Live bundle contains the intended Supabase host/public anon key and Supabase Auth responds 200. No migration, seed/purge, Supabase row write, webhook or manual cron invocation occurred.
- Remaining production limitation: the current active deployment predates the new server secrets and BUG-048 endpoint fix. Do not describe auto-close as operational until the inspected prebuilt output is redeployed and production authorization/read-only scope checks succeed.
- Today-data readback: linked read-only SQL for 2026-07-15 confirms current production data is already in the Supabase used by the deployed frontend (three real branches: 20 receipts, 22 units, 1,210,000đ; operation days/shifts open). Do not seed/copy it. The active `test` branch also has today's rows and must not be deleted without explicit scope approval.
- Current authorized next action: configure the two missing server-only Vercel secrets without printing them, redeploy the same prebuilt code so the function receives them, then perform an authorization/no-current-day mutation check. Do not manually close 2026-07-15 before midnight.
- Safety correction before that action: BUG-048 is fixed in code. Auto-close now merges authoritative completed-day POS revenue/sold totals, employee rows and shift proof images into the archive payload; the focused test and API TypeScript pass. Do not configure/invoke cron until the remaining regression/build/deploy and controlled production check complete because seven stale open days are in catch-up scope.
- Urgent owner report after deployment: the UI appears to have lost all user data. Two linked production audits are read-only and show no deletion: 36 auth users/profiles remain (32 active), all real-branch staff/leader counts remain, and July 15 still contains 20 receipts/22 units/1,210,000đ. The local LAN JSON is from July 7 and is not a valid recovery source. Treat this as a load/session/source-visibility investigation, not confirmed data loss; do not seed/restore/overwrite without evidence. Browser skill currently lists no in-app browser for direct reproduction.
- BUG-049 is closed: `.vercel/.env.production.local` injected empty public Vite values into the broken deployment. The corrected bundle was rebuilt with explicit valid public values, guard-tested, redeployed, and verified live. Never copy the July 7 LAN JSON over production; require `PRODUCTION_SUPABASE_BUNDLE_OK` for every future prebuilt deploy.
- BUG-050 is closed in production: additive two-table migration/RLS is live, a natural browser heartbeat reaches cloud, and deployment `dpl_DW9ghKs3NquGjpZiJ3UjGNeRdCpT` serves `index-BfjqIqTV.js` with neither former localStorage key. Cloud errors now surface rather than pretending local success.

## Active batch — 2026-07-15 deploy polish

- Scope: remove report developer-facing notes, fix report-archive mobile overflow/date controls, remove four inventory count cards, stabilize order-image export, hide branch-invoice drilldown from manager role, show full competition names, and compute leader competition from total POS revenue inside leader-owned shift sessions.
- Pre-fix evidence: `node scripts/test-deploy-ui-business-polish.mjs` exits 1 with 10 failures; BUG-041/042/043/044 are recorded.
- Browser/n8n: Browser skill runtime has no `iab` browser (`agent.browsers.list()` returned `[]` after required troubleshooting). Direct n8n UI mutation is still blocked; do not substitute VS Code Simple Browser/Chrome automation.
- Business guard: the owner directly authorized session-based leader competition. Existing payroll/KPI reward formulas are not authorized for reinterpretation; analyze them separately and only fix implementation defects proven against their current daily/weekly definitions.
- KPI evidence: BUG-045/046 are closed by `test-kpi-reward-reverse-audit.mjs`; direct POS and allocation revenue are aggregated once per employee/day in both payroll and its detail table before the unchanged daily/weekly functions run. `monthlyBonus = 0` and the meaning of a six-day “perfect” week remain business-confirmation items, not authorized formula changes.
- Implemented: report notes removed; inventory four-count grid removed; manager invoice drilldown is admin-only; order image export uses Blob/native share; archive filters/mobile locks and month-scoped reads added; full ranking names wrap; Admin/Manager leader competition uses date-bounded session revenue; BUG-045 daily POS reward aggregation is corrected without changing monetary thresholds.
- Current verification: deploy polish, KPI reverse audit, report toolbar, competition, operations, load-failure, inventory, button contract, app TypeScript and the final production build pass; Browser/n8n remains externally blocked by missing `iab` surface.
- Deploy package check complete after BUG-046 and the final removal of technical Zalo copy: 14/14 focused regressions, LAN syntax and the 696-module production build pass. Latest local assets are `index-BN2tmquW.js` and `index-Dl8Jvmy4.css`. No deployment was performed. Existing build-size/ExcelJS/Browserslist/Tailwind warnings are unchanged and non-fatal.
- Remaining verification: real iPhone visual check for archive/name wrapping, live Supabase/LAN leader-session data, and direct n8n UI/Zalo evidence. Browser runtime is still `[]`, so none is falsely marked Passed.

Last updated: 2026-07-15

- Active batch: strict cross-module button/business-rule/data-completeness audit. MOD-02/09 database-authorization blockers remain untouched.
- Last test case processed: critical read-failure visibility and final full-suite/build verification.
- Last test command: all 22 safe `test-*.mjs` scripts executed — 19 Passed; only BUG-002, BUG-003 and BUG-038 tests failed as recorded blockers. Ten `qa*.mjs` files passed syntax only; live Playwright execution was intentionally not run because the required in-app Browser is unavailable and some scripts mutate LAN data.
- Latest build: app/API TypeScript, LAN syntax and `npm.cmd run build` Passed (696 modules, Vite 8.54 s). Local main bundle is `index-BN2tmquW.js`; the last verified production baseline remains `index-BFBcAEpk.js`.
- Latest fixes: BUG-031/032/033/034/035/036/037/039/040 are closed by focused source/mock regression. They cover actual branch-sync error reporting, autosave error visibility, complete supply/stock/LAN POS reads, configured SKU count vouchers, UTC+7 client/LAN dates, false-empty critical reads and one unused Dashboard session load.
- UI evidence: 195 native buttons audited, 189 reachable; static wiring/form checks Passed. Real click/render/disabled/role/mobile behavior remains Blocked because Browser discovery returned `[]`.
- Business audit: `docs/testing/BUSINESS_RULE_AUDIT_2026-07-15.md`. Manager Orders/Report Archive scope, dynamic RBAC enforcement, kitchen/POS cancellation reason/audit, large inventory-variance approval and payroll period lock are `Needs Business Confirmation`; no related logic/schema was changed.
- Deploy comparison: `docs/testing/DEPLOY_COMPARISON_2026-07-15.md`; no deployment occurred.
- Auto-close correction complete in code: `0 17 * * *` UTC invokes at 00:00 UTC+7 and the endpoint closes only day N and older stale days after entering day N+1. Focused tests plus app/API TypeScript pass; production secrets/deploy remain blocked.
- Local Vercel build confirms the auto-close function and exact `0 17 * * *` cron are emitted. No deploy occurred.
- Open blockers: BUG-003 Critical (spoofable LAN identity fallback), BUG-002 High (inactive profile absent from shared DB authorization guard), and BUG-038 High (Supabase same-day POS deletion uses DB `current_date` rather than UTC+7). All require explicit permission/auth/database decisions.
- Needs Business Confirmation: MOD02 manager branch scope plus the six items in the business audit; no logic changed.
- Blockers: canonical `docs/testing/` workflow was missing and has been provisionally reconstructed; in-app Browser is unavailable (`[]`); hosted n8n Public API returns pre-auth HTTP 400 `Invalid URL`; isolated Vercel hotfix source extraction is blocked by the execution environment usage limit; one transient OS error 112 occurred during a large read command.
- Business-logic guard: active per `AGENTS.md`; do not change roles, permissions, formulas, states, schema, API contracts, or flow order without direct approval.
- Pre-existing changes: extensive dirty worktree; see `git status --short`. Do not revert them.
- Files changed in the latest strict-audit turn: new tests `test-ui-button-contract`, `test-core-business-button-guards`, `test-data-pagination-consistency`, `test-business-date-contract`, `test-critical-load-failure-visibility`; focused edits in `attendance.ts`, `store.ts`, `supplyRequests.ts`, `lan-server.mjs`, Inventory/Admin/Manager Dashboard/Sales/Handover pages and current QA mirrors; all tracking files under `docs/testing/`. Preserve all other dirty-worktree changes as user-owned.
- Deployment constraint: do not deploy; owner will test local changes first.
- Current intake/handoff: detailed checklist and external blockers are in `code.md`; Zalo requirements and secure credential setup are in `docs/ZALO_GMF_SETUP.md`.
- Latest report/Zalo batch: dedicated app/API TypeScript, all six scope regression scripts, LAN syntax and the final 695-module build pass. A fresh isolated LAN flow created/closed a shift, stored its report, reached the Zalo route with a server-issued leader token and returned the expected 503 because credentials were intentionally absent. API-side conditions and duplicate-send protection are present. True GMF testing needs `ZALO_OA_ACCESS_TOKEN` and `ZALO_GMF_GROUP_ID` in `.env.local`. Image delivery still needs Zalo's official GMF image-message contract.
- Current MOD13/n8n batch: owner configured server-only n8n environment values and a webhook/Drive/Sheet/scheduled Zalo workflow. Existing-`ReportPoster` capture, authenticated `/api/n8n-report-image` proxy plus LAN equivalent, exact schedules and snapshot retry state are implemented. Targeted static test, TypeScript and LAN syntax pass; no external webhook has been called yet.
- Latest n8n regression: 6/6 targeted commands passed (`N8N_REPORT_IMAGE_QUEUE_OK`, existing report/Zalo, report/inventory, mobile/export, shift/realtime and API TypeScript). `N8N_REPORT_ENABLED=true`; no synthetic external webhook call was made because its fixed schedule could be immediately due and send to the real group.
- Full local build passed after the n8n change (696 modules, exit 0 in 35.3s); no deploy. Documentation and `code.md` now distinguish the implemented n8n image path from the still-blocked direct OA/GMF image contract.
- Final local regression passed n8n/report static contracts, app TypeScript, LAN syntax and scoped diff check. `.env.local` remains ignored and no secret value was printed or committed.
- Latest owner correction: the separate live filtered camera and manual Safari permission panel remain rejected. Attendance uses native phone capture, automatically asks for GPS during check-in/out, requires a concrete address, and now restores the supplied legacy photo stamp with visible GPS coordinates/accuracy as well as stored audit fields. The older “coordinates only in audit fields” presentation rule is superseded by the direct owner request.
- Latest runtime finding: local n8n was disabled despite valid production webhook/token; `.env.local` is now enabled but the server must restart. No local report snapshot or listening dev/API server exists and no test webhook was sent. Safari's documented local phone URL is HTTP, which cannot grant geolocation.
- Real-send attempt: owner authorized and then explicitly reconfirmed after being informed of the export risk. The environment still rejected sending the rendered infographic and metadata to the unverified external webhook. No job/image was sent; further workaround attempts are prohibited.
- Latest diagnosis/fix: local web uses Supabase but the local n8n endpoint recognized only LAN-issued sessions. Route-scoped Supabase authentication/shift/snapshot handling and 25s client/20s webhook timeouts are now implemented; all targeted tests and the 695-module build pass. Local dev was restarted after the build as PID 28420 on 5173/5177.
- n8n UI note: configured URL is production `/webhook/...`; owner must set workflow Active and watch Executions. Manual “Execute workflow/Listen for test event” waits for `/webhook-test/...` and will spin indefinitely.
- Latest owner evidence: the report UI shows `Không thể đưa ảnh báo cáo vào hàng đợi n8n.`. No process currently listens on local ports 5173/5177, and the client discards non-JSON proxy status/body; BUG-016 records this actionable-error defect.
- Latest regression/runtime result: `REPORT_FINALIZATION_RETRY_OK`, `SHIFT_REPORT_ZALO_WORKFLOW_OK`, LAN syntax and scoped diff check Passed; 5173/5177 still listen and health remains 200. The unauthenticated proxy check did not reach n8n.
- Latest owner result: the real retry displays `Webhook n8n trả lỗi HTTP 403.`. Local URL/token/enabled metadata and fixed `x-gustino-token` source contract are present; likely n8n Header Auth Name/Value mismatch or Webhook IP whitelist.
- Historical screenshot note: Webhook Options had no IP whitelist configured; the credential dropdown label alone did not prove Header Name/Value. Convert to File fields matched the payload contract. Current required configuration is Production URL plus `Respond=When Last Node Finishes`, saved/published Active.
- Direct-control blocker: owner authorized UI changes, but the in-app Browser is unavailable (`[]`); the authenticated n8n tab shown is external Chrome. Per Browser skill, do not substitute another automation backend. Unblock by opening/signing into n8n in the Codex in-app Browser, or have the owner make the two credential/response changes manually.
- Connection retry after owner said the Browser was opened still returned unavailable/`[]`; do not retry other automation backends. Ask for confirmation that an actual Codex in-app Browser panel exists, not a Chrome tab.
- Definitive 403 cause found without browser control: owner screenshot now verifies the Webhook node settings, while `.env.local` mtime 10:56:38 is newer than API PID 18824 start 10:42:03. Restart local dev so the server loads the new Header Auth token before another owner retry.
- Post-restart config test failed because the newly edited env now points at `/webhook-test/...` despite the n8n node being on Production URL. Restore `/webhook/...`, restart, rerun the config test, and only then ask for one owner retry.
- Production correction complete: `.env.local` now uses `/webhook/...`; `LOCAL_N8N_RUNTIME_CONFIG_OK`, health 200, ports 5173/5177 and `ENV_NEWER_THAN_SERVER False` verified after restart (API PID 24316). Exact next step is one owner click on `Gửi lại ảnh Zalo`, then inspect n8n Executions.
- Latest owner retry now returns n8n HTTP 500, proving auth/production routing succeeds. BUG-017: both APIs currently discard the upstream JSON body, so add bounded secret-redacted detail handling and regression, restart, then retry once to reveal the exact failing n8n node/message.
- Latest BUG-017 test: `node scripts/test-n8n-report-image-queue.mjs` fails the two intentionally added pre-fix assertions for cloud/LAN bounded upstream detail handling.
- BUG-017 post-fix regression: n8n queue/runtime, LAN syntax and app/API TypeScript all pass. Restart local API, then one real retry should expose the bounded secret-redacted n8n message and identify the failing execution/node.
- BUG-017 restart complete: 5173/5177 listen under API PID 23748, health 200 and local n8n config passes. Exact next step is one owner retry and capture the full new message; also open the newest red n8n Execution to identify the node.
- Latest owner result: real Ca 1 retry now shows one infographic accepted into the automatic n8n schedule. Web→Supabase-authenticated local API→production n8n is verified and prior 403/500 are resolved. Next verify latest n8n Execution is green, Sheet row is `READY` with 15:15, then Zalo receipt and Sheet `SENT`; Ca 2 two-image package remains untested.
- Correction from owner: Sheet has no row despite the success banner, so downstream n8n was not verified. `Respond=Immediately` created a false positive and queued state hid the button. BUG-018: add confirmed `Gửi ngay Zalo`, current UTC+7 `send_at`, same job key, and configure n8n `When Last Node Finishes`; exact downstream node still requires Execution evidence.
- BUG-018 targeted fix passes `N8N_REPORT_IMAGE_QUEUE_OK`, LAN syntax and app/API TypeScript. `Gửi ngay Zalo` is persistent, confirmed/manual only, preserves the job key and automatic schedules, uses current UTC+7 time, and both APIs reject an early “workflow started” acknowledgement. Restart local, then owner must set Webhook `When Last Node Finishes` before real retry; Sheet/Zalo receipt is not yet verified.
- BUG-018 related regression also passes local Supabase runtime, report finalization retry, shift-report/Zalo workflow and local n8n runtime configuration. Exact next action is build/diff verification, local restart, then one owner click after n8n is saved with `When Last Node Finishes`.
- BUG-018 full local build passes (695 modules), scoped diff check is clean apart from line-ending notices, local n8n runtime config passes, web/API return 200 and ports 5173/5177 listen under PID 23748. Exact next action: owner saves/publishes n8n with `Respond=When Last Node Finishes`, refreshes the report page, clicks persistent `Gửi ngay Zalo`, then verifies Sheet and Zalo. No deployment has occurred and Codex did not call the webhook.
- Latest n8n correction: the update node's `Column to match` is `job_key`, so `job_key (using to match)` must be `{{ $('Limit1').first().json.job_key }}`. The latest screenshot incorrectly has `.json.row_number`; the earlier deleted-node reference is superseded. Browser-control skill found no in-app browser session (`[]`), so Codex could not click the external Chrome tab. Save/publish and real retry remain external.
- Latest owner observation: the expression is grey and no previous-node data appears because `Update row in sheet1` belongs to the scheduled delivery branch and Sheet is still empty. Test/repair the lower Webhook ingestion branch first; it must append/upsert a `READY` row before `Get row(s) → Code → Limit1 → download → Zalo → Update row` can run.
- Latest ingestion screenshot shows no visible mapping error: report metadata comes from `Webhook.body`, and `drive_file_id` comes from `Upload file.id`. Grey/predicted Drive capabilities mean the node has no loaded execution, not that fields are disabled. Next test must come from the published production webhook via the app's `Gửi ngay Zalo`, then inspect the newest n8n Execution and Sheet.
- After the owner reported no activity, local recheck passed: runtime config, web/API HTTP 200 and 5173/5177 listeners are healthy under PID 23748. Browser control remains unavailable, so the external decision point is n8n Executions: no new execution means workflow Active/Production URL issue; a new error/running execution must be opened for the first failing node.
- Owner's Executions screenshot contains only cron-triggered runs; the lower Webhook branch is grey. Local server is definitely using host `haehfy.ezn8n.com`, path `/webhook/gustino-report-ready`, and started after `.env.local`, so stale env is excluded. Ask for the exact in-app banner after hard-refreshing local `/#report`, clicking `Gửi ngay Zalo`, and confirming; that response separates client/auth/snapshot rejection from outbound webhook routing.
- Second screenshot at 13:30:02 repeats the same evidence: cron/Get rows only, no row output, all downstream and Webhook nodes grey. Do not diagnose Zalo/Sheet further until the owner shows whether the local report button produces the duplicate-warning confirmation and the exact banner after confirming.
- Owner has now supplied the exact banner: `Đã yêu cầu n8n gửi ngay 1 ảnh Zalo.` Web/client/auth/API/production-webhook delivery is therefore verified for a real Ca 1 manual send. Next evidence is the matching non-cron Webhook execution; open `Append or update row in sheet` and capture its Document, Sheet and OUTPUT. If green with a row number, the owner is viewing a different spreadsheet/tab; if grey or empty, inspect the preceding Upload node.
- The subsequent “no output” screenshot was taken in Editor/Preview, evidenced by predicted Drive capabilities and `Execute the node`; it is not saved execution data. Do not infer a node failure from it. Navigate from Executions into the non-cron Webhook run before inspecting INPUT/OUTPUT.
- BUG-018 reopened: real banner can still occur on an empty/unrelated 2xx body because `n8nImmediateOnlyAck` returns false for empty bodies. New test fails two cloud/LAN assertions. Implement strict completion proof requiring expected `job_key` and `row_number`, rerun related regression, restart local, then one owner retry should expose the actual n8n response issue instead of another success banner.
- BUG-018 completion-proof fix now passes queue, syntax, app/API TypeScript and all four related regressions. Empty/non-JSON/early/wrong-job responses cannot mark queued; only exact `job_key` plus `row_number` can. Restart local, then owner retries once; the banner must either prove the Sheet row or reveal the exact acknowledgement contract still missing.
- Completion-proof local runtime is now ready under PID 26932; ports 5173/5177 listen, web/API are 200 and runtime config passes. Two prior sandboxed background starts exited without listeners and were treated as harness failures. Exact next action is one hard refresh and one `Gửi ngay Zalo` retry; capture the new banner.
- Real retry verified the guard and exposed the n8n root cause: Sheet row 2 stores most `{{ ... }}` mappings literally; only `report_label` evaluated. Dynamic fields in `Append or update row in sheet` are Fixed mode. Convert job/branch/date/type/send/Drive/file mappings to fx Expression (prefer `.first()`), keep READY/0 fixed, remove malformed test row 2, publish and resend.
- Latest screenshot confirms the selector itself: `Fixed` is active on dynamic mappings while only `report_label` shows `fx`. Owner must click `Expression` on job_key, branch_id/name, business_date, report_type, send_at, drive_file_id and file_name; visual success is an `fx` marker on every one.
- Owner reports no completion after Expression correction. Google Sheets output can omit `row_number`; new regression fails two cloud/LAN compatibility assertions. Adjust proof minimally to exact `job_key` plus (`row_number` or `status=READY`), preserving rejection of empty/wrong/early responses, then rerun and restart.
- Output-compatibility fix is implemented and verified: exact job key plus row number or READY is accepted; all prior false acknowledgements remain rejected. Queue/syntax/type and four related regressions pass. A parallel sandbox setup failed before execution; sequential rerun passed. Restart local then retry once.
- Output-compatibility runtime is now live locally under PID 11388; ports 5173/5177, web/API 200 and runtime config are verified. Owner should hard-refresh and retry `Gửi ngay Zalo` once; no more n8n node change is required for missing `row_number`.
- Owner explicitly asked Codex to repair n8n directly. Required Browser connection still returns no available in-app session (`[]`); only an external Chrome tab is shown. Direct mutation is blocked until the owner opens/signs into n8n inside Codex's in-app Browser. Do not switch to another browser backend or extract Chrome credentials/cookies.
- Even after the owner said the Browser was opened, immediate selection plus the single allowed list call still returned `[]`. Treat this as an unavailable Browser surface, not an authentication issue; request a screenshot that includes the Codex Browser panel itself before another retry.
- Screenshot identifies the tab as VS Code Simple Browser (`WEB - n8n`), which is not exposed to Browser runtime. The owner added a dedicated `N8N_API_KEY` in ignored `.env.local`; its shape/expiry checks pass and no secret was printed.
- Public API preflight is blocked before authentication: workflow/users/tags reads all return HTTP 400 `Invalid URL`, including a no-key request, while docs/OpenAPI/health/settings endpoints return 200. No workflow backup file was created and no PUT/activate/publish occurred. This is an external hosted-n8n/API-validator issue, not a repository bug.
- Latest test command/result: `N8N_REPORT_IMAGE_QUEUE_OK`, `LOCAL_N8N_SUPABASE_RUNTIME_OK`, LAN syntax, app TypeScript and standalone API TypeScript all Passed after adding actionable 403 guidance.
- Latest local runtime: restarted after the 403 diagnostic change; 5173/5177 listen under PID 18824 and health is 200.
- Exact next step: in the n8n hosting control panel repair the Public API/base URL/reverse-proxy configuration (or upgrade/restart the hosted n8n service) until authenticated `GET /api/v1/workflows?limit=1` returns 200/401 instead of validator HTTP 400 `Invalid URL`. Then GET and back up workflow `mjjUXcsws-DT13Y2wCoqK`, patch only the Sheet mappings, PUT, read back and publish. If the host cannot expose a working Public API, use an actual Codex in-app Browser session; do not extract Simple Browser cookies. GPS testing separately still requires HTTPS. Do not alter BUG-002, BUG-003, or MOD02-TC-DB-01.
- 2026-07-15 intake: active work now also covers MOD-20 performance, MOD-14 registered-hours visibility, attendance XLSX reliability, manager inventory presentation, and a post-finalize native Zalo-share fallback. Source-backed pre-fix regression is `scripts/test-operations-ux-performance.mjs`. Auto-finalization is limited to a scoped request created only after successful Ca 2 handover and must reuse all existing finalization gates; no server scheduler or silent production mutation is assumed.
- 2026-07-15 implementation result: `OPERATIONS_UX_PERFORMANCE_OK`, app TypeScript, report/Zalo/finalization/competition/attendance/realtime/inventory/n8n regressions, LAN syntax and production build pass. Local web/API health were HTTP 200. The earlier instruction to verify three blank meal columns is superseded: an exported August workbook must contain none of those columns. No deployment occurred.
- Urgent sales/report intake: owner reports the deployed end-of-day report differs from employee sales by one bag. Public bundle `index-BFBcAEpk.js` proves the live cap/stale-finalize defects. BUG-021/022 fixes, 11/11 focused checks and the 695-module build pass locally. Production remains unchanged. Exact next action: owner explicitly approves either the broader current build or waits for isolated-source extraction to unblock; after code reaches production, reopen and re-finalize the affected day to replace the already-stale snapshot.
- 2026-07-15 current revenue audit: linked production read-only reconciliation matches the owner's screenshot exactly at 1,332,000đ (Gold Coast 538,000đ, Lotte Vũng Tàu 451,000đ, Lotte 23/10 343,000đ). Receipt headers equal item lines and every duplicate/zero/empty/price/allocation mismatch check is zero. The amount increased by 122,000đ from the earlier 1,210,000đ audit because later receipts added 89,000đ at Lotte 23/10 and 33,000đ at Lotte Vũng Tàu. Do not change the revenue formula: no application calculation bug is confirmed. If operations expects another total, compare against missing physical/transfer sales or seller selection. Gold Coast's six receipts/538,000đ are all attributed to Nguyễn Trần Nhật An although seven people checked in; this is attribution evidence, not proof that another employee omitted a sale.
- Payment-method limitation: `SalesPage.tsx` currently saves every receipt with `paymentMethod: 'cash'`; production confirms all 22 receipts are classified as cash. Total revenue is unaffected, but cash-versus-QR reconciliation cannot identify missing entries. Treat any change as Needs Business Confirmation; no implementation or production write was authorized by this diagnosis.
# 2026-07-18 — Admin CRM employee/branch batch

- Latest batch adds an actionable Overview command center and six branch-detail tabs. Accounts-focused data needs/realtime now also include movements and supply requests so branch Inventory/Orders tabs are connected. Regressions and build pass (`index-CwZk8AAJ.js`); no deploy.
- Latest follow-up fixes the screenshot-reported attendance action overflow, exposes arbitrary date ranges in Accounts/branch profiles and adds role/work-group employee filters. Focused tests and build pass (`index-iLPPovNN.js`). Browser discovery is `[]`; no runtime screenshot claim and no deploy.
- Workspace batch 1 adds five employee tabs, directory search/branch/status filters, attendance history and unresolved seller-receipt visibility. Tests and 700-module build pass (`index-BFm7nBz1.js`); frontend remains local and is not deployed.
- Follow-up fixed the disconnected employee-sales panel: focused Accounts now includes receipt/item/attendance reads and realtime tables. Matching prioritizes seller ID; legacy name fallback is branch-scoped. Removed `CRM VẬN HÀNH`, renamed the panel to `Tình trạng lao động`, and removed its implementation note. Focused regression and TypeScript pass; still not deployed.
- Implemented a consistent CRM directory/detail flow for employees and branches. Branch creation is now next to `Danh bạ chi nhánh`; the old Control Center branch form is no longer rendered.
- Employee detail now persists probation/working/ended status, start/probation-end/end dates and management notes, and shows up to 36 saved payroll rows plus receipt-backed POS sales for the selected range.
- Applied `supabase/migrations/20260718_employee_crm_profile.sql` to the linked database at the owner's direct request. `scripts/db_verify_employee_crm_20260718.sql` ran read-only and confirmed all seven columns and both Admin-guarded security-definer RPCs.
- Focused CRM/account/button/lazy-route tests, LAN syntax, TypeScript and the 700-module production build/bundle guard pass (`index-BAPD9-sF.js`). Do not deploy the CRM frontend without a new explicit request.
# 2026-07-18 — Unified Admin and cashier POS

- Latest verified navigation batch: `AppShell` contains no `mobile-nav`. Desktop/tablet keep the left 252px sidebar (72px collapsed); <=640px uses the same navigation as a hamburger drawer. Active state uses the URL-derived `page/currentSection`. Pastel white/green styling replaces the Admin dark gradient, and former bottom-dock padding is removed. `FIXED_SIDEBAR_NAVIGATION_OK`, CRM/cashier/lazy-route, TypeScript and build Passed (`index-DGbEH-K0.js`). No deploy.
- Latest verified extraction: `src/pages/admin/DashboardPage.tsx` now owns the complete Overview presentation and operational navigation. It uses the existing connected metrics/archive/waste/online-session data and does not render employee, attendance, payroll or inventory lists. CRM/account/cashier regressions, TypeScript and build Passed (`index-dmLPP6yz.js`). No deploy.
- Exact next module: extract Attendance into its own route page while preserving correction/delete/export handlers and authoritative attendance/payroll synchronization.
- Latest prompt-driven correction: all visible Admin module navigation and Dashboard command actions now use the central route map; none directly call `setActiveSection`. Removed the large module hero/demo card. CRM, cashier, lazy-route, TypeScript and build Passed (`index-2wincEeD.js`). No deploy.
- Continue by extracting branch detail, Attendance, Payroll, Inventory, Purchasing, Revenue and Overview bodies into independent route page components. The current `activeSection` conditional renderer remains transitional and must not be described as the finished architecture.
- Latest verified batch: `src/pages/admin/BranchesPage.tsx` is now an independent branch-list page with search, table rows and reusable 10/20/50 record pagination. Rows show connected staffing, receipt count and selected-period revenue and open the existing durable branch detail route. CRM/orphan-account regressions, TypeScript and build Passed (`index-y6uE7hUX.js`). No deploy.
- Exact next architecture step: extract the branch-detail page, then Attendance and the other module bodies one at a time. Router changes modules/pages; pagination only slices list records.
- Most recent verified batch: `src/pages/admin/EmployeesPage.tsx` is an independent employee-list page. It owns text/branch/status/role/employment-type filters and record pagination; employee records are table rows, not cards. Employee and branch directories have separate URLs, and the employee create panel is a responsive drawer. `ADMIN_CRM_DIRECTORY_OK`, `ACCOUNT_ORPHAN_RECOVERY_OK`, TypeScript and build Passed (`index-Bnx5M9Nd.js`). No deploy.
- Architecture correction: central route map now exposes `#/admin/...` module URLs; reusable real pagination is applied to employee records. Build passes (`index-BkuuYrOs.js`). Continue by extracting each remaining section from the 4,789-line `AdminPage.tsx` into independent `pages/admin/*Page.tsx`; do not call wrappers around the same monolith a completed refactor.
- Latest local pass replaces Admin state-only tabs with durable client-side routes for every Management section and employee/branch subpage. Back/Forward, refresh and deep links are supported. Build passes (`index-Duz4oJR4.js`); no deploy.
- Latest local pass adds a unified CUKCUK-inspired (not copied) Admin/POS desktop/mobile theme and fixes the all-datasets-on-every-section performance defect. Focused regressions, TypeScript and build pass (`index-DyJT4f_5.js`). In-app Browser remains unavailable, so signed-in visual verification is still required before release.
- Visible manager/admin navigation now points to one `ManagementPage` workspace; legacy ManagerDashboard/focused entries are removed from the menu and management defaults to Overview.
- Added `cashier` end-to-end in local frontend, LAN validation and `manage-employee`. Cashier is POS-only, branch-required and defaults to Sales.
- POS supports cash/QR/card, customer paid/change and 80mm printing. Cloud checkout now calls `create_cashier_pos_receipt` so header/items/code allocation commit atomically.
- Applied `20260718_cashier_pos.sql` to linked production. Read-only verification confirms enum value, two receipt columns, security-definer RPC and authenticated execute.
- Focused regressions and build pass (`index-CNyUR4hZ.js`). Frontend and `manage-employee` Edge Function remain local/not deployed, so production Admin cannot create cashier accounts until an explicitly authorized release.
- 2026-07-18 active local UI state: Admin now uses a fixed Odoo-style ERP desktop shell (252px named sidebar, flat header, dense workspace) with no collapse/icon-only mode and no brand-to-launcher navigation. Employee and branch lists use the shared `ErpListToolbar` with Create/Import/Export/Search/Filter/Group/Favorites, compact tables and pagination; global management surfaces use Inter, flat 3–4px corners and Gustino `#89A96B`. Focused UI plus revenue/POS/account/lazy-route regressions, TypeScript, diff check and production build passed (`index-DuSs8G3_.js`, 129 modules, bundle guard passed). Browser discovery is `[]`; visual QA and deployment are pending. Do not claim production release.
# 2026-07-19 — Urgent shift photo/report identity batch

- Final duplicate-control cleanup is live on `dpl_556zKbGBuvzHDy6196fUqUm2crsr`: Today has one canonical two-button capture group; repeated opening/closing cards are removed. Progress entries scroll to the canonical group. Live asset/index/server-time verification passes.

# 2026-07-19 — Safe Admin branch removal

- Production deployment `dpl_7fZxGocckSg8iLGvf6NwsEqowRN3` is Ready/aliased. Live Admin asset contains the safe removal markers and no hard-delete action call; index/server-time return 200.
- Admin branch list now has a per-row `Xóa` action that deactivates the branch via `syncConfiguredBranchRows`; historical business data and employee accounts are retained.
- The old `hardDeleteConfiguredBranch` cascade remains unexposed and is not called by Admin CRM.
- `ADMIN_BRANCH_SAFE_REMOVE_OK`, Admin CRM/ERP/role regressions and TypeScript pass. Next: guarded production build, deploy, and live marker verification.
- Corrective production release: `dpl_BN4TSdecYAnnETULmjRVJajydjXU` supersedes the first release and is Ready/aliased. Photo buttons now remain visible after day close, open the picker directly, and target the open or latest own closed session; the photo action no longer navigates to Attendance. Live Today asset and server-time checks pass.
- Production release: `dpl_2gw7Z2QR9QcHXcuKZ4VGBN1wzyAA` is Ready and aliased to `https://gustino-operations.vercel.app`. Live index/assets and `/api/server-time` return 200; exact Today/Report feature markers are present.
- Active modules: MOD-08 shift handover photo capture and MOD-13 end-of-shift report.
- Completed: Today hero now exposes polished compact `Chụp hình đầu ca` and `Chụp hình cuối ca` actions; they reuse the existing photo conversion/upload/save path and become `Đổi hình` after success.
- Completed: report Ca 1/Ca 2 names are resolved separately from overlapping leader attendance, with stored session name as fallback. This targets the reported Lotte Vũng Tàu duplicate name without mutating attendance/session/history.
- Verification: `node scripts/test-shift-photo-actions-and-leader-names.mjs`, daily-report attendance, toolbar, sales/report, mobile-overflow and handover-access regressions passed; `npx.cmd tsc --noEmit` passed; `npm.cmd run build` passed with 706 modules and `PRODUCTION_SUPABASE_BUNDLE_OK`.
- Changed in this batch: `src/pages/TodayPage.tsx`, `src/pages/ReportPage.tsx`, `src/styles.css`, `scripts/test-shift-photo-actions-and-leader-names.mjs`, and testing trackers.
- No migration, webhook, cron invocation, or production business-data write occurred. Next action: signed-in mobile visual check and Lotte Vũng Tàu live report verification.

# 2026-07-20 — Competition drill-down and feature backlog

- Admin KPI ranking rows now expose a read-only `Xem nguồn doanh thu` drill-down for daily/monthly employees and monthly shift leaders.
- Employee sources reconcile the unchanged ranking formula: settled bag allocations plus only receipt lines without `allocationId`; linked POS lines are intentionally excluded to prevent double counting. Shift-leader sources reuse the same branch/date/time session windows as `buildShiftLeaderRevenueRows`.
- Detail shows period, source count, source total, quantity, product summary, payment method/shift metadata and a visible mismatch warning. Ranking order, KPI targets, reward formulas and write paths are unchanged.
- `COMPETITION_DRILLDOWN_OK`, business competition, KPI clarity, deploy-polish, daily/realtime, owner UX and core business-control regressions Passed. Final button audit Passed with 218 total/212 reachable controls. Production build Passed with 707 modules and `PRODUCTION_SUPABASE_BUNDLE_OK (index-BPckEfcB.js; revenue-D6jPsPNy.js)`.
- Expanded recommendations are in `docs/testing/FEATURE_RECOMMENDATIONS_2026-07-20.md`: 3-level reconciliation, KPI dispute workflow, locked periods, fair comparison filters, unattributed-source detection, audit exports and separate campaigns.
- Required Browser connection/troubleshooting completed but discovery returned `[]`; signed-in click, long-name and 360/390/768 px visual checks remain pending. No deploy, database/schema change or external write occurred.

# 2026-07-20 — Fair competition filters and attendance reliability

- Current source was re-audited directly. Employee competition `shiftCount` now means actual ca có check-in, matching the existing management definition of worked shifts; it no longer counts an approved schedule when the employee was absent. Overnight records stay assigned to the registration work date.
- Role, minimum/maximum checked-in shifts and weekday/weekend filters apply before Top 10. Monthly day-type selection filters revenue, actual attendance and KPI target dates together. Leader mode keeps actual operating-session count and labels it separately from employee check-ins.
- BUG-095 is fixed locally: LAN HTTP failures retain status for retry, LAN selfie upload retries once, checkout performs final read-back after lost responses, and LAN reverse geocoding races both existing providers instead of serially exceeding the client deadline.
- New verification: `COMPETITION_FAIRNESS_FILTERS_OK`, `ATTENDANCE_INTERMITTENT_RECOVERY_OK`, and `LAN_ATTENDANCE_API_INTEGRATION_OK`. Eight prior attendance/competition regressions also pass. TypeScript and the 709-module production build pass with `PRODUCTION_SUPABASE_BUNDLE_OK (index-D12xayqv.js; revenue-D2wMVpo_.js)`.
- No business formula, KPI threshold, role permission, GPS/selfie/address requirement, schema, production data or deployment changed. In-app Browser remained unavailable (`[]`), so a signed-in physical-phone camera/GPS check is the only remaining verification for the intermittent attendance report.
# 2026-07-20 — Urgent live report/handover/realtime/account incident

- Owner reports: Ca 2 shows Ca 1 leader / cannot export due to missing shift / missing handover action; 23/10 revenue is not realtime; employee removal causes white frozen Admin; Vũng Tàu appears to use an older flow while n8n report delivery should start after shift close.
- Linked production read-only evidence: 23/10 has Ca 1 leader Nguyễn Thị Yến and Ca 2 leader Nguyễn Bình Thảo Nguyên, both closed. Its one snapshot was written immediately after Ca 2 at 554,000đ/10 sold, records an unrelated legacy summary leader, contains only the Ca 2 entry, and the operation day is open. Nine POS receipts at/before snapshot equal 554,000đ; 25 later receipts add 1,244,000đ, so current true POS total is 1,798,000đ/35 sold. Vũng Tàu Ca 2 is closed at 21:44 local but no Ca 2/day snapshot exists.
- Root source findings: Report owner matching falls back to display name even for persisted `leader_id`, and prefers a closed shift rather than the latest own sequence; Handover renders any branch's open session as if it were the current leader's; it writes `gustino:handover-report` but Report never consumes it. Revenue hides all POS rows once any numeric snapshot exists. Normal cloud employee removal incorrectly selects the destructive `hard_delete` Edge action rather than the built-in deactivation action, then removes the active detail from React state.
- No production row/migration/write/n8n delivery was performed. Next: implement canonical owner/session matching, post-handover automatic finalization intent, correct Ca 1/Ca 2 n8n scopes, receipt-after-snapshot realtime overlay, and safe employee deactivation/detail routing; run focused regressions/build/production bundle guard; deploy only the verified frontend/Edge payload. Any repair of today's already-stale snapshot needs an explicit, reviewed production data action after the hotfix.
# 2026-08-25 — Active incident: attendance Storage quota

- User requested fixing the HTTP 402 login outage and deleting July attendance images without affecting August attendance.
- Confirmed production Supabase project `smtaiourlpqwmiulxuri` is restricted for `exceed_storage_size_quota`; this blocks Auth before credentials can be evaluated.
- Added `scripts/cleanup-attendance-selfies-month.mjs`. It is dry-run by default and requires `--execute`; target month is calculated in UTC+7, all non-target references are protected, only `attendance-selfies` objects are candidates, attendance rows are never updated/deleted, and post-delete verification compares the full protected object set.
- Latest verification: `ATTENDANCE_STORAGE_CLEANUP_SAFETY_OK`, cleanup script syntax, and diff check passed.
- Current blocker: no `SUPABASE_ACCESS_TOKEN`/service-role credential is available and the in-app Browser reports unavailable. CLI project linking metadata alone cannot retrieve API keys. No Storage or business-data mutation occurred.
- Exact next action: owner runs `npx supabase login` locally or connects a signed-in Supabase Dashboard tab. Then run `node scripts/cleanup-attendance-selfies-month.mjs 2026-07`, review the counts/bytes, rerun with `--execute`, confirm `protectedRemoved: 0`, and verify Auth health/login recovery. Do not delete or alter attendance rows; do not touch any August-referenced path.
# 2026-09-10 — Active: Admin Phiếu lương

- Active module: MOD-07 Payroll/KPI. Requested UI: Admin-only `Phiếu lương` below `Báo cáo`, branch-grouped employee list, `Xem chi tiết`, and ten named payroll values.
- Baseline evidence: payroll tables/config and attendance/KPI sources exist, but current source has no payroll page or route renderer. `src/lib/payroll.ts` was deleted in prior repository history.
- Last command: `node scripts/test-admin-payslip-contract.mjs` — expected red, failed because `src/pages/PayrollPage.tsx` does not exist.
- Existing modified attendance/KPI files are user-owned and must be preserved. Next exact action: add an isolated payroll data/page module, Admin route/menu guard, additive migration, then execute focused test, TypeScript, build and relevant role regression.
# 2026-09-10 — Admin Phiếu lương implementation verified by contract/typecheck

- Changed: `src/pages/PayrollPage.tsx`, `src/lib/payroll.ts`, `src/App.tsx`, `src/components/AppShell.tsx`, `src/styles.css`, `supabase/migrations/20260910_admin_payslips.sql`, and focused contract `scripts/test-admin-payslip-contract.mjs`.
- Focused contract and TypeScript pass. The additive migration remains unapplied; no Supabase/business-data/deployment write occurred.
- Next exact action: run role/navigation regressions and production build, then Browser-skill verification if an in-app session is available. Fix only implementation defects and preserve existing payroll/KPI formulas.
# 2026-09-10 — Regression note

- `test-fixed-sidebar-navigation.mjs` is stale against the pre-existing `Thi đua nhân viên` sidebar label (expects `KPI nhân viên`) and failed before evaluating the new feature. Do not rename the user-owned current label merely to satisfy this test. Remaining regressions/build must run separately.
# 2026-09-10 — Regression/build status

- Button contract passed and includes all four new PayrollPage controls as reachable. Two legacy scripts are stale against existing SUP MT/sidebar/KPI source and remain unrelated failures.
- Production build reached Vite after CSS + TypeScript, then sandbox denied esbuild access while resolving `vite.config.ts`; rerun with elevated sandbox permission. No production write occurred.
# 2026-09-10 — Admin Phiếu lương final local handoff

- Final results: `ADMIN_PAYSLIP_CONTRACT_OK`; TypeScript passed; UI button contract passed; final 730-module production build passed with lazy asset `PayrollPage-D0DOYXG5.js` and bundle guard `index-FrLs9b42.js` / `revenue-B-HgIwpX.js`.
- In-app Browser is unavailable in this session, so no signed-in visual claim. Additive migration `20260910_admin_payslips.sql` is created but unapplied; the page can read legacy payroll rows before migration, while saving the new monthly fields correctly reports that migration is required.
- Existing unrelated worktree changes and stale sidebar/SUP MT/KPI regressions were preserved. No deploy, migration application, or production-data write occurred.
- Exact next action for release: review/apply the single payroll migration, deploy the verified frontend, then sign in as Admin to check desktop/mobile list, branch filter, detail modal, and one isolated save/read-back; verify a manager/non-Admin is redirected and cannot read/write payroll tables.
# 2026-09-10 — Active: payslip batch delivery and employee notification

- Requested extension preserves all existing payslip fields and adds checkbox selection, selected count, clear/select-all-list, batch send, notification badge/dropdown, and an own-payslip employee route.
- Red test `test-payslip-delivery-notifications.mjs` currently fails because `MyPayslipsPage.tsx` is absent. Next: extend the unapplied payslip migration/data adapter, implement Admin selection/publish, AppShell notification, and own-payslip page; then run focused/security/build checks.
# 2026-09-10 — Payslip delivery implementation verified

- Implemented Admin selection/search/batch-send, employee unread notification, exact clicked-period navigation, and own-payslip detail. Existing ten fields and salary/KPI/attendance calculations are unchanged.
- Security: employee RLS is published-own-row SELECT only; viewed acknowledgement goes through a self-ownership RPC. Notification refreshes by realtime and a bounded 30-second fallback.
- Focused delivery + original payslip contracts and TypeScript pass. Next: button/authorization regression, final build, Browser check if available, and final tracker update. Migration remains unapplied; no real notification or payroll row was sent.
# 2026-09-10 — Payslip delivery regression status

- Focused delivery/original feature contracts, 24-route static authorization matrix, 290-control button audit, TypeScript and diff check all pass. Permission matrix now explicitly models Admin-only send and staff/shift-leader/cashier own-published read.
- Next exact action: production build and in-app Browser attempt, then record final local handoff. Migration remains unapplied and no employee has actually been notified.
# 2026-09-10 — Payslip batch delivery final local handoff

- Complete locally: Admin search + row/branch checkboxes, selected count, clear/select-all-list, batch `Gửi phiếu lương`; employee bell badge/dropdown with exact-month click-through; own published payslip list/detail; realtime plus 30-second notification reconciliation.
- Security remains two-layered: Admin-only publication, own-published SELECT RLS, and narrow `mark_own_payslip_viewed` RPC with no employee UPDATE policy over payroll values.
- Passed: both payslip contracts, 24-route static authorization, 290-control button audit, TypeScript/diff check, and final 731-module build (`PayrollPage-PJR8-gg1.js`, `MyPayslipsPage-B6czi-Fx.js`, bundle guard `index-D93VeaK7.js` / `revenue-Bj_DXLf6.js`).
- Browser is unavailable, so signed-in visual QA is pending. Migration `20260910_admin_payslips.sql` remains unapplied; no real publish/notification, Supabase row, deployment, or production mutation occurred.
- Next exact action for release: review/apply only the payslip migration, deploy the verified frontend, publish one isolated QA employee's payslip, verify unread badge → exact month → viewed state, then verify a second employee and non-Admin cannot read that row.

# 2026-09-10 — Payslip checkbox frame fix

- Removed the unwanted tall inherited input frame around payroll row/select-all checkboxes while retaining the compact green square checkbox.
- Focused contract, TypeScript, and diff check pass. Next: run the final production build and attempt Browser-skill visual verification if the in-app Browser is available.
- Final production build passed (731 modules; `PayrollPage-CyjjeFV-.js`; `PRODUCTION_SUPABASE_BUNDLE_OK`). The Browser attempt returned unavailable, so signed-in visual QA remains pending.

# 2026-09-12 — Admin payslip correction actions

- User authorized adding revoke/delete for incorrect payslips. Revoke clears publication/viewed metadata and retains salary fields; delete targets one saved payroll entry by ID only. Existing Admin RLS already permits both; no migration or permission change needed.
- Detail actions require confirmation, block concurrent save/send/removal, and update local state only after successful database read-back. Save now retains the returned ID/publication state so freshly saved payslips can be removed.
- Employee detail reconciles every 30 seconds and on focus/visibility, removing revoked/deleted entries; salary, attendance and KPI formulas remain unchanged.
- Validation pending. No production writes, deployment or staging performed.

- Final 2026-09-12 validation: revoke/delete adapter test, original Admin/delivery/timesheet contracts, 144 browser route/role checks, TypeScript and diff check passed. Elevated production build passed: 731 modules; PayrollPage-SClmdik0.js, MyPayslipsPage-DwjOvR4b.js; PRODUCTION_SUPABASE_BUNDLE_OK (index-BHF5XFw3.js).
- Next: apply the previously unapplied payslip migration and release frontend under deployment authorization, then use an isolated employee to verify cancel/revoke/re-publish/delete and cross-employee RLS. No production writes/deploy or git add/commit performed in this change.

# 2026-09-12 — Mobile notification header fix

- User screenshot confirms bell stacked above avatar, clipped outside the header. Source evidence: mobile .mh-right had no horizontal layout after the notification wrapper was added before the avatar.
- Targeted CSS fix: align the two children with flex/gap, constrain mobile bell border-box height to 38px, and bound dropdown vertical scrolling. No notification/payroll logic changes.
- In-app Browser connection attempted via skill runtime; returned Browser is not available: iab. Signed-in phone visual QA remains pending. Next: delivery contract, CSS verification and build.

- Final mobile bell fix validation: delivery contract and diff check pass; full build passes with 731 modules and PRODUCTION_SUPABASE_BUNDLE_OK (index-DT2lO329.js; CSS index-CwcPhpAc.css). In-app Browser unavailable; phone visual QA remains pending. No deploy, git add or production mutation.

# 2026-09-12 — Login password visibility label wrapping

- Screenshot confirms 'Hiện mật khẩu' wraps into two lines. Existing flex label uses width:fit-content and has no nowrap rule.
- Minimal CSS fix scopes the label to .login-card, gives it full available width and white-space:nowrap; checkbox behavior and authentication logic unchanged. Existing user changes to LoginPage.tsx preserved.
- Source verification and diff check pending; in-app Browser was unavailable in the preceding connection attempt, so physical phone visual verification is pending. No deploy/staging.

- Final password-label result: PostCSS syntax/layout checks and diff check passed. Next: phone check after frontend release; no deploy or staging performed.

# 2026-09-12 — Payslip save feedback visibility

- Active MOD-07: move save success/error into dialog footer so user sees result while detail stays open; reset stale messages and retain actual database error message. Targeted validation pending; no deploy/database writes.

- Final save-feedback fix validation: Admin footer contract, delivery and revoke/delete tests pass; full TypeScript/Vite build passes (731 modules, PayrollPage-BCpA7SYC.js, PRODUCTION_SUPABASE_BUNDLE_OK index-CRudRnMT.js). No deploy/database write. Next: authorized frontend release and signed-in success/failure visual verification.

# 2026-09-12 — Employee payslip confirmation

- User authorizes removing privacy helper sentence and adding employee confirmation button at end of payslip.
- Implemented separate employee_confirmed_at metadata via ownership/publication-version guarded confirm_own_payslip RPC; no broad employee UPDATE permission. Confirmation is idempotent and timestamp returned by database. Re-publish/revoke clear confirmation for the new publication.
- Added standalone migration 20260912120000_employee_payslip_confirmation.sql; requires original payslip publication migration. Existing salary/attendance/history values are untouched by migration. Migration not applied: CLI previously returned project privilege 403.
- UI shows confirmation/error at end, prevents repeat clicks, and displays confirmed timestamp on reload. Next: adapter/contracts/build validation; no deploy or database writes.

- Final employee confirmation validation: adapter + UI/SQL contracts + existing Admin/delivery/revoke tests passed; TypeScript/full build passed (731 modules, MyPayslipsPage-Du89gPAd.js, PRODUCTION_SUPABASE_BUNDLE_OK index-CB0IsErE.js). Migration 20260912120000_employee_payslip_confirmation.sql created but not applied. No deployment/data write. Next: apply confirmation migration after base payslip schema, release frontend, verify own/other employee and stale/revoked publication RPC behavior in isolated QA.

# 2026-09-12 — Unread notification cleanup

- User authorizes removing viewed payslips from badge and dropdown. Original payslip list retains published slips for reopening. Added standalone viewed-RPC installer for column-only database setup; no migration application or deploy.
- Adapter/notification regressions and full build pending. Database missing-RPC diagnosis remains unconfirmed until owner response; source dropdown/swallowed-error defects confirmed.

- Final unread-cleanup validation: original Admin/delivery plus confirmation/revoke/delete/viewed adapter and unread contracts pass; full TypeScript/Vite build passes (731 modules, MyPayslipsPage-BQ4Ngr8X.js, PRODUCTION_SUPABASE_BUNDLE_OK index-DARv_Tm-.js). Installer SQL created, unapplied; no deploy/database mutation. Next: owner applies viewed-RPC SQL, authorized frontend release, signed-in badge/dropdown verification.

# 2026-09-12 — Employee salary menu

- Direct request: add Lương immediately below Chấm công in employee navigation, independently of bell.
- Added my-payslips menu entry for existing authorized staff/shift_leader/cashier roles. Shared sidebar renders it for desktop/mobile; opens existing monthly published-own payslip list/detail with confirmation. No permission/schema/payroll changes.
- Passed navigation placement/role contract, original Admin/delivery and confirmation/viewed/revoke/delete adapter regressions; diff check passed. Build pending; no deploy/database action.

- Final Lương menu validation: contracts/adapters and full TypeScript/Vite build passed (731 modules; PRODUCTION_SUPABASE_BUNDLE_OK index-32K9Hul7.js). No database/schema/deploy/git staging action. Next: authorized frontend release and signed-in employee monthly-menu verification.

# 2026-09-12 — Employee payslip month filter

- User requests explicit month filtering in Lương. Added month input and Tất cả tháng reset, shared responsive filter styling, scoped list/detail to the chosen month and period-specific empty state.
- Notification initial navigation sets the requested filter month; viewed acknowledgement only runs for the displayed filtered slip. Refresh retains chosen month. No salary/data/schema/access changes.
- Passed monthly/navigation/delivery/confirmation/unread contracts, Admin and adapter regressions; diff check passed. Full build pending. No production action.

- Final employee month-filter validation: monthly/navigation/Admin/delivery/unread/confirmation contracts and adapters pass; full TypeScript/Vite build and production bundle guard pass (731 modules; MyPayslipsPage-DZlpCHr6.js; index-CpCNCfAc.js). No deploy/database/staging action. Next: authorized frontend release and signed-in month filter/empty/reset/notification checks.

# 2026-09-12 — Visible employee month filter value

- User reports month input blank until interaction. Source initializes period='' for all months; native month input has no visible all-month label.
- Replaced native month input with select showing explicit Tất cả tháng / Tháng MM/YYYY. Options include recent 24 calendar months and all fetched slip periods; existing filter/reset/notification behavior retained. No data/access/schema changes.
- Delivery/month/nav and original Admin contracts plus diff check pass. Build pending; phone visual verification pending; no deploy.

- Final visible month selector build/typecheck passed: 731 modules; PRODUCTION_SUPABASE_BUNDLE_OK index-aaurvF9B.js. Existing contracts and diff check passed. No deploy/schema/data mutation. Next: release frontend under authorization and verify selector visible before focus on phone.

# 2026-09-12 — Admin/employee messaging implementation

- User authorizes Admin messaging every employee, employee messaging Admin only. Implemented Messages route/menu for all current roles, restricted contacts RPC, private history with older-page cursor, text compose, Admin broadcast with confirmation, realtime + 10-second page polling and read acknowledgement.
- New SQL 20260912140000_admin_employee_messages.sql creates a separate message table/RLS and narrow RPCs. Sender comes from auth.uid; inactive/self/employee-to-employee/Admin-to-Admin recipients rejected; only participants SELECT, no client INSERT/UPDATE/DELETE grants. No existing business rows modified.
- Frontend LAN explicitly reports unsupported instead of pretending cloud messages are saved. Migration unapplied; previous CLI project access was 403. No deployment/data action.
- Next: typecheck, targeted messaging adapter/security regressions, existing payroll/nav regressions and production build. Signed-in DB/UI/multi-account integration requires owner-applied SQL and authorized release.

- Messaging database security integration passed on fresh isolated PostgreSQL; temporary database stopped. Source button contract passed (MessagesPage four reachable controls). Full final build pending; no production apply/deploy.

- Final MOD-21 local validation: MESSAGING_ADAPTER_OK; MESSAGING_POSTGRES_SECURITY_OK (fresh isolated PostgreSQL actual RLS/RPC/grants/broadcast/history); existing payroll regressions; UI_BUTTON_CONTRACT_OK; TypeScript and final 733-module production build pass (PRODUCTION_SUPABASE_BUNDLE_OK index-BXrkQCvW.js).
- Temporary PostgreSQL test clusters are stopped. No Supabase SQL application, deploy or business-data writes. New messaging SQL file requires installation; previously linked CLI privilege 403 remains the release access limitation.
- Exact next action: owner applies only 20260912140000_admin_employee_messages.sql, release verified frontend under deployment authorization, then signed-in Admin+two employees verify private bidirectional chat, broadcast and realtime/mobile. Do not bulk replay migration history.

# 2026-09-12 — Employee messaging header shortcut

- User requests message icon beside bell instead of employee sidebar. Removed messages entries from non-Admin menus, retained Admin sidebar and added non-Admin shortcut immediately before bell in desktop/mobile headers. Shortcut closes menus and opens existing messages route; title and accessible active state retained.
- Shared compact 38px flex sizing preserves one-row mobile actions; no API/database/message permission changes.
- Adapter/header shortcut, payslip/navigation and button contracts plus diff check passed. Build pending; no deployment/data action.

- Final employee message-shortcut validation: adapter/header/nav/button tests and TypeScript/full 733-module build pass; PRODUCTION_SUPABASE_BUNDLE_OK index-qvYGyilw.js. No SQL/schema/service changes, deployment or staging. Next: authorized frontend release and signed-in phone icon/bell/avatar alignment and message navigation verification.

# 2026-09-12 — Admin inbox preview/latest ordering

- User reports new employee messages do not move conversation up and rows show only role. Replaced contacts read with read-only messaging_inbox summary: latest message/time/sender + recipient unread count, ordered by latest timestamp/ID.
- UI renders preview, Bạn prefix for own last message, time and unread badge. Inbox refreshes realtime, 10-second fallback, on visibility/send/read and coalesces pending refreshes without changing selected thread.
- New 20260912150000_messaging_inbox_preview.sql adds read-only RPC using existing contact restriction + message RLS; no existing data writes or permission expansion. Unapplied; no deploy.
- Adapter/UI contracts pass; DB integration and final build pending.

- Final inbox-preview validation: adapter/header/payslip contracts + actual isolated PostgreSQL original/new security/order/preview/unread/history tests pass; TypeScript/full 733-module build passes (MessagesPage-CdXZOBBm.js; PRODUCTION_SUPABASE_BUNDLE_OK index-CCPVOh-K.js). Temporary database stopped. No Supabase apply/deploy/staging. Exact next action: owner applies only 20260912150000_messaging_inbox_preview.sql after original message schema, release verified frontend, signed-in Admin receives new peer message and verifies preview/order/unread without losing selected thread.


## 2026-09-12 - Supabase egress review only

- Source inventory completed; see SUPABASE_EGRESS_REVIEW_2026-09-12.md. User requested review before changes; no app/SQL/config/deploy edits.
- Source-confirmed excess refresh: Admin per-event whole-section, Report per-event whole-ledger, Today new sessions array triggers full snapshot history. Attendance branches/employees reads fan out. No fixed 2-3-second cloud timer or proven infinite effect loop found.
- Static review only; no runtime egress/regression/production tests claimed. Preserve full stock/revenue/payroll inputs.
- Next: user reviews diff fragments, then implement approved minimal changes and run targeted regression/request-count and byte measurements in isolation.


## 2026-09-12 - Egress fix 1

- Today operations polling changed from unconditional visible 8s to visible 60s only while Realtime is not SUBSCRIBED. LAN has no socket and retains fallback. Rejoin/focus/online reconciliation retained. Validation pending; next Kitchen active/history split. No production writes.


## Egress fixes 1-2 validation
- Kitchen activeOnly server filter pending+acknowledged; history query gated by explicit open control; status mutation removes terminal rows from active. Targeted kitchen/delivery results recorded in command output. Today legacy realtime-reminders static test fails because it demands continuous polling, contrary to direct user request; do not restore polling to satisfy it. Behavior test pending. Next semantic Today snapshot dependency.


## Egress fix 3
- Today snapshot dependency is a sorted serialized session-content key, so identical refreshed arrays do not refetch. Snapshot query scoped to viewed day; direct report Realtime/focus/rejoin reconciliation preserves independent report changes. Validation pending; next Admin debounce.


## Egress fixes 3-4
- Today content-key/day-only snapshots and Admin 400ms debounce implemented. Admin existing single-flight/queued reconciliation preserved; debounce cleanup cancels stale scope work. Focused regression commands executed; next Report payload/fallback handling.


## Egress fix 5
- Report operation-day full payload updates finalized locally; DELETE/incomplete payload falls back to 400ms debounce. Joined/computed ledger callbacks share one 400ms debounced read to preserve receipts items/profile joins and formulas. Cleanup cancels both queues. Regression executed; next branches request context.


## Egress fix 6
- Added per-flow AttendanceReadContext and scoped in-flight branches dedupe; Admin/Attendance/Sales/Report refresh batches and nested schedule-people use shared context. Context lasts one flow; next flow re-reads current branches, no stale TTL. TypeScript passed. Behavior regression executing; final regression/build next.


## Egress validation batch
- SUPABASE_EGRESS_REFRESH_OK: actual effects/adapters under isolated timers/socket/query doubles verify no Today polling while connected, 60s disconnect fallback, hidden suppression, equal session content, history-open gating, server active filter, 400ms Report/Admin burst coalescing and cancellation, direct snapshot/day payload updates, per-flow/new-scope branches reads.
- Kitchen bell/delivery, shift-close-report, Today recovery, competition realtime and sales/report regressions pass; TypeScript passes. Legacy attendance-next-day static regression also failed; baseline comparison running to distinguish pre-existing failures.
- Initial build blocked by sandbox/esbuild parent directory access; elevated local build requested. No production writes/deploy.


## 2026-09-12 - Egress regression evidence
- Actual behavior harness SUPABASE_EGRESS_REFRESH_OK passed after handling absent/partial payloads safely. Report complete snapshots and operation-day payloads now update local state without follow-up reads; joined/DELETE/partial ledger events debounce400ms.
- attendance-realtime-next-day produced identical nine failures on HEAD baseline; unrelated existing failure, not introduced. Legacy realtime-reminders requires literal8000 polling contrary to new authorized behavior; old test preserved and conflict documented in test-cases/MOD-20-supabase-egress-refresh.md.
- No production bytes/UI/multi-device claim. Build in progress. Next final build and diff-check, then deliver savings estimates and limitations.


## 2026-09-12 - Egress fixes final local handoff
- All six authorized changes implemented. Final SUPABASE_EGRESS_REFRESH_OK and diff-check pass; TypeScript and elevated full production build pass (733 modules; PRODUCTION_SUPABASE_BUNDLE_OK index-AqLpUzXF.js). Six relevant existing regressions pass. Legacy continuous-polling contract conflicts with explicit request; attendance-next-day nine failures are identical against HEAD baseline. No test expectations overwritten.
- Changed application files: TodayPage, KitchenPage, AdminPage, ReportPage, AttendancePage, SalesPage, lib/attendance, lib/supplyRequests. Added isolated behavior regression and MOD-20-supabase-egress-refresh.md case/estimate record; tracking updated throughout.
- Expected savings are per-flow request/row estimates, not measured production egress. Kitchen history still loads permitted full scope only while opened (and realtime updates while open); LAN server contract unchanged and active filtering local. No Supabase/schema/deploy/data write occurred.
- Next exact action: authorized frontend release, then signed-in two-device validation and request/byte before-after measurement including socket disconnect/rejoin, history close/open, scope changes, and stock/POS/report/attendance reliability. Existing separate timers outside the six requested targets remain for a later reviewed batch.


## 2026-09-12 - Egress four-item status recheck
- Confirmed current source already contains all four prior fixes: Admin400ms debounce; Report local full snapshot/day updates plus400ms joined/partial/DELETE ledger fallback; Today sorted session-content dependency and exact-day snapshot read; per-flow scoped AttendanceReadContext across Admin/Attendance/Sales/Report and nested schedule helpers. No application edits needed this turn.
- Reran SUPABASE_EGRESS_REFRESH_OK, SHIFT_CLOSE_REPORT_REALTIME_OK, MANAGEMENT_DAILY_COMPETITION_REALTIME_OK and TODAY_SHIFT_OPEN_RECOVERY_OK: all pass. Previous full build passed; no code changed since that build.
- Remaining joined/partial ledger reads intentionally preserve item/profile joins and aggregation correctness; full replacement with payload-only reconstruction is not necessary for requested minimum debounce. No production deploy performed; next review release file scope, build with production public Supabase env and guard, deploy existing Vercel project, validate two-device Realtime and response bytes.

## 2026-09-13 - MOD-06 open attendance support triage
- User reports exact single-open-session rejection from lib/attendance.ts. Source confirms backend constraint rejection; no account/branch/record evidence yet, so no production incident root cause or new confirmed bug claimed.
- Current-day recovery uses Camera máy check-out then Check-out on the open attendance. Prior-day card intentionally has no manual employee checkout; existing auto-close-day cron handles scheduled-end closure, with Admin correction for unresolved attendance.
- No application changes, tests, deployment or production data writes. Asked for employee/branch and visible old-shift state. Next: identify affected attendance and distinguish current-day open session from failed prior-day auto-close before any targeted repair.

## 2026-09-13 - Minh Thien branch-transfer attendance triage
- User identifies Minh Thiện, moved from Gold Coast to 23/10 immediately before check-in rejection. manage-employee update changes profiles/schedule_people branch but does not close or relocate historical attendance/registrations; existing one-open-per-user constraint remains across branches.
- Live open row/date not read in this session; old Gold Coast open attendance is a hypothesis, not a confirmed database finding. Admin source supports all-branch employee attendance browse and audited manual checkout correction.
- Next: Admin select all branches, Minh Thiện, locate missing checkout, preserve actual check-in and enter verified actual checkout with transfer-related reason. If no row found, obtain displayed attendance/history evidence before changing code/data. No application/schema/deployment/data changes.
