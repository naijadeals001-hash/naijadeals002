import type { D1Database } from '@cloudflare/workers-types'

export const DEVELOPMENT_STATUSES = ['QUEUED','RESEARCHING','READY','IMPLEMENTING','TESTING','PREVIEW_VERIFYING','COMMITTING','COMPLETE','PARTIAL','BLOCKED','FAILED'] as const
export type DevelopmentStatus = typeof DEVELOPMENT_STATUSES[number]

export type DevelopmentTask = {
  id: number; task_key: string; workstream: string; vertical: string; feature: string; title: string; description: string; priority: number
  dependency_task_keys: string[]; rea_state: string; rea_evidence_ids: string[]; reference_urls: string[]; status: DevelopmentStatus
  assigned_subsystem: string; attempt: number; checkpoint: string; implementation_state: string; automated_test_state: string; preview_state: string
  external_integration_state: string; sandbox_e2e_state: string; production_prerequisites_state: string; production_deployment_state: string; production_verification_state: string
  build_result: string; test_result: string; browser_acceptance: string; preview_routes: string[]; screenshot_refs: string[]; limitations: string; blocker_details: string
  commit_sha: string | null; remote_sha: string | null; last_verified_at: string | null; next_task_key: string | null; started_at: string | null; created_at: string; updated_at: string
}

const jsonFields = new Set(['dependency_task_keys_json','rea_evidence_ids_json','reference_urls_json','preview_routes_json','screenshot_refs_json'])
function hydrate(row: any): DevelopmentTask {
  const out: any = { ...row }
  for (const key of jsonFields) out[key.replace('_json','')] = JSON.parse(row[key] || '[]')
  return out as DevelopmentTask
}

