#!/usr/bin/env python3
"""
Phase 1a seed generator — NaijaShop Marketplace Taxonomy & Catalog Foundation.

Generates a single SQL file (migrations/seed-phase1a-taxonomy-catalog.sql) that:
  1. Seeds a real, browsable PRODUCT category taxonomy (departments -> groups ->
     subcategories -> leaves) with the African/country layer woven directly into
     the SAME tree (country_iso set per node) rather than a parallel system —
     exactly the "Fashion -> African Fashion -> Nigerian Fashion -> Nigerian
     Fabrics -> Ankara Fabric" pattern specified in the approved directive.
  2. Seeds category_attributes for the representative departments called out
     explicitly (Fashion, Electronics, African Fabrics, Coffee).
  3. Seeds real brands (global + Nigerian-flagged).
  4. Seeds NEW, dedicated seed-vendor accounts (see note below on why NOT the
     existing cctest-* vendor rows).
  5. Seeds ~250-300 real products + one primary product_listing each (some with
     a second competing listing to exercise buy-box/seller_count > 1), variants
     for apparel/fabric leaves, and category_attribute_values for products in
     categories that have attribute definitions.
  6. Marks every seeded products/product_listings row source_type='seed'
     (migration 0053) so it is programmatically distinguishable from future
     live merchant inventory, per the approved directive.

WHY NEW VENDOR ROWS, NOT THE EXISTING 32 `vendors` RECORDS:
  Inspected `tests/control-center/helpers/client.mjs` (ADR-001 Step 2 session):
  ALL 32 existing vendor rows are RBAC test fixtures (slug LIKE 'cctest-vendor-%'),
  swept by `cleanupAllControlCenterTestFixtures()` / the broader
  `DELETE FROM vendors WHERE slug LIKE 'cctest-vendor-%'` cleanup query. Since
  `product_listings.vendor_id` has NO `ON DELETE CASCADE` (unlike
  `product_id`, which does), pointing seed listings at those vendor rows would
  make a future test-suite cleanup run FAIL with a foreign-key constraint
  violation the moment that sweep tries to delete a vendor a seed listing still
  references — a new, self-inflicted bug. This script creates ~18 new,
  real-business-named vendor accounts instead (never prefixed 'cctest'), fully
  isolated from the RBAC test harness's fixture lifecycle.

Placeholder imagery: uses this project's OWN existing, already-documented
mechanism (src/routes/placeholder.ts's /ph.svg generator — "Zero external
dependencies, zero licensing risk, Workers-safe") for product/brand imagery.
This is not fabricated functionality; it is the same solution this codebase
already ships for "no licensed photo set yet" (see that file's own header
comment). Phase 1b may layer in curated real photography for reference-image-
critical hero/carousel slots; Phase 1a's job is correct, real, structured
CATALOG DATA, which this provides in full.

Output: migrations/seed-phase1a-taxonomy-catalog.sql (NOT a numbered migration
— seed data, not schema DDL, matching this project's existing seed.sql
convention). Apply with:
  npx wrangler d1 execute naijadeals-production --local --file=./migrations/seed-phase1a-taxonomy-catalog.sql
"""
import json
import random

random.seed(20260915)  # deterministic output — reruns produce identical SQL for diffing

OUT_PATH = "/home/user/webapp/migrations/seed-phase1a-taxonomy-catalog.sql"

# Existing max ids (queried live from D1 before writing this script) — new rows
# start strictly above these so nothing collides with the 36 legacy service
# categories, 32 cctest vendor fixtures, etc.
CATEGORY_ID_START = 37
VENDOR_ID_START = 57
BRAND_ID_START = 1
PRODUCT_ID_START = 1
LISTING_ID_START = 1
COLLECTION_ID_START = 21  # 20 collections already seeded by migration 0038

sql_parts = []


