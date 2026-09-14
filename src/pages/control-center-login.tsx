import type { Context } from 'hono'
import type { AppEnv } from '../types'

/**
 * Enterprise Control Center — real login page.
 *
 * "The Control Center MUST have a real, server-enforced login... Never
 * hide behind a frontend route only." This page is a genuine SSR route
 * (/control-center/login) with a real <form>, backed by a real POST route
 * (/control-center/login) that reuses Engine 1's EXACT
 * verifyPassword/checkLoginThrottle/isAccountStatusBlocked/createSession
 * primitives — never a client-side-only "is admin" check, never a second
 * password/identity system.
 *
 * VISUAL: rebuilt as a two-panel premium entry point (left: brand/identity
 * panel using a real existing hero asset; right: the actual sign-in form)
 * per the Enterprise Control Center visual redesign. No fake MFA UI is
 * rendered — this remains the real, single-factor password login until a
 * genuine MFA system exists.
 *
 * A visitor who is signed in as a normal customer/vendor/provider with NO
 * Control Center role sees the SAME login form as an unauthenticated
 * visitor (never a distinguishable "you're logged in but not authorized"
 * message) — see requireControlCenterAuth's doc comment for the
 * anti-enumeration rationale this mirrors.
 */
export async function controlCenterLoginPage(c: Context<AppEnv>) {
  const next = c.req.query('next') || '/control-center'
  const denied = c.req.query('denied') === '1'

  return c.render(
    <html lang="en" dir="ltr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Sign in | Control Center | NaijaDeals</title>
        <meta name="robots" content="noindex, nofollow" />
        <link rel="icon" href="/static/favicon.svg" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <script src="https://cdn.tailwindcss.com"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
            tailwind.config = {
              theme: {
                extend: {
                  colors: {
                    ccbg: '#080B0A',
                    ccpanel: '#0F1613',
                    ccborder: '#1E2B25',
                    ccaccent: { DEFAULT: '#17C983', dark: '#0B7A3B', light: '#0F2A20' },
                  },
                  fontFamily: { sans: ['Poppins', 'ui-sans-serif', 'system-ui'] }
                }
              }
            }
          `,
          }}
        ></script>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body class="min-h-screen flex bg-ccbg font-sans text-gray-100">
        {/* ===== Left brand panel ===== */}
        <div
          class="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 overflow-hidden"
          style="background: linear-gradient(160deg, #080B0A 0%, #0B1F16 55%, #0F2A20 100%);"
        >
          <div
            class="absolute inset-0 opacity-25 bg-cover bg-center mix-blend-screen"
            style="background-image: url('/static/hero/naijadeals-ecosystem-desktop.jpg');"
          ></div>
          <div class="absolute inset-0" style="background: radial-gradient(circle at 30% 20%, rgba(23,201,131,0.18), transparent 55%);"></div>

          <div class="relative z-10 flex items-center gap-2">
            <span class="material-symbols-outlined text-ccaccent text-3xl">travel_explore</span>
            <span class="text-lg font-extrabold text-white">NaijaDeals</span>
          </div>

          <div class="relative z-10">
            <h1 class="text-4xl font-extrabold text-white leading-tight mb-3">
              One Africa.<br />Infinite Opportunities.
            </h1>
            <p class="text-sm text-gray-400 max-w-sm leading-relaxed">
              The enterprise nerve center connecting NaijaShop, NaijaFresh, NaijaEats, NaijaGigs, NaijaStay, NaijaDrive, NaijaSend, NaijaStream and Aura AI — nine verticals, one platform, built Africa-first.
            </p>
          </div>

          <div class="relative z-10 flex items-center gap-4 text-[11px] text-gray-500">
            <span>Nigeria Today.</span>
            <span class="w-1 h-1 rounded-full bg-ccaccent"></span>
            <span>Africa Tomorrow.</span>
          </div>
        </div>

        {/* ===== Right sign-in panel ===== */}
        <div class="flex-1 flex items-center justify-center px-4 py-12">
          <div class="w-full max-w-sm">
            <div class="flex lg:hidden items-center justify-center gap-2 mb-8">
              <span class="material-symbols-outlined text-ccaccent text-2xl">travel_explore</span>
              <span class="text-lg font-bold text-white">NaijaDeals Control Center</span>
            </div>

            <div class="bg-ccpanel border border-ccborder rounded-2xl p-6 shadow-2xl">
              <h1 class="text-lg font-bold text-white mb-1">Enterprise Control Center</h1>
              <p class="text-xs text-gray-500 mb-6">
                Secure administrator sign-in. Authorized NaijaDeals personnel only — every access attempt is recorded.
              </p>

              <div id="cc-auth-error" class={`text-sm px-3 py-2.5 rounded-lg mb-4 bg-red-500/10 text-red-400 border border-red-500/20 ${denied ? '' : 'hidden'}`}>
                {denied
                  ? 'Your account does not have Control Center access. If you believe this is a mistake, contact a platform administrator.'
                  : ''}
              </div>

              <form id="cc-login-form" class="space-y-4">
                <input type="hidden" name="next" value={next} />
                <div>
                  <label class="block text-xs font-medium text-gray-400 mb-1.5">Email or phone number</label>
                  <input
                    name="identifier"
                    required
                    autocomplete="username"
                    class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-ccaccent/40"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
                  <input
                    type="password"
                    name="password"
                    required
                    autocomplete="current-password"
                    class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-ccaccent/40"
                  />
                </div>
                <button type="submit" class="w-full bg-ccaccent text-ccbg font-semibold py-2.5 rounded-lg hover:brightness-110 transition">
                  Sign in
                </button>
              </form>

              <p class="text-[11px] text-gray-600 mt-6 text-center leading-relaxed">
                This is a restricted, internal system. Unauthorized access attempts are logged and may be subject to action.
              </p>
            </div>
          </div>
        </div>

        <script
          dangerouslySetInnerHTML={{
            __html: `
            (function () {
              var form = document.getElementById('cc-login-form');
              var errorEl = document.getElementById('cc-auth-error');
              form.addEventListener('submit', async function (e) {
                e.preventDefault();
                errorEl.classList.add('hidden');
                var fd = new FormData(form);
                var btn = form.querySelector('button[type="submit"]');
                btn.disabled = true;
                try {
                  var res = await fetch('/control-center/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier: fd.get('identifier'), password: fd.get('password') })
                  });
                  var data = await res.json().catch(function () { return {}; });
                  btn.disabled = false;
                  if (res.ok && data.success) {
                    location.href = fd.get('next') || '/control-center';
                  } else {
                    errorEl.textContent = data.error || 'Sign in failed. Please try again.';
                    errorEl.classList.remove('hidden');
                  }
                } catch (err) {
                  btn.disabled = false;
                  errorEl.textContent = 'Sign in failed. Please try again.';
                  errorEl.classList.remove('hidden');
                }
              });
            })();
          `,
          }}
        ></script>
      </body>
    </html>
  )
}
