# Bug Tracker

## 2026-10-09 — Employee own published payslip hidden by production RLS (closed)
- **Evidence:** Admin saw Đình Phát's published September row; the matching employee auth UID received an empty result with no API error.
- **Fix:** user applied an own-row-and-published-only SELECT policy plus authenticated SELECT grant. No draft or cross-employee read was authorized.
- **Verification:** employee-session read now returns the exact September row, `employeeReadError=null`, with net salary present. Closed in production.

## 2026-10-09 — Viewed payslip notifications disappeared (fixed locally)
- **Evidence:** `AppShell.tsx` rendered `unreadPayslips.slice(0, 6)`, so setting `employeeViewedAt` immediately removed the item from the dropdown. The data adapter sorted by payroll period rather than notification publication time.
- **Fix:** render the full published-notification list, keep the unread badge separate, prioritize unread items and then newer `publishedAt`, show read state, and order the backend query by `published_at` descending.
- **Verification:** updated delivery/notification contract, revoke/delete/viewed/confirmation, Admin payslip/editable regressions, TypeScript and the full 733-module production build/bundle guard pass. Signed-in visual verification remains pending.

## 2026-10-09 — Admin payslip fields locked (fixed locally)
- **Evidence:** `PayrollPage.tsx` applied `readOnly` to salary configuration, attendance overtime and KPI-derived inputs. `saveDetail()` additionally replaced edited overtime/KPI values with prior entry/null values whenever a system source existed.
- **Fix:** retain system-derived values as prefilled suggestions, remove the Admin input locks, label their origin, and persist the exact values shown in all editable fields. Existing formulas and source calculations remain unchanged until Admin explicitly saves an override.
- **Verification:** `ADMIN_PAYSLIP_EDITABLE_OK`, existing Admin payslip/delivery/revoke/confirmation/viewed contracts, TypeScript and the full 733-module production build/bundle guard pass. Signed-in visual/save-readback verification remains pending; no production or database mutation occurred.

## 2026-09-08 — BUG-140 High: đã check-in nhưng lịch Ca trưởng bị nhận nhầm là lịch nhân viên

- Status: **Fixed, pushed in `76c3e5b`, and deployed to Vercel; pending signed-in phone confirmation**.
- User evidence: Trần Minh Lý, Gold Coast Nha Trang, lịch 08/09/2026 07:00–14:30 đã check-in lúc 09:44 nhưng `Thử mở ca lại` trả `Đã nhận check-in nhưng lịch ca trưởng hôm nay chưa được duyệt hoặc không khớp ca vận hành kế tiếp`.
- Root cause: quyền đăng nhập hiện tại là `shift_leader`, nhưng `isLeaderRegistration()` chỉ đọc snapshot `employment_type` trong `shift_registrations`. Snapshot có thể cũ sau khi Admin đổi hồ sơ sang Ca trưởng; `manage-employee` đồng bộ `profiles` và `schedule_people` nhưng không đồng bộ registration đã có. Vì `checkIn()` chỉ loại `rejected`, lượt công vẫn lưu đúng trong khi bộ mở ca loại chính registration đó.
- Fix: chỉ đối với người đang đăng nhập có role `shift_leader`, bộ phân ca chuẩn hóa registration của chính họ thành nhóm `leader` theo quyền xác thực hiện tại. `positionTitle` hiện tại vẫn được giữ nên Ca phó tiếp tục bị loại, và đăng ký của người khác không bị thay đổi. Không sửa database/schema, lịch sử công, sequence hay quy tắc người đứng tên ca.
- Verification: `AUTHENTICATED_SHIFT_LEADER_REGISTRATION_OK`, shift-owner/deputy, auto-second-shift, handover recovery, Today recovery, TypeScript và diff check Passed. Production build 728 modules Passed; `TodayPage-PCnDfdBW.js`, `PRODUCTION_SUPABASE_BUNDLE_OK (index-DakAhWGH.js; revenue-B0oKLhU1.js)`.
- Deployment: live alias now serves the exact production-build assets `index-DakAhWGH.js` and `TodayPage-PCnDfdBW.js`. Infrastructure observation: linked project `ppglstwhnzdgnowhdomm` reports migration-history rows only through 2026-06-24 although the repository contains later migrations. This does not alone prove the live schema is missing because it may have been imported manually; no migration or production data was changed during this fix.

## 2026-09-08 — BUG-139 High: trang Hôm nay kẹt `Chờ mở ca` và che mất lý do

- Status: **Fixed, pushed in `a8930f6`, and verified in the live Vercel bundle**.
- User evidence: Trần Minh Lý tại Gold Coast Nha Trang đã thao tác nhưng trang Hôm nay lúc 11:30 vẫn hiển thị `Chờ mở ca`, `Chưa mở ca`, `0/6 bước`.
- Source reproduction: `App.tsx` attempts `reconcileOperationalShift()` once on effect start and then every 60 seconds, but catches every error silently. If that first attempt runs before check-in finishes syncing or the immediate post-check-in open fails, `TodayPage` only reloads `bag_shift_sessions`; it never invokes reconciliation itself and gives no reason/button while no session exists.
- Realtime assessment: disabling Realtime can delay push updates but is not the root cause. Today already polls sessions every 8 seconds and the background reconciler polls every 60 seconds; neither creates a missing session from the Today page after the race, and the background path hides errors.
- Fix: Today now calls the existing idempotent reconciler on page entry, reads sessions again after the result, shows explicit states for missing server check-in, mismatched/unapproved schedule, deputy ownership, closed/completed day, or server error, and provides `Thử mở ca lại`. Existing leader/schedule/sequence/deputy business gates are unchanged.
- Verification: `TODAY_SHIFT_OPEN_RECOVERY_OK`, `HANDOVER_SHIFT_RECOVERY_OK`, `AUTO_SECOND_SHIFT_START_OK`, TypeScript and diff check Passed. Production build Passed with 728 modules and `PRODUCTION_SUPABASE_BUNDLE_OK (index-BzAp-YdE.js; revenue-DbqIv0vj.js)`; Today asset is `TodayPage-vBr-cZBa.js`.
- Deployment verification: live Vercel serves `TodayPage-vBr-cZBa.js` containing `Thử mở ca lại`; the user's signed-in phone then displayed the new diagnostic state. No production session, attendance, schedule, schema, or data was changed by this deployment.

## 2026-09-08 — BUG-138 High: Admin hiện `b.clone is not a function`

- Status: **Edge Function deployed and verified; frontend defensive fix remains local**.
- Deployment follow-up: repository contained `supabase/functions/manage-employee/index.ts` (24,312 bytes). `.env.local` targeted `ppglstwhnzdgnowhdomm` while CLI metadata still targeted `drmqlbycitdtzvcunlux`; at the user's direct request the workspace was relinked to `ppglstwhnzdgnowhdomm` and only `manage-employee` was deployed. Supabase reports the function `ACTIVE`, version 1, `verify_jwt=true`.
- Non-mutating live verification: CORS preflight from `https://gustino-operations.vercel.app` returned HTTP 200 with `Access-Control-Allow-Origin: *`; an unauthenticated POST returned HTTP 401 `UNAUTHORIZED_NO_AUTH_HEADER` with CORS headers, proving the endpoint and JWT gate are active without reaching a business-data write.
- User evidence: Admin employee detail displayed `b.clone is not a function` while a later employment-status save also displayed its success banner.
- Source/bundle reproduction: `invokeManageEmployee()` and `hardDeleteConfiguredBranch()` treated every Supabase Functions `error.context` as a browser `Response` and unconditionally called `context.clone().json()`. Fetch/network failures instead supply an ordinary `Error` context with no `clone`. The pre-fix bundle contained the exact minified path `b?await b.clone().json()`, matching the screenshot.
- Root cause: this secondary parser exception replaced the actionable Supabase/network error. Employee profile and CRM save handlers also retained the opposite stale banner, allowing an old error and a new success to appear together.
- Fix: `src/lib/functionsError.ts` narrows unknown context safely, preserves HTTP status/JSON messages, and falls back to the underlying error. Account and branch paths use it; employee profile/CRM saves clear stale banners before starting. No status, permission, API, schema, or business rule changed.
- Verification: `FUNCTIONS_ERROR_CONTEXT_OK`, `ACCOUNT_ORPHAN_RECOVERY_OK`, `ADMIN_BRANCH_SAFE_REMOVE_OK`, TypeScript, diff check, and the 728-module production build Passed. Bundle guard: `PRODUCTION_SUPABASE_BUNDLE_OK (index-CXoRf18a.js; revenue-DOQvdNzk.js)`.
- Infrastructure note: legacy `test-admin-crm-directory.mjs` cannot start because it references absent user-worktree file `src/lib/payroll.ts`; no unrelated module was restored.
- Remaining: the user will perform signed-in employee-status confirmation and the read-only SQL check. The frontend defensive parser build was not deployed in this step. No migration or production business-data write was performed by Codex.

## 2026-08-26 — POS mobile chưa tách luồng thao tác theo ba màn hình

### BUG-137 — Menu, giỏ hàng và lịch sử hóa đơn dồn trong một trang dài trên điện thoại

- Severity: Medium. Status: **Đã sửa và kiểm chứng local; chưa deploy**.
- Evidence: `SalesPage` trước fix render menu và aside hóa đơn/lịch sử nối tiếp nhau ở ≤640px; CSS chỉ đổi grid thành một cột. Nhân viên phải cuộn giữa menu, giỏ và lịch sử, không có thanh giỏ cố định, tìm món hay tìm hóa đơn.
- Fix: thêm state ba màn `menu | bill | history` chỉ tác động cách hiển thị mobile; desktop vẫn giữ workspace hai cột. Trang bán hàng có tìm kiếm/lọc thật, menu hai cột và thanh giỏ cố định; mỗi thẻ chỉ còn tên + giá và mỗi lần chạm cộng đúng 1. Hóa đơn mới có khách lẻ, tăng/giảm/xóa món, tổng và nút xác nhận lớn; Lịch sử có tìm kiếm, nhóm ngày, xem/xóa theo quyền và receipt bottom sheet. Hình minh họa, cụm `+1/+2/+3`, dòng “Bán không giới hạn” và các chú thích ngoài ba điện thoại đều không render.
- Business preservation: vẫn gọi nguyên `checkout`, `setLineQuantity`, `handleDeleteReceipt`, `saveSalesReceipt`; không thêm phương thức/ô thu tiền, không đổi giá, seller attribution, quyền xóa, API, schema hoặc dữ liệu.
- Responsive follow-up 2026-08-26: phát hiện rule workspace cũ có specificity cao vẫn ép `.pos-product-grid` thành hai cột ở ≤640px và shell header có thể chồng POS header. Đã thêm phone-layout guard cuối stylesheet, ẩn riêng shell header trong POS, nối nút hamburger POS vào handler menu điều hướng sẵn có, khóa menu một cột, giới hạn mọi panel theo viewport và thêm compact breakpoint ≤380px. Không đổi handler giỏ/hóa đơn.
- Bill-row follow-up 2026-08-26: selector tổng quát `.bill-lines article > span` ghi đè `grid-area` của badge số thứ tự, làm cột `index` bị bỏ trống và nội dung trông như đang chừa chỗ cho ảnh. Đã khóa badge về `index`, bỏ `min-height` danh sách, dùng lưới `index | info | qty | remove` không có cột ảnh; tổng tiền nằm dưới bộ số lượng. Handler không đổi.
- Duplicate-summary follow-up 2026-08-26: global mobile reset đặt `.pos-topbar`/`.pos-summary-strip { display:grid !important }`, ghi đè rule ẩn của view mobile nên ngày/ca và bốn KPI xuất hiện hai lần. Final phone guard nay ẩn trực tiếp hai khối desktop bằng selector theo `mobile-pos-*` + `!important`; chỉ bộ mobile còn hiển thị.
- Menu-toggle follow-up 2026-08-26: hamburger POS gọi toggle menu sẵn có nhưng click gốc tiếp tục bubble lên `AppShell`, kích hoạt handler đóng khi chạm ngoài ngay sau lúc mở. Đã thêm `event.stopPropagation()` tại nút POS trước khi gọi toggle; navigation/permission không đổi.
- Verification: `SALES_MOBILE_THREE_VIEW_OK`, `CASHIER_POS_WORKSPACE_OK`, `CRITICAL_LOAD_FAILURE_VISIBILITY_OK`, `test-stock-and-sync-performance`, TypeScript, diff check và final production build 727 modules Passed; `PRODUCTION_SUPABASE_BUNDLE_OK (index-DwPqCKyr.js; revenue-BTFfGPE7.js)`. `test-core-business-button-guards` còn bốn failure baseline ở Kho/Lương, ngoài file/phạm vi sửa. Browser skill không khởi tạo được kernel assets nên chưa có signed-in screenshot/visual QA.

## 2026-08-25 — Bổ sung công sao chép giờ ca thành giờ check-in/check-out

### BUG-136 — Bổ sung công dùng chung một cặp giờ cho ca đăng ký và chấm công thực tế

- Severity: High. Status: **Đã sửa local; RPC migration đã áp dụng và xác minh trên production 2026-08-25; không deploy frontend trong lượt migration**.
- Evidence/root cause: `AttendanceAdjustmentArchive` chỉ có `supplementStart/supplementEnd`; `createAttendanceSupplement` gửi chúng thành `p_start_time/p_end_time`; RPC `admin_add_attendance_supplement` vừa tìm/tạo `shift_registrations` theo hai giờ đó, vừa chép chính hai giờ vào `attendance_records.check_in_time/check_out_time`. Do đó sau khi Admin xóa bản ghi công và bổ sung lại, giờ ca và giờ chấm công bắt buộc trùng nhau.
- Fix: form tải ca đăng ký của đúng nhân viên + ngày và cho phép chọn ca có sẵn hoặc `Tự nhập ca bổ sung (chưa có đăng ký)`. Nhánh tự nhập có một cặp giờ ca riêng; cả hai nhánh đều bắt buộc nhập thêm check-in/check-out thực tế. RPC không sửa ca có sẵn và chỉ tạo một đăng ký approved khi Admin chủ động chọn tự nhập; không nhánh nào sao chép giờ ca sang giờ công. Giới hạn 18 giờ, check-out tương lai, nhân viên/chi nhánh và bản ghi trùng vẫn được chặn.
- Verification: `ATTENDANCE_SUPPLEMENT_REGISTERED_SHIFT_OK`, `ADMIN_ATTENDANCE_24H_NOTES_OK`, `npx.cmd tsc --noEmit`, và production build 727 modules đều Passed; final bundle guard `PRODUCTION_SUPABASE_BUNDLE_OK (index-MzDDWSPE.js; revenue-DwSHGGED.js)` Passed. Lần build đầu bị sandbox chặn đọc `vite.config.ts`; cùng lệnh chạy ngoài sandbox đạt, nên đây không phải lỗi source.
- Production RPC: chạy trực tiếp duy nhất `20260825_attendance_supplement_uses_registered_shift.sql` qua linked `db query` vì lịch sử local/remote lệch phiên bản nên tuyệt đối không dùng `db push`. Hậu kiểm trả đúng một chữ ký 9 tham số; `security_definer=true`, `authenticated_execute=true`, nhánh ca có sẵn/tự nhập và marker actual-time tách biệt đều `true`. Không có attendance/registration row nào được tạo, sửa hoặc xóa; PostgREST đã nhận `reload schema`. Frontend không được deploy trong lượt này.

## 2026-08-05 — "Dữ liệu kho không đồng bộ sau khi chỉnh sửa"

### BUG-134 — Bản vá BUG-133 chỉ nâng độ chính xác hiển thị ở màn Kho nên mỗi màn đọc ra một con số khác nhau

- Severity: High (chủ quán không tin được số tồn nào là đúng). Status: **Đã sửa và deploy production 2026-08-05** (`dpl_ARZoTemEtDAhnRwJrsirL3SkQnWM`, alias `gustino-operations.vercel.app`, main `index-DtrbyXjx.js`).

**Hiện tượng (chủ quán mô tả):** "dữ liệu kho không đồng bộ sau khi tôi chỉnh sửa" — màn Kho hiện số mới, các màn khác vẫn số cũ.

**Root cause:** không phải lỗi đồng bộ dữ liệu. Mọi màn đều đọc chung một mảng `movements` từ `App.tsx` và chung `calculateStock` — dữ liệu giống hệt nhau, chỉ có CÁCH VIẾT SỐ là khác. BUG-133 thay bộ hiển thị của riêng `InventoryPage` (`formatQuantity` = `String(Number(...))`, 3 chữ số lẻ) mà không đụng tới các màn còn lại, nên cùng một tồn 5,123 kg đọc ra 4 kiểu: Kho `5.123 kg` (dấu CHẤM — tiếng Việt đọc thành "năm nghìn một trăm hai mươi ba"), Quản trị → Kho `5,123 kg` (`Intl` vi-VN, 4 số lẻ cho kg / 2 cho đơn vị khác, dấu nhóm nghìn đổi thành khoảng trắng), Báo cáo + Bàn giao `5,12 kg` / `5,1234` (`toFixed(2)` / `toFixed(4)`), Nhà hàng `5.1 kg` (`toFixed(1)`, lại dấu chấm).

**Bản vá:** một bộ hiển thị dùng chung trong `src/lib/inventoryEntry.ts` — `formatQuantity` chuyển sang `Intl.NumberFormat('vi-VN')` giữ đủ 3 chữ số lẻ như `numeric(14,3)` (`5,123` · `1.234,5` · `5`), `formatStockAmount` giữ nguyên quy tắc dưới 1 kg đọc theo gram. Tách thêm `quantityInputValue` cho số ĐỔ VÀO Ô NHẬP (nút *Xuất hết* / *Đúng tồn*): bản hiển thị không dùng lại được vì `sanitizeQuantityInput` sẽ bóp `"1.234,5"` thành `1,2345` — bẫy này được khoá bằng assert riêng. Các màn chuyển sang gọi bộ dùng chung: `AdminPage` (`formatInventoryQuantity`, kể cả cột số lượng Excel hạ từ 4 xuống đúng 3 số lẻ của DB), `ReportPage`, `ShiftHandoverPage`, `ControlCenterPage` (định mức trừ kho), `admin/DashboardPage` (hao hụt), `RestaurantPage` (cảnh báo tồn thấp). `HistoryPage` vốn đã đúng 3 số lẻ vi-VN nên giữ nguyên; các màn chỉ hiện số túi/đơn/% không đổi.

**Kiểm chứng:** `scripts/test-inventory-display-consistency.mjs` (mới) khoá cách viết số, vòng quay ô nhập cho 5 mức số lượng, và hợp đồng nguồn "mọi màn kho gọi bộ hiển thị dùng chung, không tự `toFixed`". Chạy đỏ với bản cũ (`formatQuantity(5.123)` ra `"5.123"`). `test-inventory-entry-redesign` cập nhật theo hợp đồng mới và Passed; `test-report-inventory-ux`, `test-stock-and-sync-performance`, `test-shift-close-report-realtime` Passed; `tsc -b` + `npm run build` 723 modules + `PRODUCTION_SUPABASE_BUNDLE_OK`.

**Dọn thêm:** `test-owner-ux-inventory-admin-20260720` đang ĐỎ SẴN từ đợt BUG-133 (vẫn đòi nhóm "Món trong menu bán" trên bảng tồn, trong khi bản vá sáng nay đã loại hẳn món menu khỏi `calculateStock` vì POS ghi hóa đơn chứ không ghi movement). Đã sửa assert đó theo hiện trạng đã chốt, không đụng mã nguồn.

### BUG-135 — Phiếu sửa tồn không xuất hiện ở cột nhập/xuất nào nên sổ kho không cân; mốc kiểm kê cuối ca đóng dấu bằng đồng hồ điện thoại

- Severity: High. Status: **Đã sửa và deploy production 2026-08-05** (`dpl_ARZoTemEtDAhnRwJrsirL3SkQnWM`, alias `gustino-operations.vercel.app`). Bốn lỗi tìm ra khi truy vết BUG-134, chủ quán yêu cầu xử lý hết.

**(1) Sổ kho theo kỳ không cân sau khi sửa tồn.** `count` là mốc reset nên có mặt trong tồn đầu/tồn cuối, nhưng không thuộc cột Nhập lẫn cột Xuất ⇒ `Tồn đầu + Nhập − Xuất − Hao ≠ Tồn cuối`. Thêm `stockAdjustmentDeltas` / `sumStockAdjustments` (`lib/store.ts`): độ lệch của mỗi phiếu `count` = số khai − tồn cộng dồn ngay trước phiếu (tính trên TOÀN BỘ lịch sử chi nhánh, lọc theo kỳ bằng `shiftDate` ở phía gọi). `buildInventoryRows` có thêm cột `adjust`; hiện ở thẻ chi nhánh ("Sửa tồn trong kỳ") và sheet Excel "Tổng hợp kho" (cột *Điều chỉnh kiểm kê*).

**(2) Đối soát ca báo lệch POS oan.** `officialOut = opening + additions − closing − waste` bỏ qua `count` nên phần sửa tồn giữa ca bị tính thành hàng bán ra. Công thức đổi thành `opening + additions + adjust − closing − waste`, thêm cột *Sửa tồn* trên màn và trong Excel "Đối chiếu ca". Phiếu kiểm đếm CUỐI ca (`documentId` = id phiên) bị loại khỏi `adjust` — số của nó chính là `closing`, cộng vào là tự triệt tiêu đúng phần lệch mà bảng sinh ra để soi.

**(3) Mốc kiểm kê cuối ca lấy đồng hồ điện thoại.** `ShiftHandoverPage` đóng dấu `createdAt: now + index` rồi gửi kèm `created_at` xuống `closeBagShift`; máy ca trưởng lệch giờ là mốc reset nhảy sai vị trí trên trục thời gian ⇒ tồn tính sai, thậm chí nuốt luôn phiếu sửa tồn ghi sau nó. Bỏ hẳn dấu thời gian phía máy: RPC `close_bag_shift_safe` vốn dùng `coalesce(x.created_at, now())`, còn đường ghi thẳng (`closeBagShiftDirect`) nay bỏ trống trường để DB dùng `default now()` thay vì `endedAt` (cũng là đồng hồ máy).

**(4) `calculateStock` bỏ rơi dòng trùng đúng mốc kiểm kê.** Vòng lặp chia trước/sau bằng `<` và `>`, không có nhánh `===`, nên dòng nào trùng micro-giây với mốc `count` rơi khỏi cả hai vế và biến mất khỏi bảng tồn — trùng dấu thời gian là chuyện thường vì một lệnh INSERT nhiều dòng được Postgres gán `now()` giống hệt nhau (dữ liệu prod có batch 60 dòng `[AUTO-CLOSE]` cùng một dấu). Đổi sang `<=` (coi là TRƯỚC kiểm kê — số đếm thực tế đã bao gồm nó). Tái hiện: phiếu bán 4 kg trùng mốc làm `variance` ra −8 thay vì −4.

**Kiểm chứng:** `scripts/test-stock-adjustment-consistency.mjs` (mới) khoá delta từng phiếu (kể cả hai phiếu kiểm kê liên tiếp), bất biến `Tồn đầu + Nhập − Xuất − Hao + Điều chỉnh = Tồn cuối` (và khẳng định thiếu cột Điều chỉnh thì KHÔNG cân), dòng trùng dấu thời gian, cùng hợp đồng nguồn cho cả 4 điểm. 9/9 test kho/báo cáo/bàn giao Passed; `tsc -b` + `npm run build` + `PRODUCTION_SUPABASE_BUNDLE_OK`. `qa-handover-cross-shift` cần app đang chạy (Playwright) nên không chạy được ở phiên này.

**Không đụng tới:** dữ liệu/schema production, công thức hoa hồng/KPI, phân quyền. Không migration.

**Đã truy đến cùng và KẾT LUẬN KHÔNG PHẢI LỖI:** nghi vấn "`closeBagShift` gọi RPC với `p_movements: []` nên phiếu kiểm đếm cuối ca không được ghi" là báo động nhầm. `close_bag_shift_safe` bản đang chạy (`20260702_close_bag_shift_idempotent.sql`, kế thừa ghi chú tiếng Việt của `20260701_shift_overlap_delta_posting.sql`) **tự sinh phiếu `count` phía máy chủ** từ `closing_balances` + số nhân viên đang giữ, ghi chú `[AUTO-CLOSE] [ca] Kiểm đếm bàn giao: tại quầy X, nhân viên đang giữ Y`, kèm chặn trùng. Xác minh trên DB prod bằng `pg_get_functiondef`: `close_bag_shift_safe` có sinh `[AUTO-CLOSE]`, `reopen_bag_shift` có `delete ... movement_type = 'count'` để hoàn tác. Truyền danh sách rỗng từ client là ĐÚNG — gửi lên chỉ tạo đường ghi thứ hai. Danh sách phía client chỉ còn phục vụ nhánh dự phòng `closeBagShiftDirect` (RPC vắng mặt / LAN), và nhánh đó nay cũng để máy chủ đóng dấu thời gian.

## 2026-08-05 — Kho: xuất hết mãi vẫn dư vài gram, phải xuất nhiều lần

### BUG-133 — Màn kho cắt số lẻ thứ ba nên không bao giờ xuất hết được tồn; không có đường sửa tồn khi sổ sai

- Severity: High (chặn thao tác sửa kho hằng ngày của ca trưởng). Status: **Đã sửa trên nhánh làm việc, ĐÃ build + test đơn vị, CHƯA deploy production.**

**Hiện tượng (chủ quán mô tả):** kho sai số, ca trưởng muốn xuất hết ra để nhập lại nhưng "bị hiển thị thiếu số 0.000 mấy nên phải xuất nhiều lần".

**Root cause (2 tầng, cả hai đều tái hiện được):** (1) `stock_movements.quantity` là `numeric(14,3)` nên tồn có tới 3 chữ số lẻ, trong khi `formatNumber` của `InventoryPage` dùng `toFixed(2)` ⇒ tồn 5.123 kg hiện "5.12 kg"; gõ theo số nhìn thấy thì kho còn dư 0.003 kg, dòng vẫn "còn hàng" (`stockAvailability` lấy mốc 0.0001) nên phải lập phiếu xuất lần nữa, và lần nữa. (2) Không có chức năng đặt lại tồn: cách duy nhất để sửa sổ sai là xuất hết rồi nhập lại — chính là vòng lặp ở (1).

**Bản vá:** tách `src/lib/inventoryEntry.ts` (hàm thuần, test được) làm lớp số học kho — hiển thị đủ 3 chữ số như DB (`formatQuantity`/`formatStockAmount`), mốc "coi như hết" `STOCK_EPSILON = 0.0005` (nửa đơn vị cuối của DB), `planOutbound` tự khớp về đúng tồn khi số gõ chỉ lệch ±0,005 (5 g) ⇒ tồn về 0 tuyệt đối trong MỘT phiếu và không còn bị hỏi "không đủ tồn" chỉ vì gõ thừa vài gram, `planStockReset` ghi movement `count` (mốc reset của `calculateStock`) cho chức năng sửa tồn mới. `InventoryPage` thay 2 trình soạn phiếu kiểu "thêm dòng + chọn dropdown" bằng một bảng nhập theo SKU dùng chung cho Nhập / Xuất / Sửa tồn: có ô tìm kiếm không dấu, lọc nhóm hàng, nút **Xuất hết** (đổ đúng số tồn thật), **Hết sạch/Đúng tồn** ở tab sửa tồn, và nút xuất hết/khai hết hàng loạt cho các dòng đang xem.

**Kiểm chứng:** `scripts/test-inventory-entry-redesign.mjs` (mới) khoá đủ: hiển thị 3 số lẻ, xuất hết một lần là sạch, gõ theo số hiển thị CŨ "5.12" vẫn về 0, thiếu tồn THẬT vẫn cảnh báo, đổi kg/g, quy cách bao 25 kg, sửa tồn ghi `count` đúng số khai và ô trống thì tuyệt đối không đụng tới SKU đó. `tsc -b` + `npm run build` + `PRODUCTION_SUPABASE_BUNDLE_OK`. Kiểm tra giao diện thật bằng Edge headless (chỉ đọc, không lưu phiếu): bấm "Xuất hết" → ô nhập nhận đúng số tồn, dòng báo "Còn lại sau phiếu: 0 kg · Kho về 0"; gõ 59,99 khi tồn 60 kg vẫn báo còn 10 g (chỉ khớp trong mức làm tròn, không nuốt chênh lệch thật); tìm "bao bi" ra đúng 2 SKU; mobile 390px không tràn ngang.

**Đợt 2 cùng ngày — bỏ giao diện thẻ, chuyển sang bảng dày (theo yêu cầu chủ quán "dạng card chiếm chỗ mà không hiệu quả"):** mỗi SKU giờ đúng MỘT dòng ~54px trên desktop (trước ~150px) và ~101px trên điện thoại (trước ~180px) — desktop 10 dòng/màn thay vì 4. Hàng tiêu đề cột (Mặt hàng · Đang có · Số lượng · Kết quả) thay cho nhãn lặp trong từng thẻ; ghi chú dòng ẩn sau nút ✎; hai khối hướng dẫn gộp còn một dòng; ô tìm kiếm + lọc nhóm + ghi chú phiếu nằm chung một hàng. Đầu màn kho cũng ép lại: 4 thẻ chức năng từ `min-height:150px` xuống ~90px, thẻ chi nhánh bớt padding ⇒ toàn bộ chỗ nhập liệu lọt trong màn hình đầu tiên.

**Còn lại:** phiếu sửa tồn ghi `count` nên nó cũng thay mốc kiểm kê gần nhất của SKU đó (đúng bản chất, nhưng cần nói rõ khi hướng dẫn ca trưởng).

## 2026-08-04 — Địa chỉ chấm công "lệch thành phố" + hardening chống treo mạng chậm + dọn giao diện

### BUG-132 — Sáp nhập hành chính 2025 làm bản đồ trả "Thành phố Hồ Chí Minh" cho điểm Vũng Tàu; hai gate mạng-chậm còn khóa/treo màn chấm công; giao diện thừa nút

- Severity: High. Status: **Đã sửa và deploy production 2026-08-04** (alias → `gustino-operations-3j2lwfgzo`, main `index-DLxi15Xk.js`, Attendance `AttendancePage-CurPze7b.js`). Không migration; chủ quán tiếp tục miễn quy trình test.

**Địa chỉ (xác minh bằng tọa độ thật từ bản ghi):** điểm lotte-vt `10.34993,107.09401` — Nominatim và BigDataCloud đều chỉ còn `Phường Tam Thắng / Thành phố Hồ Chí Minh` (Bà Rịa–Vũng Tàu đã nhập vào TP.HCM 2025, dữ liệu bản đồ mất hẳn chữ "Vũng Tàu") ⇒ địa chỉ lưu "…Thi Sách, Phường Tam Thắng, Thành phố Hồ Chí Minh" — đúng tên đường nhưng "lệch thành phố" như chủ quán mô tả. Fix `api/reverse-geocode.ts`: bảng `WARD_LOCALITY` ánh xạ các phường mới của hai đô thị có chi nhánh (Vũng Tàu/Tam Thắng/Rạch Dừa/Phước Thắng/Long Sơn → "Vũng Tàu"; Nha Trang/Bắc/Tây/Nam Nha Trang → "Nha Trang"), chèn địa danh sau phường và bỏ "Thành phố Hồ Chí Minh" thừa khi đã có địa danh (địa chỉ TP.HCM thật không đổi). Verify live: VT → `Lotteria, Thi Sách, Phường Tam Thắng, Vũng Tàu`; 23/10 → `PNJ, 23 Tháng 10, Phường Tây Nha Trang, Nha Trang, Khánh Hòa`. CDN cache cũ tự hết hiệu lực theo deployment mới.

**Chống treo (nghi ngờ "treo web rồi dùng tiếp bị lỗi" — xác nhận đúng, 3 điểm):** (1) sau khi ghi DB thành công, code `await onChanged()` (tải lại toàn bộ) rồi mới báo "thành công" — mạng chậm là nút treo "Đang xử lý" dù đã lưu, bấm tiếp gây lỗi trùng ⇒ đổi thành fire-and-forget, optimistic record đã cập nhật UI ngay; (2) đọc bảng công lỗi/chậm đặt `recordsLoaded=false` → thay cả màn bằng "CHƯA ĐỒNG BỘ… Tuyệt đối chưa check-in" ⇒ bỏ hẳn màn khóa (DB unique một-phiên-mở + read-back idempotent đã chặn trùng tuyệt đối; bấm lại khi đã có bản ghi trả về thành công); (3) `verifyExistingCheckIn`/`verifyCompletedCheckout` không có hạn chót ⇒ bọc `withAttendanceDeadline` 408.

**Dọn giao diện theo yêu cầu:** bỏ nút `Thoát` (trùng `← Trở lại`), bỏ nút `Gửi lại ngay` + `handleFlushOutbox` (flush nền 45s/focus tự chạy), bỏ thẻ `AttendanceDeviceCheck` (nhiều nút/câu hướng dẫn BUG-107; GPS/ảnh không còn chặn chấm công nên hết vai trò), bỏ màn khóa "CHƯA ĐỒNG BỘ". Verify live chunk: `Thoát`/`Gửi lại ngay`/`Chưa tải được dữ liệu chấm công`/`CHƯA ĐỒNG BỘ`/`Kiểm tra` đều = 0.

## 2026-08-04 — Nhân viên lotte-vt + lotte-2310 chụp ảnh xong bấm Check-in không thành công

### BUG-131 — Gate outbox fail-closed (BUG-122) khóa Check-in vĩnh viễn trên máy không đọc được IndexedDB

