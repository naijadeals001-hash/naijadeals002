import type { NaijaDealUser } from '../infra/identity-client.js'

declare global {
  namespace Express {
    interface Request {
      user?: NaijaDealUser
    }
  }
}
