// Core workflow tests for js/database.js: maintenance requests, approvals,
// borrowing and the read cache. Runs the real file against a fake Supabase
// client, so no network or database is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'database.js'), 'utf8');

function load(responses = {}) {
  const calls = [];
  const client = {
    auth: { onAuthStateChange() {} },
    rpc: async (name, args) => {
      calls.push(JSON.parse(JSON.stringify({ name, args })));
      const reply = responses[name];
      return typeof reply === 'function' ? reply(args) : reply || { data: null, error: null };
    }
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    structuredClone,
    Date,
    window: { supabase: { createClient: () => client } },
    document: { body: { hasAttribute: () => false } },
    currentUser: { id: 'user-1' }
  };
  vm.runInNewContext(`${source}\nthis.Database = Database;`, sandbox);
  sandbox.Database.init(); // the app initializes the client at startup
  return { db: sandbox.Database, calls, sandbox };
}

const ok = data => ({ data, error: null });
const fail = message => ({ data: null, error: new Error(message) });

test('createRequest submits through the server RPC and returns the server-generated ID', async () => {
  const { db, calls } = load({ submit_maintenance_request_v801: ok('REQ-0042') });
  const result = JSON.parse(JSON.stringify(await db.createRequest({
    classroom: 'Room 202', issueType: 'Electrical', description: 'Lights out',
    priority: 'high', dateSubmitted: '2026-10-15', attachment: 'data:image/png;base64,AAAA'
  })));
  assert.equal(result.id, 'REQ-0042');
  assert.deepEqual(calls, [{
    name: 'submit_maintenance_request_v801',
    args: {
      p_classroom: 'Room 202', p_issue_type: 'Electrical', p_description: 'Lights out',
      p_priority: 'high', p_date_submitted: '2026-10-15', p_photo_url: 'data:image/png;base64,AAAA'
    }
  }]);
});

test('createRequest surfaces server errors', async () => {
  const { db } = load({ submit_maintenance_request_v801: fail('Approved account required') });
  await assert.rejects(db.createRequest({ classroom: 'A' }), /Approved account required/);
});

test('getRequests maps database rows and filters by submitter', async () => {
  const rows = [
    { request_id: 'REQ-0001', classroom: 'Lab', issue_type: 'Plumbing', description: 'Leak', priority: 'urgent',
      submitted_by_name: 'Ana', submitted_by_auth: 'user-1', date_submitted: '2026-10-01', status: 'pending', photo_url: null },
    { request_id: 'REQ-0002', classroom: 'Hall', issue_type: 'Furniture', description: 'Chair', priority: 'low',
      submitted_by_legacy: 'legacy-9', date_submitted: '2026-10-02', status: 'completed', notes: 'Fixed' }
  ];
  const { db } = load({ get_maintenance_requests_v102: ok(rows) });
  const all = await db.getRequests();
  assert.equal(all.length, 2);
  assert.equal(all[0].id, 'REQ-0001');
  assert.equal(all[0].issueType, 'Plumbing');
  assert.equal(all[0].submittedBy, 'Ana');
  assert.equal(all[1].submittedBy, 'Legacy User');
  assert.equal(all[1].submittedById, 'legacy-9');
  assert.equal(all[1].notes, 'Fixed');
  const mine = await db.getRequests('user-1');
  assert.deepEqual(mine.map(r => r.id), ['REQ-0001']);
});

test('completeMaintenanceRequest sends typed arguments and omits quantity when not deducting', async () => {
  const { db, calls } = load({ complete_maintenance_request_v86: ok({ remaining_quantity: 3 }) });
  await db.completeMaintenanceRequest('REQ-0007', true, '12', '2');
  await db.completeMaintenanceRequest('REQ-0008', false, null, '5');
  assert.deepEqual(calls[0].args, { p_request_id: 'REQ-0007', p_deduct_inventory: true, p_inventory_item_id: 12, p_quantity: 2 });
  assert.deepEqual(calls[1].args, { p_request_id: 'REQ-0008', p_deduct_inventory: false, p_inventory_item_id: null, p_quantity: null });
});

test('updateRequest reports failure instead of throwing', async () => {
  const { db } = load({ update_maintenance_request_v8: fail('Admin required') });
  assert.equal(await db.updateRequest('REQ-0001', { status: 'in-progress' }), false);
});

test('account approval and rejection use the profile RPCs', async () => {
  const { db, calls } = load({ approve_profile: ok(null), reject_profile: ok(null) });
  assert.equal(await db.approveAuthProfile('p-1'), true);
  assert.equal(await db.rejectAuthProfile('p-2', 'Unreadable document'), true);
  assert.deepEqual(calls, [
    { name: 'approve_profile', args: { p_profile_id: 'p-1' } },
    { name: 'reject_profile', args: { p_profile_id: 'p-2', p_reason: 'Unreadable document' } }
  ]);
  const denied = load({ approve_profile: fail('Super admin required') });
  await assert.rejects(denied.db.approveAuthProfile('p-3'), /Super admin required/);
});

