// Recovery authorization exists only in this page's memory. An ordinary sign-in
// session, URL token, or stored flag never grants permission to change a password.
function createPasswordRecovery(auth, now = Date.now, clearMatchingSession = async () => {}) {
    let email = '';
    let step = 'email';
    let proof = null;
    let generation = 0;
    let busy = false;
    let resendAt = 0;
    let updatedUserId = null;
    const normalize = value => String(value || '').trim().toLowerCase();
    const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    const requireProof = () => {
        if (!proof || step !== 'password') throw Error('Verify a recovery code before setting a new password.');
        return proof;
    };
    const matches = (user, expected) => user?.id === expected.id && normalize(user.email) === expected.email;
    const invalidate = () => { proof = null; generation++; if (step === 'password') step = 'email'; };
    const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
        // Never call asynchronous auth methods inside Supabase's auth callback.
        if (event === 'SIGNED_IN' || (proof && !matches(session?.user, proof))) invalidate();
    });
    async function finish() {
        const { error } = await auth.signOut({ scope: 'local' }).catch(() => ({ error: true }));
        if (error) throw Error('Password changed. Please retry finishing sign out before returning to sign in.');
        try { await clearMatchingSession(updatedUserId); }
        catch (_) { throw Error('Password changed. Please retry finishing sign out before returning to sign in.'); }
        updatedUserId = null;
        email = '';
        step = 'complete';
    }
    return {
        state: () => ({ email, step, busy, resendSeconds: Math.max(0, Math.ceil((resendAt - now()) / 1000)) }),
        changeEmail(value) {
            const next = normalize(value);
            if (email !== next) { invalidate(); email = next; step = 'email'; }
        },
        async request(value) {
            if (busy) throw Error('Please wait for the current request to finish.');
            const target = normalize(value);
            if (!validEmail(target)) throw Error('Enter a valid email address.');
            if (resendAt > now()) throw Error('Please wait before requesting another code.');
            this.changeEmail(target);
            invalidate();
            busy = true;
            resendAt = now() + 60000;
            const version = generation;
            let requestError = null;
            try {
                const { error } = await auth.resetPasswordForEmail(target);
                requestError = error;
            } catch (_) { requestError = { code: 'network_failure' }; }
            finally { busy = false; }
            if (requestError) {
                // Expose an actionable delivery failure, never provider details or
                // the submitted email. A successful API response stays generic.
                const rateLimited = requestError.status === 429 ||
                    ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(requestError.code);
                throw Error(rateLimited
                    ? 'Too many recovery requests. Please wait a minute before trying again.'
                    : 'Unable to request a recovery code right now. Please wait a moment and try again.');
            }
            if (version === generation) step = 'code';
            return 'If an account exists for this email, a recovery code will be sent. Check your inbox and spam folder. If it does not arrive, wait and try again.';
        },
        async verify(value, code) {
            if (busy) throw Error('Please wait for the current request to finish.');
            const target = normalize(value);
            if (step !== 'code' || target !== email) throw Error('Request a recovery code for this email first.');
            if (!/^\d{6,10}$/.test(String(code || '').trim())) throw Error('Enter the recovery code from your email.');
            invalidate();
            const version = generation;
            busy = true;
            try {
                const { data, error } = await auth.verifyOtp({ email: target, token: code.trim(), type: 'recovery' });
                const user = data?.session?.user;
                if (error || !user?.id || normalize(user.email) !== target || version !== generation) {
                    if (data?.session) await auth.signOut({ scope: 'local' });
                    throw Error('That recovery code is invalid or expired. Request a new code and try again.');
                }
                proof = { id: user.id, email: target };
                step = 'password';
            } catch (_) {
                proof = null;
                throw Error('That recovery code is invalid or expired. Request a new code and try again.');
            } finally { busy = false; }
        },
        async update(password, confirmation) {
            if (busy) throw Error('Please wait for the current request to finish.');
            if (step === 'cleanup') {
                busy = true;
                try { await finish(); } finally { busy = false; }
                return;
            }
            const verified = requireProof();
            if (String(password || '').length < 8) throw Error('Use a password with at least 8 characters.');
            if (password !== confirmation) throw Error('Passwords do not match.');
            busy = true;
            try {
                const { data: sessionData, error: sessionError } = await auth.getSession().catch(() => ({ error: true }));
                const { data: userData, error: userError } = await auth.getUser().catch(() => ({ error: true }));
                if (sessionError || userError || proof !== verified || !matches(sessionData?.session?.user, verified) ||
                    !matches(userData?.user, verified) || (sessionData.session.expires_at && sessionData.session.expires_at * 1000 <= now())) {
                    invalidate();
                    throw Error('Your recovery session expired or changed. Request and verify a new code.');
                }
                const { data, error } = await auth.updateUser({ password }).catch(() => ({ error: true }));
                if (error || !matches(data?.user, verified)) throw Error('Unable to change the password. Try again or request a new recovery code.');
                updatedUserId = verified.id;
                proof = null;
                step = 'cleanup';
                await finish();
            } finally { busy = false; }
        },
        async cancel() {
            invalidate();
            const { error } = await auth.signOut({ scope: 'local' }).catch(() => ({ error: true }));
            if (error) throw Error('Unable to finish signing out. Please try again.');
            email = '';
            subscription.unsubscribe();
        }
    };
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('password-recovery');
    if (!root) return;
    const emailInput = document.getElementById('recovery-email');
    const codeInput = document.getElementById('recovery-code');
    const passwordInput = document.getElementById('recovery-password');
    const confirmationInput = document.getElementById('recovery-confirmation');
    const status = document.getElementById('recovery-status');
    const requestForm = document.getElementById('recovery-email-form');
    const codeForm = document.getElementById('recovery-code-form');
    const passwordForm = document.getElementById('recovery-password-form');
    const resend = document.getElementById('recovery-resend');
    const change = document.getElementById('recovery-change-email');
    const back = document.getElementById('recovery-back');
    const clearCredentials = () => { codeInput.value = ''; passwordInput.value = ''; confirmationInput.value = ''; };
    function message(text, isError = false) { status.textContent = text; status.classList.toggle('recovery-error', isError); }
    if (!Database.init()) {
        message('Recovery is temporarily unavailable. Please reload and try again.', true);
        root.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
        root.querySelectorAll('form').forEach(form => form.addEventListener('submit', event => event.preventDefault()));
        return;
    }
    const recovery = createPasswordRecovery(Database.supabase.auth, Date.now, async (userId) => {
        // Clear a matching normal session without disturbing a different signed-in account.
        const normal = window.supabase.createClient(Database.config.supabaseUrl, Database.config.supabaseKey);
        const { data, error } = await normal.auth.getSession();
        if (error) throw Error('Password changed. Please retry finishing sign out.');
        if (data?.session?.user?.id === userId) {
            const { error: signOutError } = await normal.auth.signOut({ scope: 'local' });
            if (signOutError) throw Error('Password changed. Please retry finishing sign out.');
        }
        try {
            const saved = JSON.parse(localStorage.getItem('currentUser') || 'null');
            if (saved?.id === userId || saved?.authId === userId) localStorage.removeItem('currentUser');
        } catch (_) { /* A malformed profile is not recovery authorization. */ }
    });
    function render() {
        const state = recovery.state();
        requestForm.hidden = state.step !== 'email';
        codeForm.hidden = state.step !== 'code';
        passwordForm.hidden = !['password', 'cleanup'].includes(state.step);
        document.getElementById('recovery-target').textContent = state.email;
        change.hidden = !['code', 'password'].includes(state.step);
        root.querySelectorAll('input, button').forEach(control => { control.disabled = state.busy; });
        resend.disabled = state.busy || state.resendSeconds > 0;
        resend.textContent = state.resendSeconds > 0 ? `Resend code in ${state.resendSeconds}s` : 'Resend code';
        back.setAttribute('aria-disabled', String(state.busy));
        const cleanup = state.step === 'cleanup';
        passwordInput.disabled = confirmationInput.disabled = state.busy || cleanup;
        document.getElementById('recovery-update').textContent = cleanup ? 'Finish signing out' : 'Save New Password';
        if (cleanup) clearCredentials();
    }
    async function act(operation, success, focus) {
        if (recovery.state().busy) return;
        try {
            const pending = operation();
            render();
            const result = await pending;
            message(result || success);
            if (recovery.state().step === 'complete') {
                clearCredentials();
                emailInput.value = '';
                window.location.replace('login.html?password=reset');
                return;
            }
            render();
            if (focus) focus.focus();
        } catch (error) {
            message(error.message || 'Unable to continue. Please try again.', true);
            if (recovery.state().step !== 'password') clearCredentials();
            render();
        }
    }
    emailInput.addEventListener('input', () => { recovery.changeEmail(emailInput.value); clearCredentials(); });
    requestForm.addEventListener('submit', event => { event.preventDefault(); act(() => recovery.request(emailInput.value), '', codeInput); });
    resend.addEventListener('click', () => act(() => recovery.request(emailInput.value), '', codeInput));
    codeForm.addEventListener('submit', event => {
        event.preventDefault();
        const code = codeInput.value;
        codeInput.value = '';
        act(() => recovery.verify(emailInput.value, code), 'Code verified. Choose your new password.', passwordInput);
    });
    passwordForm.addEventListener('submit', event => {
        event.preventDefault();
        act(() => recovery.update(passwordInput.value, confirmationInput.value), 'Password changed. Sign in again.');
    });
    change.addEventListener('click', () => {
        clearCredentials();
        act(async () => { await recovery.cancel(); window.location.replace('reset-password.html'); }, '');
    });
    back.addEventListener('click', event => {
        event.preventDefault();
        if (recovery.state().busy) return;
        clearCredentials();
        act(async () => { await recovery.cancel(); window.location.replace('login.html'); }, '');
    });
    window.addEventListener('pagehide', clearCredentials);
    const timer = setInterval(render, 1000);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    render();
});
