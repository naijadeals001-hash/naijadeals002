import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'

const PILOT_ZONES = [
  { key: 'abuja-central', label: 'Abuja Central' },
  { key: 'gwarinpa', label: 'Gwarinpa' },
  { key: 'lokogoma', label: 'Lokogoma' },
]

const VEHICLES = [
  { key: 'economy', label: 'Naija Economy', marketLabel: 'Everyday rides', capacity: 'Up to 4 passengers', status: 'Pilot estimate available', estimateEnabled: true },
  { key: 'comfort', label: 'Naija Comfort', marketLabel: 'Extra comfort for everyday travel', capacity: 'Newer cars · up to 4', status: 'Coming next in Abuja', estimateEnabled: false },
  { key: 'xl', label: 'Naija XL', marketLabel: 'More seats for groups', capacity: 'Up to 6 passengers', status: 'Coming next in Abuja', estimateEnabled: false },
  { key: 'premium', label: 'Naija Premium', marketLabel: 'Executive service', capacity: 'Premium vehicles · up to 4', status: 'Coming next in Abuja', estimateEnabled: false },
]

const APP_LINKS = {
  ios: '#waitlist',
  android: '#waitlist',
}

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
        <section class="relative isolate overflow-hidden bg-[#062d17] text-white">
          <picture class="absolute inset-0 -z-20 block">
            <source media="(max-width: 767px)" srcset="/static/drive-media/hero-lagos.png" />
            <img src="/static/drive-media/hero-lagos.png" alt="NaijaDrive vehicle and driver in a Nigerian city" class="h-full w-full object-cover object-center" />
          </picture>
          <div class="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(2,35,20,.95)_0%,rgba(2,35,20,.78)_42%,rgba(2,35,20,.2)_78%,rgba(2,35,20,.35)_100%)]"></div>
          <div class="absolute inset-0 -z-10 bg-gradient-to-t from-[#062d17]/80 via-transparent to-[#062d17]/20"></div>
          <header class="border-b border-white/15 bg-[#062d17]/35 backdrop-blur-md" aria-label="NaijaDrive brand navigation">
            <div class="mx-auto flex max-w-[80rem] items-center justify-between gap-4 px-4 py-4 md:px-8">
              <a href="/drive" class="flex items-center gap-3" aria-label="NaijaDrive home"><span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#008751] text-white shadow-lg shadow-black/20"><span class="material-symbols-outlined">directions_car</span></span><span><strong class="block text-xl font-black tracking-tight">Naija<span class="text-[#8be0a9]">Drive</span></strong><span class="hidden text-[10px] font-semibold uppercase tracking-[.2em] text-white/60 sm:block">Move your way. Get there safely.</span></span></a>
              <nav class="hidden items-center gap-6 text-xs font-bold text-white/75 lg:flex" aria-label="NaijaDrive sections"><a href="#book" class="transition hover:text-white">Rides</a><a href="#services" class="transition hover:text-white">Services</a><a href="#carpool" class="transition hover:text-white">Shared rides</a><a href="#driver" class="transition hover:text-white">Drive with us</a></nav>
              <div class="flex items-center gap-2"><span class="hidden rounded-full border border-white/20 bg-white/10 px-3 py-2 text-[10px] font-bold text-white/80 sm:inline-flex"><span class="material-symbols-outlined mr-1 text-sm text-[#8be0a9]">verified_user</span>Abuja pilot</span><a href="/login" class="rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/20">Sign in</a></div>
            </div>
          </header>
          <div class="relative mx-auto grid min-h-[42rem] max-w-[80rem] gap-12 px-4 py-14 md:grid-cols-[1fr_.82fr] md:items-center md:px-8 md:py-20">
            <div class="max-w-2xl"><div class="flex flex-wrap items-center gap-3"><StatusChip tone="green">Premium urban mobility</StatusChip><span class="text-xs font-semibold text-white/65">Designed for African cities</span></div><h1 class="mt-6 max-w-xl text-5xl font-black leading-[.94] tracking-[-.04em] md:text-7xl">Move with <span class="text-[#8be0a9]">confidence.</span></h1><p class="mt-6 max-w-lg text-base leading-7 text-white/75 md:text-lg">A safer, clearer way to move through Abuja — from your first pickup to the last mile home.</p><div class="mt-8 flex flex-col gap-3 sm:flex-row"><a href="#book" class="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-[#ffc72c] px-7 font-black text-[#062d17] shadow-xl shadow-black/20 transition hover:bg-yellow-300"><span class="material-symbols-outlined">near_me</span>Plan your ride</a><a href="#services" class="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-7 font-bold text-white backdrop-blur transition hover:bg-white/20"><span class="material-symbols-outlined">explore</span>Explore services</a></div><div class="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-white/20 pt-5"><div><p class="text-2xl font-black">3</p><p class="mt-1 text-[10px] font-bold uppercase tracking-[.15em] text-white/55">Pilot zones</p></div><div><p class="text-2xl font-black">₦</p><p class="mt-1 text-[10px] font-bold uppercase tracking-[.15em] text-white/55">Clear pricing</p></div><div><p class="text-2xl font-black">24/7</p><p class="mt-1 text-[10px] font-bold uppercase tracking-[.15em] text-white/55">Ride status</p></div></div></div>
            <div class="relative mx-auto w-full max-w-md"><div class="absolute -right-4 -top-5 z-10 rounded-2xl bg-[#ffc72c] px-4 py-3 text-[#062d17] shadow-2xl"><p class="text-[10px] font-black uppercase tracking-[.15em]">Your route. Your way.</p><p class="mt-1 text-xs font-bold">Built around how Africa moves.</p></div><div class="rounded-[2rem] border border-white/25 bg-white/12 p-3 shadow-2xl backdrop-blur-md md:p-4"><div class="rounded-[1.5rem] bg-white p-5 text-[#102119] shadow-xl"><div class="flex items-start justify-between"><div><p class="text-[10px] font-black uppercase tracking-[.2em] text-[#008751]">Quick ride planner</p><h2 class="mt-2 text-2xl font-black">Where are you going?</h2></div><span class="rounded-2xl bg-[#e8f5ec] p-3 text-[#008751]"><span class="material-symbols-outlined">route</span></span></div><div class="mt-6 space-y-3"><div class="flex items-center gap-3 rounded-2xl border border-slate-200 p-3"><span class="material-symbols-outlined text-[#008751]">radio_button_checked</span><div><p class="text-[10px] font-bold uppercase tracking-[.15em] text-slate-400">Pickup</p><p class="mt-1 text-sm font-bold">Choose an active Abuja zone</p></div></div><div class="ml-6 h-5 border-l-2 border-dashed border-[#008751]/30"></div><div class="flex items-center gap-3 rounded-2xl border border-slate-200 p-3"><span class="material-symbols-outlined text-[#d38b00]">location_on</span><div><p class="text-[10px] font-bold uppercase tracking-[.15em] text-slate-400">Destination</p><p class="mt-1 text-sm font-bold">Road routing coming next</p></div></div></div><a href="#book" class="mt-6 flex min-h-[48px] items-center justify-center rounded-2xl bg-[#008751] text-sm font-black text-white transition hover:bg-[#006d41]">Start planning</a><div class="mt-5 flex items-center gap-2 text-xs text-slate-500"><span class="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8f5ec] text-[#008751]"><span class="material-symbols-outlined text-sm">shield</span></span>Transparent pilot experience — no fake live supply</div></div></div></div>
          </div>
        </section>

        <section class="border-b border-slate-200 bg-white" aria-label="NaijaDrive preview navigation">
          <div class="mx-auto flex max-w-[80rem] gap-2 overflow-x-auto px-4 py-3 md:px-8">
            <a href="#book" class="whitespace-nowrap rounded-lg bg-[#e8f5ec] px-4 py-2 text-sm font-bold text-[#0b7a3b]">Book a ride</a>
            <a href="#share" class="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cab sharing</a>
            <a href="#driver" class="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Driver hub</a>
          </div>
        </section>

        <section id="experience" class="border-b border-[#dcebe1] bg-white px-4 py-12 md:px-8 md:py-16" aria-labelledby="experience-heading">
          <div class="mx-auto max-w-[80rem]">
            <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p class="text-xs font-black uppercase tracking-[.2em] text-[#008751]">One connected ride flow</p><h2 id="experience-heading" class="mt-2 text-3xl font-black tracking-tight text-[#102119] md:text-4xl">From pickup to trip complete.</h2><p class="mt-3 max-w-2xl text-sm leading-6 text-slate-600">A product preview of the moments NaijaDrive is designed to make simple. The active Abuja pilot is honest about which steps are persisted today and which integrations are next.</p></div><StatusChip tone="green">Preview journey</StatusChip></div>
            <div class="mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 md:grid md:grid-cols-6 md:overflow-visible">
              <article class="min-w-[170px] snap-start rounded-[1.5rem] border border-[#dcebe1] bg-[#f4fbf7] p-3 shadow-sm"><div class="rounded-[1.2rem] bg-[#008751] p-3 text-white"><div class="flex justify-between text-[9px] font-bold"><span>09:41</span><span class="material-symbols-outlined text-xs">wifi</span></div><div class="flex min-h-[150px] flex-col items-center justify-center text-center"><span class="flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#008751]"><span class="material-symbols-outlined">directions_car</span></span><p class="mt-3 text-lg font-black">Naija<span class="text-[#ffc72c]">Drive</span></p><p class="mt-1 text-[9px] text-white/70">Move your way.</p></div><div class="rounded-full bg-[#ffc72c] py-2 text-center text-[10px] font-black text-[#102119]">Get started</div></div><h3 class="mt-3 text-sm font-black text-[#102119]">Get started</h3><p class="mt-1 text-[11px] leading-4 text-slate-500">A trusted account for every journey.</p></article>
              <article class="min-w-[170px] snap-start rounded-[1.5rem] border border-[#dcebe1] bg-white p-3 shadow-sm"><div class="rounded-[1.2rem] bg-[#e2f3e6] p-3 text-[#102119]"><div class="flex items-center justify-between text-[9px] font-bold"><span class="material-symbols-outlined text-xs">menu</span><span>Abuja</span><span class="material-symbols-outlined text-xs">person</span></div><div class="relative mt-3 min-h-[126px] overflow-hidden rounded-xl bg-[#c6e7ce]"><div class="absolute left-1/2 top-0 h-full w-5 rotate-12 bg-white/70"></div><div class="absolute left-0 top-1/2 h-4 w-full -rotate-6 bg-white/70"></div><span class="absolute bottom-5 left-6 rounded-full bg-[#008751] p-1 text-white"><span class="material-symbols-outlined text-sm">my_location</span></span><span class="absolute right-6 top-6 rounded-full bg-[#e05c4c] p-1 text-white"><span class="material-symbols-outlined text-sm">location_on</span></span></div><div class="mt-2 rounded-xl bg-white p-2 text-[10px] font-bold shadow-sm">Where are you going?</div></div><h3 class="mt-3 text-sm font-black text-[#102119]">Choose a route</h3><p class="mt-1 text-[11px] leading-4 text-slate-500">Start with a pickup and destination.</p></article>
              <article class="min-w-[170px] snap-start rounded-[1.5rem] border border-[#dcebe1] bg-white p-3 shadow-sm"><div class="rounded-[1.2rem] bg-[#f4f8f5] p-3 text-[#102119]"><div class="flex items-center justify-between text-[9px] font-bold"><span>Choose a ride</span><span class="material-symbols-outlined text-xs text-[#008751]">tune</span></div><div class="mt-3 space-y-2"><div class="flex items-center justify-between rounded-lg border-2 border-[#008751] bg-white p-2"><span class="material-symbols-outlined text-[#008751]">directions_car</span><span class="text-[10px] font-bold">Economy</span><strong class="text-[10px] text-[#008751]">₦3,200</strong></div><div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2"><span class="material-symbols-outlined text-slate-500">airport_shuttle</span><span class="text-[10px] font-bold">Comfort</span><strong class="text-[10px]">Next</strong></div><div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2"><span class="material-symbols-outlined text-slate-500">groups</span><span class="text-[10px] font-bold">XL</span><strong class="text-[10px]">Next</strong></div><div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2"><span class="material-symbols-outlined text-slate-500">workspace_premium</span><span class="text-[10px] font-bold">Premium</span><strong class="text-[10px]">Next</strong></div></div><div class="mt-3 rounded-full bg-[#008751] py-2 text-center text-[10px] font-black text-white">Request ride</div></div><h3 class="mt-3 text-sm font-black text-[#102119]">Select your ride</h3><p class="mt-1 text-[11px] leading-4 text-slate-500">Transparent fare modes, clearly labelled.</p></article>
              <article class="min-w-[170px] snap-start rounded-[1.5rem] border border-[#dcebe1] bg-white p-3 shadow-sm"><div class="rounded-[1.2rem] bg-[#e2f3e6] p-3 text-[#102119]"><div class="flex justify-between text-[9px] font-bold"><span>Driver on the way</span><span class="material-symbols-outlined text-xs">more_horiz</span></div><div class="relative mt-3 min-h-[126px] overflow-hidden rounded-xl bg-[#b9dfc3]"><div class="absolute left-1/3 top-0 h-full w-5 rotate-[35deg] bg-white/80"></div><div class="absolute right-1/3 top-0 h-full w-4 -rotate-[35deg] bg-white/80"></div><span class="absolute bottom-5 left-1/2 rounded-full bg-[#008751] p-1 text-white"><span class="material-symbols-outlined text-sm">directions_car</span></span><span class="absolute right-5 top-5 rounded-full bg-[#e05c4c] p-1 text-white"><span class="material-symbols-outlined text-sm">location_on</span></span></div><div class="mt-2 flex items-center gap-2 rounded-xl bg-white p-2 shadow-sm"><span class="flex h-7 w-7 items-center justify-center rounded-full bg-[#dcebe1] text-[#008751]"><span class="material-symbols-outlined text-sm">person</span></span><span class="text-[9px] font-bold">Daniel Okafor<br /><span class="font-normal text-slate-500">Arriving in 4 min</span></span></div></div><h3 class="mt-3 text-sm font-black text-[#102119]">Meet your driver</h3><p class="mt-1 text-[11px] leading-4 text-slate-500">Identity, vehicle and PIN stay visible.</p></article>
              <article class="min-w-[170px] snap-start rounded-[1.5rem] border border-[#dcebe1] bg-white p-3 shadow-sm"><div class="rounded-[1.2rem] bg-[#f4f8f5] p-3 text-[#102119]"><div class="flex items-center justify-between text-[9px] font-bold"><span>Trip in progress</span><span class="rounded-full bg-[#e8f5ec] px-2 py-1 text-[#008751]">18 min</span></div><div class="relative mt-3 min-h-[126px] overflow-hidden rounded-xl bg-[#d5eedb]"><div class="absolute left-1/2 top-0 h-full w-6 rotate-[30deg] bg-white/90"></div><span class="absolute left-1/3 top-1/3 h-3 w-3 rounded-full bg-[#008751] ring-4 ring-white"></span><span class="absolute bottom-4 right-1/4 h-3 w-3 rounded-full bg-[#e05c4c] ring-4 ring-white"></span></div><div class="mt-2 flex justify-between text-[10px] font-bold"><span>Victoria Island</span><span class="text-[#008751]">₦3,200</span></div></div><h3 class="mt-3 text-sm font-black text-[#102119]">Stay informed</h3><p class="mt-1 text-[11px] leading-4 text-slate-500">Status refreshes from persisted ride state.</p></article>
              <article class="min-w-[170px] snap-start rounded-[1.5rem] border border-[#dcebe1] bg-white p-3 shadow-sm"><div class="rounded-[1.2rem] bg-[#008751] p-3 text-white"><div class="flex items-center justify-between text-[9px] font-bold"><span>Trip completed</span><span class="material-symbols-outlined text-xs">check_circle</span></div><div class="flex min-h-[150px] flex-col items-center justify-center text-center"><span class="flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#008751]"><span class="material-symbols-outlined">check</span></span><p class="mt-3 text-sm font-black">How was your ride?</p><div class="mt-2 text-[#ffc72c]">★ ★ ★ ★ ★</div></div><div class="rounded-full bg-white py-2 text-center text-[10px] font-black text-[#008751]">Submit rating</div></div><h3 class="mt-3 text-sm font-black text-[#102119]">Complete with trust</h3><p class="mt-1 text-[11px] leading-4 text-slate-500">Rate the experience when the trip is complete.</p></article>
            </div>
          </div>
        </section>

        <section id="services" class="border-b border-[#dcebe1] bg-[#f4fbf7] px-4 py-12 md:px-8 md:py-16" aria-labelledby="services-heading">
          <div class="mx-auto max-w-[80rem]"><div class="flex items-end justify-between gap-4"><div><p class="text-xs font-black uppercase tracking-[.2em] text-[#008751]">Move with purpose</p><h2 id="services-heading" class="mt-2 text-3xl font-black tracking-tight text-[#102119]">One marketplace. Every way to move.</h2></div><span class="hidden text-xs font-bold text-slate-500 sm:block">Built for African cities</span></div><div class="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {[
              ['airport','Airport transfers','Safe airport rides','/static/drive-media/airport-transfer.png','Book airport ride'],['commute','Intercity rides','Lagos to Abuja routes','/static/drive-media/intercity-rides.png','Book intercity ride'],['two_wheeler','Motorcycle rides','Beat traffic, get there faster','/static/drive-media/motorcycle-rider.png','Explore rides'],['electric_rickshaw','Tricycle rides','Affordable local rides','/static/drive-media/tricycle-rides.png','Explore rides'],['directions_car','Car rentals','Vehicles for every need','/static/drive-media/car-rentals.png','Rent a car'],['person','Chauffeur services','Professional. Comfortable.','/static/drive-media/chauffeur-corporate.png','Book a chauffeur'],['business','Corporate mobility','Move your team efficiently','/static/drive-media/corporate-mobility.png','Get a business account']
            ].map(([icon, title, description, image, cta]) => <article class="group overflow-hidden rounded-2xl border border-[#dcebe1] bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-md"><img src={image} alt={title} loading="lazy" class="h-32 w-full object-cover transition duration-500 group-hover:scale-105" /><div class="p-3"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-xl text-[#008751]">{icon}</span><h3 class="text-sm font-black text-[#102119]">{title}</h3></div><p class="mt-2 min-h-8 text-[11px] leading-4 text-slate-500">{description}</p><a href="#book" class="mt-3 inline-flex items-center gap-1 text-[10px] font-black text-[#008751]">{cta} <span class="material-symbols-outlined text-sm">arrow_forward</span></a></div></article>)}
          </div></div>
        </section>

        <section id="dashboards" class="border-y border-[#dcebe1] bg-white px-4 py-12 md:px-8 md:py-16" aria-labelledby="dashboards-heading">
          <div class="mx-auto max-w-[80rem]"><div class="max-w-2xl"><p class="text-xs font-black uppercase tracking-[.2em] text-[#008751]">Built for the whole mobility business</p><h2 id="dashboards-heading" class="mt-2 text-3xl font-black tracking-tight text-[#102119] md:text-4xl">One operating system for every ride.</h2><p class="mt-3 leading-7 text-slate-600">Customers get a clear trip. Drivers get control. Operators and teams get the visibility to grow without spreadsheets becoming the bottleneck.</p></div><div class="mt-8 grid gap-4 lg:grid-cols-4">
            {[['Driver app','Accept trips, manage availability and keep every offer in view.','directions_car','92%','Offer acceptance'],['Fleet operator','See vehicles, driver status and daily movement from one workspace.','local_shipping','24','Vehicles monitored'],['Corporate mobility','Set travel policies, approve rides and understand spend by team.','business_center','₦1.2m','Monthly spend view'],['Operations control','Resolve exceptions with a reliable audit trail and clear status.','monitoring','Live','Status visibility']].map(([title, description, icon, metric, label]) => <article class="rounded-[1.5rem] border border-[#dcebe1] bg-[#f7fbf8] p-4 shadow-sm"><div class="flex items-center justify-between"><span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#dff3e5] text-[#008751]"><span class="material-symbols-outlined">{icon}</span></span><span class="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[.12em] text-[#008751]">Preview</span></div><div class="mt-6 rounded-2xl bg-white p-4 shadow-sm"><div class="flex items-center justify-between text-[10px] font-bold text-slate-400"><span>{title}</span><span class="material-symbols-outlined text-sm text-[#008751]">more_horiz</span></div><p class="mt-4 text-3xl font-black text-[#102119]">{metric}</p><p class="mt-1 text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">{label}</p><div class="mt-4 flex items-end gap-1"><span class="h-8 flex-1 rounded-t bg-[#b8dfc1]"></span><span class="h-12 flex-1 rounded-t bg-[#78c88e]"></span><span class="h-16 flex-1 rounded-t bg-[#008751]"></span><span class="h-10 flex-1 rounded-t bg-[#b8dfc1]"></span><span class="h-20 flex-1 rounded-t bg-[#008751]"></span></div></div><h3 class="mt-4 text-base font-black text-[#102119]">{title}</h3><p class="mt-2 text-sm leading-6 text-slate-600">{description}</p></article>)}
          </div></div>
        </section>

        <section id="ecosystem" class="bg-[#062d17] px-4 py-12 text-white md:px-8 md:py-16" aria-labelledby="ecosystem-heading"><div class="mx-auto max-w-[80rem]"><div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p class="text-xs font-black uppercase tracking-[.2em] text-[#8be0a9]">The NaijaDeals ecosystem</p><h2 id="ecosystem-heading" class="mt-2 text-3xl font-black tracking-tight md:text-4xl">More ways to move life forward.</h2><p class="mt-3 max-w-2xl leading-7 text-white/70">NaijaDrive is one connected layer in a wider African commerce, services and logistics network.</p></div><a href="/ecosystem" class="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/25 px-5 text-sm font-bold hover:bg-white/10">Explore NaijaDeals <span class="material-symbols-outlined text-base">arrow_forward</span></a></div><div class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[['NaijaStay','Places to stay','hotel','/stay'],['NaijaEats','Food on your route','restaurant','/eats'],['NaijaShop','Goods for every day','shopping_bag','/shop'],['NaijaGigs','Trusted local services','handyman','/gigs'],['NaijaSend','Move packages smarter','local_shipping','/send']].map(([name, description, icon, href]) => <a href={href} class="group rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur transition hover:-translate-y-1 hover:bg-white/15"><span class="material-symbols-outlined text-3xl text-[#ffc72c]">{icon}</span><h3 class="mt-5 font-black">{name}</h3><p class="mt-1 text-sm text-white/60">{description}</p><span class="mt-5 inline-flex items-center gap-1 text-xs font-bold text-[#8be0a9]">Discover <span class="material-symbols-outlined text-sm">arrow_forward</span></span></a>)}</div></div></section>

        <section id="trust" class="border-b border-[#dcebe1] bg-[#f4fbf7] px-4 py-10 md:px-8" aria-label="NaijaDrive trust principles"><div class="mx-auto grid max-w-[80rem] gap-4 md:grid-cols-3">{[['Trusted people','Safety starts with verified journeys, transparent status and accountable support.','verified_user'],['Real opportunities','Drivers, operators and businesses get useful tools to earn and grow.','trending_up'],['A connected continent','Local mobility becomes more powerful when it connects to food, stays, shops and logistics.','public']].map(([title, description, icon]) => <article class="flex gap-4 rounded-2xl border border-[#dcebe1] bg-white p-5"><span class="material-symbols-outlined text-3xl text-[#008751]">{icon}</span><div><h3 class="font-black text-[#102119]">{title}</h3><p class="mt-2 text-sm leading-6 text-slate-600">{description}</p></div></article>)}</div></section>

        <section id="book" class="mx-auto max-w-[80rem] scroll-mt-28 px-4 py-12 md:px-8 md:py-16">
          <div class="grid gap-8 lg:grid-cols-[1.05fr_.95fr]">
            <div>
              <p class="text-sm font-bold uppercase tracking-[.18em] text-[#0b7a3b]">Customer journey</p>
              <h2 class="mt-2 text-3xl font-bold text-slate-900">Plan a private ride</h2>
              <p class="mt-3 max-w-xl text-slate-600">The form validates the currently configured Abuja pilot zones and persists a refresh-based pilot ride request. Routing, live dispatch and external identity services remain separate runtime dependencies.</p>
              <form id="drive-booking-form" class="mt-7 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
                <div class="grid gap-5 md:grid-cols-2">
                  <label class="block"><span class="text-sm font-bold text-slate-700">Pickup zone</span><select name="pickupZone" required class="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"><option value="">Select pickup zone</option>{PILOT_ZONES.map((zone) => <option value={zone.key}>{zone.label}</option>)}</select></label>
                  <label class="block"><span class="text-sm font-bold text-slate-700">Destination zone</span><select name="dropoffZone" required class="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"><option value="">Select destination zone</option>{PILOT_ZONES.map((zone) => <option value={zone.key}>{zone.label}</option>)}</select></label>
                </div>
                <label class="block"><span class="text-sm font-bold text-slate-700">Pickup note <span class="font-normal text-slate-400">(optional)</span></span><input name="pickupNote" maxLength={160} placeholder="Landmark or meeting point" class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" /></label>
                <div><p class="text-sm font-bold text-slate-700">Vehicle category</p><div class="mt-2 grid gap-3 sm:grid-cols-2">{VEHICLES.map((vehicle) => <label class={`relative flex items-start gap-3 rounded-xl border p-3 ${vehicle.estimateEnabled ? 'cursor-pointer border-[#0b7a3b] bg-[#f4fbf5]' : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-75'}`}><input type="radio" name="vehicleCategory" value={vehicle.key} checked={vehicle.key === 'economy'} disabled={!vehicle.estimateEnabled} class="mt-1" /><span><span class="block text-sm font-bold text-slate-800">{vehicle.label}</span><span class="block text-[10px] font-bold text-[#008751]">{vehicle.marketLabel}</span><span class="mt-1 block text-xs text-slate-500">{vehicle.capacity}</span><span class="mt-1 block text-[11px] font-semibold text-amber-700">{vehicle.status}</span></span></label>)}</div></div>
                <div class="rounded-xl border border-[#b8dfc1] bg-[#f4fbf5] p-4"><div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-sm font-bold text-[#062d17]">Fare estimate modes</p><p class="mt-1 text-xs leading-5 text-slate-600">Routed estimates require a configured provider. Demo estimates use clearly labelled fixtures and never become live quotes.</p></div><div class="flex flex-wrap gap-2"><button id="routed-fare-button" type="button" class="min-h-[44px] rounded-lg bg-[#0b7a3b] px-4 text-sm font-bold text-white hover:bg-[#062d17]">Get routed fare</button><button id="simulated-fare-button" type="button" class="min-h-[44px] rounded-lg border border-[#0b7a3b] px-4 text-sm font-bold text-[#0b7a3b] hover:bg-white">Use demo estimate</button></div></div><p id="drive-fare-status" class="hidden mt-3 rounded-xl p-3 text-sm" role="status"></p></div>
                <div class="flex flex-col gap-3 rounded-xl border border-[#b8dfc1] bg-[#f4fbf5] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-sm font-bold text-[#062d17]">Private ride request is available in pilot mode</p><p class="mt-1 text-xs leading-5 text-slate-600">Your request is persisted with a simulated quote. Driver supply, GPS and external payment remain explicitly separate runtime states.</p></div><button type="submit" class="min-h-[44px] rounded-lg bg-[#0b7a3b] px-4 text-sm font-bold text-white">Request ride</button></div>
                <p id="drive-booking-status" class="hidden rounded-xl p-3 text-sm" role="status"></p>
                <section id="drive-ride-status-panel" class="hidden rounded-xl border border-slate-200 bg-slate-50 p-4" aria-labelledby="drive-ride-status-heading">
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div><h3 id="drive-ride-status-heading" class="text-sm font-bold text-slate-900">Persisted ride status</h3><p id="drive-ride-status" class="mt-1 text-sm text-slate-600" role="status"></p></div>
                    <div class="flex gap-2"><button id="refresh-drive-ride" type="button" class="min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700">Refresh</button><button id="cancel-drive-ride" type="button" class="hidden min-h-[40px] rounded-lg border border-red-200 px-3 text-xs font-bold text-red-700">Cancel ride</button></div>
                  </div>
                </section>
              </form>
            </div>
            <aside class="space-y-4"><div class="rounded-2xl bg-[#062d17] p-6 text-white"><div class="flex items-center justify-between"><h3 class="text-lg font-bold">Fare &amp; route readiness</h3><span class="material-symbols-outlined text-[#ffc72c]">calculate</span></div><div class="mt-5 space-y-4 text-sm"><div class="flex items-start gap-3"><span class="material-symbols-outlined text-[#ffc72c]">check_circle</span><div><p class="font-bold">Integer-kobo fare service connected</p><p class="mt-1 text-white/60">The preview reuses the existing runtime fare formula in both routed and explicitly simulated modes.</p></div></div><div class="flex items-start gap-3"><span class="material-symbols-outlined text-amber-300">pending</span><div><p class="font-bold">Live road distance and duration</p><p id="hero-route-status" class="mt-1 text-white/60">Routed mode is unavailable until a verified provider is configured. No silent simulation fallback is used.</p></div></div></div></div><div class="rounded-2xl border border-slate-200 bg-white p-6"><h3 class="text-lg font-bold text-slate-900">Active Abuja pilot zones</h3><div class="mt-4 space-y-3">{PILOT_ZONES.map((zone) => <div class="flex items-center justify-between rounded-xl bg-[#f6f8f6] px-3 py-3"><span class="text-sm font-semibold text-slate-700">{zone.label}</span><span class="text-xs font-bold text-[#0b7a3b]">Configured</span></div>)}<div class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3"><span class="text-sm font-semibold text-slate-500">Airport axis</span><span class="text-xs font-bold text-slate-500">Inactive</span></div></div></div></aside>
          </div>
        </section>

        <section id="carpool" class="scroll-mt-28 border-y border-slate-200 bg-white px-4 py-12 md:px-8 md:py-16"><div class="mx-auto max-w-[80rem]"><div class="grid gap-8 lg:grid-cols-[.9fr_1.1fr] lg:items-start"><div><StatusChip tone="green">Shared rides</StatusChip><h2 class="mt-4 text-3xl font-bold text-slate-900">Publish or find a carpool trip</h2><p class="mt-3 leading-7 text-slate-600">Carpooling has separate trip and seat inventory rules. It is not a private cab request and does not invent driver supply.</p><form id="carpool-search-form" class="mt-5 grid gap-3 sm:grid-cols-2"><input name="origin" placeholder="From" class="rounded-xl border border-slate-300 px-3 py-3 text-sm" /><input name="destination" placeholder="To" class="rounded-xl border border-slate-300 px-3 py-3 text-sm" /><button class="sm:col-span-2 min-h-[44px] rounded-xl bg-[#0b7a3b] px-4 text-sm font-bold text-white">Find available trips</button></form><p id="carpool-status" class="mt-3 hidden rounded-xl p-3 text-sm" role="status"></p><div class="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div class="flex items-center justify-between gap-3"><div><p class="text-xs font-bold uppercase tracking-[.18em] text-[#0b7a3b]">Driver decisions</p><h3 class="mt-1 font-bold text-slate-900">Passenger requests for your trips</h3></div><button id="load-carpool-requests" type="button" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">Refresh</button></div><p id="carpool-requests-status" class="mt-3 text-sm text-slate-500" role="status">Sign in as a trip driver to view requests.</p><div id="carpool-requests-list" class="mt-3 grid gap-2"></div></div></div><div id="carpool-results" class="grid gap-3"><div class="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">Search for a route to see only persisted, published trips with available seats.</div></div></div></div></section>

        <section id="share" class="scroll-mt-28 border-y border-slate-200 bg-white px-4 py-12 md:px-8 md:py-16"><div class="mx-auto max-w-[80rem]"><div class="grid gap-8 lg:grid-cols-[.9fr_1.1fr] lg:items-center"><div><StatusChip tone="slate">Product entry point</StatusChip><h2 class="mt-4 text-3xl font-bold text-slate-900">Cab sharing, designed separately</h2><p class="mt-3 leading-7 text-slate-600">Shared rides are a distinct product: pooled routing, seat inventory, match quality and safety rules must be implemented before this becomes an operational booking flow.</p><a href="#share-status" class="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">View readiness <span class="material-symbols-outlined text-base">arrow_downward</span></a></div><div id="share-status" class="grid gap-3 sm:grid-cols-2"><div class="rounded-2xl border border-slate-200 p-5"><span class="material-symbols-outlined text-3xl text-slate-400">group</span><h3 class="mt-3 font-bold">Shared matching</h3><p class="mt-2 text-sm text-slate-500">Not implemented. No passenger match or seat inventory is represented.</p></div><div class="rounded-2xl border border-slate-200 p-5"><span class="material-symbols-outlined text-3xl text-slate-400">alt_route</span><h3 class="mt-3 font-bold">Pooled routing</h3><p class="mt-2 text-sm text-slate-500">Not implemented. Routing provider integration is still required.</p></div></div></div></div></section>

        <section id="driver-offers" class="scroll-mt-28 border-y border-slate-200 bg-slate-50 px-4 py-10 md:px-8"><div class="mx-auto max-w-[80rem]"><div class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-xs font-bold uppercase tracking-[.18em] text-[#0b7a3b]">Driver workspace</p><h2 class="mt-2 text-2xl font-bold text-slate-900">Offer inbox</h2><p class="mt-2 text-sm text-slate-600">Persisted offers only. The server expires offers after ten minutes; no live GPS is implied.</p></div><button id="load-driver-offers" type="button" class="rounded-xl bg-[#0b7a3b] px-4 py-3 text-sm font-bold text-white">Refresh offers</button></div><p id="driver-offers-status" class="mt-3 rounded-xl bg-white p-3 text-sm text-slate-500">Sign in with an active driver profile to view offers.</p><div id="driver-offers-list" class="mt-4 grid gap-3 md:grid-cols-2"></div></div></section>
        <section id="driver" class="scroll-mt-28 mx-auto max-w-[80rem] px-4 py-12 md:px-8 md:py-16"><div class="grid gap-8 lg:grid-cols-[1fr_1fr]"><div><p class="text-sm font-bold uppercase tracking-[.18em] text-[#0b7a3b]">Driver hub</p><h2 class="mt-2 text-3xl font-bold text-slate-900">Earn on your terms. Operate with controls.</h2><p class="mt-3 leading-7 text-slate-600">This is the driver workflow shell. Offer decisions and availability use persisted, server-authorized preview records; identity approval, vehicle eligibility and Redis-backed live presence remain separate runtime dependencies.</p><div class="mt-6 flex flex-wrap gap-3"><a href="/register" class="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0b7a3b] px-5 text-sm font-bold text-white hover:bg-[#062d17]"><span class="material-symbols-outlined text-base">person_add</span>Start registration</a><a href="/login" class="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">Sign in</a></div></div><div class="grid gap-3 sm:grid-cols-2"><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">badge</span><h3 class="mt-4 font-bold">Onboarding</h3><p class="mt-2 text-sm text-slate-500">Documents and verification status require authenticated runtime workflows.</p></div><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">notifications</span><h3 class="mt-4 font-bold">Ride offers</h3><p class="mt-2 text-sm text-slate-500">No live offers are shown until dispatch and WebSocket delivery are connected.</p></div><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">toggle_on</span><h3 class="mt-4 font-bold">Availability</h3><p class="mt-2 text-sm text-slate-500">The runtime has Redis presence primitives; this UI does not claim a live heartbeat.</p></div><div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span class="material-symbols-outlined rounded-xl bg-[#e8f5ec] p-2 text-[#0b7a3b]">sos</span><h3 class="mt-4 font-bold">Safety</h3><p class="mt-2 text-sm text-slate-500">Incident and SOS workflows remain to be connected to Control Center.</p></div></div></div></section>

        <section id="driver-availability" class="mx-auto max-w-[80rem] px-4 py-10 md:px-8"><div class="rounded-2xl border border-slate-200 bg-white p-5 md:p-6"><div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-xs font-bold uppercase tracking-[.18em] text-[#0b7a3b]">Driver availability</p><h2 class="mt-2 text-xl font-bold text-slate-900">Control whether new offers may reach you</h2><p id="driver-availability-status" class="mt-2 text-sm text-slate-600" role="status">Sign in with an active driver profile to manage availability.</p></div><button id="driver-availability-toggle" type="button" class="min-h-[44px] rounded-xl bg-[#0b7a3b] px-5 text-sm font-bold text-white">Set online</button></div></div></section>
        <section id="waitlist" class="border-t border-[#dcebe1] bg-white px-4 py-12 md:px-8 md:py-16" aria-labelledby="waitlist-heading"><div class="mx-auto grid max-w-[80rem] gap-8 lg:grid-cols-[.9fr_1.1fr] lg:items-center"><div><p class="text-xs font-black uppercase tracking-[.2em] text-[#008751]">Early access</p><h2 id="waitlist-heading" class="mt-2 text-3xl font-black tracking-tight text-[#102119] md:text-4xl">Be first to move with NaijaDrive.</h2><p class="mt-3 leading-7 text-slate-600">Tell us where you are and what you need. We will use this list to prioritise cities, services and pilot access — no fake launch dates, no spam.</p><div class="mt-6 flex flex-wrap gap-2 text-xs font-bold text-slate-600"><span class="rounded-full bg-[#e8f5ec] px-3 py-2">Safe rides</span><span class="rounded-full bg-[#e8f5ec] px-3 py-2">Clear pricing</span><span class="rounded-full bg-[#e8f5ec] px-3 py-2">Built in Africa</span></div></div><form id="drive-waitlist-form" class="rounded-[1.5rem] border border-[#dcebe1] bg-[#f7fbf8] p-5 shadow-sm md:p-7"><div class="grid gap-4 sm:grid-cols-2"><label><span class="text-xs font-black uppercase tracking-[.12em] text-slate-500">Full name</span><input name="fullName" required maxLength={120} autocomplete="name" class="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm" placeholder="Your name" /></label><label><span class="text-xs font-black uppercase tracking-[.12em] text-slate-500">Email</span><input type="email" name="email" required maxLength={160} autocomplete="email" class="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm" placeholder="you@example.com" /></label><label><span class="text-xs font-black uppercase tracking-[.12em] text-slate-500">Phone</span><input name="phone" required maxLength={40} autocomplete="tel" class="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm" placeholder="+234…" /></label><label><span class="text-xs font-black uppercase tracking-[.12em] text-slate-500">City</span><input name="city" required maxLength={80} autocomplete="address-level2" class="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm" placeholder="Abuja" /></label><label class="sm:col-span-2"><span class="text-xs font-black uppercase tracking-[.12em] text-slate-500">State</span><input name="state" required maxLength={80} autocomplete="address-level1" class="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm" placeholder="FCT" /></label></div><fieldset class="mt-5"><legend class="text-sm font-black text-[#102119]">What should we prioritise?</legend><div class="mt-3 grid gap-2 sm:grid-cols-2"><label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"><input type="checkbox" name="allServices" value="true" /> All upcoming services</label><label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"><input type="checkbox" name="naijaEats" value="true" /> NaijaEats</label><label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"><input type="checkbox" name="naijaGigs" value="true" /> NaijaGigs</label><label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"><input type="checkbox" name="naijaStay" value="true" /> NaijaStay</label></div></fieldset><button type="submit" class="mt-5 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#008751] px-5 text-sm font-black text-white hover:bg-[#062d17]"><span class="material-symbols-outlined text-base">how_to_reg</span>Join the waitlist</button><p id="drive-waitlist-status" class="mt-3 hidden rounded-xl p-3 text-sm" role="status" aria-live="polite"></p></form></div></section>
        <footer class="bg-[#062d17] px-4 py-10 text-white md:px-8"><div class="mx-auto flex max-w-[80rem] flex-col gap-8 md:flex-row md:items-start md:justify-between"><div><a href="/drive" class="text-2xl font-black">Naija<span class="text-[#8be0a9]">Drive</span></a><p class="mt-3 max-w-xs text-sm leading-6 text-white/60">Africa's mobility marketplace, starting in Nigeria.</p></div><nav class="grid grid-cols-2 gap-x-10 gap-y-3 text-sm text-white/70"><a href="#book" class="hover:text-white">Rides</a><a href="#services" class="hover:text-white">Services</a><a href="#driver" class="hover:text-white">Drivers</a><a href="#dashboards" class="hover:text-white">Business</a><a href="/help" class="hover:text-white">Safety &amp; help</a><a href="/privacy" class="hover:text-white">Privacy</a><a href="/terms" class="hover:text-white">Terms</a><a href="/ecosystem" class="hover:text-white">NaijaDeals</a></nav></div><div class="mx-auto mt-8 flex max-w-[80rem] flex-col gap-3 border-t border-white/10 pt-5 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between"><span>© {new Date().getFullYear()} NaijaDeals. NaijaDrive is built for African cities.</span><div class="flex gap-3"><a href={APP_LINKS.ios} class="hover:text-white">App Store</a><a href={APP_LINKS.android} class="hover:text-white">Google Play</a></div></div></footer>
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
            carpoolResults.innerHTML = body.trips.length ? body.trips.map((trip) => '<article class="rounded-2xl border border-slate-200 bg-white p-4"><div class="flex items-center justify-between gap-3"><strong>' + trip.origin + ' → ' + trip.destination + '</strong><span class="text-xs font-bold text-[#0b7a3b]">' + trip.seats_available + ' seat(s)</span></div><p class="mt-2 text-sm text-slate-500">Departure ' + new Date(trip.departure_at).toLocaleString() + '</p><p class="mt-1 text-sm font-semibold">Contribution: ₦' + (Number(trip.contribution_kobo) / 100).toLocaleString('en-NG') + '</p><button type="button" data-carpool-request-id="' + trip.id + '" class="mt-3 rounded-lg bg-[#0b7a3b] px-3 py-2 text-xs font-bold text-white">Request 1 seat</button></article>').join('') : '<div class="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">No published trips with seats matched this route.</div>';
            carpoolResults.querySelectorAll('[data-carpool-request-id]').forEach((button) => button.addEventListener('click', async () => {
              const tripId = button.getAttribute('data-carpool-request-id');
              if (!tripId || button.disabled) return;
              button.disabled = true;
              button.setAttribute('aria-busy', 'true');
              button.textContent = 'Requesting…';
              try {
                const requestResponse = await fetch('/api/carpool/trips/' + tripId + '/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seats: 1 }) });
                const result = await requestResponse.json().catch(() => ({}));
                if (!requestResponse.ok) throw new Error(result.error || 'Carpool request unavailable.');
                button.textContent = 'Request submitted';
                const cancelButton = document.createElement('button');
                cancelButton.type = 'button';
                cancelButton.className = 'ml-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700';
                cancelButton.textContent = 'Cancel request';
                cancelButton.addEventListener('click', async () => {
                  if (cancelButton.disabled) return;
                  cancelButton.disabled = true;
                  cancelButton.setAttribute('aria-busy', 'true');
                  try {
                    const cancelResponse = await fetch('/api/carpool/requests/' + result.id + '/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
                    const cancelResult = await cancelResponse.json().catch(() => ({}));
                    if (!cancelResponse.ok) throw new Error(cancelResult.error || 'Carpool cancellation unavailable.');
                    cancelButton.remove();
                    button.textContent = 'Request cancelled';
                    if (carpoolStatus) carpoolStatus.textContent = 'Seat request #' + result.id + ' was cancelled and inventory was restored.';
                  } catch (error) {
                    cancelButton.disabled = false;
                    cancelButton.removeAttribute('aria-busy');
                    if (carpoolStatus) carpoolStatus.textContent = error instanceof Error ? error.message : 'Carpool cancellation unavailable.';
                  }
                });
                button.insertAdjacentElement('afterend', cancelButton);
                if (carpoolStatus) carpoolStatus.textContent = 'Seat request #' + result.id + ' is awaiting the trip driver.';
              } catch (error) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
                button.textContent = 'Request 1 seat';
                if (carpoolStatus) carpoolStatus.textContent = error instanceof Error ? error.message : 'Carpool request unavailable.';
              }
            }));
            if (carpoolStatus) { carpoolStatus.className = 'mt-3 rounded-xl bg-green-100 p-3 text-sm text-green-900'; carpoolStatus.textContent = body.trips.length + ' persisted trip(s) found. No driver supply was fabricated.'; }
          } catch (error) { if (carpoolStatus) { carpoolStatus.className = 'mt-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900'; carpoolStatus.textContent = error instanceof Error ? error.message : 'Carpool search unavailable.'; } }
        });
        const carpoolRequestsList = document.getElementById('carpool-requests-list');
        const carpoolRequestsStatus = document.getElementById('carpool-requests-status');
        async function loadCarpoolRequests() {
          if (!carpoolRequestsList || !carpoolRequestsStatus) return;
          carpoolRequestsStatus.textContent = 'Loading persisted passenger requests…';
          try {
            const response = await fetch('/api/carpool/driver/requests');
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'Driver sign-in required.');
            carpoolRequestsList.innerHTML = body.requests.length ? body.requests.map((request) => '<article class="rounded-xl border border-slate-200 bg-white p-3"><div class="flex items-center justify-between gap-2"><strong class="text-sm">' + request.origin + ' → ' + request.destination + '</strong><span class="text-xs font-bold uppercase text-slate-500">' + request.status + '</span></div><p class="mt-1 text-xs text-slate-500">' + request.seats_requested + ' seat(s) · ' + request.passenger_name + ' · ' + new Date(request.departure_at).toLocaleString('en-NG') + '</p>' + (request.status === 'requested' ? '<div class="mt-3 flex gap-2"><button data-carpool-decision="accepted" data-carpool-request-id="' + request.id + '" class="rounded-lg bg-[#0b7a3b] px-3 py-2 text-xs font-bold text-white">Accept</button><button data-carpool-decision="rejected" data-carpool-request-id="' + request.id + '" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">Reject</button></div>' : '') + '</article>').join('') : '<p class="text-sm text-slate-500">No persisted passenger requests.</p>';
            carpoolRequestsStatus.textContent = body.requests.length + ' persisted request(s). Decisions are enforced by the trip owner on the server.';
            carpoolRequestsList.querySelectorAll('[data-carpool-decision]').forEach((button) => button.addEventListener('click', async () => {
              const requestId = button.getAttribute('data-carpool-request-id');
              const decision = button.getAttribute('data-carpool-decision');
              if (!requestId || !decision || button.disabled) return;
              button.disabled = true;
              button.setAttribute('aria-busy', 'true');
              try {
                const decisionResponse = await fetch('/api/carpool/requests/' + requestId + '/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: decision }) });
                const result = await decisionResponse.json().catch(() => ({}));
                if (!decisionResponse.ok) throw new Error(result.error || 'Carpool decision unavailable.');
                await loadCarpoolRequests();
              } catch (error) {
                carpoolRequestsStatus.textContent = error instanceof Error ? error.message : 'Carpool decision unavailable.';
                button.disabled = false;
                button.removeAttribute('aria-busy');
              }
            }));
          } catch (error) { carpoolRequestsStatus.textContent = error instanceof Error ? error.message : 'Driver sign-in required.'; }
        }
        document.getElementById('load-carpool-requests')?.addEventListener('click', loadCarpoolRequests);
        const offersList = document.getElementById('driver-offers-list');
        const offersStatus = document.getElementById('driver-offers-status');
        async function loadDriverOffers() {
          if (!offersList || !offersStatus) return;
          offersStatus.textContent = 'Loading persisted offers…';
          try {
            const response = await fetch('/api/drive/driver/offers');
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'Driver sign-in required.');
            offersList.innerHTML = body.offers.length ? body.offers.map((offer) => '<article class="rounded-2xl border border-slate-200 bg-white p-4"><div class="flex items-center justify-between gap-2"><strong>' + offer.pickup_zone + ' → ' + offer.dropoff_zone + '</strong><span class="text-xs font-bold uppercase text-slate-500">' + offer.status + '</span></div><p class="mt-2 text-sm text-slate-500">Ride #' + offer.ride_id + ' · ₦' + (Number(offer.fare_kobo) / 100).toLocaleString('en-NG') + ' · ' + offer.vehicle_category + '</p>' + (offer.status === 'offered' ? '<div class="mt-3 flex gap-2"><button data-offer-action="accept" data-offer-id="' + offer.id + '" class="rounded-lg bg-[#0b7a3b] px-3 py-2 text-xs font-bold text-white">Accept</button><button data-offer-action="reject" data-offer-id="' + offer.id + '" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">Reject</button></div>' : '') + '</article>').join('') : '<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">No persisted offers for this driver.</div>';
            offersStatus.textContent = body.offers.length + ' persisted offer(s). Expiry is enforced server-side after ' + body.offer_expiry_minutes + ' minutes.';
            offersList.querySelectorAll('[data-offer-action]').forEach((button) => button.addEventListener('click', async () => {
              const action = button.getAttribute('data-offer-action');
              const id = button.getAttribute('data-offer-id');
              if (!action || !id || button.disabled) return;
              const endpoint = action === 'accept' ? '/api/drive/driver/offers/' + id + '/accept' : '/api/drive/driver/offers/' + id + '/reject';
              button.disabled = true;
              button.setAttribute('aria-busy', 'true');
              offersStatus.textContent = action === 'accept' ? 'Accepting persisted offer…' : 'Rejecting persisted offer…';
              try {
                const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Driver decision' }) });
                const result = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(result.error || 'Offer action failed.');
                await loadDriverOffers();
              } catch (error) {
                offersStatus.textContent = error instanceof Error ? error.message : 'Offer action failed.';
                button.disabled = false;
                button.removeAttribute('aria-busy');
              }
            }));
          } catch (error) { offersStatus.textContent = error instanceof Error ? error.message : 'Driver sign-in required.'; }
        }
        document.getElementById('load-driver-offers')?.addEventListener('click', loadDriverOffers);
        const availabilityToggle = document.getElementById('driver-availability-toggle');
        const availabilityStatus = document.getElementById('driver-availability-status');
        let driverOnline = false;
        availabilityToggle?.addEventListener('click', async () => {
          if (!availabilityToggle || availabilityToggle.disabled) return;
          const nextOnline = !driverOnline;
          availabilityToggle.disabled = true;
          availabilityToggle.setAttribute('aria-busy', 'true');
          if (availabilityStatus) availabilityStatus.textContent = nextOnline ? 'Setting driver availability online…' : 'Setting driver availability offline…';
          try {
            const response = await fetch('/api/drive/driver/availability', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ online: nextOnline }) });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'Driver availability unavailable.');
            driverOnline = body.online === true;
            availabilityToggle.textContent = driverOnline ? 'Set offline' : 'Set online';
            if (availabilityStatus) availabilityStatus.textContent = driverOnline ? 'You are online for new persisted offers. No live heartbeat is implied.' : 'You are offline and will not receive new persisted offers.';
          } catch (error) {
            if (availabilityStatus) availabilityStatus.textContent = error instanceof Error ? error.message : 'Driver availability unavailable.';
          } finally {
            availabilityToggle.disabled = false;
            availabilityToggle.removeAttribute('aria-busy');
          }
        });
        async function loadDriverAvailability() {
          if (!availabilityToggle || !availabilityStatus) return;
          try {
            const response = await fetch('/api/drive/driver/availability');
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'Sign in with an active driver profile to manage availability.');
            driverOnline = body.online === true;
            availabilityToggle.textContent = driverOnline ? 'Set offline' : 'Set online';
            availabilityStatus.textContent = driverOnline ? 'You are online for new persisted offers. No live heartbeat is implied.' : 'You are offline and will not receive new persisted offers.';
          } catch (error) {
            availabilityStatus.textContent = error instanceof Error ? error.message : 'Driver availability unavailable.';
          }
        }
        loadDriverAvailability();
        const form = document.getElementById('drive-booking-form');
        const routedButton = document.getElementById('routed-fare-button');
        const simulatedButton = document.getElementById('simulated-fare-button');
        const fareStatus = document.getElementById('drive-fare-status');
        const bookingStatus = document.getElementById('drive-booking-status');
        const rideStatusPanel = document.getElementById('drive-ride-status-panel');
        const rideStatus = document.getElementById('drive-ride-status');
        const refreshRideButton = document.getElementById('refresh-drive-ride');
        const cancelRideButton = document.getElementById('cancel-drive-ride');
        let activeRideId = null;
        let rideStatusRequest = 0;
        let rideStatusTimer = null;
        const terminalRideStatuses = new Set(['completed', 'cancelled', 'no_driver_available']);
        function stopRidePolling() {
          if (rideStatusTimer !== null) { window.clearInterval(rideStatusTimer); rideStatusTimer = null; }
        }
        function scheduleRidePolling(status) {
          if (!activeRideId || terminalRideStatuses.has(status) || rideStatusTimer !== null) { if (terminalRideStatuses.has(status)) stopRidePolling(); return; }
          rideStatusTimer = window.setInterval(() => { if (document.visibilityState === 'visible') loadRideStatus(); }, 15000);
        }
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && activeRideId) loadRideStatus(); });
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
        async function loadRideStatus() {
          if (!activeRideId || !rideStatusPanel || !rideStatus) return;
          const requestId = ++rideStatusRequest;
          rideStatus.textContent = 'Refreshing persisted ride status…';
          try {
            const response = await fetch('/api/drive/rides/' + activeRideId);
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'Ride status unavailable.');
            if (requestId !== rideStatusRequest) return;
            const status = body.ride.status;
            rideStatus.textContent = 'Ride #' + body.ride.id + ' is ' + status.replaceAll('_', ' ') + '. Last updated ' + new Date(body.ride.updated_at).toLocaleString('en-NG') + '.';
            cancelRideButton?.classList.toggle('hidden', !['requested','searching','offered','accepted','driver_arriving','driver_arrived'].includes(status));
            scheduleRidePolling(status);
          } catch (error) {
            if (requestId === rideStatusRequest) rideStatus.textContent = error instanceof Error ? error.message : 'Ride status unavailable.';
          }
        }
        refreshRideButton?.addEventListener('click', loadRideStatus);
        cancelRideButton?.addEventListener('click', async () => {
          if (!activeRideId || cancelRideButton.disabled) return;
          cancelRideButton.disabled = true;
          cancelRideButton.setAttribute('aria-busy', 'true');
          if (rideStatus) rideStatus.textContent = 'Cancelling persisted ride…';
          try {
            const response = await fetch('/api/drive/rides/' + activeRideId + '/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'Ride cancellation unavailable.');
            await loadRideStatus();
          } catch (error) {
            if (rideStatus) rideStatus.textContent = error instanceof Error ? error.message : 'Ride cancellation unavailable.';
          } finally {
            cancelRideButton.disabled = false;
            cancelRideButton.removeAttribute('aria-busy');
          }
        });
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
            activeRideId = body.ride.id;
            rideStatusPanel?.classList.remove('hidden');
            await loadRideStatus();
          } catch {
            bookingStatus.className = 'rounded-xl bg-red-100 p-3 text-sm text-red-800';
            bookingStatus.textContent = 'The preview could not reach the booking service. No booking was created.';
          }
        });
        const waitlistForm = document.getElementById('drive-waitlist-form');
        const waitlistStatus = document.getElementById('drive-waitlist-status');
        waitlistForm?.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!waitlistStatus || waitlistForm.getAttribute('aria-busy') === 'true') return;
          const data = new FormData(waitlistForm);
          const payload = {
            fullName: data.get('fullName'), email: data.get('email'), phone: data.get('phone'),
            city: data.get('city'), state: data.get('state'),
            allServices: data.get('allServices') === 'true', naijaEats: data.get('naijaEats') === 'true',
            naijaGigs: data.get('naijaGigs') === 'true', naijaStay: data.get('naijaStay') === 'true'
          };
          waitlistForm.setAttribute('aria-busy', 'true');
          waitlistStatus.className = 'mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700';
          waitlistStatus.textContent = 'Saving your early-access request…';
          try {
            const response = await fetch('/api/ecosystem/waitlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'We could not save your request.');
            waitlistStatus.className = 'mt-3 rounded-xl bg-green-100 p-3 text-sm text-green-900';
            waitlistStatus.textContent = body.isNewSignup ? 'You are on the list. We will keep you posted as NaijaDrive expands.' : 'Your preferences are updated. Thanks for staying close to NaijaDrive.';
            waitlistForm.reset();
          } catch (error) {
            waitlistStatus.className = 'mt-3 rounded-xl bg-red-100 p-3 text-sm text-red-800';
            waitlistStatus.textContent = error instanceof Error ? error.message : 'We could not save your request. Please try again.';
          } finally {
            waitlistForm.removeAttribute('aria-busy');
          }
        });
      ` }}></script>
    </Layout>
  )
}
