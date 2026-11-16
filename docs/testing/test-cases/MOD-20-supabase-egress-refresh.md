# MOD-20 — Supabase egress refresh reduction

Date: 2026-09-12. Scope: six user-authorized fixes; no database/schema/deployment changes.

| Case | Expected | Evidence/status |
|---|---|---|
| EG-01 | Today socket SUBSCRIBED suppresses interval reads; CHANNEL_ERROR enables visible60s fallback; hidden suppresses fallback; cleanup removes timer | Passed: test-supabase-egress-refresh.mjs executes actual effect with controllable socket/timer |
| EG-02 | Kitchen active request filters pending/acknowledged at server; default adapter remains full list for other callers | Passed: actual adapter executed with query double |
| EG-03 | Kitchen history query only executes when explicitly open; terminal mutation removes active rows; history receives updates only while open | Query gating passed in behavior test; mutation/UI/source checked, kitchen bell/delivery regressions passed; signed-in visual pending |
| EG-04 | Identical session content key stable; changed content invalidates; Today snapshot read scoped to current day | Passed: actual key expression executed; scope source verified |
| EG-05 | Admin20events coalesce to1read after400ms; scope cleanup cancels pending read | Passed: actual guard expression and burstGuard executed |
| EG-06 | Report joined/partial events coalesce to1ledger read after400ms; full snapshot/day update local state; DELETE/partial fallback reads | Passed: actual subscription callbacks executed |
| EG-07 | Sequential/concurrent helpers share1branches read within context; new flow/scope rereads; default parallel helpers share in-flight read | Passed: real attendance helpers executed with query double |
| EG-08 | Valid delivery/notification/shift recovery/report/revenue flows preserved | Passed: kitchen-idle-bell, supply-request-delivery-schedule, shift-close-report-realtime, today-shift-open-recovery, management-daily-competition-realtime, sales-report-consistency; TypeScript passed |
| EG-09 | Legacy test failures distinguished from regressions | test-shift-realtime-reminders explicitly requires8000 polling, contradicts new user requirement: Needs Business Confirmation in reusable test tracking; direct user instruction already authorizes new behavior. Original test preserved. attendance-realtime-next-day shows identical9failures against HEAD baseline; unrelated source contracts preserved |

Harness uses transpiled actual effects/adapters and controllable timer/socket/query doubles. It does not measure Supabase production bytes or replace signed-in UI/multi-device verification. Full build result recorded in TEST_PROGRESS/SESSION_HANDOFF.

Expected savings, not production measurements:

- Today operations interval:450batches/hour→0with healthy socket; disconnected→60/hour (~87%fewer timer batches).
- Kitchen repeated response payload: proportion of terminal rows removed; e.g20active/1000total≈98%fewer rows per repeated read. History reads still transfer full permitted scope when opened/updated while open; LAN endpoint remains unchanged and filters response locally, so this server-egress saving applies to Supabase mode.
- Today snapshot: identical-session refreshes no longer query; relevant reads limited to1day rather than all days. Depends on actual snapshot count/size.
- Admin/Report debounce: n events inside400ms quiet-window burst→1read (5events≈80%,20events≈95%fewer burst reads). Spaced events still read; not a cap on long-running event traffic.
- Report complete snapshot/day payload:0follow-up reads for these events; partial/join/DELETE still reconcile.
- Branch reads in a batch: k→1 (~50–80%for2–5calls); no stale TTL cache across flows.

## 2026-11-16 - Supabase egress screenshot and source recheck
- User screenshot: 9.60 GB / 5 GB organization quota; selected 16 Nov PostgREST 3.704 GB (99.9%). All-projects view does not identify one caller/project.
- Confirmed current-source repeated full-scope reads: Manager/Admin 30s plus Realtime; App full stock history every 150s on relevant visible pages. Kitchen active 8s, Today attendance 30s and Messages 10s remain. No production attribution or measured-byte claim.
- Executed node scripts/test-supabase-egress-refresh.mjs: SUPABASE_EGRESS_REFRESH_OK. Prior six fixes still pass isolated behavior checks.
- Review record: SUPABASE_EGRESS_REVIEW_2026-11-16.md. No application/schema/deploy/data edits; existing branches.ts and tracking changes preserved. No new runtime bug ID assigned from aggregate usage alone.
- Next: measure running-build API counts/response bytes and project-level usage before targeted optimization; retain complete inventory/revenue inputs.


