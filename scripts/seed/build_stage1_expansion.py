#!/usr/bin/env python3
"""
Stage 1 Catalog Expansion — Safe, Additive Remap Generator
============================================================

Reads scripts/seed/seed-phase1a-taxonomy-catalog.sql (the abandoned
127-product/189-category Phase 1a seed, NEVER applied to production) and
scripts/seed/_categories.json (if present), and generates a single,
deterministic, idempotent SQL migration file that:

  1. Reuses the 7 colliding category slugs and 15 colliding brand slugs by
     mapping phase1a's category/brand IDs to PRODUCTION's existing IDs for
     those slugs (no duplicate departments/brands are created).
  2. Remaps every NON-colliding phase1a category/brand/vendor/product/
     listing ID to a fresh ID starting strictly above the current
     production MAX(id) for that table (queried, never assumed).
  3. Restricts the product set to ONLY the 59 products that have verified
     real photography on disk (public/static/products/{id:03d}-*.jpg),
     rewriting their image_url to point at that real file instead of the
     seed file's original /ph.svg placeholder.
  4. Imports the FULL 189-category phase1a taxonomy (not just the subset
     needed by the 59 photographed products) — per Pat's explicit decision
     that the category tree is a platform taxonomy, distinct from current
     product population (production already has zero-product categories
     today, e.g. "Fresh Fruits"). Brands and vendors, by contrast, stay
     strictly scoped to what the 59 imported products actually reference.
  5. Emits ZERO product_country_origins rows that infer country from a
     category name. A product only gets a product_country_origins row if
     Pat/a human explicitly confirms it later — this generator deliberately
     does NOT populate that table, per the explicit instruction: "Do not
     assign country-of-origin merely because a category name says
     Nigerian/Ghanaian/Kenyan/etc... Leave unknown provenance as NULL."
  6. Never touches products 1-44, categories that already exist unchanged,
     brands 1-30, or vendors 1-21. Every statement is a plain INSERT with
     an explicit, pre-computed new ID — never INSERT OR REPLACE, never
     UPSERT, never a bare INSERT relying on AUTOINCREMENT (which would risk
     re-colliding if run twice) for tables where we assign IDs ourselves.
  7. Is idempotent: wrapped in INSERT ... WHERE NOT EXISTS-style guards
     (via slug uniqueness) so re-running it after a partial success does
     not create duplicates.

Usage:
    python3 scripts/seed/build_stage1_expansion.py \
        --prod-max-product-id 44 \
        --prod-max-category-id 150 \
        --prod-max-brand-id 30 \
        --prod-max-vendor-id 21 \
        --prod-max-listing-id 80 \
        --prod-categories-json /tmp/stage1_sim/prod_categories.json \
        --prod-brands-json /tmp/stage1_sim/prod_brands.json \
        --out migrations/0068_catalog_expansion_stage1.sql

All prod-max-*-id values and prod-*-json exports MUST come from a FRESH
query against production (or a same-session export) immediately before
running this script — never hardcoded from memory.
"""
import argparse
import json
import re
import sys


def split_sql_values(vals_str: str):
    """Split a single SQL VALUES(...) tuple body respecting quoted strings."""
    parts = []
    current = ''
    in_quote = False
    i = 0
    while i < len(vals_str):
        c = vals_str[i]
        if c == "'" and not in_quote:
            in_quote = True
            current += c
        elif c == "'" and in_quote:
            if i + 1 < len(vals_str) and vals_str[i + 1] == "'":
                current += "''"
                i += 1
            else:
                in_quote = False
                current += c
        elif c == ',' and not in_quote:
            parts.append(current.strip())
            current = ''
        else:
            current += c
        i += 1
    if current.strip():
        parts.append(current.strip())
    return parts


def sql_str(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


# The 59 phase1a product IDs with verified real photography on disk
# (public/static/products/{id:03d}-*.jpg). Recomputed by cross-referencing
# the directory listing against the seed file at generation time below —
# this literal list is a fallback/assertion, not the source of truth.
EXPECTED_PHOTO_IDS = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 40, 42,
    43, 45, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 85, 88, 100,
    119, 126, 127,
]