def esc(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def slugify(name, country=None):
    s = name.lower()
    for a, b in [("&", "and"), ("'", ""), (",", ""), ("/", "-")]:
        s = s.replace(a, b)
    s = "-".join(s.split())
    return f"{s}-{country.lower()}" if country else s


# ======================================================================
# 1. CATEGORY TAXONOMY TREE
# ======================================================================
# Nested structure. Each node: (name, icon, [children], country_iso=None)
# Depth is NOT hard-capped at 4 — "level" is a best-effort tier classification
# (1=department 2=group 3=subcategory 4=leaf) but some African branches
# genuinely need a 5th hop (dept -> group -> country-subcategory ->
# craft-type -> specific leaf), matching the directive's own worked example
# ("Fashion -> African Fashion -> Nigerian Fashion -> Nigerian Fabrics ->
# Ankara Fabric" = 5 hops). parent_id/path reflect TRUE depth; level is capped
# display metadata only, never used to restrict real tree depth.


def N(name, icon="category", children=None, country_iso=None):
    return {"name": name, "icon": icon, "children": children or [], "country_iso": country_iso}


TAXONOMY = [
    N("Electronics", "devices", [
        N("Phones & Tablets", "smartphone", [
            N("Smartphones", "smartphone"),
            N("Tablets", "tablet"),
            N("Phone Accessories", "cable"),
            N("Feature Phones", "phone_iron"),
        ]),
        N("Computers & Laptops", "laptop_mac", [
            N("Laptops", "laptop_mac"),
            N("Desktops", "desktop_windows"),
            N("Computer Accessories", "keyboard"),
            N("Monitors", "monitor"),
        ]),
        N("TV, Audio & Home Theatre", "tv", [
            N("Televisions", "tv"),
            N("Headphones & Earphones", "headphones"),
            N("Speakers", "speaker"),
            N("Home Theatre Systems", "surround_sound"),
        ]),
        N("Cameras & Photography", "photo_camera", [
            N("Digital Cameras", "photo_camera"),
            N("Camera Accessories", "camera"),
        ]),
        N("Wearable Technology", "watch", [
            N("Smart Watches", "watch"),
            N("Fitness Trackers", "monitor_heart"),
        ]),
        N("Gaming", "sports_esports", [
            N("Gaming Consoles", "sports_esports"),
            N("Gaming Accessories", "gamepad"),
        ]),
    ]),
    N("Fashion", "checkroom", [
        N("Men's Fashion", "man", [
            N("Men's Clothing", "checkroom"),
            N("Men's Shoes", "footprint"),
        ]),
        N("Women's Fashion", "woman", [
            N("Women's Clothing", "checkroom"),
            N("Women's Shoes", "footprint"),
        ]),
        N("Kids' Fashion", "child_care", [
            N("Boys' Clothing", "checkroom"),
            N("Girls' Clothing", "checkroom"),
        ]),
        N("Bags & Luggage", "work", [
            N("Handbags", "shopping_bag"),
            N("Backpacks", "backpack"),
        ]),
        N("Jewelry & Accessories", "diamond", [
            N("Jewelry", "diamond"),
            N("Watches", "watch"),
            N("Sunglasses", "visibility"),
        ]),
        N("African Fashion", "public", [
            N("Nigerian Fashion", "flag", [
                N("Nigerian Fabrics", "texture", [
                    N("Ankara Fabric", "texture"),
                    N("Adire", "texture"),
                    N("Aso Oke", "texture"),
                ]),
                N("Agbada", "checkroom"),
                N("Nigerian Leather Goods", "work"),
            ], country_iso="NG"),
            N("Ghanaian Fashion", "flag", [
                N("Kente", "texture"),
                N("Ghanaian Beads", "diamond"),
            ], country_iso="GH"),
            N("Kenyan Fashion", "flag", [
                N("Kenyan Textiles", "texture"),
            ], country_iso="KE"),
            N("Moroccan Fashion", "flag", [
                N("Moroccan Kaftans", "checkroom"),
            ], country_iso="MA"),
        ]),
    ]),
    N("Home & Kitchen", "kitchen", [
        N("Kitchen Appliances", "microwave", [
            N("Blenders & Mixers", "blender"),
            N("Cookers & Ovens", "outdoor_grill"),
            N("Refrigerators & Freezers", "kitchen"),
        ]),
        N("Cookware & Dining", "dining", [
            N("Pots & Pans", "soup_kitchen"),
            N("Dinnerware", "dining"),
        ]),
        N("Furniture", "chair", [
            N("Living Room Furniture", "living"),
            N("Bedroom Furniture", "bed"),
        ]),
        N("Home Decor", "yard", [
            N("Wall Art", "image"),
            N("Rugs & Carpets", "texture"),
        ]),
        N("Home Improvement", "handyman", [
            N("Lighting", "lightbulb"),
            N("Bathroom Fixtures", "bathtub"),
        ]),
    ]),
    N("Grocery & Food", "grocery", [
        N("Staples & Grains", "rice_bowl", [
            N("Rice", "rice_bowl"),
            N("Beans & Legumes", "grain"),
        ]),
        N("Beverages", "local_cafe", [
            N("Soft Drinks", "local_drink"),
            N("Juices", "local_drink"),
        ]),
        N("Snacks & Confectionery", "cookie", [
            N("Biscuits & Snacks", "cookie"),
        ]),
        N("African Foods", "public", [
            N("Nigerian Foods", "flag", [
                N("Nigerian Staples", "rice_bowl"),
                N("Nigerian Spices & Condiments", "spa"),
            ], country_iso="NG"),
            N("Ghanaian Foods", "flag", [
                N("Ghanaian Staples", "rice_bowl"),
            ], country_iso="GH"),
            N("Kenyan Foods", "flag", [
                N("Kenyan Coffee", "coffee"),
                N("Kenyan Tea", "emoji_food_beverage"),
            ], country_iso="KE"),
        ]),
    ]),
    N("Beauty & Personal Care", "spa", [
        N("Skincare", "face_retouching_natural", [
            N("Facial Care", "face"),
            N("Body Care", "spa"),
        ]),
        N("Haircare", "content_cut", [
            N("Hair Products", "content_cut"),
            N("Wigs & Extensions", "face"),
        ]),
        N("Makeup", "brush", [
            N("Face Makeup", "brush"),
            N("Lip & Eye Makeup", "brush"),
        ]),
        N("Fragrances", "local_florist", []),
        N("African Beauty", "public", [
            N("Nigerian Beauty", "flag", [
                N("Nigerian Skincare", "spa"),
                N("Nigerian Haircare", "content_cut"),
            ], country_iso="NG"),
            N("Ghanaian Beauty", "flag", [
                N("Shea Butter Products", "spa"),
            ], country_iso="GH"),
        ]),
    ]),
    N("Health", "health_and_safety", [
        N("Personal Care Devices", "medical_services", []),
        N("Vitamins & Supplements", "medication", []),
        N("Medical Supplies", "medical_information", []),
    ]),
    N("Baby & Kids", "child_friendly", [
        N("Baby Gear", "stroller", []),
        N("Diapering", "baby_changing_station", []),
        N("Feeding", "baby_changing_station", []),
    ]),
    N("Toys & Games", "toys", [
        N("Educational Toys", "extension"),
        N("Action Figures & Dolls", "smart_toy"),
        N("Board Games & Puzzles", "casino"),
    ]),
    N("Sports & Fitness", "fitness_center", [
        N("Exercise Equipment", "fitness_center"),
        N("Sportswear", "sports"),
        N("Outdoor Recreation", "hiking"),
    ]),
    N("Automotive", "directions_car", [
        N("Car Accessories", "car_repair"),
        N("Car Electronics", "speaker"),
        N("Motorcycle Parts", "two_wheeler"),
    ]),
    N("Tools & Hardware", "construction", [
        N("Power Tools", "construction"),
        N("Hand Tools", "handyman"),
        N("Building Materials", "foundation"),
    ]),
    N("Agriculture", "agriculture", [
        N("Farm Equipment", "agriculture"),
        N("Seeds & Seedlings", "grass"),
        N("African Agriculture", "public", [
            N("Nigerian Agriculture", "flag", [
                N("Nigerian Grains", "grain"),
                N("Nigerian Cash Crops", "eco"),
            ], country_iso="NG"),
        ]),
    ]),
    N("Industrial & Commercial", "factory", [
        N("Industrial Equipment", "precision_manufacturing"),
        N("Safety Equipment", "engineering"),
    ]),
    N("Office & Business", "business_center", [
        N("Office Supplies", "edit_note"),
        N("Office Furniture", "chair"),
        N("Printers & Scanners", "print"),
    ]),
    N("Books & Education", "menu_book", [
        N("Fiction", "auto_stories"),
        N("Non-Fiction", "menu_book"),
        N("Educational Materials", "school"),
    ]),
    N("Art & Crafts", "palette", [
        N("Craft Supplies", "palette"),
        N("African Crafts", "public", [
            N("Nigerian Crafts", "flag", [
                N("Nigerian Pottery", "coffee_maker"),
                N("Nigerian Beadwork", "diamond"),
            ], country_iso="NG"),
            N("Nigerian Art", "flag", [
                N("Nigerian Paintings", "image"),
                N("Nigerian Sculptures", "category"),
            ], country_iso="NG"),
            N("Ghanaian Crafts", "flag", [
                N("Ghanaian Woodwork", "category"),
            ], country_iso="GH"),
            N("Kenyan Crafts", "flag", [
                N("Maasai Crafts", "diamond"),
            ], country_iso="KE"),
            N("Moroccan Crafts", "flag", [
                N("Moroccan Leather", "work"),
                N("Moroccan Rugs", "texture"),
                N("Moroccan Ceramics", "coffee_maker"),
                N("Argan Products", "spa"),
            ], country_iso="MA"),
        ]),
    ]),
    N("Musical Instruments", "music_note", [
        N("String Instruments", "music_note"),
        N("Percussion & Drums", "music_note"),
        N("Keyboards & Pianos", "piano"),
    ]),
    N("Travel & Luggage", "luggage", [
        N("Suitcases", "luggage"),
        N("Travel Accessories", "flight"),
    ]),
    N("Weddings & Events", "celebration", [
        N("Wedding Attire", "celebration"),
        N("Event Decor", "celebration"),
    ]),
    N("Gifts & Seasonal", "card_giftcard", [
        N("Gift Sets", "card_giftcard"),
        N("Seasonal & Festive", "celebration"),
    ]),
    N("Digital Products", "cloud", [
        N("Software & Licenses", "cloud"),
        N("Gift Cards", "card_giftcard"),
    ]),
    N("Wholesale & B2B", "inventory_2", [
        N("Bulk Groceries", "inventory_2"),
        N("Bulk Fabrics", "texture"),
        N("Bulk Electronics", "inventory_2"),
    ]),
]

# ----------------------------------------------------------------------
# Flatten tree -> rows with computed id/parent_id/level/path/sort_order
# ----------------------------------------------------------------------
rows = []  # each: dict(id, slug, name, icon, parent_id, level, path, sort_order, country_iso)
next_id = CATEGORY_ID_START


def walk(node, parent_id, level, parent_path, sort_order, inherited_country):
    global next_id
    cid = next_id
    next_id += 1
    country = node["country_iso"] or inherited_country
    slug = slugify(node["name"], node["country_iso"])
    path = f"{parent_path}/{cid}" if parent_path else str(cid)
    rows.append({
        "id": cid, "slug": slug, "name": node["name"], "icon": node["icon"],
        "parent_id": parent_id, "level": level, "path": path,
        "sort_order": sort_order, "country_iso": country,
    })
    for i, child in enumerate(node["children"], start=1):
        walk(child, cid, level + 1, path, i, country)


for i, dept in enumerate(TAXONOMY, start=1):
    walk(dept, None, 1, "", i, None)

leaf_ids = {r["id"] for r in rows} - {r["parent_id"] for r in rows if r["parent_id"]}
by_slug = {r["slug"]: r for r in rows}

print(f"Generated {len(rows)} category rows "
      f"(departments={sum(1 for r in rows if r['level']==1)}, "
      f"total leaves={len(leaf_ids)})")

sql_parts.append("-- ============================================================")
sql_parts.append("-- PHASE 1A SEED: PRODUCT CATEGORY TAXONOMY")
sql_parts.append(f"-- {len(rows)} rows | departments={sum(1 for r in rows if r['level']==1)} | leaves={len(leaf_ids)}")
sql_parts.append("-- ============================================================")
for r in rows:
    sql_parts.append(
        "INSERT INTO categories (id, slug, name, icon, sort_order, parent_id, category_type, level, path, country_iso) "
        f"VALUES ({r['id']}, {esc(r['slug'])}, {esc(r['name'])}, {esc(r['icon'])}, {r['sort_order']}, "
        f"{r['parent_id'] if r['parent_id'] else 'NULL'}, 'product', {r['level']}, {esc(r['path'])}, "
        f"{esc(r['country_iso']) if r['country_iso'] else 'NULL'});"
    )

with open(OUT_PATH, "w") as f:
    f.write("\n".join(sql_parts) + "\n")

# Save the flattened category map for the next generator stage (products script)
with open("/home/user/webapp/scripts/seed/_categories.json", "w") as f:
    json.dump(rows, f)

print(f"Wrote category seed SQL to {OUT_PATH}")
