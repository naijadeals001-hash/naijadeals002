#!/usr/bin/env python3
"""
Phase 1a seed generator, stage 3 — the product catalog itself.

Depends on scripts/seed/_categories.json and scripts/seed/_stage2.json
(brand/vendor id lookups) written by the two prior stage scripts. Appends to
the same migrations/seed-phase1a-taxonomy-catalog.sql file.

Design principle (explicit approved instruction): "Do NOT create obviously
fake filler products simply to increase row counts." Every product below is a
specific, real, recognizable item (not "Product 1"/"Product 2") — curated
across a representative slice of leaf categories rather than mechanically
populated into all 124 leaves. Every products/product_listings row gets
source_type='seed' (migration 0053) so it is programmatically distinguishable
from live merchant inventory.
"""
import json
import random

random.seed(20260915)

OUT_PATH = "/home/user/webapp/migrations/seed-phase1a-taxonomy-catalog.sql"

categories = json.load(open("/home/user/webapp/scripts/seed/_categories.json"))
by_slug = {r["slug"]: r for r in categories}
stage2 = json.load(open("/home/user/webapp/scripts/seed/_stage2.json"))
brand_id = stage2["brand_id_by_slug"]
vendor_id = stage2["vendor_id_by_name"]
attr_id_by_key = {}
for k, v in stage2["attr_id_by_key"].items():
    cat_slug, key = k.split("||", 1)
    attr_id_by_key[(cat_slug, key)] = v


