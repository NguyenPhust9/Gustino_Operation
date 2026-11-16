# MOD-02 — Authorization, Roles, Page/Branch/Data Scope

Status: in progress. No case has been marked Passed unless execution evidence appears below.

## Candidate business flows

1. Unauthenticated user is restricted to login/launcher behavior.
2. Each role reaches only its permitted pages and gets the correct default page.
3. Direct hash navigation cannot bypass page authorization.
4. Inactive accounts and branchless operational users lose access.
5. Manager access is limited to assigned branches; admin has intended system scope.
6. Database RLS/RPC authorization matches UI authorization.
7. LAN-token and Supabase-session paths enforce equivalent permissions.

## Detailed test cases

| ID | Flow | Preconditions/input | Steps | Expected result | Automation | Status/evidence |
|---|---|---|---|---|---|---|
| MOD02-TC-UI-01 | Allowed direct navigation | Local isolated app; each of five synthetic roles; every canonical hash route | Seed local QA identity, open each permitted route, observe final hash/body/runtime errors | Hash remains permitted route; page is nonblank; no relevant runtime error | In-app Browser; existing script can inform matrix but is not the active backend | Blocked — in-app Browser unavailable |
| MOD02-TC-UI-02 | Denied direct navigation | Same identities/routes | Open every route denied by current `canAccessPage` | Redirect to role default: admin/manager dashboard, leader today, staff sales, kitchen kitchen | In-app Browser | Blocked — in-app Browser unavailable |
| MOD02-TC-UI-03 | Alias/unknown route | Each role; `#history`, `#admin`, unknown hash | Navigate directly | `history` resolves to orders then access rule applies; `admin` resolves to management then access rule applies; unknown resolves through launcher to role default | In-app Browser | Blocked — in-app Browser unavailable |
| MOD02-TC-SRC-01 | Route/type/render/matrix consistency | Current `App.tsx`, `AppShell.tsx`, permission matrix | Compare Page union, `pageFromHash`, render branches, and matrix coverage | Every canonical page is synchronized across all four representations | `node scripts/test-authorization-static.mjs` | Passed after BUG-001 fix — exit 0; `AUTH_STATIC_OK (22 routes đồng bộ qua type/hash/render/matrix)` |
| MOD02-TC-BUILD-01 | Authorization code type safety | Installed dependencies | Run TypeScript with no emit and no incremental artifacts | Exit 0, no TypeScript diagnostics | `npx.cmd tsc -p tsconfig.app.json --noEmit --incremental false` | Passed — 2026-07-11; exit 0; 14.6 s; no output/diagnostics |
| MOD02-TC-DB-01 | Manager/branch scope | Isolated QA Supabase or static policy/RPC evidence | Compare manager branch scope across latest migrations, login/session hydration, and dashboard queries; later test assigned/unassigned manager only after contract is confirmed | One consistent documented manager scope across DB and frontend | SQL/API integration preferred; static evidence only cannot Pass integration behavior | Needs Business Confirmation — latest DB grants manager all branches, frontend scopes manager to profile/assignments; evidence below; no logic changed |
| MOD02-TC-DB-02 | Inactive session data access | Existing schema/migrations; isolated integration later | Deactivate branch/profile, then evaluate whether a still-valid authenticated session can satisfy shared RLS authorization helpers | Inactive profile cannot continue database operations, matching `20260702_branch_deactivate_accounts.sql` stated rule | `node scripts/test-authorization-active-guard.mjs`; API integration later | Failed — BUG-002; authorization helpers lack active guard; fix Blocked — Requires Business Decision |
| MOD02-TC-LAN-01 | LAN authentication integrity | LAN server source; isolated integration later | Verify invalid/missing Bearer token cannot create an actor by spoofing identity/role headers; verify protected routes require authenticated actor | Only server-issued login token establishes identity/role; client headers cannot elevate privileges | `node scripts/test-lan-auth-contract.mjs`; integration later | Failed — BUG-003 Critical; spoofable X-User actor fallback; fix Blocked — Requires Business Decision |

## Coverage observations (not bugs)

- `scripts/qa-permission-matrix.mjs` now declares all 22 canonical routes × 5 roles = 110 planned UI checks after BUG-001 fix.
- The 110 UI checks remain unexecuted because the required in-app Browser is unavailable; only static route-set synchronization has Passed.
- No product behavior is changed merely to align this script; test/business conflicts must use `Needs Business Confirmation`.

