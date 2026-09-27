document.addEventListener('DOMContentLoaded', async () => {
    const savedUser = getSavedUser();
    if (savedUser) {
        window.location.replace('dashboard.html');
        return;
    }

    const go = (path) => { window.location.href = path; };
    document.getElementById('landing-login-btn')?.addEventListener('click', () => go('login.html'));
    document.getElementById('hero-login-btn')?.addEventListener('click', () => go('login.html'));
    document.getElementById('landing-register-btn')?.addEventListener('click', () => go('register.html'));
    document.getElementById('hero-register-btn')?.addEventListener('click', () => go('register.html'));

    // v8.9: aggregate-only public stats. No row-level operational data is exposed.
    try {
        if (!Database.initialized) Database.init();
        const stats = await Database.getPublicStats();
        const requestsEl = document.getElementById('stat-requests');
        const usersEl = document.getElementById('stat-users');
        const itemsEl = document.getElementById('stat-items');
        if (requestsEl) requestsEl.textContent = Number(stats.requests_processed || 0).toLocaleString();
        if (usersEl) usersEl.textContent = Number(stats.active_users || 0).toLocaleString();
        if (itemsEl) itemsEl.textContent = Number(stats.inventory_items || 0).toLocaleString();
    } catch (error) {
        console.warn('Public aggregate stats unavailable:', error.message);
    }
});
