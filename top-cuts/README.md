# Top Cuts — Website + Customer Portal + Online Booking

A complete web presence for **Top Cuts Salon**, 33505 Pacific Hwy S, Suite B,
Federal Way, WA 98003 — a nine-year-old two-chair salon that has run on walk-ins and
word of mouth until now. Built with **zero npm dependencies**: one Node file serves
everything.

```
node server.js          # http://127.0.0.1:8787   (PORT/HOST env to override)
```

## What's inside

| Surface | URL | Purpose |
|---|---|---|
| Public site | `/` | Hero, price board, color explainer, stylists, hours & map |
| Booking | `/booking.html` | 4-step wizard: service → day/time → details → confirmation code + `.ics` |
| Customer portal | `/portal.html` | Look up visits by phone or TC-code; cancel up to 2h before |
| Staff console | `/staff.html` | PIN-gated books for the next 7 days + one-tap walk-in logging |
| **Site admin** | **`/admin.html`** | **PIN-gated management of everything: services/prices, weekly hours, stylists, business info, PIN — plus the same books & walk-in logging** |
| API | `/api/*` | Config, availability, book, lookup, cancel, staff ops, admin writes |

Admin saves go through `PUT /api/admin/config` section-by-section (business / hours /
stylists / services). Every write is validated with the same rules the server boots
with — bad data is rejected loudly, never half-saved — and takes effect immediately,
no restart. Services still referenced by upcoming appointments cannot be deleted
(the API returns a 409 telling you to rebook first), and `_comment` documentation keys
in `config.json` survive edits.

## How the books work (the part that matters)

The availability engine encodes how the shop actually runs:

- **Two chairs** (`stylists`) each keep their own schedule from `hours`.
- Every service has a real duration (`minutes`). A booking blocks its chair for the
  service plus a `turnoverBufferMinutes` gap.
- **Color/chemical services take 75–150 minutes** — booking one reshapes the whole day,
  which is exactly why the site asks color clients to reserve ahead while cuts stay
  walk-in friendly. The UI separates the two groups and explains why.
- Slots are on a 15-min grid (`slotIntervalMinutes`), open `bookingWindowDays` ahead,
  with a `minLeadMinutes` cushion for same-day online bookings (staff walk-in logging
  bypasses it — they're logging haircuts happening *now*).
- Customers can cancel online until `cancelCutoffHours` before the visit; after that
  the site tells them to call.

## Editing things without touching code

The owner-facing way is **`/admin.html`** (same PIN as staff): edit prices and the
service menu, weekly hours, stylist names/bios, contact info, booking knobs, and the
PIN itself. Saves go straight to `config.json` through validated endpoints and apply
instantly — no restart.

Direct file editing also works — everything lives in **`config.json`**:

- `business` — phone, address, map link, booking window/lead/buffer/cutoff knobs
- `hours` — per-weekday ranges (`null` = closed); keyed 0=Sunday…6=Saturday
- `services` — menu with prices, durations, group (`cuts` vs `color`)
- `stylists` — names/roles/bios (currently placeholders "Chair 1 / Chair 2")
- `staffPin` — staff console PIN (**change before going live**)

The server validates config at startup and refuses to boot with a clear message if
something's off. The homepage, booking wizard, hours table — all render from this file.

## Demo data

```sh
node seed-demo.js     # stop the server first; restart after
```

Seeds past visits + upcoming color/cut bookings. Portal demo login: phone `(606) 555-0123`.
Delete `data/db.json` to reset to an empty book.

## Honest limitations (fix before real launch)

This is a launchable MVP, not a bank:

- **Staff auth is a shared PIN** with in-memory sessions (restart = everyone signs in again).
- **Portal identity is the phone number / confirmation code** — fine for a salon roster,
  not multi-factor. Cancel-by-code works even without the matching phone.
- No TLS here — put it behind a reverse proxy or host (see below) before exposing.
- Data is a single JSON file with atomic writes; plenty for one shop, not for two.

## Deploying later

Any Node host works (`node server.js`). Natural fits:

- **Cloudflare Workers + D1** port of the API (the wall-time model maps directly), Pages for the static shell
- Or a $5 VPS behind Caddy/nginx for automatic HTTPS

## Design notes

Three parallel design studies were generated (see `design-studies/a|b|c.html`):
*Hometown Heritage*, *Modern Editorial*, and *Fresh & Friendly*. The production theme
synthesizes them: study A's cream/espresso letterpress language and ticket-stub
price cards, study B's typographic discipline (tracked labels, hairline rules, baseline
rhythm), and study C's big tap targets and friendly microcopy. Fonts are Fraunces +
Inter via Google Fonts with full offline fallbacks.

The owner's real logo (black sign, red "TOP CUTS — Perm & Color", `public/img/logo.svg`)
is now the identity: it anchors the hero as the shop sign, serves as nav/footer
wordmark (`logo-wordmark.svg`), rebuilt the favicon, and set the accent palette —
the letterpress accents run in the logo's red (`#ee1b24` family, AA-tuned to `#d41f26`
for small text) instead of the earlier guessed copper.

## Research

See [RESEARCH.md](RESEARCH.md) — the verified Federal Way identity (phone, hours,
owners via WA registry + three directory sources), remaining owner-confirmation items,
and every
assumption (phone number, exact hours, stylist names, prices) flagged for owner
confirmation. All assumptions live in `config.json` for one-place editing.
