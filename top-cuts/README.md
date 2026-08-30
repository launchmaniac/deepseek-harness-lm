# Top Cuts — Website + Customer Portal + Online Booking

A complete web presence for **Top Cuts Salon**, 33505 Pacific Hwy S, Suite B, Federal Way, WA 98003 — a nine-year-old two-chair salon that has run on walk-ins and word of mouth until now. The public booking flow and store dashboard share the Top Cuts GoHighLevel schedule; one zero-dependency Node server provides the website and API.

```sh
cp .env.example .env    # add the private GHL token and two calendar ids
npm start               # http://127.0.0.1:8787
```

## What's inside

| Surface | URL | Purpose |
|---|---|---|
| Public site | `/` | Hero, price board, color explainer, stylists, hours & map |
| Booking | `/booking.html` | 4-step wizard: service → day/time → details → confirmation code + `.ics` |
| Customer portal | `/portal.html` | Look up visits by phone or TC-code; cancel up to 2h before |
| Staff console | `/staff.html` | PIN-gated books for the next 7 days + one-tap walk-in logging |
| **Site admin** | **`/admin.html`** | **PIN-gated management of everything: services/prices, weekly hours, stylists, business info, PIN — plus the same books & walk-in logging** |
| API | `/api/*` | Config, live GHL availability, booking, lookup, cancellation, staff operations, admin writes |

Admin saves go through `PUT /api/admin/config` section-by-section (business / hours /
stylists / services). Every write is validated with the same rules the server boots
with — bad data is rejected loudly, never half-saved — and takes effect immediately,
no restart. Services still referenced by upcoming appointments cannot be deleted
(the API returns a 409 telling you to rebook first), and `_comment` documentation keys
in `config.json` survive edits.

## GHL scheduling

GoHighLevel location `x61zv3OlHwut6K4jZqJ3` owns the shared appointment schedule. Thon and Thuy each have a host-free event calendar. The server verifies both calendar ids at startup and refuses to serve a disconnected booking flow.

- Website availability reads live events from both chair calendars, applies the service duration and `turnoverBufferMinutes`, and presents the remaining times on the configured 15-minute grid.
- A customer booking upserts the GHL contact, creates a confirmed appointment on the selected chair calendar, and stores the local confirmation code used by the customer portal.
- Store-dashboard bookings and walk-ins use the same GHL write path, so they immediately block public availability.
- GHL notifications are disabled for these writes. SMS is enabled only after messaging registration and a separate notification setup.
- Color and chemical services retain their 75–150 minute durations; a long appointment blocks the full chair interval in GHL.

Required runtime variables are listed in [`.env.example`](.env.example). `GHL_API_TOKEN` must be a sub-account Private Integration token with `calendars.readonly`, `calendars/events.readonly`, `calendars/events.write`, and `contacts.write`. Never put the token in `config.json` or browser code.

## Editing things without touching code

The owner-facing way is **`/admin.html`** (same PIN as staff): edit prices and the
service menu, weekly hours, stylist names/bios, contact info, booking knobs, and the
PIN itself. Saves go straight to `config.json` through validated endpoints and apply
instantly — no restart.

Direct file editing also works — everything lives in **`config.json`**:

- `business` — phone, address, map link, booking window/lead/buffer/cutoff knobs
- `hours` — per-weekday ranges (`null` = closed); keyed 0=Sunday…6=Saturday
- `services` — menu with prices, durations, group (`cuts` vs `color`)
- `stylists` — names, roles, bios, and stable chair ids mapped to GHL calendars through environment variables
- `staffPin` — staff console PIN (**change before going live**)

The server validates config at startup and refuses to boot with a clear message if
something's off. The homepage, booking wizard, hours table — all render from this file.

## Demo data

```sh
node seed-demo.js     # stop the server first; restart after
```

Seeds local portal examples without writing to GHL. Portal demo login: phone `(253) 555-0123`. The store dashboard lists live GHL events, so seeded records do not occupy the shared schedule. Delete `data/db.json` to reset the local portal records.

## Honest limitations (fix before real launch)

This is a launchable MVP, not a bank:

- **Staff auth is a shared PIN** with in-memory sessions (restart = everyone signs in again).
- **Portal identity is the phone number / confirmation code** — fine for a salon roster,
  not multi-factor. Cancel-by-code works even without the matching phone.
- No TLS here — put it behind a reverse proxy or host (see below) before exposing.
- Confirmation codes and portal projections use a local JSON file; GHL remains the appointment schedule.

## Deployment

The presentation hostname is `https://topcuts.launchmaniac.com`. Any Node host can run `npm start`; set the environment variables from [`.env.example`](.env.example), bind `HOST=0.0.0.0`, terminate TLS at the host or reverse proxy, and keep `.env` out of source control.

Payments and SMS are disabled independently of booking. Stripe values in `.env.example` are inert placeholders, and `SMS_ENABLED=false` remains in force until messaging registration is complete.

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

See [RESEARCH.md](RESEARCH.md) for the verified Federal Way identity, public business details, and remaining owner-confirmation items. Editable operating assumptions live in `config.json`.
