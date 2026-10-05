# Logo and colours

The MC mark is drawn flat, in two versions, from the outlines of the original artwork (`mc-logo-original.png`, kept here for reference and no longer served).

| File | Use on | M | C |
|---|---|---|---|
| `public/brand/mc-logo.svg` | white and light surfaces: the staff top bar, the two-factor setup card, receipts and anything printed | club navy `#1B2A4A` | deep gold `#D4A017` |
| `public/brand/mc-logo-on-dark.svg` | navy surfaces: the staff sidebar, the member portal bar, both sign-in pages | light `#ECF0F8` | gold `#F5B70A` |
| `src/app/icon.png` | the browser tab and phone home screen | light | gold, on a navy tile |

Why these colours:

- **Navy and gold are the app's own colours** (the sidebar and the "Add member" button), so the mark matches the screens around it. The original deep blue disappeared on the navy bars.
- **No red.** Across the app, red means unpaid, in arrears or an error. A red mark beside those warnings reads as one of them.
- **Flat, not glossy.** At sidebar size (about 44 × 24 px) highlights and bevels blur; flat shapes stay crisp and print cleanly.
- The gold is deeper on light surfaces so the C keeps its contrast against white.

The SVG files are served from `public/brand/`, which the proxy leaves alone (no address check or security header), like other static files.