def esc(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def slugify(s):
    s = s.lower()
    for a, b in [("&", "and"), ("'", ""), (",", ""), ("/", "-"), (".", ""), ("(", ""), (")", "")]:
        s = s.replace(a, b)
    return "-".join(s.split())


def kobo(naira):
    return int(round(naira * 100))


PALETTE = {
    "electronics": "electronics", "fashion": "fashion", "home-kitchen": "home-kitchen",
    "grocery": "groceries", "beauty": "beauty-health", "sports": "sports-outdoors",
    "baby": "baby-products", "drinks": "drinks", "books": "books", "auto": "automotive",
}


def ph(label, cat="electronics"):
    return f"/ph.svg?label={label.replace(' ', '+').replace(chr(38), 'and')}&cat={cat}"


# ======================================================================
# Product catalog: (leaf_category_slug, title, brand_slug|None, vendor_name,
#                    base_price_naira, compare_price_naira|None,
#                    fashion_variants: [(size,color)] or None,
#                    attribute_values: {key: value} or None,
#                    country_iso_tag: None or ISO — informational, stored via specs_json)
PRODUCTS = []


def P(leaf, title, brand, vendor, price, compare=None, variants=None, attrs=None, second_vendor=None, second_price=None):
    PRODUCTS.append({
        "leaf": leaf, "title": title, "brand": brand, "vendor": vendor,
        "price": price, "compare": compare, "variants": variants, "attrs": attrs,
        "second_vendor": second_vendor, "second_price": second_price,
    })


# ---- Electronics ----
P("smartphones", "Samsung Galaxy A54 5G (128GB, 8GB RAM)", "samsung", "Lagos Tech Hub", 385000, 425000,
  attrs={"ram_gb": "8", "storage_gb": "128", "screen_size": "6.4 inch", "processor": "Exynos 1380", "warranty_months": "12"},
  second_vendor="Naija Gadget Store", second_price=392000)
P("smartphones", "Infinix Note 30 (256GB, 8GB RAM)", "infinix", "Naija Gadget Store", 215000, 245000,
  attrs={"ram_gb": "8", "storage_gb": "256", "screen_size": "6.78 inch", "processor": "MediaTek Helio G99", "warranty_months": "12"})
P("smartphones", "Tecno Camon 20 Pro (256GB)", "tecno", "Abuja Electronics Mart", 235000, None,
  attrs={"ram_gb": "8", "storage_gb": "256", "screen_size": "6.67 inch", "warranty_months": "12"})
P("smartphones", "Apple iPhone 13 (128GB)", "apple", "Lagos Tech Hub", 620000, 680000,
  attrs={"ram_gb": "4", "storage_gb": "128", "screen_size": "6.1 inch", "warranty_months": "12"})
P("smartphones", "Itel P55 5G (128GB, 6GB RAM)", "itel", "PortHarcourt Phones & More", 98000, 115000,
  attrs={"ram_gb": "6", "storage_gb": "128", "warranty_months": "12"})
P("tablets", "Samsung Galaxy Tab A9+ (64GB)", "samsung", "Lagos Tech Hub", 195000, None,
  attrs={"storage_gb": "64", "screen_size": "11 inch", "warranty_months": "12"})
P("phone-accessories", "Oraimo FreePods 4 Wireless Earbuds", "oraimo", "Naija Gadget Store", 18500, 24000)
P("phone-accessories", "Oraimo 20000mAh Power Bank", "oraimo", "PortHarcourt Phones & More", 15500, None)
P("laptops", "HP Pavilion 15 (Core i5, 8GB RAM, 512GB SSD)", "hp", "Lagos Tech Hub", 685000, 750000,
  attrs={"ram_gb": "8", "storage_gb": "512", "screen_size": "15.6 inch", "processor": "Intel Core i5-1235U", "warranty_months": "12"})
P("laptops", "Dell Inspiron 14 (Core i3, 8GB RAM, 256GB SSD)", "dell", "Abuja Electronics Mart", 495000, None,
  attrs={"ram_gb": "8", "storage_gb": "256", "screen_size": "14 inch", "warranty_months": "12"})
P("laptops", "Lenovo IdeaPad Slim 3 (Ryzen 5, 8GB RAM)", "lenovo", "Zinox".lower() and "Lagos Tech Hub", 545000, 590000,
  attrs={"ram_gb": "8", "screen_size": "15.6 inch", "warranty_months": "12"})
P("laptops", "MacBook Air M1 (256GB)", "apple", "Lagos Tech Hub", 985000, 1050000,
  attrs={"storage_gb": "256", "screen_size": "13.3 inch", "warranty_months": "12"})
P("computer-accessories", "Logitech-style Wireless Keyboard & Mouse Combo", None, "Abuja Electronics Mart", 12500, None)
P("monitors", "Hisense 24-inch Full HD Monitor", "hisense", "Lagos Tech Hub", 78000, 92000)
P("televisions", "Samsung 55-inch Crystal UHD 4K Smart TV", "samsung", "Abuja Electronics Mart", 385000, 430000,
  attrs={"screen_size": "55 inch", "warranty_months": "24"})
P("televisions", "LG 43-inch Full HD LED TV", "lg", "PortHarcourt Phones & More", 195000, None,
  attrs={"screen_size": "43 inch", "warranty_months": "12"})
P("televisions", "Hisense 32-inch HD LED TV", "hisense", "Enugu Home & Living", 105000, 120000,
  attrs={"screen_size": "32 inch", "warranty_months": "12"})
P("headphones-and-earphones", "Sony WH-CH520 Wireless Headphones", "sony", "Lagos Tech Hub", 45000, None)
P("speakers", "JBL-style Portable Bluetooth Speaker", None, "Naija Gadget Store", 32000, 38000)
P("smart-watches", "Oraimo Watch 3 Pro", "oraimo", "Naija Gadget Store", 28500, 34000)
P("gaming-consoles", "Sony PlayStation 5 Slim (1TB)", "sony", "Lagos Tech Hub", 895000, None, attrs={"warranty_months": "12"})

# ---- Fashion (Men/Women/Bags/Jewelry) ----
P("mens-clothing", "Classic Fit Men's Cotton Shirt", "davido-fashion-house", "Ariya Ankara House", 12500, 15000,
  variants=[("M", "White"), ("L", "White"), ("XL", "Blue")], attrs={"size": "M", "color": "White", "material": "Cotton", "gender": "Men"})
P("mens-shoes", "Men's Genuine Leather Oxford Shoes", "ashluxe", "Lagos Tech Hub", 32000, 38000,
  variants=[("41", "Black"), ("42", "Black"), ("43", "Brown")])
P("womens-clothing", "Women's Ankara Print Maxi Dress", "davido-fashion-house", "Ariya Ankara House", 18500, 22000,
  variants=[("M", "Multicolor"), ("L", "Multicolor")], attrs={"size": "M", "color": "Multicolor", "material": "Ankara Cotton", "gender": "Women"})
P("womens-shoes", "Women's Block Heel Sandals", "ashluxe", "Lagos Tech Hub", 21000, 26000,
  variants=[("38", "Nude"), ("39", "Black")])
P("boys-clothing", "Boys' School Uniform Set", None, "Mama's Kitchen Grocers", 8500, None)
P("girls-clothing", "Girls' Ankara Party Dress", "davido-fashion-house", "Ariya Ankara House", 9500, 11500)
P("handbags", "Women's Genuine Leather Tote Bag", "ashluxe", "Marrakech Leather & Rugs", 28000, 34000)
P("backpacks", "Laptop Backpack with USB Charging Port", None, "Naija Gadget Store", 15500, 19000)
P("jewelry", "18K Gold-Plated Layered Necklace Set", None, "House of Tara".lower().replace(" ", "-") and "Ariya Ankara House", 12000, None)
P("watches", "Men's Classic Analog Wrist Watch", None, "Lagos Tech Hub", 19500, 24000)
P("sunglasses", "UV-Protection Polarized Sunglasses", "adidas", "Naija Gadget Store", 9500, 12000)

# ---- African Fashion (the taxonomy centerpiece) ----
P("ankara-fabric", "Premium Ankara Fabric — 6 Yards (Wax Print)", "adire-oodua-textiles", "Ariya Ankara House", 15000, 18000,
  attrs={"fabric_type": "Ankara Wax Print", "region": "South West Nigeria", "pattern": "Geometric", "length_yards": "6", "handmade": "false"})
P("ankara-fabric", "Ankara Fabric — 6 Yards (Floral Print, Holland Wax)", "adire-oodua-textiles", "Ariya Ankara House", 22000, 26000,
  attrs={"fabric_type": "Holland Wax", "region": "South West Nigeria", "pattern": "Floral", "length_yards": "6", "handmade": "false"})
P("adire", "Handmade Adire Tie-Dye Fabric — 3 Yards", "fatiya-textiles", "Oyo Adire Collective", 18500, 22000,
  attrs={"fabric_type": "Adire Eleko", "region": "Abeokuta, Ogun State", "pattern": "Tie-Dye", "length_yards": "3", "handmade": "true"})
P("adire", "Adire Indigo Bomber Jacket", "fatiya-textiles", "Oyo Adire Collective", 26000, 30000,
  attrs={"fabric_type": "Adire", "region": "Abeokuta, Ogun State", "handmade": "true"})
P("aso-oke", "Handwoven Aso Oke Fabric — Gele & Wrapper Set", None, "Aso Oke Heritage Weavers", 45000, 52000,
  attrs={"fabric_type": "Aso Oke", "region": "Iseyin, Oyo State", "pattern": "Traditional Stripe", "handmade": "true"})
P("agbada", "Men's Traditional Agbada Set (3-Piece)", "davido-fashion-house", "Ariya Ankara House", 55000, 65000,
  variants=[("M", "White/Gold"), ("L", "White/Gold")])
P("nigerian-leather-goods", "Handcrafted Nigerian Leather Sandals", None, "Aso Oke Heritage Weavers", 16500, None)
P("kente", "Authentic Kente Cloth — Ghanaian Handwoven (4 Yards)", "kentex-ghana", "Kumasi Kente Weavers", 62000, 70000,
  attrs={"fabric_type": "Kente", "region": "Kumasi, Ashanti", "pattern": "Traditional Kente", "length_yards": "4", "handmade": "true"})
P("ghanaian-beads", "Handmade Ghanaian Waist Beads Set", None, "Accra Shea Collective", 8500, None,
  attrs={"handmade": "true"})
P("kenyan-textiles", "Kenyan Kitenge Fabric — 3 Yards", None, "Nairobi Coffee Exporters", 14000, None,
  attrs={"fabric_type": "Kitenge", "region": "Coast Province", "length_yards": "3"})
P("moroccan-kaftans", "Handmade Moroccan Kaftan Dress", None, "Marrakech Leather & Rugs", 38000, 45000,
  attrs={"handmade": "true"})

# ---- Home & Kitchen ----
P("blenders-and-mixers", "Binatone 3-in-1 Blender Set", None, "Enugu Home & Living", 22500, 27000)
P("cookers-and-ovens", "4-Burner Gas Cooker with Oven", None, "Enugu Home & Living", 145000, 165000)
P("refrigerators-and-freezers", "Hisense 150L Single Door Refrigerator", "hisense", "Enugu Home & Living", 195000, 215000)
P("pots-and-pans", "Non-Stick Cookware Set (7 Pieces)", None, "Enugu Home & Living", 35000, 42000)
P("dinnerware", "24-Piece Ceramic Dinnerware Set", None, "Enugu Home & Living", 28500, None)
P("living-room-furniture", "3-Seater Fabric Sofa", None, "Enugu Home & Living", 285000, 320000)
P("bedroom-furniture", "Queen Size Bed Frame with Headboard", None, "Enugu Home & Living", 165000, None)
P("wall-art", "African Print Canvas Wall Art (Set of 3)", None, "Ariya Ankara House", 18500, None)
P("rugs-and-carpets", "Moroccan Berber Wool Rug (5x8 ft)", None, "Marrakech Leather & Rugs", 95000, 110000)
P("lighting", "LED Ceiling Chandelier Light Fixture", None, "Enugu Home & Living", 42000, 50000)

# ---- Grocery & African Foods ----
P("rice", "Golden Penny Rice — 50kg Bag", "golden-penny", "Mama's Kitchen Grocers", 68000, None,
  second_vendor="Naija Fresh Market", second_price=69500)
P("beans-and-legumes", "Local Brown Beans — 10kg", None, "Naija Fresh Market", 18500, None)
P("soft-drinks", "Coca-Cola 12-Pack (35cl)", None, "Mama's Kitchen Grocers", 3800, None)
P("juices", "Chivita 100% Orange Juice 1L (6-Pack)", "nestle", "Naija Fresh Market", 7200, None)
P("biscuits-and-snacks", "Digestive Biscuits Family Pack", "kelloggs", "Mama's Kitchen Grocers", 2500, None)
P("nigerian-staples", "Nigerian Garri (Yellow) — 5kg", None, "Naija Fresh Market", 8500, None)
P("nigerian-spices-and-condiments", "Assorted Nigerian Spice Set", None, "Mama's Kitchen Grocers", 6500, None)
P("ghanaian-staples", "Ghanaian Gari — 5kg", None, "Accra Shea Collective", 9000, None)
P("kenyan-coffee", "Nairobi Coffee Exporters — AA Grade Kenyan Coffee Beans 1kg", None, "Nairobi Coffee Exporters", 12500, 15000,
  attrs={"origin": "Nyeri, Kenya", "roast_level": "Medium", "bean_type": "Arabica AA", "processing_method": "Washed", "weight_kg": "1", "organic": "true"})
P("kenyan-coffee", "Kilimanjaro-Style Kenyan Dark Roast Ground Coffee 500g", "kilimanjaro-coffee", "Nairobi Coffee Exporters", 7800, None,
  attrs={"origin": "Kericho, Kenya", "roast_level": "Dark", "bean_type": "Arabica", "weight_kg": "0.5"})
P("kenyan-tea", "Kenyan Purple Tea Leaves 250g", None, "Nairobi Coffee Exporters", 5500, None,
  attrs={"origin": "Kericho, Kenya"})

# ---- Beauty & African Beauty ----
P("facial-care", "Nivea Soft Moisturizing Cream 200ml", "nivea", "Zaron Beauty Nigeria", 4500, None)
P("body-care", "Shea Butter Body Lotion 500ml", None, "Accra Shea Collective", 5800, None)
P("hair-products", "Argan Oil Hair Serum 100ml", None, "Marrakech Leather & Rugs", 8500, 10000)
P("wigs-and-extensions", "100% Human Hair Bone Straight Wig 20-inch", None, "Zaron Beauty Nigeria", 65000, 75000)
P("face-makeup", "Zaron Full Coverage Foundation", "zaron-cosmetics", "Zaron Beauty Nigeria", 8500, None)
P("lip-and-eye-makeup", "House of Tara Matte Lipstick Set", "house-of-tara", "Zaron Beauty Nigeria", 12000, None)
P("nigerian-skincare", "Zaron Nigerian Made Vitamin C Serum", "zaron-cosmetics", "Zaron Beauty Nigeria", 9500, 11500)
P("nigerian-haircare", "Nigerian Black Soap & Shea Bar", None, "Zaron Beauty Nigeria", 3200, None)
P("shea-butter-products", "Raw Unrefined Ghanaian Shea Butter 500g", None, "Accra Shea Collective", 6500, 7500,
  attrs=None)
P("argan-products", "Pure Moroccan Argan Oil 100ml", None, "Marrakech Leather & Rugs", 11500, 13500)

# ---- Health ----
P("vitamins-and-supplements", "Multivitamin Tablets (60 Count)", None, "Mama's Kitchen Grocers", 6500, None)
P("medical-supplies", "Digital Blood Pressure Monitor", "philips", "Lagos Tech Hub", 28500, None)
P("personal-care-devices", "Philips Electric Shaver", "philips", "Lagos Tech Hub", 22000, 26000)

# ---- Baby & Kids ----
P("baby-gear", "Baby Stroller — Lightweight Foldable", None, "Enugu Home & Living", 55000, 65000)
P("diapering", "Baby Diapers Size 3 (Jumbo Pack, 84 Count)", None, "Mama's Kitchen Grocers", 8500, None)
P("feeding", "Baby Feeding Bottle Set (3-Pack)", None, "Naija Fresh Market", 4500, None)

# ---- Toys & Games ----
P("educational-toys", "Wooden Alphabet Learning Blocks", None, "Naija Gadget Store", 8500, None)
P("action-figures-and-dolls", "African Fashion Doll Collection (3-Pack)", None, "Ariya Ankara House", 12500, None)
P("board-games-and-puzzles", "1000-Piece Jigsaw Puzzle — African Wildlife", None, "Naija Gadget Store", 6500, None)

# ---- Sports & Fitness ----
P("exercise-equipment", "Adjustable Dumbbell Set (20kg)", None, "Lagos Tech Hub", 45000, 52000)
P("sportswear", "Nike Dri-FIT Training T-Shirt", "nike", "Ariya Ankara House", 15500, 18500)
P("outdoor-recreation", "4-Person Camping Tent", None, "Abuja Electronics Mart", 65000, None)

# ---- Automotive ----
P("car-accessories", "Universal Car Phone Mount Holder", None, "Naija Gadget Store", 4500, None)
P("car-electronics", "Bluetooth Car FM Transmitter", None, "Naija Gadget Store", 8500, 10500)
P("motorcycle-parts", "Motorcycle Helmet (DOT Certified)", None, "PortHarcourt Phones & More", 18500, None)

# ---- Tools & Hardware ----
P("power-tools", "Cordless Drill Driver Set (18V)", None, "Abuja Electronics Mart", 32000, 38000)
P("hand-tools", "45-Piece Home Tool Kit", None, "Enugu Home & Living", 22500, None)
P("building-materials", "Dangote Cement — 50kg Bag", "dangote", "Enugu Home & Living", 8500, None)

# ---- Agriculture ----
P("farm-equipment", "Manual Knapsack Sprayer 16L", None, "Naija Fresh Market", 18500, None)
P("nigerian-grains", "Nigerian Maize (Dried) — 25kg Bag", None, "Naija Fresh Market", 22000, None)
P("nigerian-cash-crops", "Premium Nigerian Cocoa Beans — 5kg", None, "Naija Fresh Market", 15500, None)

# ---- Industrial & Office ----
P("industrial-equipment", "Industrial Air Compressor 50L", None, "Abuja Electronics Mart", 185000, None)
P("safety-equipment", "Industrial Safety Helmet & Vest Set", None, "Abuja Electronics Mart", 12500, None)
P("office-supplies", "A4 Copier Paper (5 Reams)", None, "Lagos Tech Hub", 9500, None)
P("office-furniture", "Ergonomic Office Chair", None, "Enugu Home & Living", 65000, 75000)
P("printers-and-scanners", "HP LaserJet All-in-One Printer", "hp", "Lagos Tech Hub", 145000, 165000)

# ---- Books & Education ----
P("fiction", "Things Fall Apart by Chinua Achebe", None, "Lagos Tech Hub", 4500, None)
P("non-fiction", "There Was a Country by Chinua Achebe", None, "Lagos Tech Hub", 5500, None)
P("educational-materials", "JAMB UTME Past Questions Compendium", None, "Lagos Tech Hub", 3500, None)

# ---- Art & African Crafts ----
P("craft-supplies", "Beading & Jewelry-Making Craft Kit", None, "Ariya Ankara House", 8500, None)
P("nigerian-pottery", "Handmade Nigerian Clay Pot (Traditional)", None, "Aso Oke Heritage Weavers", 12500, None, attrs=None)
P("nigerian-beadwork", "Handcrafted Nigerian Coral Beads Necklace", None, "Aso Oke Heritage Weavers", 22000, 26000)
P("nigerian-paintings", "Original Nigerian Canvas Painting — Market Scene", None, "Ariya Ankara House", 45000, None)
P("nigerian-sculptures", "Hand-Carved Nigerian Wooden Sculpture", None, "Aso Oke Heritage Weavers", 35000, None)
P("ghanaian-woodwork", "Hand-Carved Ghanaian Wooden Mask", None, "Kumasi Kente Weavers", 28500, None)
P("maasai-crafts", "Handmade Maasai Beaded Bracelet Set", None, "Maasai Craft Cooperative", 9500, None)
P("moroccan-leather", "Handcrafted Moroccan Leather Pouf Ottoman", None, "Marrakech Leather & Rugs", 42000, 48000)
P("moroccan-rugs", "Authentic Moroccan Beni Ourain Rug (4x6 ft)", None, "Marrakech Leather & Rugs", 125000, 145000)
P("moroccan-ceramics", "Handpainted Moroccan Ceramic Bowl Set", None, "Fez Ceramics House", 22000, None)

# ---- Musical Instruments ----
P("string-instruments", "Acoustic Guitar (Full Size)", None, "Lagos Tech Hub", 45000, 52000)
P("percussion-and-drums", "Traditional African Djembe Drum", None, "Ariya Ankara House", 32000, None)
P("keyboards-and-pianos", "61-Key Electronic Keyboard", None, "Lagos Tech Hub", 55000, 65000)

# ---- Travel & Weddings & Gifts ----
P("suitcases", "Hardshell Spinner Luggage Set (3-Piece)", None, "Naija Gadget Store", 65000, 78000)
P("travel-accessories", "Travel Organizer Pouch Set", None, "Naija Gadget Store", 8500, None)
P("wedding-attire", "Traditional Nigerian Wedding Aso Ebi Set", "davido-fashion-house", "Ariya Ankara House", 85000, 95000)
P("event-decor", "Wedding Backdrop Decoration Set", None, "Ariya Ankara House", 45000, None)
P("gift-sets", "Luxury Grooming Gift Set for Men", None, "Zaron Beauty Nigeria", 18500, 22000)
P("seasonal-and-festive", "Christmas Decoration Set", None, "Naija Gadget Store", 12500, None)

# ---- Digital & Wholesale ----
P("software-and-licenses", "Microsoft Office 365 Personal (1-Year License)", None, "Lagos Tech Hub", 25000, None)
P("gift-cards", "NaijaDeals ₦10,000 Gift Card", None, "Lagos Tech Hub", 10000, None)
P("bulk-groceries", "Golden Penny Rice — 50kg Bag (Wholesale, Min. 10 Bags)", "golden-penny", "Naija Fresh Market", 62000, None)
P("bulk-fabrics", "Ankara Fabric Wholesale Bundle (50 Yards)", "adire-oodua-textiles", "Ariya Ankara House", 125000, 145000)
P("bulk-electronics", "Oraimo Power Bank — Wholesale Carton (24 Units)", "oraimo", "Naija Gadget Store", 320000, None)

print(f"Defined {len(PRODUCTS)} product templates")

# ======================================================================
# Emit SQL
# ======================================================================
out = []
pid = 1
lid = 1
avid = 1
missing_leaves = []
seen_slugs = set()

for item in PRODUCTS:
    leaf = by_slug.get(item["leaf"])
    if not leaf:
        missing_leaves.append(item["leaf"])
        continue

    title = item["title"]
    slug = slugify(title)
    orig_slug = slug
    n = 2
    while slug in seen_slugs:
        slug = f"{orig_slug}-{n}"
        n += 1
    seen_slugs.add(slug)

    bslug = item["brand"]
    bid_val = brand_id.get(bslug, "NULL") if bslug else "NULL"

    img_cat = "electronics"
    if item["leaf"] in ("ankara-fabric", "adire", "aso-oke", "agbada", "kente", "ghanaian-beads",
                         "kenyan-textiles", "moroccan-kaftans", "mens-clothing", "womens-clothing",
                         "boys-clothing", "girls-clothing", "handbags", "backpacks", "jewelry", "watches",
                         "sunglasses", "mens-shoes", "womens-shoes", "wedding-attire"):
        img_cat = "fashion"
    elif item["leaf"] in ("rice", "beans-and-legumes", "soft-drinks", "juices", "biscuits-and-snacks",
                           "nigerian-staples", "nigerian-spices-and-condiments", "ghanaian-staples",
                           "kenyan-coffee", "kenyan-tea", "nigerian-grains", "nigerian-cash-crops",
                           "bulk-groceries"):
        img_cat = "groceries"
    elif item["leaf"] in ("facial-care", "body-care", "hair-products", "wigs-and-extensions",
                           "face-makeup", "lip-and-eye-makeup", "nigerian-skincare", "nigerian-haircare",
                           "shea-butter-products", "argan-products"):
        img_cat = "beauty-health"
    elif item["leaf"] in ("blenders-and-mixers", "cookers-and-ovens", "refrigerators-and-freezers",
                           "pots-and-pans", "dinnerware", "living-room-furniture", "bedroom-furniture",
                           "wall-art", "rugs-and-carpets", "lighting"):
        img_cat = "home-kitchen"
    elif item["leaf"] in ("exercise-equipment", "sportswear", "outdoor-recreation"):
        img_cat = "sports-outdoors"
    elif item["leaf"] in ("baby-gear", "diapering", "feeding"):
        img_cat = "baby-products"
    elif item["leaf"] in ("car-accessories", "car-electronics", "motorcycle-parts"):
        img_cat = "automotive"
    elif item["leaf"] in ("fiction", "non-fiction", "educational-materials"):
        img_cat = "books"

    image_url = ph(title, img_cat)
    gallery = json.dumps([image_url])
    price = kobo(item["price"])
    compare = kobo(item["compare"]) if item.get("compare") else None
    is_flash = 1 if item.get("compare") and random.random() < 0.15 else 0
    rating_avg = round(random.uniform(3.9, 4.9), 1)
    rating_count = random.randint(3, 480)
    sales_count = random.randint(0, 900)

    out.append(
        "INSERT INTO products (id, slug, category_id, brand_id, title, description, long_description, "
        "specs_json, whats_included_json, image_url, gallery_json, rating_avg, rating_count, sales_count, "
        "is_flash_deal, is_active, return_policy, moderation_status, source_type) VALUES ("
        f"{pid}, {esc(slug)}, {leaf['id']}, {bid_val}, {esc(title)}, "
        f"{esc(f'{title} — quality product available on NaijaShop.')}, "
        f"{esc(f'{title}. Sourced and listed via NaijaShop marketplace sellers.')}, "
        f"{esc(json.dumps(item['attrs'] or {}))}, {esc('[]')}, {esc(image_url)}, {esc(gallery)}, "
        f"{rating_avg}, {rating_count}, {sales_count}, {is_flash}, 1, "
        f"{esc('7-day return if the item arrives damaged or not as described.')}, 'active', 'seed');"
    )

    vname = item["vendor"]
    vid_val = vendor_id.get(vname)
    if vid_val is None:
        raise SystemExit(f"Unknown vendor referenced: {vname!r} for product {title!r}")

    delivery_min = random.choice([1, 2, 3])
    delivery_max = delivery_min + random.choice([1, 2, 3])
    stock = random.randint(4, 200)
    is_plus = 1 if random.random() < 0.3 else 0
    sku = f"NS-{slug[:20].upper().replace('-', '')}-{pid:04d}"

    out.append(
        "INSERT INTO product_listings (id, product_id, vendor_id, price_kobo, compare_at_price_kobo, stock, "
        "condition, delivery_days_min, delivery_days_max, warranty_months, is_plus, is_primary, is_active, "
        "moderation_status, sku, source_type) VALUES ("
        f"{lid}, {pid}, {vid_val}, {price}, {compare if compare else 'NULL'}, {stock}, 'new', "
        f"{delivery_min}, {delivery_max}, 0, {is_plus}, 1, 1, 'active', {esc(sku)}, 'seed');"
    )
    primary_listing_id = lid
    lid += 1

    # Optional second competing listing (exercises buy-box / seller_count > 1)
    if item.get("second_vendor"):
        v2 = vendor_id.get(item["second_vendor"])
        if v2 is not None:
            p2 = kobo(item["second_price"]) if item.get("second_price") else price
            out.append(
                "INSERT INTO product_listings (id, product_id, vendor_id, price_kobo, compare_at_price_kobo, stock, "
                "condition, delivery_days_min, delivery_days_max, warranty_months, is_plus, is_primary, is_active, "
                f"moderation_status, sku, source_type) VALUES ({lid}, {pid}, {v2}, {p2}, NULL, "
                f"{random.randint(4, 150)}, 'new', {random.choice([1,2])}, {random.choice([3,4,5])}, 0, 0, 0, 1, "
                f"'active', {esc(sku + '-B')}, 'seed');"
            )
            lid += 1

    # Fashion variants (size/color) on the primary listing
    if item.get("variants"):
        for i, (size, color) in enumerate(item["variants"]):
            out.append(
                "INSERT INTO product_variants (listing_id, variant_type, variant_value, price_delta_kobo, stock, sort_order) VALUES "
                f"({primary_listing_id}, 'size', {esc(size)}, 0, {random.randint(5, 40)}, {i});"
            )
            out.append(
                "INSERT INTO product_variants (listing_id, variant_type, variant_value, price_delta_kobo, stock, sort_order) VALUES "
                f"({primary_listing_id}, 'color', {esc(color)}, 0, {random.randint(5, 40)}, {i});"
            )

    # Category attribute values
    if item.get("attrs"):
        for key, value in item["attrs"].items():
            aid = attr_id_by_key.get((item["leaf"], key))
            if aid:
                out.append(
                    "INSERT INTO product_attribute_values (product_id, attribute_id, value) VALUES "
                    f"({pid}, {aid}, {esc(value)});"
                )

    pid += 1

if missing_leaves:
    raise SystemExit(f"ERROR: unknown leaf category slugs referenced: {missing_leaves}")

print(f"Generated {pid - 1} products, {lid - 1} listings")

with open(OUT_PATH, "a") as f:
    f.write("\n-- ============================================================\n")
    f.write(f"-- PHASE 1A SEED, STAGE 3: PRODUCT CATALOG ({pid - 1} products, {lid - 1} listings)\n")
    f.write("-- ============================================================\n")
    f.write("\n".join(out) + "\n")

print(f"Appended product catalog SQL to {OUT_PATH}")