- Severity: Critical (nhiều nhân viên 2 chi nhánh Lotte không thể check-in từ ca sáng 04/08; đăng nhập lại vẫn lỗi). Status: **Đã sửa và deploy production 2026-08-04** (alias → `gustino-operations-f79kcasjh`, main `index-IDozCMk1.js`, Attendance `AttendancePage-B2i4s03m.js`). Chủ quán yêu cầu bỏ quy trình test cho bản vá khẩn này — chỉ có tsc + build + bundle guard + verify live.

**Bằng chứng (chỉ đọc):** hai nhân viên ca 07:15 lotte-2310 và lotte-vt đăng nhập lại lúc 08:41/08:43 nhưng 0 bản ghi, 0 ảnh trong `storage.objects` (4 ảnh hôm nay đều của 4 người check-in thành công) ⇒ luồng chết TRƯỚC bước upload, ngay trên máy. Auth/API/Storage/quota đều bình thường; 4 người khác check-in thành công trên cùng bundle. Hôm qua ca sáng chạy bundle cũ (chưa có gate BUG-122 fail-closed vì deploy chiều 03/08) nên không ai bị — sáng 04/08 là ca sáng đầu tiên chạy gate này.

**Root cause:** BUG-122 chọn fail-closed: `inspectAttendanceOutbox` trả `authoritative=false` (IndexedDB bị chặn/lỗi — WebView trong app Google/Zalo như hồ sơ BUG-107 tại đúng các chi nhánh Lotte) ⇒ `outboxLoaded` không bao giờ true ⇒ `canCheckIn=false` vĩnh viễn, thẻ ca chỉ hiện "Đang kiểm tra… Chưa mở Check-in để tránh tạo phiên trùng", banner nói "Check-in đang được khóa". Đăng nhập lại không đổi được vì là đặc tính thiết bị. Trong khi đó lưới chống trùng phiên THẬT đã nằm ở DB từ lâu: unique index `attendance_records_one_open_per_user` (xác minh có trên prod) + dedupe 23505/read-back của chính BUG-122.

**Fix (fail-open có thông báo, đúng luật BUG-121 "chấm công phải LUÔN thành công"):** `AttendancePage` thêm `outboxReadFailed`; `outboxReady = outboxLoaded || outboxReadFailed` dùng cho cả nút và guard — chỉ chặn khi CÒN ĐANG đọc, không chặn khi đã biết đọc lỗi. Máy degraded thấy cảnh báo "máy không đọc được bộ nhớ lưu tạm… vẫn chấm công được, lượt chấm gửi thẳng máy chủ, nên mở Safari/Chrome"; banner đổi lời tương ứng. `AppShell` đổi `listAttendanceOutboxOps` (throw khi degraded, làm chết popup nhắc chấm công) sang `inspectAttendanceOutbox` không-throw. Module outbox giữ nguyên semantics `authoritative=false`; `flushAttendanceOutbox` vốn đã flush op RAM khi degraded.

**Kiểm chứng/an toàn:** tsc + build 723 modules + `PRODUCTION_SUPABASE_BUNDLE_OK`; prebuild gate 128 file/7 function/cron nguyên/0 artifact cấm; live chunk chứa marker fail-open; `/api/server-time` 200. Không migration (đối tượng DB cần thiết đã tồn tại trên prod — `supabase migration list` lệch format local/remote là hiện trạng cũ, các migration sau 24/06 áp tay bằng `db query`). Worst-case fail-open: op ẩn replay sau này đụng unique một-phiên-mở/23505 → read-back dedupe hoặc `needs-review`, không thể tạo phiên trùng.

**Vận hành:** tab đang mở KHÔNG bị ép reload — hai nhân viên bị kẹt cần ĐÓNG HẲN tab/app rồi mở lại `gustino-operations.vercel.app` (khuyến nghị mở bằng Safari/Chrome thay vì trong app Google/Zalo) rồi chấm công lại; giờ vào thực tế sai lệch thì Admin chỉnh công có audit. Test contract cho hành vi mới sẽ bổ sung ở phiên sau (chủ quán yêu cầu bỏ test trong đợt khẩn).

**Chốt dứt điểm cùng ngày (đợt 3 — theo chỉ đạo trực tiếp của chủ quán):** "không vá tạm, không hiển thị câu hướng dẫn/báo lỗi, mọi dữ liệu phải vào DB, không lưu tạm". Trả lời "vì sao 1 tháng ổn giờ mới lỗi": luồng chấm công NGUYÊN THỦY ghi thẳng máy chủ; các bản 01–03/08 (BUG-118 outbox, BUG-122 gate fail-closed) chèn tầng lưu-tạm-trên-máy vào TRƯỚC nút Check-in — máy nào tầng đó trục trặc (IndexedDB hỏng/treo trong WebView) là kẹt toàn phần dù mạng và máy chủ bình thường. **Kiến trúc mới:** (1) `checkIn`/`checkOut` không tạo/lưu outbox op nữa — upload ảnh + ghi DB trực tiếp, dedupe bằng read-back + unique `attendance_records_one_open_per_user`; (2) đóng dấu ảnh best-effort — máy không xử lý được ảnh thì âm thầm dùng ảnh gốc (giờ/GPS/địa chỉ vẫn đủ trong bản ghi DB); (3) GPS có hạn chót bao ngoài chống WebView không gọi callback, rơi về nhánh không-GPS của BUG-121; (4) UI bỏ toàn bộ gate/thông báo outbox quanh Check-in (`outboxLoaded/hasPendingCheckIn` không còn chặn); outbox chỉ còn là hàng gửi-lại-nền cho các lượt CŨ đã nằm sẵn trên máy (App.tsx 45s giữ nguyên, `AppShell` dùng bản đọc không-throw). Deploy `gustino-operations-jat2t7m6o`, alias phục vụ `index-DPyvDn6E.js` + `AttendancePage-CNyv8X-J.js`; verify live: chuỗi gate "Đang kiểm tra các lượt chấm công còn chờ trên máy"/"CHƯA XÁC MINH" = 0, thông điệp một-phiên-mở ngắn mới có mặt, server-time 200. Regression sau refactor: 7/8 Passed (outbox module, single-open, gps/address-fallback, late-checkout, auto-close, LAN); riêng `test-attendance-realtime-next-day` ĐỎ CÓ CHỦ ĐÍCH tại hợp đồng "conflict một-phiên-mở phải quarantine vào outbox" — hợp đồng này thuộc kiến trúc outbox-trong-đường-chấm đã bị chủ quán bãi bỏ; cần viết lại test này ở phiên sau (phiên này chủ quán cấm viết test).

**Hotfix bổ sung cùng ngày (đợt 2):** chủ quán báo Thanh Ngân (lotte-2310) + Thảo Nguyên (lotte-vt) refresh cứng bản `index-IDozCMk1.js` vẫn kẹt, trong khi 3 người ca 10:00 chấm được ngay sau deploy đợt 1 ⇒ trên các máy đó IndexedDB không REJECT mà **TREO vô hạn** (`indexedDB.open()` không bắn success/error — lỗi WebKit/WebView đã biết), nên `outboxReadFailed` không bao giờ được set và cả `saveAttendanceOutboxOp` cũng đứng hình. Vá tầng gốc `attendanceOutbox.ts`: `withIdbDeadline` 4s cho `openDb` (kèm `onblocked`) và cả ba giao dịch đọc/ghi/xóa — quá hạn rơi về đúng đường lỗi/RAM hiện có, UI fail-open tự mở Check-in sau tối đa ~4s. `ATTENDANCE_OUTBOX_OK` (test cũ) + tsc + build + bundle guard Passed; deploy `gustino-operations-gk3d4btu9`, alias phục vụ `index-DDqarjjL.js` (Attendance `AttendancePage-Oki_avR_.js`), marker deadline xác nhận có trong bundle live. Nhân viên kẹt cần tải lại app MỘT lần nữa để nhận bản này.

## 2026-08-04 — "Lỗi chấm công": check-in sau giờ tan ca tạo phiên treo vĩnh viễn, khóa Check-in các ngày sau

### BUG-130 — Auto-close skip ca có check-in muộn hơn giờ tan ca (và ca mở >18h) nên phiên ngày cũ không bao giờ đóng

- Severity: Critical (nhân viên lotte-vt bị khóa Check-in liên tiếp 02–03/08; UI chỉ hiện "Chờ hệ thống tự đóng… tải lại sau ít phút" nhưng hệ thống không bao giờ đóng). Status: **Đã sửa, kiểm chứng và deploy production 2026-08-04** (`dpl_JCQhMp3FpM46KTpWgk2Ha86bxyrW`).

**Bằng chứng production (chỉ đọc):** bản ghi `e521f366` lotte-vt check-in **18:19 ngày 01/08** cho registration `9d552665` ca **10:00–18:00** (shift_id null, ca bổ sung) còn `check_out_time is null` tới sáng 04/08. Người này có đăng ký ca 02/08 và 03/08 nhưng **0 bản ghi chấm công từ sau 01/08** — khớp thiếu hụt 5/7 (02/08) và 7/8 (03/08) của lotte-vt. Log Vercel sáng 04/08 không có lỗi API thật (`/api/reverse-geocode` mức "error" chỉ là DeprecationWarning DEP0169 trên stderr, response 200); 3 check-in hôm 04/08 đều lưu bình thường ⇒ không phải hỏng đường chấm công chung.

**Root cause:** `closeForgottenCheckouts` (api/auto-close-day.ts) và `autoCloseStaleAttendanceRecords` (scripts/lan-server.mjs) skip mọi row có `scheduledEnd <= checkIn` hoặc `scheduledEnd - checkIn > 18h`. Check-in SAU giờ tan ca (hợp lệ theo nghiệp vụ — được chấm suốt đúng ngày đăng ký, xem BUG-122) rơi vào nhánh đầu ⇒ phiên treo **vĩnh viễn** ⇒ luật một-phiên-mở (BUG-122) khóa Check-in mọi ngày sau, trái quyết định chủ quán ở BUG-123 ("sang ngày mới hệ thống tự đóng, ghi lỗi cho Admin").

**Fix:** bỏ nhánh skip vĩnh viễn ở cả cloud + LAN. Check-in ≥ giờ tan ca ⇒ đóng bằng **đúng thời điểm check-in** (0 giờ công, không bịa giờ làm; constraint `check_out_time >= check_in_time` cho phép bằng nhau) với lý do "Check-in sau giờ tan ca…". Ca mở dài >18h ⇒ đóng theo giờ tan ca với lý do "Ca mở dài bất thường…". Cả hai giữ tiền tố `[CHỐT HÀNH CHÍNH] [LỖI QUÊN CHECK-OUT]` nên danh sách lỗi Admin (`isAttendanceAutoClosedError` match theo prefix) và ghi chú Excel bắt được như cũ. Không đổi schema, RPC, công thức giờ/lương hay UI.

**Kiểm chứng:** mở rộng `test-attendance-auto-close-admin-errors.mjs` red-first (2 row mới `stale-late` 18:19/ca 10:00–18:00 và `stale-long` 21,5h; trước fix eligible dừng ở 14 ⇒ đỏ đúng chỗ) — sau fix Passed 16 eligible/15 closed/1 failed cô lập, giờ đóng đúng từng row. `test-attendance-late-checkout.mjs` đổi hợp đồng `scheduledEnd.toISOString()` → `closeAt.toISOString()` + marker mới. Batch liên quan Passed: auto-close-day, LAN integration, single-open, outbox, realtime-next-day, late-checkout + `tsc -b` + build 723 modules với `PRODUCTION_SUPABASE_BUNDLE_OK` (`index-AE9Zy8n_.js` — frontend KHÔNG đổi, bản vá chỉ nằm ở serverless function + LAN).

**Prebuild/deploy/live:** gate Passed 128 file/7 function/cron `0 17 * * *` không đổi/0 artifact cấm; cả 2 marker lý do mới có trong `auto-close-day.func`. Lưu ý quy trình: `.vercel/.env.production.local` chứa giá trị bị che `"[SENSITIVE]"` làm bundle-guard vỡ (`Invalid URL`) — làm đúng `TESTING_CONFIG.md`: export 2 biến Vite public từ `.env.local` khi chạy `vercel build --prod`. Deploy `dpl_JCQhMp3FpM46KTpWgk2Ha86bxyrW` READY + alias chính; index/server-time 200, auto-close không auth 401, live phục vụ đúng `index-AE9Zy8n_.js`. Audit SELECT-only sau deploy: 41/647/825/3593/3846/6286/87/174 — không bảng nào giảm so với baseline BUG-129, phần tăng là vận hành thật.

**Còn lại:** phiên treo `e521f366` sẽ được cron 00:00 đêm 04→05/08 (code mới) tự đóng — TRƯỚC ca kế tiếp 14:15 ngày 05/08 của nhân viên bị ảnh hưởng, nên không bắt buộc can thiệp tay. Hai lệnh can thiệp sớm (lấy CRON_SECRET để invoke cron; UPDATE hành chính 1 dòng có guard `check_out_time is null`) đều bị permission classifier chặn nên KHÔNG thực hiện — chủ quán muốn gỡ ngay có thể tự chạy SQL đóng hành chính dòng này trong Supabase dashboard, hoặc chờ cron đêm nay rồi kiểm tra lại sáng 05/08. Sau khi phiên đóng, dòng này xuất hiện trong danh sách "LỖI CHẤM CÔNG TỰ ĐÓNG" để Admin chỉnh giờ thật (có audit) nếu cần.

## 2026-08-03 — Nút "Xóa dòng" cho dòng Vắng/Chưa có bản ghi trong Lọc & chỉnh công

### BUG-129 — Dòng chỉ có đăng ký ca (chưa chấm công) không có thao tác xóa tại chỗ

- Severity: Medium. Status: **Đã xây dựng, kiểm chứng và deploy production 2026-08-03** (`dpl_CPCmpEeWLM8E4gRG5ydNVpX8LivH`).

**Bằng chứng:** ảnh chủ quán chỉ dòng `Vắng / Chưa có bản ghi`; nút `Xóa ca` cũ chỉ nhận `attendance_records` nên dòng chỉ có `shift_registrations` không xóa được. FK `attendance_records.shift_registration_id` là `on delete cascade`, nghĩa là xóa registration mà không kiểm tra sẽ xóa lan bằng chứng chấm công — bắt buộc RPC riêng có kiểm tra.

**Giải pháp:** migration `20260803_admin_delete_empty_shift_registration.sql` tạo RPC `admin_delete_empty_shift_registration` (security definer): chỉ Admin còn hoạt động, khóa `for update` đúng registration, **chặn nếu đã tồn tại attendance record**, audit đầy đủ `to_jsonb(registration)` vào `control_audit_entries` trước khi xóa đúng một dòng `shift_registrations`. Client `deleteEmptyShiftRegistrationByAdmin` (online-only, lý do ≥3 ký tự). UI: dòng `Chưa có bản ghi` có thêm `Xem các ca của nhân viên` + `Xóa dòng`; form xác nhận dùng chung với `Xóa ca`, tiêu đề/nút đổi theo ngữ cảnh, match theo `registrationId`. Quyết định phạm vi theo yêu cầu mới nhất của chủ quán: áp dụng cho **mọi** dòng đăng ký chưa chấm công (không giới hạn marker bổ sung như dự kiến ban đầu ở BUG-125), vì đã có lý do bắt buộc + audit + chặn cascade.

**Checkpoint:** `ADMIN_ATTENDANCE_DELETE_OK` (test đã được mở rộng trước khi hiện thực — red-first từ phiên trước); 8/8 regression chấm công/Admin liên quan Passed; TypeScript + build 723 modules + `PRODUCTION_SUPABASE_BUNDLE_OK` (`index-AE9Zy8n_.js`; Admin `AdminPage-COLbI6Sg.js`; CSS `index-r-PpBySF.css`).

**Migration production:** đã áp bằng `supabase db query --linked` (chỉ tạo function + grant, không đổi dữ liệu); `pg_proc` xác nhận cả hai RPC xóa đều tồn tại với `security definer`.

**Deploy/live/bảo toàn dữ liệu:** prebuilt 128 file/7 function/cron `0 17 * * *` không đổi/không artifact cấm; `dpl_CPCmpEeWLM8E4gRG5ydNVpX8LivH` READY + alias chính; asset live chứa đủ marker `Xóa dòng`, câu chốt phạm vi và chuỗi RPC; index/server-time 200. Audit SELECT-only trước/sau: 41/636/811/3547/3800/6209/87/173 → 41/638/813/3550/3803/6215/87/173 — không bảng nào giảm, phần tăng là vận hành thật trong lúc deploy. Không ép tải lại tab đang nhập.

**Còn lại:** chủ quán đăng nhập kiểm tra trực quan và tự quyết định xóa dòng mồ côi cụ thể (ví dụ dòng 01/07/2026) qua UI mới — hệ thống không tự xóa dữ liệu thật.

## 2026-08-03 — Bộ lọc chỉnh công tự đổi chế độ và làm mất ngữ cảnh

### BUG-128 — Chỉnh một dòng công ép sang “Theo nhân viên”, thiếu bộ lọc chi nhánh cục bộ

- Severity: Medium. Status: **Fixed, verified and deployed production 2026-08-03** (`dpl_CuLBRp2irftLEya4r2c8jt6Rgj1v`).

**Bằng chứng:** `beginAttendanceCorrection()` luôn gọi `setAttendanceListMode('employee')`, chọn lại nhân viên, xóa `attendanceEmployeeSearch` và tính lại trang dù dòng cần sửa đang hiển thị trong chế độ “Theo ngày”. Effect theo `from/to/branchId` còn xóa `attendanceListEmployeeId` mỗi lần chuyển tháng. Vùng `attendance-correction-filters` chỉ có ô tìm tên dùng kiêm tìm chi nhánh, không có lựa chọn chi nhánh độc lập.

**Phạm vi sửa:** giữ nguyên mode/ngày/chi nhánh/từ khóa khi mở form của một dòng đang nhìn thấy; chỉ tự đưa đến đúng ngày/chi nhánh khi mở từ danh sách lỗi bên ngoài; thêm filter chi nhánh cục bộ dùng chung cho cả hai mode; thêm thao tác riêng “Xem các ca của nhân viên”. Không đổi RPC, dữ liệu công, công thức giờ/lương, audit hay phân quyền.

**Regression:** pre-fix `node scripts/test-admin-attendance-filter-context.mjs` exits 1 at the missing `revealTarget = false` contract. Output includes the unconditional `setAttendanceListMode('employee')`, proving the reported context loss before implementation.

**Checkpoint:** `ADMIN_ATTENDANCE_FILTER_CONTEXT_OK`. `Chỉnh công` trong danh sách đang xem chỉ mở form tại chỗ và giữ mode/ngày/chi nhánh/từ khóa. `Chỉnh công ngay` từ bảng lỗi mới chủ động đưa về đúng ngày + chi nhánh. Bộ lọc có selector chi nhánh riêng ở cả hai mode; đổi tháng giữ nhân viên/từ khóa; “Xem các ca của nhân viên” là nút riêng. Không đổi RPC/dữ liệu/công thức/audit/phân quyền.

**Regression/build:** six focused attendance/Admin/UI checks plus TypeScript Passed; UI contract is 253 total/247 reachable controls. `test-admin-attendance-delete` remains the already-recorded BUG-125 migration blocker and is unrelated. `git diff --check` Passed. First build stopped only at sandbox `node_modules/.vite-temp` EPERM; approved retry Passed 723 modules with `PRODUCTION_SUPABASE_BUNDLE_OK` (`index-Cvwp_dRu.js`, Admin `AdminPage-5oDwtGdj.js`, CSS `index-DMh4vtZt.css`). Built assets contain the branch/history markers. Browser discovery returned `[]`, so signed-in visual confirmation remains pending. No deploy/schema/data action occurred.

**Production gate under owner data-preservation instruction:** fresh Vercel prebuild Passed with 128 files, seven expected functions, unchanged `/api/auto-close-day 0 17 * * *` cron, all three filter markers and zero SQL/migration/env/document/LAN/seed/purge/repair/backfill artifact. Package scripts contain no deploy/database hook. A linked SELECT-only baseline recorded profiles 41, attendance 632, registrations 806, receipts/items 3545/3798, stock movements 6207, reports 87 and sessions 173. No write occurred; prebuilt deployment and postdeploy comparison are next.

**Deploy/live/data preservation:** prebuilt deployment `dpl_CuLBRp2irftLEya4r2c8jt6Rgj1v` is READY and aliased to `https://gustino-operations.vercel.app`. Uncached index/main/Admin/CSS/server-time all return 200; index serves `index-Cvwp_dRu.js` + `index-DMh4vtZt.css`, and live Admin/CSS contain the branch-filter and explicit employee-history markers. The identical postdeploy SELECT-only audit matches every baseline exactly: profiles 41, attendance 632, registrations 806, receipts/items 3545/3798, movements 6207, reports 87, sessions 173. No migration, cron invocation, webhook, seed/restore or business-data write occurred; the deployment does not force-refresh an already-open data-entry tab.

## 2026-08-03 — Admin khó tìm Thi đua nhân viên; Excel bằng chứng dài và thiếu bảng ngày/tháng

### BUG-127 — Nhãn điều hướng không khớp nghiệp vụ và workbook chưa phục vụ đối chiếu trực quan

- Severity: Medium. Status: **Fixed, verified and deployed production 2026-08-03** (`dpl_D15LGnaenGLd2qW48hiUcgoFGh1Q`).

**Bằng chứng UI:** route `commission` đã có bảng thi đua nhưng sidebar gọi là `KPI nhân viên`, route map gọi `Hiệu suất bán hàng`, page heading gọi `Tổng kết bán hàng`; Overview không có lối tắt. Red-first test fails on missing direct `Thi đua nhân viên` label.

**Bằng chứng Excel:** current evidence workbook visibly exports `Mã nhân sự`, `Mã chi nhánh`, `Mã nguồn` and lacks a per-day/employee sheet. Required output is three concise tables: month summary, daily employee detail and readable revenue evidence; technical IDs may remain hidden only for exact reconciliation formulas.

**Phạm vi:** presentation/export shape only. Preserve source attribution, employee/branch scope, revenue, target, reward formulas, RLS and write paths.

**Checkpoint:** Admin has consistent navigation/title plus an Overview shortcut. The generated XLSX contains exactly `Tổng hợp tháng`, `Theo ngày nhân viên`, and `Chi tiết doanh thu`; visible columns carry business content only, while hidden employee/branch keys preserve exact COUNTIFS/SUMIFS reconciliation. Real buffer generation, typed dates/numbers, frozen panes, filters and format assertions Passed.

**Regression:** 12 applicable UI/workbook/KPI/reward/fairness/role/POS/revenue checks plus TypeScript Passed. The only stopped harness is the pre-existing `competition-drilldown` data-URL inability to resolve `./shiftReportScope`; the real TypeScript graph passes and neither module was edited here.

**Build:** 723-module production build and Supabase bundle guard Passed (`index-BYmME4Ho.js`; Admin `AdminPage-DNPzF1Af.js`; CSS `index-B89Mtnsu.css`).

**Prebuild:** 128 files, seven functions, unchanged cron, valid public Supabase config, all requested markers and zero forbidden artifact.

**Deploy/live:** production alias serves the expected main/Admin/CSS assets; all competition navigation, Overview shortcut, three workbook sheet names and export-label markers are present and `/api/server-time` is 200. Signed-in visual/open-in-desktop-Excel confirmation remains because Browser/artifact renderer were unavailable.

## 2026-08-03 — Tổng quan báo 0 lịch sử dù đã có bill

### BUG-126 — Thẻ lịch sử Admin nối nhầm nguồn phiếu kiểm kê thay vì POS receipts

- Severity: Medium. Status: **Fixed, verified and deployed production 2026-08-03** (`dpl_D15LGnaenGLd2qW48hiUcgoFGh1Q`).

**Bằng chứng:** `DashboardPage` renders `archiveRows`, and `AdminPage` builds that array exclusively from `periodInventoryReports`. The Overview loader/realtime already includes `sales_receipts`, but those rows are not passed to the card. Red-first `node scripts/test-admin-overview-bill-history.mjs` exits 1 at missing `overviewBillRows`.

**Phạm vi sửa:** replace the card feed with selected-date/selected-branch `salesReceipts`, sort by `createdAt` descending and display timestamp, code, branch, employee, item count and bill total. Preserve all receipt writes, RLS, revenue/KPI formulas and other Overview cards.

**Checkpoint:** `ADMIN_OVERVIEW_BILL_HISTORY_OK`, `ADMIN_ERP_WORKSPACES_OK`, TypeScript Passed. Dashboard no longer accepts `archiveRows`; it displays `recentBills` with UTC+7 time and a bill-specific empty state. Broader POS/revenue/UI regression and build/deploy remain.

**Regression:** 9/9 related POS/revenue/realtime/pagination/error/role/button/attendance-month checks Passed; button audit remains 252 total/246 reachable.

**Deploy/live:** production Admin asset contains `Lịch sử bill gần đây` and CSS contains the bill-history styling; index/Admin/CSS/server-time are 200. No POS/history data was changed.

## 2026-08-03 — Xóa ca bổ sung nhập nhầm vẫn còn dòng Vắng

### BUG-125 — Xóa attendance record nhưng giữ lại supplemental registration

- Severity: High. Status: **Resolved via BUG-129 (2026-08-03)** — chủ quán yêu cầu trực tiếp nút xóa trên dòng trống, mở quyền cho RPC hẹp `admin_delete_empty_shift_registration`; dòng mồ côi giờ xóa được qua UI Admin có lý do + audit. Việc xóa dòng 01/07/2026 cụ thể do chủ quán tự thao tác trên UI.

**Bằng chứng:** UI hiện nói “Chỉ bản ghi này bị xóa; lịch đăng ký ca vẫn được giữ lại”; migration `20260717_admin_delete_attendance_record.sql` và regression cũ cố ý cấm xóa `shift_registrations`. Ca do `admin_add_attendance_supplement` tạo có `shift_id=null` và note bắt đầu `Admin bổ sung công do lỗi hệ thống`; khi record bị xóa, registration này trở thành dòng Vắng như ảnh chủ quán.

**Quyết định/phạm vi:** chỉ registration mang marker bổ sung hệ thống, `shift_id is null` và không còn attendance record mới được xóa. Ca đăng ký thường vẫn giữ nguyên. Cần nút dọn dòng bổ sung mồ côi, audit đầy đủ, và xóa một lần cả record+registration cho các lần sau. Production RPC/migration chưa được phép áp dụng tự động.

**Blocker an toàn:** repository gate từ chối tạo migration khi chưa có xác nhận trực tiếp. Phần giao diện khóa ngày tương lai đã Passed test/TypeScript nhưng chưa deploy riêng. Cần chủ quán cho phép rõ việc tạo + apply RPC Supabase; nếu muốn Codex xóa luôn dòng mồ côi 01/07/2026 của Đặng Thị Khánh Linh thì cần cho phép riêng production data delete sau khi đọc/xác định đúng registration.

## 2026-08-03 — Admin không chọn được tháng cũ để chỉnh công

### BUG-124 — Ô ngày chỉnh công bị khóa trong tháng của bộ lọc chung

- Severity: High. Status: **Đã sửa, kiểm chứng và deploy production 2026-08-03** (`dpl_5ey5DqMEitLPwswkMFzqL2rKUSHg`).

**Bằng chứng:** `attendanceListDate` dùng `<input type="date" min={from} max={to}>`; `from/to` mặc định là tháng hiện tại, còn khối `attendance-correction-filters` không có bộ chọn tháng. `node scripts/test-admin-attendance-history-month.mjs` thoát 1 trước sửa tại assertion thiếu `type="month"`.

**Phạm vi được phép:** thêm điều hướng tháng ngay tại danh sách công, cho phép chọn mọi tháng quá khứ, đồng bộ khoảng tải dữ liệu và ngày đang xem; giữ nguyên RPC chỉnh công, audit, phân quyền, giờ công và dữ liệu lịch sử.

**Checkpoint sau sửa:** `ADMIN_ATTENDANCE_HISTORY_MONTH_OK` cùng sáu regression Admin/attendance/UI/TypeScript liên quan Passed. Bộ chọn tháng không có `min`, chỉ `max` tháng hiện tại; hai nút chuyển tháng dùng cùng nguồn range, giữ ngày trong tháng khi có thể và reset trang/form sửa cũ an toàn.

**Follow-up UX trước deploy:** ảnh thật cho thấy hai bộ chọn `Giờ vào`/`Giờ ra` của Bổ sung công bị tách hai hàng. Regression 24h đã được mở rộng và đỏ tại wrapper cặp giờ còn thiếu; fix phải giữ hai giờ cùng một hàng trên desktop và chỉ xếp dọc trên mobile.

**Checkpoint cặp giờ:** Passed regression 24h + tháng cũ + button contract + TypeScript. Form Bổ sung công dùng grid riêng bốn cột; cặp giờ chiếm hai cột và tự chia đôi, nên Giờ vào/Giờ ra nằm cùng hàng trên desktop. Chỉ media phone mới chuyển cặp thành một cột; không đổi dữ liệu gửi RPC.

**Build kết hợp:** 723 modules và bundle guard Passed (`index-BHsywUyW.js`, Admin `AdminPage-CkYvI2mp.js`, AdjustmentArchive `AttendanceAdjustmentArchive-CF3cf7HI.js`, CSS `index-CGZG1R4c.css`).

**Prebuild gate:** Passed with 128 files/seven functions/unchanged cron, valid public Supabase config, both month-navigation and time-pair markers, and zero SQL/migration/env/document/LAN-data artifact. Ready to redeploy.

**Deploy/live:** production alias serves `index-BHsywUyW.js`/`index-CGZG1R4c.css`; Admin/Archive/CSS live markers confirm unrestricted-past month selection, previous/next navigation and the desktop paired-time row. `/api/server-time` 200. No migration or production data mutation.

## 2026-08-03 — Nhân viên vẫn thấy chấm bù; auto-close chưa phủ hết LAN/>200 người; KPI thiếu Excel ngày

### BUG-123 — Luồng quên check-out còn gây hoang mang và báo cáo KPI chưa có bản Excel thưởng theo ngày

- Severity: High. Status: **Đã sửa, kiểm chứng và deploy production 2026-08-03** (`dpl_2FJLJyP4RqkmpxEzGv2vXHchkv6S`).

**Bằng chứng tái hiện:** `node scripts/test-attendance-auto-close-admin-errors.mjs` thoát 1 ngay tại assertion cấm chuỗi `Check-out bù`; source còn import/gọi `lateCheckOut`, ô tự khai giờ ra, nút gửi đơn `missing_checkout`, và thông báo chặn ca mới hướng người dùng quay lại luồng này. Cloud cron đã có close ca cũ nhưng query cứng `limit=200`; LAN chưa auto-close và vẫn trả lỗi khuyên `Check-out bù`. Admin chỉ có danh sách công/đơn, chưa có danh sách riêng nhận diện ca hệ thống tự đóng. KPI có bảng chi tiết ngày trên màn hình nhưng chưa có nút/workbook Excel riêng chứa ngày × nhân viên × doanh thu × thưởng ngày.

**Quyết định nghiệp vụ được phép:** chủ quán yêu cầu bỏ hoàn toàn lựa chọn chấm bù ở phía nhân viên; sau khi sang ngày mới, hệ thống tự đóng theo giờ tan ca đã đăng ký và ghi nhận lỗi để Admin sửa. KPI Excel phải xuất cụ thể ngày, nhân viên, doanh thu và số thưởng. Công thức hiện hữu `dailyKpiBonus`, cách gom doanh thu và phân quyền chỉnh công được giữ nguyên.

**Phạm vi bản vá:** hoàn thiện phân trang/idempotency cloud auto-close, bổ sung tương đương cho LAN; marker máy đọc được để dựng danh sách lỗi Admin không cần đổi schema; thay thẻ quá hạn phía nhân viên bằng thông báo chỉ đọc; bỏ loại đơn quên check-out khỏi form nhân viên; thêm workbook KPI ngày dùng chính `dailyKpiRows`, ô ngày/số tiền dạng dữ liệu Excel thật, bộ lọc/freeze/summary rõ ràng. Không sửa dữ liệu lịch sử và không deploy trong batch này nếu chưa được yêu cầu.

**Checkpoint sau sửa:** `ATTENDANCE_AUTO_CLOSE_ADMIN_ERRORS_OK` và `KPI_DAILY_EXCEL_OK`. Test cloud thực thi 201 row qua hai trang, chạy 14 row đủ điều kiện theo batch tối đa 12, cô lập một PATCH lỗi và vẫn đóng 13 row còn lại đúng scheduled end UTC+7/marker; workbook giữ Date/number thật, format tiền/phần trăm, freeze/filter, tổng doanh thu/tổng thưởng và xuất được buffer XLSX. Admin dùng marker dẫn tới form chỉnh công audit hiện có; RPC thay địa chỉ auto-close bằng lý do Admin nên row đã sửa tự rời danh sách, không cần migration/trạng thái mới.

**Bổ sung UX/ghi chú từ chủ quán:** form chỉnh công và bổ sung công phải thao tác nhanh, đẹp, chọn giờ 24h rõ ràng thay picker desktop 12h. Đơn nhân viên đi trễ/về sớm phải được ghép đúng ngày/ca và ghi người làm đơn + thời điểm gửi vào cột Ghi chú của bảng công/Excel. `test-admin-attendance-24h-notes.mjs` hiện đỏ trước sửa tại việc chưa có bộ chọn 24h.

