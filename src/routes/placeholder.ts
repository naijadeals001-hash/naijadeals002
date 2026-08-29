import { Hono } from 'hono'

/**
 * Generates a lightweight branded SVG placeholder image on the fly.
 * Used in place of real product photography until vendors upload their own
 * images or we invest in a licensed/generated photo set (see README).
 * Zero external dependencies, zero licensing risk, Workers-safe.
 */
export const placeholderRoute = new Hono()

const PALETTE: Record<string, string> = {
  electronics: '#0B7A3B',
  fashion: '#B8860B',
  'home-kitchen': '#1E6FB8',
  groceries: '#C0392B',
  'beauty-health': '#A24AB0',
  'sports-outdoors': '#2C6E49',
  'baby-products': '#4A90D9',
  drinks: '#7B241C',
  books: '#5D4037',
  automotive: '#37474F'
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

placeholderRoute.get('/ph.svg', (c) => {
  const label = c.req.query('label') || 'NaijaDeals'
  const cat = c.req.query('cat') || 'electronics'
  const emoji = c.req.query('emoji') || '\u{1F6D2}' // shopping trolley fallback
  const bg = PALETTE[cat] || '#0B7A3B'

  const words = label.split(' ')
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    if ((current + ' ' + w).trim().length > 20) {
      lines.push(current.trim())
      current = w
    } else {
      current = (current + ' ' + w).trim()
    }
  }
  if (current) lines.push(current)
  const shownLines = lines.slice(0, 2)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bg}" stop-opacity="0.92"/>
        <stop offset="100%" stop-color="${bg}" stop-opacity="0.65"/>
      </linearGradient>
    </defs>
    <rect width="600" height="600" fill="url(#g)"/>
    <text x="300" y="255" font-size="140" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
    ${shownLines
      .map(
        (line, i) =>
          `<text x="300" y="${400 + i * 40}" font-family="Poppins, sans-serif" font-size="28" font-weight="600" fill="white" text-anchor="middle">${esc(line)}</text>`
      )
      .join('')}
  </svg>`

  c.header('Content-Type', 'image/svg+xml')
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  return c.body(svg)
})
