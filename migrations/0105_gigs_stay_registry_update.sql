-- Truthful local/development registry update for the NaijaGigs collaboration and
-- NaijaStay host-operation checkpoint. This records implementation and automated
-- evidence without claiming browser, external integration, or production proof.
UPDATE cc_development_tasks
SET status = 'PARTIAL',
    checkpoint = 'Authorized milestones/messages are implemented; browser acceptance remains blocked.',
    implementation_state = 'IMPLEMENTED',
    automated_test_state = 'PASSED',
    preview_state = 'PREVIEW_VERIFIED',
    external_integration_state = 'NOT_CONFIGURED',
    sandbox_e2e_state = 'PASSED',
    production_prerequisites_state = 'NOT_ASSESSED',
    production_deployment_state = 'NOT_DEPLOYED',
    production_verification_state = 'NOT_VERIFIED',
    build_result = 'npm run build passed with 273 modules.',
    test_result = 'NaijaGigs collaboration regression passed; ownership, transitions, persistence, idempotency and unpaid state covered.',
    browser_acceptance = 'BLOCKED: no authorized isolated customer/provider browser session available.',
    preview_routes_json = '["/gigs","/api/service-orders/:id/collaboration"]',
    limitations = 'No payment, escrow, settlement, production mutation, or browser acceptance claimed.',
    blocker_details = 'Authenticated browser acceptance requires an approved isolated customer/provider session.',
    next_task_key = 'STAY-001',
    updated_at = datetime('now')
WHERE task_key = 'GIGS-001';

UPDATE cc_development_tasks
SET status = 'PARTIAL',
    checkpoint = 'Generic booking engine host listing, resource and availability operations are implemented and ownership-tested; host workspace remains.',
    implementation_state = 'IMPLEMENTED',
    automated_test_state = 'PASSED',
    preview_state = 'PREVIEW_VERIFIED',
    external_integration_state = 'NOT_CONFIGURED',
    sandbox_e2e_state = 'PASSED',
    production_prerequisites_state = 'NOT_ASSESSED',
    production_deployment_state = 'NOT_DEPLOYED',
    production_verification_state = 'NOT_VERIFIED',
    build_result = 'npm run build passed with 273 modules.',
    test_result = 'NaijaStay host operations regression passed; ownership, listing update, availability block and invalid rule validation covered.',
    browser_acceptance = 'BLOCKED: no authorized isolated host/customer browser session available.',
    preview_routes_json = '["/stay","/api/booking-providers/me/bookable-listings"]',
    limitations = 'No production bookings, payment, external host integration, or browser acceptance claimed.',
    blocker_details = 'Host workspace UI and authenticated browser acceptance remain dependency-ready follow-up work.',
    next_task_key = 'STAY-001',
    updated_at = datetime('now')
WHERE task_key = 'STAY-001';
