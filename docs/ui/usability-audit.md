# Usability audit: staff console and member portal

Every staff page (as the Treasurer, who sees the most) and every member page was opened at desktop (1280 × 900) and phone (390 × 844) width with the browser-test demo data, screenshotted, and checked for: controls without an accessible name, form fields without a label, tap targets under 24 px, sideways scrolling, the number of `h1` headings and console errors. The screenshots were then reviewed by hand for clarity of figures and statuses.

Priority: **P1** misleads, hides something needed or blocks some users; **P2** slows people down or confuses; **P3** polish.

## P1

| # | Where | Problem | Fix |
|---|---|---|---|
| 1 | Staff navigation | At 1280 × 900 the sidebar cuts off after *Repayments*: *Loan History*, *Approvals* and *Notifications* are below the fold inside a scrolling panel with no sign that there is more. Approvals is a core workflow. | Tighter rows so the whole menu fits at 900 px; a fade at the bottom edge when it still overflows; the current page scrolled into view. |
| 2 | Approvals | Nothing in the menu says when something is waiting for you, unlike Loans and Payments. | A count badge on *Approvals* for requests you can decide. |
| 3 | Loans, Loan Agreements tables | At 1280 px the table is wider than the page: *Next due* and *Status* on Loans, *Actions* on Agreements are cut off, so an overdue loan does not show as overdue without scrolling sideways. | Secondary columns (co-signer, created, term) hidden below extra-wide screens; status and actions always in view. |
| 4 | Search and filter controls on Members, Contributions, Withdrawals, Loans, Agreements, Repayments, Loan History, Approvals, Audit Log | Search boxes and status filters have no label: a screen reader announces "edit text" or "combo box" only. | Every search box and filter has an accessible name. |
| 5 | Staff dashboard | Nine bright tiles in seven colours with no meaning: *Total withdrawn $0* is red, *Eligible for loan* is blue. Colour does not signal anything, so the one figure that needs attention (overdue loans) does not stand out. | Neutral tiles; red only for overdue loans when there are any. |
| 6 | Loan statuses everywhere | An *Active* loan is shown in amber, the colour used for warnings. | Active in blue (information), overdue in red, paid off in green. |
| 7 | Member dashboard | *Max loan amount $0* next to *NO - Active Loan/Cosign*, a raw code. | Plain words: why the member cannot borrow now, and no $0 maximum. |
| 8 | Pages without permission | A staff member who opens a page their role cannot use (for example `/settings/staff` as Treasurer) gets an empty page and a 403 error in the console. | A clear "you don't have access to this page" message, the same on every staff page. |

## P2

| # | Where | Problem | Fix |
|---|---|---|---|
| 9 | Page names | The menu says *Loan Agreements*, the page says *Loan Application*; *Online Payment Review* opens *Pending Payments*; the portal menu says *Loan Application* for *Loan Agreements*. | One name per page, the same in the menu and the heading. |
| 10 | Dashboard chart | The *Loans issued by year* axis reads $1k, $1k, $1k, $0k, $0k. | Axis labels with enough precision ($500, $1k, $1.5k). |
| 11 | Counts | "1 loans", "1 agreements". | Singular and plural. |
| 12 | Small targets | Receipt links, "← Back" links and links inside tables are under 24 px tall. | At least 24 px. |
| 13 | IDs on phones | Agreement and loan IDs break in the middle (`AGR-` / `5CCAF69CE4`). | IDs never break. |
| 14 | Member portal, desktop | The club name in the top bar is cut to "Mi…". | The name fits or is left out cleanly. |
| 15 | Payment statuses | "completed", "pending" in lower case next to capitalised statuses elsewhere. | One status style everywhere. |

## P3

| # | Where | Problem |
|---|---|---|
| 16 | Every staff page | The page title appears twice (top bar and heading). Left as is: the top bar keeps the title visible while scrolling. |
| 17 | Phone tables | Wide tables scroll sideways inside their card. Acceptable for staff tables; the member portal uses cards. |

Checked and fine: no page scrolls sideways on a phone, every page has one `h1`, and no images lack alt text. Dialogs were not opened by the audit; they are covered by the browser tests of each workflow.

## Outcome

Fixed in the UI branch: every P1 and P2 item above. The same audit script, run again on the same data, finds nothing left (before: 85 findings across the pages: unlabelled controls, small targets, console errors). Before-and-after screenshots: [screenshots/README.md](screenshots/README.md).

Two checks now run in the browser tests (`e2e/07-usability.spec.ts`) so these do not come back:

- the main workflow pages (dashboard, loans, agreements, payments, approvals, members, and the member portal) pass the automated WCAG 2.1 A/AA checks of axe-core, including colour contrast;
- the staff menu fits a 1280 × 900 screen, search boxes and filters are named, loan status and actions stay in view, a page outside your roles says so, member eligibility is in plain words, and phone pages do not scroll sideways.

Along the way the checks found, and this branch fixes: grey secondary text below the 4.5:1 contrast minimum (Tailwind's `gray-400` now takes `gray-500`'s value), wide tables that keyboard users could not scroll (`ScrollArea`), and amounts rounded to whole dollars on screen while the pay form used cents (`fmt$` now shows cents when there are any).

Not changed: links inside sentences (a receipt number in a line of text) keep their text size, as WCAG 2.5.8 allows.
