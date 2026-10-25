import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'

const PILOT_ZONES = [
  { key: 'abuja-central', label: 'Abuja Central' },
  { key: 'gwarinpa', label: 'Gwarinpa' },
  { key: 'lokogoma', label: 'Lokogoma' },
]

const VEHICLES = [
  { key: 'car', label: 'Car', capacity: 'Up to 4 passengers', status: 'Fare simulation available; booking disabled', enabled: false, estimateEnabled: true },
  { key: 'motorcycle', label: 'Motorcycle', capacity: '1 passenger', status: 'Not enabled for Abuja pilot', enabled: false, estimateEnabled: false },
  { key: 'tricycle', label: 'Tricycle', capacity: 'Up to 3 passengers', status: 'Not enabled for Abuja pilot', enabled: false, estimateEnabled: false },
  { key: 'van', label: 'Van', capacity: 'Up to 7 passengers', status: 'Not enabled for Abuja pilot', enabled: false, estimateEnabled: false },
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
                <div class="mt-5 grid grid-cols-2 gap-3"><div class="rounded-xl bg-[#f6f8f6] p-3"><p class="text-[11px] text-slate-500">Fare estimate</p><p id="hero-fare-estimate" class="mt-1 font-bold text-slate-500">Unavailable</p><p id="hero-fare-mode" class="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">No estimate requested</p></div><div class="rounded-xl bg-[#f6f8f6] p-3"><p class="text-[11px] text-slate-500">Driver match</p><p class="mt-1 font-bold text-slate-500">Not connected</p></div></div>
              </div>
            </div>
          </div>
        </section>

        <section class="border-b border-slate-200 bg-white" aria-label="NaijaDrive preview navigation">
          <div class="mx-auto flex max-w-[80rem] gap-2 overflow-x-auto px-4 py-3 md:px-8">
            <a href="#book" class="whitespace-nowrap rounded-lg bg-[#e8f5ec] px-4 py-2 text-sm font-bold text-[#0b7a3b]">Book a ride</a>
            <a href="#share" class="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cab sharing</a>
            <a href="#driver" class="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Driver hub</a>
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
                <div><p class="text-sm font-bold text-slate-700">Vehicle category</p><div class="mt-2 grid gap-3 sm:grid-cols-2">{VEHICLES.map((vehicle) => <label class={`relative flex items-start gap-3 rounded-xl border p-3 ${vehicle.estimateEnabled ? 'cursor-pointer border-[#0b7a3b] bg-[#f4fbf5]' : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-75'}`}><input type="radio" name="vehicleCategory" value={vehicle.key} checked={vehicle.key === 'car'} disabled={!vehicle.estimateEnabled} class="mt-1" /><span><span class="block text-sm font-bold text-slate-800">{vehicle.label}</span><span class="block text-xs text-slate-500">{vehicle.capacity}</span><span class="mt-1 block text-[11px] font-semibold text-amber-700">{vehicle.status}</span></span></label>)}</div></div>
                <div class="rounded-xl border border-[#b8dfc1] bg-[#f4fbf5] p-4"><div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-sm font-bold text-[#062d17]">Fare estimate modes</p><p class="mt-1 text-xs leading-5 text-slate-600">Routed estimates require a configured provider. Demo estimates use clearly labelled fixtures and never become live quotes.</p></div><div class="flex flex-wrap gap-2"><button id="routed-fare-button" type="button" class="min-h-[44px] rounded-lg bg-[#0b7a3b] px-4 text-sm font-bold text-white hover:bg-[#062d17]">Get routed fare</button><button id="simulated-fare-button" type="button" class="min-h-[44px] rounded-lg border border-[#0b7a3b] px-4 text-sm font-bold text-[#0b7a3b] hover:bg-white">Use demo estimate</button></div></div><p id="drive-fare-status" class="hidden mt-3 rounded-xl p-3 text-sm" role="status"></p></div>
                <div class="flex flex-col gap-3 rounded-xl border border-[#b8dfc1] bg-[#f4fbf5] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-sm font-bold text-[#062d17]">Private ride request is available in pilot mode</p><p class="mt-1 text-xs leading-5 text-slate-600">Your request is persisted with a simulated quote. Driver supply, GPS and external payment remain explicitly separate runtime states.</p></div><button type="submit" class="min-h-[44px] rounded-lg bg-[#0b7a3b] px-4 text-sm font-bold text-white">Request ride</button></div>
                <p id="drive-booking-status" class="hidden rounded-xl p-3 text-sm" role="status"></p>
              </form>
            </div>
            <aside class="space-y-4"><div class="rounded-2xl bg-[#062d17] p-6 text-white"><div class="flex items-center justify-between"><h3 class="text-lg font-bold">Fare &amp; route readiness</h3><span class="material-symbols-outlined text-[#ffc72c]">calculate</span></div><div class="mt-5 space-y-4 text-sm"><div class="flex items-start gap-3"><span class="material-symbols-outlined text-[#ffc72c]">check_circle</span><div><p class="font-bold">Integer-kobo fare service connected</p><p class="mt-1 text-white/60">The preview reuses the existing runtime fare formula in both routed and explicitly simulated modes.</p></div></div><div class="flex items-start gap-3"><span class="material-symbols-outlined text-amber-300">pending</span><div><p class="font-bold">Live road distance and duration</p><p id="hero-route-status" class="mt-1 text-white/60">Routed mode is unavailable until a verified provider is configured. No silent simulation fallback is used.</p></div></div></div></div><div class="rounded-2xl border border-slate-200 bg-white p-6"><h3 class="text-lg font-bold text-slate-900">Active Abuja pilot zones</h3><div class="mt-4 space-y-3">{PILOT_ZONES.map((zone) => <div class="flex items-center justify-between rounded-xl bg-[#f6f8f6] px-3 py-3"><span class="text-sm font-semibold text-slate-700">{zone.label}</span><span class="text-xs font-bold text-[#0b7a3b]">Configured</span></div>)}<div class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3"><span class="text-sm font-semibold text-slate-500">Airport axis</span><span class="text-xs font-bold text-slate-500">Inactive</span></div></div></div></aside>
          </div>
        </section>

        <section id="carpool" class="scroll-mt-28 border-y border-slate-200 bg-white px-4 py-12 md:px-8 md:py-16"><div class="mx-auto max-w-[80rem]"><div class="grid gap-8 lg:grid-cols-[.9fr_1.1fr] lg:items-start"><div><StatusChip tone="green">Shared rides</StatusChip><h2 class="mt-4 text-3xl font-bold text-slate-900">Publish or find a carpool trip</h2><p class="mt-3 leading-7 text-slate-600">Carpooling has separate trip and seat inventory rules. It is not a private cab request and does not invent driver supply.</p><form id="carpool-search-form" class="mt-5 grid gap-3 sm:grid-cols-2"><input name="origin" placeholder="From" class="rounded-xl border border-slate-300 px-3 py-3 text-sm" /><input name="destination" placeholder="To" class="rounded-xl border border-slate-300 px-3 py-3 text-sm" /><button class="sm:col-span-2 min-h-[44px] rounded-xl bg-[#0b7a3b] px-4 text-sm font-bold text-white">Find available trips</button></form><p id="carpool-status" class="mt-3 hidden rounded-xl p-3 text-sm" role="status"></p></div><div id="carpool-results" class="grid gap-3"><div class="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">Search for a route to see only persisted, published trips with available seats.</div></div></div></div></section>

        <section id="share" class="scroll-mt-28 border-y border-slate-200 bg-white px-4 py-12 md:px-8 md:py-16"><div class="mx-auto max-w-[80rem]"><div class="grid gap-8 lg:grid-cols-[.9fr_1.1fr] lg:items-center"><div><StatusChip tone="slate">Product entry point</StatusChip><h2 class="mt-4 text-3xl font-bold text-slate-900">Cab sharing, designed separately</h2><p class="mt-3 leading-7 text-slate-600">Shared rides are a distinct product: pooled routing, seat inventory, match quality and safety rules must be implemented before this becomes an operational booking flow.</p><a href="#share-status" class="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">View readiness <span class="material-symbols-outlined text-base">arrow_downward</span></a></div><div id="share-status" class="grid gap-3 sm:grid-cols-2"><div class="rounded-2xl border border-slate-200 p-5"><span class="material-symbols-outlined text-3xl text-slate-400">group</span><h3 class="mt-3 font-bold">Shared matching</h3><p class="mt-2 text-sm text-slate-500">Not implemented. No passenger match or seat inventory is represented.</p></div><div class="rounded-2xl border border-slate-200 p-5"><span class="material-symbols-outlined text-3xl text-slate-400">alt_route</span><h3 class="mt-3 font-bold">Pooled routing</h3><p class="mt-2 text-sm text-slate-500">Not implemented. Routing provider integration is still required.</p></div></div></div></div></section>

        <section id="driver" class="scroll-mt-28 mx-auto max-w-[80rem] px-4 py-12 md:px-8 md:py-16"><div class="grid gap-8 lg:grid-cols-[1fr_1fr]"><div><p class="text-sm font-bold uppercase tracking-[.18em] text-[#0b7a3b]">Driver hub</p><h2 class="mt-2 text-3xl font-bold text-slate-900">Earn on your terms. Operate with controls.</h2><p class="mt-3 leading-7 text-slate-600">This is the driver workflow shell. Identity, approval, vehicle eligibility and Redis-backed availability are implemented in the separate NestJS runtime, but no driver account or offer is fabricated in this preview.</p><div class="mt-6 flex flex-wrap gap-3"><a href="/register" class="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0b7a3b] px-5 text-sm font-bold text-white hover:bg-[#062d17]"><span class="material-symbols-outlined text-base">person_add</span>Start registration</a><a href="/login" class="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">Sign in</a></div></div><div class="grid gap-3 sm:grid-cols-2"><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">badge</span><h3 class="mt-4 font-bold">Onboarding</h3><p class="mt-2 text-sm text-slate-500">Documents and verification status require authenticated runtime workflows.</p></div><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">notifications</span><h3 class="mt-4 font-bold">Ride offers</h3><p class="mt-2 text-sm text-slate-500">No live offers are shown until dispatch and WebSocket delivery are connected.</p></div><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">toggle_on</span><h3 class="mt-4 font-bold">Availability</h3><p class="mt-2 text-sm text-slate-500">The runtime has Redis presence primitives; this UI does not claim a live heartbeat.</p></div><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">sos</span><h3 class="mt-4 font-bold">Safety</h3><p class="mt-2 text-sm text-slate-500">Incident and SOS workflows remain to be connected to Control Center.</p></div></div></div></section>

        <section class="mx-auto max-w-[80rem] px-4 py-10 md:px-8"><div class="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:flex-row md:items-center md:justify-between md:p-6"><div><p class="text-sm font-bold text-slate-900">Part of the NaijaDeals ecosystem</p><p class="mt-1 text-sm text-slate-500">Explore food, marketplace, services and stays using the existing account shell.</p></div><a href="/ecosystem" class="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">Explore ecosystem <span class="material-symbols-outlined text-base">arrow_forward</span></a></div></section>
      </main>
      <script dangerouslySetInnerHTML={{ __html: `
        const carpoolForm = document.getElementById('carpool-search-form');
        const carpoolResults = document.getElementById('carpool-results');
        const carpoolStatus = document.getElementById('carpool-status');
        carpoolForm?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const query = new URLSearchParams(Object.fromEntries(new FormData(carpoolForm).entries()));
          if (carpoolStatus) { carpoolStatus.className = 'mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700'; carpoolStatus.textContent = 'Finding published trips with seats…'; }
          try {
            const response = await fetch('/api/carpool/trips?' + query.toString());
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'Carpool search unavailable.');
            carpoolResults.innerHTML = body.trips.length ? body.trips.map((trip) => '<article class="rounded-2xl border border-slate-200 bg-white p-4"><div class="flex items-center justify-between gap-3"><strong>' + trip.origin + ' → ' + trip.destination + '</strong><span class="text-xs font-bold text-[#0b7a3b]">' + trip.seats_available + ' seat(s)</span></div><p class="mt-2 text-sm text-slate-500">Departure ' + new Date(trip.departure_at).toLocaleString() + '</p><p class="mt-1 text-sm font-semibold">Contribution: ₦' + (Number(trip.contribution_kobo) / 100).toLocaleString('en-NG') + '</p></article>').join('') : '<div class="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">No published trips with seats matched this route.</div>';
            if (carpoolStatus) { carpoolStatus.className = 'mt-3 rounded-xl bg-green-100 p-3 text-sm text-green-900'; carpoolStatus.textContent = body.trips.length + ' persisted trip(s) found. No driver supply was fabricated.'; }
          } catch (error) { if (carpoolStatus) { carpoolStatus.className = 'mt-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900'; carpoolStatus.textContent = error instanceof Error ? error.message : 'Carpool search unavailable.'; } }
        });
        const form = document.getElementById('drive-booking-form');
        const routedButton = document.getElementById('routed-fare-button');
        const simulatedButton = document.getElementById('simulated-fare-button');
        const fareStatus = document.getElementById('drive-fare-status');
        const bookingStatus = document.getElementById('drive-booking-status');
        const heroFare = document.getElementById('hero-fare-estimate');
        const heroFareMode = document.getElementById('hero-fare-mode');
        const heroRouteStatus = document.getElementById('hero-route-status');
        async function requestFare(mode) {
          if (!form || !fareStatus) return;
          const button = mode === 'routed' ? routedButton : simulatedButton;
          const data = Object.fromEntries(new FormData(form).entries());
          button?.setAttribute('disabled', 'true');
          if (button) button.textContent = mode === 'routed' ? 'Routing…' : 'Estimating…';
          fareStatus.className = 'mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700';
          fareStatus.textContent = mode === 'routed' ? 'Requesting a verified road route…' : 'Calculating a simulated Abuja fare…';
          try {
            const response = await fetch('/api/drive/fare-estimate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...data, mode }) });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'Fare estimate unavailable.');
            fareStatus.className = 'mt-3 rounded-xl bg-green-100 p-3 text-sm text-green-900';
            const modeLabel = body.mode === 'routed' ? 'Routed estimate from ' + body.routeProvider : 'Simulated estimate';
            fareStatus.textContent = modeLabel + ': ₦' + body.fareNaira + ' (' + body.distanceKm + ' km / ' + body.durationMinutes + ' min). ' + body.disclaimer;
            if (heroFare) heroFare.textContent = '₦' + body.fareNaira;
            if (heroFareMode) heroFareMode.textContent = body.mode === 'routed' ? 'Routed estimate' : 'Simulated estimate';
            if (heroRouteStatus) heroRouteStatus.textContent = body.mode === 'routed' ? 'Road distance and duration supplied by ' + body.routeProvider + '.' : 'Simulated zone route only; no live road distance or ETA.';
          } catch (error) {
            fareStatus.className = 'mt-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900';
            fareStatus.textContent = error instanceof Error ? error.message : 'Fare estimate unavailable.';
            if (heroFare) heroFare.textContent = 'Unavailable';
            if (heroFareMode) heroFareMode.textContent = mode === 'routed' ? 'Routed estimate unavailable' : 'Estimate unavailable';
          } finally {
            button?.removeAttribute('disabled');
            if (button) button.textContent = mode === 'routed' ? 'Get routed fare' : 'Use demo estimate';
          }
        }
        routedButton?.addEventListener('click', () => requestFare('routed'));
        simulatedButton?.addEventListener('click', () => requestFare('simulated'));
        form?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const data = new FormData(form);
          if (!bookingStatus) return;
          bookingStatus.className = 'rounded-xl bg-slate-100 p-3 text-sm text-slate-700';
          bookingStatus.textContent = 'Checking NaijaDrive booking services…';
          try {
            const payload = Object.fromEntries(data.entries());
            payload.idempotencyKey = 'drive-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            const response = await fetch('/api/drive/rides', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
            const body = await response.json();
            if (response.status === 401) throw new Error('Sign in to persist a private ride request.');
            if (!response.ok) throw new Error(body.error || 'Ride request unavailable.');
            bookingStatus.className = 'rounded-xl bg-green-100 p-3 text-sm text-green-800';
            bookingStatus.textContent = 'Ride request #' + body.ride.id + ' persisted as ' + body.ride.status + '. Quote: ₦' + (Number(body.ride.fare_kobo) / 100).toLocaleString('en-NG') + '. Driver matching is refresh-based; no GPS or driver supply is fabricated.';
          } catch {
            bookingStatus.className = 'rounded-xl bg-red-100 p-3 text-sm text-red-800';
            bookingStatus.textContent = 'The preview could not reach the booking service. No booking was created.';
          }
        });
      ` }}></script>
    </Layout>
  )
}
