import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'

export async function loginPage(c: Context<AppEnv>) {
  const user = c.get('user')
  const next = c.req.query('next') || '/'

  if (user) {
    return c.redirect(next)
  }

  return c.render(
    <Layout title="Sign in" user={user}>
      <div class="max-w-md mx-auto px-6 py-12">
        <h1 class="text-2xl font-bold text-gray-800 mb-1">Sign in</h1>
        <p class="text-sm text-gray-500 mb-6">One account for shopping, food, gigs and stays across Nigeria.</p>

        <div id="auth-error" class="hidden bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4"></div>

        <form id="login-form" class="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Email or phone number</label>
            <input name="identifier" required placeholder="you@example.com or 080XXXXXXXX" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <button type="submit" class="w-full bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition">
            Sign in
          </button>
        </form>

        <p class="text-sm text-gray-500 mt-6 text-center">
          New to NaijaDeals? <a href={`/register?next=${encodeURIComponent(next)}`} class="text-primary font-semibold hover:underline">Create an account</a>
        </p>
      </div>
    </Layout>
  )
}

export async function registerPage(c: Context<AppEnv>) {
  const user = c.get('user')
  const next = c.req.query('next') || '/'

  if (user) {
    return c.redirect(next)
  }

  return c.render(
    <Layout title="Create account" user={user}>
      <div class="max-w-md mx-auto px-6 py-12">
        <h1 class="text-2xl font-bold text-gray-800 mb-1">Create your account</h1>
        <p class="text-sm text-gray-500 mb-6">Shop, order food, book services and stays — all with one NaijaDeals account.</p>

        <div id="auth-error" class="hidden bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4"></div>

        <form id="register-form" class="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Full name</label>
            <input name="name" required class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" name="email" placeholder="you@example.com" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Phone number</label>
            <input name="phone" placeholder="080XXXXXXXX" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <p class="text-xs text-gray-400">Provide at least an email or a phone number.</p>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" name="password" required minlength="8" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <p class="text-xs text-gray-400 mt-1">At least 8 characters.</p>
          </div>
          <button type="submit" class="w-full bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition">
            Create account
          </button>
        </form>

        <p class="text-sm text-gray-500 mt-6 text-center">
          Already have an account? <a href={`/login?next=${encodeURIComponent(next)}`} class="text-primary font-semibold hover:underline">Sign in</a>
        </p>
      </div>
    </Layout>
  )
}