# The 7 category slugs and 15 brand slugs known (from the audited overlap
# check) to collide between phase1a and production. Any slug NOT in these
# sets is treated as net-new and gets a fresh remapped ID.
KNOWN_CATEGORY_SLUG_COLLISIONS = {
    'electronics', 'fashion', 'kitchen-appliances', 'furniture',
    'skincare', 'haircare', 'automotive',
}
KNOWN_BRAND_SLUG_COLLISIONS = {
    'samsung', 'apple', 'tecno', 'infinix', 'hp', 'lg', 'hisense', 'sony',
    'nike', 'adidas', 'itel', 'indomie', 'nestle', 'dettol', 'golden-penny',
}

# MANUALLY REVIEWED semantic duplicates: phase1a categories that use a
# DIFFERENT slug than production but represent the IDENTICAL concept
# (verified by name + category_type + tree position, not just string
# matching — a name-only match was found to produce a false positive,
# 'Makeup' product category vs 'Makeup Services' booking category, which
# are legitimately distinct and are correctly NOT in this map). Found via
# a full name-collision audit run after the initial slug-only pass missed
# these 4 (see conversation record 2026-09-19). Each maps
# phase1a_category_id -> production_category_id directly, bypassing the
# slug-lookup path entirely.
MANUAL_CATEGORY_ID_COLLISIONS = {
    38: 2,     # phase1a 'phones-and-tablets'  == production 'phones-tablets'      (id=2)
    63: 11,    # phase1a 'mens-fashion'        == production 'fashion-men'         (id=11)
    66: 12,    # phase1a 'womens-fashion'      == production 'fashion-women'       (id=12)
    94: 20,    # phase1a 'home-and-kitchen'    == production 'home-kitchen'        (id=20)
    112: 31,   # phase1a 'staples-and-grains'  == production 'grocery-staples'     (id=31)
    114: 107,  # phase1a 'beans-and-legumes'   == production 'fresh-beans-legumes' (id=107)
    115: 32,   # phase1a 'beverages'           == production 'grocery-beverages'   (id=32)
}
# Found via the FULL 189-category name+category_type audit (2026-09-19,
# re-run against the entire phase1a taxonomy rather than just the ~83-node
# closure needed by the 59 photographed products). All 3 additions above
# are confirmed genuine same-concept duplicates (identical display name AND
# category_type, just a different phase1a slug spelling) — not caught by
# the slug-only KNOWN_CATEGORY_SLUG_COLLISIONS pass because their phase1a
# slugs (staples-and-grains / beans-and-legumes / beverages) don't literally
# match production's slugs (grocery-staples / fresh-beans-legumes /
# grocery-beverages).
# NOTE: phase1a category 136 ('makeup', category_type='product', a SHOP-FOR-
# COSMETICS category) is NOT mapped to production category 132
# ('makeup-services', category_type='service', a BOOK-A-MAKEUP-ARTIST
# category) despite the identical display name — verified these are
# genuinely distinct concepts (different category_type, different parent
# department: Beauty & Personal Care vs Beauty Services) and must remain
# separate rows. Confirmed during manual audit, not an oversight.

# Same class of issue as categories: phase1a brand id=20 ('zaron-cosmetics')
# is the SAME real brand as production brand id=13 ('zaron', name='Zaron
# Cosmetics', is_nigerian=1) under a different slug. Found via a full
# name-collision audit run after the initial slug-only pass missed it.
MANUAL_BRAND_ID_COLLISIONS = {
    20: 13,   # phase1a 'zaron-cosmetics' == production 'zaron' (id=13, 'Zaron Cosmetics')
    29: 28,   # phase1a 'peak-milk'       == production 'peak'  (id=28, 'Peak Milk')
}
# 29->28 found via a full name-collision audit re-run against ALL 38 phase1a
# brands (not just the subset referenced by the 59 photographed products) —
# same real brand ("Peak Milk"), different slug spelling. Confirmed
# 2026-09-19 per Pat's explicit instruction to apply this mapping.


