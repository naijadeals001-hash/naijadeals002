import { getWalletBalance } from './wallet'
import { getWishlistCount } from './wishlist'

/**
 * Real-data personalization panel snapshot for the homepage hero's right
 * zone (Phase 1b). Deliberately reuses the SAME wallet/wishlist/orders
 * primitives every other authenticated page already reads
 * (getWalletBalance/getWishlistCount from wallet.ts/wishlist.ts, a direct
 * COUNT against `orders` matching orders.tsx's own query) — no new
 * "personalization engine", no fabricated numbers. A deeper behavioral
 * recommendation engine is explicitly Phase 2 (per the Phase 1a directive);
 * this is real account data, not a stub.
 */
export interface PersonalizationSnapshot {
  walletBalanceKobo: number
  wishlistCount: number
  ordersCount: number
}

export async function getPersonalizationSnapshot(db: D1Database, userId: number): Promise<PersonalizationSnapshot> {
  const [walletBalanceKobo, wishlistCount, ordersRow] = await Promise.all([
    getWalletBalance(db, userId),
    getWishlistCount(db, userId),
    db.prepare('SELECT COUNT(*) as n FROM orders WHERE user_id = ?').bind(userId).first<{ n: number }>()
  ])
  return { walletBalanceKobo, wishlistCount, ordersCount: ordersRow?.n ?? 0 }
}