export async function ensureDevelopmentBacklog(db: D1Database): Promise<void> {
  const rows = [
    ['CC-001','Control Center','development-registry','Persisted development visibility','Create the authoritative task, event and readiness registry.',1,'[]','NOT_REQUIRED','[]','[]','COMPLETE','control-center','Core registry schema, API and dashboard are implemented.','IMPLEMENTED','PASSED','PREVIEW_VERIFIED','NOT_CONFIGURED','NOT_RUN','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','Build and targeted tests passed','Registry work is the current checkpoint','/control-center/development',''],
    ['SHOP-001','Shop','checkout','Persisted checkout acceptance','Exercise authenticated cart, checkout, payment-intent and order-history flow.',10,'[]','NOT_REQUIRED','[]','[]','PARTIAL','commerce','Existing engine works; full browser persistence/payment acceptance remains.','PARTIAL','PARTIAL','PREVIEW_VERIFIED','NOT_CONFIGURED','NOT_RUN','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','','Existing Shop routes browser-checked; no fabricated payment success.','/shop,/checkout',''],
    ['DRIVE-001','NaijaDrive','private-rides','Persistent private ride lifecycle','Implement request, eligible offer, acceptance, pickup, trip, completion and cancellation states.',20,'[]','EVIDENCED','["rea-drive-bolt-cities"]','["https://bolt.eu/en-ng/cities/"]','QUEUED','drive-preview/logistics','Waiting on persistent ride request schema and driver offer design.','NOT_STARTED','NOT_RUN','NOT_RUN','NOT_CONFIGURED','NOT_RUN','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','','GPS and driver supply must never be fabricated.','/drive','Missing ride_requests/driver-offers workflow'],
    ['DRIVE-002','NaijaDrive','carpool','Carpool customer and driver acceptance','Complete customer request UI, driver decision UI and notification/state acceptance.',21,'["DRIVE-001"]','EVIDENCED','["rea-drive-bolt-cities"]','["https://bolt.eu/en-ng/cities/"]','PARTIAL','carpool','Trip publication/search and atomic seats exist; decision UI and full browser acceptance remain.','PARTIAL','PASSED','PREVIEW_VERIFIED','NOT_CONFIGURED','NOT_RUN','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','Carpool seat tests passed','APIs and search UI verified; no fabricated drivers.','/drive','Driver decision UI and notifications pending'],
    ['EATS-001','NaijaEats','fulfillment','Restaurant-to-customer delivery fulfillment','Complete courier eligibility, delivery offers, pickup, proof of delivery and customer tracking.',22,'[]','EVIDENCED','["rea-eats-bolt-food"]','["https://food.bolt.eu/"]','PARTIAL','eats/logistics','Order-to-logistics bridge exists; courier/POD acceptance remains.','PARTIAL','PARTIAL','PREVIEW_VERIFIED','NOT_CONFIGURED','NOT_RUN','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','','No courier, GPS or delivery success is fabricated.','/eats,/eats/cart,/eats/orders','Courier offer and POD workflow pending'],
    ['SEND-001','NaijaSend','freight-marketplace','Carrier capability and award-to-shipment','Add capability, equipment, service regions, bid comparison and safe shipment conversion.',23,'[]','EVIDENCED','["rea-send-usship"]','["https://www.uship.com/"]','PARTIAL','logistics/freight','Load and bid foundation exists; carrier capability and shipment conversion remain.','PARTIAL','PASSED','PREVIEW_VERIFIED','NOT_CONFIGURED','NOT_RUN','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','Freight route-auth regression fixed; targeted lifecycle passed','/send,/api/freight/loads','Never invent carrier supply or prices'],
    ['GIGS-001','NaijaGigs','service-lifecycle','Milestones, messaging and delivery revisions','Extend request/quote/order lifecycle with authorized messaging, milestones and revisions.',24,'[]','EVIDENCED','["rea-gigs-fiverr"]','["https://www.fiverr.com/"]','PARTIAL','services','Core request-to-quote-to-order flow passes; collaboration workflow remains.','PARTIAL','PASSED','PREVIEW_VERIFIED','NOT_CONFIGURED','PASSED','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','Gigs lifecycle E2E passed','/gigs','Messaging and milestone delivery pending'],
    ['STAY-001','NaijaStay','host-operations','Host management and adversarial availability','Add host onboarding/property management, calendar and double-booking acceptance.',25,'[]','EVIDENCED','["rea-stay-airbnb"]','["https://www.airbnb.com/"]','PARTIAL','booking','Guest search/availability and E2E pass; host workspace and adversarial test remain.','PARTIAL','PASSED','PREVIEW_VERIFIED','NOT_CONFIGURED','PASSED','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','Stay availability E2E passed','/stay,/api/bookable-listings','Host UI and concurrent booking test pending'],
    ['FREIGHT-002','NaijaSend','dispatch','Dispatch offers, expiry, fallback and POD','Persist dispatch offers with eligibility filters, expiry/rejection/fallback and proof of delivery.',30,'["SEND-001"]','NEEDED','[]','[]','QUEUED','logistics-dispatch','Depends on carrier capability and award-to-shipment conversion.','NOT_STARTED','NOT_RUN','NOT_RUN','NOT_CONFIGURED','NOT_RUN','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','','','',''],
    ['MOBILITY-003','NaijaDrive','delivery','Grocery delivery workflow','Connect real store/catalog/order records to substitutions, preparation and delivery.',31,'["EATS-001"]','NEEDED','[]','[]','QUEUED','fresh/logistics','Depends on existing NaijaFresh order and logistics boundaries.','NOT_STARTED','NOT_RUN','NOT_RUN','NOT_CONFIGURED','NOT_RUN','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','','','',''],
    ['CC-003','Control Center','authenticated-acceptance','Authenticated acceptance and RBAC hardening','Verify role permissions, city controls and registry consistency.',2,'[]','NOT_REQUIRED','[]','[]','IMPLEMENTING','control-center-rbac','Role-matrix and city-enforcement verification is the active Control Center checkpoint.','IN_PROGRESS','PARTIAL','PREVIEW_VERIFIED','NOT_CONFIGURED','PARTIAL','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','','Authenticated API/browser acceptance and city transaction guards are pending verification.','/control-center,/control-center/development',''],
    ['CC-004','Control Center','operations-command-center','Authenticated acceptance and NaijaEats operations','Establish repeatable role acceptance, country-scope administration and a persisted NaijaEats operations drill-down.',3,'[]','NOT_REQUIRED','[]','[]','IMPLEMENTING','control-center/eats-operations','CC-004 is implementing authenticated HTTP acceptance, scope administration and operational fulfillment visibility.','IN_PROGRESS','PARTIAL','PREVIEW_VERIFIED','NOT_CONFIGURED','PARTIAL','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','','Browser acceptance remains pending; EATS operational counts and secure scope APIs are in progress.','/control-center/country-scopes,/control-center/eats',''],
    ['TS-001','NaijaDeals','quality-gate','TypeScript diagnostic remediation and quality-gate recovery','Establish a source-backed diagnostic inventory, fix confirmed defects, and restore a trustworthy TypeScript gate without weakening compiler rules.',4,'[]','NOT_REQUIRED','[]','[]','COMPLETE','typescript-quality','Baseline 9; current 34; all 34 compiler diagnostics were resolved after separating the root decorator configuration defect from route and JSX type-contract defects.','IMPLEMENTED','PASSED','PREVIEW_VERIFIED','NOT_CONFIGURED','PASSED','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','npm run build passed; 272 modules','TypeScript gate passed with 0 current diagnostics; integrated matrix passed 26/26.','/control-center/development',''],
    ['VERTICAL-001','Ecosystem','vertical-registry','Inventory all registered verticals','Derive every registered vertical and assign truthful workflow, dependency and acceptance tasks.',40,'[]','NOT_REQUIRED','[]','[]','READY','control-center-ecosystem','Use actual ecosystem_verticals and routes; no decorative status claims.','NOT_STARTED','NOT_RUN','NOT_RUN','NOT_CONFIGURED','NOT_RUN','NOT_ASSESSED','NOT_DEPLOYED','NOT_VERIFIED','','','',''],
  ]
  // Historical defect guard: older versions supplied fewer values than the
  // 26-column INSERT, producing opaque D1 errors such as "18 values for 17
  // columns". Normalize legacy seed rows explicitly, then fail loudly if a
  // future edit introduces another mismatch.
  const normalizedRows = rows.map((row) => {
    // The original seed literals omitted the optional description value after
    // title; insert it before priority, then pad the optional screenshot field.
    const withDescription = row.length < 26 ? [...row.slice(0, 5), '', ...row.slice(5)] : row
    const padded = withDescription.length === 26 ? withDescription : [...withDescription, ...new Array(26 - withDescription.length).fill('')]
    if (typeof padded[24] === 'string' && padded[24] && !padded[24].trim().startsWith('[')) padded[24] = JSON.stringify(padded[24].split(',').map((value) => value.trim()).filter(Boolean))
    if (typeof padded[25] === 'string' && padded[25] && !padded[25].trim().startsWith('[')) padded[25] = JSON.stringify(padded[25].split(',').map((value) => value.trim()).filter(Boolean))
    return padded
  })
  for (const row of normalizedRows) {
    if (row.length !== 26) throw new Error(`Development Registry seed row ${String(row[0])} has ${row.length} values; expected 26`)
  }
  const sql = `INSERT OR IGNORE INTO cc_development_tasks (task_key,workstream,vertical,feature,title,description,priority,dependency_task_keys_json,rea_state,rea_evidence_ids_json,reference_urls_json,status,assigned_subsystem,checkpoint,implementation_state,automated_test_state,preview_state,external_integration_state,sandbox_e2e_state,production_prerequisites_state,production_deployment_state,production_verification_state,build_result,test_result,preview_routes_json,screenshot_refs_json) VALUES (${new Array(26).fill('?').join(',')})`
  for (const row of normalizedRows) await db.prepare(sql).bind(...row).run()

  // Repair rows created by the historical malformed seed without touching
  // healthy/operator-edited rows. A non-JSON route/screenshot field is the
  // precise signature of the old shifted-value defect.
  for (const row of normalizedRows) {
    const repaired = await db.prepare(`
      UPDATE cc_development_tasks SET
        description=?, priority=?, dependency_task_keys_json=?, rea_state=?,
        rea_evidence_ids_json=?, reference_urls_json=?, assigned_subsystem=?,
        checkpoint=?, implementation_state=?, automated_test_state=?, preview_state=?,
        external_integration_state=?, sandbox_e2e_state=?, production_prerequisites_state=?,
        production_deployment_state=?, production_verification_state=?, build_result=?,
        test_result=?, preview_routes_json=?, screenshot_refs_json=?, updated_at=datetime('now')
      WHERE task_key=? AND (preview_routes_json NOT LIKE '[%' OR screenshot_refs_json NOT LIKE '[%')
    `).bind(row[5], row[6], row[7], row[8], row[9], row[10], row[12], row[13], row[14], row[15], row[16], row[17], row[18], row[19], row[20], row[21], row[22], row[23], row[24], row[25], row[0]).run()
    if ((repaired.meta.changes ?? repaired.meta.rows_written ?? 0) > 0) {
      await db.prepare('INSERT INTO cc_development_events (task_id,event_type,status,message,evidence_json,actor_user_id) SELECT id,?,?,?,?,NULL FROM cc_development_tasks WHERE task_key=?').bind('seed_repair', row[11], 'Repaired historical Development Registry seed value alignment', JSON.stringify({ reason: 'invalid_json_shape' }), row[0]).run()
    }
  }
}