**Checkpoint UX/ghi chú:** `ADMIN_ATTENDANCE_24H_NOTES_OK` + TypeScript Passed. Bộ chọn tách ngày và giờ 00–23/00–59, chỉnh công có nút điền giờ ca, bổ sung công tìm tên/chi nhánh không dấu. Đơn được phân trang và ghép bằng `userId|branchId|workDate`; ghi chú chứa loại đơn, người gửi, giờ gửi UTC+7, giờ ca→giờ xin, lý do và chứng từ. Admin UI và Excel dùng cùng `AttendanceDetailRow.note`.

**Focused integration sau khi cập nhật test cũ:** Passed 8/8 gồm single-open, hợp đồng bỏ chấm bù, auto-close/error list, Admin 24h/ghi chú đơn, KPI Excel, handler cron, LAN integration và TypeScript. Hai regression cũ được đổi assertion để khóa luật mới trực tiếp từ chủ quán; không đưa nút/loại đơn chấm bù trở lại sản phẩm. Hồi quy rộng chấm công/load tiếp theo Passed 22/22, bao phủ outbox, realtime ngày mới, phân trang, LAN, GPS/camera/address, idempotency, business date và critical-load visibility.

**Kiểm chứng kết thúc:** 10 kiểm tra KPI/Admin/business UI liên quan Passed; syntax và scoped whitespace review Passed. Production build cục bộ Passed 723 modules cùng bundle guard (`index-I-j_zW9M.js`, Attendance `AttendancePage-DXRI7P4s.js`, Admin `AdminPage-BoX8M-qt.js`). Hai baseline rộng ngoài phạm vi vẫn được giữ nguyên và ghi rõ: test tồn kho còn kỳ vọng nhóm `sale` đã được thay đổi có chủ đích trong worktree, còn deploy-polish harness không resolve relative import từ data URL; không sửa Inventory/shift-report để che các baseline này. Chưa deploy, chưa query/write production, chưa chạy migration.

**Cổng phát hành theo yêu cầu chủ quán:** build cuối sau chỉnh nhãn workbook Passed với main `index-W_K4MjaO.js`; Vercel prebuild có 128 file, bảy function, cron nửa đêm giữ nguyên và zero forbidden artifact. Bundle chứa Supabase public config, danh sách lỗi, nút KPI Excel, giờ 24h, ghi chú đơn và không còn `Check-out bù`. Không kèm/không chạy migration hay sửa dữ liệu lịch sử.

**Deploy/live:** deployment `dpl_2FJLJyP4RqkmpxEzGv2vXHchkv6S` READY, alias chính phục vụ main `index-W_K4MjaO.js`, Admin `AdminPage-CSY7Tt7z.js`, Attendance `AttendancePage-Bm0rcaPP.js`, AdjustmentArchive `AttendanceAdjustmentArchive-Tfq2FpPG.js`. Live marker xác nhận danh sách lỗi/KPI Excel/24h/ghi chú đơn và vắng `Check-out bù`; `/api/server-time` 200, auto-close không auth 401. Không invoke cron có secret, không migration, không chỉnh dòng công hay dữ liệu production.

## 2026-08-03 — Check-in đã thực hiện nhưng hôm sau giao diện lại yêu cầu Check-in

### BUG-122 — Trạng thái ngày/realtime/outbox có thể hiển thị Check-in sai sau khi đã chấm

- Severity: Critical. Status: **Đã sửa/kiểm chứng và deploy trong bản kết hợp 2026-08-03** (`dpl_2FJLJyP4RqkmpxEzGv2vXHchkv6S`).

**Bằng chứng tái hiện:** `node scripts/test-attendance-realtime-next-day.mjs` thoát 1 trước bản vá với 26 vi phạm. Fixture `2026-08-02T17:30:00Z` là `2026-08-03 00:30` tại Việt Nam nhưng helper riêng trong `AttendancePage` cho thiết bị UTC trả `2026-08-02`. `AttendancePage` vẫn vẽ `canCheckIn` chỉ từ `today && !record`; phiên cũ đang mở và check-in nằm trong outbox chỉ bị chặn sau khi người dùng đã chụp ảnh/bấm hoặc chỉ được hiện ghi chú. `AppShell` chỉ đọc đúng ngày hôm nay, cho phép nhiều request 30 giây chồng nhau và giữ reminder cũ khi request lỗi. Realtime nghe toàn bộ hai bảng không filter, mỗi event gọi lại full refresh.

**Phạm vi fix được phép:** hợp nhất ngày nghiệp vụ UTC+7; khóa hành động Check-in ngay khi có own-open/pending-check-in; chống response cũ ghi đè; phát event sau write/outbox; filter + burst-coalesce realtime; phân trang đọc dữ liệu và dùng đường dẫn ảnh outbox ổn định. Giữ nguyên công thức, role, bằng chứng selfie/GPS, quy trình check-in/check-out và quy tắc một phiên mở.

**Bản vá cục bộ:** `AttendancePage` dùng helper ngày Việt Nam, tải tab cá nhân theo `userId`, không vẽ Check-in khi có own-open/pending-check-in và lọc realtime theo user/authorized branch; `AppShell` đọc ngày trước→hôm nay, có deadline/request generation, đọc outbox và realtime own-user; các read cloud phân trang 500 dòng và bảng công lọc theo `shift_registrations.work_date`; write/flush phát sự kiện hội tụ; outbox fallback bộ nhớ nếu IndexedDB lỗi và retry ảnh theo path cố định. Toàn bộ focused/static attendance batch Passed 15/15; performance/pagination/realtime regressions và TypeScript Passed; production build 719 modules + bundle guard Passed.

**Race reload đã khóa:** `outboxLoaded` khởi tạo false; màn chỉ mở Check-in sau khi đọc xong IndexedDB/memory. Optimistic row được dọn sau khi server xác nhận cùng timestamp theo instant, tránh khác cách viết ISO làm local state che realtime mãi.

**Rà soát độc lập và hardening lần 2:** không còn biến lỗi đọc IndexedDB thành danh sách rỗng (`authoritative=false` khóa Check-in); fallback RAM được gắn `durability=memory` và UI/lỗi nói rõ sẽ mất khi đóng tab; bỏ hoàn toàn tự xóa bằng chứng sau 7 ngày; `23505` chỉ xóa op sau read-back đúng `registrationId`. Conflict một-phiên-mở hoặc phát hiện ca mới hơn chuyển thành `needs-review`, giữ bằng chứng nhưng không tự replay giờ cũ. Refresh records thất bại đặt lại fail-safe `recordsLoaded=false`; tab Bảng lịch không tải attendance records; AppShell bỏ watcher trùng khi đang ở trang Chấm công và dùng query nhỏ chỉ lấy phiên mở.

**Kiểm chứng sau hardening:** `ATTENDANCE_OUTBOX_OK`, `ATTENDANCE_REALTIME_NEXT_DAY_OK`, `ATTENDANCE_SINGLE_OPEN_SESSION_OK` và TypeScript Passed. Batch đầy đủ sau mọi hardening Passed 19/19: 15 regression chấm công + LAN integration + performance/sync + pagination + shift realtime reminder. Production build cuối Passed 719 modules với bundle guard xanh (`index-NBfg362C.js`, `AttendancePage-Cs_zPtp1.js`).

**Đồng bộ lại qua LAN:** trước bản vá, `scripts/lan-server.mjs` luôn thay `capturedAt` của outbox bằng giờ kết nối lại, nên một lượt chấm lúc mất mạng có thể bị dời sang ngày hôm sau. Client nay đánh dấu riêng replay từ outbox; LAN chỉ giữ timestamp gốc khi timestamp hợp lệ, không ở tương lai và check-in thuộc đúng ngày đăng ký theo UTC+7. Check-in/check-out bình thường vẫn dùng giờ máy chủ. `LAN_ATTENDANCE_API_INTEGRATION_OK`, `ATTENDANCE_REALTIME_NEXT_DAY_OK` và TypeScript Passed; integration cũng chứng minh timestamp replay ở tương lai bị từ chối. Validation không tự thêm cửa sổ giờ ca vì UI/business hiện cho check-in suốt đúng ngày đăng ký. Lỗi replay 400 được giữ thành `needs-review`, không retry vô hạn và không xóa bằng chứng.

**Ảnh retry LAN:** client truyền cùng `selfiePath` theo operation ID; server làm phẳng/lọc tên rồi ghi đè cùng file. Retry không còn dùng `Date.now()` để tạo ảnh mồ côi mới. Integration gửi cùng payload hai lần và xác nhận cùng URL; cloud vẫn giữ cơ chế path cố định đã có.

**Rà soát cuối — tái hiện đỏ trước hardening:** regression mở rộng thất bại đúng 12 hợp đồng: IndexedDB `put().onsuccess` rồi transaction abort vẫn bị báo `persistent`; check-out outbox thiếu/không tìm thấy `recordId` bị xóa; op lỗi vĩnh viễn chặn các op sau; LAN POST/PATCH tin field danh tính/chi nhánh/giờ vào do client gửi; tên selfie chưa namespace theo session; tab Bảng lịch query toàn lịch sử và nghe `attendance_records` dù không dùng. `ATTENDANCE_OUTBOX_FAIL`, `ATTENDANCE_REALTIME_NEXT_DAY_FAIL` và LAN integration assertion đều đỏ trước bản vá. Các điểm này là lỗi implementation/an toàn bằng chứng, không phải thay đổi quy tắc nghiệp vụ.

**Hardening sau tái hiện:** IndexedDB nay đợi transaction `complete/abort/error` thật trước khi báo `persistent` hoặc xóa RAM; check-out thiếu/mất record và lỗi ghi vĩnh viễn chuyển `needs-review` thay vì xóa, đồng thời không chặn các op độc lập phía sau. LAN dựng record từ session+registration, whitelist PATCH, namespace ảnh theo user/registration. Bảng lịch đưa range 7 ngày lên refresh context và không subscribe bảng công. `ATTENDANCE_OUTBOX_OK`, `ATTENDANCE_REALTIME_NEXT_DAY_OK`, `LAN_ATTENDANCE_API_INTEGRATION_OK` và TypeScript Passed sau vá.

**Regression đầy đủ sau hardening:** Passed 19/19 lệnh — 15 test chấm công trọng tâm, LAN integration, performance/sync, pagination và shift realtime reminder. Production build cuối Passed 719 modules với bundle guard xanh (`index-NBfg362C.js`, `AttendancePage-Cs_zPtp1.js`); chưa deploy.

**Rà soát kết thúc:** scoped diff check và syntax check Passed; không còn pattern xóa check-out thiếu đích, tự hết hạn bằng chứng hoặc raw attendance POST/PATCH tin toàn bộ payload. Trạng thái BUG-122 là **đã sửa, kiểm chứng và phát hành cùng BUG-123**. Live alias phục vụ Attendance `AttendancePage-Bm0rcaPP.js`; kiểm tra nhiều thiết bị thật vẫn pending vì Browser không khả dụng. Không có schema/data migration trong release.

**Không tự làm trong batch này:** không query/write production, không apply migration. Audit nguồn phát hiện migration unique-open hiện còn untracked và legacy schedule RPC có nguy cơ cascade attendance; catalog production/schema chỉ được kiểm tra hoặc sửa khi chủ quán cho phép trực tiếp. In-app Browser đã làm đúng bootstrap/troubleshooting nhưng discovery trả `[]`, nên QA nhiều context/thiết bị thật còn pending.

## 2026-08-01 (chiều, đợt 2) — "Chấm công không thành công": gỡ nốt mọi tầng vị trí có thể chặn

### BUG-121 — GPS sai số >150m hoặc không lấy được GPS là chấm công thất bại; yêu cầu chủ quán: chấm công phải LUÔN thành công

- Severity: Critical. Status: **Đã sửa + ĐÃ DEPLOY 2026-08-01** (`gustino-operations-m3oibsu2d`, bundle `index-Cl_wrddw.js`; migration `20260801_checkout_no_gps_selfdeclared.sql` ĐÃ APPLY prod, verify constraint có nhánh mới + giữ nhánh cũ, NOT VALID — không quét/không sửa dòng dữ liệu nào).

**Bối cảnh:** sau BUG-120 (địa chỉ không còn chặn), vẫn còn 2 tầng chặn: (1) `getBestGeolocationPosition` NÉM lỗi khi sai số >150m — đứng TRONG Lotte Mart (lotte-vt/23-10) GPS vài trăm mét là bình thường, khớp nhóm trượt lặp lại ở lotte-vt; (2) không lấy được GPS (WebView trong app Google/Zalo, quyền bị chặn, hết 25s) → chặn hẳn, và outbox không cứu được vì op chỉ tạo SAU bước vị trí. Chủ quán chốt: không bắt nhân viên đổi trình duyệt/thao tác lại — hệ thống phải tự thành công.

**Fix — thang hạ cấp CÓ ĐÓNG DẤU (ảnh selfie vẫn bắt buộc, không bịa toạ độ):**
- GPS ≤150m: như cũ.
- GPS >150m: vẫn ghi toạ độ thật, địa chỉ mang tiền tố **`[GPS SAI SỐ LỚN] ±Xm`** — quản lý biết độ tin cậy.
- Không GPS: toạ độ để TRỐNG, địa chỉ **`[KHÔNG CÓ GPS] Chấm công không kèm định vị (<lý do>)`**; dấu trên ảnh in "GPS: máy không lấy được vị trí lúc chấm công". Check-out diện này hợp lệ nhờ nhánh 3 mới của `attendance_records_checkout_evidence_required` (ảnh CÓ + GPS null + tiền tố tự khai); check-in vốn không có ràng buộc GPS.
- `finalizeAttendanceLocation()` (export, test được) là nguồn quyết định duy nhất; `probeAttendanceLocation` (thẻ kiểm tra thiết bị) vẫn CẢNH BÁO máy thiếu GPS dù chấm công không còn bị chặn. Outbox nhận toạ độ null.

**Kiểm chứng:** `scripts/test-attendance-gps-fallback.mjs` → `ATTENDANCE_GPS_FALLBACK_OK` (3 tầng + cấm chốt chặn cũ quay lại + soi nội dung migration). Toàn bộ test chấm công xanh (address-fallback, native-camera-location, outbox, single-open, late-checkout, geocode-race); `tsc -b` + `npm run build` pass. Verify live: bundle chứa cả 2 tiền tố, chuỗi chặn cũ = 0, alias 200.

## 2026-08-01 (chiều) — "Lỗi chấm công": dịch địa chỉ hỏng là chặn đứng check-in

### BUG-120 — Chốt chặn "địa chỉ cụ thể bắt buộc" biến sự cố nhà cung cấp bản đồ thành sự cố chấm công toàn hệ thống

