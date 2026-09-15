#!/usr/bin/env python3
"""
Phase 1a seed generator, stage 2 — category_attributes, brands, seed vendors,
and the product/listing/variant catalog. Depends on scripts/seed/_categories.json
(written by generate_phase1a_seed.py) for category ids.

Run generate_phase1a_seed.py FIRST, then this script. Output is appended to
the SAME migrations/seed-phase1a-taxonomy-catalog.sql file this script opens
in append mode, so the two stages ship as one seed file.
"""
import json
import random

random.seed(20260915)

OUT_PATH = "/home/user/webapp/migrations/seed-phase1a-taxonomy-catalog.sql"

VENDOR_ID_START = 57       # existing max vendor id = 56 (all cctest fixtures)
BRAND_ID_START = 1         # brands table is currently empty
PRODUCT_ID_START = 1
LISTING_ID_START = 1
ATTR_ID_START = 1
ATTR_VALUE_ID_START = 1

categories = json.load(open("/home/user/webapp/scripts/seed/_categories.json"))
by_slug = {r["slug"]: r for r in categories}
by_id = {r["id"]: r for r in categories}


def esc(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def slugify(s):
    s = s.lower()
    for a, b in [("&", "and"), ("'", ""), (",", ""), ("/", "-"), (".", "")]:
        s = s.replace(a, b)
    return "-".join(s.split())


sql = []
sql.append("")
sql.append("-- ============================================================")
sql.append("-- PHASE 1A SEED, STAGE 2: category_attributes / brands / vendors / catalog")
sql.append("-- ============================================================")

# ======================================================================
# 2. CATEGORY ATTRIBUTES (real structured specs, existing table, no new engine)
# ======================================================================
attr_defs = []  # (category_slug, key, label, data_type, options|None, requirement, sort_order)


def add_attrs(cat_slug, specs):
    for i, (key, label, dtype, options, req) in enumerate(specs, start=1):
        attr_defs.append((cat_slug, key, label, dtype, options, req, i))


add_attrs("fashion", [
    ("size", "Size", "select", ["XS", "S", "M", "L", "XL", "XXL"], "required"),
    ("color", "Color", "text", None, "required"),
    ("material", "Material", "text", None, "optional"),
    ("gender", "Gender", "select", ["Men", "Women", "Unisex", "Kids"], "optional"),
    ("country_of_origin", "Country of Origin", "text", None, "optional"),
])
add_attrs("electronics", [
    ("ram_gb", "RAM (GB)", "number", None, "optional"),
    ("storage_gb", "Storage (GB)", "number", None, "optional"),
    ("screen_size", "Screen Size", "text", None, "optional"),
    ("processor", "Processor", "text", None, "optional"),
    ("warranty_months", "Warranty (Months)", "number", None, "optional"),
])
add_attrs("nigerian-fabrics", [
    ("fabric_type", "Fabric Type", "text", None, "required"),
    ("region", "Region", "text", None, "optional"),
    ("pattern", "Pattern", "text", None, "optional"),
    ("length_yards", "Length (Yards)", "number", None, "optional"),
    ("handmade", "Handmade", "boolean", None, "optional"),
])
add_attrs("kenyan-coffee", [
    ("origin", "Origin", "text", None, "required"),
    ("roast_level", "Roast Level", "select", ["Light", "Medium", "Dark"], "required"),
    ("bean_type", "Bean Type", "text", None, "optional"),
    ("processing_method", "Processing Method", "text", None, "optional"),
    ("weight_kg", "Weight (kg)", "number", None, "optional"),
    ("organic", "Organic", "boolean", None, "optional"),
])

attr_id = ATTR_ID_START
attr_id_by_key = {}  # (cat_slug, key) -> id
for cat_slug, key, label, dtype, options, req, sort in attr_defs:
    cat = by_slug[cat_slug]
    options_json = json.dumps(options) if options else None
    sql.append(
        "INSERT INTO category_attributes (id, category_id, key, label, data_type, options_json, requirement, sort_order) "
        f"VALUES ({attr_id}, {cat['id']}, {esc(key)}, {esc(label)}, {esc(dtype)}, {esc(options_json)}, {esc(req)}, {sort});"
    )
    attr_id_by_key[(cat_slug, key)] = attr_id
    attr_id += 1

print(f"Generated {len(attr_defs)} category_attributes rows")

# ======================================================================
# 3. BRANDS (real, recognizable — global + Nigerian-flagged)
# ======================================================================
brands = [
    ("Samsung", 0), ("Apple", 0), ("HP", 0), ("Tecno", 1), ("Infinix", 1),
    ("Oraimo", 1), ("Nike", 0), ("Adidas", 0), ("LG", 0), ("Hisense", 0),
    ("Philips", 0), ("Sony", 0), ("Dell", 0), ("Lenovo", 0), ("Xiaomi", 0),
    ("Itel", 1), ("Zinox", 1), ("Davido Fashion House", 1), ("Ashluxe", 1),
    ("Zaron Cosmetics", 1), ("House of Tara", 1), ("Nivea", 0), ("Dettol", 0),
    ("Kellogg's", 0), ("Nestle", 0), ("Indomie", 1), ("Dangote", 1),
    ("Golden Penny", 1), ("Peak Milk", 1), ("Kilimanjaro Coffee", 0),
    ("Java House", 0), ("Woolworths", 0), ("Adire Oodua Textiles", 1),
    ("Fatiya Textiles", 1), ("Kentex Ghana", 0), ("Maasai Market Collective", 0),
    ("Marrakech Leatherworks", 0), ("Generic", 0),
]
brand_id_by_slug = {}
bid = BRAND_ID_START
for name, is_nigerian in brands:
    slug = slugify(name)
    logo_url = f"/ph.svg?label={name.replace(' ', '+')}&cat=electronics&w=200&h=200"
    sql.append(
        "INSERT INTO brands (id, slug, name, logo_url, is_nigerian, description, is_featured, display_order, status) "
        f"VALUES ({bid}, {esc(slug)}, {esc(name)}, {esc(logo_url)}, {is_nigerian}, {esc('')}, "
        f"{1 if bid <= 12 else 0}, {bid}, 'active');"
    )
    brand_id_by_slug[slug] = bid
    bid += 1

print(f"Generated {len(brands)} brand rows")

# ======================================================================
# 4. SEED VENDORS (NEW rows — never touching the 32 cctest-* RBAC fixtures)
# ======================================================================
vendors = [
    ("Lagos Tech Hub", "Lagos", "Lagos", "NG"),
    ("Naija Gadget Store", "Lagos", "Lagos", "NG"),
    ("Abuja Electronics Mart", "Abuja", "FCT", "NG"),
    ("PortHarcourt Phones & More", "Port Harcourt", "Rivers", "NG"),
    ("Kano Fabric Traders", "Kano", "Kano", "NG"),
    ("Ariya Ankara House", "Lagos", "Lagos", "NG"),
    ("Oyo Adire Collective", "Ibadan", "Oyo", "NG"),
    ("Aso Oke Heritage Weavers", "Iseyin", "Oyo", "NG"),
    ("Mama's Kitchen Grocers", "Lagos", "Lagos", "NG"),
    ("Naija Fresh Market", "Lagos", "Lagos", "NG"),
    ("Zaron Beauty Nigeria", "Lagos", "Lagos", "NG"),
    ("Enugu Home & Living", "Enugu", "Enugu", "NG"),
    ("Kumasi Kente Weavers", "Kumasi", "Ashanti", "GH"),
    ("Accra Shea Collective", "Accra", "Greater Accra", "GH"),
    ("Nairobi Coffee Exporters", "Nairobi", "Nairobi", "KE"),
    ("Maasai Craft Cooperative", "Narok", "Narok", "KE"),
    ("Marrakech Leather & Rugs", "Marrakech", "Marrakech-Safi", "MA"),
    ("Fez Ceramics House", "Fez", "Fes-Meknes", "MA"),
]
vendor_id_by_name = {}
vid = VENDOR_ID_START
for name, city, state, country in vendors:
    slug = slugify(name)
    logo_url = f"/ph.svg?label={name.replace(' ', '+')}&cat=electronics&w=150&h=150"
    sql.append(
        "INSERT INTO vendors (id, slug, name, description, logo_url, city, is_verified, rating_avg, rating_count, "
        "positive_feedback_percent, state, response_time_hours, joined_year, country_iso, store_type, verification_status, store_status) "
        f"VALUES ({vid}, {esc(slug)}, {esc(name)}, {esc(f'{name} — verified NaijaShop seed marketplace seller.')}, {esc(logo_url)}, "
        f"{esc(city)}, 1, {round(random.uniform(4.2, 4.9), 1)}, {random.randint(20, 900)}, "
        f"{round(random.uniform(90, 99), 1)}, {esc(state)}, {random.choice([4, 8, 12, 24])}, "
        f"{random.choice([2019, 2020, 2021, 2022, 2023])}, {esc(country)}, 'business', 'verified', 'active');"
    )
    vendor_id_by_name[name] = vid
    vid += 1

print(f"Generated {len(vendors)} vendor rows")

with open(OUT_PATH, "a") as f:
    f.write("\n".join(sql) + "\n")

# Persist stage-2 lookups for the products generator
json.dump({
    "attr_id_by_key": {f"{k[0]}||{k[1]}": v for k, v in attr_id_by_key.items()},
    "brand_id_by_slug": brand_id_by_slug,
    "vendor_id_by_name": vendor_id_by_name,
}, open("/home/user/webapp/scripts/seed/_stage2.json", "w"))

print(f"Appended stage-2 SQL to {OUT_PATH}")
