(function () {
    const emailInput = document.getElementById('otp-email');
    const codeInput = document.getElementById('otp-code');
    const form = document.getElementById('otp-form');
    const verifyBtn = document.getElementById('verify-btn');
    const resendBtn = document.getElementById('resend-btn');
    const message = document.getElementById('otp-message');

    function showMessage(text, bad = false) {
        message.style.display = 'block';
        message.textContent = text;
        message.className = `msg ${bad ? 'bad' : 'ok'}`;
    }

    function setBusy(button, busy, busyText, normalText) {
        button.disabled = busy;
        button.textContent = busy ? busyText : normalText;
    }

    const savedEmail = sessionStorage.getItem('zoltrack_verification_email') || '';
    if (savedEmail) emailInput.value = savedEmail;

    codeInput.addEventListener('input', () => {
        codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 10);
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = emailInput.value.trim();
        const token = codeInput.value.trim();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showMessage('Please enter a valid email address.', true);
            return;
        }
        if (!/^\d{6,10}$/.test(token)) {
            showMessage('Please enter the verification code from your email.', true);
            return;
        }

        setBusy(verifyBtn, true, 'Verifying...', 'Verify Email');
        showMessage('');
        try {
            if (!Database.initialized) Database.init();
            const { data, error } = await Database.supabase.auth.verifyOtp({
                email,
                token,
                type: 'email'
            });
            if (error) throw error;
            if (!data?.session?.user) throw new Error('Email verified, but no authenticated session was returned. Please sign in.');

           sessionStorage.removeItem('zoltrack_verification_email');

const authUser = data.session.user;

const { data: profile, error: profileError } =
    await Database.supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

if (profileError) throw profileError;

const user = {
    id: profile.id,
    email: authUser.email,
    fullName: profile.full_name,
    username: profile.username,
    role: profile.role,
    active: profile.active,
    approved: profile.approved,
    verificationDocument: profile.verification_document,
    verificationDocumentName: profile.verification_document_name,
    rejectionReason: profile.rejection_reason
};

localStorage.setItem('currentUser', JSON.stringify(user));

            if (user.active === false) {
                await Database.supabase.auth.signOut();
                throw new Error('This account has been deactivated. Please contact the Super Admin.');
            }

            if (!user.approved) {
                const needsVerification = !user.verificationDocument || Boolean(user.rejectionReason);
                window.location.replace(needsVerification ? 'verification.html' : 'pending-approval.html');
                return;
            }

            window.location.replace('dashboard.html');
        } catch (error) {
            console.error('OTP verification error:', error);
            showMessage(error?.message || 'The verification code is invalid or expired. Request a new code and try again.', true);
        } finally {
            setBusy(verifyBtn, false, 'Verifying...', 'Verify Email');
        }
    });

    // Store a deadline rather than decrementing a counter so refreshes and
    // background tabs keep the remaining wait accurate.
    const cooldownKey = 'zoltrack_resend_deadline';
    let sending = false;
    function remainingSeconds() {
        const deadline = Number(localStorage.getItem(cooldownKey)) || 0;
        return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    }
    function renderCooldown() {
        const seconds = remainingSeconds();
        resendBtn.disabled = sending || seconds > 0;
        resendBtn.textContent = sending ? 'Sending...' : seconds > 0
            ? `Resend Code (${seconds}s)` : 'Resend Code';
    }
    function startCooldown(seconds) {
        localStorage.setItem(cooldownKey, String(Date.now() + seconds * 1000));
        renderCooldown();
    }
    renderCooldown();
    setInterval(renderCooldown, 1000);
    window.addEventListener('storage', renderCooldown);
    document.addEventListener('visibilitychange', renderCooldown);

    resendBtn.addEventListener('click', async () => {
        if (sending || remainingSeconds() > 0) return;
        const email = emailInput.value.trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showMessage('Enter your email address first.', true);
            emailInput.focus();
            return;
        }
        sending = true;
        renderCooldown();
        try {
            if (!Database.initialized) Database.init();
            const { error } = await Database.supabase.auth.resend({
                type: 'signup',
                email,
                options: { emailRedirectTo: window.location.origin }
            });
            if (error) throw error;
            sessionStorage.setItem('zoltrack_verification_email', email);
            startCooldown(60);
            showMessage('A new verification code has been sent.');
        } catch (error) {
            console.error('Resend OTP error:', error);
            const wait = error?.message?.match(/after\s+(\d+)\s+seconds?/i);
            if (wait || error?.status === 429 || error?.code === 'over_email_send_rate_limit') {
                startCooldown(wait ? Number(wait[1]) : 60);
                showMessage('Please wait for the countdown before requesting another code.', true);
            } else {
                showMessage(error?.message || 'Could not resend the verification code. Please wait a moment and try again.', true);
            }
        } finally {
            sending = false;
            renderCooldown();
        }
    });
})();