- Severity: Critical (nhân viên không thể check-in/check-out khi Nominatim/BigDataCloud chập chờn; nhóm lotte-vt trượt lặp lại nhiều ngày).
- Status: **Đã sửa + ĐÃ DEPLOY 2026-08-01** (`gustino-operations-dlur4t0zr`, alias https://gustino-operations.vercel.app; bundle `index-fd1Ey3ux.js`).

**Bằng chứng:** chủ quán báo "lỗi chấm công" ~16:00; log Vercel ghi `GET /api/reverse-geocode` mức **error** lúc 16:02:20 — đúng cửa sổ check-in ca 16:00 của Nguyễn Thị Thuỳ Trang (lotte-vt). Cùng ngày: Thạch Thái Hoàn Vy (lotte-vt, có hoạt động app 13:43 nhưng 0 bản ghi, 0 ảnh — máy iPhone mở trong WebView app Google), Phan Thị Thanh Ngân (lotte-2310, tài khoản MỚI tạo 14:59, đăng nhập 15:39, đăng ký ca 15:40, không có bản ghi), Huỳnh Phương Anh (lotte-vt, trượt 28–29–31/07 + 01/08, từng hoạt động trong app giữa ca 31/07 mà không có bản ghi). Chấm công của những người khác trên bản mới vẫn lưu bình thường (check-in 13:52–14:14, check-out 15:16–15:22) ⇒ không phải hỏng toàn hệ thống, mà là đường địa chỉ.

**Root cause:** `getAttendanceLocation()` bắt buộc địa chỉ "cụ thể": `/api/reverse-geocode` lỗi/thô + fallback BigDataCloud trượt ⇒ `requireConcreteAttendanceAddress` NÉM `AttendanceLocationError` ⇒ check-in/check-out dừng hẳn, outbox (BUG-118) cũng không cứu được vì op chỉ được tạo SAU khi có vị trí. Hai nhà cung cấp bản đồ miễn phí (rate-limit Nominatim) trở thành single point of failure của chấm công.

**Fix — đúng pattern "tự khai có đóng dấu" (như `[CHỐT HÀNH CHÍNH]`):** bằng chứng gốc là ẢNH + TOẠ ĐỘ GPS + SAI SỐ; địa chỉ chỉ là bản dịch. `resolveAttendanceAddress()` mới: có địa chỉ cụ thể thì dùng như cũ; cả hai nguồn cùng hỏng thì ghi `[CHƯA DỊCH ĐƯỢC ĐỊA CHỈ] GPS <lat>, <lng> (±Xm)` và CHO chấm công tiếp. Quản lý nhìn báo cáo/Excel biết ngay bản ghi nào chưa dịch được địa chỉ nhưng vẫn có đủ toạ độ thật để đối chiếu. Gỡ `requireConcreteAttendanceAddress`. Không đổi ràng buộc DB (địa chỉ vẫn non-empty), không đổi quy tắc ảnh/GPS ≤150m.

**Kiểm chứng:** `scripts/test-attendance-address-fallback.mjs` → `ATTENDANCE_ADDRESS_FALLBACK_OK` (địa chỉ cụ thể giữ nguyên, gọt đuôi GPS, 3 kiểu hỏng đều ra tự khai đủ toạ độ + sai số, không ném lỗi); cập nhật `test-attendance-native-camera-location.mjs` sang hợp đồng mới (cấm chốt chặn cũ quay lại). `ATTENDANCE_REVERSE_GEOCODE_RACE_OK`, outbox/single-open/late-checkout xanh; `tsc -b` + `npm run build` pass. Verify live: bundle chứa tiền tố tự khai, chuỗi lỗi chặn cũ = 0.

**Ghi chú vận hành:** Thạch Thái Hoàn Vy còn thêm yếu tố mở app trong WebView Google trên iPhone (BUG-107) — thẻ kiểm tra thiết bị đã cảnh báo, cần mở bằng Safari. Các ca bị chặn hôm nay: nhân viên chấm lại bình thường; giờ vào trễ hơn thực tế thì dùng đơn chỉnh công/Admin sửa có audit.

## 2026-08-01 — Dashboard cộng LẶP doanh thu Ca 2: 29/07 hiện 13,17tr trong khi POS thật 8,42tr

### BUG-119 — Snapshot bị ghi đè lúc chốt Tổng ngày nhưng mốc "hóa đơn sau snapshot" vẫn là `created_at` (giờ chốt Ca 1)

- Severity: Critical (chủ quán báo "29/7 tới 13 triệu mấy nhưng số thực tế thấp hơn nhiều" — mọi ngày từ 25/07 đều bị thổi ~+doanh thu Ca 2).
- Status: **Đã sửa + ĐÃ DEPLOY 2026-08-01** (`gustino-operations-qwq0r32ix`, alias https://gustino-operations.vercel.app).

**Bằng chứng production (chỉ đọc):** với cả 12 ngày×chi nhánh 28–31/07: `APP_HIỂN_THỊ = snapshot + hóa_đơn_sau(created_at)` đều lớn hơn POS thật đúng bằng doanh thu Ca 2. Ngày 29/07: app 6.480.000+4.200.000+2.490.000 = **13.170.000đ**, POS thật 8.424.000đ — khớp từng đồng với lời chủ quán.

**Chuỗi nhân quả:** (1) từ bản 25/07 (BUG-116), chốt báo cáo **Ca 1** tạo dòng `report_snapshots` lúc ~15:17; (2) chốt **Tổng ngày** ~22:16 chỉ UPSERT payload — bảng không có `updated_at`, `created_at` đứng nguyên 15:17; (3) lớp bù BUG-104 trong `revenue.ts` cộng "hóa đơn tạo sau snapshot" so với `created_at` → toàn bộ hóa đơn Ca 2 (15:17→22:16) bị cộng LẶP lên trên summary vốn đã là CẢ NGÀY.

**Fix (chỉ hiển thị, tự lành cho mọi ngày cũ, KHÔNG đụng DB):** mọi đường ghi snapshot đều đóng dấu `payload.finalizedAt` tại thời điểm ghi → `revenue.ts` thêm `snapshotStatementAt()` = max(`created_at`, `payload.finalizedAt`, các `finalizedAt`/`n8nDelivery.updatedAt` trong `shiftReports`) và dùng mốc này cho lớp bù BUG-104. Ngày đã chốt: delta = hóa đơn sau 22:16 = 0 → hiện đúng POS; hóa đơn bán SAU khi chốt vẫn được cộng thêm (BUG-104 giữ nguyên); payload kiểu cũ không có `finalizedAt` rơi về `created_at` (hành vi cũ).

**Kiểm chứng:** `scripts/test-revenue-snapshot-statement-time.mjs` → `REVENUE_SNAPSHOT_STATEMENT_TIME_OK` (4 kịch bản, dùng đúng số thật 29/07 Gold Coast). **Đã kiểm tra ngược:** trả mốc về `created_at` là test đỏ với ĐÚNG số sai trên production (6.480.000). `tsc -b` + `npm run build` pass.

**Deploy & an toàn dữ liệu:** deploy frontend thuần — không migration, không ghi một dòng dữ liệu nào (cả phiên chỉ chạy SQL SELECT); alias chuyển nguyên tử, deployment cũ (`iust3h2vj`) còn nguyên để rollback tức thì. Verify live: `index-Ci89EB3M.js` khớp build local, `revenue-DmIf2ZO5.js` chứa mốc `finalizedAt`, `AttendancePage-DouwRAT7.js` chứa banner outbox, chunk `shiftReportScope` được phục vụ, `/api/server-time` + `/api/reverse-geocode` HTTP 200.

## 2026-08-01 — Doanh thu TỪNG CA sai số (ảnh Zalo Ca 1 + Ca 2 lệch Tổng ngày)

### BUG-117 — Báo cáo từng ca lọc hóa đơn theo cửa sổ giờ của phiên ca: hở khoảng trống, hở trước giờ mở, đếm trùng khi chồng giờ

- Severity: Critical (chủ quán đối chiếu 2 ảnh Zalo với tổng ngày thấy "sai số nặng, lỗi đồng bộ doanh thu").
- Status: **Đã sửa + ĐÃ DEPLOY 2026-08-01** (cùng lô BUG-118/119).

**Bằng chứng production (chỉ đọc, `scripts` chẩn đoán trong phiên 01/08):**
- Tổng NGÀY luôn đúng: 14 ngày gần nhất snapshot khớp POS 100%, không lệch business_date, không hóa đơn trùng.
- Nhưng số TỪNG CA trong `report_snapshots.payload.shiftReports` (nguồn 2 ảnh Zalo + kho báo cáo) lệch:
  - 31/07 `lotte-2310`: Ca 2 mở 17:17 (trễ 121 phút sau khi Ca 1 đóng 15:16) → **122.000đ bán trong khoảng trống biến mất khỏi CẢ HAI ảnh** (Ca 1 = Ca 2 = 681.000đ, ngày = 1.484.000đ).
  - 28/07 `gold-coast`: khoảng trống 20 phút (15:24→15:44) nuốt **662.000đ** (4 hóa đơn 15:32–15:43).
  - 29/07 `gold-coast`: hóa đơn HD2907-001 (89.000đ) tạo 09:01 **trước giờ mở phiên Ca 1** → không thuộc ca nào.
  - 28/07 `lotte-2310`: hóa đơn HD2807-010 (89.000đ) bị xóa 15:34 **sau khi ảnh Ca 1 đã chốt** → tổng 2 ca lớn hơn ngày 89.000đ (bản chất "báo cáo là ảnh chụp tại thời điểm chốt", không phải lỗi code — ghi nhận, không sửa hồi tố).

**Root cause:** `isTimestampInShift()` (ReportPage) + các bộ lọc tương tự (shiftCompetition, ShiftHandoverPage) chỉ nhận hóa đơn có `createdAt` nằm TRONG `startedAt..endedAt` của phiên ca. POS bán liên tục còn phiên ca do người bấm mở/đóng → mọi phút không có phiên nào mở là doanh thu "vô chủ".

**Fix — `src/lib/shiftReportScope.ts` (mới):** ngày được chia bằng đúng MỘT điểm cắt giữa hai ca kề nhau = `min(giờ đóng ca trước, giờ mở ca sau)`; ca đầu nhận từ đầu ngày, ca cuối nhận tới cuối ngày ⇒ **tổng các ca luôn bằng tổng ngày**. Áp tại: `ReportPage` (poster/scope UI + `reportModelForScope` + `saveCloud` — nơi sinh ảnh Zalo và snapshot ca), `shiftCompetition.ts` (doanh thu ca trưởng ở Dashboard/AdminPage), `ShiftHandoverPage.receiptsInSession` (khối "doanh thu trong ca"). **Màn Đối chiếu ca của AdminPage GIỮ NGUYÊN cửa sổ vật lý** — số liệu kho ở đó neo theo 2 lần kiểm đếm đầu/cuối ca, đổi sang phân vùng sẽ làm sai cột chênh lệch.

**Kiểm chứng:** `scripts/test-shift-report-scope.mjs` → `SHIFT_REPORT_SCOPE_OK` (7 kịch bản, tái hiện ĐÚNG số thật 31/07: trước vá Ca 2 = 681k, sau vá = 803k). **Đã kiểm tra ngược:** khôi phục hành vi cũ là test đỏ đúng 3 kịch bản với đúng số production. `tsc -b` + `npm run build` pass; `REPORT_DUAL_IMAGE_CONSISTENCY_OK`, `DAILY_REPORT_EMPLOYEE_ATTENDANCE_FLOW_OK`, `HANDOVER_SHIFT_RECOVERY_OK` (đã cập nhật 1 marker stale từ đợt 28/07), `test-shift-owner-must-be-leader`, `test-stock-and-sync-performance` xanh.

**Tồn đọng dữ liệu cũ (cần chủ quán duyệt):** snapshot ca của 28–29/07 và 31/07 nêu trên vẫn giữ số cũ trong `payload.shiftReports` (ảnh đã gửi không rút lại được). Tổng ngày không sai nên KHÔNG bắt buộc vá; muốn kho báo cáo hiển thị lại đúng từng ca thì phải tính lại và ghi đè payload — chỉ làm khi được duyệt.

## 2026-08-01 — Chấm công "không lưu": mất bằng chứng khi luồng chết giữa chừng

### BUG-118 — Check-in/check-out thất bại giữa chừng là mất luôn bằng chứng; nhân viên tưởng đã chấm, vài tiếng sau bị đòi chấm lại

- Severity: Critical (mất ngày công thật; tái diễn dù BUG-106/111/113/114 đã live từ 28/07 — vẫn còn 2 ca quên check-out 29–30/07 và các ca không có bản ghi check-in của cùng nhóm tài khoản hay gặp sự cố).
- Status: **Đã sửa + ĐÃ DEPLOY 2026-08-01** (cùng lô BUG-117/119).

**Bản chất còn sót sau BUG-114:** mọi hạn chót/retry chỉ cứu được khi nhân viên còn đứng chờ ở màn chấm công. Quầy đông → bấm nút xong nhét máy vào túi/chuyển sang Zalo; nếu GPS/upload/ghi DB chết sau đó thì thông báo lỗi không ai đọc và **bộ bằng chứng (ảnh đóng dấu + GPS + giờ thật) mất theo phiên trang**. DB xác nhận: các ca treo đều `updated_at = created_at` — lệnh chưa từng tới máy chủ.

**Fix — hộp thư đi chấm công:**
- `src/lib/attendanceOutbox.ts` (mới): lưu bằng chứng vào IndexedDB NGAY khi chụp/định vị xong, TRƯỚC khi upload/ghi DB; op chỉ bị xóa khi máy chủ xác nhận. Không có IndexedDB (Safari private) → fallback bộ nhớ phiên. **Lịch sử:** bản 01/08 từng tự dọn op quá 7 ngày; BUG-122 ngày 03/08 đã bỏ age-cap vì trái cam kết không mất bằng chứng. Đếm nhanh qua localStorage hiện chỉ là hint, không phải nguồn authoritative.
- `attendance.ts`: `checkIn`/`checkOut` ghi op trước, xóa op ở MỌI nhánh thành công (kể cả read-back trùng); lỗi thì op ở lại và thông báo nói rõ *"Bằng chứng đã được lưu trên máy — app sẽ TỰ GỬI LẠI khi có mạng, giữ nguyên giờ chấm công gốc."* `flushAttendanceOutbox()` gửi lại idempotent: kiểm tra máy chủ trước (đã có bản ghi/đã check-out → bỏ op), ghi bằng **giờ chấm gốc `capturedAt`** chứ không phải giờ gửi lại, đủ ảnh + GPS nên không đụng ràng buộc bằng chứng.
- `App.tsx`: flush nền mỗi 45s + khi `online`/`focus` từ BẤT KỲ trang nào (staff mở app là vào Bán hàng, không phải Chấm công).
- `AttendancePage`: banner vàng "N lượt chấm công chưa lên máy chủ" + nút **Gửi lại ngay** + ghi chú ⏳ trên từng thẻ ca đang chờ.
- Chống "bị bắt chấm công lại" phía ĐỌC: `fetchAttendanceRecords`/`fetchShiftRegistrations` **không bao giờ lọc bản ghi/ca của chính mình** theo bộ lọc active-branch — trục trặc tra cứu chi nhánh không còn làm màn chấm công tưởng "chưa check-in".

**Kiểm chứng lịch sử 01/08:** `scripts/test-attendance-outbox.mjs` → `ATTENDANCE_OUTBOX_OK` (khi đó còn age-cap 7 ngày). **Hợp đồng hiện tại sau BUG-122:** giữ cả op cũ cho tới xác nhận/rà soát, đồng thời test lỗi IndexedDB và độ bền RAM. `tsc -b` + `npm run build` pass; `ATTENDANCE_SINGLE_OPEN_SESSION_OK`, `ATTENDANCE_LATE_CHECKOUT_OK`, `DAILY_REPORT_EMPLOYEE_ATTENDANCE_FLOW_OK` xanh.

## 2026-07-26 — Vì sao không check-out được: ảnh vừa chụp bị xoá âm thầm

### BUG-114 — "Tải lại" xoá ảnh check-out, nút tắt bấm không phản hồi, thông báo cũ nằm lại

- Severity: Critical (mất ngày công thật, nhân viên tin là đã check-out).
- Status: **Đã sửa, chờ deploy.**
- Đây là câu trả lời cho "đã check-out đúng giờ nhưng sáng vô lại báo chưa check-out" — trước đó BUG-113 mới chỉ gỡ được phần *kẹt*, chưa giải thích được phần *vì sao không check-out được*.

**Bằng chứng thu hẹp (không phải suy đoán):**
1. 5 bản ghi treo đều có `updated_at = created_at` ⇒ không có lệnh UPDATE nào tới máy chủ.
2. Trong `storage.objects` bucket `attendance-selfies`, cả 5 ca treo **chỉ có 1 file** (ảnh check-in), trong khi mọi ca check-out thành công đều có **2 file**. ⇒ Luồng check-out **chết trước bước `uploadSelfie`**, tức trước cả GPS/ảnh — không phải lỗi mạng lúc ghi DB.
3. Mọi nhánh hỏng trong khoảng đó (GPS, địa chỉ, ảnh) đều hiện lỗi đỏ. Chỉ còn **đúng một đường thất bại im lặng**: nút Check-out đang bị `disabled` thì bấm vào không chạy handler, không báo gì.

**Tái hiện được 100%** (`scripts/qa-attendance-selfie-persistence.mjs`, trình duyệt thật):
```
SAU KHI CHỤP  → nút Check-out bật: true    (nhãn "Chụp lại ảnh check-out")
SAU "TẢI LẠI" → nút Check-out bật: false   (nhãn về lại "Chụp ảnh check-out")
BẤM NÚT TẮT   → thông báo: "Check-in thành công. Chúc bạn một ca làm việc tốt!"
```

**Root cause — ba lỗi cộng dồn:**
1. `selfies` là state của `SchedulePanel`, mà panel render dưới điều kiện `{!loading && …}`. Nút **"Tải lại"** (thêm ở BUG-111, deploy 22/07) gọi `refresh(true)` → `loading=true` → **panel bị tháo** → ảnh vừa chụp mất sạch, không cảnh báo.
2. Nút Check-out `disabled` khi chưa có ảnh. Nút tắt thì `onClick` không chạy, nên thông điệp "Bạn cần chụp ảnh bàn giao trước khi check-out" đã có sẵn trong code **không bao giờ hiện ra**.
3. Thanh feedback giữ nguyên dòng cũ. Nhân viên bấm Check-out, nhìn xuống thấy **"Check-in thành công"** màu xanh còn nằm đó → hiểu là xong → đi về.

**Fix:**
- `AttendancePage`: thêm cờ `ready` (đã tải xong lần đầu). Khung chờ chỉ hiện ở lần tải ĐẦU (`loading && !ready`); các panel render theo `ready` nên **tải lại không bao giờ tháo panel** ⇒ ảnh sống sót.
- Bỏ `!selfies[...]` khỏi `disabled` của cả Check-in lẫn Check-out: cho bấm để handler nói thẳng còn thiếu gì.
- `onFeedback('')` ngay đầu `handleCheckIn`/`handleCheckOut` để thông báo cũ không nằm lại.
- Thông điệp thiếu ảnh viết lại theo hành động: "Chưa có ảnh bàn giao nên chưa check-out được. Hãy bấm 'Chụp ảnh check-out' trước, rồi bấm Check-out lại."

**QA:** `scripts/qa-attendance-selfie-persistence.mjs` → `ATTENDANCE_SELFIE_PERSISTENCE_QA_OK`; đã thử khôi phục `{!loading && …}` để chắc test bắt được lỗi cũ (fail đúng chỗ). Toàn bộ `qa-attendance`, `qa-roles`, `qa-attendance-late-checkout`, `test-attendance-*`, `test-daily-report-employee-attendance-flow` xanh; `tsc -b` + `npm run build` pass.

**Còn lại:** đây là đường im lặng DUY NHẤT tìm được, và nó khớp mọi bằng chứng, nhưng không có log phía máy khách nên không khẳng định được 100% cả 5 ca đều đi đúng đường này. Hai ca trưởng (Phương, Thảo Nguyên) còn có thể vướng thêm chốt chặn bàn giao.

## 2026-07-26 — Quên check-out thành ngõ cụt: nhân viên không tự đóng được ca

### BUG-113 — Chặn cứng check-out quá hạn làm ca treo vĩnh viễn

- Severity: High (nhân viên mất ngày công, không có đường tự sửa).
- Status: **Đã sửa, chờ deploy** (bản đang chạy trên production vẫn là bản chặn cứng).
- Triệu chứng chủ quán báo: "nó không cho checkout sau giờ nữa… hồi đó còn check bù được, bây giờ kẹt cứng luôn"; và "đã check-out đúng giờ nhưng sáng vô lại thì báo chưa check-out".

**Đã kiểm chứng trên DB production (25–26/07):**
- 5 bản ghi treo: Uyên Thư + Huỳnh Phương Anh (24/07), Trương Thị Phương + Nguyễn Bình Thảo Nguyên + Nguyễn Ngọc Bảo Linh (25/07).
- Cả 5 đều có `updated_at = created_at` ⇒ **lệnh check-out chưa từng tới máy chủ**. Không phải hệ thống xoá mất giờ ra đã lưu; giờ ra chưa bao giờ được ghi.
- Không có bản ghi trùng cho cùng một đăng ký ca, không có trigger nào trên `attendance_records` ⇒ loại trừ giả thuyết "ghép nhầm bản ghi" và "bị reset".
- Chưa xác định được vì sao 3 bản ghi của nhân viên thường không gửi được lệnh check-out. 2/5 là ca trưởng nên có thể vướng chốt chặn bàn giao mới thêm (bấm check-out → hiện bảng "còn Ca X chưa bàn giao" → không ai bấm tiếp).

**Root cause của phần "kẹt cứng":** `isCheckOutOverdue()` (ân hạn 6 giờ sau giờ tan ca) biến ca quên check-out thành **ngõ cụt** — thẻ đỏ chỉ mời "gửi đơn khai giờ về" rồi chờ Admin duyệt. Mục tiêu ban đầu đúng (bấm nút sau nhiều ngày sẽ đóng dấu giờ hiện tại, đẻ ra ca 24h/96h/238h trên bảng công), nhưng cách chặn thì bỏ rơi người dùng.

**Fix — cho tự khai bù, chặn ở trần thay vì chặn cửa:**
- `src/lib/lateCheckOut.ts` (mới, không phụ thuộc Supabase nên test được bằng dữ liệu thật): `resolveLateCheckOutAt()` đổi giờ khai (HH:MM) thành mốc thời gian, chặn giờ trước/bằng giờ vào, giờ tương lai, và **không bao giờ cho vượt giờ tan ca theo lịch** ⇒ nhân viên khai bằng hoặc ít hơn lịch, không tự cộng giờ. Xử lý đúng ca qua đêm.
- `attendance.ts::lateCheckOut()`: đóng ca theo diện **hành chính** — không ảnh, không GPS, `check_out_address` mở đầu `[CHỐT HÀNH CHÍNH]` đúng nhánh 2 của ràng buộc `attendance_records_checkout_evidence_required` (không bịa bằng chứng có mặt). Vẫn `.is('check_out_time', null)` + read-back như check-out thường.
- `AttendancePage`: thẻ "Quên check-out" nay có ô giờ (mặc định = giờ tan ca, `max` = giờ tan ca) + nút **"Check-out bù"**; nút gửi đơn lùi về vai trò phụ cho trường hợp về SAU giờ tan ca (tăng ca) cần Admin duyệt.
- `lan-server.mjs`: nhận `lateCheckOutTime` và **tự kẹp lại trần một lần nữa** — client không được là nơi duy nhất quyết định số giờ vào bảng công.

**Dữ liệu đang treo:** để chính nhân viên tự đóng bằng nút mới (họ mới biết thực sự về lúc mấy giờ). `scripts/db_close_stale_attendance_20260726.sql` chỉ dùng khi họ không tự làm được — nó đóng theo giờ tan ca của lịch, tức giả định làm đủ ca, phải xác nhận với quản lý trước.

**QA:** `scripts/test-attendance-late-checkout.mjs` → `ATTENDANCE_LATE_CHECKOUT_OK` (12 ca giờ chạy thật qua esbuild, gồm ca qua đêm; đã thử phá trần để chắc test bắt được lỗi). `scripts/qa-attendance-late-checkout.mjs` → `ATTENDANCE_LATE_CHECKOUT_QA_OK` (trình duyệt thật: thẻ hiện đúng, mặc định 16:00, chặn khai 18:30, không ghi gì khi từ chối). `qa-attendance`, `test-attendance-idempotent-write`, `-intermittent-recovery`, `-duration-search`, `-native-camera-location`, `-reverse-geocode-race`, `test-daily-report-employee-attendance-flow` đều xanh; `tsc -b` + `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`).

## 2026-07-25 — Quên gửi báo cáo Tổng ngày + bấm nhầm bàn giao ca tối làm lệch doanh thu

### BUG-116 — Báo cáo Tổng ngày là bước ngầm dễ quên; bấm nhầm bàn giao ca tối rồi mở lại ngày làm ca tối 0đ

- Severity: High (lệch doanh thu hiển thị + báo cáo Zalo sai số).
- Status: **Deployed 2026-07-25** (`dpl_CMo51LVBbN8rLqQ7TngTJCcBrVeT`, https://gustino-operations.vercel.app), kèm cả lô 24/07 còn treo. Dữ liệu ngày cũ: chủ quán chọn bỏ qua (qua ngày rồi).
- Triệu chứng chủ quán báo: (1) hay quên "nhấn báo cáo tổng ngày" — tưởng bấm bàn giao là gửi 2 ảnh (Ca tối + Tổng ngày) nhưng thực ra phải làm tay nên quên; (2) một nhân viên bấm nhầm bàn giao ca tối, mở lại ngày thì "kết ca tối 0đ" và lệch doanh thu chi nhánh.

**Root cause (một chuỗi):**
1. Nút "Chốt & bàn giao ca" (`ShiftHandoverPage.tsx:649`) **một chạm là chốt**, không xác nhận → dễ bấm nhầm.
2. Việc tạo + gửi 2 ảnh báo cáo nằm ở `useEffect` tự động trong `ReportPage.tsx:626`, **chỉ chạy khi ca trưởng còn ở màn Báo cáo đủ lâu để poster render + `saveCloud()` xong**. Rời màn/tắt app sớm → Tổng ngày không gửi, không có lời nhắc → "phải làm thủ công nên quên".
3. Bấm nhầm ca tối → tự chốt ngày + gửi báo cáo dở dang (ca tối 0đ). "Mở lại ngày" chỉ mở `operation_days`, **không xoá snapshot đã lưu**; `revenue.ts` coi snapshot có `summary.revenue` là nguồn chuẩn (BUG-104/111) → ảnh đã gửi + kho báo cáo giữ số lệch cho tới khi có người nhớ chốt lại (đúng lỗi #1).

**Fix (không đổi ngữ nghĩa doanh thu):**
- `handoverReportRequest.ts`: `sessionStorage → localStorage` (yêu cầu chốt sống qua lần tắt app) + sự kiện `REPORT_PENDING_EVENT` + `pendingHandoverReportForToday()` (tự dọn ngày cũ).
- `ShiftHandoverPage`: thêm bước xác nhận `closeArmed` (bảng `.handover-close-confirm` kiểu capybara hỏi lại); ca tối cảnh báo rõ "sẽ CHỐT NGÀY và gửi Ca tối + Tổng ngày".
- `AppShell`: popup `report-pending-popup` nhắc "báo cáo chưa gửi" ở mọi trang cho ca trưởng, ẩn ở màn `report`, đọc cờ localStorage (không fetch).
- `ReportPage.reopenDay()`: mở lại ngày thì ghi lại cờ nhắc để buộc chốt & gửi lại bản đã sửa (không tự gửi ngay).

**Định vị chấm công (mục 3 chủ quán hỏi):** giữ nguyên theo lựa chọn của chủ quán — địa chỉ đã tới số nhà, GPS ≤150m/25s, **chưa chặn theo khoảng cách tới chi nhánh**. Máy Samsung (SM-A235F) lỗi do mở trong WebView Zalo (BUG-107) — đã có phát hiện + hướng dẫn "mở bằng Chrome" từ 21/07; cách chấm được: **mở bằng Chrome/Safari, đừng mở trong Zalo**.

**Dữ liệu đã lệch:** `scripts/db_diag_report_revenue_mismatch_20260725.sql` (chỉ đọc) tìm ngày lệch; `scripts/db_repair_stale_daily_report_20260725.sql` gỡ snapshot lệch + mở lại ngày để app chốt/gửi lại.

**QA:** `scripts/test-handover-report-reminder.mjs` → `HANDOVER_REPORT_REMINDER_OK`; `tsc -b` + `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`).

## 2026-07-22 — Nhân viên bán hàng mất tên trong báo cáo và màn chấm công quay vô tận

### BUG-111 — Doanh thu POS bị gắn vào đăng ký ca, và đường đọc chấm công không có hạn chót

- Severity: High.
- Status: Deployed — đã kiểm tra asset live; còn chờ xác nhận trên máy nhân viên đã đăng nhập.
- Triệu chứng chủ quán báo: (1) Cao Bảo Trân bán hàng nhưng không có tên trong báo cáo; (2) cùng nhân viên đó bấm chấm công thì màn hình cứ quay.

**Phần 1 — mất tên trong báo cáo.**

- Bằng chứng dữ liệu prod (chỉ đọc), tài khoản `24efd4c4-…ad23` (gold-coast, staff): có hóa đơn POS ở 12 ngày, nhưng 8 ngày trong đó **không có dòng `shift_registrations`** — 22/07, 20/07, 19/07, 18/07, 17/07, 16/07, 14/07, 13/07. Các ngày có đăng ký (21/07, 12/07, 11/07, 10/07) thì tên hiện bình thường.
- Root cause: `buildEmployeeRows()` trong `src/pages/ReportPage.tsx` dựng xong dòng nhân viên từ hóa đơn POS rồi **lọc bỏ lại bằng `registeredRowKeys`**, tức gắn quy kết doanh thu vào đăng ký ca. Tổng doanh thu vẫn đúng (tính từ `productRows`) nên lỗi không lộ ra ở con số tổng — chỉ mất tên và mất hoa hồng của người bán.
- Đây là tái phát của kết luận BUG-082: bản vá cũ không còn trong lịch sử repo hiện tại, còn regression `scripts/test-daily-report-employee-attendance-flow.mjs` thì vẫn nằm nguyên và **đang đỏ đúng dòng đó**.
- Fix: bỏ hoàn toàn bộ lọc theo đăng ký; dòng nhân viên chỉ còn được lọc bởi `hasSalesActivity` (có phát sinh bán hàng thật).

**Phần 2 — màn chấm công quay vô tận.**

- BUG-106 đã đặt hạn chót cứng cho mọi bước GHI (định vị 25s, ảnh 20s, upload 25s, insert 20s), nên nút Check-in không còn treo. Nhưng đường **ĐỌC** bị bỏ sót: `AttendancePage.refresh()` gọi `Promise.allSettled` 5 lệnh Supabase mà không lệnh nào có timeout, và supabase-js không tự đặt. Một request kẹt trên mạng chập chờn là `loading` không bao giờ tắt → cả trang đứng ở khối "Đang đồng bộ dữ liệu cần thiết", không có ca nào để bấm.
- Fix: `withAttendanceReadDeadline()` (`src/lib/attendance.ts`) đặt hạn 20 giây cho từng lệnh đọc và **báo lỗi rõ ràng** khi hết hạn thay vì nuốt; thêm nút "↻ Tải lại" ở đầu màn chấm công để không phải thoát app vào lại.
- Phân biệt với BUG-107: WebView Zalo trên SM-A235F là một lỗi khác, đã vá và đã live từ 21/07. Phiên gần nhất của tài khoản này là Chrome thật, nên lần báo lỗi ngày 22/07 không thuộc diện WebView.

- Verification: `DAILY_REPORT_EMPLOYEE_ATTENDANCE_FLOW_OK`, `ATTENDANCE_QA_OK`, `DEVICE_READINESS_QA_OK` (4/4 ca), cùng các regression báo cáo/chấm công khác đều xanh, gồm cả `test-shift-close-report-realtime` (test này đỏ trước đó là do phần bàn giao xuyên ca chưa commit, không phải do bản vá). `npx tsc -b` sạch; build pass `PRODUCTION_SUPABASE_BUNDLE_OK (index-qsAOlxms.js; revenue-04RjszTG.js)`.
- Production: deployment `gustino-operations-n3hwsotae` READY và đã trỏ alias `https://gustino-operations.vercel.app`. Live `index-qsAOlxms.js` chứa chuỗi hạn chót đọc; `AttendancePage-DrLlWSpU.js` chứa nút "Tải lại"; `ReportPage-DxkLKw6e.js` không còn `registeredRowKeys`.
- Phạm vi deploy: chỉ hai bản vá này. Phần bàn giao xuyên ca đang dở (`handoverReportRequest.ts`, `resolveLeaderShiftSession`) được giữ lại trong cây làm việc, KHÔNG lên production.
- Business/data safety: không sửa hàng dữ liệu nào, không chạy migration, không đổi công thức doanh thu/hoa hồng, không nới quy tắc ảnh/GPS/địa chỉ của chấm công.
- Tồn đọng: bản ghi chấm công `check_in 2026-07-21 07:56` của tài khoản này vẫn đang mở (`check_out_time` null); địa chỉ check-in là Tân Tạo, TP.HCM chứ không phải chi nhánh Nha Trang — nghi là lượt test, cần chủ quán xác nhận trước khi đóng hoặc xoá.

## 2026-07-22 — Order report table vertical text on phones

### BUG-110 — Six-column order report is squeezed into vertical character columns on phones

- Severity: High.
- Status: Deployed — live assets/API verified; signed-in phone confirmation pending.
- Evidence: the owner's signed-in phone screenshot shows the visible `order-report-table` squeezing `Tên hàng`, `Ngày đặt / nhận`, and `Người đặt` into one-character columns. Source confirms that this printable table always renders six columns at `width: 100%` with no mobile treatment, while the late global `.page td, .page th { overflow-wrap: anywhere; }` rule lowers every cell's minimum width to one character. BUG-105 protected only the separate compact history list below the report and did not cover this table.
- Reproduction: new `node scripts/test-orders-report-mobile-layout.mjs` exits 1 at the first missing mobile field label (`STT`) before implementation.
- Required fix: on narrow screens, render the visible table rows as readable label/value records with normal word wrapping and horizontal writing; explicitly exclude the temporary `order-report-sheet-export` class so the existing 1080×1350 image export remains a six-column table. Order data, statuses, permissions, workflow, and export dimensions must remain unchanged.
- Fix: each live request cell now carries its semantic mobile label. At ≤720px, only the on-screen report changes to stacked label/value records; its headings are hidden, labels are generated from `data-label`, normal word wrapping and `horizontal-tb` override the unsafe global minimum, and the quantity cell no longer forces a single line. The selector explicitly excludes `.order-report-sheet-export`.
- Verification: `ORDERS_REPORT_MOBILE_LAYOUT_OK`, `DASHBOARD_ORDERS_MOBILE_RECOVERY_OK`, `SITEWIDE_HORIZONTAL_TEXT_AUDIT_OK (72 source files)`, `SECTION_TITLE_MOBILE_WRAP_OK`, supply delivery, report toolbar and handover/report mobile overflow regressions all pass. The 225-button contract, business guards, owner UX, role/sidebar/deploy/pagination regressions, TypeScript and diff check also pass. The isolated 714-module production build passes `PRODUCTION_SUPABASE_BUNDLE_OK (index-C-_zOd5P.js; revenue-BmeCb_ZO.js)`; Orders/CSS are `OrdersPage-Dye4rRXr.js` / `index-B0QqMGy2.css`.
- Production: inspected prebuilt output contains 129 files, seven expected API functions, the existing cron and zero ZIP/SQL/env/migration/seed/purge/repair artifact. Deployment `dpl_6B9dCSaYLtfQSXPQ5L7PT6asvHUu` is READY and aliased to `https://gustino-operations.vercel.app`. Uncached live index, CSS, Orders chunk and `/api/server-time` all return HTTP 200; live assets contain the export exclusion, mobile `data-label` records, horizontal writing rule and `STT`/`Người đặt` labels.
- Visual limitation: in-app Browser discovery returned `[]`, so the live signed-in phone rendering is not inferred from static/asset evidence. One hard refresh and device confirmation remain.
- Business/data safety: no order value, state transition, permission, export dimension, API contract, schema, migration, webhook or production business row changed.

## 2026-07-22 — Manager sidebar color and vertical KPI/revenue text

### BUG-109 — Production Manager sidebar stays navy and narrow KPI headings collapse into vertical text

- Severity: Medium.
- Status: Deployed — live CSS/API verified; signed-in visual confirmation pending.
- Evidence: the owner's signed-in screenshot shows the Manager sidebar still using the navy legacy theme. Repository history proves the shared light-sidebar correction is commit `b595fca`, while the documented live deployment still serves the earlier `70377fa` asset. Separately, the mobile `.section-title` override used `grid-template-columns: 1fr auto`; the KPI header's two export buttons consumed the `auto` column and global `overflow-wrap:anywhere` allowed the title column's min-content width to fall to one character.
- Fix: retain one shared light sidebar for every role and remove stale regressions that required a Manager-only navy block. On screens up to 760px, section headers now use wrapping flex layout, keep a 180px title basis, cap the action group to the viewport, and force KPI/Revenue headings and eyebrow labels to horizontal normal word wrapping.
- Verification: `SECTION_TITLE_MOBILE_WRAP_OK`, `SITEWIDE_HORIZONTAL_TEXT_AUDIT_OK (72 source files)`, `ROLE_SPECIFIC_ADMIN_MANAGER_UI_OK`, `FIXED_SIDEBAR_NAVIGATION_OK`, Admin/owner/KPI/competition/Orders/report responsive regressions and the 225-button contract pass. Isolated TypeScript and the 714-module production build pass with `PRODUCTION_SUPABASE_BUNDLE_OK (index-CZbVOwX_.js; revenue-BzDOS57_.js)`. The source audit finds no vertical writing mode or `word-break:break-all`.
- Production: inspected prebuilt output has 129 files, seven expected API functions, the existing `0 17 * * *` cron and zero ZIP/SQL/env/migration/seed/purge/repair artifact. Deployment `dpl_9rCoxcfRbna4Pu3r4hkxJrZp3mAS` is READY and aliased to `https://gustino-operations.vercel.app`. Live index serves `index-CZbVOwX_.js` and `index-C3TRry9Y.css`; CSS returns 200, places the shared light sidebar after the base rule, contains no Manager-dark override and contains all 180px/horizontal-title markers. `/api/server-time` returns 200.
- Visual limitation: in-app Browser discovery returned `[]`, so a signed-in hard-refresh screenshot remains pending and is not inferred from static/live asset checks.
- Business/data safety: no KPI, revenue, role permission, navigation, formula, API, schema or production business row changed.

## 2026-07-21 — reported personnel/handover/attendance/dashboard/orders incident

### BUG-102 — Employee deletion can leave the Admin personnel surface blank

- Severity: High
- Status: Fixed locally — signed-in delete verification pending; not deployed in this batch.
- Evidence: the employee detail renderer returned `null` when the URL still referenced an ID removed from `accountEmployees`. The delete handler removed the row before guaranteeing a directory route, so a stale route/realtime deletion could leave the content area white until reload.
- Fix: after a successful owner-required permanent delete, clear the selected IDs and navigate to `#/admin/employees`; after any successful employee refresh, a missing detail ID automatically recovers to the directory. The renderer now has a visible recovery state instead of `null`.
- Verification: pre-fix source contract reproduced the null path; `ACCOUNT_ORPHAN_RECOVERY_OK`, `ADMIN_CRM_DIRECTORY_OK`, TypeScript and the 712-module production build pass. No employee/Auth/profile row was deleted during verification.

### BUG-103 — Fast coarse reverse-geocode result can hide the correct street/ward address

- Severity: High
- Status: Fixed locally — physical HTTPS phone verification pending; not deployed in this batch.
- Evidence: both approved providers ran concurrently, but `Promise.any` returned whichever concrete string arrived first. BigDataCloud commonly returns locality/city/province faster than Nominatim returns street/ward, so valid fresh GPS coordinates could be stamped with an overly broad location. This is an address-selection defect, not proof that the device coordinates themselves were wrong.
- Fix: start both providers concurrently, prefer Nominatim if it arrives first or within an 800 ms grace after the administrative fallback, then use the fallback. Cloud and LAN share this bounded preference; 5-second provider limits and the 6.5-second client bound remain.
- Verification: mocked real handler proves a 5 ms coarse result no longer beats a 40 ms street/ward result and still falls back when the detailed provider fails. `ATTENDANCE_REVERSE_GEOCODE_RACE_OK`, intermittent/idempotent/native-location/LAN integration regressions, syntax, TypeScript and build pass. GPS freshness, ≤150 m accuracy, selfie and concrete-address rules are unchanged.

### BUG-104 — Manager revenue Dashboard can stay stale after realtime disconnect

- Severity: High
- Status: Fixed locally — signed-in/live-data verification pending; not deployed in this batch.
- Evidence: the cloud Manager Dashboard subscribed to receipt/snapshot/ledger changes but, unlike Admin management, had no periodic/focus/visibility reconciliation. A dropped subscription could leave old totals indefinitely. Separately, a numeric report snapshot suppressed all later POS receipts; the exact 23/10 fixture was stuck at 554,000đ/10 instead of 1,798,000đ/35.
- Fix: retain the snapshot as a point-in-time baseline, add only receipts created after it, and keep one branch/day row. Manager Dashboard retains all realtime subscriptions and now also reconciles every 30 seconds and on window focus/tab visibility; LAN retains its 5-second fallback.
- Verification: `SHIFT_CLOSE_REPORT_REALTIME_OK` proves 554,000đ + 1,244,000đ = 1,798,000đ and 10 + 25 = 35 without double counting. Revenue fallback, sales consistency, dashboard recovery, management realtime, TypeScript and production bundle guard pass.

### BUG-105 — Compact sent-order rows force Vietnamese text into vertical character columns on phones

- Severity: Medium
- Status: Fixed locally — physical-phone visual verification pending; not deployed in this batch.
- Evidence: the general ≤720 px rule requested one column, but the higher-specificity `.supply-request-list.compact .supply-request-item` rule kept `26px / minmax(0,1fr) / auto`. Status/actions consumed the auto column; global `overflow-wrap:anywhere` then broke the squeezed product/note column at arbitrary characters.
- Fix: the phone-specific compact selector now uses icon + content columns, moves the tail/status/actions to a full-width row, restores normal word breaking and stacks actions again below 380 px. Order data, status transitions and export layout are unchanged.
- Verification: `DASHBOARD_ORDERS_MOBILE_RECOVERY_OK`, supply-delivery, mobile report, toolbar, TypeScript, diff check and the production build pass.

### MOD-08/MOD-13 follow-up — Vũng Tàu handover and n8n chain

- The existing BUG-096/099/100/101 fixes remain the applicable causes: exact persisted owner ID, configured Ca 1/Ca 2 assignment, bounded custom/all-day coverage, handover intent consumption, Ca 1 shift-only scope and Ca 2 shift+day scope with immediate n8n intent.
- This batch additionally stops swallowing `fetchWorkShifts()` failures as `[]`, so a schedule-read outage is visible instead of silently stranding the next leader. Regression also caught and restored the connected `Lưu ảnh` label/class.
- `AUTO_SECOND_SHIFT_START_OK`, `SHIFT_CLOSE_REPORT_REALTIME_OK`, shift realtime, finalization, n8n queue/runtime, Zalo workflow and report-access regressions pass. No n8n webhook, report finalization or production business row was invoked; one signed-in Vũng Tàu close/finalize receipt remains pending.

## 2026-07-20 — MOD-04 isolated integration found no new product bug

- The account API lifecycle passed in a fresh local store. The only failed assertion targeted the retired `#admin-accounts` heading; current source and regression evidence use `#/admin/employees`, `Nhân sự & Chi nhánh` and the collapsed `Tạo mới` panel.
- After updating the harness, browser/API integration and five related regressions passed. No bug ID was opened and no application/business logic changed.
- Production `manage-employee` deployment and real Auth-account verification remain pending and were not inferred from LAN success.

## 2026-07-20 — MOD-08 isolated integration found no new product bug

- The previously recorded `qa-handover.mjs` failure was confirmed as test-harness drift: the harness attempted cross-user registration, expected a removed manual receive button and followed an obsolete report-navigation step.
- After aligning the harness with the existing self-registration, automatic-open and close-to-report contracts, the isolated browser run completed both shifts and six related regressions passed.
- No bug ID was opened and no application/business logic was changed. Cloud/multi-device evidence is still required before MOD-08 can be complete.

# BUG-085 — Handover/report controls and hidden poster can overflow narrow phones

- Severity: High
- Status: Closed — fixed and production verified.
- Evidence: owner reports mobile CSS overflow after the report-access release. Source has an inline flex header action group without a narrow-phone layout contract, keeps report actions in two columns until 380px, keeps the visible poster in two columns at 430px, and positions persistent/export 1080px posters with viewport-relative negative offsets (`-400vw`/`-200vw`). At narrow widths those off-canvas frames can still extend into the document box.
- Pre-fix test: `node scripts/test-mobile-handover-report-overflow.mjs` exits 1 at the missing responsive handover action class; the remaining source assertions also lock report-stage overflow, single-column phone actions/poster and viewport-independent off-canvas placement.
- Fix: Bàn giao header actions now have a scoped responsive class and stack at 430px; report actions stack at 480px; the on-screen poster becomes one column at 430px with extra 360px hardening; report/page/stage lock horizontal overflow. Both 1080px capture frames now use `left: -10000px`, fully outside any phone viewport while retaining their exact width.
- Verification: `MOBILE_HANDOVER_REPORT_OVERFLOW_OK`, handover access, report-toolbar mobile, report/inventory UX, n8n/Zalo/finalization/auto-close, sales freshness, image/button contracts, attendance, Capy and revenue regressions pass with TypeScript and diff checks. Normal and guarded Vercel production builds pass with 706 modules; the inspected 123-file output has the intended mobile/action/export markers, six expected API functions and no SQL/migration/seed/purge/repair/ZIP/env artifact. Deployment `dpl_5nenFYDNPLVQYXw82nQkzbCDTkqY` is Ready and aliased; live index/CSS/Handover/Report/revenue/API markers pass, including unauthenticated n8n 401. Report data, export dimensions, finalization and n8n are unchanged. Signed-in physical-phone visual confirmation remains pending because the required Browser runtime is unavailable.

# BUG-084 — Ca trưởng cannot reopen the current daily report after handover

- Severity: High
- Status: Closed — fixed and production verified.
- Evidence: the handover completion card tells the shift leader to open Báo cáo, but `ShiftHandoverPage` renders no report action or report navigation item. The automatic close flow can navigate to `ReportPage` once, but after leaving that page the leader has no visible way back to the current daily poster.
- Impact: the n8n automatic delivery remains independent, but the operator cannot review or manually save the already-rendered report image after returning to Bàn giao ca.
- Pre-fix test: `node scripts/test-handover-daily-report-access.mjs` exits 1 on the missing handover action. Existing `ReportPage.exportInfographicImage()` is connected, but its visible label changes from `Lưu ảnh` to `Tải ảnh` when the page is reopened.
- Fix: one `Xem báo cáo ngày` action appears in the Bàn giao header after at least one same-day shift is closed and navigates to the existing `report` route. The existing connected image-export action is now consistently labelled `Lưu ảnh`.
- Verification: `HANDOVER_DAILY_REPORT_ACCESS_OK`, report/action/finalization/n8n/archive/role/attendance/button/revenue/Admin regressions, TypeScript, diff check and both 706-module production builds pass. Report formulas, finalization gates, snapshots, n8n scheduling and database data are unchanged.
- Production: deployment `dpl_CVAFxe8L3YxUqQUtTJadGh3vXJVQ` is Ready and aliased to `https://gustino-operations.vercel.app`. Uncached live index/main/Handover/Report/revenue/API reads return 200 and contain the new report-access/save-image markers plus the existing revenue guards. Unauthenticated n8n revenue remains 401. No migration or business-data write ran.

# BUG-083 — POS same-day deletion used the database UTC date

- Severity: High
- Status: Closed — fixed and production verified.
- Evidence: `test-business-date-contract.mjs` fails and the linked production `delete_pos_receipt(uuid)` definition compares `business_date = current_date`. The rest of the application defines the business day in UTC+7 (`Asia/Bangkok`).
- Impact: during the UTC/UTC+7 boundary, an employee can be incorrectly blocked from deleting their own current-business-day mistaken receipt or the guard can evaluate the wrong date.
- Planned minimal fix: replace only the function's date expression with `timezone('Asia/Bangkok', now())::date`; preserve manager override, ownership requirement, same-day-only rule, cascade behavior and API signature. No receipt row will be deleted during verification.
- Production verification: the targeted function replacement applied successfully. Read-only catalog inspection proves `SECURITY DEFINER`, `search_path=public`, authenticated execute, UTC+7 date guard, manager override and creator/seller ownership guard all remain installed. The function was never invoked; no receipt/item row was deleted.

# BUG-082 — Manager report archive blocked, POS seller omitted, and missing-shift attendance dead end

- Severity: Critical
- Status: Deployed — signed-in/device confirmation pending.
- Evidence (read-only production, 2026-07-18): Management RLS and `ReportArchivePage` support Manager, but `MANAGER_NAV` omitted the archive and `App.canAccessPage` rejected it. Gold Coast has eight same-day receipts totaling 544,000đ for one active staff seller, while that seller has no same-day registration and is absent from `report_snapshots.payload.dailyReport.employeeRows`.
- Root cause: frontend permission drift for Manager; `buildEmployeeRows()` builds the POS seller row and then removes it through `registeredRowKeys`, incorrectly coupling sales attribution to attendance registration.
- Attendance evidence: same-day production has many completed check-in/out records across all three real branches; three active employees with approved shifts have no attendance today, but their Auth `last_sign_in_at` is 2026-07-15 and there is no surviving selfie upload without an attendance row. Other active employees have no same-day registration at all. This proves the UI must distinguish “missing registration” from an actual write failure; it does not justify fabricating a shift or weakening photo/GPS/address rules.
- Pre-fix tests: `test-manager-report-archive-access.mjs` and `test-daily-report-employee-attendance-flow.mjs` fail on the exact source contracts. No database row, snapshot, attendance record, migration or permission policy was changed during reproduction.
- Fix: Manager legacy navigation and route now open the existing archive; POS/allocation sellers survive independently of registration and are still filtered by actual sales activity; an employee with no same-day registration gets a direct action to the existing weekly registration board.
- Archive follow-up reproduction: `ReportArchivePage` renders only `employeeRows.slice(0, 6)`, and the finalized Gold Coast snapshot predates the seller-filter fix. The affected 544,000đ seller is seventh by revenue, so the archive would continue hiding the name even after the live report fix. A new regression requires read-only POS enrichment for missing snapshot sellers and prohibits six-row truncation.
- Verification: both focused regressions, sales/report finalization consistency, five attendance write/camera/schedule/delete regressions, role UI, report/Zalo/finalization/auto-close/realtime tests, authorization, button, revenue/lazy/Capy checks, app TypeScript, diff check and the 706-module production build pass. No snapshot or attendance row was rewritten.
- Production: final deployment `dpl_29oz46e4FAu4Rwodk48QgU9GuJcG` is Ready and aliased to the main URL. Live main/Report/Attendance/Archive/Manager/revenue/CSS/API assets return 200 and contain Manager archive, missing-shift registration, POS archive recovery and revenue-fallback markers; archive has no six-row slice. Postdeploy read-only data has 33 active profiles, zero Auth/profile orphans, 161 same-day receipts totaling 10,868,000đ, 24 attendance rows and the affected seller's eight receipts/544,000đ intact.

# BUG-081 — Admin still rendered an icon dock plus a second card-menu launcher

- Status: Fixed locally; not deployed.
- Evidence: persisted `gustino_sidebar_collapsed=1` reopened the primary sidebar without labels, while `AdminPage` rendered `MANAGEMENT_FUNCTIONS.map(...)` as a second long card navigation column. Account/language controls were also kept in the sidebar, and Dashboard KPI cards were navigation buttons.
- Fix: default sidebar is expanded; deleted the feature-card array, renderer, derived state and stats helper; added a fixed CRM header for branch/language/notification/account; kept Settings/Logout at the sidebar foot; Dashboard KPI surfaces are read-only summary articles.
- Verification: `FIXED_SIDEBAR_NAVIGATION_OK`, `ADMIN_CRM_DIRECTORY_OK`, cashier and revenue-fallback regressions, TypeScript and build Passed (`index-BYtnJwjo.js`).
- Production safety: no deploy or database change. Production remains on `dpl_FndraMf5uHZY5HrWTS6HwL4qyuUP`.

# BUG-080 — New production deployment regressed partial-snapshot revenue fallback

- Status: Mitigated in production by rollback.
- Evidence: live deployment `dpl_G3HdvAvMkjN3ZACFxjgxPBDKodQ8` served `revenue-CgZR7Sle.js`; it reserved every snapshot branch/day before checking whether summary revenue existed, then mapped missing revenue to zero. The deployed chunk contained no `hasRevenueSummary` guard.
- Production action: rolled the alias back to `dpl_FndraMf5uHZY5HrWTS6HwL4qyuUP`, the prior isolated revenue-fix deployment.
- Verification: alias inspection is Ready; live `revenue-DAOjZKDM.js` contains the guard and receipt fallback, and `REVENUE_PARTIAL_SNAPSHOT_FALLBACK_OK` Passed.
- Data safety: no database write, restore, migration or schema change occurred.

# BUG-079 — Admin exposed mixed legacy workspaces and POS had no dedicated cashier/payment-print contract

- Status: Fixed locally; production database schema applied; frontend/Edge not deployed.
- Evidence: Admin navigation mixed ManagerDashboard, focused Admin pages and the new Management workspace. POS roles were staff/shift-leader only, checkout hard-coded cash, did not store customer-paid/change, had no print action, and generated codes from client receipt count.
- Fix: one visible Management navigation; branch-scoped cashier role; atomic server checkout with UTC+7 date guard and advisory-lock receipt sequence; cash/QR/card, customer paid/change and 80mm print layout.
- Verification: `CASHIER_POS_WORKSPACE_OK`, `ADMIN_CRM_DIRECTORY_OK`, account/lazy-route/core-button regressions, 219-button contract, TypeScript, LAN syntax and production build/bundle guard pass. Linked read-only catalog audit confirms the production role/columns/RPC.
- Visual/performance follow-up: Admin/POS now share one responsive visual system. Root cause of reported lag was `managementDataNeeds`/realtime returning every dataset whenever the unified non-focused workspace was used; section-specific reads/subscriptions now apply to every section except Overview.
- Routing follow-up: Management sections and employee/branch subpages previously changed only React state, so the URL stayed fixed and browser history/refresh/deep links did not represent the visible page. They now use durable client-side routes with hash synchronization.
- Extraction follow-up: employee records now render through an independent `EmployeesPage` table with page-owned filters and record pagination. Employee and branch directory URLs no longer render both directories together, and the employee create form is a responsive drawer. Branch details and the remaining module bodies still live in `AdminPage.tsx`, so the architectural extraction remains in progress. Focused CRM/orphan-account tests, TypeScript and build Passed; no deploy.
- Branch extraction follow-up: the branch directory is now an independent `BranchesPage` table with search and record pagination. Staffing, receipt count and period revenue are derived from the same existing sources, and row navigation opens the durable branch detail route. Branch detail and other Admin module bodies remain to be extracted. Focused tests, TypeScript and build Passed; no deploy.
- Commercial-CRM prompt follow-up: despite durable hashes, the visible Admin sidebar and Dashboard command cards still mutated section state directly, and every module began with an oversized descriptive hero card. Navigation now goes exclusively through `adminRouteForSection`, and the demo-style hero was removed. Remaining conditional module bodies are still in the monolith and must be extracted before BUG-079 can be considered architecturally complete.
- Dashboard extraction follow-up: the Overview module is now an independent `DashboardPage`, not inline Dashboard JSX. It preserves the connected revenue, probation, checkout, purchasing, inventory, archive, waste and online-session sources while delegating module changes to the route callback. Attendance, Payroll, Inventory, Purchasing, Revenue and detail modules remain to be extracted.
- Navigation follow-up: `AppShell` still rendered a full horizontal `mobile-nav` and hid the sidebar at 900px, contradicting the requested desktop/tablet CRM layout. The bottom-nav element is removed; desktop/tablet now retain a fixed 252px pastel sidebar, mobile uses a hamburger drawer, active styling remains URL-derived through `page/currentSection`, and obsolete bottom spacing is removed. `FIXED_SIDEBAR_NAVIGATION_OK` and related regressions/build Passed.

# BUG-078 — Admin personnel and branch management mixed legacy UI with incomplete CRM records

- Status: Fixed locally; database migration applied; frontend not deployed.
- Evidence: branch creation lived in Control Center, account creation remained a separate legacy presentation, and employee records had no persisted employment lifecycle fields or monthly payroll/POS drill-down.
- Fix: one list → detail CRM presentation, branch creation beside the branch directory, lifecycle metadata behind Admin-only RPCs, saved payroll history, receipt-backed employee sales detail, and truthful hourly/fixed salary labels.
- Verification: `ADMIN_CRM_DIRECTORY_OK`, `ACCOUNT_ORPHAN_RECOVERY_OK`, `CORE_BUSINESS_BUTTON_GUARDS_OK`, `LOGIN_LAZY_ROUTE_RECOVERY_OK`, LAN syntax, app TypeScript and the 700-module production build/bundle guard pass. Linked read-only catalog verification confirms seven CRM columns and two Admin-guarded RPCs.
- Follow-up: the focused Accounts data-needs map loaded employees only, so employee sales and attendance could remain empty even though their panels were rendered. Accounts now fetches/subscribes to receipts/items/attendance; ID-less legacy sales fall back to name only within the employee's branch. The visible design label and explanatory implementation copy were removed per owner feedback.
- Workspace batch 1: employee detail is now separated into Overview/Attendance/Sales/Payroll/Account tabs; the directory has search/branch/status filters; unresolved seller receipts are visible as `Doanh số chưa phân bổ`. The account-orphan regression was narrowed to the `accountEmployees` definition after the new status-filter block legitimately introduced an inactive condition downstream.
- Responsive/date follow-up: attendance correction actions previously overflowed medium-width content because the row required five fixed/minimum columns. The 721–1180px layout now places actions on their own row. Accounts no longer hides the global branch/date/quick-range bar, and directory filters also cover role and employment type.
- Overview/branch workspace follow-up: the old overview exposed reports without a compact actionable triage layer, and branch detail mixed its chart and employee list in one page. Overview now provides clickable operational alerts; branch detail separates Revenue, Employees, Attendance, Inventory and Orders while reusing existing sources and business rules.

## BUG-077 — Partial Vũng Tàu snapshot hides live POS revenue

- Severity: Critical
- Status: Deployed; signed-in UI verification pending
- Production evidence (read-only, 2026-07-18): `lotte-vt` has 23 receipts, 27 sold units and 1,260,000đ; receipt headers match item totals. The same-day `report_snapshots` row created at 07:04 UTC has no `payload.summary.revenue` or `totalSold`.
- Root cause: `buildDailyRevenueRows()` treated every snapshot branch/date as authoritative. The incomplete snapshot reserved the day key and suppressed all live receipt rows, then rendered its missing revenue as zero.
- Fix: only a snapshot with a numeric revenue summary may suppress same-day POS receipts. When POS exists, an incomplete snapshot is omitted rather than producing a duplicate zero row. Complete historical snapshots keep their existing priority.
- Verification: `REVENUE_PARTIAL_SNAPSHOT_FALLBACK_OK`, app TypeScript and the isolated 700-module production build/bundle guard pass. Deployment `dpl_FndraMf5uHZY5HrWTS6HwL4qyuUP` is READY and aliased to the main URL. Live index/main/revenue assets and server-time return 200; the live revenue chunk contains the fallback marker. No production database write, restore or snapshot mutation occurred.
- Recurrence prevention (17:13): unrelated deployment `dpl_H49JQJEVPS8hrNQuHH6yf7mBc7H4` again served a revenue chunk without the guard and was immediately removed from the main alias. The alias is back on the isolated safe deployment. The mandatory production bundle check now asserts the built `revenue-*.js` contains both `hasRevenueSummary` and receipt fallback, causing future regressed builds to fail before deployment.

## BUG-076 — Post-login lazy route can hang without throwing a recognized chunk error

- Severity: High
- Status: Fixed locally; real-login verification pending
- Evidence: owner reports the blank screen after login again resolves only after manual reload. Existing recovery covered recognized rejected chunk imports but had no bounded recovery when Suspense stayed pending without an error.
- Fix: while a route fallback is mounted, an 8-second watchdog performs at most one automatic reload; successful route render clears its session marker. Existing stale-chunk matching, roles, default pages and authentication are unchanged.
- Verification: `LOGIN_LAZY_ROUTE_RECOVERY_OK`, critical-load, operations/performance, UI-button, TypeScript and 700-module build/bundle guard pass.
- Safety: session-scoped one-time recovery only; no deploy or data mutation.

## BUG-075 — Admin People remained card-based instead of CRM master-detail

- Severity: Medium
- Status: Fixed locally; visual verification pending
- Evidence: owner confirmed the prior CRM preview still exposed avatar/profile/role/password/delete controls on every employee card. `ADMIN_CRM_DIRECTORY_OK` now proves directory rows contain none of those controls and the selected employee profile contains all existing operations.
- Fix: use compact branch and employee directories plus dedicated restaurant and employee detail pages. Existing handlers, permissions, APIs and calculations are unchanged.
- Verification: focused CRM/account/button/performance/load/polish regressions, app TypeScript, diff check and the 700-module build/bundle guard pass.
- Safety: no deployment, database write, account mutation or business-rule change occurred.

## BUG-072 — Custom shared SKU disappears again after reload when catalog read fails

- Severity: High
- Status: Fixed locally; production/browser verification pending
- Evidence: `InventoryPage` already renders `stock` without the zero-quantity filter, but `fetchConfiguredProducts()` previously stored the merged cloud catalog only in module memory and callers swallowed fetch errors. On a fresh reload with a failed/slow cloud read, `getProducts()` used only `baseConfiguredProducts()`, which has no custom `TP-BANH`.
- Fix: persist the last successful merged catalog and its tombstones in browser storage; hydrate it before the cloud read and retain it only as a read-only fallback when that read errors. The cloud response remains authoritative whenever available.
- Verification: `test-processing-product-linkage`, `test-product-delete-tombstone`, `test-report-inventory-ux`, and app TypeScript pass.
- Safety: no SKU, stock movement, historical row, schema, production service, or deployment was changed.

Last updated: 2026-07-18

Seventy-four evidence-backed tracker entries are recorded below. Fixed-in-code issues remain open until their explicitly listed physical-device, UI, or multi-device verification is completed.

| ID | Severity | Module | Status | Evidence | Root cause/fix/verification |
|---|---|---|---|---|---|
| BUG-074 | High | MOD-10 / Shared SKU branch visibility | Deployed — Signed-in visual verification pending | Owner states the SKU catalog is company-wide and every branch must contain `Thành phẩm bánh hạt dẻ`. Production proves active shared SKU `custom-tp-banh`/`TP-BANH` exists and Lotte 23/10 has a 10-piece `processing_in`, but `InventoryPage` filtered the catalog-derived stock list through `isVisibleStockLine`, hiding every zero-stock SKU at other branches. | Render every active catalog SKU at every branch, showing zero where no movement/count exists. Preserve branch-specific quantities, outbound eligibility (`expected > 0.0001`), count-form defaults and all movement formulas/writes. Processing linkage, tombstone, inventory/report, manager workspace, business guards, TypeScript, 700-module build/bundle guard and live Inventory asset verification pass. Production deployment `dpl_9Nys88HQDf8YAwTPGAbV9YmirXK2` is Ready. |
| BUG-073 | High | MOD-04 / Inactive account hard delete | Closed — Fixed and production verified | Predeploy read-only audit showed 37/37 Auth/profile rows with zero orphan/tombstoned/identity anomalies, but four inactive profiles (`nhanvien1`, `catruong1`, `catruong2`, `nhanvien2`) still had matching Auth users and reserved usernames. Source showed “Xóa sạch test” was disabled when `active=false`. Live Admin asset now contains the inactive/username warning and enabled hard-delete contract. During the deploy window five accounts were concurrently removed; postdeploy audit is 32 Auth/32 profiles with no inactive, orphan, tombstone or orphan identity. | Inactive accounts remain visible with explicit username ownership until hard-delete. Admin hard-delete is allowed for inactive accounts while the signed-in account remains protected. Edge Function deletes Auth before profile and reports failure instead of hiding a profile after partial deletion. `ACCOUNT_ORPHAN_RECOVERY_OK`, TypeScript/business guards and live asset/read-only audits pass. No account restoration was attempted. |
| BUG-072 | Medium | MOD-20 / Excess global loading overlay | Deployed — Production visual verification pending | Owner reports excessive loading. `GlobalLoadingOverlay` marked every click/select/file change and treated every fetch occurring in the following 900 ms as user-associated, so unrelated polling/realtime reconciliation could display a blocking Capy window. Production now serves `index-BT7XTrnq.js` without the root-mounted interceptor. | Unmounted the automatic global fetch interceptor. Explicit authentication, lazy-route/page loaders and local button busy states remain because they have accurate operation context. Loading/account/performance/lazy-route/business regressions, TypeScript, production build/bundle guard and live HTTP asset verification pass. |
| BUG-071 | High | MOD-06 / Schedule-attendance synchronization | Closed — Fixed and production verified | Owner confirmed 09:00–13:00 is authoritative. During repair, Phạm Đình Phát had check-ins against both registrations: 09:02 on the stale 09:00–17:00 row and 10:01 on the correct 09:00–13:00 row. Guarded repair removed only the stale attendance/registration after saving their complete before-state to `control_audit_entries`. Post-repair audit shows one 18/07 registration (09:00–13:00) and its one open attendance (10:01); the 19/07 shift is unchanged. | `set_schedule_registration_safe` now locks and updates the single attended main registration in place, removes only unattached duplicate main registrations, blocks OFF after check-in and refuses ambiguous days with multiple attended main shifts. It never updates/deletes attendance evidence. `SCHEDULE_ATTENDANCE_REGISTRATION_SYNC_OK` plus attendance delete/idempotency/native/mobile regressions and TypeScript pass; the targeted migration and guarded repair both applied successfully. |
| BUG-001 | Medium | MOD-02 / QA infrastructure | Closed — Fixed and verified | Pre-fix attempt 3 failed with 19/22 routes. Post-fix static check exited 0: `AUTH_STATIC_OK (22 routes đồng bộ qua type/hash/render/matrix)`. Regression TypeScript check exited 0 in 11.1 s. | Root cause: `allPages` was not updated when three admin-only routes existed. Only those routes were added; permission logic unchanged. UI matrix execution remains separately blocked and is not claimed Passed. |
| BUG-002 | High | MOD-02 / Database authorization | Blocked — Requires Business Decision | `node scripts/test-authorization-active-guard.mjs` fails. `20260702_branch_deactivate_accounts.sql` states old sessions cannot keep operating and sets branch users' profiles inactive. `schema.sql` `current_profile()` does not filter `active`; latest `20260701_branch_core_repair.sql` `can_manage_branch()` checks role/branch only; RLS policies use these helpers. | Root cause: UI/login and selected admin RPCs check `profiles.active`, but shared RLS authorization helpers do not, so an existing authenticated DB session can still satisfy role/branch policies after profile deactivation. A fix requires changing DB authorization/permission (for example an active-aware helper/policy) and a safe migration, which is prohibited without direct approval. Impact: inactive shift leader/staff sessions and potentially any deactivated profile accessing protected business data until auth token/session is independently invalidated. Integration verification requires isolated Supabase. |
| BUG-003 | Critical | MOD-02 / LAN API authentication | Blocked — Requires Business Decision | `node scripts/test-lan-auth-contract.mjs` fails and prints `actor()` fallback reading `x-user-id`, `x-user-role`, `x-user-branch(es)` when Bearer token is missing/invalid. `PUT /api/branches` checks only `user.role !== 'admin'`; many other routes check only id/role. LAN login already creates `sessions.set(authToken, ...)`, and client `userHeaders` sends Bearer token. | Root cause: backward/fallback identity headers are treated as authority even though marked `authenticated:false`; route guards inconsistently require `authenticated`. An unauthenticated caller can claim admin/manager/shift-leader identity and reach protected reads/writes. Fix requires enforcing server-issued session tokens globally or on every protected route, changing API authentication/permissions; direct approval is required. Impact includes branch configuration and other LAN business data. No exploit request was sent and no data changed. |
| BUG-004 | High | MOD-06 / iPhone attendance photo and clock | Fixed in code — Device verification pending | Pre-fix `node scripts/test-mobile-attendance-export.mjs` failed. Post-fix the same test reports `MOBILE_ATTENDANCE_EXPORT_OK`; TypeScript no-emit and LAN server syntax checks pass. User reports one iPhone 11 intermittently cannot check in/out. | Added EXIF-aware `createImageBitmap` plus HTML image fallback, server-time preference, LAN server timestamp enforcement, idempotent duplicate recovery, and refresh-after-error. GPS now samples up to 12 seconds and rejects fixes worse than 150m. Direct iPhone 11 camera/GPS verification remains required before closure. |
| BUG-005 | Medium | MOD-17 / iPhone infographic export | Fixed in code — Device verification pending | Pre-fix test failed on detached data-URL download. Post-fix `MOBILE_ATTENDANCE_EXPORT_OK`, TypeScript no-emit passes. | Report and inventory exports now create Blob/File, prefer the native Share Sheet, use attached object-URL download fallback, and state that iPhone users must choose “Lưu hình ảnh”/“Lưu vào Tệp”; no unconditional saved-file claim remains. Direct iPhone verification pending. |
| BUG-006 | Medium | MOD-13 / mobile report leaderboard overflow | Fixed in code — UI verification pending | Pre-fix `node scripts/test-report-inventory-ux.mjs` failed. Post-fix it reports `REPORT_INVENTORY_UX_OK`; TypeScript no-emit passes. | Phone-width dense leaderboard is forced to one column, ranking contains only rows with actual sold quantity/revenue, and hours were removed. KPI/revenue formulas are unchanged. Real mobile visual verification pending. |
| BUG-007 | Low | MOD-10 / negative-zero stock display | Closed — Fixed and verified | User screenshot showed `-0.00 kg`; pre-fix static regression failed. Post-fix `REPORT_INVENTORY_UX_OK` and TypeScript no-emit pass. | Values within floating tolerance are normalized to zero only for display/conversion. Historical movements and stock formulas are unchanged. Small kg values display as grams for clarity. |
| BUG-008 | High | MOD-13 / Today sales and shift data stale | Fixed in code — Integration verification pending | User reports shift leader sometimes sees fewer employee orders until browser restart. Source showed Today attendance polling but bag sessions/sales receipts were fetched only on dependency changes, with no sales/shift realtime subscription. `node scripts/test-shift-realtime-reminders.mjs` now passes and TypeScript no-emit exits 0. | Today now listens to `bag_shift_sessions`, `sales_receipts`, and receipt-item changes, refreshes on focus/visibility, and polls every 8 seconds as fallback. Real multi-device Supabase/LAN integration verification is pending. |
| BUG-009 | Medium | MOD-06 / Attendance reminder | Fixed in code — UI verification pending | User sees no attendance popup. Source confirmed `AppShell` only rendered a Sunday schedule-registration popup. The current `test-attendance-native-camera-location.mjs` verifies the data-backed reminder remains present and TypeScript no-emit passes. | AppShell now reads today's own registrations/records, distinguishes missing check-in from open check-out, refreshes every 30 seconds/on focus/attendance event, and shows the animated Capybara popup outside the attendance page. |
| BUG-010 | High | MOD-06 / iPhone GPS permission | Fixed in code — HTTPS iPhone verification pending | Owner still received a disabled-location error. Updated regression first failed because source opened `getCurrentPosition` and `watchPosition` concurrently and did not identify an HTTP denial. Post-fix `ATTENDANCE_NATIVE_CAMERA_LOCATION_OK` and TypeScript pass. | Restored one automatic high-accuracy browser request with a 30-second cache and the existing 150m rule. HTTP denial now explicitly says Safari blocks the link; HTTPS permission denial retains per-site settings guidance. Physical HTTPS iPhone verification remains required because code cannot bypass Safari's secure-context policy. |
| BUG-011 | Medium | MOD-13 / Employee sold-issued merge | Closed — Fixed and verified | User observed `7/0 sản phẩm`. Source reproduced the path where linked allocation was absent from scope. Pre-fix test failed; post-fix `test-business-competition-kpi.mjs` reports `BUSINESS_COMPETITION_KPI_OK` and TypeScript no-emit passes. | POS receipt fallback now raises employee `issued` to at least cumulative `sold`; revenue, target and KPI formulas are unchanged. |
| BUG-012 | High | MOD-06 / iPhone attendance camera | Fixed in code — Device verification pending | Owner reports the phone camera preview is black. Source showed `AttendancePage` rendered a separate `FilteredAttendanceCamera` live stream. Pre-fix attendance regression failed; post-fix it reports `ATTENDANCE_NATIVE_CAMERA_LOCATION_OK`; TypeScript passes. | Removed the live `getUserMedia` component, its filter copy/styles and canvas beautification. Check-in/out use only the phone-native file capture while retaining the iPhone image-decoding fallback. Physical phone verification remains required. |
| BUG-013 | High | MOD-13 / report finalization retry | Fixed in code — Integration verification pending | Pre-fix `test-report-finalization-retry.mjs` failed four assertions; post-fix reports `REPORT_FINALIZATION_RETRY_OK`. Existing shift-report, n8n and report regressions plus TypeScript pass. | Existing ownership/closed-shift/no-open-shift rules are unchanged. The UI exposes the existing blocker reason; Ca 2 merges its shift entry into the daily finalization payload and can resume a legacy partial snapshot instead of being stranded as “already finalized”. Real shift-leader integration remains required. |
| BUG-014 | High | MOD-13 / n8n report delivery configuration | Closed — Fixed and verified | `.env.local` originally had `N8N_REPORT_ENABLED=false`, later briefly used `/webhook-test/...`, and required server restarts after secret edits. Post-fix config test passes; the owner screenshot now shows `Đã đưa 1 ảnh vào lịch gửi tự động n8n.` for Ca 1. | Enabled delivery, restored production `/webhook/...`, and restarted after the final env edit. The owner-visible queue success proves the live configuration reaches and is accepted by n8n. Downstream scheduled Drive/Sheet/Zalo delivery is tracked separately and is not implied by this closure. |
| BUG-015 | High | MOD-13 / local Supabase-to-n8n runtime | Closed — Fixed and verified | Pre-fix `test-local-n8n-supabase-runtime.mjs` failed six assertions. Post-fix static/type/runtime regressions pass, and the owner used the Supabase-backed local web to successfully queue the real Ca 1 infographic into n8n. | Local route verifies Supabase user/shift/snapshot, uses bounded timeouts and persists delivery state. The authenticated end-to-end web→local API→n8n path is now verified. Scheduled n8n→Zalo receipt remains a separate pending integration check. |
| BUG-016 | Medium | MOD-13 / n8n local proxy error handling | Fixed and verified | Owner screenshot first showed the generic fallback. Pre-fix regression failed three diagnostic assertions and local ports were down. Post-fix source/type/queue/regression pass, health is 200, proxy returns JSON, and the next real owner retry displayed the upstream HTTP 403 exactly. | The client now preserves JSON server errors and maps non-JSON failures to actionable HTTP/local-API messages. The exact 403 proves this diagnostic fix works and the request reaches n8n. Remaining Header Auth/IP-whitelist correction is external configuration tracked as MOD13-TC-N8N-05, not BUG-016. |
| BUG-017 | Medium | MOD-13 / n8n upstream error diagnostics | Fixed in code — Real retry pending | After correcting Header Auth, production URL and server restart, the owner retry reaches n8n and returns HTTP 500. Pre-fix regression failed both server assertions because the upstream body was discarded. Post-fix `N8N_REPORT_IMAGE_QUEUE_OK`, `LOCAL_N8N_SUPABASE_RUNTIME_OK`, LAN syntax and app/API TypeScript all pass. | Both APIs now parse only JSON-shaped upstream responses, extract `message`/`error`/`description`, redact the configured secret, normalize and cap detail at 240 characters, and direct the owner to Executions. HTML/raw payloads, report payload, schedule, idempotency and business rules are unchanged. Real retry must reveal the exact n8n failure before closure. |
| BUG-018 | High | MOD-13 / false-positive n8n queue acknowledgement | Closed — Fixed and real guard verified | Owner first saw success without a Sheet row, then another success on an unproven 2xx. New pre-fix regression failed two cloud/LAN assertions; post-fix tests pass. Real retry now correctly rejects n8n 200 because the Sheet row contains literal `{{ ... }}` strings instead of the expected `job_key`, exposing Fixed-mode n8n mapping. | Persistent send-now, roles, job key and schedules are unchanged. Cloud/LAN require exact `job_key` plus non-empty `row_number`; empty/non-JSON/early/wrong responses never persist success. Remaining work is external n8n configuration: switch dynamic Sheet fields to fx Expression and retry. |
| BUG-019 | Medium | MOD-13 / report toolbar mobile UI | Fixed in code — Mobile visual verification pending | Owner screenshot shows five competing actions, no dropdown for Ca 1/Ca 2/Total day, a raw n8n contract error in the main toolbar, and broken phone wrapping. Pre-fix regression failed ten assertions. Post-fix `REPORT_TOOLBAR_MOBILE_OK`, all four related report/n8n regressions, app TypeScript, the 695-module build and scoped diff check pass. | Toolbar now has one real scope dropdown, one Zalo action, one download action and a compact finalized state. A final phone-specific CSS block prevents the older conflicting rules from restoring horizontal overflow. Low-level n8n acknowledgement text is mapped to a short user message while the exact text remains available for diagnosis. Report calculations, finalization gates and strict n8n completion proof are unchanged. |
| BUG-020 | Low | MOD-13 / n8n mobile diagnostics | Fixed in code — Real retry pending | After adding the final Edit Fields node, owner still sees the same generic queue message and reports that Editor node output only spins. Source maps all empty, non-JSON, early and wrong-job acknowledgements to one sentence; focused regression failed two assertions. Official n8n documentation confirms production webhook data is viewed from Executions, not directly in Editor. Post-fix toolbar/n8n regressions, app TypeScript and 695-module build pass. | The strict success guard is unchanged. Empty, non-JSON, early and wrong-job responses now have distinct short messages; the original bounded server text is available inside a collapsed details element so the phone toolbar stays compact. Real owner retry must identify the remaining external workflow state. |
| BUG-021 | High | MOD-09 / daily POS receipt loading | Fixed in code — Production verification pending | User reports end-of-day vs employee sales differs by exactly one bag. The production bundle `index-BFBcAEpk.js` and pre-fix local source capped the branch/day query with `.limit(120)`. Pre-fix regression failed; post-fix `SALES_REPORT_CONSISTENCY_OK`, TypeScript and all focused report regressions pass. | Root cause: report/leader receipt loading could silently omit the oldest rows after 120 branch receipts, while an employee-scoped RLS view may still return all of that employee's smaller result set. Daily and range reads now paginate in stable 500-row pages over the same RLS-authorized filters. Sales/revenue formulas, permissions and schema are unchanged. Production bundle/data verification remains. |
| BUG-022 | High | MOD-13 / finalization data freshness | Fixed in code — Production verification pending | Production finalize code snapshots the existing rendered model and pre-fix local `saveCloud()` did not reload authoritative ledger/POS before building its payload. Pre-fix regression failed; post-fix consistency, finalization, Zalo/n8n, realtime and TypeScript checks pass. | Root cause: a just-created receipt could exist in `sales_receipts` while the report component still held the prior realtime state. Finalization now reloads the same branch/date ledger, reapplies all existing ownership/closed-shift/no-open-shift gates, and builds shift/day payloads from the fresh results. No formulas or workflow rules changed. Production verification remains. |
| BUG-023 | High | MOD-20 / focused management load | Fixed in code — Browser timing pending | Pre-fix `test-operations-ux-performance.mjs` failed because `App.tsx` synchronously imported every business page and focused management requested ten cross-module datasets plus every realtime table. Post-fix test, TypeScript, related regressions and production build pass; build now emits separate page chunks. | Pages now load on demand. Focused management routes request and subscribe only to their section's data; overlapping refreshes coalesce and LAN background polling is 15 seconds. The full management hub retains its existing all-module behavior. Business calculations, permissions and API contracts are unchanged. |
| BUG-024 | Medium | MOD-17/MOD-20 / attendance XLSX completion | Fixed in code — Browser/device verification pending | Pre-fix source resolved check-in then check-out signed URLs sequentially for every detail row and repeated them when the same rows were copied to branch sheets; XLSX download followed a long asynchronous task. Focused regression initially failed and now passes with TypeScript/export regressions. | Evidence URL promises are cached per export session and check-in/out URLs resolve concurrently. Mobile XLSX uses the native file Share Sheet after generation; desktop keeps attached object-URL download. Real large-workbook timing/download remains pending. |
| BUG-025 | High | MOD-13 / automatic day close | Deployed/configured — First scheduled run pending | The owner requires automatic day close when the leader forgets the report action and clarifies that the completed day closes only after midnight. Tests report `AUTO_CLOSE_DAY_OK`/`OPERATIONS_UX_PERFORMANCE_OK`; live production output contains cron `0 17 * * *` UTC and Vercel lists both required server variables as Sensitive Production values. | The endpoint calculates the previous UTC+7 calendar date and selects only that date and older stale open days. Corrected deployment `dpl_BwWRkaTpos7Nvf4D7L6gRve5gv2y` is active. An unauthenticated production request returns 401 before database access; the first real midnight cron execution remains the final operational verification. |
| BUG-026 | Medium | MOD-14 / competition information exposure and load | Fixed in code — Visual verification pending | The owner explicitly requires registered hours to be hidden. Pre-fix manager/admin competition rows rendered `giờ đăng ký`, and ManagerDashboard added a registration query/timer/subscription for this display. Corrected contract, competition test and TypeScript pass. | Visible hours and the manager-only load/subscription are removed. Admin payroll/attendance registration data and revenue ranking formulas remain unchanged. |
| BUG-027 | Medium | MOD-17 / attendance photo stamp regression | Fixed in code — Device verification pending | The owner requests the previous photo record style shown in the supplied screenshot. Pre-fix stamp promoted an uppercase branch title and omitted the old GPS coordinate line. Corrected operations/attendance tests and TypeScript pass. | Legacy dark overlay/text hierarchy and GPS coordinate/accuracy line are restored while native capture, trusted time, concrete address validation and stored audit fields remain. |
| BUG-028 | Medium | MOD-17 / unrequested attendance meal columns | Fixed in code — Workbook verification pending | The owner explicitly states Bữa sáng/Bữa trưa/Bữa tối were never requested. Pre-fix corrected regression failed exactly those three labels; post-fix operations regression passes. | Removed only the summary/detail column definitions across Attendance and Admin. Date filters, attendance calculations, evidence URLs and workbook download behavior remain unchanged. Real exported-workbook verification is pending. |
| BUG-029 | Medium | MOD-06/MOD-20 / attendance initial overfetch and loading presentation | Fixed in code — Browser/multi-device verification pending | Source showed every attendance tab requesting shifts, registrations, attendance records, employees and schedule people together, including data unused by the current tab. Corrected `test-operations-ux-performance.mjs` first failed exactly three assertions; post-fix it reports `OPERATIONS_UX_PERFORMANCE_OK` and app TypeScript passes. | Reads are now selected by active tab, tab-switch refresh stays silent, Supabase realtime plus the 15-second LAN fallback remain, and the initial state uses a static lightweight skeleton with explicit sync status. Attendance calculations, permissions, API contracts and schedule/finalization rules are unchanged. |
| BUG-030 | High | MOD-06/MOD-18 / stale or imprecise attendance coordinates | Fixed in code — HTTPS phone verification pending | Owner reports the recorded address is inaccurate. Source proved the browser accepted a cached coordinate up to 30 seconds old (`maximumAge: 30000`) and accepted the first single fix whenever its reported accuracy was within 150 m. The extended attendance regression first failed two assertions; post-fix it reports `ATTENDANCE_NATIVE_CAMERA_LOCATION_OK` and TypeScript passes. | GPS now forbids cached coordinates (`maximumAge: 0`). A first fix above the 35 m target triggers one additional fresh request and the better coordinate is reverse-geocoded; the existing 150 m rejection ceiling, native camera, concrete address requirement and stored audit fields remain. Physical HTTPS phone verification is required before closure because street accuracy still depends on device GPS and map-provider coverage. |
| BUG-031 | Medium | MOD-03/MOD-05 / branch setup error reporting | Closed — Fixed and verified | Pre-fix `node scripts/test-core-business-button-guards.mjs` failed exactly the branch fallback assertion. After the one-line fix it reports `CORE_BUSINESS_BUTTON_GUARDS_OK`; UI-button, native attendance, realtime-shift regressions and app TypeScript also pass. | `syncBranchToCloud()` now throws `directError` when the direct Supabase upsert fails instead of rethrowing the older missing-RPC error. No role, branch, shift, schema or workflow rule changed. |
| BUG-032 | High | MOD-07/MOD-15 / silent management autosave failures | Closed — Fixed and verified | Pre-fix extended business guard failed exactly three assertions for employee payroll, role-default payroll and low-stock threshold writes. Post-fix `CORE_BUSINESS_BUTTON_GUARDS_OK`, UI-button contract, operations-performance, KPI regression and app TypeScript all pass. | The three existing debounced writes now route rejected promises to the existing error/feedback banner. Values, formulas, database schema, API contract, roles and debounce timing are unchanged; failed cloud synchronization no longer looks silently successful. |
| BUG-033 | High | MOD-12 / supply-request history truncation | Closed — Fixed and verified | Pre-fix `node scripts/test-data-pagination-consistency.mjs` failed three supply-request assertions. Post-fix it reports `DATA_PAGINATION_CONSISTENCY_OK`; TypeScript and LAN syntax pass. | `fetchSupplyRequests()` now reads authorized rows in stable 500-row pages and the LAN route no longer cuts the response at 80. Status, permissions, data and workflow remain unchanged. |
| BUG-034 | High | MOD-10 / cumulative inventory truncation | Closed — Fixed and verified | Pre-fix the same regression failed two stock-ledger assertions. Post-fix it reports `DATA_PAGINATION_CONSISTENCY_OK`; TypeScript passes. | `fetchMovements()` now reads the cumulative ledger in stable 500-row pages ordered by creation time and id. Movement signs, count-reset formula, writes and historical data remain unchanged. |
| BUG-035 | High | MOD-09 / LAN POS history truncation | Closed — Fixed and verified | Pre-fix the same regression found LAN caps at 120 daily and 1,000 range rows. Post-fix both `DATA_PAGINATION_CONSISTENCY_OK` and `SALES_REPORT_CONSISTENCY_OK` pass with LAN syntax and app TypeScript. | Removed only the two LAN response caps and extended the existing POS regression to cover them. Receipt rights, prices, quantities, KPI/revenue formulas and data remain unchanged. |
| BUG-036 | High | MOD-10/MOD-15 / configured SKU inventory count | Closed — Fixed and verified | Pre-fix extended `test-report-inventory-ux.mjs` failed four assertions. Post-fix `REPORT_INVENTORY_UX_OK`, `DATA_PAGINATION_CONSISTENCY_OK`, `CORE_BUSINESS_BUTTON_GUARDS_OK` and app TypeScript pass. | Inventory stock recalculates on the existing product-refresh tick; the count form uses `getProducts()`/`productById()` and adds newly available positive-stock configured SKUs without overwriting current count inputs. Count formulas, movement writes, product schema and permissions remain unchanged. |
| BUG-037 | High | MOD-06/MOD-09/MOD-10/MOD-13 / UTC business-date drift | Closed — Fixed and verified | Pre-fix `node scripts/test-business-date-contract.mjs` failed seven application/LAN assertions. Post-fix its only remaining failure is the separately blocked Supabase RPC assertion; inventory, business controls, POS, LAN syntax and app TypeScript pass. | Inventory/store now use the existing local date helper, attendance past-date validation uses the same helper, and LAN same-day guards use an explicit UTC+7 date key. Existing same-day/past-date rules are unchanged; only their date source was corrected. |
| BUG-038 | High | MOD-09 / Supabase POS same-day delete timezone | Blocked — Requires Business Decision | The same regression fails the migration assertion. `20260707_delete_pos_receipt.sql` enforces employee same-day deletion with `v_receipt.business_date = current_date`, but the function has no UTC+7 conversion; official Supabase configuration documentation states databases default to UTC. | Correcting the server authorization guard requires a new migration/RPC change to compare with the business date (for example `timezone('Asia/Bangkok', now())::date`). Repository rules prohibit database/authorization changes without direct owner approval. Until approved/applied, Supabase and UI/LAN can disagree around midnight. |
| BUG-039 | High | MOD-08/MOD-09/MOD-12/MOD-13/MOD-14 / false-empty critical reads | Closed — Fixed and verified | Pre-fix `node scripts/test-critical-load-failure-visibility.mjs` failed seven false-empty assertions. Post-fix it reports `CRITICAL_LOAD_FAILURE_VISIBILITY_OK`; operations, core-business, POS, realtime and app TypeScript regressions pass. | Admin, Shift Handover, Dashboard and manager POS now let their existing outer error handling surface rejected critical reads and preserve prior state instead of substituting `[]`. Data formulas, close gates, permissions and API calls are unchanged. |
| BUG-040 | Medium | MOD-14/MOD-20 / unused manager session load | Closed — Fixed and verified | Pre-fix the same regression found the unused all-session read; post-fix it passes with operations-performance and TypeScript. | Removed only the write-only session state/fetch from Manager Dashboard. The realtime `bag_shift_sessions` subscription remains so dependent ledger refresh behavior is preserved. |
| BUG-041 | Medium | MOD-13/MOD-17 / report archive mobile overflow | Fixed in code — Mobile visual verification pending | Owner supplied phone evidence showing the report archive/filter surface exceeding a clean compact mobile layout. Pre-fix deploy-polish regression failed the archive-page/date-control locks; post-fix it reports `DEPLOY_UI_BUSINESS_POLISH_OK` and app TypeScript passes. | A final page-level width/overflow contract now wins older CSS; month/date/select/buttons share 44px sizing and use two columns then one on narrow phones. Archive reads are limited to the selected calendar month. Real iPhone visual verification remains pending because in-app Browser is unavailable. |
| BUG-042 | Medium | MOD-14 / competition long-name clipping | Fixed in code — Visual verification pending | Owner reports long employee names are hidden. Source set single-line ellipsis on leaderboard/poster names; the corrected deploy-polish regression and TypeScript pass. | Employee, mini-board, poster, manager and leader names now wrap with `overflow-wrap:anywhere`; revenue/ranking order and inputs are unchanged. |
| BUG-043 | High | MOD-07/MOD-14 / shift-leader competition revenue source | Fixed in code — Live data verification pending | Pre-fix both pages filtered personal employee-sales rows by leader profile. Post-fix deploy-polish test includes a functional two-session fixture: staff receipts in Ca 1/Ca 2 are attributed to the correct leaders; a receipt between sessions is excluded. TypeScript passes. | Admin and Manager now load date-bounded `bag_shift_sessions`, associate all POS receipts by branch/business-date/session timestamps, aggregate each leader's shift revenue, and compare it to the unchanged leader daily target. Payroll reward logic is separate. Live Supabase/LAN data verification remains. |
| BUG-044 | Low | MOD-13 / report toolbar technical copy | Closed — Fixed and source verified | Pre-fix deploy-polish regression failed on raw n8n details, finalize hint, long workflow text and verbose iPhone storage copy. Post-fix it and `REPORT_TOOLBAR_MOBILE_OK` pass. | Removed visible developer-facing notes, shortened image feedback, and maps node/webhook/Sheet/job-key failures to one operational Zalo retry message. Buttons, finalization gates and strict server-side n8n proof rules remain. |
| BUG-045 | High | MOD-07 / KPI daily and weekly reward aggregation | Closed — Fixed and source verified | Pre-fix `test-kpi-reward-reverse-audit.mjs` failed three assertions. Post-fix it reports `KPI_REWARD_REVERSE_AUDIT_OK`; TypeScript passes. | Allocation-derived and direct-POS revenue now share one canonical date × branch × employee aggregate. Existing daily target and bonus functions run once per employee/day, and weekly wins count days rather than receipts. Monetary thresholds and `monthlyBonus = 0` are unchanged. |
| BUG-046 | High | MOD-07 / daily KPI detail versus payroll source | Closed — Fixed and source verified | The payroll calculation included direct POS but the “KPI theo ngày” detail read allocation rows only, split them by shift id and labelled the reward as per shift. The extended reverse-audit failed three assertions before the fix and now reports `KPI_REWARD_REVERSE_AUDIT_OK`; TypeScript passes. | The detail table now mirrors the payroll input contract: allocation-linked sales plus direct POS are deduplicated and grouped once by date × branch × employee. It is labelled and rendered per day. Targets and monetary reward formulas are unchanged. |
| BUG-047 | Medium | MOD-20 / idle disabled-button spinner | Closed — Fixed and production asset verified | Pre-fix `test-idle-button-loading-state.mjs` failed four assertions. Post-fix it reports `IDLE_BUTTON_LOADING_STATE_OK`; the 195-button, performance and business-guard regressions pass; production build/deploy succeeds. Read-only production CSS returns 200, contains no disabled-spinner selector/keyframe and retains a static `not-allowed` cursor. | Removed the global rotating pseudo-element and `cursor: progress` from disabled buttons. Disabled expressions and handlers are unchanged; static unavailable buttons now stand still, while actual async actions retain their existing “Đang…” labels and cleanup. |
| BUG-048 | High | MOD-13 / automatic report snapshot completeness | Fixed and deployed — First scheduled run pending | Linked read-only production audit finds seven stale open operation days. Source showed `/api/auto-close-day` created only finalization metadata when no report payload existed. The extended `test-auto-close-day.mjs` failed because a mocked authoritative POS total of 538,000 was absent from both archive revenue fields; after the fix it reports `AUTO_CLOSE_DAY_OK`, and standalone API TypeScript passes. | Auto-close now reads the completed branch/date POS receipts and merges authoritative revenue, sold quantity, per-seller rows, leaders and shift proof images into the snapshot while preserving prior payload fields. Corrected production deployment contains this function and its required secrets. The first real midnight cron remains pending; no manual catch-up write was invoked. |
| BUG-049 | Critical | MOD-01/MOD-20 / production Supabase build environment | Closed — Fixed and production verified | Owner reported all user data appeared missing immediately after deployment. Production DB/RLS read-only audits proved rows and visibility intact. Exact bundle inspection proved deployed `index-DH8SRo4V.js` contained neither the configured Supabase project URL nor public anon key because stale `.vercel/.env.production.local` declared both `VITE_` values empty. `test-production-supabase-bundle.mjs` failed before and passes after the corrected build. Live production now serves `index-MmS9OiBJ.js`; direct inspection confirms the correct Supabase host and public anon key are present, and Supabase Auth settings respond 200. | Rebuilt with the two public Vite variables explicitly supplied from `.env.local`, then deployed inspected output `dpl_BwWRkaTpos7Nvf4D7L6gRve5gv2y`. Post-deploy read-only audit still has 36 users/profiles and today's 20 receipts/22 units/1,210,000đ. No database restore, seed, row deletion or overwrite was performed. |
| BUG-050 | High | MOD-06/MOD-07 / production active-session and attendance-adjustment schema | Closed — Fixed and production verified | Owner screenshot showed repeated POST 404 for `/rest/v1/active_user_sessions`. The owner approved the additive migration and prohibited localStorage. Production now has both tables, RLS enabled, 3 active-session policies and 2 adjustment policies; a natural browser heartbeat created a cloud row. `CLOUD_ONLY_PRESENCE_ADJUSTMENTS_OK`, seven focused regressions, TypeScript and production build pass. Live asset `index-BfjqIqTV.js` points to the intended Supabase and contains neither former localStorage key. | Applied only `20260709_attendance_documents_active_sessions.sql`. Removed device-local/missing-table success fallbacks from both cloud modules; cloud failures now surface instead of pretending local success. Deployment `dpl_DW9ghKs3NquGjpZiJ3UjGNeRdCpT` is READY/aliased and read-only production verification passes. |
| BUG-051 | Medium | MOD-10 / manager inventory branch workspace | Fixed in code — Visual verification pending | Owner screenshot reports the inventory surface is temporary-looking and that opening a branch makes other branches appear hidden. Source rendered every branch as an inline native `details`; a large SKU list expanded before subsequent branch summaries. Pre-fix `node scripts/test-manager-inventory-workspace.mjs` exited 1 with 15 focused failures; post-fix it reports `MANAGER_INVENTORY_WORKSPACE_OK`. | Branch cards now remain in a complete responsive grid and a React-controlled selected detail renders once below the grid. SKU current stock, existing threshold/status and waste attention are separated into a warehouse-style workspace. Branch filtering, stock/waste/movement formulas, permissions, schema and writes are unchanged. Browser runtime is unavailable (`[]`), so real visual verification remains pending after regression/build. |
| BUG-052 | High | MOD-06 / active-user cloud heartbeat | Fixed and deployed — Live browser retry pending | Owner console screenshot shows repeated HTTP 403 requests ending in `on_conflict=user_id`. `activeUsers.ts` upserts by `user_id`; migration `20260709_attendance_documents_active_sessions.sql` permits own insert/update but its only SELECT policy was Admin-only. PostgreSQL/PostgREST conflict-update requires the existing row to be selectable. Focused/cloud-only regressions and TypeScript pass; the targeted production migration/catalog assertions exited 0 and live deployment `dpl_Cnc2dpznvj7TqPUGWXR7cagXKmBn` contains the corrected client. | Production policy now permits SELECT only when `user_id = auth.uid()` or the current profile is Admin, enabling own conflict-update without exposing other users. The obsolete Admin-only SELECT policy is absent. No localStorage fallback was added. One real signed-in heartbeat is still required before closure. |
| BUG-053 | Medium | MOD-10 / MOD-17 inventory image export | Fixed and deployed — Device verification pending | Owner screenshots first showed a blurry editable-form capture, then the fixed 1080×1920 replacement with a large unused white area for five rows. Corrected focused test passes with dynamic content height and the supplied paper-style layout contract; inventory regression and TypeScript pass. Live CSS `index-NumTK3Ca.css` contains the new poster contract. | Sharp PNG export measures the poster `scrollHeight`, uses white paper/green accent/dark compact table styling and retains branch/reporter metadata. Inventory calculations, physical-count inputs and stored report data are unchanged. Browser runtime is unavailable; production phone/image verification remains pending. |
| BUG-054 | Medium | MOD-06 / MOD-20 Admin attendance correction list | Deployed — Visual verification pending | Owner reports the list will become excessively long when the report range reaches three months. Source rendered every `attendanceListRows` item and exposed neither the existing employee filter state nor an exact-day/list pagination control. The focused test failed before implementation and now reports `ADMIN_ATTENDANCE_REPORT_POLISH_OK`; production asset `AdminPage-DoM6UbAd.js` is live. | List-only modes now default to an exact day or require one selected employee within the global range; results sort newest first and paginate at 20 rows. Global Excel/date scope, correction validation/audit/RPC, payroll formulas and realtime refresh are unchanged. Browser visual verification is unavailable (`[]`). |
| BUG-055 | High | MOD-10 / MOD-17 manager inventory quantity clarity and export completeness | Deployed — Visual/workbook verification pending | Owner screenshot shows unlabeled values such as `5.047,68`. Source computed `stockUnits`, inbound and outbound by adding quantities across products without grouping by `product.unit`, so kg and item counts could be combined into a meaningless total. Focused regression failed with 13 assertions before the fix and now passes; production assets contain the exact feature/CSS. | Display totals are grouped by unit, sub-kilogram values use grams, and the exact-day table uses only `sale_out`. The threshold column is removed while status remains. Workbook includes period summary, selected-day sale-out, full ledger, current stock and count vouchers. Movement types/signs, stock formulas, writes and stored data are unchanged. Browser/device and a real downloaded workbook remain pending. |
| BUG-056 | Medium | MOD-14 / MOD-20 management daily competition and refresh resilience | Deployed — Visual/live disconnect verification pending | Owner explicitly rejects another daily-ranking card and requests classification by day. Source rendered only a fixed Top 3 for `todayKey`. Focused regression failed before implementation and now passes; live production asset contains the classification and refresh fallback. | One shared table now classifies employee/day, employee/month or shift leader/month; exact-day mode stays inside the active range. Existing scoped realtime subscriptions remain, with a coalesced silent 30-second/focus/visibility reconciliation fallback. Revenue/KPI/payroll/stock formulas, writes and schema are unchanged. Browser visual and a real forced-disconnect recovery check remain pending. |
| BUG-057 | High | MOD-10 / MOD-13 shift handover inventory reconciliation | Deployed — Visual/workbook verification pending | POS sales exist but the prior daily Out table read only `sale_out`, which was zero. Owner confirms remaining goods are already the handover closing balance and authorizes `opening + additions - closing - waste`, reconciled with POS. Focused/broad regressions, TypeScript and the 696-module build pass; live Admin chunk contains `Đối chiếu ca`. | Read-only per-shift reconciliation uses existing session balances, movements and POS source conversions. Open shifts show POS provisional; only closed shifts show official Out/difference. Excel includes `Đối chiếu ca`; no return flow, stock movement, migration or historical-data rewrite was added. Production deployment `dpl_GEMYw5wPiK7fTSK5j6wjG9WBbgAX` is Ready. |
| BUG-058 | High | MOD-10 / MOD-15 configured SKU deletion | Deployed — UI/realtime verification pending | Owner deleted a SKU in Admin but it remained visible in inventory. Pre-fix `node scripts/test-product-delete-tombstone.mjs` exited 1 with two source-backed failures; post-fix it reports `PRODUCT_DELETE_TOMBSTONE_OK`. Inventory/report, manager inventory, POS/report consistency, shift reconciliation, business guards, button contract, TypeScript and the 696-module production build all pass. Live main asset contains the product tombstone contract and the correct Supabase project. | Root cause: the deletion marker for a built-in/system SKU was lost between the cloud merge and shared product cache, so the default catalog recreated it and stock displayed it whenever balance history existed. The shared cache now preserves cloud tombstones, excludes their IDs from current stock, inbound, processing, packing and POS selectors, applies a successful Admin deletion immediately and retains deleted product metadata only for historical document lookup. No stock movement, historical report, database row or schema was deleted. Production deployment `dpl_GEMYw5wPiK7fTSK5j6wjG9WBbgAX` is Ready. |
| BUG-059 | Medium | MOD-11 / kitchen idle ringtone | Deployed — Physical-device audible verification pending | Owner heard music while Kitchen showed no order. The pre-fix reproduction proved that the first pointer/key interaction unconditionally called `primeKitchenBell()` and relied only on `volume = 0`. Post-fix `KITCHEN_IDLE_BELL_OK`, core business guards, the 204-button contract, no-emit TypeScript and the 697-module production build all pass. Live Kitchen chunk `KitchenPage-D0nm0nQ8.js` returns HTTP 200 and contains the mute assignment. | The media-unlock path now sets `audio.muted = true` before `audio.play()`, pauses and seeks to zero, then restores the previous volume/mute state. This keeps first-interaction audio unlocking silent on volume-locked Apple media stacks while preserving the separate new-pending-order alert and 60-second reminder guarded by pending requests. Production deployment `dpl_CgasdGCNoQyu2nSq6sQeUu2yKDZY` is Ready; one real target-device silent-first-tap check remains. |
| BUG-060 | Medium | MOD-10 / MOD-17 inventory Excel quantity readability | Deployed — Workbook verification pending | Owner-provided workbook screenshot shows mixed separators such as `2,019.915`, alongside values like `9.785`, making the quantity scale ambiguous. The pre-fix regression failed on `#,##0.####`; post-fix focused/broad tests, TypeScript and the 697-module production build all pass. Live `AdminPage-DHtc8ikq.js` returns HTTP 200 and contains `0.####` with no mixed format. | The inventory workbook keeps every quantity as a numeric cell but uses shared `0.####` formatting; POS revenue uses `0`. Removing grouping prevents mixed grouping/decimal symbols while Excel may still render the one decimal symbol according to the viewer locale. No inventory value, formula, unit, database data or schema changed. Deployment `dpl_CV4n9oaG27ciC3KQRCEYELXNA1T7` is Ready; a real downloaded workbook remains pending. |
| BUG-061 | Medium | MOD-10 / MOD-17 inventory sale-out and handover period export | Deployed — UI/workbook verification pending | Owner clarifies that “Xuất bán và tồn bàn giao” must allow date/month selection because the prior Excel exported only one day. Focused/broad tests, TypeScript and production build pass. Live Admin chunk returns HTTP 200, contains the range labels/sheet name and has no legacy `inventorySalesDate`. | The subsection now directly edits the authoritative `from`/`to` report period. Sale-out movements and shift sessions use inclusive range filters, every shift row shows its business date, and Excel sheets/titles say “trong kỳ” with both endpoints. Existing Out/POS formulas, session statuses, branch scope and database behavior are unchanged. Deployment `dpl_CV4n9oaG27ciC3KQRCEYELXNA1T7` is Ready; visual and real-workbook checks remain pending. |
| BUG-062 | Medium | MOD-06 / MOD-07 employee work-duration presentation | Deployed — Visual verification pending | Owner screenshot shows check-in 13:55 and check-out 22:20 rendered as `8,42 giờ`. Fixture proves 505 minutes = 8 hours 25 minutes = 8.42 decimal hours. Focused/broad tests and the 698-module build pass; live Admin/Attendance/CSS assets return 200 and contain the duration/search/Capy contracts. | Human-facing Admin, employee, KPI/payroll-summary and check-out photo labels use hours/minutes; payroll arithmetic and numeric exports retain explicitly labelled decimal hours. Search is accent-insensitive. No attendance calculation, work-day credit or wage formula changed. Production deployment `dpl_FKKWNtVzvCHXgyvq4PGusy87evnv` is Ready; Browser runtime is unavailable (`[]`). |
| BUG-063 | Medium | MOD-06 Admin attendance erroneous-record removal | Deployed — First deliberate Admin deletion pending | Pre-fix focused contract failed because no scoped RPC existed; post-fix focused/broad tests pass. Targeted production migration/catalog verification exit 0; live Admin/CSS assets return 200 with confirmation UI. | Admin-only RPC locks/deletes exactly the selected attendance ID, requires a reason, records complete before-state audit and retains the registration. Installation/testing invoked no deletion. Deployment `dpl_FKKWNtVzvCHXgyvq4PGusy87evnv` is Ready; one deliberate owner action remains to verify end-to-end audit/refresh. |
| BUG-064 | Medium | MOD-07 KPI ranking/reward clarity | Deployed — Employee data/visual verification pending | Source proves Top sorts revenue while reward comes from daily/weekly thresholds. Pre-fix clarity test failed; post-fix focused/KPI/TypeScript/build pass. Live Admin/CSS assets return 200 and contain the reward explanation/column. | Table says `Xếp hạng doanh thu`, explains Top alone does not award money, and shows existing computed daily/weekly reward/eligibility. All thresholds/formulas are unchanged. Exact Đặng Thị Khánh Linh production totals still require explicit approval for employee-level Admin read audit. Deployment `dpl_FKKWNtVzvCHXgyvq4PGusy87evnv` is Ready. |
| BUG-065 | High | MOD-13 `/api/n8n/revenue` Vercel runtime | Closed — Fixed and production guard verified | First prebuild after `c6e98c8` emitted runtime-invalid frontend imports. Post-fix focused/NodeNext/app TypeScript pass; clean prebuild has six functions and no errors. Vercel inspection shows `api/n8n/revenue` deployed; unauthenticated live request returns 401. | API is server-standalone with current product prices/fallback and unchanged snapshot > receipt > allocation > sale-out precedence plus API-key/service-role guards. Production deployment `dpl_FKKWNtVzvCHXgyvq4PGusy87evnv` is Ready. No authenticated business-data request was made. |
| BUG-066 | High | MOD-01 / MOD-20 post-login lazy route load | Confirmed — Fix in progress | Owner screenshot shows a blank `#kitchen` immediately after login that recovers only after reload. Production evidence: an older deployed Kitchen chunk URL returns 404 while the current chunk returns 200. `App.tsx` uses raw `React.lazy`, has no route error boundary and can also `return null` during role-route correction. Pre-fix `test-login-lazy-route-recovery.mjs` fails ten assertions. | A tab kept open across a deployment can execute an old main bundle and request an obsolete lazy chunk only after login; the rejected import escapes Suspense and blanks the root. Add one-time reload only for recognized stale-chunk errors, clear the marker after success, show an actionable error boundary on persistent failure, and replace the transient `return null` with visible loading. Auth, role defaults and permissions must remain unchanged. |
| BUG-067 | Medium | MOD-20 global loading presentation | Fixed in code — Production/UI verification pending | Owner reports loading appears in too many places. Source and pre-fix `test-capybara-loading-ui.mjs` proved every enabled click/submit/file/select called `pulse()` and forced the overlay for 700 ms even when no async work started. Post-fix test reports `CAPYBARA_LOADING_UI_OK`; app TypeScript passes. | Explicit auth/lazy-route loading remains. Ordinary actions only mark a short context; the global overlay appears after 280 ms only while an associated fetch is still pending, and stays 320 ms once shown. Local and fast interactions no longer flash it. |
| BUG-068 | High | MOD-04 account/Auth synchronization | Fixed in code — Edge deploy pending; current production rows synchronized | `hardDeleteEmployee()` deleted `profiles` before `auth.admin.deleteUser`, and Admin fetched inactive profiles but built its account list from `filteredEmployees`, which explicitly removed `active=false`. Either path could make an account disappear while its login remained occupied. Pre-fix test failed; post-fix `ACCOUNT_ORPHAN_RECOVERY_OK` and app TypeScript pass. Read-only production audit reports 37 Auth users, 37 profiles and zero true orphans. | Inactive login profiles now remain visible as “Đã xóa” in account administration and can use the existing permanent-delete action, while operational reports still exclude them. Auth deletion precedes final profile removal; create recovers only exact-email Auth users proven profile-less and otherwise reports profile/status. No current production account was mutated. |
| BUG-069 | High | MOD-10 / MOD-15 processing SKU linkage | Fixed in code — Production/UI verification pending | Owner screenshot selects raw `Bánh hạt dẻ` but output contains only kg products. Source filtered mappings through `getFinishedBulkProducts()` (`unit === 'kg'`), so mapped `cake-ready` (`cái`) disappeared. Production history remains intact; system `cake-ready` was tombstoned and active custom `TP-BANH` exists. Pre-fix linkage test failed; post-fix linkage and tombstone tests pass with TypeScript. | Processing now resolves the full active configured catalog and falls back to a same-unit price-zero warehouse SKU, so `TP-BANH` is selectable without resurrecting the tombstoned system SKU. Control Center keeps price-zero non-kg intermediates under SKU KHO. Historical movements remain untouched. |
| BUG-070 | High | MOD-06 attendance write reliability | Deployed — Physical-device verification pending | Cloud checkout could treat a zero-row conditional update as success; LAN retry returned 409 after an already-saved checkout, and storage/mutations lacked bounded idempotent retry. Pre-fix `test-attendance-idempotent-write.mjs` failed; post-fix it reports `ATTENDANCE_IDEMPOTENT_WRITE_OK`, related native/mobile/cloud/schedule/realtime tests and the production build pass. Live Attendance asset returns 200 in deployment `dpl_CPBrJmskV2tTRMED4PGiPpRY9BMN`. | Check-in/out and selfie writes use bounded same-ID/path retry and read-back proof; duplicate check-in and already-saved LAN checkout reconcile safely. Selfie/GPS/address/registration ownership rules are unchanged, and no historical record was auto-closed. No synthetic production attendance write was made; one normal physical-device check-in/out remains required for device-level closure. |
| BUG-078 | High | MOD-13 `/api/n8n/revenue` Vercel TypeScript build contract | Closed — Fixed and production verified | The owner-authorized release's first `vercel build --prod` printed three `Cannot find name 'process'` errors for `api/n8n/revenue.ts`, and `test-n8n-revenue-api-build.mjs` failed its server-standalone contract. Deployment was stopped before promotion. | Restored only the local Node environment declaration and stable helper/key names expected by the API build guard. Revenue source priority, prices, filters, authentication and response contract were not changed. The focused API/revenue tests and clean second prebuild pass; production function is deployed in `dpl_CPBrJmskV2tTRMED4PGiPpRY9BMN` and returns 401 before data access when no API key is supplied. |
| BUG-079 | High | MOD-14/MOD-20 role-specific Manager UI and mobile scroll overlap | Deployed — Signed-in mobile visual verification pending | Owner screenshots show the fixed mobile header/filter covering content and console warnings for globally preloaded attendance Capy. Owner also confirms the Admin redesign incorrectly replaced Manager's established UI. Source evidence showed Manager and Admin both selected the new Admin nav/default route, legacy dashboard rendering was removed, the mobile header was fixed with compensating top padding, and the Admin filter retained an earlier sticky declaration. | Restored Manager-only legacy routes/dashboard/menu/shell and retained Admin-only ERP routes. Mobile header/filter now scroll normally, and the attendance camera mascot is loaded only where used. No data scope, calculation, database schema or write flow changed. Focused role/auth/layout/preload regressions and the production build pass. Deployment `dpl_SeewScbBPsqksQKRb5hs3qBD4Q6g` is Ready/aliased; uncached live assets and API guards verify the role split, normal-flow header/filter, removed preload, on-demand mascot and revenue fallback. Browser runtime is unavailable for signed-in mobile screenshots. |

Final targeted regression on 2026-07-11 passed (four script syntax checks, authorization static synchronization, TypeScript no-emit). This does not resolve or hide the intentionally failing BUG-002/003 reproduction tests.

Final targeted regression on 2026-07-13 also passed all six selected commands: the three new feature/bug scripts, 22-route authorization synchronization, TypeScript no-emit, and LAN server syntax. This is local/static evidence only; pending device/UI/integration statuses above are unchanged.

Attendance/session/live-camera targeted regression on 2026-07-13 passed `ATTENDANCE_SESSION_LIVE_CAMERA_OK` plus TypeScript no-emit. Direct Safari camera/GPS/session verification is still pending and is not claimed Passed.

The 2026-07-13 live-camera/explicit-permission behavior above was explicitly superseded by the owner on 2026-07-14. Current regression is `ATTENDANCE_NATIVE_CAMERA_LOCATION_OK`; physical iPhone camera/GPS verification is still pending.

Environment/workflow blockers are tracked in `SESSION_HANDOFF.md` and decisions in `DECISION_LOG.md`; they are not misclassified as product bugs.

MOD02-TC-DB-01 is `Needs Business Confirmation`, not a confirmed bug: manager branch scope conflicts between latest migrations and frontend scope hydration. No fix is authorized or applied.
# 2026-07-19 — Shift photo actions and per-shift leader names

| ID | Severity | Module / surface | Status | Evidence | Resolution |
|---|---|---|---|---|---|
| BUG-086 | High | MOD-08/MOD-13 / shift photos and report leader identity | Deployed — signed-in Lotte Vũng Tàu verification pending | Owner reports the end-of-shift report duplicates Ca 1 leader into Ca 2, then verified hidden/misdirected and duplicated photo controls. Focused regressions, TypeScript, guarded build and live asset checks pass on replacement deployment `dpl_556zKbGBuvzHDy6196fUqUm2crsr`. | Resolve each leader independently from session-overlapping attendance. Keep one canonical two-button camera group, always visible, targeting the open or latest own closed session; remove repeated Today photo cards and never redirect capture to Attendance. Handover retains its workflow-specific closing proof. |
| BUG-087 | High | MOD-03 / Admin branch lifecycle | Deployed — first deliberate Admin action pending | Owner reports there is no branch removal function. The current Admin directory had only View/Create, while an old hidden backend path permanently deletes all branch sales, inventory, attendance, payroll, reports and employee auth accounts. Focused regressions, TypeScript, guarded build and live asset checks pass on `dpl_7fZxGocckSg8iLGvf6NwsEqowRN3`. | Add Admin-only safe removal that sets the branch inactive through existing cloud sync, removes it from active navigation and preserves all history. Explicitly do not expose or call the destructive cascade. |

# 2026-07-20 — Owner UX, inventory safety and Admin reporting

| ID | Severity | Module / surface | Status | Evidence | Resolution |
|---|---|---|---|---|---|
| BUG-088 | High | MOD-10 inventory quantity/unit presentation | Fixed locally — no deploy; physical data verification pending | Owner clarified that negative stock must not be solved by blocking an authorized over-stock issue. Source reproduction matches screenshot 2: `0.005 kg` renders as `5 g`, but a new outbound kg SKU defaulted its entry unit to `kg`; entering `5` therefore meant `5 kg`, not the displayed `5 g`. Bulk leftovers also have `lowStock=0`, so 5 g was incorrectly labelled `Đủ bán` even though the smallest configured potato package consumes 0.5 kg. | Restored the explicit “Vẫn tiếp tục lập phiếu?” path and passes the confirmed override without an expected failed RPC. A sub-kilogram kg SKU now defaults outbound entry to grams, while the user can still deliberately select kg. Physical residue remains visible but is labelled `Còn dư, chưa đủ đóng gói` from the existing packing-source quantities; stock formulas, movements and permissions are unchanged. |
| BUG-089 | Medium | MOD-04/MOD-07/MOD-12/MOD-17 Admin personnel, KPI and purchasing | Fixed locally — no deploy; visual/workbook verification pending | Employee sales detail rendered one card per receipt instead of a day-level revenue view. KPI detail had calculations but no concise reading guide. Admin purchasing exposed status mutations and exported CSV despite the owner requiring read-only list plus Excel. | Employee detail now aggregates by day with revenue/invoice/quantity/average-order columns and a dated chart. KPI retains existing daily/weekly formulas and gains a plain-language guide tied to the global branch/employee/date filters. Admin purchasing is read-only and exports filtered `.xlsx`. |
| BUG-090 | Medium | MOD-20 responsive layout / mobile header | Fixed locally — no deploy; Browser unavailable | Owner screenshots show clipped/overflowing responsive content and request removal of the Gustino logo beside the mobile page title. Required in-app Browser discovery returned `[]`; source inspection found many nested flex/grid/table surfaces without a shared shrink/wrap contract. | Removed only the mobile-header logo; desktop/sidebar branding remains. Added scoped min-width, word-wrap and horizontal-scroll hardening plus responsive daily-revenue chart rules. No route, permission or business data behavior changed. |
| BUG-091 | High | MOD-10 checked stock RPC migration order | Blocked — Requires direct schema-change approval | `20260624_allow_same_batch_outputs.sql` and `supabase/schema.sql` calculate availability from the latest physical count and take a per-SKU advisory lock, but the later `20260701_inventory_dashboard_handover_repair.sql` replaces the same RPC with a simple lifetime sum and no advisory lock. If that later body is active, UI stock after count and server validation can disagree, explaining intermittent 400 or unsafe concurrency. No production function or data was touched. | A new additive replacement migration must restore the already-defined latest-count/advisory-lock body, then be applied and verified read-only. Repository rules prohibit an unapproved schema change, so this remains blocked until the owner explicitly approves creating/applying that migration. |
| BUG-092 | High | MOD-16 Admin destructive cleanup UI | Fixed locally — no deploy | Owner directly requested removal of the Admin cleanup button. Control Center exposed a `Dọn dữ liệu` tab and an irreversible `Xóa dữ liệu đã chọn` action. No cleanup was invoked during reproduction. | Removed the visible tab and the entire destructive cleanup panel/button from rendered Admin UI. Backend/script safeguards remain untouched for controlled maintenance; no data or schema changed. Focused Admin cleanup regression, Admin ERP, sidebar and button contract pass. |
| BUG-093 | High | MOD-06 intermittent check-in/check-out confirmation | Fixed locally — no deploy; physical-device verification pending | Two source-confirmed intermittent paths existed. First, a saved check-in/out could look failed when the following refresh overwrote feedback/stale UI. Second, the attendance client abandoned `/api/reverse-geocode` after 4 seconds while that API called two 5-second providers sequentially, so slow Nominatim prevented the fallback from reaching the phone in time. | Successful writes now drive optimistic UI before best-effort refresh. The address API races both existing providers and returns the first concrete address; the client timeout is 6.5 seconds, longer than either provider's 5-second bound. `ATTENDANCE_REVERSE_GEOCODE_RACE_OK` exercises the real handler with a slow/failing primary and successful fallback. Selfie, fresh GPS, ≤150m accuracy, concrete address, ownership and idempotent writes are unchanged. |
| BUG-094 | Medium | MOD-07/MOD-20 competition ranking layout | Fixed locally — no deploy; visual verification pending | The ranking grid requires roughly 1,000 px with reward columns, but the Admin sidebar leaves less space at tablet/small-desktop widths. `.competition-classification-table { overflow: hidden; }` clipped the overflowing columns, matching the owner's report that the competition table was covered/hidden. | The table now exposes horizontal overflow instead of clipping. At 721–1180 px it switches to labelled two-column record cards, matching the existing ≤720 px mobile treatment. Ranking data, formulas, filters and rewards are unchanged. |
| BUG-095 | High | MOD-06 intermittent attendance transport recovery | Fixed locally — no deploy; physical-device verification pending | Focused pre-fix regression confirmed four LAN gaps: non-2xx status was lost before retry classification; selfie upload was not retried; checkout lacked final read-back after two lost responses; and two five-second address providers ran sequentially behind a 6.5-second client timeout. This could reject or falsely report a check-in/out during transient network/provider failures. | Preserve HTTP status for bounded retry, retry LAN selfie upload, read back a completed checkout before reporting failure, and race the two existing LAN address providers. Isolated LAN API integration verifies server-trusted timestamps, check-in, checkout, idempotent repeated checkout and one persisted record. GPS ≤150m, fresh location, concrete address, required selfies, ownership and database rules remain unchanged. |
# 2026-07-21 — BUG-101 Critical: approved custom/all-day shift with no `shift_id` could never receive an operational shift

- **Production evidence:** Thanh Ngân is active `shift_leader`, has approved 2026-07-21 registration `67c47962-704f-4036-9c7a-2f955210a378` for 07:15–22:15 and an open attendance record from 07:13 local. The registration deliberately has `shift_id=null`; branch leader templates still define Ca 1 as 07:15–15:15 and Ca 2 as 14:15–22:15. There are no 2026-07-21 sessions, yet the UI rejects her before `startBagShift()`.
- **Root cause:** BUG-100's recurrence guard treated missing `shift_id` as no operational assignment. That corrected the previous wrong-owner defect for explicit Ca 1/Ca 2 shifts, but accidentally rejected valid custom/all-day leadership registrations.
- **Fix:** Explicit `shift_id` keeps authoritative Ca 1/Ca 2 matching. A custom registration without an ID is now valid only for each configured leader shift whose full time range it covers: 07:15–22:15 validly covers both Ca 1 and Ca 2; a time range that covers neither cannot open a session. Thus Ca 1-only still cannot create Ca 2, while an all-day leader can receive both scheduled operational sessions automatically.
- **Verification:** `AUTO_SECOND_SHIFT_START_OK` now covers explicit Ca 1/Ca 2, all-day custom coverage for both sequences and unmatched custom rejection. `HANDOVER_QA_OK`, realtime, close/report, finalization and Zalo workflow regressions plus TypeScript pass. Guarded production build transforms 712 modules and passes `PRODUCTION_SUPABASE_BUNDLE_OK`.
- **Production:** Clean deployment `dpl_2eh2EKsoszEHxyindTti9K2zCdcp` is Ready and aliased; new handover/attendance/assignment assets and server-time return 200. The one-time read-only diagnosis endpoint was removed from source/alias (404) and its temporary deployment was deleted.
- **Status:** Fixed and production verified — signed-in Thanh Ngân retry pending.

# 2026-07-20 — BUG-100 Critical: automatic Ca 2 assignment reused the Ca 1 leader instead of the scheduled Ca 2 leader

- **Production evidence:** Read-only Vũng Tàu data for 2026-07-20 proves Dương Minh Tú is approved for 07:15–15:15 and Thanh Ngân is approved and checked in for 14:15–22:15. Despite that, the persisted Ca 2 session was created immediately after Ca 1 closed with Dương Minh Tú's `leader_id`/name. Thanh Ngân consequently has no owned session and no handover/finalization action.
- **Root cause:** Both automatic entry points (`openShiftAfterLeaderCheckIn()` and `ShiftHandoverPage`) chose the next ledger sequence from an active attendance record alone. Neither resolved the record's `shift_id` through the branch's configured leader shifts, so a still-open Ca 1 attendance record could create Ca 2 before the actual Ca 2 leader reached the handover screen.
- **Fix:** `operationalShiftAssignment.ts` maps an approved registration to Ca 1/Ca 2 through the configured leader work shift and permits only the next matching ledger sequence. Both automatic entry points use this same guard. A Ca 1 leader remains unable to create Ca 2 while still checked in; the checked-in Ca 2 leader receives Ca 2 automatically without a manual receive button.
- **Verification:** `AUTO_SECOND_SHIFT_START_OK` covers Ca 1/Ca 2 selection, wrong-leader rejection and missing-`shift_id` rejection. Updated browser/LAN handover QA uses two different leaders, keeps Ca 1's attendance open, proves it cannot create Ca 2, then proves the scheduled Ca 2 leader owns, closes and finalizes Ca 2 (`HANDOVER_QA_OK`). Realtime, close/report, report-finalization and Zalo workflow regressions plus TypeScript pass.
- **Production:** Deployment `dpl_Qy4TD2WKpD3vSW4TodUfoVvdJQTo` is Ready and aliased. Uncached production `ShiftHandoverPage-Cg2YFRwR.js`, `AttendancePage-DJLDbPko.js` and the new `operationalShiftAssignment-ANSXmhJI.js` all return HTTP 200; the live handover bundle includes the explicit Ca 1→Ca 2 rejection and `/api/server-time` is 200.
- **Authorized historical correction:** the owner authorized the exact row repair. A one-time token-protected service endpoint verified the target profile is an active `shift_leader` and patched only session `be3c2aaf-097f-4caa-86c6-81d2e7a20c7a` under exact ID/branch/date/sequence/old-owner/closed-status guards. It returned `leader_id=ae914636-b1af-4e32-9044-5d693acce7c3`, `leader_name=Lưu Thị Thanh Ngân`, while `started_at=2026-07-20T08:18:32.36Z` and `ended_at=2026-07-20T14:44:18.845932Z` stayed unchanged. Revenue, inventory, allocations, snapshots and operation-day rows were not written.
- **Cleanup/verification:** the one-time endpoint was removed from source, the clean production deployment `dpl_FYrs6wHGuuew9PviuJ4rpYC9NW6k` is Ready/aliased, and the temporary deployment containing the endpoint was deleted. Production guard assets and server-time return 200; the repair endpoint is 404.
- **Status:** Fixed and production verified — Thanh Ngân can now reopen Report and complete the already-closed Ca 2/day finalization; real n8n receipt confirmation remains pending.

# 2026-07-20 — BUG-099 Critical: late Ca 2 finalization queued n8n at a time that had already passed

- **Evidence:** At 22:40 local the Vũng Tàu screen shows both Ca 1/Ca 2 closed and an actionable finalization button, but no report is delivered. Read-only production data confirms the day has only a Ca 1 snapshot and remains `open`. `saveCloud()` passed no `sendNow` flag to `queueCurrentReportImages()`, so Ca 2/day jobs created after 22:00/22:15 were stored with a past `send_at`; the existing n8n flow had no new immediate-send instruction.
- **Fix:** Automatic finalization now queues n8n with `sendNow=true`, producing an immediate current UTC+7 send request for every finalization. The visible Ca 2 action now reads `Hoàn tất bàn giao Ca 2 & chốt ngày`, accurately describing the required last action after both shift handovers are closed.
- **Verification:** `SHIFT_CLOSE_REPORT_REALTIME_OK`, `N8N_REPORT_IMAGE_QUEUE_OK`, `LOCAL_N8N_RUNTIME_CONFIG_OK`, `LOCAL_N8N_SUPABASE_RUNTIME_OK`, finalization and sales consistency regressions plus TypeScript pass. Production Vercel configuration lists all three n8n report variables as encrypted Production variables; no webhook was invoked during this diagnostic to avoid a duplicate report.
- **Production:** Deployment `dpl_5pa2cKuBJMM3MvAAxueaeSfhad1R` is Ready and aliased. Uncached `ReportPage-DPlYdHy6.js` contains both the immediate-n8n confirmation and the Ca 2 completion label; production server-time is HTTP 200.
- **Status:** Deployed — one real Ca 2 finalization/n8n receipt confirmation pending.

# 2026-07-20 — BUG-096 Critical: Ca 2/report identity and finalize chain can select the wrong leader or never finalize

- **Evidence:** Read-only production audit of `lotte-2310` and `lotte-vt` found that 23/10 has distinct valid Ca 1 and Ca 2 leaders on 2026-07-20, but its one report snapshot carries a different legacy leader in `summary.leader`, contains only the Ca 2 entry, and the operation day remains `open`. Vũng Tàu Ca 2 is closed at 21:44 local time with no Ca 2 snapshot/final day. Source confirms `ReportPage.tsx` identifies an owner's shift with `leaderId === user.id || normalized leaderName === normalized user.name`, then prioritizes a closed session rather than the latest numbered owned session. `ShiftHandoverPage.tsx` also exposes a branch-open session without checking its owner; the post-handover sessionStorage request is written but never consumed by `ReportPage`.
- **Impact:** A Ca 2 leader can see a Ca 1 leader/report, lose the `Chốt & bàn giao` path, or be blocked as having no eligible shift. The intended Ca 2 daily finalization and automatic n8n handoff may not run.
- **Fix:** Centralized shift ownership in `ownsBagShiftSession()`: a persisted `leaderId` is authoritative; normalized display-name comparison is retained only for legacy sessions that truly have no leader ID. `latestOwnedBagShiftSession()` now picks the highest/latest owned sequence, not an older closed session. Handover exposes close controls only to that owner and waits for a different leader's open shift. Report consumes the existing post-handover intent and finalizes exactly that closed session once; Ca 1 queues only its shift report, while Ca 2 queues its report and the total-day report for n8n.
- **Verification:** `SHIFT_CLOSE_REPORT_REALTIME_OK`, a fresh isolated browser/API handover run `HANDOVER_QA_OK` (Ca 1 snapshot persisted while the day stayed open, then Ca 2 merged both shift entries and closed the day), plus TypeScript and the handover/finalization/n8n/realtime/mobile/sales regressions passed. No production business row or n8n workflow was invoked during verification.
- **Follow-up production evidence:** Read-only audit after the owner screenshot confirms Vũng Tàu has both Ca 1/Ca 2 `closed` under the same leader, only the Ca 1 snapshot, and an `open` operation day. This is why Bàn giao no longer shows a new close button: the two handovers are already complete; the remaining actionable step is Ca 2/day finalization on Report.
- **Further root-cause refinement:** Vũng Tàu's schedule/attendance data identifies Thanh Ngân as the approved/checked-in Ca 2 leader. BUG-100 proves the Ca 2 ledger session was wrongly created by the still-active Ca 1 attendance, not by missing handover UI alone.
- **Status:** Deployed — label/immediate-n8n, BUG-100 scheduled-owner enforcement and the authorized owner correction are live. BUG-101 custom/all-day coverage is also deployed; remaining action is the signed-in report finalization/n8n receipt confirmation.

# 2026-07-20 — BUG-097 Critical: completed report snapshot hides later POS revenue while the business day is still open

- **Evidence:** Production 23/10 snapshot at `2026-07-20T08:14:47Z` has 554,000đ / 10 items, exactly matching 9 receipts at or before that timestamp. There are 25 later receipts worth 1,244,000đ (current total 1,798,000đ / 35 items). `src/lib/revenue.ts` treats any snapshot with a numeric summary revenue as authoritative and suppresses every POS row for its branch/date, irrespective of later receipt timestamps or an open operation day.
- **Impact:** Revenue screens do not update in realtime for 23/10 after a premature/stale snapshot.
- **Fix:** The saved snapshot remains the report baseline, but `buildDailyRevenueRows()` now adds only POS receipts created after that snapshot. Receipts already included at snapshot time are not counted twice, and the row stays one daily record.
- **Verification:** The exact 23/10 fixture now produces 1,798,000đ / 35 items from the 554,000đ / 10-item baseline plus later receipts (`SHIFT_CLOSE_REPORT_REALTIME_OK`); `REVENUE_PARTIAL_SNAPSHOT_FALLBACK_OK`, sales/report consistency, TypeScript and realtime regressions pass.
- **Production:** Deployed 2026-07-20. Uncached `revenue-LFwMiet_.js` contains the numeric snapshot guard and post-snapshot receipt-time filter; production server-time returns HTTP 200. No snapshot or receipt was rewritten.
- **Status:** Deployed — signed-in branch confirmation pending.

# 2026-07-20 — BUG-098 High: employee removal behavior conflicted with the owner's required permanent-delete rule

- **Evidence:** `deleteEmployeeAccount()` invokes Edge action `hard_delete` even though the Edge function has a separate non-destructive `delete` action. The hard-delete routine deletes attendance, registrations, payroll and profile rows through many sequential database calls. LAN mode already deactivates the account instead, proving cloud/LAN behavior diverged. `AdminPage.tsx` immediately removes the active detail record from state, increasing the chance of a blank/stale detail route after the destructive request.
- **Impact:** Removing an employee can delete historical business evidence and leave the Admin UI in a blank/stale route.
- **Owner decision:** The owner explicitly requires normal employee removal to delete the account, not ban/deactivate it. This supersedes the prior conservative deactivation behavior.
- **Fix:** The single normal `Xóa nhân viên` action now uses the existing permanent-delete workflow in LAN and cloud, removes the CRM row after success, safely exits its detail route and has a two-step confirmation spelling out the affected schedule/attendance/payroll records. The duplicate `Xóa sạch test` and all deactivation wording are removed, so an account cannot unexpectedly remain listed as inactive after a requested deletion.
- **Verification:** `SHIFT_CLOSE_REPORT_REALTIME_OK`, `ACCOUNT_ORPHAN_RECOVERY_OK`, TypeScript and Admin/account regressions pass. No employee account or historical business record was changed during verification.
- **Production:** Deployment `dpl_5pa2cKuBJMM3MvAAxueaeSfhad1R` is Ready and aliased. Uncached `AdminPage-DWVmqrPO.js` has `Xóa nhân viên` and no deactivation label.
- **Status:** Deployed — one owner-authorized delete confirmation pending.

## BUG-106 — Cao Bảo Trân không check-in/check-out được (đang điều tra, CHƯA có fix, CHƯA deploy)

**Ngày điều tra:** 2026-07-21. **Trạng thái:** Open — đã loại trừ toàn bộ phía server/DB; chưa xác định được điểm hỏng phía client vì thiếu thông báo lỗi thực tế trên máy nhân viên. **Không deploy gì trong phiên này.**

### Tài khoản
- `profiles.id = 24efd4c4-53c3-4a74-a2fd-d9d21942ad23`, `full_name = Cao Bảo Trân`, `email = baotran@accounts.gustino.vn`, `role = staff`, `branch_id = gold-coast`, `active = true`, `employment_status = working`, `employment_type = part_time`.
- `auth.users` khớp đúng id, `email_confirmed_at = 2026-07-04`, `banned_until = null`. Không phải tài khoản mồ côi.

### Những gì ĐÃ loại trừ (đừng kiểm tra lại)
1. **Auth/phiên đăng nhập OK.** `auth.sessions` còn phiên sống tạo 2026-07-16, `updated_at` cuối 2026-07-21T06:12Z; chuỗi `auth.refresh_tokens` refresh đều đặn ~1 giờ/lần liên tục từ 17/07 đến hôm nay. Nhân viên VẪN đang dùng app bình thường → không phải bị sign-out.
2. **RLS cho phép ghi.** `attendance_records` INSERT policy `employee checks in` = `user_id = auth.uid() AND EXISTS(shift_registrations sr WHERE sr.id = shift_registration_id AND sr.user_id = auth.uid() AND sr.branch_id = ... AND sr.status <> 'rejected')` → thỏa. UPDATE policy `employee checks out` → thỏa. `shift_registrations` SELECT `branch_id = current_profile().branch_id` → thỏa (cùng gold-coast).
3. **Storage OK.** Bucket `attendance-selfies` policy INSERT yêu cầu `foldername[1] = auth.uid()`; client ghi path `${user.id}/${branchId}/...` → khớp. Cô ấy đã upload thành công ngày 11/07.
4. **Không có trigger/constraint chặn.** `attendance_records` không có trigger nào. Constraint chỉ gồm FK, PK, UNIQUE(shift_registration_id), check `check_out_time >= check_in_time` và check bắt buộc bằng chứng check-out.
5. **API production khỏe.** `/api/reverse-geocode?lat=12.2481968&lng=109.1952713` (đúng tọa độ chi nhánh của cô ấy) trả `200` trong 0.13–1.56s với địa chỉ cụ thể `1 Trần Hưng Đạo, Phường Nha Trang, Nha Trang` (source nominatim). `/api/server-time` trả `200`.
6. **Production ĐÃ có bản vá BUG-093/BUG-095.** Bundle `assets/index-jz17XQYv.js` đang phục vụ chứa marker `reverse-geocode`, timeout `6500`, `attendance-selfies`, `Chưa lấy được địa chỉ cụ thể`, `Supabase chưa xác nhận check-out`. Ghi chú "Fixed locally — no deploy" ở BUG-093/095 nay đã lỗi thời — code đó ĐÃ lên production.
7. **Logic UI không chặn.** `AttendancePage.tsx:391` `canCheckIn = registration.workDate === today && !record`; không có rào giờ. Hai đăng ký ca hôm nay 21/07 (09:00–13:00 shift `0c58a647`, và 13:00–14:00 shift_id null) đều `approved` và chưa có record → nút Check-in PHẢI đang hiện.

### Dữ liệu bất thường tìm được
- **Bản ghi chấm công mở treo 10 ngày:** `attendance_records.id = 775de9ab-e18c-424f-8820-0c191b46166e`, check-in `2026-07-11 16:01:51` giờ VN, `check_out_time = NULL`, gắn registration `74c245e9`. GPS 12.2481968/109.1952713, accuracy 14.68m, địa chỉ đầy đủ, selfie có. **Chưa đụng vào** — theo tiền lệ BUG-071, tuyệt đối không tự đóng/ngụy tạo bằng chứng chấm công.
- Đây là lần check-in THẬT cuối cùng của cô ấy. Từ 12/07 đến nay không có thêm bản ghi nào dù có đăng ký ca (12/07, và 2 ca hôm nay 21/07).
- 5 bản ghi còn lại (04–09/07) đều là giờ tròn trịa (10:00–14:00, 16:00–21:00) → là công bù admin từ đợt backfill 10/07, không phải chấm công thật.
- Đăng ký ca hôm nay được tạo lúc `06:19Z` = **13:19 giờ VN**, tức ca 09:00–13:00 đã KẾT THÚC trước khi được đăng ký. Ca 13:00–14:00 tạo thủ công liền kề. Kiểu thao tác này giống người đang cố lách một lỗi nào đó.

### Giả thuyết còn lại (phía client/thiết bị, chưa kiểm chứng được)
Thiết bị: Android, Chrome 150 (`Mozilla/5.0 (Linux; Android 10; K) ... Chrome/150.0.0.0 Mobile Safari/537.36`). Trước 10/07 từng dùng trình duyệt trong Zalo.
Bốn điểm có thể ném lỗi trong `checkIn()`/`checkOut()` (`src/lib/attendance.ts`), mỗi điểm có message tiếng Việt riêng:
1. `getAttendanceLocation()` — bị từ chối quyền GPS. **Lỗi thật đã xác nhận trong source:** `src/lib/attendance.ts:1550` khi `PERMISSION_DENIED` luôn hiện hướng dẫn dành riêng cho **Safari/iPhone** ("Vào Cài đặt → Quyền riêng tư & Bảo mật → ... → Safari Websites"). Nhân viên dùng **Android Chrome** sẽ đọc hướng dẫn hoàn toàn vô dụng và không biết cách bật lại quyền. Cần sửa thành hướng dẫn theo nền tảng.
2. `requireConcreteAttendanceAddress()` (`attendance.ts:1641`) — "Chưa lấy được địa chỉ cụ thể. Hãy kiểm tra kết nối mạng rồi chấm công lại." Nếu mạng 4G của máy chặn/chậm `/api/reverse-geocode` thì check-in bị từ chối dù GPS tốt.
3. `getBestGeolocationPosition()` (`attendance.ts:1651`) — yêu cầu accuracy ≤ 150m; GPS yếu trong nhà → trượt.
4. `stampAttendancePhoto()` → `decodeImageForCanvas()` (`src/lib/browser.ts:74`) — "Thiết bị không đọc được định dạng ảnh này." / `uploadSelfie` ném "Ảnh selfie là bắt buộc." nếu blob rỗng.

### Việc cần làm tiếp (bước 1 là bắt buộc)
1. **Hỏi nhân viên chụp màn hình dòng chữ đỏ báo lỗi** khi bấm Check-in. Mỗi giả thuyết ở trên có một câu tiếng Việt khác nhau → câu đó chỉ thẳng ra điểm hỏng. Không có nó thì mọi bản sửa đều là đoán mò.
2. Sửa message PERMISSION_DENIED cho Android/Chrome (lỗi chắc chắn, độc lập với root cause).
3. Quyết định cách xử lý bản ghi mở treo 11/07 — cần admin dùng chức năng chỉnh công có ghi lý do, KHÔNG sửa thẳng DB.

### Ghi chú môi trường (quan trọng cho phiên sau)
Ổ **C: đã đầy (còn ~0.2 GB)** nên `npx supabase` cài thất bại với `ENOSPC`. Cách chạy được DB query:
`npm_config_cache=/d/gustino/.npm-cache npx --yes supabase@2.109.1 db query --linked --file <file.sql>`
Truyền SQL nhiều dòng qua `--file`, KHÔNG truyền inline (CLI báo `String must contain at least 1 character(s)`).
Script audit đã lưu: `scripts/db_audit_cao_bao_tran_20260721.sql`, `scripts/db_audit_attendance_guards_20260721.sql`, `scripts/db_audit_cao_bao_tran_session_20260721.sql`.

### BUG-106 — ĐÃ TÌM RA NGUYÊN NHÂN VÀ SỬA (2026-07-21, CHƯA DEPLOY)

**Triệu chứng quyết định (chủ quán xác nhận):** "không hiển thị lỗi, chỉ thấy trạng thái load nhưng không có kết quả" — nút Check-in quay vòng mãi, KHÔNG có dòng báo lỗi nào. Đây chính là chìa khóa: nếu có lỗi thì `handleCheckIn` đã `onFeedback(...)`. Quay vòng vô hạn = **một promise không bao giờ settle**.

**Root cause:** Toàn bộ luồng ghi chấm công có 5 bước KHÔNG có timeout, chỉ cần một bước treo là kẹt vĩnh viễn và không ném lỗi:
1. `canvas.toBlob(callback, ...)` trong `stampAttendancePhoto()` — nếu máy thiếu bộ nhớ, callback KHÔNG BAO GIỜ được gọi. Promise treo mãi.
2. `createImageBitmap()` / `image.decode()` trong `decodeImageForCanvas()` (`src/lib/browser.ts`) — không có timeout, treo với ảnh camera lớn trên máy Android yếu.
3. `supabase.storage.from('attendance-selfies').upload()` — supabase-js KHÔNG đặt timeout; mạng 4G chập chờn treo request vô hạn.
4. `supabase.from('attendance_records').insert()/.update()` — postgrest-js cũng không có timeout.
5. `blobToDataUrl()` cho ảnh xem trước — nằm chắn ngang luồng dù chỉ là ảnh hiển thị.

Lớp `withAttendanceWriteRetry` sẵn có CHỈ retry khi có exception được ném ra. Promise treo thì không bao giờ ném → retry không bao giờ chạy. Đó là lý do các bản vá BUG-093/BUG-095 (đã lên production) không cứu được ca này.

**Fix (`src/lib/attendance.ts`):** Thêm `withAttendanceDeadline()` + `AttendanceStepTimeoutError`, đặt hạn chót cứng cho từng bước — vị trí 25s, ảnh 20s, upload 25s, ghi DB 20s. Hết hạn thì **BÁO LỖI tiếng Việt cụ thể, hành động được**, tuyệt đối không bỏ qua ảnh/GPS/địa chỉ (giữ nguyên mọi ràng buộc bằng chứng). Timeout ở upload/ghi DB mang `status = 408` để lớp retry sẵn có thử lại đúng một lần. Riêng `blobToDataUrl` (ảnh xem trước, KHÔNG phải bằng chứng) hết hạn thì bỏ preview chứ không chặn check-in.

**Fix phụ (lỗi chắc chắn, độc lập):** `locationPermissionHelpText()` — trước đây mọi máy bị từ chối quyền GPS đều nhận hướng dẫn dành riêng cho **Safari/iPhone**. Cô Trân dùng **Android Chrome** nên đọc hướng dẫn hoàn toàn vô dụng. Nay hướng dẫn tách theo iPhone / Android / desktop.

**Kiểm chứng:** `npx tsc -b` pass. `npm run build` pass (bundle `index-Ce1y8mkT.js` chứa đủ 5 marker thông báo mới). QA: `ATTENDANCE_QA_OK` (chạy trọn check-in + check-out thật qua đúng code đã sửa), `ROLE_ACCESS_QA_OK`, `APP_NAVIGATION_QA_OK`, `HANDOVER_QA_OK`, `SHARED_SCHEDULE_ACCOUNTS_QA_OK`.

**Sửa 2 assertion QA đã lỗi thời trong `scripts/qa-attendance.mjs`** (script cũ so với đợt đại tu UI đang dở, không liên quan bug này): (1) click nút sidebar "Chấm công" luôn timeout vì sidebar nằm ngoài viewport ở khổ 390px → đổi sang điều hướng bằng hash `#attendance`; (2) sau check-out ca chuyển sang `renderCompletedRow` với class `.completed-shift-row` và chữ "Ra" KHÔNG có dấu hai chấm, nhưng script vẫn tìm `.shift-card` + `/Ra:/` → sửa theo UI hiện tại.

**Hai QA từng hỏng — ĐÃ HẾT (kiểm lại 2026-07-21, phiên sau):**
- `qa-admin.mjs` → `MANAGEMENT_QA_OK`.
- `qa-mobile-shift-setup.mjs` → `MOBILE_SHIFT_AUDIT_OK` (9 ảnh audit sinh đủ trong `artifacts/mobile-audit-fix-shifts/`).
Hai lỗi đó là **trạng thái dev server cũ/HMR hỏng**, không phải lỗi source: chạy lại trên cùng cây làm việc (không sửa thêm dòng code nào) thì cả hai xanh. Ghi chú "trang dashboard admin đang hỏng" ở dưới nay đã lỗi thời.

Bằng chứng gốc không liên quan: mọi symbol đã thêm/sửa (`withAttendanceDeadline`, `AttendanceStepTimeoutError`, `locationPermissionHelpText`, `stampAttendancePhoto`, `uploadAttendanceSelfieWithRetry`, `getAttendanceLocation`) đều **private trong `src/lib/attendance.ts`, không nơi nào khác dùng**. `ManagerDashboardPage.tsx` chỉ import `fetchEmployees`/`permittedBranchIds`; `SalesPage.tsx` chỉ import `fetchAttendanceRecords`/`fetchEmployees`/`fetchShiftRegistrations`/`findAttendanceRecordForRegistration` — không hàm nào bị đụng tới. Hai lỗi này đến từ đợt sửa dashboard đang dở dang chưa commit (`ManagerDashboardPage.tsx`, `AdminPage.tsx`, `styles.css` đã ở trạng thái modified từ trước phiên này).

**ĐÃ DEPLOY PRODUCTION (2026-07-21, chủ quán cho phép phát hành cả lô).** Lý do chặn kỹ thuật trước đây (dashboard admin hỏng) KHÔNG còn. Kiểm chứng trước phát hành: `npx tsc -b` exit 0; `npm run build` pass → `PRODUCTION_SUPABASE_BUNDLE_OK (index-Ce1y8mkT.js; revenue-BIBA5MGD.js)`; QA `ROLE_ACCESS_QA_OK`, `APP_NAVIGATION_QA_OK`, `ATTENDANCE_QA_OK`, `HANDOVER_QA_OK`, `MANAGEMENT_QA_OK`, `MOBILE_SHIFT_AUDIT_OK` — 6/6 xanh.

- Commit `70377fa` gộp bản vá BUG-106 + lô BUG-102/103/104/105 + `operationalShiftAssignment.ts`; đồng thời bỏ theo dõi `.npm-cache/` (50 file) và loại nó khỏi upload Vercel qua `.vercelignore`.
- Deployment `dpl_EesrhTX12smQRLsyy1JYSaYC6pnV` READY/target production, đã trỏ alias `https://gustino-operations.vercel.app`.
- Xác minh live: `index-Ce1y8mkT.js` + `index-BKrERcAQ.css` đang được phục vụ; `/api/server-time` trả 200. Bundle production chứa đủ marker của bản vá: `Quá 25 giây chưa lấy được vị trí`, `Máy đọc ảnh chấm công quá lâu`, `Máy xử lý ảnh chấm công quá lâu`, status retry `408`, và hướng dẫn quyền GPS tách riêng Android (`biểu tượng ổ khóa cạnh địa chỉ web → Quyền → bật Vị trí`) lẫn iPhone (`Safari Websites`).
- KHÔNG có migration, query/ghi dữ liệu production, gọi webhook n8n hay push GitHub trong lượt phát hành này.

**Việc còn lại:** (1) —; (2) sau khi lên production, nhờ cô Trân check-in lại — nếu vẫn không được thì nay ĐÃ CÓ thông báo lỗi cụ thể chỉ đúng bước hỏng thay vì quay vòng câm lặng; (3) xử lý bản ghi mở treo `775de9ab-e18c-424f-8820-0c191b46166e` (check-in 11/07 16:01, chưa check-out) bằng chức năng chỉnh công có ghi lý do của Admin, KHÔNG sửa thẳng DB.

## BUG-107 — Cao Bảo Trân không chấm công được trên máy Samsung, đổi máy khác thì được (2026-07-21)

**Triệu chứng chủ quán báo:** cùng một tài khoản, mở trên điện thoại Samsung thì không chấm công được; đăng nhập bằng điện thoại khác thì chấm được ngay.

### Nguyên nhân — tìm bằng bằng chứng, không đoán
`auth.sessions.user_agent` của chính tài khoản này (`24efd4c4-…ad23`) cho thấy 3 loại thiết bị khác nhau:

| Thời điểm | User agent | Ý nghĩa |
|---|---|---|
| 10/07 15:55–20:38 | `Android 14; **SM-A235F** Build/UP1A.231005.007;) … **Version/4.0** Chrome/… Mobile Safari` | **Samsung Galaxy A23, chạy trong Android WebView** (trình duyệt nhúng của app khác, điển hình là Zalo) |
| 11/07, 21/07 | `Android 10; K … Chrome/150.0.0.0 Mobile` | Chrome thật (UA rút gọn) |
| 21/07 14:56 | `iPhone … Safari` | Máy khác — lượt check-in thành công |

Hai đặc điểm `Build/…` và `Version/4.0` chỉ có ở **Android WebView**; Chrome thật đã bỏ token `Build/` từ lâu. Đó là chiếc "điện thoại Samsung" trong lời kể.

Trong Android WebView, quyền định vị KHÔNG do trình duyệt cấp mà do **app chủ**: app phải tự cài `WebChromeClient.onGeolocationPermissionsShowPrompt()` và bản thân app phải đang có quyền vị trí của hệ điều hành. Nếu app chủ không làm (rất phổ biến ở trình duyệt trong Zalo/Facebook), `navigator.geolocation.getCurrentPosition()` **không gọi callback thành công lẫn thất bại** — nên trước bản vá BUG-106 nút chấm công quay vô tận không báo lỗi, còn sau BUG-106 thì báo hết hạn 25 giây. Mở đúng cùng tài khoản bằng Chrome/Safari thì mọi thứ chạy bình thường. **Web không thể tự sửa việc này** — chỉ có thể phát hiện và hướng dẫn thoát ra trình duyệt thật.

**Yếu tố cộng hưởng thứ hai (cùng máy đó):** Galaxy A23 có camera 50MP. `decodeImageForCanvas()` trước đây giải mã ảnh ở **độ phân giải gốc** (50MP ≈ 200MB RAM ở dạng RGBA) rồi mới thu nhỏ — đủ để máy 4GB RAM treo hoặc bị hệ điều hành giết ngay tại `createImageBitmap`/`canvas.toBlob`.

### Bản vá
1. **`src/lib/deviceReadiness.ts` (mới):** nhận diện WebView Android (`; wv)`, `Build/`, `Version/4.0`+`Chrome/`), WebView iOS (thiếu `Safari/`), tên app chủ (Zalo/Facebook/Messenger/Instagram/TikTok/WeChat/LINE/Shopee), dòng máy (`SM-A235F`), HTTPS, và trạng thái quyền vị trí qua Permissions API. Kèm `openInSystemBrowser()` (Android dùng `intent://…package=com.android.chrome`) và `copyAttendanceLink()` có nhánh dự phòng `execCommand` cho WebView cũ.
2. **`src/components/AttendanceDeviceCheck.tsx` (mới):** thẻ tự kiểm tra ngay đầu màn chấm công. Máy vướng → cảnh báo lớn nêu đúng nguyên nhân + nút "Mở bằng trình duyệt điện thoại" / "Sao chép link app". Máy ổn → chỉ một dải trạng thái gọn, bấm mới xổ, có nút "Kiểm tra vị trí ngay" chạy đúng code của luồng chấm công thật (`probeAttendanceLocation()`).
3. **`src/lib/attendance.ts`:** thông báo lỗi vị trí (cả khi bị từ chối lẫn khi hết hạn 25s) nay nhận biết WebView và nói thẳng "bạn đang mở trong <app>, hãy mở bằng Chrome/Safari" thay vì bảo đi bật GPS vốn đã bật. Ảnh chấm công giải mã ở cạnh dài tối đa 2560px (`ATTENDANCE_PHOTO_DECODE_MAX_EDGE`) — ảnh đóng dấu vẫn xuất 1280px như cũ, không đổi chất lượng.
4. **`src/lib/browser.ts`:** đọc kích thước ảnh từ header (JPEG SOF / PNG IHDR) rồi yêu cầu `createImageBitmap` giải mã THẲNG về cỡ đích (`resizeWidth/Height`), không dựng khung hình gốc. Nhận diện HEIC/HEIF theo `ftyp` brand → báo đúng "tắt Ảnh hiệu suất cao trong Camera" thay vì "không đọc được định dạng ảnh".
5. **CSS `.devchk-*`** cuối `src/styles.css`, mobile-first, `overflow-wrap: anywhere`, nút `flex: 1 1 200px` — không tràn ngang ở 390px.

### Kiểm chứng
- `npx tsc -b` exit 0; `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`).
- **QA mới `scripts/qa-device-readiness.mjs`** — mô phỏng đúng UA Samsung SM-A235F trong WebView lấy từ DB: Chrome → không chặn; WebView → chặn + đủ nút; WebView có tên app → gọi đúng tên; quyền bị chặn → hướng dẫn bật lại. Cả 4 ca đều kiểm tra không tràn ngang. `DEVICE_READINESS_QA_OK`, ảnh ở `artifacts/device-readiness/`.
- QA cũ chạy lại đủ 7 bộ, xanh hết: `ATTENDANCE_QA_OK`, `ROLE_ACCESS_QA_OK`, `APP_NAVIGATION_QA_OK`, `MANAGEMENT_QA_OK`, `HANDOVER_QA_OK`, `SHARED_SCHEDULE_ACCOUNTS_QA_OK`, `MOBILE_SHIFT_AUDIT_OK`.
- Rà tràn ngang 390px trên `today`/`handover`/`inventory`/`orders`/`sales`/`attendance`/`report`: `NO_HORIZONTAL_OVERFLOW`.
- KHÔNG ghi/sửa/xóa dữ liệu production trong lượt này (chỉ đọc `auth.sessions`, `attendance_records`, `shift_registrations`).

### Phát hiện nghiệp vụ kèm theo (chủ quán chọn ĐỂ SAU, ghi backlog)
Check-in **không kiểm tra khoảng cách tới chi nhánh**, chỉ yêu cầu sai số GPS ≤150m. Bằng chứng: bản ghi `f21c872d-…451f` ngày 21/07 14:56 của tài khoản này có địa chỉ "Đường 57A, Phường Tân Tạo, TP.HCM" trong khi chi nhánh là Gold Coast **Nha Trang** (chủ quán xác nhận đây là thao tác thử của chính mình trên iPhone). Muốn chặn gian lận vị trí thì cần thêm toạ độ chi nhánh + ngưỡng khoảng cách; `src/lib/constants.ts` hiện KHÔNG lưu toạ độ chi nhánh nào. Bản ghi 21/07 giữ nguyên, không đụng.

## BUG-108 — Excel báo cáo kho hiện số nguyên kèm dấu chấm thừa ("0.", "148.", "270.") (2026-07-21)

**Triệu chứng:** bảng "TỔNG HỢP KHO 1/7/2026 - 31/7/2026" xuất ra có mọi số nguyên kèm dấu chấm ở cuối: cột Tồn đầu kỳ toàn `0.`, Xuất/giảm `148.`, Bánh hạt dẻ `270.`; số có phần lẻ (`9.91`, `240.1879`) thì hiển thị đúng.

**Nguyên nhân:** `INVENTORY_EXCEL_QUANTITY_FORMAT = '0.####'` (`src/pages/AdminPage.tsx`). Trong mã định dạng số của Excel, **dấu chấm thập phân được in nguyên văn**, còn `#` đứng sau nó không in gì khi số không có phần lẻ — nên 148 hiện thành "148." và 0 hiện thành "0.". Đây là lỗi trình bày thuần tuý, **số liệu trong file hoàn toàn đúng**. Excel không có cách viết "ẩn dấu chấm nếu là số nguyên" trong một mã định dạng.

**Bản vá:** đổi sang `'General'` (số nguyên ra "148", số lẻ ra "240.1879") và **làm tròn 4 số lẻ khi ghi ô** để không lòi đuôi dấu phẩy động (`0.30000000000000004`) hay ký hiệu khoa học. Gom vào helper `applyInventoryQuantityFormat(sheet, keys)` dùng chung cho cả 7 chỗ: Tổng hợp kho, Đối chiếu ca, Xuất kho để bán, Nhật ký kho, Tồn kho hiện tại, Phiếu kiểm kê, Danh sách đặt hàng. Cột tiền (`Doanh thu POS`) giữ `'0'` — số nguyên, vốn không có dấu chấm.

**Kiểm chứng — `scripts/qa-inventory-export.mjs` (MỚI, marker `INVENTORY_EXPORT_QA_OK`):** bấm đúng nút "Xuất Excel" của màn Báo cáo kho, tải file .xlsx thật rồi mở lại bằng exceljs, khẳng định mọi cột số lượng là `General`, không mã định dạng nào kết thúc bằng `.#*` (mẫu in dấu chấm thừa), và mọi ô số đã làm tròn 4 số lẻ → `FORMAT_OK 12 cột số lượng · 476 ô số`. **Đã kiểm tra ngược:** đặt lại `'0.####'` thì script FAIL đúng chỗ (`Tổng hợp kho · Tồn đầu kỳ: mã định dạng "0.####" in dấu chấm thừa`) — test không rỗng.

`npx tsc -b` exit 0; `npm run build` pass. QA cùng lượt: `MANAGEMENT_QA_OK`, `ROLE_ACCESS_QA_OK`, `APP_NAVIGATION_QA_OK`, `ATTENDANCE_QA_OK`, `HANDOVER_QA_OK`, `DEVICE_READINESS_QA_OK`.

# 2026-07-23 — BUG-112 Critical: Vũng Tàu kẹt "chưa nhận được ca", không bàn giao được

**Không có dòng code nào dành riêng cho Vũng Tàu.** Chi nhánh này vỡ vì *hình dạng dữ liệu lịch*: VT chỉ có **2 ca trưởng** (Gold Coast 3, Lotte 23/10 4), nên thường xuyên rơi vào các tình huống mà code ngầm giả định "mỗi ca một người khác nhau".

**Bằng chứng production (chỉ đọc):**
- 23/07: Lưu Thị Thanh Ngân check-in 07:14 với đăng ký Ca 1 đã duyệt; `operation_days` của `lotte-vt` được tạo lúc `00:14:28.824Z` (3,5 giây sau check-in) nhưng **không có `bag_shift_sessions` nào**. Gold Coast và Lotte 23/10 cùng luồng, cùng thời điểm đều mở ca bình thường. → `ensureOperationDay()` chạy xong, `startBagShift()` ném lỗi rồi **không bao giờ được thử lại**.
- Dựng lại đúng câu INSERT dưới danh tính của Ngân trong transaction *luôn rollback*: kết quả `INSERT WOULD SUCCEED`. Vậy **không phải** lỗi RLS, FK, ràng buộc, trigger hay cấu hình chi nhánh — schema/`shifts`/`profiles` của VT giống hệt 2 chi nhánh kia.
- 21/07, 22/07, 04/08: VT phải **tự tay tạo đăng ký `shift_id = NULL` 07:15–22:15** để một người ôm cả 2 ca — đó là cách lách tay cho giới hạn của code (BUG-101), 2 chi nhánh kia không bao giờ cần.
- 06/08, 07/08, 08/08 chỉ xếp Ca 1; 03/08, 09/08 chỉ xếp Ca 2 → sequence còn lại **không ai mở được**, ngày không thể bàn giao/chốt.

**Nguyên nhân gốc (3 lỗi, đều ở code dùng chung):**
1. `ShiftHandoverPage` lấy `myAttendance.find(r => !r.checkOutTime)` rồi chỉ nhận đăng ký gắn với **một** bản ghi đó. Ca trưởng giữ cả Ca 1 lẫn Ca 2 (2 đăng ký, 2 bản ghi chấm công) luôn bị đọc ra đăng ký Ca 1 → từ chối mở Ca 2.
2. Mở ca tự động chỉ chạy **một lần** cho mỗi khóa và **không có nút nhận ca thủ công** — `handleStartShift()` tồn tại nhưng không nút nào gọi. Mạng chập chờn (điện thoại ngoài quầy) là ca trưởng kẹt cả ngày, màn hình chỉ hiện dòng chữ thụ động.
3. Ngày chỉ xếp một ca trưởng thì sequence còn lại không có chủ và không có lối thoát nào.

**Bản vá (không thêm nhánh riêng cho VT):**
1. Xét **mọi** đăng ký đã duyệt mà ca trưởng đang check-in (`openAttendances` + `startableRegistration`), chọn đúng đăng ký khớp sequence kế tiếp. Quy tắc BUG-100 giữ nguyên: vẫn phải có lịch **và** đã check-in.
2. Nút **"Nhận ca ngay"** hiện khi ca trưởng đủ điều kiện; khi tự mở lỗi thì bật cờ `autoStartFailed`, dừng vòng lặp tự động và đổi thông điệp sang hướng dẫn bấm nút. Thông báo check-in lỗi ở Chấm công chỉ đường sang màn Bàn giao.
3. Nút **"Nhận tiếp Ca N" + xác nhận 2 bước** (chủ sở hữu chọn phương án này) — chỉ hiện khi **không ca trưởng nào khác được xếp** sequence đó (`anotherLeaderScheduledForNext`, lọc `employmentType === 'leader'`). Không tự động, nên **không tái phát BUG-100** (Ca 1 tự chiếm Ca 2).

**Kiểm chứng:** `scripts/test-handover-shift-recovery.mjs` (MỚI, marker `HANDOVER_SHIFT_RECOVERY_OK`) — vừa khẳng định wiring nguồn, vừa chạy logic thật: Ca 1 mở được sequence 1, Ca 1 **không** mở được sequence 2, Ca 2 mở được sequence 2 kể cả khi cùng người, ca part-time không bao giờ được tính là ca trưởng, và vòng tự động chỉ gọi `handleStartShift()` không tham số. `AUTO_SECOND_SHIFT_START_OK`, `test-shift-realtime-reminders`, `test-handover-daily-report-access`, `test-auto-close-day`, `test-inventory-shift-reconciliation`, `test-mobile-handover-report-overflow` pass. `npx tsc -b` exit 0; `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`).