test('borrowing workflow calls each RPC with numeric IDs', async () => {
  const { db, calls } = load({
    submit_borrow_request_v81: ok(31),
    approve_borrow_request_v81: ok(true),
    reject_borrow_request_v81: ok(true),
    return_borrow_item_v81: ok(1)
  });
  await db.borrowItem({ item_id: '4', quantity: '3', purpose: 'Seminar', expected_return_date: '2026-10-20' });
  await db.approveBorrowTransaction('31');
  await db.rejectBorrowTransaction('32');
  assert.equal(await db.returnItem('31'), true);
  assert.deepEqual(calls.map(c => c.name), ['submit_borrow_request_v81', 'approve_borrow_request_v81', 'reject_borrow_request_v81', 'return_borrow_item_v81']);
  assert.deepEqual(calls[0].args, { p_item_id: 4, p_quantity: 3, p_purpose: 'Seminar', p_expected_return_date: '2026-10-20' });
  assert.deepEqual(calls.slice(1).map(c => c.args.p_transaction_id), [31, 32, 31]);
});

test('reads are cached until a write clears them', async () => {
  const { db, calls } = load({
    get_maintenance_requests_v102: ok([]),
    submit_maintenance_request_v801: ok('REQ-0003')
  });
  await db.getRequests();
  await db.getRequests();
  assert.equal(calls.filter(c => c.name === 'get_maintenance_requests_v102').length, 1, 'second read served from cache');
  await db.createRequest({ classroom: 'Lab' });
  await db.getRequests();
  assert.equal(calls.filter(c => c.name === 'get_maintenance_requests_v102').length, 2, 'write cleared the cache');
});

test('a failed write still clears the cache because the server may have committed', async () => {
  const { db, calls } = load({
    get_inventory_v8: ok([]),
    get_maintenance_requests_v102: ok([]),
    approve_borrow_request_v81: fail('timeout')
  });
  await db.getRequests();
  await assert.rejects(db.approveBorrowTransaction('9'), /timeout/);
  await db.getRequests();
  assert.equal(calls.filter(c => c.name === 'get_maintenance_requests_v102').length, 2);
});

test('a failed read is not cached', async () => {
  let attempt = 0;
  const { db } = load({
    get_maintenance_requests_v102: () => (++attempt === 1 ? fail('network') : ok([]))
  });
  await assert.rejects(db.getRequests(), /network/);
  assert.equal((await db.getRequests()).length, 0);
});

test('borrowing initializes the client itself when called before the dashboard init', async () => {
  const { db, calls } = load({ submit_borrow_request_v81: ok(7) });
  db.initialized = false;
  db.supabase = null;
  assert.equal(await db.borrowItem({ item_id: 1, quantity: 1, purpose: 'Class', expected_return_date: '2026-10-20' }), 7);
  assert.equal(calls[0].name, 'submit_borrow_request_v81');
});

test('the request list carries a has_photo flag instead of the photo itself', async () => {
  const { db } = load({ get_maintenance_requests_v102: ok([
    { request_id: 'REQ-0001', issue_type: 'Plumbing', has_photo: true },
    { request_id: 'REQ-0002', issue_type: 'Furniture', has_photo: false }
  ]) });
  const [withPhoto, without] = await db.getRequests();
  assert.equal(withPhoto.hasAttachment, true);
  assert.equal(withPhoto.attachment, null);
  assert.equal(without.hasAttachment, false);
});

test('falls back to the v8 list when the v10.2 migration is not applied yet', async () => {
  const { db, calls } = load({
    get_maintenance_requests_v102: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } },
    get_maintenance_requests_v8: ok([{ request_id: 'REQ-0003', issue_type: 'Electrical', photo_url: 'data:image/png;base64,AAAA' }])
  });
  const [row] = await db.getRequests();
  assert.deepEqual(calls.map(c => c.name), ['get_maintenance_requests_v102', 'get_maintenance_requests_v8']);
  assert.equal(row.hasAttachment, true);
  assert.equal(row.attachment, 'data:image/png;base64,AAAA');
});

test('a single photo is fetched on demand and cached briefly', async () => {
  const { db, calls } = load({ get_maintenance_request_photo_v102: ok('data:image/jpeg;base64,BBBB') });
  assert.equal(await db.getRequestPhoto('REQ-0004'), 'data:image/jpeg;base64,BBBB');
  assert.equal(await db.getRequestPhoto('REQ-0004'), 'data:image/jpeg;base64,BBBB');
  assert.deepEqual(calls, [{ name: 'get_maintenance_request_photo_v102', args: { p_request_id: 'REQ-0004' } }]);
});

test('other list errors are not hidden by the fallback', async () => {
  const { db, calls } = load({ get_maintenance_requests_v102: fail('Approved account required') });
  await assert.rejects(db.getRequests(), /Approved account required/);
  assert.equal(calls.length, 1);
});