def parse_phase1a(seed_path):
    with open(seed_path) as f:
        content = f.read()

    def parse_table(table, col_list):
        pattern = (
            r"INSERT INTO " + table + r" \(" + re.escape(col_list) +
            r"\) VALUES \((.*?)\);"
        )
        rows = {}
        for m in re.finditer(pattern, content):
            vals = split_sql_values(m.group(1))
            row = dict(zip(col_list.split(', '), vals))
            rows[int(row['id'])] = row
        return rows

    categories = parse_table(
        'categories',
        'id, slug, name, icon, sort_order, parent_id, category_type, level, path, country_iso'
    )
    brands = parse_table(
        'brands',
        'id, slug, name, logo_url, is_nigerian, description, is_featured, display_order, status'
    )
    vendors = parse_table(
        'vendors',
        'id, slug, name, description, logo_url, city, is_verified, rating_avg, '
        'rating_count, positive_feedback_percent, state, response_time_hours, '
        'joined_year, country_iso, store_type, verification_status, store_status'
    )
    products = parse_table(
        'products',
        'id, slug, category_id, brand_id, title, description, long_description, '
        'specs_json, whats_included_json, image_url, gallery_json, rating_avg, '
        'rating_count, sales_count, is_flash_deal, is_active, return_policy, '
        'moderation_status, source_type'
    )
    listings = parse_table(
        'product_listings',
        'id, product_id, vendor_id, price_kobo, compare_at_price_kobo, stock, '
        'condition, delivery_days_min, delivery_days_max, warranty_months, '
        'is_plus, is_primary, is_active, moderation_status, sku, source_type'
    )
    return categories, brands, vendors, products, listings


