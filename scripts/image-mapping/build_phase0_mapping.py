#!/usr/bin/env python3
"""
Phase 0 — PRODUCT DATABASE RECORD -> EXACT IMAGE ASSET mapping builder.

Reads the live D1 catalog export (products+categories+brands) and produces
a definitive per-product mapping BEFORE any image_generation call is made,
per Pat's "NAIJADEALS FINAL AUTHORIZATION" directive:

  product ID, product name, brand, category, country, primary image
  filename/path, generation brief, trademark-handling decision, status.

Also builds companion mappings for brands (38), vendors (18 real), and
scaffolds for categories (~22 departments) and countries (NG/GH/KE/MA).

CRITICAL RULE ENFORCED HERE: new filenames NEVER reuse the old
`product-{id}.jpg` naming pattern from the abandoned 44-image catalog
(commit 93e3cf9), so there is zero risk of a new asset being confused
with -- or accidentally overwriting semantics tied to -- an old,
mismatched one. New pattern: products/{id:03d}-{slug-short}.jpg
"""
import csv
import json
import re

PRODUCT_CSV = "/tmp/product_catalog_full.csv"
BRANDS_CSV = "/tmp/brands_full.csv"
VENDORS_CSV = "/tmp/vendors_real.csv"
OUT_JSON = "/home/user/webapp/scripts/image-mapping/phase0_mapping.json"
OUT_MD = "/home/user/webapp/scripts/image-mapping/PHASE0_MAPPING.md"

# ---------------------------------------------------------------------------
# Batch assignment (Pat's exact specified order)
# ---------------------------------------------------------------------------
BATCH_RULES = [
    (1, "Electronics / Phones / Computers", {
        "smartphones", "tablets", "laptops", "monitors", "televisions",
        "headphones-and-earphones", "speakers", "smart-watches",
        "phone-accessories", "computer-accessories", "gaming-consoles",
        "printers-and-scanners", "bulk-electronics", "car-electronics",
    }),
    (2, "Fashion / African Fashion", {
        "mens-clothing", "womens-clothing", "boys-clothing", "girls-clothing",
        "mens-shoes", "womens-shoes", "handbags", "sunglasses", "watches",
        "wigs-and-extensions",
        "ankara-fabric", "adire", "agbada", "aso-oke", "kente",
        "kenyan-textiles", "moroccan-kaftans", "wedding-attire",
        "bulk-fabrics", "sportswear",
    }),
    (3, "Beauty / Health", {
        "face-makeup", "facial-care", "body-care", "hair-products",
        "lip-and-eye-makeup", "personal-care-devices", "medical-supplies",
        "vitamins-and-supplements", "nigerian-haircare", "nigerian-skincare",
        "shea-butter-products", "argan-products",
    }),
    (4, "Home & Kitchen", {
        "blenders-and-mixers", "cookers-and-ovens", "dinnerware",
        "bedroom-furniture", "living-room-furniture", "lighting",
        "pots-and-pans", "refrigerators-and-freezers", "rugs-and-carpets",
        "wall-art", "moroccan-ceramics", "moroccan-rugs", "moroccan-leather",
        "office-furniture", "office-supplies", "event-decor",
        "seasonal-and-festive", "gift-sets",
    }),
    (5, "Grocery / African Food", {
        "beans-and-legumes", "biscuits-and-snacks", "juices", "rice",
        "soft-drinks", "nigerian-grains", "nigerian-spices-and-condiments",
        "nigerian-staples", "nigerian-cash-crops", "ghanaian-staples",
        "kenyan-coffee", "kenyan-tea", "bulk-groceries",
    }),
    (6, "Automotive / Sports / Tools", {
        "car-accessories", "motorcycle-parts", "exercise-equipment",
        "outdoor-recreation", "hand-tools", "power-tools",
        "industrial-equipment", "safety-equipment", "farm-equipment",
        "building-materials",
    }),
    (7, "African Arts / Crafts / Agriculture", {
        "ghanaian-beads", "ghanaian-woodwork", "maasai-crafts",
        "nigerian-beadwork", "nigerian-paintings", "nigerian-pottery",
        "nigerian-sculptures", "craft-supplies",
    }),
]
# Anything not in the above sets falls into an explicit "Batch 8 - General
# Merchandise" bucket (books, baby gear, luggage, instruments, toys, office
# tech, gift cards, software) -- still produced, just after the 7 named
# batches, since Pat's list wasn't exhaustive of all 100+ long-tail leaf
# categories in the Phase 1a taxonomy.
BATCH8_LABEL = "General Merchandise (unlisted long-tail categories)"

SLUG_TO_BATCH = {}
for num, label, slugs in BATCH_RULES:
    for s in slugs:
        SLUG_TO_BATCH[s] = (num, label)

