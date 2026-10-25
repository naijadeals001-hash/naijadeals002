# NaijaDeals Public Reference Inspection — 2026-10-25

> **Classification:** NON-REA PUBLIC-WEB INSPECTION — NOT REA VERIFIED
>
> This report records live public website observations made with ordinary Playwright browser automation. It does not claim REA access, authenticated inspection, mobile-app inspection or private workflow access.

## 1. Scope and method

- Inspection date: 2026-10-25.
- Browser: Chromium, headless, 1440x1000 viewport, `en-NG` locale where accepted.
- Method: direct navigation to public URLs, DOM/accessibility observation, public form interaction and local screenshots.
- No repositories, README files or marketing descriptions were used as the primary evidence for the observations below.
- No authentication bypass, private account, payment account, driver account, merchant account or operations account was used.
- Screenshots were captured outside the repository under `/tmp/` and are not embedded into the product because they are third-party reference assets.

## 2. Reference access matrix

| Reference | URL opened | Public result | Inspection status | Limitation |
|---|---|---:|---|---|
| Jumia Nigeria | https://www.jumia.com.ng/ | 403 | **Blocked by target security challenge** | Only Cloudflare verification screen was visible; no product/catalog workflow claimed |
| Jumia search | https://www.jumia.com.ng/catalog/?q=phone | 403 | **Blocked by target security challenge** | Search results not inspected |
| Amazon | https://www.amazon.com/ | 202 / rendered | **Public landing inspected** | US locale; authenticated account, checkout and seller workflows not inspected |
| Amazon public search | Homepage search for `wireless headphones` | Rendered search results | **Public search workflow inspected** | Product detail/cart/checkout not authenticated or completed |
| Uber Eats | https://www.ubereats.com/ | 403 | **Blocked by target security challenge** | No restaurant discovery/order flow claimed |
| Uber Eats Nigeria path | https://www.ubereats.com/ng | 403 | **Blocked by target security challenge** | No Nigeria-specific workflow claimed |
| Uber | https://www.uber.com/ | 200 / rendered | **Public landing and pickup-input state inspected** | No authenticated ride request, payment, driver or dispatch workflow inspected |
| Bolt | https://bolt.eu/ | 200 / rendered | **Public services landing inspected** | No authenticated booking, driver or operations workflow inspected |
| inDrive | https://indrive.com/ | 403 | **Blocked by target CDN** | No ride workflow claimed |

## 3. Evidence captured

Local screenshot captures:

```text
/tmp/amazon-public.png
/tmp/amazon-search-workflow.png
/tmp/uber-pickup-workflow.png
/tmp/uber-public.png
/tmp/bolt-public.png
/tmp/indrive-public.png
/tmp/jumia-public.png
/tmp/jumia-shop-public.png
/tmp/ubereats-public.png
/tmp/ubereats-ng-public.png
/tmp/naijadeals-shop-search.png
/tmp/naijadeals-product-detail.png
```

These paths are local inspection artifacts and are not application assets.

## 4. Observed public workflows and interfaces

### 4.1 Amazon — public marketplace/search

Observed URL:

```text
https://www.amazon.com/
```

Observed interface elements:

- Global header with delivery location, department selector, search input, language, account, returns/orders and cart.
- A large promotional content rail above merchandising sections.
- Department/category navigation across the page.
- Search input with placeholder `Search Amazon`.
- Account and list entry points.
- Cart and order-history entry points.
- Public department options including electronics, grocery, beauty, health, home, automotive and other categories.

Public interaction executed:

```text
Homepage -> fill Search Amazon with “wireless headphones” -> submit
```

Observed result:

```text
URL: https://www.amazon.com/s?k=wireless+headphones...
Title: Amazon.com : wireless headphones
Result page exposed “Results” and “Filters” landmarks.
23 matching headphone-related links were detected in the rendered DOM.
```

Not inspected:

- Authenticated account.
- Payment or checkout.
- Order placement.
- Seller console.
- Amazon Fresh/marketplace operator workflows.

### 4.2 Uber — public mobility request form

Observed URL:

```text
https://www.uber.com/
```

Observed interface elements:

- Top navigation for Ride, Earn, Business, Uber Eats and About.
- City selector.
- Primary `Go anywhere` hero.
- `Pickup now` scheduling control.
- Pickup and dropoff fields.
- `See prices` action.
- Public product cards for Ride, Reserve, Airport, Black, Taxi and Rental Cars.
- Public process explanation: enter destination, get matched, meet driver, ride, rate/tip.
- Public login and signup entry points.

Public interaction executed:

```text
Landing -> fill pickup location with “Lagos”
```

Observed behavior:

- Pickup field accepted the entered text.
- A suggestion panel rendered.
- Suggestions included public place results and `Search for Lagos`.
- The page exposed `8 options available` for the entered search state.
- The target page remained on the public Uber landing page.

Not inspected:

- Authenticated booking.
- Fare quote submission.
- Payment.
- Driver identity/presence.
- Dispatch or operations dashboard.

