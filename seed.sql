-- NaijaDeals seed data — realistic demo catalog for MVP
-- Product images use the built-in /ph.svg placeholder generator (no licensing risk).
-- Replace with real vendor-uploaded photos once vendor onboarding + R2 upload ships.

-- ============ CATEGORIES ============
INSERT OR IGNORE INTO categories (id, slug, name, icon, sort_order) VALUES
  (1, 'electronics', 'Electronics', 'devices', 1),
  (2, 'fashion', 'Fashion', 'checkroom', 2),
  (3, 'home-kitchen', 'Home & Kitchen', 'kitchen', 3),
  (4, 'groceries', 'Groceries', 'local_grocery_store', 4),
  (5, 'beauty-health', 'Beauty & Health', 'spa', 5),
  (6, 'sports-outdoors', 'Sports & Outdoors', 'sports_soccer', 6),
  (7, 'baby-products', 'Baby Products', 'child_care', 7),
  (8, 'drinks', 'Drinks', 'liquor', 8),
  (9, 'books', 'Books', 'menu_book', 9),
  (10, 'automotive', 'Automotive', 'directions_car', 10);

-- ============ VENDORS ============
INSERT OR IGNORE INTO vendors (id, slug, name, description, city, is_verified, rating_avg, rating_count) VALUES
  (1, 'electronics-world', 'Electronics World', 'Trusted electronics retailer since 2015.', 'Lagos', 1, 4.6, 892),
  (2, 'fashion-vault-ng', 'Fashion Vault NG', 'Curated fashion for the modern Nigerian.', 'Lagos', 1, 4.5, 634),
  (3, 'kitchen-king-ng', 'Kitchen King NG', 'Everything for your kitchen.', 'Ibadan', 1, 4.4, 401),
  (4, 'foodmart-ng', 'FoodMart NG', 'Groceries delivered fresh.', 'Lagos', 1, 4.7, 1520),
  (5, 'glow-beauty-store', 'Glow Beauty Store', 'Skincare and beauty essentials.', 'Abuja', 1, 4.5, 780),
  (6, 'sports-arena-ng', 'Sports Arena NG', 'Gear for every sport.', 'Lagos', 1, 4.3, 312),
  (7, 'natural-hair-ng', 'Natural Hair NG', 'Natural hair and body care.', 'Lagos', 1, 4.6, 890),
  (8, 'naijadrinks-ltd', 'NaijaDrinks Ltd', 'Licensed beverage distributor.', 'Lagos', 1, 4.7, 340),
  (9, 'bookhouse-ng', 'BookHouse NG', 'Books for every reader.', 'Ibadan', 1, 4.8, 1980),
  (10, 'autoparts-ng', 'AutoParts NG', 'Genuine auto parts and accessories.', 'Lagos', 1, 4.4, 512),
  (11, 'home-appliances-ng', 'Home Appliances NG', 'Big appliances, fair prices.', 'Lagos', 1, 4.5, 445),
  (12, 'cool-breeze-ng', 'Cool Breeze NG', 'AC & cooling specialists.', 'Port Harcourt', 1, 4.4, 289);

