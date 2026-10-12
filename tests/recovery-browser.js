async page => {
    const assert = (value, message) => { if (!value) throw Error(message); };
    const context = page.context();
    page.setDefaultTimeout(6000);
    page.setDefaultNavigationTimeout(6000);
    // The local fixture strips CDN assets; only this in-memory provider is used.
    await context.addInitScript(() => {
        window.fixture = { requests: 0, updates: 0, signouts: [], normalId: location.search.includes('normal=same') ? 'recovered-user' : 'other-user', options: [], capture: false };
        window.addEventListener('pagehide', () => {
            if (fixture.capture) sessionStorage.setItem('synthetic-evidence', JSON.stringify({
                updates: fixture.updates, signouts: fixture.signouts,
                credentialsCleared: ['recovery-code', 'recovery-password', 'recovery-confirmation'].every(id => !document.getElementById(id)?.value)
            }));
        });
        window.emailjs = { init() {} };
        window.supabase = { createClient(url, key, options) {
            if (location.search.includes('unavailable')) throw Error('Synthetic unavailable provider');
            const isolated = !!options?.auth?.storageKey;
            window.fixture.options.push(options?.auth || {});
            let session = isolated ? null : { user: { id: window.fixture.normalId, email: 'other@example.test' } };
            const callbacks = [];
            return {
                auth: {
                    onAuthStateChange(callback) { callbacks.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
                    async resetPasswordForEmail() {
                        window.fixture.requests++; await new Promise(resolve => setTimeout(resolve, 200));
                        if (location.search.includes('network-error')) throw Error('private provider detail for person@example.test');
                        return { error: location.search.includes('request-error') ? { code: 'unexpected_failure', message: 'private SMTP detail for person@example.test' }
                            : location.search.includes('rate-limit') ? { code: 'over_email_send_rate_limit', message: 'private rate detail for person@example.test' } : null };
                    },
                    async verifyOtp(args) {
                        if (args.type !== 'recovery') throw Error('Wrong OTP type');
                        if (args.token !== '123456') return { error: {} };
                        session = { user: { id: 'recovered-user', email: args.email }, expires_at: Math.floor(Date.now() / 1000) + 3600 };
                        callbacks.forEach(callback => callback('PASSWORD_RECOVERY', session));
                        return { data: { session, user: session.user }, error: null };
                    },
                    async getSession() { return { data: { session: !isolated && location.pathname.endsWith('login.html') ? null : session }, error: null }; },
                    async getUser() { return { data: { user: session?.user }, error: null }; },
                    async updateUser() { window.fixture.updates++; return { data: { user: session.user }, error: null }; },
                    async signOut() {
                        window.fixture.signouts.push(isolated ? 'recovery' : 'normal'); session = null;
                        if (fixture.capture) sessionStorage.setItem('synthetic-evidence', JSON.stringify({ updates: fixture.updates, signouts: fixture.signouts }));
                        callbacks.forEach(callback => callback('SIGNED_OUT', null)); return { error: null };
                    }
                },
                from() { return { select() { return this; }, eq() { return this; }, async single() { return { data: null, error: {} }; } }; }
            };
        } };
    });
    const base = 'http://127.0.0.1:5203/';
    await page.goto(base + 'login.html');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await page.waitForURL('**/reset-password.html');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile page overflow');
    await page.getByLabel('Email', { exact: true }).fill('person@example.test');
    await page.getByLabel('Email', { exact: true }).press('Enter');
    await page.getByLabel('Recovery code', { exact: true }).waitFor({ state: 'visible' });
    assert(await page.getByRole('button', { name: /Resend code in/ }).isDisabled(), 'Cooldown not enforced');
    assert(await page.evaluate(() => document.activeElement.id === 'recovery-code'), 'Keyboard focus must advance to code');
    await page.getByLabel('Recovery code', { exact: true }).fill('000000');
    await page.getByLabel('Recovery code', { exact: true }).press('Enter');
    await page.getByRole('status').filter({ hasText: /invalid or expired/ }).waitFor();
    assert(await page.locator('#recovery-password-form').isHidden(), 'Wrong code granted access');
    await page.getByLabel('Recovery code', { exact: true }).fill('123456');
    await page.getByLabel('Recovery code', { exact: true }).press('Enter');
    await page.getByLabel('New password', { exact: true }).waitFor({ state: 'visible' });
    assert(await page.evaluate(() => location.pathname.endsWith('/reset-password.html')), 'Recovery incorrectly redirected');
    assert(await page.evaluate(() => document.activeElement.id === 'recovery-password'), 'Keyboard focus must advance to password');
    assert(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0), 'Recovery stored credentials or proof');
    const config = await page.evaluate(() => fixture.options[0]);
    assert(config.persistSession === false && config.detectSessionInUrl === false && config.autoRefreshToken === false, 'Recovery session isolation missing');
    await page.getByLabel('New password', { exact: true }).fill('NewPass!123');
    await page.getByLabel('Confirm new password', { exact: true }).fill('Mismatch!123');
    await page.getByRole('button', { name: 'Save New Password' }).click();
    await page.getByRole('status').filter({ hasText: /do not match/ }).waitFor();
    assert(await page.evaluate(() => fixture.updates === 0), 'Mismatch updated a password');
    // Record only counters, never the submitted password or OTP.
    await page.evaluate(() => { fixture.capture = true; });
    await page.getByLabel('Confirm new password', { exact: true }).fill('NewPass!123');
    await page.getByLabel('Confirm new password', { exact: true }).press('Enter');
    await page.getByRole('status').filter({ hasText: /Password changed/ }).waitFor();
    const result = await page.evaluate(() => JSON.parse(sessionStorage.getItem('synthetic-evidence')));
    assert(result.updates === 1 && result.signouts.join() === 'recovery' && result.credentialsCleared, 'Recovery must clear credentials, sign out and preserve different normal account');
    await page.evaluate(() => sessionStorage.removeItem('synthetic-evidence'));
    await page.goto(base + 'reset-password.html?unavailable');
    await page.getByRole('status').filter({ hasText: /temporarily unavailable/ }).waitFor();
    assert(await page.getByRole('button', { name: 'Send Recovery Code' }).isDisabled(), 'Unavailable recovery form must block native submission');
    await page.goto(base + 'reset-password.html?normal=same');
    await page.getByLabel('Email', { exact: true }).fill('person@example.test');
    await page.getByRole('button', { name: 'Send Recovery Code' }).click();
    await page.getByLabel('Recovery code', { exact: true }).fill('123456');
    await page.getByRole('button', { name: 'Verify Code' }).click();
    await page.getByLabel('New password', { exact: true }).fill('NewPass!123');
    await page.getByLabel('Confirm new password', { exact: true }).fill('NewPass!123');
    await page.evaluate(() => { fixture.capture = true; });
    await page.getByRole('button', { name: 'Save New Password' }).click();
    await page.getByRole('status').filter({ hasText: /Password changed/ }).waitFor();
    const matching = await page.evaluate(() => JSON.parse(sessionStorage.getItem('synthetic-evidence')));
    assert(matching.signouts.join() === 'recovery,normal', 'Matching normal account must also sign out');
    await page.evaluate(() => sessionStorage.removeItem('synthetic-evidence'));
    for (const failure of ['request-error', 'rate-limit', 'network-error']) {
        await page.goto(base + 'reset-password.html?' + failure);
        await page.getByLabel('Email', { exact: true }).fill('person@example.test');
        await page.getByRole('button', { name: 'Send Recovery Code' }).click();
        await page.getByRole('status').filter({ hasText: /try again|trying again/ }).waitFor();
        const text = await page.getByRole('status').textContent();
        assert(!/private|person@example/.test(text), 'Request failure leaked provider details');
        assert(await page.locator('#recovery-code-form').isHidden(), 'Failed delivery incorrectly showed code verification');
        assert(await page.evaluate(() => fixture.requests === 1 && fixture.updates === 0), 'Request failure affected recovery authorization');
    }
    return { passed: true, checks: ['forgot password entry', '390px mobile', 'keyboard focus and submit', 'wrong code', 'cooldown', 'recovery stays on page', 'memory-only session', 'password mismatch', 'password update once', 'credentials cleared before navigation', 'recovery signout', 'different normal account preserved', 'matching normal account cleared', 'unavailable provider blocks submission', 'return to sign in with success notice', 'safe SMTP, rate-limit and network errors'] };
}