**Chưa làm:** chưa deploy. Không ghi/sửa một dòng dữ liệu production nào trong lượt này.

**Ghi chú Gold Coast 22/07 (liên quan, khác nguyên nhân):** báo cáo ngày của Gold Coast do **cron `/api/auto-close-day`** (`vercel.json`, `0 17 * * *` = 00:00 giờ VN) chốt lúc `17:53:50.9Z`, `finalizedByName = "Hệ thống tự động"`, payload thiếu `state`/`openingImage`/`closingImage`/`bagShiftSummary` và **chỉ có Ca 1**. Ca 2 (Trương Thị Phương) check-out chấm công lúc 22:17 giờ VN nhưng **không bấm "Chốt & bàn giao ca"**, nên phiên Ca 2 bị cron đóng hộ (`Auto closed by daily report.`). Cùng nhóm vấn đề: check-out chấm công không kéo theo chốt ca vận hành.

## BUG-112 phần 2 — tự động hoá mở ca / chốt ca (2026-07-23)

**Vì sao không ghép check-out với chốt ca (chủ sở hữu nêu đúng rủi ro):** check-out là việc *cá nhân* (GPS + selfie), chốt ca là việc *vận hành* cần **kiểm đếm tồn thành phẩm thật**. Ghép lại thì hoặc là ghi số tồn không ai đếm (hỏng số liệu kho), hoặc là chặn cứng khiến ca trưởng không kết ca được. Cả hai đều tệ hơn vấn đề ban đầu.