# ---------------------------------------------------------------------------
# Trademark policy
# ---------------------------------------------------------------------------
# Decision (documented explicitly for Pat's review, applying the precedent
# from the abandoned-but-sound commit 93e3cf9 approach, which Pat's own
# authorization narrative referenced without objection):
#
#   GENERIC_STYLE: product photography is generated to accurately depict the
#     GENERAL product type/form-factor/category (a phone, a laptop, a pair
#     of sneakers, a jar of moisturizer) WITHOUT reproducing the brand's
#     actual logo/wordmark/trade-dress. The catalog keeps the real brand
#     name in the listing text (marketplace realism), but the image itself
#     carries no counterfeit or fabricated logo. This avoids the two things
#     the trademark rule actually forbids: (a) showing brand A's mark on a
#     fake/wrong item, and (b) showing a materially different product than
#     described. It does NOT claim to be an official brand photo.
#   NO_BRAND_NEEDED: product has no brand_id / is generic by nature -- image
#     is just accurate, no trademark question at all.
#
# This policy is applied uniformly rather than per-brand judgment calls,
# for consistency. Flagged to Pat in the delivery report for override if a
# stricter per-brand conversion-to-generic-title is preferred for specific
# global majors (Samsung/Apple/Sony/Nike etc.).
TRADEMARK_POLICY = "GENERIC_STYLE"

def slugify(text, maxlen=28):
    # IMPORTANT: strip apostrophes (and other quote marks) BEFORE the
    # alnum->dash collapse, so "Men's" -> "mens" not "men-s". A prior
    # version of this function produced "men-s"/"women-s" slugs that did
    # NOT match the filenames actually used when downloading Batch 1/2
    # images (which followed the simpler "mens"/"womens" convention),
    # causing 9 DB image_url values to point at non-existent files --
    # caught by a full disk-vs-DB audit after Batch 2. Fixed here so the
    # mapping's suggested filename always matches what actually gets
    # saved to disk for Batch 3 onward.
    s = re.sub(r"[\u2019']", "", text.lower())
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:maxlen].rstrip("-")

