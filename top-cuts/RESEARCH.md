# Top Cuts — Research Summary

Two research passes were made. **Pass 1** (initial build) used a share link that resolved
to a "Top Cuts" pinspot in Hazard, KY — treated as authoritative at the time. **Pass 2**
(the current, verified identity) confirms the client is **Top Cuts Salon in Federal Way,
WA**, per the owner-provided Facebook page and Google knowledge-panel link. All site data
now reflects the Federal Way business; the Hazard findings are retained below only as a
record of the earlier misidentification.

## Verified identity — Top Cuts Salon, Federal Way, WA

| Fact | Value | Sources |
|---|---|---|
| Name | Top Cuts Salon ("Top Cuts" LLC) | [WA Secretary of State registry](https://www.bizofwa.com/co/top-cuts-llc) · Facebook |
| Address | 33505 Pacific Hwy S, Suite B, Federal Way, WA 98003 | Registry governor address ("33505B PACIFIC HWY S") · [MapQuest](https://www.mapquest.com/us/washington/top-cuts-salon-377821214) · [BestProsInTown](https://www.bestprosintown.com/wa/federal-way/top-cuts-salon-/) |
| Phone | **(253) 754-6810** | Registry filing · Barberhead · MapQuest Google-feed payload (3 independent) |
| Hours | Mon closed · Tue–Fri 10:00–19:00 · Sat 09:00–18:00 · Sun 10:00–17:00 | [Barberhead](https://barberhead.com/federal-way/top-cuts-salon) weekly table + Google feed `openingHoursSpecification` (agree on all overlapping days incl. Sunday 10–5 and Sat 9–6) |
| Owners | Thon Thach + Thuy Tran (registered governors/agents, both listed at the shop address → the two stylists) | WA registry director details |
| Entity | TOP CUTS LLC, UBI 604916950, registered 2022-05-09, Active, NAICS beauty/hair salon | WA registry |
| Reputation | ~4.9★ / 52 reviews (Barberhead); 99 reviews on BestProsInTown; also on Yelp, Nextdoor, BBB | Directory aggregate |
| Facebook | facebook.com/TopCutsSalon | Provided by owner; corroborated by BestProsInTown outlink |
| Logo | Black sign, red "TOP CUTS", red pill "Perm & Color" | Provided by owner (image); reproduced as vector at `public/img/logo.svg` — brand palette (red `#ee1b24` / black `#0b0b0d`) adopted site-wide |

### Reconciliations worth knowing

- **"9 years in business" vs LLC registered 2022:** the shop predates its LLC — common
  when a sole proprietor incorporates later. Site copy keeps the honest framing
  ("nine years behind the chair"), which both facts support.
- **Second phone found online, (253) 944-1427** ([Nextdoor](https://nextdoor.com/pages/top-cuts-salon-1/)):
  three sources agree on (253) 754-6810, including the state filing, so that is used.
  Worth a one-line confirm with the owner.
- **Sunday hours are real**: two independent sources show Sunday 10–5, unusual but consistent.

## Remaining assumptions (owner to confirm)

Marked clearly because they're not published anywhere:

- Exact service menu & prices (seeded with plausible budget-tier numbers; reviews hint
  at fair pricing without figures)
- Which stylist specializes in what (bios are light placeholders)
- Cancellation policy wording (seeded: free changes until 2 hours before)
- Whether walk-in volume ever justifies holding chairs back from online booking

---

# Earlier pass — misidentified entity (Hazard, KY), superseded

The first shared link resolved to `google.com/maps/place/Top+Cuts,+415+Main+St,+Hazard,+KY+41701`.
Research at that time found no web presence beyond the pin, matching the "no website"
brief. Market scan of Hazard salons (Cut-Ups, Creative Touch, Village Salon, SmartStyle,
Karma Spa & Salon) informed the positioning notes below, which still apply.

## Business profile brief (unchanged, from owner via you)

- 9 years in business — established, word-of-mouth clientele.
- 2 hair stylists total (two chairs).
- Takes **walk-in cuts**; does **colors** that tie up a chair for a long stretch and
  affect how soon walk-ins can be seen → color clients should book ahead.
- Positioning: pride in the work, deliberately charges less than competing salons.

## Design brief derived from research (applied to the build)

1. Lead with trust markers: 9 years, real location, real stylists, real prices.
2. Prices visible up front — the differentiator; a price-board section, not hidden.
3. Booking flow separates **cuts** (walk-in OK) from **color/chemical** (book ahead)
   — mirrors how the shop actually runs.
4. Mobile-first: neighborhood traffic is overwhelmingly phones.
5. Handmade-professional, not template-generic — produced the "Hometown Heritage"
   design synthesis documented in README.