**Lớp 1 — "Bộ dò ca" (`src/lib/shiftAutoOpen.ts`, mới):** trước đây ca vận hành chỉ mở được ở 2 chỗ (check-in ở Chấm công, effect ở Bàn giao). Mạng lỗi lúc check-in là hết đường vì không thể check-in lại. Giờ `reconcileOperationalShift()` chạy trong `App.tsx` mỗi 60 giây cho mọi `shift_leader`, ở **bất kỳ trang nào** (Bán hàng, Kho, Hôm nay…). Idempotent, dừng rất sớm nếu ca đã mở / đủ 2 ca / ngày đã chốt. Giữ nguyên BUG-100/101: phải đúng lịch **và** đang check-in.
- Sửa kèm một lỗi tiềm ẩn: tồn đầu ca giờ đọc lại bằng `fetchMovements()` trong lib thay vì tin danh sách movement của trang gọi — trang Bán hàng không tải movement nên đường cũ sẽ ghi **tồn đầu ca = 0**.
- `openShiftAfterLeaderCheckIn()` được gỡ khỏi `AttendancePage` và chuyển vào lib dùng chung (một nguồn sự thật, không còn 2 bản logic lệch nhau).

**Lớp 2 — Chặn mềm ở check-out:** ca trưởng còn ca vận hành của chính mình đang mở thì check-out dừng lại, hiện `Ca N chưa bàn giao` + nút **"Sang Bàn giao chốt ca"**. Vẫn có nút **"Vẫn check-out"** cho sự cố thật; khi đó `markShiftLeftWithoutHandover()` chỉ ghi chú `[CHƯA KIỂM ĐẾM] <tên> check-out lúc HH:mm…` lên `discrepancy_note` của phiên ca. **Không đổi `status`, không ghi `closing_balances`.** Ca vẫn mở để người kế tiếp/quản lý chốt bằng số đếm thật; cron nửa đêm giữ nguyên ghi chú này.