def load_products():
    rows = []
    with open(PRODUCT_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows

def build_brief(title, category_name, country_iso, brand_name):
    country_note = {
        "NG": "Nigerian market context",
        "GH": "Ghanaian market context",
        "KE": "Kenyan market context",
        "MA": "Moroccan market context",
    }.get(country_iso, "")
    parts = [f"Professional e-commerce studio product photograph of: {title}."]
    parts.append(f"Category: {category_name}.")
    if country_note:
        parts.append(f"{country_note} -- if culturally/regionally distinctive (fabric pattern, craft style, packaging), render it authentically.")
    if brand_name:
        parts.append(
            f"Depict the general product type/form-factor accurately; DO NOT reproduce the '{brand_name}' logo, "
            f"wordmark, or official trade dress -- neutral/unbranded surface finish, generic packaging or no packaging."
        )
    parts.append("Clean, well-lit, neutral or soft-gradient background (white/light-grey studio), realistic proportions, no text overlays, no watermarks.")
    return " ".join(parts)

def main():
    products = load_products()
    brands = list(csv.DictReader(open(BRANDS_CSV, newline="", encoding="utf-8")))
    vendors = list(csv.DictReader(open(VENDORS_CSV, newline="", encoding="utf-8")))

    mapping = {"products": [], "brands": [], "vendors": [], "categories": [], "countries": []}
    batch_counts = {}

    for row in products:
        pid = int(row["id"])
        cat_slug = row["category_slug"]
        batch_num, batch_label = SLUG_TO_BATCH.get(cat_slug, (8, BATCH8_LABEL))
        batch_counts[batch_num] = batch_counts.get(batch_num, 0) + 1
        fname_slug = slugify(row["title"])
        filename = f"products/{pid:03d}-{fname_slug}.jpg"
        brand_name = row["brand_name"] or None
        trademark = TRADEMARK_POLICY if brand_name else "NO_BRAND_NEEDED"
        mapping["products"].append({
            "product_id": pid,
            "slug": row["slug"],
            "title": row["title"],
            "brand": brand_name,
            "category_slug": cat_slug,
            "category_name": row["category_name"],
            "country_iso": row["country_iso"] or None,
            "batch": batch_num,
            "batch_label": batch_label,
            "image_path": f"/static/{filename}",
            "additional_images": [],
            "trademark_handling": trademark,
            "generation_brief": build_brief(row["title"], row["category_name"], row["country_iso"], brand_name),
            "status": "PENDING",
        })

    for row in brands:
        bid = int(row["id"])
        fname_slug = slugify(row["name"])
        mapping["brands"].append({
            "brand_id": bid,
            "name": row["name"],
            "logo_path": f"/static/brands/{bid:03d}-{fname_slug}.png",
            "generation_brief": (
                f"Minimal, professional circular/square logo mark representing a fictional or generic-styled "
                f"identity suitable to stand in for the brand '{row['name']}' in a demo marketplace -- flat vector "
                f"style, transparent-friendly background, no reproduction of the real company's actual trademarked "
                f"logo, wordmark, or brand colors as protected trade dress." if row["name"] != "Generic" else
                "Neutral grey placeholder-free generic marketplace mark (simple geometric monogram), flat vector style."
            ),
            "status": "PENDING",
        })

    for row in vendors:
        vid = int(row["id"])
        fname_slug = slugify(row["name"])
        mapping["vendors"].append({
            "vendor_id": vid,
            "name": row["name"],
            "logo_path": f"/static/vendors/{vid:03d}-{fname_slug}.png",
            "generation_brief": (
                f"Distinct storefront-style logo/mark for African marketplace vendor '{row['name']}' -- unique "
                f"color palette and iconography reflecting its specialty (implied by name), flat vector style, "
                f"visually DIFFERENT from other vendor logos (no shared template)."
            ),
            "status": "PENDING",
        })

    # Category department images (~22) -- derived from distinct top-level-ish
    # category_name values actually present in the product export, deduped.
    seen_cats = {}
    for row in products:
        seen_cats[row["category_slug"]] = row["category_name"]
    for slug, name in sorted(seen_cats.items()):
        mapping["categories"].append({
            "category_slug": slug,
            "category_name": name,
            "image_path": f"/static/categories/{slug}.jpg",
            "generation_brief": f"Wide banner-style lifestyle/flat-lay image that visually communicates the '{name}' department at a glance -- no text overlay.",
            "status": "PENDING",
        })

    for iso, name in [("NG", "Nigeria"), ("GH", "Ghana"), ("KE", "Kenya"), ("MA", "Morocco")]:
        mapping["countries"].append({
            "country_iso": iso,
            "country_name": name,
            "image_path": f"/static/countries/{iso.lower()}.jpg",
            "generation_brief": f"Authentic, vibrant real-world scene representing {name} for a marketplace 'shop by country' discovery card -- market/street/craft/landscape imagery, no stereotypical clichés, no text overlay.",
            "status": "PENDING",
        })

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2, ensure_ascii=False)

    # Markdown summary
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("# NaijaDeals Phase 0 — Product/Image Mapping\n\n")
        f.write(f"Generated from live D1 catalog export. Total products: {len(mapping['products'])}, "
                f"brands: {len(mapping['brands'])}, vendors: {len(mapping['vendors'])}, "
                f"categories: {len(mapping['categories'])}, countries: {len(mapping['countries'])}.\n\n")
        f.write("## Batch distribution (Pat's specified order)\n\n")
        f.write("| Batch | Label | Product count |\n|---|---|---|\n")
        labels = {n: l for n, l, _ in BATCH_RULES}
        labels[8] = BATCH8_LABEL
        for n in sorted(batch_counts):
            f.write(f"| {n} | {labels[n]} | {batch_counts[n]} |\n")
        f.write("\n## Trademark handling policy\n\n")
        f.write(f"Applied policy: **{TRADEMARK_POLICY}** for all branded products (see script docstring for full rationale).\n")
        f.write("Products with a brand get generic-styled, logo-free but category/form-factor-accurate photography; "
                "the catalog listing keeps the real brand name as text.\n\n")
        f.write("## Full product mapping\n\n")
        f.write("| ID | Title | Brand | Category | Country | Batch | Image Path | Status |\n")
        f.write("|---|---|---|---|---|---|---|---|\n")
        for p in sorted(mapping["products"], key=lambda x: (x["batch"], x["product_id"])):
            f.write(f"| {p['product_id']} | {p['title']} | {p['brand'] or '-'} | {p['category_name']} | "
                    f"{p['country_iso'] or '-'} | {p['batch']} | `{p['image_path']}` | {p['status']} |\n")
        f.write("\n## Brands\n\n| ID | Name | Logo Path | Status |\n|---|---|---|---|\n")
        for b in mapping["brands"]:
            f.write(f"| {b['brand_id']} | {b['name']} | `{b['logo_path']}` | {b['status']} |\n")
        f.write("\n## Vendors (real, non-test)\n\n| ID | Name | Logo Path | Status |\n|---|---|---|---|\n")
        for v in mapping["vendors"]:
            f.write(f"| {v['vendor_id']} | {v['name']} | `{v['logo_path']}` | {v['status']} |\n")
        f.write("\n## Categories\n\n| Slug | Name | Image Path | Status |\n|---|---|---|---|\n")
        for c in mapping["categories"]:
            f.write(f"| {c['category_slug']} | {c['category_name']} | `{c['image_path']}` | {c['status']} |\n")
        f.write("\n## Countries\n\n| ISO | Name | Image Path | Status |\n|---|---|---|---|\n")
        for c in mapping["countries"]:
            f.write(f"| {c['country_iso']} | {c['country_name']} | `{c['image_path']}` | {c['status']} |\n")

    print(f"Wrote {OUT_JSON} and {OUT_MD}")
    print("Batch counts:", batch_counts)

if __name__ == "__main__":
    main()