-- ============ PRODUCTS ============
-- Electronics
INSERT OR IGNORE INTO products (id, slug, vendor_id, category_id, title, description, price_kobo, compare_at_price_kobo, stock, image_url, rating_avg, rating_count, is_flash_deal) VALUES
  (1, 'slim-power-bank-10000mah', 1, 1, 'Slim Power Bank 10000mAh', 'Ultra-slim fast-charging power bank with dual USB output. Perfect for daily commute.', 850000, 1150000, 120, '/ph.svg?cat=electronics&emoji=%F0%9F%94%8B&label=Power+Bank+10000mAh', 4.1, 44, 1),
  (2, 'solar-power-bank-30000mah', 1, 1, 'Solar Power Bank 30000mAh', 'High-capacity solar power bank ideal for outdoor use and frequent power outages.', 2150000, 2900000, 65, '/ph.svg?cat=electronics&emoji=%E2%98%80%EF%B8%8F&label=Solar+Power+Bank', 4.3, 67, 1),
  (3, 'wireless-magsafe-power-bank-5000mah', 1, 1, 'Wireless MagSafe Power Bank 5000mAh', 'Magnetic wireless charging power bank, compatible with iPhone 12 and above.', 1500000, NULL, 80, '/ph.svg?cat=electronics&emoji=%F0%9F%94%8B&label=MagSafe+Power+Bank', 4.4, 52, 0),
  (4, 'sony-wh-1000xm5', 1, 1, 'Sony WH-1000XM5 Noise Cancelling Headphones', 'Industry-leading noise cancellation, 30-hour battery life, crystal-clear calls.', 18500000, 22500000, 30, '/ph.svg?cat=electronics&emoji=%F0%9F%8E%A7&label=Noise+Cancelling+Headphones', 4.7, 134, 0),
  (5, 'jbl-charge-5-speaker', 1, 1, 'JBL Charge 5 Bluetooth Speaker Teal', 'Waterproof portable speaker with powerbank function and deep bass.', 5200000, 6500000, 55, '/ph.svg?cat=electronics&emoji=%F0%9F%94%8A&label=Bluetooth+Speaker', 4.5, 267, 1),
  (6, 'macbook-air-m3', 1, 1, 'MacBook Air M3 13-inch 8GB/256GB Midnight', 'Apple M3 chip, all-day battery life, stunning Liquid Retina display.', 195000000, 220000000, 12, '/ph.svg?cat=electronics&emoji=%F0%9F%92%BB&label=MacBook+Air+M3', 4.9, 98, 0),
  (7, 'hp-pavilion-15', 1, 1, 'HP Pavilion 15 Core i7 12th Gen 16GB/512GB', 'Powerful everyday laptop for work, study and entertainment.', 65000000, 75000000, 18, '/ph.svg?cat=electronics&emoji=%F0%9F%92%BB&label=HP+Pavilion+15+Laptop', 4.4, 167, 0),
  (8, 'lg-55-oled-tv', 1, 1, 'LG 55" OLED evo C3 4K Smart TV', 'Self-lit pixels, perfect black, Dolby Vision & Atmos, webOS smart platform.', 95000000, 115000000, 8, '/ph.svg?cat=electronics&emoji=%F0%9F%93%BA&label=55in+OLED+Smart+TV', 4.7, 87, 0),

  -- Home & Kitchen
  (9, 'blender-juicer-combo', 3, 3, 'Blender & Juicer Combo Set', '2-in-1 kitchen appliance for smoothies, juices and food prep.', 1950000, 2600000, 90, '/ph.svg?cat=home-kitchen&emoji=%F0%9F%A5%A4&label=Blender+%26+Juicer+Set', 4.2, 58, 1),
  (10, '4pc-duvet-set', 3, 3, '4-Piece Duvet & Pillowcase Set', 'Soft cotton-blend duvet set, machine washable, fade resistant.', 2400000, 3300000, 70, '/ph.svg?cat=home-kitchen&emoji=%F0%9F%9B%8C&label=Duvet+%26+Pillowcase+Set', 4.6, 71, 1),
  (11, 'binatone-gas-cooker', 3, 3, 'Binatone 4-Burner Gas Cooker with Oven', 'Durable 4-burner gas cooker with built-in oven and grill.', 8800000, 10500000, 25, '/ph.svg?cat=home-kitchen&emoji=%F0%9F%94%A5&label=4-Burner+Gas+Cooker', 4.3, 312, 0),
  (12, 'scanfrost-chest-freezer', 11, 3, 'Scanfrost 200L Chest Freezer', 'Energy-efficient chest freezer, fast-freeze function.', 15500000, 18500000, 15, '/ph.svg?cat=home-kitchen&emoji=%E2%9D%84%EF%B8%8F&label=200L+Chest+Freezer', 4.4, 245, 0),
  (13, 'midea-split-ac', 12, 3, 'Midea 1.5HP Split Inverter AC R32', 'Energy-saving inverter AC, quiet operation, fast cooling.', 19500000, 24000000, 20, '/ph.svg?cat=home-kitchen&emoji=%E2%9D%84%EF%B8%8F&label=1.5HP+Split+Inverter+AC', 4.5, 378, 0),
  (14, 'dyson-v15-vacuum', 11, 3, 'Dyson V15 Detect Cordless Vacuum', 'Laser dust detection, powerful suction, up to 60 min runtime.', 42500000, 51000000, 10, '/ph.svg?cat=home-kitchen&emoji=%F0%9F%A7%B9&label=Cordless+Vacuum', 4.6, 92, 0),

  -- Groceries
  (15, 'indomie-super-pack-40', 4, 4, 'Indomie Super Pack Chicken Flavour 40-Pack', 'Nigeria''s favourite instant noodles, chicken flavour, 40 sachets.', 780000, 950000, 300, '/ph.svg?cat=groceries&emoji=%F0%9F%8D%9C&label=Instant+Noodles+40-Pack', 4.8, 1200, 1),
  (16, 'milo-1kg-tin', 4, 4, 'Milo Chocolate Malt Drink 1kg Tin', 'Energy-giving chocolate malt drink for the whole family.', 620000, 780000, 250, '/ph.svg?cat=groceries&emoji=%F0%9F%A5%A4&label=Chocolate+Malt+Drink+1kg', 4.7, 892, 1),
  (17, 'golden-penny-semolina-5kg', 4, 4, 'Golden Penny Semolina 5kg', 'Premium quality semolina for smooth, lump-free swallow.', 850000, 1050000, 180, '/ph.svg?cat=groceries&emoji=%F0%9F%8C%BE&label=Semolina+5kg', 4.6, 678, 0),

  -- Beauty & Health
  (18, 'jamaican-black-castor-oil', 7, 5, 'Jamaican Black Castor Oil 4oz Original', 'Pure black castor oil for hair growth and scalp health.', 720000, 950000, 150, '/ph.svg?cat=beauty-health&emoji=%F0%9F%A7%B4&label=Black+Castor+Oil+4oz', 4.5, 823, 1),
  (19, 'olay-total-effects-cream', 5, 5, 'Olay Total Effects 7-in-1 Day Cream SPF15', 'Anti-aging day cream with 7 skin benefits and sun protection.', 1250000, 1600000, 95, '/ph.svg?cat=beauty-health&emoji=%F0%9F%A7%B4&label=7-in-1+Day+Cream+SPF15', 4.5, 534, 0),

  -- Sports & Outdoors
  (20, 'decathlon-dumbbell-10kg', 6, 6, 'Decathlon Rubber Dumbbell Pair 10kg', 'Rubber-coated dumbbells for home strength training.', 3200000, 4000000, 60, '/ph.svg?cat=sports-outdoors&emoji=%F0%9F%8F%8B%EF%B8%8F&label=Dumbbell+Pair+10kg', 4.4, 312, 0),
  (21, 'nike-mercurial-vapor', 6, 6, 'Nike Mercurial Vapor 16 Elite FG', 'Elite firm-ground football boots for speed and agility.', 7500000, 9000000, 40, '/ph.svg?cat=sports-outdoors&emoji=%E2%9A%BD&label=Football+Boots+Elite+FG', 4.5, 189, 0),
  (22, 'nike-air-force-1', 6, 2, 'Nike Air Force 1 Low White Original', 'Classic white sneakers, timeless style, all-day comfort.', 9500000, 11500000, 75, '/ph.svg?cat=fashion&emoji=%F0%9F%91%9F&label=White+Sneakers+Low', 4.6, 445, 0),

  -- Fashion
  (23, 'leather-tote-bag', 2, 2, 'Handmade Leather Tote Bag', 'Genuine leather tote, hand-stitched by Lagos artisans.', 4500000, NULL, 22, '/ph.svg?cat=fashion&emoji=%F0%9F%91%9C&label=Leather+Tote+Bag', 4.5, 178, 0),
  (24, 'adire-kaftan-women', 2, 2, 'Adire Hand-Dyed Kaftan Women Premium', 'Traditional Adire fabric kaftan, hand-dyed, premium finish.', 3850000, 5500000, 35, '/ph.svg?cat=fashion&emoji=%F0%9F%91%97&label=Adire+Kaftan+Women', 4.6, 203, 0),
  (25, 'aso-oke-senator-suit', 2, 2, 'Premium Aso-Oke Ankara Senator Suit Men', 'Sharp senator suit with Aso-Oke trim, made in Nigeria.', 4500000, 6200000, 28, '/ph.svg?cat=fashion&emoji=%F0%9F%91%94&label=Aso-Oke+Senator+Suit', 4.5, 312, 0),

  -- Baby Products
  (26, 'baby-diaper-pack', 1, 7, 'Baby Dry Pants Size 4 Pack of 44', 'All-night dryness, comfortable fit, breathable material.', 950000, NULL, 140, '/ph.svg?cat=baby-products&emoji=%F0%9F%91%B6&label=Baby+Diaper+Pants+Pack', 4.6, 421, 0),

  -- Drinks
  (27, 'jameson-whiskey-75cl', 8, 8, 'Jameson Irish Whiskey 75cl', 'Triple-distilled Irish whiskey, smooth finish. 75cl bottle.', 2200000, 2600000, 30, '/ph.svg?cat=drinks&emoji=%F0%9F%A5%83&label=Irish+Whiskey+75cl', 4.7, 210, 0),

  -- Books
  (28, 'rich-dad-poor-dad', 9, 9, 'Rich Dad Poor Dad - Robert Kiyosaki', 'The #1 personal finance book, timeless money lessons.', 550000, 700000, 200, '/ph.svg?cat=books&emoji=%F0%9F%93%98&label=Rich+Dad+Poor+Dad', 4.8, 1500, 0),
  (29, 'spider-kings-daughter', 9, 9, 'The Spider King''s Daughter - Chibundu Onuzo', 'An acclaimed Nigerian coming-of-age love story set in Lagos.', 480000, 620000, 85, '/ph.svg?cat=books&emoji=%F0%9F%93%96&label=The+Spider+King%27s+Daughter', 4.5, 234, 0),

  -- Automotive
  (30, 'michelin-primacy-tyre', 10, 10, 'Michelin Primacy 4 Tyre 195/65 R15', 'Durable, fuel-efficient tyre with excellent wet grip.', 3850000, 4600000, 48, '/ph.svg?cat=automotive&emoji=%F0%9F%9B%9E%EF%B8%8F&label=Tyre+195%2F65+R15', 4.5, 234, 0),
  (31, 'duralast-car-battery', 10, 10, 'Duralast Gold 60Ah Car Battery DIN60', 'Maintenance-free car battery with 2-year warranty.', 4800000, 5800000, 33, '/ph.svg?cat=automotive&emoji=%F0%9F%94%8B&label=Car+Battery+60Ah', 4.4, 156, 0);