## Needs Business Confirmation

### MOD02-TC-DB-01 — Manager branch scope

- All-branch evidence: `supabase/migrations/20260629_branchless_manager_kitchen.sql` says managers are not tied to one branch and defines `can_manage_branch` as true for manager; `20260701_branch_core_repair.sql` is the later definition and preserves `role in ('admin', 'manager')` for every branch.
- Assignment-scoped evidence: `src/pages/LoginPage.tsx` lines 71–79 loads only `profileBranchId` and `manager_branch_assignments`; `src/App.tsx` lines 163–171 repeats that hydration; `ManagerDashboardPage.tsx` uses `permittedBranchIds(user)` and filters/fetches only those branch IDs.
- Conflict: a branchless manager with no assignment is authorized by latest DB helpers for all branches but receives no explicit frontend branch list; an assigned manager may see fewer branches in UI than DB authorization permits.
- Required decision: confirm whether manager scope is company-wide or assignment-limited. Changing either DB permissions or frontend scope is forbidden until confirmed.
- Impact: manager dashboards, inventory/revenue visibility, schedules, supply requests, and any query driven by `branchIds`.

## Execution log

| Date | Test | Command | Result |
|---|---|---|---|
| 2026-07-11 | MOD02-TC-BUILD-01 | `npx.cmd tsc -p tsconfig.app.json --noEmit --incremental false` | Passed; exit 0 in 14.6 s; no diagnostics |
| 2026-07-11 | MOD02-TC-SRC-01, attempt 1 | `node scripts/test-authorization-static.mjs` | Failed before assertions: test harness `SyntaxError: missing ) after argument list` at line 20; no product conclusion |
| 2026-07-11 | MOD02-TC-SRC-01, attempt 2 | `node scripts/test-authorization-static.mjs` | Failed due harness parser including alias/empty-string code before the route array; mismatch invalid for product conclusion |
| 2026-07-11 | MOD02-TC-SRC-01, attempt 3 | `node scripts/test-authorization-static.mjs` | Failed valid assertion: matrix missing `manager-attendance`, `manager-payroll`, `manager-requests`; type/hash/render comparisons passed first; BUG-001 confirmed |
| 2026-07-11 | MOD02-TC-SRC-01 verification | `node scripts/test-authorization-static.mjs` | Passed; exit 0; all 22 routes synchronized across type/hash/render/matrix |
| 2026-07-11 | MOD02-TC-BUILD-01 regression | `npx.cmd tsc -p tsconfig.app.json --noEmit --incremental false` | Passed; exit 0 in 11.1 s; no diagnostics after BUG-001 test-only fix |
| 2026-07-11 | MOD02-TC-DB-02 static contract | `node scripts/test-authorization-active-guard.mjs` | Failed valid assertion: `current_profile`/latest `can_manage_branch` do not exclude inactive profiles, contrary to branch-deactivation old-session contract; BUG-002 confirmed |
| 2026-07-11 | MOD02-TC-LAN-01 static contract | `node scripts/test-lan-auth-contract.mjs` | Failed valid assertion: invalid/missing token falls back to spoofable `X-User-Id`/`X-User-Role` identity; privileged routes such as branch PUT trust role without `authenticated`; BUG-003 confirmed |
| 2026-07-11 | Final targeted regression | Four `node --check` commands + authorization static test + TypeScript no-emit | Passed; combined exit 0 in 10.9 s; `AUTH_STATIC_OK (22 routes đồng bộ qua type/hash/render/matrix)`; no diagnostics |


## 2026-11-16 ? Quynh Nhu missing Orders triage
- Source verified: AppShell orders visibility uses canUseOperations(role), restricted to shift_leader; position_title and employment_type do not grant permission. Admin profile employment group editor changes employmentType/positionTitle; role is a separate control in Account & security. Login reads profiles.role.
- Account-specific cause remains unverified. Network audit failed EACCES; elevated read-only audit was rejected by automatic review because privileged credential-based access was not explicitly authorized. Do not bypass or retry without approval. No production profile rows were read or changed.
- Additional source observation: App profile revalidation reads role but persists only branch/roaming changes, so restored sessions may retain an old role; a fresh login reads the current profile role. No application changes or tests performed. Preserve existing src/lib/branches.ts modification.
- Next: user checks the actual account Role control and signs out/in; direct production read requires explicit approval. No permission/schema/deploy change.