**Lớp 3 — giữ nguyên cron `/api/auto-close-day`** làm lưới an toàn cuối.

**Kiểm chứng:** `HANDOVER_SHIFT_RECOVERY_OK` mở rộng — khẳng định bộ dò ca có đủ điều kiện dừng, giữ quy tắc lịch + check-in, đọc lại tồn từ kho; và khẳng định `AttendancePage` **không hề tham chiếu `closeBagShift`**, phần đánh dấu không đụng `closing_balances`/`status: 'closed'`. 7 test ca/bàn giao pass, `npx tsc -b` exit 0, `npm run build` pass.

**Deploy (2026-07-23):** `dpl_Ee34wJdqjKmUzSqL9g2UspstniVJ` READY, target production. Alias `gustino-operations.vercel.app` trả HTTP 200 và phục vụ đúng bundle vừa build (`index-BFxkbMO_.js`). Xác minh trên bundle LIVE: `index.js` chứa `shift-already-open`/`day-complete`/`not-scheduled`/`CHƯA KIỂM ĐẾM`; `ShiftHandoverPage-CCbV2bSY.js` chứa `Nhận ca ngay`/`Nhận tiếp`/`Xác nhận nhận`. `/api/auto-close-day` vẫn trả 401 khi thiếu `CRON_SECRET` (lưới an toàn cuối không đổi). Không ghi/sửa dòng dữ liệu production nào.