-- ============ SAMPLE REVIEWS ============
INSERT OR IGNORE INTO reviews (product_id, author_name, rating, comment, created_at) VALUES
  (27, 'Fatima N.', 5, 'Packaging was solid and the item arrived in perfect condition.', datetime('now', '-5 days')),
  (27, 'Yusuf N.', 4, 'It''s okay, took a bit longer to arrive than expected.', datetime('now', '-21 days')),
  (27, 'Adaeze A.', 5, 'Better than I expected, highly recommend this vendor.', datetime('now', '-28 days')),
  (27, 'Ifeoma S.', 5, 'Packaging was solid and the item arrived in perfect condition.', datetime('now', '-30 days')),
  (6, 'Chinedu O.', 5, 'Fast, smooth, exactly as advertised. Battery life is amazing.', datetime('now', '-3 days')),
  (6, 'Amaka B.', 5, 'Genuine Apple product, delivered securely packaged.', datetime('now', '-10 days')),
  (15, 'Tunde A.', 5, 'Bulk buy saved me a lot compared to buying individually.', datetime('now', '-2 days')),
  (18, 'Blessing E.', 4, 'Good quality oil, noticed less hair breakage after 2 weeks.', datetime('now', '-7 days'));

-- ============ WALLET DEMO SEED (only if you want a demo user — safe to skip in prod) ============
-- Intentionally left empty: wallet entries are created via application logic, never seeded directly.
