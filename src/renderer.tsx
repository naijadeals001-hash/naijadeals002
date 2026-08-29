import { jsxRenderer } from 'hono/jsx-renderer'

// Pages in src/pages/*.tsx each render a full <Layout> (which itself renders
// a complete <html> document), so this renderer is intentionally a pass-through.
// It exists only to give every route access to c.render(...).
export const renderer = jsxRenderer(({ children }) => children)
