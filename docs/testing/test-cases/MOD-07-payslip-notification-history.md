# MOD-07 — Payslip notification history (2026-10-09)

| Case | Expected | Evidence |
|---|---|---|
| Employee opens a new payslip notification | Notification becomes viewed and remains in the dropdown | `PAYSLIP_UNREAD_NOTIFICATION_CONTRACT_OK` |
| Viewed and unread notifications coexist | Unread rows appear first; each group is newest publication first | `PAYSLIP_UNREAD_NOTIFICATION_CONTRACT_OK` |
| All notifications are viewed | Badge is hidden but viewed history remains available | Source contract passed; signed-in visual verification pending |

No database, payroll value, publication or access rule changed.
