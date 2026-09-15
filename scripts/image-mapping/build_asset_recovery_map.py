#!/usr/bin/env python3
"""
Existing Asset Recovery Pass — builds scripts/image-mapping/ASSET_RECOVERY_MAP.md
from the manual content-inspection findings (via understand_images / analyze_media_content)
performed on every pre-existing image asset in the repo.

This script does NOT call any AI vision tool itself — the classification data below
is transcribed directly from the visual audit performed in-conversation on:
  - 44 legacy public/static/products/product-N.jpg files (commit 93e3cf9)
  - 23 legacy public/static/brands/*.png files (commit 4c71498)
  - 20 legacy public/static/vendors/vendor-N.jpg files (commit e8ed19f)
  - 5 legacy public/static/banners/banner-N.jpg files (commit e8ed19f)
  - 8 legacy public/static/avatars/avatar-N.jpg files (commit e8ed19f) [not individually
    inspected - low priority, not product/brand/vendor content, out of critical path]
Approved-and-untouched groups (hero x10, ecosystem x16, africa-glow-map x1) are recorded
as already-approved, no action needed.
"""
import json

# ---------------------------------------------------------------------------
# 1. LEGACY PRODUCT PHOTOS (44 files, product-1.jpg .. product-44.jpg)
# ---------------------------------------------------------------------------
# classification: A=reuse as-is, B=reuse after remap, C=repurpose non-product, D=obsolete/unusable
PRODUCTS = [
 dict(f="product-1.jpg", depicts="Smartphone, back view, fictional 'AXON' engraving, silver/grey, triple-camera module", old_id=1,
      match_id=None, match_name=None, decision="C", conf="N/A", action="No current smartphone gap (Batch 1 already covered Smartphones w/ new photography). Clean, no trademark. Hold in library for 200+ catalog expansion or 'Smartphones' discovery-rail imagery."),
 dict(f="product-2.jpg", depicts="Smartphone, back view, fictional 'AURA' engraving, dark forest-green, triple-camera module", old_id=2,
      match_id=None, match_name=None, decision="C", conf="N/A", action="Same as product-1: no current gap. Hold for future catalog expansion / discovery imagery."),
 dict(f="product-3.jpg", depicts="Smartphone, back view, generic Android robot OS badge (not a brand trademark), navy blue, S21-Ultra-style quad-camera", old_id=3,
      match_id=None, match_name=None, decision="C", conf="N/A", action="No current gap. Hold for future catalog expansion."),
 dict(f="product-4.jpg", depicts="TWO smartphones (front+back), fictional 'NEXA' engraving, light blue, dual-camera", old_id=4,
      match_id=None, match_name=None, decision="C", conf="N/A", action="No current gap. Hold for future catalog expansion."),
 dict(f="product-5.jpg", depicts="Tablet, front view, Android home screen with GARBLED/gibberish app-icon labels (AI text defect)", old_id=5,
      match_id=None, match_name=None, decision="D", conf="N/A", action="QUALITY DEFECT (garbled on-screen text) — unusable regardless of catalog match. Retire."),
 dict(f="product-6.jpg", depicts="Laptop, midnight-blue, GARBLED menu-bar text + nonsensical keyboard glyphs (AI defect)", old_id=6,
      match_id=None, match_name=None, decision="D", conf="N/A", action="QUALITY DEFECT (garbled keyboard/UI). Retire."),
 dict(f="product-7.jpg", depicts="Laptop, silver/grey, gibberish bezel text + distorted keyboard keys (AI defect)", old_id=7,
      match_id=None, match_name=None, decision="D", conf="N/A", action="QUALITY DEFECT (garbled keyboard). Retire."),
 dict(f="product-8.jpg", depicts="Laptop, space-grey, malformed Apple-like icon + nonsensical gibberish keyboard (AI defect)", old_id=8,
      match_id=None, match_name=None, decision="D", conf="N/A", action="QUALITY DEFECT (garbled keyboard) + apple-icon likeness risk. Retire."),
 dict(f="product-9.jpg", depicts="Lifestyle TV on tripod easel stand, structurally broken/glitched tripod legs (AI defect)", old_id=9,
      match_id=None, match_name=None, decision="D", conf="N/A", action="QUALITY DEFECT (impossible stand geometry). Retire."),
 dict(f="product-10.jpg", depicts="TV, fictional 'VODQ/UODQ' badge, warped asymmetrical stand (AI defect)", old_id=10,
      match_id=None, match_name=None, decision="D", conf="N/A", action="QUALITY DEFECT (warped stand). Retire."),
 dict(f="product-11.jpg", depicts="Portable Bluetooth speaker, teal, fictional 'SOUNDWAVE' brand — CLEAN, no defects", old_id=11,
      match_id=None, match_name=None, decision="C", conf="N/A", action="No current gap (Batch 1 covered speakers/audio). Clean quality — hold for future catalog / discovery imagery."),
 dict(f="product-12.jpg", depicts="Over-ear headphones, black, fictional 'AURA' brand — minor hinge-geometry artifact", old_id=12,
      match_id=None, match_name=None, decision="C", conf="N/A", action="No current gap (Batch 1 covered headphones). Minor defect but acceptable for non-product use. Hold."),
 dict(f="product-13.jpg", depicts="Power bank 10000mAh, black, fictional 'VOLTA' brand — minor ghosting artifact, mostly clean", old_id=13,
      match_id=None, match_name=None, decision="C", conf="N/A", action="No current gap (Batch 1 covered power banks). Hold for future catalog."),
 dict(f="product-14.jpg", depicts="Solar power bank 20000mAh, black/orange, fictional 'TREKPOWER' — significant structural defects (floating solar panels)", old_id=14,
      match_id=None, match_name=None, decision="D", conf="N/A", action="QUALITY DEFECT (impossible panel/hinge geometry). Retire."),
 dict(f="product-15.jpg", depicts="Minimalist white leather sneaker, unbranded — CLEAN, professional quality", old_id=15,
      match_id=None, match_name=None, decision="C", conf="N/A", action="No exact current pending-product match (no plain white sneaker item in Batches 3-8). Clean asset — hold for fashion/footwear discovery imagery or future catalog expansion."),
 dict(f="product-16.jpg", depicts="Soccer cleats, black/red, unbranded — sole/stud geometry distorted (AI defect)", old_id=16,
      match_id=None, match_name=None, decision="D", conf="N/A", action="QUALITY DEFECT (distorted studs/soleplate). Retire."),
 dict(f="product-17.jpg", depicts="Cognac leather tote/briefcase, generic 'AD/AU' tag — garbled interior label text (AI defect)", old_id=17,
      match_id=None, match_name=None, decision="D", conf="N/A", action="QUALITY DEFECT (garbled interior text) + no exact current-product match (differs from id 29 Laptop Backpack). Retire."),
 dict(f="product-18.jpg", depicts="Indigo/cream kaftan dress — floating/jagged hemline artifact (AI defect)", old_id=18,
      match_id=43, match_name="Handmade Moroccan Kaftan Dress", decision="D", conf="N/A", action="Content matches id 43 category, but (a) id 43 ALREADY completed with new verified photography in Batch 2, and (b) this asset has a genuine quality defect. No action needed — retire."),
 dict(f="product-19.jpg", depicts="Royal-blue/gold men's traditional African formal suit (Agbada-style) — floating garment, pattern-melt artifacts (AI defect)", old_id=19,
      match_id=38, match_name="Men's Traditional Agbada Set", decision="D", conf="N/A", action="Content matches id 38, but id 38 ALREADY completed with new verified photography in Batch 2, and this asset has genuine quality defects. Retire."),
 dict(f="product-20.jpg", depicts="Free-standing stainless-steel gas range/oven, 4-burner+grill knobs, black glass door — minor render artifacts near knob icons, otherwise clean", old_id=20,
      match_id=45, match_name="4-Burner Gas Cooker with Oven", decision="B", conf="HIGH", action="RECOVER & REMAP. Content is an exact category+configuration match (4-burner gas cooker w/ oven) for currently-unmapped pending product id 45. Minor knob-icon blur is within the same quality bar as other approved batch assets. Copy to 045-4-burner-gas-cooker-with-oven.jpg, update D1, run full verification pipeline."),
 dict(f="product-21.jpg", depicts="2-in-1 blender+juicer, black/steel, fictional 'BlendPro' brand — garbled dial text + physically-impossible juice-pour artifact", old_id=21,
      match_id=44, match_name="Binatone 3-in-1 Blender Set", decision="D", conf="N/A", action="Category is close (blender) but current product is a REAL branded item (Binatone) — showing a fictional 'BlendPro' brand under the 'Binatone' title would violate the DB-name/image-must-agree rule. Also has quality defects. Retire; generate fresh Binatone-accurate (no-logo) blender photography."),
 dict(f="product-22.jpg", depicts="Wall-mount split-system air conditioner, white, REAL 'DAIKIN' logo (printed twice) — structural/UI-panel defects", old_id=22,
      match_id=None, match_name=None, decision="D", conf="N/A", action="REAL TRADEMARK RISK (Daikin logo reproduced) + no current catalog AC product exists + quality defects. Retire — do not use anywhere."),
 dict(f="product-23.jpg", depicts="White chest freezer 200L, fictional 'ArcticFresh' brand — garbled energy-label text, inconsistent vent/caster details", old_id=23,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No current chest-freezer product (id 46 is a different appliance type: Hisense single-door fridge, real brand). Quality defects present. Retire."),
 dict(f="product-24.jpg", depicts="Purple cordless stick vacuum, gibberish brand text ('AJAcROW' etc.)", old_id=24,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No current vacuum-cleaner product in catalog + garbled brand text defect. Retire."),
 dict(f="product-25.jpg", depicts="Cream/charcoal geometric-pattern bedding/comforter set — pattern & fold-geometry artifacts (AI defect)", old_id=25,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No current bedding-set product (id 50 is a bed FRAME, different item) + quality defects. Retire."),
 dict(f="product-26.jpg", depicts="Instant-noodle family pack (40x70g), fictional 'DELECTO' brand — garbled sachet text + melted food-texture artifacts", old_id=26,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No current instant-noodle product in the pending catalog + quality defects. Retire."),
 dict(f="product-27.jpg", depicts="5kg Semolina flour bag, fictional 'GOLDEN GRAINS' brand — garbled fine-print/barcode text", old_id=27,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No current semolina-flour product in pending catalog + quality defects. Retire."),
 dict(f="product-28.jpg", depicts="1kg malt-drink powder tin, fictional 'NIGERIA MALT DRINK' brand — garbled gold-seal text", old_id=28,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No current malt-drink product in pending catalog + quality defects. Retire."),
 dict(f="product-29.jpg", depicts="900g milk-powder tin, fictional 'GOLDCREST' brand — garbled side-panel nutrition text", old_id=29,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No current milk-powder-tin product in pending catalog (Peak Milk is a brand entry, not a mapped product) + quality defects. Retire."),
 dict(f="product-30.jpg", depicts="3kg laundry-detergent box, fictional 'AQUA FRESH' brand — garbled side-panel text (THE PAT-CITED EXAMPLE ASSET)", old_id=30,
      match_id=None, match_name=None, decision="C", conf="N/A", action="Confirmed: depicts detergent, NOT the current id-30 necklace (proves Pat's root-cause point exactly). However, NO detergent product exists anywhere in the current 127-item catalog to remap it to. Hold as a future-catalog-expansion candidate if a detergent SKU is added at 200+; not usable today due to text defects + no current slot. NOT deleted, preserved per directive."),
 dict(f="product-31.jpg", depicts="500ml antiseptic disinfectant liquid, fictional 'MEDIGUARD' brand — spelling defect ('Cfcaning')", old_id=31,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No current antiseptic-liquid product (id 72 is a soap bar, different form factor) + spelling defect. Retire."),
 dict(f="product-32.jpg", depicts="4oz Jamaican Black Castor Oil bottle, fictional 'BOTANICA ESSENTIALS' — spelling defect ('Trsditional')", old_id=32,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No current castor-oil product (id 67/74 are argan oil, different ingredient) + spelling defect. Retire."),
 dict(f="product-33.jpg", depicts="50ml anti-aging day cream jar SPF30, fictional 'RENEW 7' brand — CLEAN, no defects", old_id=33,
      match_id=None, match_name=None, decision="C", conf="N/A", action="No exact current product match (closest is id65 Nivea — real brand, name/image must agree, can't substitute fictional brand). Clean quality — hold for Beauty & Health category banner/discovery imagery."),
 dict(f="product-34.jpg", depicts="30ml liquid foundation bottle (deep warm shade), fictional 'AURORA BEAUTY' brand — CLEAN, no defects", old_id=34,
      match_id=69, match_name="Zaron Full Coverage Foundation", decision="C", conf="N/A", action="Category matches id 69 but that product requires the REAL brand Zaron — showing fictional 'Aurora Beauty' packaging under the 'Zaron' title would violate the name/image-agreement rule. Clean asset — hold for generic cosmetics/foundation category imagery, not for the specific Zaron SKU."),
 dict(f="product-35.jpg", depicts="10kg fixed-weight hex dumbbell pair, fictional 'FITGRIP' brand — CLEAN, no defects", old_id=35,
      match_id=84, match_name="Adjustable Dumbbell Set (20kg)", decision="C", conf="LOW", action="Partial category match to id 84, but product TYPE differs materially (fixed 10kg pair vs. adjustable 20kg set) — using it would misrepresent the product's key feature (adjustability). Recommend fresh generation for id 84 for accuracy; hold this asset for general fitness/gym discovery imagery instead."),
 dict(f="product-36.jpg", depicts="Purple/grey dual-layer TPE yoga mat, fictional 'AURORA YOGA' brand — CLEAN, no defects", old_id=36,
      match_id=None, match_name=None, decision="C", conf="N/A", action="No yoga-mat product in the current pending catalog. Clean asset — hold for Sports/Fitness discovery or category imagery."),
 dict(f="product-37.jpg", depicts="Baby diapers Size 4 pack, fictional 'LITTLE DREAMERS' brand — baby-anatomy distortion + spelling defects", old_id=37,
      match_id=79, match_name="Baby Diapers Size 3 (Jumbo Pack, 84 Count)", decision="D", conf="N/A", action="Category matches id 79 (diapers) but size differs (4 vs 3) AND has a genuine anatomical quality defect on the depicted baby. Retire; generate fresh Size-3 diaper photography for id 79."),
 dict(f="product-38.jpg", depicts="900g Stage-1 infant formula tin, fictional 'Little Sprout' brand — baby-anatomy distortion + spelling defect ('Munths')", old_id=38,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No infant-formula product in current pending catalog + anatomical/spelling defects. Retire."),
 dict(f="product-39.jpg", depicts="70cl Irish whiskey bottle, fictional 'The Kilbride Distillery' — minor foil-detail artifact", old_id=39,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No whiskey/spirits product in current pending catalog. Hold value low; retire (or hold in library only if catalog later adds spirits)."),
 dict(f="product-40.jpg", depicts="20cl African Herbs Bitters bottle — garbled label text + '200l e' typo defect", old_id=40,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No bitters product in current pending catalog + text defects. Retire."),
 dict(f="product-41.jpg", depicts="Hardcover finance book 'MONEY PATHWAY' by fictional 'Alex J. Thorne' — minor spine-text artifact", old_id=41,
      match_id=None, match_name=None, decision="C", conf="N/A", action="No matching current book product (pending id 101/102/103 are specific, real, named titles — cannot substitute). Hold for generic 'Books' category banner imagery only."),
 dict(f="product-42.jpg", depicts="Paperback novel 'ECHOES OF LAGOS' by fictional 'Amaka Adesina', Lagos street-scene cover art — minor background artifacts", old_id=42,
      match_id=101, match_name="Things Fall Apart by Chinua Achebe", decision="D", conf="N/A", action="Category (African fiction) matches but id 101/102 are REAL, specific, famous Chinua Achebe titles — showing a fictional cover under a real book's title would violate the name/image-agreement rule. Retire for product use; may hold as C for generic 'African Literature' category banner only."),
 dict(f="product-43.jpg", depicts="195/65R15 car tire, unbranded, placeholder DOT code — gibberish sidewall micro-text", old_id=43,
      match_id=None, match_name=None, decision="D", conf="N/A", action="No tire product in current pending catalog + text/tread defects. Retire."),
 dict(f="product-44.jpg", depicts="60Ah car battery, fictional 'VOLTMAX' brand — minor top-label text blur, mostly clean", old_id=44,
      match_id=None, match_name=None, decision="C", conf="N/A", action="No car-battery product in current pending catalog. Reasonably clean — hold for Automotive category/discovery imagery."),
]

# ---------------------------------------------------------------------------
# 2. LEGACY BRAND LOGOS (23 files) — commit 4c71498
# ---------------------------------------------------------------------------
CURRENT_BRAND_NAMES = {
 "samsung","apple","hp","tecno","infinix","oraimo","nike","adidas","lg","hisense","philips",
 "sony","dell","lenovo","xiaomi","itel","zinox","davido fashion house","ashluxe","zaron cosmetics",
 "house of tara","nivea","dettol","kellogg's","nestle","indomie","dangote","golden penny","peak milk",
 "kilimanjaro coffee","java house","woolworths","adire oodua textiles","fatiya textiles","kentex ghana",
 "maasai market collective","marrakech leatherworks","generic",
}

BRANDS = [
 dict(f="anker.png", finding="EXACT reproduction of real Anker logo/wordmark/color", brand_in_table=False, corrupted=False),
 dict(f="apple.png", finding="File is a corrupted/blank solid-black square — no content", brand_in_table=True, corrupted=True),
 dict(f="ariel.png", finding="EXACT reproduction of real Ariel (P&G) logo", brand_in_table=False, corrupted=False),
 dict(f="binatone.png", finding="EXACT reproduction of real Binatone logo", brand_in_table=False, corrupted=False),
 dict(f="dettol.png", finding="EXACT reproduction of real Dettol logo (sword+shield mark)", brand_in_table=True, corrupted=False),
 dict(f="dyson.png", finding="EXACT reproduction of real Dyson wordmark/typeface", brand_in_table=False, corrupted=False),
 dict(f="golden-penny.png", finding="EXACT reproduction of real Golden Penny Foods logo", brand_in_table=True, corrupted=False),
 dict(f="hisense.png", finding="EXACT reproduction of real Hisense logo/typeface/color", brand_in_table=True, corrupted=False),
 dict(f="hp.png", finding="EXACT reproduction of real HP logo mark", brand_in_table=True, corrupted=False),
 dict(f="indomie.png", finding="EXACT reproduction of real Indomie logo (bilingual)", brand_in_table=True, corrupted=False),
 dict(f="infinix.png", finding="EXACT reproduction of real Infinix logo+tagline", brand_in_table=True, corrupted=False),
 dict(f="jbl.png", finding="EXACT reproduction of real JBL logo", brand_in_table=False, corrupted=False),
 dict(f="lg.png", finding="EXACT reproduction of real LG circle-face logo", brand_in_table=True, corrupted=False),
 dict(f="maybelline.png", finding="EXACT reproduction of real Maybelline New York logo", brand_in_table=False, corrupted=False),
 dict(f="midea.png", finding="EXACT reproduction of real Midea logo (R)", brand_in_table=False, corrupted=False),
 dict(f="nestle.png", finding="EXACT reproduction of real Nestle 'bird's nest' logo", brand_in_table=True, corrupted=False),
 dict(f="nike.png", finding="File is a corrupted/blank solid-black square — no content", brand_in_table=True, corrupted=True),
 dict(f="orijin.png", finding="EXACT reproduction of real Orijin (Diageo) logo (R)", brand_in_table=False, corrupted=False),
 dict(f="peak.png", finding="EXACT reproduction of real Peak Milk logo (palm trees)", brand_in_table=True, corrupted=False),
 dict(f="samsung.png", finding="File is a corrupted/blank solid-black square — no content", brand_in_table=True, corrupted=True),
 dict(f="scanfrost.png", finding="Near-exact reproduction of real Scanfrost logo", brand_in_table=False, corrupted=False),
 dict(f="sony.png", finding="File is a corrupted/blank solid-black square — no content", brand_in_table=True, corrupted=True),
 dict(f="tecno.png", finding="EXACT reproduction of real Tecno Mobile logo", brand_in_table=True, corrupted=False),
 dict(f="zaron.png", finding="Near-exact reproduction of real Zaron Cosmetics logo+tagline", brand_in_table=True, corrupted=False),
]

# ---------------------------------------------------------------------------
# 3. LEGACY VENDOR LOGOS (20 files) — commit e8ed19f
# ---------------------------------------------------------------------------
CURRENT_VENDOR_NAMES = [
 "Lagos Tech Hub","Naija Gadget Store","Abuja Electronics Mart","PortHarcourt Phones & More",
 "Kano Fabric Traders","Ariya Ankara House","Oyo Adire Collective","Aso Oke Heritage Weavers",
 "Mama's Kitchen Grocers","Naija Fresh Market","Zaron Beauty Nigeria","Enugu Home & Living",
 "Kumasi Kente Weavers","Accra Shea Collective","Nairobi Coffee Exporters","Maasai Craft Cooperative",
 "Marrakech Leather & Rugs","Fez Ceramics House",
]
VENDORS = [
 dict(f="vendor-1.jpg", name_baked="Electronics World", biz="Electronics retail"),
 dict(f="vendor-2.jpg", name_baked="GadgetTech Hub", biz="Electronics/gadget retail"),
 dict(f="vendor-3.jpg", name_baked="Mega Electronics", biz="Electronics retail"),
 dict(f="vendor-4.jpg", name_baked="PhonePlace Abuja", biz="Phone retail/repair"),
 dict(f="vendor-5.jpg", name_baked="Fashion Vault NG", biz="Fashion boutique"),
 dict(f="vendor-6.jpg", name_baked="Ankara House", biz="Ankara fashion"),
 dict(f="vendor-7.jpg", name_baked="Kitchen King NG", biz="Kitchenware/catering"),
 dict(f="vendor-8.jpg", name_baked="FoodMart NG", biz="Grocery/supermarket"),
 dict(f="vendor-9.jpg", name_baked="QuickBasket NG", biz="Grocery delivery"),
 dict(f="vendor-10.jpg", name_baked="Glow Beauty Store", biz="Beauty/cosmetics"),
 dict(f="vendor-11.jpg", name_baked="Natural Hair NG", biz="Natural hair care"),
 dict(f="vendor-12.jpg", name_baked="Sports Arena NG", biz="Sports"),
 dict(f="vendor-13.jpg", name_baked="NaijaDrinks Ltd", biz="Beverage distribution"),
 dict(f="vendor-14.jpg", name_baked="BookHouse NG", biz="Books"),
 dict(f="vendor-15.jpg", name_baked="AutoParts NG", biz="Automotive parts"),
 dict(f="vendor-16.jpg", name_baked="Home Appliances NG", biz="Home appliances"),
 dict(f="vendor-17.jpg", name_baked="Cool Breeze NG", biz="HVAC/cooling"),
 dict(f="vendor-18.jpg", name_baked="BabyCare Essentials", biz="Baby products"),
 dict(f="vendor-19.jpg", name_baked="TechZone Kano", biz="Electronics/IT"),
 dict(f="vendor-20.jpg", name_baked="Value Electronics", biz="Electronics retail"),
]

# ---------------------------------------------------------------------------
# 4. BANNERS (5 files) — commit e8ed19f
# ---------------------------------------------------------------------------
BANNERS = [
 dict(f="banner-1.jpg", subject="Electronics 'MEGA SALE 50% OFF' graphic (viewed in prior session)", decision="C", action="Acceptable quality; candidate for Electronics category/promo banner pending Pat's explicit sign-off."),
 dict(f="banner-2.jpg", subject="Ankara-fashion retail display w/ 'SALE / 50% OFF / NEW ARRIVALS' UI overlays", decision="C", action="High quality lifestyle shot — candidate for African Fashion / Ankara category banner or promo slide."),
 dict(f="banner-3.jpg", subject="Family receiving grocery delivery at doorstep, no text overlay", decision="C", action="High quality — candidate for Groceries/NaijaFresh delivery promo banner."),
 dict(f="banner-4.jpg", subject="Modern kitchen w/ smart appliances, woman using blender, no text overlay", decision="C", action="High quality — candidate for Home & Kitchen category banner."),
 dict(f="banner-5.jpg", subject="Delivery rider on motorcycle, Lagos street scene, 'VERIFIED' box branding, minor AI artifacts on background signage", decision="C", action="Good quality — candidate for NaijaSend / logistics vertical promo banner."),
]

if __name__ == "__main__":
    print(f"Products: {len(PRODUCTS)}  Brands: {len(BRANDS)}  Vendors: {len(VENDORS)}  Banners: {len(BANNERS)}")