export async function listDevelopmentTasks(db: D1Database, filters: { vertical?: string; status?: string } = {}) {
  let sql = 'SELECT * FROM cc_development_tasks WHERE 1=1'; const args: any[] = []
  if (filters.vertical) { sql += ' AND vertical = ?'; args.push(filters.vertical) }
  if (filters.status && DEVELOPMENT_STATUSES.includes(filters.status as DevelopmentStatus)) { sql += ' AND status = ?'; args.push(filters.status) }
  sql += ' ORDER BY priority ASC, id ASC'
  const { results } = await db.prepare(sql).bind(...args).all()
  return results.map(hydrate)
}

export async function getDevelopmentTask(db: D1Database, keyOrId: string) {
  const row = await db.prepare('SELECT * FROM cc_development_tasks WHERE task_key = ? OR id = ?').bind(keyOrId, Number(keyOrId) || -1).first()
  return row ? hydrate(row) : null
}

export async function getDevelopmentSummary(db: D1Database) {
  const counts = await db.prepare('SELECT status, COUNT(*) AS count FROM cc_development_tasks GROUP BY status').all<{status: DevelopmentStatus; count: number}>()
  const byStatus = Object.fromEntries(DEVELOPMENT_STATUSES.map((s) => [s, counts.results.find((r) => r.status === s)?.count ?? 0]))
  const active = await db.prepare("SELECT * FROM cc_development_tasks WHERE status IN ('RESEARCHING','IMPLEMENTING','TESTING','PREVIEW_VERIFYING','COMMITTING') ORDER BY priority,id LIMIT 1").first()
  const next = await db.prepare("SELECT * FROM cc_development_tasks WHERE status IN ('READY','QUEUED') ORDER BY priority,id LIMIT 1").first()
  const verticals = await db.prepare('SELECT COUNT(DISTINCT vertical) AS count FROM cc_development_tasks').first<{count:number}>()
  const latest = await db.prepare('SELECT task_key,commit_sha,remote_sha,last_verified_at,updated_at FROM cc_development_tasks WHERE last_verified_at IS NOT NULL ORDER BY last_verified_at DESC LIMIT 1').first()
  return { totalTasks: Object.values(byStatus).reduce((a: number,b: any) => a + Number(b), 0), registeredVerticals: verticals?.count ?? 0, byStatus, activeTask: active ? hydrate(active) : null, nextEligibleTask: next ? hydrate(next) : null, lastVerified: latest ?? null, generatedAt: new Date().toISOString() }
}