## 2026-11-16 - MOD-20 repeated large-read fix implemented; validation in progress
- Owner explicitly authorizes preventing old-project repeated large reads on restored target. Added bounded in-memory per-user/role/branch/range request sharing, pending deduplication, invalidation revisions, failure retry and logout generation reset (readCache.ts). No persistent business cache or permission/schema/formula change.
- Added dashboardData.ts: full historical stock baseline, 1ms-overlap insertion delta with ID deduplication and recent count reconciliation; full read on historical UPDATE/DELETE/unknown event, local writes/partial failures, mismatch, failed delta or150s baseline expiry. Five-second shared read window and scope-key isolation. Source adapters/validation writes remain unchanged except finally invalidation.
- Manager/Admin use date-bounded report snapshots with150s caching; receipt events do not invalidate historical report payloads. Manager bounds include the earlier of previous-period/week comparison. Admin bounds cover selected period and ranking month. ReportPage reads only its business date. Manual refresh invalidates cache. Existing stock history retained in full.
- Shared visible/socket-aware refresh scheduler: no hidden-tab refresh, coalesced/rate-bounded events, no overlapping async batch, visible fallback after channel failure, periodic healthy reconciliation, focus/visibility/reconnect recovery and full cleanup. Unrelated known branches ignored; partial DELETE remains conservative.
- New behavioral test-dashboard-egress passes cache invalidation races/retry/scope, same-timestamp insert, historic edit/delete/count mismatch/full fallback and scheduler hidden/reconnect/burst/cleanup/single-flight cases. Existing stock write/delete, inventory consistency/count, sales/reports, Manager workspace and close-retry checks pass after harness dependency/static-contract updates; stock/revenue calculations unchanged. Two esbuild-based revenue tests hit known sandbox filesystem denial and require elevated retry. TypeScript recheck pending final batch.
- No database writes, deployment, GitHub push or hosted environment change. Need final regression/build and explicit report of local-vs-live status; do not promise a measured GB reduction or guaranteed quota ceiling.

| Case | Expected | Observed |
|---|---|---|
| EG-10 | Scoped pending requests share one read; invalidation/retry/logout do not reuse stale values | Passed: test-dashboard-egress actual cache module |
| EG-11 | Keep historical stock; same-timestamp inserts dedupe; old edits/deletes/mismatch/expiry reconcile fully | Passed: actual dashboard adapter with controlled source |
| EG-12 | Snapshot filters preserve comparison dates; receipt events reuse unchanged snapshots; snapshot writes invalidate | Passed: actual adapter plus sales/report and both revenue regressions |
| EG-13 | Visible disconnected fallback, hidden suppression, reconnect, bounded event bursts and cleanup | Passed: actual scheduler under virtual clock |
| EG-14 | Manager actual request batches serialize; burst queues one follow-up; changed scope rejects old response | Passed: actual Manager effect with blocked requests; 100 calls, maximum one batch |
| EG-15 | Stock writes/partial failures invalidate; valid inventory/revenue/finalization flows remain | Passed: stock-write-and-delete-sync, stock-and-sync-performance, inventory-count-zero, inventory-display-consistency, manager-inventory-workspace, sales-report-consistency, report-finalization-retry, shift-close-report-realtime, management-daily-competition-realtime, both revenue fallback scripts |

- TypeScript and final production build/public-key guard pass (738 modules; index-DlX_hbdn.js; ManagerDashboardPage-BPLVpeFU.js). Isolated tests do not measure hosted traffic or replace a signed-in multi-device session. No deployment performed.
