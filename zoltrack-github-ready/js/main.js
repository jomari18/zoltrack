let requests = [];
let currentUser = null;

function getSavedUser() {
    const raw = localStorage.getItem('currentUser');
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        localStorage.removeItem('currentUser');
        return null;
    }
}

function saveCurrentUser(user) {
    if (!user) return;
    const safeUser = { ...user };
    delete safeUser.password;
    currentUser = safeUser;
    localStorage.setItem('currentUser', JSON.stringify(safeUser));
}

async function loadData() {
    try {
        requests = await Database.getRequests();
    } catch (error) {
        console.error('Error loading application data:', error);
        requests = JSON.parse(localStorage.getItem('fixitRequests')) || [];
    }
}

function generateRequestId() {
    let maxId = 0;
    for (const req of requests || []) {
        const candidate = req.requestId || req.id;
        if (typeof candidate === 'string' && candidate.startsWith('REQ-')) {
            const num = parseInt(candidate.split('-')[1], 10);
            if (!Number.isNaN(num)) maxId = Math.max(maxId, num);
        }
    }
    return `REQ-${String(maxId + 1).padStart(4, '0')}`;
}

function formatStatus(status) {
    return ({ pending: 'Pending', 'in-progress': 'In Progress', completed: 'Completed' })[status] || status;
}

function formatRole(role) {
    return ({ user: 'User', admin: 'Admin', superadmin: 'Super Admin' })[role] || role;
}

function showNotification(message, type) {
    const notification = document.getElementById('notification');
    if (!notification) return;
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.add('show');
    setTimeout(() => notification.classList.remove('show'), 3000);
}

function checkPasswordStrength(password) {
    const requirements = {
        length: password.length >= 6,
        number: /[0-9]/.test(password),
        upper: /[A-Z]/.test(password),
        lower: /[a-z]/.test(password),
        symbol: /[@$!%*?&]/.test(password)
    };
    const map = { length: 'req-length', number: 'req-number', upper: 'req-upper', lower: 'req-lower', symbol: 'req-symbol' };
    for (const [key, id] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (el) el.textContent = requirements[key] ? '✅' : '❌';
    }
    const score = Object.values(requirements).filter(Boolean).length;
    const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
    const value = document.getElementById('strength-value');
    if (value) value.textContent = password ? labels[score] : 'Enter password';
    for (let i = 1; i <= 4; i++) {
        const bar = document.getElementById(`strength-bar-${i}`);
        if (bar) bar.style.background = score >= i ? '#d32f2f' : '#333';
    }
}

function setupPasswordStrength() {
    const input = document.getElementById('reg-password');
    if (input) input.addEventListener('input', () => checkPasswordStrength(input.value));
}

async function initializeSharedApp() {
    Database.init();
    currentUser = getSavedUser();
    setupPasswordStrength();
}

document.addEventListener('DOMContentLoaded', initializeSharedApp);
