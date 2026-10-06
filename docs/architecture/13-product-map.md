# Product Map — Surfaces, Pillars and Navigation

How the platform is presented to people: three **surfaces** on separate hosts, and inside the member app three **pillars** that keep money and tokens visibly apart (§9, §27). This map is the product-side companion to the [repository architecture](10-data-api-repository.md#3-repository-architecture). Each surface corresponds to an `apps/*` entry in the target monorepo.

## 1. Map

```
                          mcfinancial.us
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
         WWW                  APP                 ADMIN
    mcfinancial.us        app.mcfinancial.us    admin.mcfinancial.us
    (public, static)    (members)           (staff only; own session,
                                             IP / access-gated)
                               │                    │
          ┌──────────────┬─────┴────────┐           ├─ Members & Status
          │              │              ┆           ├─ Finance ops (ledger,
     MEMBERSHIP       FINANCE         WEB3 ┆           │   loans, payments,
          │              │         (after   ┆           │   reconciliation)
       Profile        Contributions Gate #2)┆          ├─ Approvals (maker/checker)
       Membership     Loans           ┆                ├─ Treasury
       Documents      Payments        Wallet           ├─ Rewards rules
       Rewards        Withdrawals     MCTN             ├─ Reports
       (MC Points)    Statements ◄─ Ledger             ├─ Audit log
       Benefits                                         ├─ Users & Roles
                                                        └─ Compliance
```

Dashed lines (`┆`) mark what does not exist until Founder Decision Gate #2 approves an on-chain MCTN. Until then the member app has two pillars, and the Web3 section is not shown at all, not even as "coming soon".

<a id="d-17"></a>
### D-17 — Three surfaces on separate hosts, with isolated sessions

**DECISION:** Present the platform as three surfaces: a public site (`mcfinancial.us`), a member app (`app.`) and an admin console (`admin.`). Each host has its own host-only session, and admin sits behind an access gateway. Inside the member app, group navigation into Membership, Finance and (after Gate #2) Web3, with money and tokens never shown together.
**WHY:** Separating staff from members is the strongest cheap security boundary available. It lets admin be locked down (MFA, IP / access gateway, strict cookies) without affecting members. The pillars make the §9 separation of fiat and tokens visible in the product.
**ALTERNATIVES:** One host with path-based sections (today's `/portal` and admin routes); the admin console as a section of the member app.
**BENEFITS:** A stolen member session cannot reach admin; the public site carries no member data or attack surface; navigation matches the domain model.
**RISKS:** Three hosts to configure (DNS, TLS, cookies). Officers who are also members manage two logins, which is intended.
**REVERSIBILITY:** easy
**REQUIRES LEGAL REVIEW:** yes (public-site copy and the "mcfinancial" / "financial services" branding; compliance rows 2, 3, 17)
**REQUIRES FOUNDER APPROVAL:** yes (domain, branding)

## 2. Surfaces

| | **WWW** | **APP** | **ADMIN** |
|---|---|---|---|
| Host | `mcfinancial.us` | `app.mcfinancial.us` | `admin.mcfinancial.us` |
| Audience | the public, prospective members | members | officers and staff |
| Sign-in | none | member credentials; passkey or TOTP optional | staff credentials; **MFA required** (D-07) |
| Data | **no member data, no database access** | the signed-in member's own data only | per-role access (RBAC matrix in [05](05-security-and-privacy.md#rbac-and-makerchecker)) |
| Rendering | static site | Next.js app | Next.js app |
| Extra perimeter | CDN | rate limiting | IP allow-list or access gateway in front; admin routes refused on any other host |
| Must never contain | account creation for money products, rates or returns, MCTN promotion | admin functions, other members' data | public or member entry points |

### Session isolation (non-negotiable)

- Each host has its **own** session cookie, host-only: no `Domain=.mcfinancial.us` attribute, a `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax` (admin: `Strict`). A member session can then never be presented to `admin.`, and a compromised page on one host cannot read another host's session.
- Staff who are also members sign in to each surface separately, as different identities with different permissions.
- Staff sessions: 12-hour absolute limit, 30-minute idle timeout. Member sessions: 7 days with re-authentication for payments and profile changes.

## 3. Member app (APP)

The Finance and Web3 columns are styled differently: dollar amounts and point/token balances never appear in the same card, table or total (§27).

| Pillar | Section | Shows | Source of truth | Available |
|---|---|---|---|---|
| Membership | Profile | contact details, beneficiary, security (passkeys, sessions) | Membership, Identity | now (profile exists; security settings in Stage 2) |
| | Membership | status, join date, tenure, standing | Membership (status history) | Stage 2 |
| | Documents | signed agreements, membership forms, receipts | Documents | Stage 3 |
| | Rewards (MC Points) | points balance, how they were earned, what they can be used for | Rewards points ledger (off-chain) | Stage 4 (D-10) |
| | Benefits | member perks and events; UMI only if ever approved (D-15) | Membership / Rewards | Stage 4 |
| Finance | Contributions | plan, dues by month, arrears, prepayments | Contributions + Ledger | now (basic); obligations in Stage 3 |
| | Loans | active loan, schedule, next payment, payoff quote, agreement | Loans + Ledger | ✅ **built:** *My Loan* (`/portal/loan`): schedule, what is paid and late, payoff today, payments, co-signed loans (`src/modules/loans/memberView.ts`) |
| | Payments | pay by card or Zelle; payment status | Payments | now (`/portal/pay`) |
| | Withdrawals | request a partial withdrawal or exit; status | Payments + Approvals | Stage 3 |
| | Statements | monthly and annual statements, regenerable for any past date | **Ledger** | Stage 3 |
| Web3 | Wallet | linked wallet (embedded or external), recovery | Web3 (wallet links) | after Gate #2 |
| | MCTN | on-chain balance, settled rewards, contract address | the chain (mirrored) | after Gate #2 |

## 4. Admin (ADMIN)

| Section | Contains | Key permission | Available |
|---|---|---|---|
| Members & Status | member records, status transitions (proposal → approval), notes | `members.*` | now; status workflow in Stage 2 |
| Finance ops | ledger, journal entries, contributions, loans (application → disbursement → delinquency), payments, reconciliation, period close | `accounting.*`, `loans.*`, `payments.*` | now (legacy screens); ledger in Stage 3 |
| Approvals | the maker/checker queue for everything in D-06 | `approvals.decide` | Stage 2–3 (Zelle confirmations today) |
| Treasury | fiat: cash position, reserve, lending capacity; MCTN Safes mirror after Gate #2 | `treasury.view` | Stage 3 |
| Rewards rules | MC Points rules, budgets, manual awards | `rewards.manage` | Stage 4 |
| Reports | trial balance, portfolio, aging, cash flow, member statements, as of any date | `reports.view` | now (dashboard); ledger-based in Stage 3 |
| Audit log | who did what, before and after | `audit.read` | now (`/settings/audit`) |
| Users & Roles | staff accounts, role assignment, MFA status | `staff.read` / `staff.manage` | now (`/settings/staff`) |
| Compliance | compliance matrix tracker, retention settings, data-subject requests | `compliance.*` | Stage 3 |

## 5. Public site (WWW)

| Page | Content | Condition |
|---|---|---|
| Home, About | who the club is, history, community | — |
| Membership | how to join, obligations of members | wording on rights and withdrawals reviewed by counsel |
| Financial services | *what* the club offers members | **LEGAL REVIEW REQUIRED** before publishing: publicly describing lending may count as advertising credit (compliance rows 2, 3 and 17) |
| MCTN | — | **Not published** until counsel approves the copy after Gate #2. No price, return, income or listing language, ever (§51) |
| Contact | form → email; no member data collected beyond the enquiry | spam protection |

**Branding note:** "mcfinancial" and "financial services" present the club to the public as a finance provider. Confirm with counsel (compliance row 17) before the public site goes live.

## 6. How this maps onto the current app

The surfaces are a product boundary first and a deployment boundary later ([staged path](10-data-api-repository.md#staged-path-to-the-target-monorepo)).

| Stage | WWW | APP | ADMIN |
|---|---|---|---|
| Today | does not exist | `/portal/*` in the single Next.js app | `(admin)` routes in the same app |
| Stage 2 | new static site (`apps/web`) on `mcfinancial.us` | ✅ **built:** the same app answers on `app.mcfinancial.us` (`APP_DOMAIN`) | ✅ **built:** the same app answers on `admin.mcfinancial.us`. `proxy.ts` reads the host (`src/lib/hosts.ts`): each route group is served only on its own host, a page on the wrong host moves to the right one, an API call there is refused, and an unknown host is refused. Each host keeps its own sign-in cookie; the data-access layer still checks the role on every request. The access gateway in front of admin is still to come |
| After RBAC is stable | — | stays the member app | split into its own deployment (`apps/admin`) behind the access gateway |

Caddy terminates TLS for all three hosts. DNS and certificates are added when each host goes live.