# 2026-07-24 — BUG-115 Critical: bán hàng POS không trừ kho

- Severity: Critical (số tồn kho sai suốt ca ở cả 3 chi nhánh).
- Status: **Code xong, chưa apply migration lên production** — xem mục "Còn lại".

**Hiện tượng chủ quán báo:** thành phẩm bán ra không bị trừ, "do chưa liên kết với menu".

**Bằng chứng nguồn:** `src/pages/ControlCenterPage.tsx` bắt buộc gán công thức "để hệ thống trừ tồn kho khi bán", nhưng `recipe` chỉ được đọc ở `getPackingOptionsByOutput()` (dropdown chia mẻ). `SalesPage.checkout()` → `saveSalesReceipt()` → RPC `create_cashier_pos_receipt` chỉ ghi `sales_receipts` + `sales_receipt_items`; grep toàn repo không có đường nào sinh `stock_movements` từ hóa đơn.

**Bằng chứng dữ liệu prod (chỉ đọc):** 15/15 món đang bán **đã có** công thức trỏ đúng SKU tồn tại (`chestnut-330 → chestnut-cooked-kg × 0.33`, `cake-box → cake-ready × 4`…). Tức là dữ liệu cấu hình không thiếu gì — thiếu là phần thực thi. Vì vậy khi bật, cả 15 món trừ được ngay, không cần khai báo lại.

**Đã sửa:**
- `supabase/migrations/20260724_pos_sale_deducts_stock.sql`: thêm `post_pos_receipt_stock()`, gọi từ `create_cashier_pos_receipt` trong cùng transaction; `delete_pos_receipt` gỡ lại phiếu theo `document_id`. Có chốt chặn ghi đôi khi gọi lại. **Không** kiểm tra đủ tồn (kho không được chặn bán).
- Món chưa gán công thức: **vẫn bán** (chủ quán chọn phương án này), và Control Center hiện khối cảnh báo + badge "Trừ kho khi bán: Chưa gán công thức" trên từng món.
- `src/lib/revenue.ts` bỏ qua phiếu do POS sinh (`isPosGeneratedSaleMovement`) để không cộng đôi số lượng bán ở `RestaurantPage` (nơi gọi `buildDailyRevenueRows` không truyền receipts).
- Đường LAN: client gửi kèm `stockMovements`, `scripts/lan-server.mjs` ghi khi tạo và gỡ khi xóa hóa đơn.

**Kiểm chứng:** `POS_SALE_STOCK_DEDUCTION_OK` (mới) — 2×0,33 + 3×0,11 = 0,99 kg gom đúng một dòng, bao bì trừ theo số túi, món chưa gán không tự trừ chính nó. **Đã kiểm tra ngược:** bỏ bộ lọc doanh thu là test đỏ đúng dòng. Cùng lượt xanh: `HANDOVER_SHIFT_RECOVERY_OK`, `INVENTORY_SHIFT_RECONCILIATION_OK`, `CASHIER_POS_WORKSPACE_OK`, `CORE_BUSINESS_BUTTON_GUARDS_OK`, `AUTH_STATIC_OK`, `AUTO_CLOSE_DAY_OK`, `DAILY_REPORT_EMPLOYEE_ATTENDANCE_FLOW_OK`, `SHIFT_CLOSE_REPORT_REALTIME_OK`. `npx tsc -b` exit 0; `npm run build` pass `PRODUCTION_SUPABASE_BUNDLE_OK (index-DK7Yp2xB.js; revenue-BTkAbmE4.js)`.

**Còn lại (cần chủ sở hữu quyết):**
- Chạy `supabase/migrations/20260724_pos_sale_deducts_stock.sql` lên production. **Chưa chạy** vì lệnh bị chặn quyền trong phiên này. Trước khi apply, frontend mới vẫn an toàn: không có migration thì hành vi y như cũ (chỉ thêm cảnh báo món chưa gán).
- **Không back-fill** hóa đơn cũ: hóa đơn trước thời điểm apply sẽ không sinh phiếu kho. Muốn dựng lại lịch sử phải có yêu cầu riêng vì nó viết lại số tồn quá khứ.

# 2026-07-24 — Kẹt ca: ca trưởng trước bỏ ca đang mở

- Severity: High. Status: đã sửa ở giao diện, chưa deploy.
- Audit production hôm nay: **0 ca vận hành treo, 0 ngày vận hành treo** — hai migration 24/07 (`reopen_bag_shift`, kind `missing_checkout`) đã có trên DB.
- Lỗ hổng còn lại: ca trưởng ca trước về mà không bấm "Chốt & bàn giao ca" thì ca vẫn `open`; người của ca sau chỉ thấy dòng chữ "Đang chờ ca trưởng trước bàn giao" và **không có nút nào** để chốt hộ → chi nhánh treo tới nửa đêm. Máy chủ vốn đã cho phép (`can_manage_branch` gồm cả `shift_leader` cùng chi nhánh) — chặn nằm ở giao diện.
- Fix: nút "Chốt thay <tên>" hiện cho manager/admin, hoặc ca trưởng đang check-in + có lịch hôm nay. Đi qua đúng biểu mẫu đếm tồn, bắt buộc lý do, đóng dấu `[CHỐT THAY … bởi …]` vào ghi chú ca. Không tự động (giữ BUG-100).

# 2026-07-24 — Chấm công: định vị tới số nhà + khép vòng đơn quên check-out

- `api/reverse-geocode.ts`: trước đây hai nguồn chạy đua bằng `Promise.any` và nguồn thô BigDataCloud (chỉ có phường/thành phố) thường thắng, chỉ nhường 800ms → địa chỉ chấm công hay dừng ở "Nha Trang, Khánh Hòa". Nay phân loại `precision` street/area, ưu tiên nguồn có số nhà trong 3 giây, thêm toà nhà/cửa hàng (Lotte Mart, Gold Coast) lên đầu chuỗi địa chỉ, và **chỉ cache 1 ngày cho địa chỉ đã tới số nhà** (bản thô `s-maxage=60`, trước đây cache thô 1 ngày làm mọi lần chấm công sau tại đúng toạ độ đó cũng thô theo).
- Vòng "quên check-out" trước đây hở: nhân viên gửi đơn xong thì đơn chỉ nằm im trong kho chứng từ, bản ghi vẫn treo, bảng công vẫn thiếu. Nay `AttendanceAdjustmentArchive` nối đơn với đúng ca còn treo và cho Admin bấm "Chốt giờ ra HH:MM" — dùng lại RPC `admin_update_attendance_record` nên vẫn ghi audit, vẫn chặn giờ tương lai và ca quá 18 giờ.
- Tồn đọng dữ liệu: **7 bản ghi chấm công còn treo** (5 thật + 2 ở chi nhánh test `moi`/`hhhh`), cũ nhất 11/07 (Mã Thị Thanh Trúc, lotte-vt). Cần chủ quán xác nhận giờ về thật rồi Admin chốt — không tự ý ghi giờ thay người dùng.

# 2026-07-24 — Đã thực thi trên production (chủ sở hữu duyệt)

**Deploy:** `gustino-operations.vercel.app` phục vụ `index-B1e3n5Jf.js` = đúng bundle vừa build. Marker đã xác minh trên asset LIVE: `ShiftHandoverPage-BT-_4GlB.js` có "CHỐT THAY" + "Mở lại ca"; `ControlCenterPage-CKwDXaxK.js` có "Chưa gán công thức"; `AttendancePage-D_RbCTm7.js` có "Quá hạn check-out"; `AttendanceAdjustmentArchive-BZshC3GC.js` có "Chốt giờ ra".

**Migration đã apply:** `20260724_pos_sale_deducts_stock.sql`, `20260724_admin_close_missing_checkout.sql`. Đã xác minh `post_pos_receipt_stock` tồn tại và `create_cashier_pos_receipt` thực sự gọi nó.

**Back-fill trừ kho (`scripts/db_backfill_pos_stock_20260724.sql`):** 1.924 phiếu `sale_out` cho toàn bộ hóa đơn POS đang có (09/07–24/07). Đã dry-run một hóa đơn trong transaction rollback trước (HD2307-001 → 0,33 kg hạt dẻ rang). Tổng trừ: gold-coast 163,33 kg rang · 40,51 kg nướng · 18 kg khoai · 2,21 kg tuyết · 140 cái bánh; lotte-2310 79,34 kg rang · 13,86 kg nướng · 12 kg khoai · 7,21 kg tuyết · 112 cái bánh; lotte-vt 117,10 kg rang · 4,19 kg nướng · 22,5 kg khoai · 2,43 kg tuyết · 636 cái bánh.
- **Không xóa/sửa dòng nào**, chỉ thêm. Đảo ngược toàn bộ: `delete from public.stock_movements where movement_type='sale_out' and note like '[POS %';`
- Còn đúng **1 hóa đơn không trừ được: HD1407-009 (lotte-2310, 14/07)** — header ghi 1 túi/33.000đ nhưng **không có dòng chi tiết nào**. Đây là dữ liệu hỏng có sẵn từ trước, không phải do bản vá. Chưa đụng tới vì sửa nó là viết lại số liệu bán hàng.

**Chốt ca chấm công treo (`scripts/db_close_stale_attendance_20260724.sql`):** 7 bản ghi ngày cũ đã đóng, `cham_cong_treo_ngay_cu = 0`. Ca của hôm nay không bị đụng tới.
- 5 ca lấy **giờ tan ca theo lịch**: h (hhhh) 20/07 6,67h · Huỳnh Phương Anh 13/07 1,90h · Mã Thị Thanh Trúc 13/07 8,05h · Võ Thảo Quyên 13/07 8,15h · Mã Thị Thanh Trúc 11/07 7,61h.
- 2 ca dữ liệu lệch (check-in muộn hơn cả giờ tan ca) lấy **giờ vào + 1 phút**, cố tình không bịa thêm giờ công: **Cao Bảo Trân 21/07** và tài khoản test `moi` 20/07. Hai ca này chủ quán cần chỉnh giờ thật trước.
- Tất cả đóng theo diện **`[CHỐT HÀNH CHÍNH]`**: không ảnh, không GPS — không bịa bằng chứng có mặt. Trạng thái trước khi sửa lưu ở `public._attendance_closed_20260724` (đã bật RLS + revoke để không lộ qua API); đảo ngược bằng `update ... set check_out_time = null from _attendance_closed_20260724`.

**Xác minh cuối:** ca vận hành treo = 0, ngày vận hành treo = 0, chấm công treo ngày cũ = 0.
# 2026-08-25 — INC-ATTENDANCE-STORAGE-QUOTA

- Severity: Critical. Status: **Blocked — Requires project-owner access**.
- Production evidence: `POST /auth/v1/token` on Supabase project `smtaiourlpqwmiulxuri` returns HTTP 402 with `exceed_storage_size_quota`, matching the user's login screenshot. This is a Supabase project restriction, not a rejected username/password.
- Requested data action: delete only objects in bucket `attendance-selfies` related to July 2026; retain every attendance row and every object referenced outside July, especially August 2026.
- Safety implementation: `scripts/cleanup-attendance-selfies-month.mjs` defaults to dry-run; defines July by the UTC+7 interval `[2026-06-30T17:00:00Z, 2026-07-31T17:00:00Z)`, removes target paths from the candidate set if any non-July attendance row references them, and verifies after deletion that the complete pre-existing protected set is unchanged.
- Blocker evidence: the linked repository contains the project ref but no Supabase access token/service-role credential; the in-app Browser is unavailable. Because Auth itself is restricted, an ordinary Admin session cannot be created to perform even the read-only inventory. No Storage object or attendance row has been deleted or modified.
- Unblock condition: the owner logs in with `npx supabase login` on this machine (or connects an authenticated Supabase Dashboard tab in the in-app Browser). Then run dry-run, review counts/bytes, execute, and verify protected August paths plus Auth health.
# BUG-141/142 — Staff KPI reward visibility and premature lateness (2026-09-10)

- Status: Fixed locally — signed-in mobile visual verification and deployment pending.
- Evidence: `MyTimesheetPage` loaded only attendance and had no KPI reward field. Management's `Thưởng KPI` is `dailyBonus + weeklyBonus`, excluding linked POS lines and monthly bonus. Separately, `buildAttendanceDetailRows` calculated `lateMinutes` from check-in even when `checkOutTime` was null, reproducing the screenshot where a current `Đang làm` shift appeared in `Đi trễ`.
- Fix: the employee timesheet now computes the viewed month's reward from only the signed-in account's allocation/direct-POS sources using the existing thresholds. Lateness is zero until check-out; completed shifts retain the existing scheduled-start/grace calculation.
- Verification: focused functional/source regressions, TypeScript, diff check and 728-module production build passed. No persistence, formula threshold, schema, permission, or production data changed.

# 2026-09-10 — Payslip checkbox inherited input frame

- Severity: Low. Status: Fixed locally.
- Evidence: the supplied screenshot shows a pale vertical rectangle around the green row checkbox; source inspection confirms the checkbox inherited the global input minimum height and padding.
- Fix: a payroll-scoped checkbox reset enforces an `18px × 18px` border box with zero padding and no inherited frame/shadow. Selection behavior and the green checked state are unchanged.
- Verification: focused payslip-delivery contract, TypeScript, and diff check passed.
- Final 731-module production build passed; in-app Browser visual verification is pending because no Browser session is available.

# 2026-09-12 — Payroll save metadata loss (fixed locally)

- Evidence: saveDetail previously replaced the saved row with the request object, which omitted persisted ID and published/viewed timestamps. This hid sent state after save and would prevent new revoke/delete actions from locating a freshly saved slip.
- Targeted fix: upsertPayrollEntry returns the database row via select/single; UI stores its mapped ID and publication state. Payload and salary formulas unchanged.
- Verification: test-payslip-revoke-delete.mjs exercises save returning ID/publishedAt; original payroll and delivery contracts plus TypeScript pass. Real signed-in read-back remains pending.

# 2026-09-12 — Mobile payslip bell clipping (fixed locally)

- Evidence: supplied iPhone screenshot shows bell above avatar and clipped by the header; .mh-right lacks display:flex and children stack as blocks.
- Fix: horizontal flex alignment, explicit bell border-box sizing and dropdown vertical overflow bounds. Notification fetch, unread count and navigation unchanged.
- Browser unavailable (iab runtime result); signed-in physical-phone visual verification pending.

# 2026-09-12 — Login show-password label wrap (fixed locally)

- Evidence: owner phone screenshot shows 'Hiện mật khẩu' on two lines; CSS uses fit-content flex label with wrapping enabled.
- Fix: .login-card .password-visibility uses full width and nowrap. Existing checkbox dimensions and showPassword handler preserved; no auth logic changes.

# 2026-09-12 — Hidden payslip save outcome (fixed locally)

- Confirmed source defect: error/success banners were rendered outside the dialog, obscured by its backdrop while saveDetail kept it open.
- Fix: render outcome inside sticky dialog footer next to save controls, show page outcome only when dialog closed, clear old feedback before retry/open, retain Supabase object message on save failure. No data/schema/payroll changes.
- Next: original payroll/delivery/revoke regressions, TypeScript and production build. No production action.

# 2026-09-12 — Payslip notification remains after viewing

- Confirmed source: dropdown maps all published payslips, including viewed rows; employee page swallowed viewed-RPC failures. User confirms badge and dropdown both remain. Missing mark_own_payslip_viewed is plausible after applying only column SQL, not yet confirmed by database response.
- Fix: dropdown and empty state use unread only, success event updates shell immediately and versions overlapping reads, employee selected-slip effect records viewed status including fallback selection, and failures are visible rather than swallowed/treated as success.
- Separate additive-install SQL 20260912123000_payslip_viewed_acknowledgement.sql creates existing ownership/published guarded RPC without modifying history or policies. Not applied.

# 2026-09-12 — Blank month selector (fixed locally)

- Source evidence: period='' represents all months but input type=month renders no textual value for it; user reports field visible only on interaction.
- Fix: native select always displays explicit all-month/month-year option, with recent 24 calendar periods and fetched slip periods. No slip/history writes.
- Delivery/month/navigation and Admin contracts pass; build pending. Physical-phone visual check remains pending.

# 2026-09-12 — Admin inbox lacked preview/latest ordering (fixed locally)

- Evidence: original messaging_contacts orders full_name, MessagesPage loaded contacts once and rendered only employee role. New incoming messages could not reorder/preview in inbox.
- Fix: new read-only messaging_inbox RPC joins permitted contacts to own latest/unread metadata and orders timestamp/UUID descending. UI renders preview/time/unread and refreshes realtime/polling/send/read while preserving selected conversation.
- Verified: actual isolated PostgreSQL inbox ordering, preview/unread-clear and other-employee privacy assertions pass with original messaging security/history; adapter/header/payslip contracts pass. Supabase migration/visual check pending; no production data changed.


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
