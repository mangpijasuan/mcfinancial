# Public site (`apps/web`)

The club's public website at `mcfinancial.us` (product map §5, architecture doc 10, staged path step 2). Plain HTML and CSS in `public/`, served directly by Caddy: no scripts, no cookies, no forms, no build step, and no connection to the app or its database. Members reach the member app with **Member sign in**, which Caddy redirects to `https://APP_DOMAIN/portal/login`.

| Page | File |
|---|---|
| Home | `public/index.html` |
| About | `public/about.html` |
| Membership | `public/membership.html` |
| Contact | `public/contact.html` |
| Not found | `public/404.html` |

Styles are in `public/assets/site.css`; the logos are copies of `public/brand/` in the app (see `docs/brand/README.md`).

## Preview on your computer

```bash
npx serve apps/web/public
```

and open the address it prints. *Member sign in* only works when Caddy serves the site.

## Before it goes live

1. **Write the draft sections.** Each yellow *Draft* box (`class="draft"`) says what goes there: the club's story, how to join, members' rights, and the contact address. The site does not go live while any are left.
2. **Counsel reviews the wording**, especially Membership (rights and leaving the club) and the name "mcfinancial" itself (product map, branding note; compliance row 17).
3. **No financial services or MCTN pages.** Describing lending publicly may count as advertising credit (compliance rows 2 and 3), and MCTN is not published before Gate #2. `tests/public-site.test.ts` fails if a page mentions loans, lending, interest, investment, returns or the token; change that list only with counsel's approval.
4. **Publish.** Point DNS for `mcfinancial.us` (and `www.`, if wanted) at the server, set `WWW_DOMAIN` in the server's `.env` (`WWW_DOMAIN="mcfinancial.us www.mcfinancial.us"`), and run `docker compose -f docker-compose.hetzner.yml up -d`. Caddy gets the certificate. `APP_DOMAIN` must be set too, for *Member sign in*.

## Checks

- `tests/public-site.test.ts` (runs with `npm test`): every page has a title and description and the same header and footer, every link and image resolves, nothing runs or collects anything, and none of the forbidden wording appears.
- CI (`docker` job, *Web server and public site*): Caddy validates the configuration and serves the pages, a missing page gets the not-found page, and sign-in goes to the member app.
