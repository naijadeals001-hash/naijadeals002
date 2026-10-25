# NaijaDeals Vertical Landing Page Map

Updated: 2026-10-25

## Consolidated platforms

| Platform | Route | Registered verticals | Reused working routes | State |
|---|---|---|---|---|
| NaijaMove | `/move` | NaijaDrive, NaijaEats, NaijaFresh, NaijaSend | `/drive`, `/eats`, `/fresh`, `/send` | Discovery live; fulfillment remains capability-controlled |
| NaijaMarket | `/market` | NaijaShop, NaijaFresh, NaijaFarm | `/shop`, `/categories`, `/fresh`, `/farm` | Marketplace and Fresh data-backed; Farm discovery |
| NaijaPay | `/naijapay` | NaijaPay | wallet, payment-intent, utility APIs | Authenticated financial dashboard; utility sandbox clearly labeled |
| NaijaServices | `/services` | NaijaGigs, NaijaHome, NaijaBeauty | `/gigs`, `/home`, `/beauty` | Gigs operational; home/beauty discovery |
| NaijaTravel | `/travel` | NaijaStay, NaijaTravel, NaijaEvents | `/stay`, `/events` | Stay listing/booking engine reused; other discovery |
| NaijaPlay | `/play` | NaijaStream, NaijaLearn | `/stream`, `/learn` | Discovery landing; catalog depends on real content |
| NaijaProperty | `/property` | NaijaHomes, NaijaAuto | `/homes`, `/auto` | Inquiry-led discovery; no fabricated inventory |
| NaijaHealth | `/health` | NaijaHealth | `/health`, `/account` | Healthcare discovery and privacy-safe entry points |
| NaijaJobs | `/jobs` | NaijaJobs | `/jobs` | Employment landing; no fabricated vacancies |
| NaijaBusiness | `/business` | sellers, restaurants, providers, operators | `/seller`, `/naijapay`, `/control-center` | Shared merchant doorway |
| Aura AI | `/aura` | Aura AI | existing Aura experience/API | Existing product identity preserved |

## Registered vertical routes

| Vertical | Canonical route | Landing implementation | Backend capability | Availability |
|---|---|---|---|---|
| NaijaFresh | `/fresh` | dedicated Fresh page | catalog/cart/checkout | limited by rollout |
| NaijaEats | `/eats` | dedicated Eats page | restaurants/menu/cart/checkout | live customer ordering |
| NaijaGigs | `/gigs` | dedicated Gigs page | provider/request/quote/order lifecycle | live local QA workflow |
| NaijaStay | `/stay` | dedicated Stay page | listing/availability/booking engine | live listing; booking guarded |
| NaijaDrive | `/drive` | dedicated Drive page | preview/logistics foundations | capability-controlled |
| NaijaSend | `/send` | consolidated NaijaMove page | logistics quote/shipment APIs | beta/capability-controlled |
| NaijaStream | `/stream` | tailored NaijaPlay page | content backend pending | discovery only |
| NaijaPay | `/naijapay` | dedicated financial dashboard | wallet/payment intents/utility sandbox | authenticated; sandbox utilities |
| NaijaAuto | `/auto` | tailored NaijaProperty page | listing backend pending | discovery only |
| NaijaHomes | `/homes` | tailored NaijaProperty page | property backend pending | discovery only |
| NaijaTravel | `/travel` | consolidated NaijaTravel page | booking capability varies | discovery |
| NaijaEvents | `/events` | tailored NaijaTravel page | event backend pending | discovery only |
| NaijaLearn | `/learn` | tailored NaijaPlay page | course backend pending | discovery only |
| NaijaJobs | `/jobs` | dedicated employment landing | vacancy backend pending | honest empty/discovery state |
| NaijaHealth | `/health` | dedicated healthcare landing | verified-provider backend pending | discovery only |
| NaijaFarm | `/farm` | tailored NaijaMarket page | catalog capability pending | discovery only |
| NaijaHome | `/home` | tailored NaijaServices page | provider capability pending | discovery only |
| NaijaBeauty | `/beauty` | tailored NaijaServices page | provider/appointment capability pending | discovery only |
| Aura AI | `/aura` | existing Aura page | Aura shell/API | existing state preserved |

## Design and state rules

- Landing-page existence does not mark a vertical operational.
- Existing operational routes are reused instead of duplicated.
- Unavailable actions lead to discovery, waitlist, seller onboarding, help or account flows rather than fake checkout.
- Images use project-owned local assets.
- Country and vertical transaction controls remain backend-enforced.
- Sandbox utility payments remain explicitly sandbox-only.

## Hardening checkpoint

- Platform pages now render through the shared async `Layout` and inherit the real global header/footer.
- Guest header scripts skip authenticated wallet/wishlist API calls, avoiding expected 401 console noise.
- Browser acceptance covers 18 consolidated routes at 1440x900 and 390x844 with no console errors, failed requests or broken images.
- NaijaPay utility catalog loading now has explicit loading, empty, retry and failure states.
- Utility purchase submission is guarded against duplicate clicks and preserves idempotent sandbox receipts.