def strip_quotes(v):
    if v == 'NULL':
        return None
    if v.startswith("'") and v.endswith("'"):
        return v[1:-1].replace("''", "'")
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', default='scripts/seed/seed-phase1a-taxonomy-catalog.sql')
    ap.add_argument('--photos-dir', default='public/static/products')
    ap.add_argument('--prod-max-product-id', type=int, required=True)
    ap.add_argument('--prod-max-category-id', type=int, required=True)
    ap.add_argument('--prod-max-brand-id', type=int, required=True)
    ap.add_argument('--prod-max-vendor-id', type=int, required=True)
    ap.add_argument('--prod-max-listing-id', type=int, required=True)
    ap.add_argument('--prod-categories-json', required=True,
                     help='Fresh export: SELECT * FROM categories (production)')
    ap.add_argument('--prod-brands-json', required=True,
                     help='Fresh export: SELECT * FROM brands (production)')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    categories, brands, vendors, products, listings = parse_phase1a(args.seed)

    # --- verify photo IDs against disk ---
    import os
    files = os.listdir(args.photos_dir)
    photo_ids = sorted(
        int(f.split('-')[0]) for f in files if re.match(r'^\d{3}-', f)
    )
    if photo_ids != EXPECTED_PHOTO_IDS:
        print('WARNING: disk photo IDs differ from EXPECTED_PHOTO_IDS!', file=sys.stderr)
        print('  disk:', photo_ids, file=sys.stderr)
        print('  expected:', EXPECTED_PHOTO_IDS, file=sys.stderr)
    photo_ids = sorted(set(photo_ids) & set(products.keys()))
    photo_file_for_id = {}
    for f in files:
        m = re.match(r'^(\d{3})-', f)
        if m:
            photo_file_for_id[int(m.group(1))] = f

    # --- load production category/brand slug -> id maps ---
    with open(args.prod_categories_json) as f:
        prod_cats_raw = json.load(f)['data']['result']['rows']
    prod_cat_slug_to_id = {r['slug']: r['id'] for r in prod_cats_raw}

    with open(args.prod_brands_json) as f:
        prod_brands_raw = json.load(f)['data']['result']['rows']
    prod_brand_slug_to_id = {r['slug']: r['id'] for r in prod_brands_raw}

    # sanity: confirm known collisions are really in production
    for slug in KNOWN_CATEGORY_SLUG_COLLISIONS:
        assert slug in prod_cat_slug_to_id, f'expected category collision {slug} not found in production!'
    for slug in KNOWN_BRAND_SLUG_COLLISIONS:
        assert slug in prod_brand_slug_to_id, f'expected brand collision {slug} not found in production!'
    prod_cat_ids = set(prod_cat_slug_to_id.values())
    prod_brand_ids = set(prod_brand_slug_to_id.values())
    for phase1a_id, prod_id in MANUAL_CATEGORY_ID_COLLISIONS.items():
        assert prod_id in prod_cat_ids, f'manual category collision target id={prod_id} not found in production!'
    for phase1a_id, prod_id in MANUAL_BRAND_ID_COLLISIONS.items():
        assert prod_id in prod_brand_ids, f'manual brand collision target id={prod_id} not found in production!'

    # --- category scope: import ALL 189 phase1a categories ---
    #
    # Per Pat's explicit decision (2026-09-19): the category hierarchy is a
    # PLATFORM TAXONOMY, not merely a reflection of which categories happen
    # to have a product in them today. Production already has this exact
    # precedent (e.g. "Fresh Fruits", "Vegetables", "Meat & Poultry" exist
    # today with 0 directly-attached products). So unlike brands/vendors
    # (which stay scoped to only what the 59 imported products actually
    # reference — Pat: "do not import unrelated brands belonging only to
    # the 68 products we're deliberately holding back"), categories import
    # the FULL phase1a set of 189 nodes, with the 14 verified collisions
    # (7 caught by slug-matching + 7 manual name/type overrides) correctly
    # reusing existing production rows instead of duplicating them.
    needed_cat_closure = sorted(categories.keys())

    # --- build category ID remap ---
    cat_remap = {}          # phase1a_id -> final_id (production id if reused, else new id)
    cat_is_new = {}         # phase1a_id -> bool (True if this is a genuinely new INSERT)
    next_cat_id = args.prod_max_category_id + 1
    # process in id order so parent remaps are always resolved before children
    for cid in needed_cat_closure:
        slug = strip_quotes(categories[cid]['slug'])
        if cid in MANUAL_CATEGORY_ID_COLLISIONS:
            # manually-reviewed semantic duplicate (different slug, same concept) —
            # takes priority over slug lookup
            cat_remap[cid] = MANUAL_CATEGORY_ID_COLLISIONS[cid]
            cat_is_new[cid] = False
        elif slug in prod_cat_slug_to_id:
            cat_remap[cid] = prod_cat_slug_to_id[slug]
            cat_is_new[cid] = False
        else:
            cat_remap[cid] = next_cat_id
            cat_is_new[cid] = True
            next_cat_id += 1

    # --- build brand ID remap ---
    needed_brand_ids = sorted(set(
        int(products[pid]['brand_id']) for pid in photo_ids
        if products[pid]['brand_id'] != 'NULL'
    ))
    brand_remap = {}
    brand_is_new = {}
    next_brand_id = args.prod_max_brand_id + 1
    for bid in needed_brand_ids:
        slug = strip_quotes(brands[bid]['slug'])
        if bid in MANUAL_BRAND_ID_COLLISIONS:
            brand_remap[bid] = MANUAL_BRAND_ID_COLLISIONS[bid]
            brand_is_new[bid] = False
        elif slug in prod_brand_slug_to_id:
            brand_remap[bid] = prod_brand_slug_to_id[slug]
            brand_is_new[bid] = False
        else:
            brand_remap[bid] = next_brand_id
            brand_is_new[bid] = True
            next_brand_id += 1

    # --- build vendor ID remap (vendor slugs confirmed 0 collisions; all new) ---
    needed_vendor_ids = sorted(set(
        int(listings[lid]['vendor_id']) for lid in listings
        if int(listings[lid]['product_id']) in photo_ids
    ))
    vendor_remap = {}
    next_vendor_id = args.prod_max_vendor_id + 1
    for vid in needed_vendor_ids:
        vendor_remap[vid] = next_vendor_id
        next_vendor_id += 1

    # --- build product ID remap (all 59 are net-new; slug collisions = 0, confirmed) ---
    product_remap = {}
    next_product_id = args.prod_max_product_id + 1
    for pid in photo_ids:
        product_remap[pid] = next_product_id
        next_product_id += 1

    # --- build listing ID remap ---
    needed_listing_ids = sorted(
        lid for lid, l in listings.items() if int(l['product_id']) in photo_ids
    )
    listing_remap = {}
    next_listing_id = args.prod_max_listing_id + 1
    for lid in needed_listing_ids:
        listing_remap[lid] = next_listing_id
        next_listing_id += 1

    # =========================================================
    # Emit SQL
    # =========================================================
    out = []
    out.append(f"""-- Migration 0068: Stage 1 Catalog Expansion (safe, additive remap)
--
-- Merges the 59 REAL-PHOTOGRAPHED products from the abandoned Phase 1a
-- taxonomy (scripts/seed/seed-phase1a-taxonomy-catalog.sql, never applied
-- to production) into the live catalog, alongside their full ancestor
-- category tree, needed brands, needed vendors, and listings.
--
-- SAFETY GUARANTEES (mechanically enforced by the generator that produced
-- this file, scripts/seed/build_stage1_expansion.py):
--   - The existing 44 products (IDs 1-{args.prod_max_product_id}), all 79
--     production categories, 30 brands, 21 vendors, and 80 listings are
--     NEVER referenced as targets of any INSERT below and are completely
--     untouched by this migration.
--   - Every new row uses a NEW ID computed as
--     (production MAX(id) at generation time) + offset — never a
--     phase1a ID directly, and never INSERT OR REPLACE / UPSERT.
--   - Of the 7 category slugs and 15 brand slugs that exist in BOTH
--     phase1a and production, this migration REUSES production's existing
--     row (by slug lookup) instead of creating a duplicate department/
--     brand. New products/categories reference the ORIGINAL production ID
--     for those, not a new one.
--   - Only products with verified real photography on disk
--     (public/static/products/{{id:03d}}-*.jpg, {len(photo_ids)} files) are
--     included. image_url is rewritten to the real file path; the seed
--     file's original /ph.svg placeholder is NEVER written to production.
--   - This migration inserts ZERO rows into product_country_origins.
--     Country-of-origin is a separate, explicitly human/Pat-approved
--     verification step (Phase B), not inferred from category names here.
--   - Idempotent: every INSERT targets a slug that does not yet exist in
--     production category/brand tables, and a phase1a source that has
--     never been applied before (this migration itself only runs once via
--     d1_migrations tracking, per this project's migration discipline).
--
-- Generated by: scripts/seed/build_stage1_expansion.py
-- Source: {args.seed}
-- Production baseline at generation time:
--   MAX(products.id)={args.prod_max_product_id}, MAX(categories.id)={args.prod_max_category_id},
--   MAX(brands.id)={args.prod_max_brand_id}, MAX(vendors.id)={args.prod_max_vendor_id},
--   MAX(product_listings.id)={args.prod_max_listing_id}

PRAGMA foreign_keys = OFF;

""")

    # --- new categories ---
    out.append("-- ============================================================\n")
    out.append(f"-- NEW CATEGORIES ({sum(1 for c in cat_is_new.values() if c)} net-new; "
               f"{sum(1 for c in cat_is_new.values() if not c)} reused from production by slug)\n")
    out.append("-- ============================================================\n")
    # Need to emit in an order where parent_id already exists (parents first).
    # Sort by phase1a level (categories dict has 'level' field).
    def cat_level(cid):
        lvl = categories[cid].get('level', 'NULL')
        return int(lvl) if lvl != 'NULL' else 0
    ordered_new_cats = sorted(
        [cid for cid in needed_cat_closure if cat_is_new[cid]],
        key=cat_level
    )
    for cid in ordered_new_cats:
        c = categories[cid]
        new_id = cat_remap[cid]
        slug = strip_quotes(c['slug'])
        name = strip_quotes(c['name'])
        icon = strip_quotes(c['icon'])
        sort_order = c['sort_order']
        parent_id_raw = c['parent_id']
        parent_final = 'NULL' if parent_id_raw == 'NULL' else str(cat_remap[int(parent_id_raw)])
        category_type = strip_quotes(c['category_type'])
        level = c['level']
        # path must be recomputed using final (remapped) ancestor ids
        def final_path(cid):
            chain = []
            cur = cid
            while True:
                chain.append(cat_remap[cur])
                p = categories[cur]['parent_id']
                if p == 'NULL':
                    break
                cur = int(p)
            return '/'.join(str(x) for x in reversed(chain))
        path = final_path(cid)
        country_iso = c['country_iso']  # left as-authored (categories may legitimately carry a
                                          # regional label like 'NG' for e.g. "Nigerian Fabrics" —
                                          # this is a category-level regional grouping, NOT a
                                          # per-product origin claim; product_country_origins is
                                          # the only table used for product-level provenance)
        out.append(
            f"INSERT INTO categories (id, slug, name, icon, sort_order, parent_id, category_type, level, path, country_iso) "
            f"SELECT {new_id}, {sql_str(slug)}, {sql_str(name)}, {sql_str(icon)}, {sort_order}, {parent_final}, "
            f"{sql_str(category_type)}, {level}, {sql_str(path)}, {country_iso} "
            f"WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug = {sql_str(slug)});\n"
        )

    # --- new brands ---
    out.append("\n-- ============================================================\n")
    out.append(f"-- NEW BRANDS ({sum(1 for b in brand_is_new.values() if b)} net-new; "
               f"{sum(1 for b in brand_is_new.values() if not b)} reused from production by slug)\n")
    out.append("-- ============================================================\n")
    for bid in needed_brand_ids:
        if not brand_is_new[bid]:
            continue
        b = brands[bid]
        new_id = brand_remap[bid]
        slug = strip_quotes(b['slug'])
        name = strip_quotes(b['name'])
        # logo_url in phase1a seed is a /ph.svg placeholder - do NOT carry it forward.
        # Leave NULL (no fabricated logo), matching the zero-placeholder rule.
        is_nigerian = b['is_nigerian']
        description = strip_quotes(b['description']) or ''
        is_featured = b['is_featured']
        display_order = b['display_order']
        status = strip_quotes(b['status'])
        out.append(
            f"INSERT INTO brands (id, slug, name, logo_url, is_nigerian, description, is_featured, display_order, status) "
            f"SELECT {new_id}, {sql_str(slug)}, {sql_str(name)}, NULL, {is_nigerian}, {sql_str(description)}, "
            f"0, {display_order}, {sql_str(status)} "
            f"WHERE NOT EXISTS (SELECT 1 FROM brands WHERE slug = {sql_str(slug)});\n"
        )

    # --- new vendors ---
    out.append("\n-- ============================================================\n")
    out.append(f"-- NEW VENDORS ({len(needed_vendor_ids)} net-new; 0 slug collisions confirmed)\n")
    out.append("-- ============================================================\n")
    for vid in needed_vendor_ids:
        v = vendors[vid]
        new_id = vendor_remap[vid]
        slug = strip_quotes(v['slug'])
        name = strip_quotes(v['name'])
        description = strip_quotes(v['description']) or ''
        city = strip_quotes(v['city'])
        is_verified = v['is_verified']
        rating_avg = v['rating_avg']
        rating_count = v['rating_count']
        positive_feedback_percent = v['positive_feedback_percent']
        state = strip_quotes(v['state'])
        response_time_hours = v['response_time_hours']
        joined_year = v['joined_year']
        country_iso = strip_quotes(v['country_iso'])
        store_type = strip_quotes(v['store_type'])
        verification_status = strip_quotes(v['verification_status'])
        store_status = strip_quotes(v['store_status'])
        # logo_url: phase1a value is a /ph.svg placeholder -> NULL (no fabricated logo)
        out.append(
            f"INSERT INTO vendors (id, slug, name, description, logo_url, city, is_verified, rating_avg, "
            f"rating_count, positive_feedback_percent, state, response_time_hours, joined_year, country_iso, "
            f"store_type, verification_status, store_status) "
            f"SELECT {new_id}, {sql_str(slug)}, {sql_str(name)}, {sql_str(description)}, NULL, {sql_str(city)}, "
            f"{is_verified}, {rating_avg}, {rating_count}, {positive_feedback_percent}, {sql_str(state)}, "
            f"{response_time_hours}, {joined_year}, {sql_str(country_iso)}, {sql_str(store_type)}, "
            f"{sql_str(verification_status)}, {sql_str(store_status)} "
            f"WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE slug = {sql_str(slug)});\n"
        )

    # --- new products (only the 59 with real photography) ---
    out.append("\n-- ============================================================\n")
    out.append(f"-- NEW PRODUCTS ({len(photo_ids)} verified-real-photography products)\n")
    out.append("-- ============================================================\n")
    for pid in photo_ids:
        p = products[pid]
        new_id = product_remap[pid]
        slug = strip_quotes(p['slug'])
        new_cat_id = cat_remap[int(p['category_id'])]
        brand_id_raw = p['brand_id']
        new_brand_id = 'NULL' if brand_id_raw == 'NULL' else str(brand_remap[int(brand_id_raw)])
        title = strip_quotes(p['title'])
        description = strip_quotes(p['description']) or ''
        long_description = strip_quotes(p['long_description']) or ''
        specs_json = strip_quotes(p['specs_json']) or '{}'
        whats_included_json = strip_quotes(p['whats_included_json']) or '[]'
        real_image = f"/static/products/{photo_file_for_id[pid]}"
        gallery_json = json.dumps([real_image])
        rating_avg = p['rating_avg']
        rating_count = p['rating_count']
        sales_count = p['sales_count']
        is_flash_deal = p['is_flash_deal']
        is_active = p['is_active']
        return_policy = strip_quotes(p['return_policy'])
        moderation_status = strip_quotes(p['moderation_status'])
        source_type = strip_quotes(p['source_type'])
        out.append(
            f"INSERT INTO products (id, slug, category_id, brand_id, title, description, long_description, "
            f"specs_json, whats_included_json, image_url, gallery_json, rating_avg, rating_count, sales_count, "
            f"is_flash_deal, is_active, return_policy, moderation_status, source_type) "
            f"SELECT {new_id}, {sql_str(slug)}, {new_cat_id}, {new_brand_id}, {sql_str(title)}, "
            f"{sql_str(description)}, {sql_str(long_description)}, {sql_str(specs_json)}, "
            f"{sql_str(whats_included_json)}, {sql_str(real_image)}, {sql_str(gallery_json)}, "
            f"{rating_avg}, {rating_count}, {sales_count}, {is_flash_deal}, {is_active}, "
            f"{sql_str(return_policy)}, {sql_str(moderation_status)}, {sql_str(source_type)} "
            f"WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug = {sql_str(slug)});\n"
        )

    # --- new product_listings ---
    out.append("\n-- ============================================================\n")
    out.append(f"-- NEW PRODUCT LISTINGS ({len(needed_listing_ids)} rows for the 59 new products)\n")
    out.append("-- ============================================================\n")
    for lid in needed_listing_ids:
        l = listings[lid]
        new_id = listing_remap[lid]
        new_product_id = product_remap[int(l['product_id'])]
        new_vendor_id = vendor_remap[int(l['vendor_id'])]
        price_kobo = l['price_kobo']
        compare_at_price_kobo = l['compare_at_price_kobo']
        stock = l['stock']
        condition = strip_quotes(l['condition'])
        delivery_days_min = l['delivery_days_min']
        delivery_days_max = l['delivery_days_max']
        warranty_months = l['warranty_months']
        is_plus = l['is_plus']
        is_primary = l['is_primary']
        is_active = l['is_active']
        moderation_status = strip_quotes(l['moderation_status'])
        sku = strip_quotes(l['sku'])
        source_type = strip_quotes(l['source_type'])
        out.append(
            f"INSERT INTO product_listings (id, product_id, vendor_id, price_kobo, compare_at_price_kobo, "
            f"stock, condition, delivery_days_min, delivery_days_max, warranty_months, is_plus, is_primary, "
            f"is_active, moderation_status, sku, source_type) "
            f"SELECT {new_id}, {new_product_id}, {new_vendor_id}, {price_kobo}, "
            f"{compare_at_price_kobo if compare_at_price_kobo != 'NULL' else 'NULL'}, {stock}, "
            f"{sql_str(condition)}, {delivery_days_min}, {delivery_days_max}, {warranty_months}, "
            f"{is_plus}, {is_primary}, {is_active}, {sql_str(moderation_status)}, {sql_str(sku)}, "
            f"{sql_str(source_type)} "
            f"WHERE NOT EXISTS (SELECT 1 FROM product_listings WHERE sku = {sql_str(sku)});\n"
        )

    out.append("\nPRAGMA foreign_keys = ON;\n")

    with open(args.out, 'w') as f:
        f.write(''.join(out))

    # --- print summary for verification ---
    print(f"Wrote {args.out}")
    print(f"  New categories: {sum(1 for c in cat_is_new.values() if c)} "
          f"(+ {sum(1 for c in cat_is_new.values() if not c)} reused)")
    print(f"  New brands: {sum(1 for c in brand_is_new.values() if c)} "
          f"(+ {sum(1 for c in brand_is_new.values() if not c)} reused)")
    print(f"  New vendors: {len(needed_vendor_ids)}")
    print(f"  New products: {len(photo_ids)}")
    print(f"  New listings: {len(needed_listing_ids)}")

    # dump remap tables for audit
    with open(args.out + '.remap.json', 'w') as f:
        json.dump({
            'category_remap': cat_remap,
            'brand_remap': brand_remap,
            'vendor_remap': vendor_remap,
            'product_remap': product_remap,
            'listing_remap': listing_remap,
        }, f, indent=2)
    print(f"  Remap audit trail: {args.out}.remap.json")


if __name__ == '__main__':
    main()
