const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const sourcePath = path.join(__dirname, '../js/password-recovery.js');
function setup(options = {}) {
    let session = options.ordinarySession ? { user: { id: 'ordinary-user', email: 'person@example.test' } } : null;
    let listener;
    let requests = 0;
    let updates = 0;
    let signsOut = 0;
    let clock = 1000;
    const auth = {
        onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
        async resetPasswordForEmail(email) {
            requests++;
            if (options.requestError) throw Error('private provider detail');
            return { error: options.requestCode ? { code: options.requestCode, message: 'private SMTP detail for person@example.test' } : null };
        },
        async verifyOtp(args) {
            assert.equal(args.type, 'recovery');
            if (args.token !== '123456') return { error: { message: 'expired' } };
            session = { user: { id: 'verified-user', email: options.otherEmail || args.email }, expires_at: 10000 };
            listener('PASSWORD_RECOVERY', session);
            return { data: { session, user: session.user }, error: null };
        },
        async getSession() { return { data: { session }, error: null }; },
        async getUser() { if (options.networkError) throw Error('sensitive provider detail'); if (options.expired) return { error: {} }; return { data: { user: session?.user }, error: null }; },
        async updateUser({ password }) { updates++; assert.equal(password, 'NewPass!123'); return { data: { user: session.user }, error: options.updateError ? {} : null }; },
        async signOut() { signsOut++; if (options.signOutError) return { error: {} }; session = null; listener('SIGNED_OUT', null); return { error: null }; }
    };
    const context = vm.createContext({ console, Date, setTimeout, clearTimeout });
    if (fs.existsSync(sourcePath)) vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
    assert.equal(typeof context.createPasswordRecovery, 'function', 'Recovery controller must exist');
    const recovery = context.createPasswordRecovery(auth, () => clock);
    return { recovery, stats: () => ({ requests, updates, signsOut }), tick: () => { clock += 61000; }, changeAccount() { session = { user: { id: 'other-user', email: 'other@example.test' } }; listener('SIGNED_IN', session); } };
}

test('ordinary session and a wrong code cannot authorize password changes', async () => {
    const { recovery, stats } = setup({ ordinarySession: true });
    await assert.rejects(recovery.update('NewPass!123', 'NewPass!123'));
    await recovery.request('person@example.test');
    await assert.rejects(recovery.verify('person@example.test', '000000'));
    await assert.rejects(recovery.update('NewPass!123', 'NewPass!123'));
    assert.equal(stats().updates, 0);
});
test('recovery code permits one password update and signs out before success', async () => {
    const { recovery, stats } = setup();
    await recovery.request(' Person@Example.test ');
    await recovery.verify('person@example.test', '123456');
    assert.equal(recovery.state().step, 'password');
    await assert.rejects(recovery.update('short', 'short'));
    await assert.rejects(recovery.update('NewPass!123', 'Mismatch!123'));
    await recovery.update('NewPass!123', 'NewPass!123');
    assert.equal(recovery.state().step, 'complete');
    assert.deepEqual(stats(), { requests: 1, updates: 1, signsOut: 1 });
    await assert.rejects(recovery.update('NewPass!123', 'NewPass!123'));
});
test('changing email or account invalidates the verified recovery proof', async () => {
    for (const changed of ['email', 'account']) {
        const { recovery, stats, changeAccount } = setup();
        await recovery.request('person@example.test');
        await recovery.verify('person@example.test', '123456');
        if (changed === 'email') recovery.changeEmail('other@example.test'); else changeAccount();
        await assert.rejects(recovery.update('NewPass!123', 'NewPass!123'));
        assert.equal(stats().updates, 0);
    }
});
test('a provider session for another email and an expired session are rejected', async () => {
    const wrong = setup({ otherEmail: 'someone@example.test' });
    await wrong.recovery.request('person@example.test');
    await assert.rejects(wrong.recovery.verify('person@example.test', '123456'));
    assert.equal(wrong.stats().updates, 0);
    const expired = setup({ expired: true });
    await expired.recovery.request('person@example.test');
    await expired.recovery.verify('person@example.test', '123456');
    await assert.rejects(expired.recovery.update('NewPass!123', 'NewPass!123'));
    assert.equal(expired.stats().updates, 0);
});
test('network request errors are actionable without provider details and cooldown blocks duplicates', async () => {
    const { recovery, stats, tick } = setup({ requestError: true });
    await assert.rejects(recovery.request('person@example.test'), error => /try again/i.test(error.message) && !/private provider|person@example/.test(error.message));
    assert.equal(recovery.state().step, 'email');
    await assert.rejects(recovery.request('person@example.test'));
    assert.equal(stats().requests, 1);
    tick();
    await assert.rejects(recovery.request('person@example.test'));
    assert.equal(stats().requests, 2);
});
test('SMTP and rate-limit errors cannot claim that a recovery code was sent', async () => {
    for (const requestCode of ['unexpected_failure', 'over_email_send_rate_limit']) {
        const { recovery, stats } = setup({ requestCode });
        await assert.rejects(recovery.request('person@example.test'), error =>
            /try again|trying again/i.test(error.message) && !/private SMTP|person@example|unexpected_failure|over_email/.test(error.message));
        assert.equal(recovery.state().step, 'email');
        await assert.rejects(recovery.verify('person@example.test', '123456'));
        assert.equal(stats().updates, 0);
        assert.equal(recovery.state().resendSeconds, 60);
    }
});
test('successful recovery requests keep account existence private', async () => {
    const { recovery } = setup();
    const message = await recovery.request('unknown@example.test');
    assert.match(message, /If an account/i);
    assert.doesNotMatch(message, /unknown@example/);
    assert.equal(recovery.state().step, 'code');
});
test('failure to sign out cannot report a completed reset or update the password twice', async () => {
    const { recovery, stats } = setup({ signOutError: true });
    await recovery.request('person@example.test');
    await recovery.verify('person@example.test', '123456');
    await assert.rejects(recovery.update('NewPass!123', 'NewPass!123'));
    assert.equal(recovery.state().step, 'cleanup');
    await assert.rejects(recovery.update('', ''));
    assert.equal(stats().updates, 1);
});
test('network failures checking recovery never reveal provider details or update a password', async () => {
    const { recovery, stats } = setup({ networkError: true });
    await recovery.request('person@example.test');
    await recovery.verify('person@example.test', '123456');
    await assert.rejects(recovery.update('NewPass!123', 'NewPass!123'), error => !/sensitive provider/.test(error.message));
    assert.equal(stats().updates, 0);
});
