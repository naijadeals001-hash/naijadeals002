-- Adds a reviewer avatar column. Migration 0002 gave reviews a `photo_url` for a photo the
-- reviewer attached to their review (product-in-hand style); this is separate — a small
-- headshot avatar shown next to the reviewer's name, same pattern as Amazon/Jumia review UIs.
-- Populated deterministically in gen_seed.py by hashing author_name against a fixed avatar pool,
-- so the same name always gets the same face across the whole seed (not random per row).

ALTER TABLE reviews ADD COLUMN avatar_url TEXT;