### 4.3 Bolt — public mobility and services discovery

Observed URL:

```text
https://bolt.eu/en/
```

Observed interface elements:

- Public heading: `Riding is the new driving`.
- Main actions: `Get Bolt`, `Get Bolt Food`.
- Service cards for Rides, Delivery, Car-sharing, Groceries, Business and Micromobility.
- Public navigation for Support, Register, Products, Earn with Bolt and Company.
- Public links for Rides, Safety, Driver, Bolt Send, Food, Merchant and Courier surfaces.
- Cookie consent controls were visible.

Limitation:

- The public page states that products and features vary by country.
- No authenticated ride, courier, merchant, driver or dispatch workflow was inspected.

### 4.4 Jumia, Uber Eats and inDrive

The targets were opened directly, but the environment received target-side access challenges:

- Jumia: Cloudflare `Performing security verification`.
- Uber Eats: Cloudflare `Performing security verification`.
- inDrive: CloudFront `403 ERROR`.

Only the block pages were observed. No product, restaurant, ride or operational claims are made for these targets.

## 5. Representative NaijaDeals workflow selected

The safest evidence-supported workflow is the public marketplace discovery slice:

```text
Search -> result grid -> product detail -> add-to-cart / buy-now entry points
```

This is the closest existing NaijaDeals workflow to the publicly inspected Amazon marketplace/search experience and does not require unsupported payment or authenticated reference claims.

## 6. Existing NaijaDeals implementation comparison

Existing implementation inspected:

- `src/pages/shop.tsx`
- `src/pages/product.tsx`
- `src/routes/api-catalog.ts`
- `src/components/ProductCard.tsx`
- `src/lib/catalog.ts`
- `src/index.tsx`

Existing capabilities already present:

- Query-driven search at `/shop?q=<term>`.
- Category filters.
- Brand filter.
- Price range filters.
- Minimum rating filter.
- Nigerian-brand filter.
- Country availability/origin filters.
- Sort options: newest, price ascending, price descending, top rated and best selling.
- Result count and pagination.
- Product cards with image, brand, price, rating, stock/seller indicators and add-to-cart entry point.
- Product detail page at `/shop/:slug`.
- Seller count and primary buy-box selection.
- Product description, rating, delivery, warranty, returns and seller information.
- Add-to-cart and buy-now entry points.
- Shared session/cart/checkout architecture.
- Best-effort search behavior event recording.

## 7. Preview verification of the representative workflow

Using the existing local preview on port 3000:

```text
GET /shop?q=phone
```

Observed:

```text
Title: Search: phone | NaijaDeals
Heading: Search: phone
Results: 7
Product cards detected: 7
First product: /shop/sony-wh-ch520-wireless-headphones
```

Navigating to the first result:

```text
URL: /shop/sony-wh-ch520-wireless-headphones
Title: Sony WH-CH520 Wireless Headphones | NaijaDeals
Heading: Sony WH-CH520 Wireless Headphones
Add-to-cart entry point: present
Buy-now entry point: present
Seller information: present
```

This workflow was browser-verified against the existing implementation. No duplicate marketplace workflow was created because the existing NaijaDeals implementation already provides the representative slice and uses the shared catalog/cart foundations.

## 8. Central Admin compatibility

The selected representative slice does not create a new administrator system.

Existing Central Admin integration remains the source of truth for supported platform operations:

- Shared `nd_session` identity.
- Control Center RBAC.
- Shared vendor/customer/moderation surfaces.
- Shared finance entry point.
- Central audit architecture.
- Existing `/control-center` protected routes.

No new vertical-specific admin identity or Super Admin privilege was added.

## 9. Genuine REA investigation result

REA remains unavailable.

The installed `gsk` CLI was checked. It exposes web search, crawling, screenshots, media analysis and other tools, but no REA browser/application-inspection command. The available project skills also contain no REA integration.

Ordinary Playwright automation used for this report is explicitly **not REA**.

Required setup to enable genuine REA remains one of:

1. An installed REA extension/service with live browser and mobile-app inspection.
2. A connected REA browser session with authorized account support.
3. An authorized REA tool/skill name and setup instructions.
4. Exported REA evidence artifacts from a supported environment.

## 10. Current status

| Requirement | Status |
|---|---|
| Public reference inspection started | **Yes — non-REA only** |
| Amazon public workflow inspected | **Yes** |
| Uber public workflow inspected | **Yes** |
| Bolt public services landing inspected | **Yes** |
| Jumia public workflow inspected | **Blocked by Cloudflare challenge** |
| Uber Eats public workflow inspected | **Blocked by Cloudflare challenge** |
| inDrive public workflow inspected | **Blocked by CloudFront 403** |
| Authenticated reference workflows | **Not inspected; no authorization provided** |
| Mobile applications | **Not inspected; no emulator/REA available** |
| Representative NaijaDeals workflow | **Existing workflow browser-verified** |
| New code implementation required for selected slice | **No; existing implementation already covers it** |
| Genuine REA mission complete | **No** |