export async function listDevelopmentEvents(db: D1Database, taskId: number, limit = 50) {
  const { results } = await db.prepare('SELECT * FROM cc_development_events WHERE task_id = ? ORDER BY id DESC LIMIT ?').bind(taskId, Math.min(limit, 100)).all()
  return results
}

export async function updateDevelopmentTask(db: D1Database, taskKey: string, patch: Record<string, any>, actorUserId: number | null) {
  const current = await getDevelopmentTask(db, taskKey); if (!current) return null
  const allowed = ['status','checkpoint','attempt','rea_state','rea_evidence_ids_json','reference_urls_json','implementation_state','automated_test_state','preview_state','external_integration_state','sandbox_e2e_state','production_prerequisites_state','production_deployment_state','production_verification_state','build_result','test_result','browser_acceptance','preview_routes_json','screenshot_refs_json','limitations','blocker_details','commit_sha','remote_sha','last_verified_at','next_task_key','assigned_subsystem']
  const fields = allowed.filter((k) => patch[k] !== undefined)
  if (fields.length === 0) return current
  const values = fields.map((k) => patch[k])
  const sql = `UPDATE cc_development_tasks SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now'), started_at = CASE WHEN started_at IS NULL AND ? IN ('IMPLEMENTING','TESTING','PREVIEW_VERIFYING','COMMITTING') THEN datetime('now') ELSE started_at END WHERE task_key = ?`
  values.push(patch.status ?? current.status, taskKey)
  await db.prepare(sql).bind(...values).run()
  const updated = await getDevelopmentTask(db, taskKey)
  await db.prepare('INSERT INTO cc_development_events (task_id,event_type,status,message,evidence_json,actor_user_id) VALUES (?,?,?,?,?,?)').bind(current.id, 'task_updated', updated?.status ?? null, patch.message ?? `Task updated: ${fields.join(', ')}`, JSON.stringify(patch.evidence ?? {}), actorUserId).run()
  return updated
}
