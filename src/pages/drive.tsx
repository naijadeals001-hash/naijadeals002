import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'

const PILOT_ZONES = [
  { key: 'abuja-central', label: 'Abuja Central' },
  { key: 'gwarinpa', label: 'Gwarinpa' },
  { key: 'lokogoma', label: 'Lokogoma' },
]

const VEHICLES = [
  { key: 'car', label: 'Car', capacity: 'Up to 4 passengers', status: 'Pending operational approval', enabled: false },
  { key: 'motorcycle', label: 'Motorcycle', capacity: '1 passenger', status: 'Not enabled for Abuja pilot', enabled: false },
  { key: 'tricycle', label: 'Tricycle', capacity: 'Up to 3 passengers', status: 'Not enabled for Abuja pilot', enabled: false },
  { key: 'van', label: 'Van', capacity: 'Up to 7 passengers', status: 'Not enabled for Abuja pilot', enabled: false },
]

function StatusChip({ children, tone = 'amber' }: { children: any; tone?: 'amber' | 'slate' | 'green' }) {
  const styles = {
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    green: 'bg-green-100 text-green-800 border-green-200',
  }
  return <span class={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[tone]}`}><span class="h-1.5 w-1.5 rounded-full bg-current"></span>{children}</span>
}

export async function drivePage(c: Context<AppEnv>) {
  const user = c.get('user')
  const locale = c.get('locale')

  return c.render(
    <Layout
      title="NaijaDrive"
      description="NaijaDrive private ride preview for the Abuja pilot. Explore the customer, driver and operations journeys without fabricated live data."
      user={user}
      locale={locale}
    >
      <main class="bg-[#f6f8f6]">
        <section class="relative overflow-hidden bg-[#062d17] text-white">
          <div class="absolute inset-0 opacity-30" aria-hidden="true">
            <div class="absolute -right-20 -top-24 h-80 w-80 rounded-full border-[32px] border-[#ffc72c]/40"></div>
            <div class="absolute right-24 top-20 h-36 w-36 rounded-full border border-white/20"></div>
            <svg class="absolute bottom-0 left-0 h-56 w-full" viewBox="0 0 1200 220" preserveAspectRatio="none">
              <path d="M0 190 C180 90 300 210 480 130 S780 60 960 140 S1110 170 1200 80 L1200 220 L0 220Z" fill="#0b7a3b" fill-opacity=".6"></path>
              <path d="M0 210 C220 130 370 220 550 155 S880 90 1200 155" fill="none" stroke="#ffc72c" stroke-opacity=".28" stroke-width="2"></path>
            </svg>
          </div>
          <div class="relative mx-auto grid max-w-[80rem] gap-10 px-4 py-14 md:grid-cols-[1.05fr_.95fr] md:items-center md:px-8 md:py-20">
            <div>
              <div class="flex flex-wrap items-center gap-3">
                <StatusChip tone="amber">Private ride preview</StatusChip>
                <span class="text-xs font-medium text-white/60">Abuja pilot configuration</span>
              </div>
              <h1 class="mt-5 max-w-2xl text-4xl font-bold leading-tight md:text-6xl">Move through Abuja with one trusted account.</h1>
              <p class="mt-5 max-w-xl text-base leading-7 text-white/75 md:text-lg">Explore the real NaijaDrive customer, driver and operations journeys. The interface is live; passenger dispatch is not yet connected to a persistent runtime.</p>
              <div class="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href="#book" class="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#ffc72c] px-6 font-bold text-[#062d17] transition hover:bg-yellow-300"><span class="material-symbols-outlined">near_me</span>Plan a ride</a>
                <a href="#driver" class="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-6 font-bold text-white transition hover:bg-white/15"><span class="material-symbols-outlined">drive_eta</span>I'm a driver</a>
              </div>
              <div class="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
                <span class="flex items-center gap-2"><span class="material-symbols-outlined text-base text-[#ffc72c]">verified_user</span>NaijaDeal identity planned</span>
                <span class="flex items-center gap-2"><span class="material-symbols-outlined text-base text-[#ffc72c]">location_on</span>3 active pilot zones configured</span>
              </div>
            </div>
            <div class="rounded-3xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-sm md:p-5">
              <div class="rounded-2xl bg-[#f8fbf8] p-4 text-[#102119] md:p-5">
                <div class="flex items-center justify-between">
                  <div><p class="text-xs font-semibold uppercase tracking-[.18em] text-[#0b7a3b]">Live product surface</p><h2 class="mt-1 text-xl font-bold">Your Abuja ride plan</h2></div>
                  <span class="material-symbols-outlined rounded-full bg-[#e8f5ec] p-2 text-[#0b7a3b]">route</span>
                </div>
                <div class="mt-5 space-y-3">
                  <div class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><span class="material-symbols-outlined text-[#0b7a3b]">radio_button_checked</span><div><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pickup</p><p class="text-sm font-semibold">Choose an active Abuja zone</p></div></div>
                  <div class="ml-6 h-5 border-l-2 border-dashed border-[#0b7a3b]/30"></div>
                  <div class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><span class="material-symbols-outlined text-[#d38b00]">location_on</span><div><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Destination</p><p class="text-sm font-semibold">Road routing will be connected next</p></div></div>
                </div>
                <div class="mt-5 grid grid-cols-2 gap-3"><div class="rounded-xl bg-[#f6f8f6] p-3"><p class="text-[11px] text-slate-500">Fare estimate</p><p class="mt-1 font-bold text-slate-500">Unavailable</p></div><div class="rounded-xl bg-[#f6f8f6] p-3"><p class="text-[11px] text-slate-500">Driver match</p><p class="mt-1 font-bold text-slate-500">Not connected</p></div></div>
              </div>
            </div>
          </div>
        </section>

        <section class="border-b border-slate-200 bg-white" aria-label="NaijaDrive preview navigation">
          <div class="mx-auto flex max-w-[80rem] gap-2 overflow-x-auto px-4 py-3 md:px-8">
            <a href="#book" class="whitespace-nowrap rounded-lg bg-[#e8f5ec] px-4 py-2 text-sm font-bold text-[#0b7a3b]">Book a ride</a>
            <a href="#share" class="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cab sharing</a>
            <a href="#driver" class="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Driver hub</a>
            <a href="#operations" class="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Control Center</a>
          </div>
        </section>

        <section id="book" class="mx-auto max-w-[80rem] scroll-mt-28 px-4 py-12 md:px-8 md:py-16">
          <div class="grid gap-8 lg:grid-cols-[1.05fr_.95fr]">
            <div>
              <p class="text-sm font-bold uppercase tracking-[.18em] text-[#0b7a3b]">Customer journey</p>
              <h2 class="mt-2 text-3xl font-bold text-slate-900">Plan a private ride</h2>
              <p class="mt-3 max-w-xl text-slate-600">The form validates the currently configured Abuja pilot zones. It will not create a booking until the NestJS runtime, routing and identity services are connected.</p>
              <form id="drive-booking-form" class="mt-7 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
                <div class="grid gap-5 md:grid-cols-2">
                  <label class="block"><span class="text-sm font-bold text-slate-700">Pickup zone</span><select name="pickupZone" required class="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"><option value="">Select pickup zone</option>{PILOT_ZONES.map((zone) => <option value={zone.key}>{zone.label}</option>)}</select></label>
                  <label class="block"><span class="text-sm font-bold text-slate-700">Destination zone</span><select name="dropoffZone" required class="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"><option value="">Select destination zone</option>{PILOT_ZONES.map((zone) => <option value={zone.key}>{zone.label}</option>)}</select></label>
                </div>
                <label class="block"><span class="text-sm font-bold text-slate-700">Pickup note <span class="font-normal text-slate-400">(optional)</span></span><input name="pickupNote" maxLength={160} placeholder="Landmark or meeting point" class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" /></label>
                <div><p class="text-sm font-bold text-slate-700">Vehicle category</p><div class="mt-2 grid gap-3 sm:grid-cols-2">{VEHICLES.map((vehicle) => <label class={`relative flex cursor-not-allowed items-start gap-3 rounded-xl border p-3 ${vehicle.enabled ? 'border-[#0b7a3b] bg-[#f4fbf5]' : 'border-slate-200 bg-slate-50 opacity-75'}`}><input type="radio" name="vehicleCategory" disabled={!vehicle.enabled} class="mt-1" /><span><span class="block text-sm font-bold text-slate-800">{vehicle.label}</span><span class="block text-xs text-slate-500">{vehicle.capacity}</span><span class="mt-1 block text-[11px] font-semibold text-amber-700">{vehicle.status}</span></span></label>)}</div></div>
                <div class="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-sm font-bold text-amber-900">Booking is not live yet</p><p class="mt-1 text-xs leading-5 text-amber-800">All vehicle categories remain disabled until regulatory and operational approval is recorded in the runtime database.</p></div><button type="submit" class="min-h-[44px] rounded-lg bg-slate-300 px-4 text-sm font-bold text-slate-600">Request ride</button></div>
                <p id="drive-booking-status" class="hidden rounded-xl p-3 text-sm" role="status"></p>
              </form>
            </div>
            <aside class="space-y-4"><div class="rounded-2xl bg-[#062d17] p-6 text-white"><div class="flex items-center justify-between"><h3 class="text-lg font-bold">Fare &amp; route readiness</h3><span class="material-symbols-outlined text-[#ffc72c]">calculate</span></div><div class="mt-5 space-y-4 text-sm"><div class="flex items-start gap-3"><span class="material-symbols-outlined text-[#ffc72c]">check_circle</span><div><p class="font-bold">Integer-kobo fare service exists</p><p class="mt-1 text-white/60">The NestJS runtime has fare rules and validation. No estimate is shown here without a connected route calculation.</p></div></div><div class="flex items-start gap-3"><span class="material-symbols-outlined text-amber-300">pending</span><div><p class="font-bold">Road distance and duration</p><p class="mt-1 text-white/60">Not connected. No fabricated ETA, distance or driver position is displayed.</p></div></div></div></div><div class="rounded-2xl border border-slate-200 bg-white p-6"><h3 class="text-lg font-bold text-slate-900">Active Abuja pilot zones</h3><div class="mt-4 space-y-3">{PILOT_ZONES.map((zone) => <div class="flex items-center justify-between rounded-xl bg-[#f6f8f6] px-3 py-3"><span class="text-sm font-semibold text-slate-700">{zone.label}</span><span class="text-xs font-bold text-[#0b7a3b]">Configured</span></div>)}<div class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3"><span class="text-sm font-semibold text-slate-500">Airport axis</span><span class="text-xs font-bold text-slate-500">Inactive</span></div></div></div></aside>
          </div>
        </section>

        <section id="share" class="scroll-mt-28 border-y border-slate-200 bg-white px-4 py-12 md:px-8 md:py-16"><div class="mx-auto max-w-[80rem]"><div class="grid gap-8 lg:grid-cols-[.9fr_1.1fr] lg:items-center"><div><StatusChip tone="slate">Product entry point</StatusChip><h2 class="mt-4 text-3xl font-bold text-slate-900">Cab sharing, designed separately</h2><p class="mt-3 leading-7 text-slate-600">Shared rides are a distinct product: pooled routing, seat inventory, match quality and safety rules must be implemented before this becomes an operational booking flow.</p><a href="#share-status" class="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">View readiness <span class="material-symbols-outlined text-base">arrow_downward</span></a></div><div id="share-status" class="grid gap-3 sm:grid-cols-2"><div class="rounded-2xl border border-slate-200 p-5"><span class="material-symbols-outlined text-3xl text-slate-400">group</span><h3 class="mt-3 font-bold">Shared matching</h3><p class="mt-2 text-sm text-slate-500">Not implemented. No passenger match or seat inventory is represented.</p></div><div class="rounded-2xl border border-slate-200 p-5"><span class="material-symbols-outlined text-3xl text-slate-400">alt_route</span><h3 class="mt-3 font-bold">Pooled routing</h3><p class="mt-2 text-sm text-slate-500">Not implemented. Routing provider integration is still required.</p></div></div></div></div></section>

        <section id="driver" class="scroll-mt-28 mx-auto max-w-[80rem] px-4 py-12 md:px-8 md:py-16"><div class="grid gap-8 lg:grid-cols-[1fr_1fr]"><div><p class="text-sm font-bold uppercase tracking-[.18em] text-[#0b7a3b]">Driver hub</p><h2 class="mt-2 text-3xl font-bold text-slate-900">Earn on your terms. Operate with controls.</h2><p class="mt-3 leading-7 text-slate-600">This is the driver workflow shell. Identity, approval, vehicle eligibility and Redis-backed availability are implemented in the separate NestJS runtime, but no driver account or offer is fabricated in this preview.</p><div class="mt-6 flex flex-wrap gap-3"><a href="/register" class="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0b7a3b] px-5 text-sm font-bold text-white hover:bg-[#062d17]"><span class="material-symbols-outlined text-base">person_add</span>Start registration</a><a href="/login" class="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">Sign in</a></div></div><div class="grid gap-3 sm:grid-cols-2"><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">badge</span><h3 class="mt-4 font-bold">Onboarding</h3><p class="mt-2 text-sm text-slate-500">Documents and verification status require authenticated runtime workflows.</p></div><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">notifications</span><h3 class="mt-4 font-bold">Ride offers</h3><p class="mt-2 text-sm text-slate-500">No live offers are shown until dispatch and WebSocket delivery are connected.</p></div><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">toggle_on</span><h3 class="mt-4 font-bold">Availability</h3><p class="mt-2 text-sm text-slate-500">The runtime has Redis presence primitives; this UI does not claim a live heartbeat.</p></div><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">sos</span><h3 class="mt-4 font-bold">Safety</h3><p class="mt-2 text-sm text-slate-500">Incident and SOS workflows remain to be connected to Control Center.</p></div></div></div></section>

        <section id="operations" class="scroll-mt-28 bg-[#0e1d15] px-4 py-12 text-white md:px-8 md:py-16"><div class="mx-auto max-w-[80rem]"><div class="flex flex-col justify-between gap-6 md:flex-row md:items-end"><div><p class="text-sm font-bold uppercase tracking-[.18em] text-[#ffc72c]">Integrated operations</p><h2 class="mt-2 text-3xl font-bold">NaijaDeal Control Center</h2><p class="mt-3 max-w-2xl leading-7 text-white/65">NaijaDrive operations belong inside the existing permissioned Control Center. This entry preserves the real RBAC boundary; it does not create a parallel admin system.</p></div><a href="/control-center/login" class="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#ffc72c] px-5 text-sm font-bold text-[#062d17] hover:bg-yellow-300">Open Control Center <span class="material-symbols-outlined text-base">open_in_new</span></a></div><div class="mt-8 grid gap-3 md:grid-cols-4"><div class="rounded-2xl border border-white/10 bg-white/5 p-4"><span class="material-symbols-outlined text-[#ffc72c]">monitoring</span><p class="mt-3 text-sm font-bold">Ride monitoring</p><p class="mt-1 text-xs text-white/50">Permissioned screen pending ride engine data.</p></div><div class="rounded-2xl border border-white/10 bg-white/5 p-4"><span class="material-symbols-outlined text-[#ffc72c]">fact_check</span><p class="mt-3 text-sm font-bold">Driver verification</p><p class="mt-1 text-xs text-white/50">Uses existing Control Center RBAC patterns.</p></div><div class="rounded-2xl border border-white/10 bg-white/5 p-4"><span class="material-symbols-outlined text-[#ffc72c]">map</span><p class="mt-3 text-sm font-bold">Zones &amp; eligibility</p><p class="mt-1 text-xs text-white/50">Abuja configuration is in the runtime migrations.</p></div><div class="rounded-2xl border border-white/10 bg-white/5 p-4"><span class="material-symbols-outlined text-[#ffc72c]">history</span><p class="mt-3 text-sm font-bold">Audit history</p><p class="mt-1 text-xs text-white/50">Ride audit persistence exists in PostgreSQL.</p></div></div></div></section>

        <section class="mx-auto max-w-[80rem] px-4 py-10 md:px-8"><div class="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:flex-row md:items-center md:justify-between md:p-6"><div><p class="text-sm font-bold text-slate-900">Part of the NaijaDeals ecosystem</p><p class="mt-1 text-sm text-slate-500">Explore food, marketplace, services and stays using the existing account shell.</p></div><a href="/ecosystem" class="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">Explore ecosystem <span class="material-symbols-outlined text-base">arrow_forward</span></a></div></section>
      </main>
      <script dangerouslySetInnerHTML={{ __html: `
        const form = document.getElementById('drive-booking-form');
        const status = document.getElementById('drive-booking-status');
        form?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const data = new FormData(form);
          status.className = 'rounded-xl bg-slate-100 p-3 text-sm text-slate-700';
          status.textContent = 'Checking NaijaDrive booking services…';
          try {
            const response = await fetch('/api/drive/preview-booking', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(data.entries())) });
            const body = await response.json();
            status.className = response.ok ? 'rounded-xl bg-green-100 p-3 text-sm text-green-800' : 'rounded-xl bg-amber-100 p-3 text-sm text-amber-900';
            status.textContent = body.error || 'Booking request accepted.';
          } catch {
            status.className = 'rounded-xl bg-red-100 p-3 text-sm text-red-800';
            status.textContent = 'The preview could not reach the booking service. No booking was created.';
          }
        });
      ` }}></script>
    </Layout>
  )
}
