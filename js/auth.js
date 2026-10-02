
async function getAuthCurrentUser() {
    if (!Database.initialized) Database.init();

    const { data: { session }, error: sessionError } = await Database.supabase.auth.getSession();
    if (sessionError || !session?.user) return null;

    const { data: profile, error: profileError } = await Database.supabase
        .from('profiles')
        .select('id, full_name, username, role, approved, rejection_reason, verification_document, verification_document_name, active, created_at')
        .eq('id', session.user.id)
        .single();

    if (profileError || !profile) {
        console.error('Profile load error:', profileError);
        return null;
    }

    return {
        id: profile.id,
        authId: session.user.id,
        fullName: profile.full_name || session.user.email,
        username: profile.username || '',
        email: session.user.email,
        role: profile.role || 'user',
        approved: profile.approved === true,
        rejectionReason: profile.rejection_reason || '',
        verificationDocument: profile.verification_document || '',
        verificationDocumentName: profile.verification_document_name || '',
        active: profile.active !== false,
        status: profile.active === false ? 'inactive' : 'active'
    };
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
}

async function collectAndSubmitVerification(user) {
    const result = await Swal.fire({
        icon: user.rejectionReason ? 'warning' : 'info',
        title: user.rejectionReason ? 'Resubmit Verification' : 'Verification Required',
        html: user.rejectionReason
            ? `<p>Your previous verification was not approved.</p><p><strong>Reason:</strong> ${escapeHtml(user.rejectionReason)}</p><p>Please upload a new ID, faculty card, or student ID.</p>`
            : '<p>Your email is confirmed. Upload your ID, faculty card, or student ID to continue the approval process.</p>',
        input: 'file',
        inputAttributes: {
            accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png',
            'aria-label': 'Upload verification document'
        },
        confirmButtonText: 'Submit Verification',
        confirmButtonColor: '#d32f2f',
        showCancelButton: true,
        cancelButtonText: 'Sign Out',
        allowOutsideClick: false,
        allowEscapeKey: false,
        preConfirm: (file) => {
            if (!file) {
                Swal.showValidationMessage('Please choose a verification document.');
                return false;
            }
            const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
            if (!allowed.includes(file.type)) {
                Swal.showValidationMessage('Only PDF, JPG, and PNG files are allowed.');
                return false;
            }
            if (file.size > 5 * 1024 * 1024) {
                Swal.showValidationMessage('File size must be less than 5MB.');
                return false;
            }
            return file;
        }
    });

    if (!result.isConfirmed || !result.value) return false;

    const file = result.value;
    await Database.createPendingRegistration({
        file,
        documentName: file.name
    });

    // Keep the existing ZolTrack email design: notify both requester and admin
    // after the authenticated verification submission succeeds.
    if (typeof emailConfirmation !== 'undefined') {
        try {
            await emailConfirmation.sendEmail(
                user.email,
                user.fullName,
                'Your verification document has been submitted successfully.',
                'PENDING REVIEW',
                'Your registration is under review. You will receive an email once approved.'
            );
            await emailConfirmation.sendEmail(
                emailConfirmation.superAdminEmail,
                'Admin',
                `New verification submission from ${user.fullName} (${user.email}).`,
                'ACTION REQUIRED',
                'Login to the Super Admin approval queue to review the submitted document.'
            );
        } catch (emailError) {
            console.warn('Verification saved, but notification email failed:', emailError);
        }
    }

    await Swal.fire({
        icon: 'success',
        title: 'Verification Submitted',
        text: 'Your document was received. Please wait for Super Admin approval.',
        confirmButtonColor: '#d32f2f',
        allowOutsideClick: false
    });
    return true;
}

function initializeAuthPages() {
    const roleOptions = document.querySelectorAll('.role-option');
    const registrationForm = document.getElementById('registration-form');
    const loginForm = document.getElementById('login-form');
    const goToLogin = document.getElementById('go-to-login');
    const goToRegister = document.getElementById('go-to-register');
    const logoutBtn = document.getElementById('logout-btn');
    const documentUpload = document.getElementById('verification-doc');
    const filePreview = document.getElementById('file-preview');
    const previewImage = document.getElementById('preview-image');
    const fileInfo = document.getElementById('file-info');

    // Email enabled
    if (typeof emailConfirmation !== 'undefined') {
        emailConfirmation.init();
        console.log('Email system initialized');
    }
    
    if (documentUpload) {
        documentUpload.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const fileType = file.type;
                const fileName = file.name;
                const fileSize = (file.size / 1024 / 1024).toFixed(2);
                
                fileInfo.textContent = `${fileName} (${fileSize} MB)`;
                
                if (fileType.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        previewImage.src = e.target.result;
                        filePreview.style.display = 'block';
                    };
                    reader.readAsDataURL(file);
                } else if (fileType === 'application/pdf') {
                    previewImage.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE0IDJIMTBDOS40NTAwMSAyIDkgMi40NDk5OSA5IDNWNUg3QzUuODk1NDMgNSA1IDUuODk1NDMgNSA3VjE3QzUgMTguMTA0NiA1Ljg5NTQzIDE5IDcgMTlIMTdDMTguMTA0NiAxOSAxOSAxOC4xMDQ2IDE5IDE3VjE2VjEwTDE0IDJaIiBmaWxsPSIjMzQ5OGRiIi8+CjxwYXRoIGQ9Ik0xNCAxMFYyTDE5IDEwSDE0WiIgZmlsbD0iI2UzZWNmMSIvPgo8L3N2Zz4K';
                    filePreview.style.display = 'block';
                } else {
                    filePreview.style.display = 'none';
                    Swal.fire({
                        icon: 'error',
                        title: 'Invalid File Type',
                        text: 'Please upload PDF, JPG, or PNG files only.',
                        confirmButtonColor: '#d32f2f'
                    });
                    documentUpload.value = '';
                }
            } else {
                filePreview.style.display = 'none';
            }
        });
    }
   
    if (roleOptions.length > 0) {
        roleOptions.forEach(option => {
            option.addEventListener('click', function() {
                roleOptions.forEach(opt => opt.classList.remove('selected'));
                this.classList.add('selected');
                const radioInput = this.querySelector('input[type="radio"]');
                if (radioInput) {
                    radioInput.checked = true;
                }
            });
        });
    }
    
    // ============ GO TO LOGIN ============
    if (goToLogin) {
        goToLogin.addEventListener('click', function(e) {
            e.preventDefault();
            window.location.href = 'login.html';
        });
    }
    
    // ============ GO TO REGISTER ============
    if (goToRegister) {
        goToRegister.addEventListener('click', function(e) {
            e.preventDefault();
            window.location.href = 'register.html';
        });
    }
    
    // ============ REGISTRATION WITH FULL PASSWORD VALIDATION ============
    if (registrationForm) {
        registrationForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const fullName = document.getElementById('reg-fullname').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const username = document.getElementById('reg-username').value.trim();
            const password = document.getElementById('reg-password').value;
            const documentFile = document.getElementById('verification-doc')?.files?.[0] || null;
            
            // VALIDATION 1: Full Name
            if (!fullName) {
                Swal.fire({
                    icon: 'error',
                    title: 'Missing Field',
                    text: 'Please enter your full name.',
                    confirmButtonColor: '#d32f2f'
                });
                return;
            }
            
            // VALIDATION 2: Email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!email) {
                Swal.fire({
                    icon: 'error',
                    title: 'Missing Field',
                    text: 'Please enter your email address.',
                    confirmButtonColor: '#d32f2f'
                });
                return;
            }
            if (!emailRegex.test(email)) {
                Swal.fire({
                    icon: 'error',
                    title: 'Invalid Email',
                    text: 'Please enter a valid email address (e.g., name@example.com).',
                    confirmButtonColor: '#d32f2f'
                });
                return;
            }
            
            // VALIDATION 3: Username
            if (!username) {
                Swal.fire({
                    icon: 'error',
                    title: 'Missing Field',
                    text: 'Please choose a username.',
                    confirmButtonColor: '#d32f2f'
                });
                return;
            }
            if (username.length < 3) {
                Swal.fire({
                    icon: 'error',
                    title: 'Username Too Short',
                    text: 'Username must be at least 3 characters long.',
                    confirmButtonColor: '#d32f2f'
                });
                return;
            }
            
            // ============ VALIDATION 4: PASSWORD WITH MIXED SYMBOLS ============
            if (!password) {
                Swal.fire({
                    icon: 'error',
                    title: 'Missing Field',
                    text: 'Please enter a password.',
                    confirmButtonColor: '#d32f2f'
                });
                return;
            }
            
            // Check password requirements
            const hasMinLength = password.length >= 6;
            const hasNumber = /[0-9]/.test(password);
            const hasUpper = /[A-Z]/.test(password);
            const hasLower = /[a-z]/.test(password);
            const hasSymbol = /[@$!%*?&]/.test(password);
            
            if (!hasMinLength) {
                Swal.fire({
                    icon: 'error',
                    title: 'Password Too Short',
                    text: 'Password must be at least 6 characters long.',
                    confirmButtonColor: '#d32f2f'
                });
                return;
            }
            
            if (!hasNumber || !hasUpper || !hasLower || !hasSymbol) {
                let missing = [];
                if (!hasNumber) missing.push('• At least 1 number (0-9)');
                if (!hasUpper) missing.push('• At least 1 uppercase letter (A-Z)');
                if (!hasLower) missing.push('• At least 1 lowercase letter (a-z)');
                if (!hasSymbol) missing.push('• At least 1 symbol (@$!%*?&)');
                
                Swal.fire({
                    icon: 'error',
                    title: 'Password Too Weak',
                    html: 'Password must contain:<br><br>' + missing.join('<br>'),
                    confirmButtonColor: '#d32f2f'
                });
                return;
            }
            // ================================================================
            
            // Public registration is always a standard User account.
            // Admin/Super Admin access is assigned only through authorized administration.
            const role = 'user';
            
            // Verification is submitted after email confirmation and first sign-in.
            // This keeps the verification RPC authenticated (auth.uid() is available).

            const submitBtn = registrationForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Checking...';
            submitBtn.disabled = true;
            
            try {
                if (!Database.initialized) Database.init();

                submitBtn.textContent = 'Creating account...';

                const { data: signUpData, error: signUpError } = await Database.supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: window.location.origin,
                        data: { full_name: fullName, username }
                    }
                });
                if (signUpError) throw signUpError;

                // Do not submit the verification document here. With email confirmation
                // enabled, signUp may create the account without an authenticated session.
                // The document is collected securely on the user's first confirmed sign-in.

                await Swal.fire({
                    icon: 'success',
                    title: 'Check Your Email',
                    text: "We\'ve sent a verification code to your email. Enter it on the next screen to activate your account.",
                    confirmButtonText: 'Continue to Sign In',
                    confirmButtonColor: '#d32f2f',
                    allowOutsideClick: false,
                    allowEscapeKey: false
                });

                registrationForm.reset();
                if (filePreview) filePreview.style.display = 'none';
                sessionStorage.setItem('zoltrack_verification_email', email);
                window.location.href = 'verify-email.html';
            } catch (error) {
                console.error('Registration error:', error);
                const safeMessage = error?.message || 'Something went wrong. Please try again.';
                const safeCode = error?.code ? ` (${error.code})` : '';
                Swal.fire({
                    icon: 'error',
                    title: 'Registration Error',
                    text: `${safeMessage}${safeCode}`,
                    confirmButtonColor: '#d32f2f'
                });
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    }
 
    // ============ LOGIN WITH SWEETALERT ============
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const email = document.getElementById('login-username').value.trim();
            const password = document.getElementById('login-password').value;

            if (!email || !password) {
                Swal.fire({
                    icon: 'error',
                    title: 'Missing Field',
                    text: 'Please enter your email and password.',
                    confirmButtonColor: '#d32f2f'
                });
                return;
            }

            const submitBtn = loginForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Signing in...';
            submitBtn.disabled = true;

            try {
                if (!Database.initialized) Database.init();
                const { error } = await Database.supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;

                const user = await getAuthCurrentUser();
                if (!user) throw new Error('Profile not found.');

                currentUser = user;
                if (user.active === false) {
                    await Database.supabase.auth.signOut();
                    throw new Error('This account has been deactivated. Please contact the Super Admin.');
                }
                if (!user.approved) {
                    localStorage.removeItem('currentUser');
                    const needsVerification = !user.verificationDocument || Boolean(user.rejectionReason);
                    window.location.replace(needsVerification ? 'verification.html' : 'pending-approval.html');
                    return;
                }
                // Compatibility cache only; authorization comes from Auth + profiles.
                saveCurrentUser(user);

                await Swal.fire({
                    icon: 'success',
                    title: 'Welcome Back!',
                    text: `Hello, ${user.fullName}!`,
                    timer: 1200,
                    showConfirmButton: false
                });
                window.location.replace('dashboard.html');
            } catch (error) {
                console.error('Auth login error:', error);
                if (error?.code === 'email_not_confirmed' || /email.*not.*confirm/i.test(error?.message || '')) {
                    sessionStorage.setItem('zoltrack_verification_email', email);
                    await Swal.fire({
                        icon: 'info',
                        title: 'Email Not Verified',
                        text: 'Enter the verification code sent to your email to activate your account.',
                        confirmButtonText: 'Enter Code',
                        confirmButtonColor: '#d32f2f',
                        allowOutsideClick: false
                    });
                    window.location.replace('verify-email.html');
                    return;
                }
                Swal.fire({
                    icon: 'error',
                    title: 'Login Failed',
                    text: error.message || 'Invalid email or password.',
                    confirmButtonColor: '#d32f2f'
                });
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            if (!Database.initialized) Database.init();
            await Database.supabase.auth.signOut();
            
            Swal.fire({
                icon: 'success',
                title: 'Logged Out!',
                text: 'You have been logged out successfully.',
                timer: 1500,
                showConfirmButton: false
            });
            
            setTimeout(() => {
                currentUser = null;
                localStorage.removeItem('currentUser');
                window.location.replace('index.html');
            }, 900);
        });
    }
}

function showDashboard() {
    if (!currentUser) return;

    // Multi-page build: the shared stylesheet hides .dashboard by default
    // because the original app was a single-page layout. Explicitly reveal
    // the dashboard when this physical page is active.
    const dashboardRoot = document.getElementById('dashboard');
    if (dashboardRoot) dashboardRoot.style.display = 'block';
    
    const userWelcome = document.getElementById('user-welcome');
    const dashboardTitle = document.getElementById('dashboard-title');
    const allRequestsTab = document.getElementById('all-requests-tab');
    const userManagementTab = document.getElementById('user-management-tab');
    const approvalQueueTab = document.getElementById('approval-queue-tab');
    const inventoryTab = document.getElementById('inventory-tab');
    const reportsTab = document.getElementById('reports-tab');
    const auditLogTab = document.getElementById('audit-log-tab');
    const borrowTab = document.getElementById('borrow-tab');
    
    const newRequestTab = document.querySelector('.tab[data-tab="new-request"]');
    const myRequestsTab = document.querySelector('.tab[data-tab="my-requests"]');
    
    if (userWelcome) {
        userWelcome.textContent = `Welcome, ${currentUser.fullName} (${formatRole(currentUser.role)})`;
    }
    
    if (dashboardTitle) {
        dashboardTitle.textContent = `${formatRole(currentUser.role)} Dashboard`;
    }
    
    if (currentUser.role === 'user') {
        if (allRequestsTab) allRequestsTab.style.display = 'none';
        if (userManagementTab) userManagementTab.style.display = 'none';
        if (approvalQueueTab) approvalQueueTab.style.display = 'none';
        if (inventoryTab) inventoryTab.style.display = 'none';
        if (reportsTab) reportsTab.style.display = 'none';
        if (auditLogTab) auditLogTab.style.display = 'none';
        if (borrowTab) borrowTab.style.display = 'block';
        if (newRequestTab) newRequestTab.style.display = 'block';
        if (myRequestsTab) myRequestsTab.style.display = 'block';
        
        if (newRequestTab && !newRequestTab.classList.contains('active')) {
            newRequestTab.click();
        }
        
    } else if (currentUser.role === 'admin') {
        if (allRequestsTab) allRequestsTab.style.display = 'block';
        if (userManagementTab) userManagementTab.style.display = 'none';
        if (approvalQueueTab) approvalQueueTab.style.display = 'none';
        if (inventoryTab) inventoryTab.style.display = 'block';
        if (borrowTab) borrowTab.style.display = 'block';
        if (reportsTab) reportsTab.style.display = 'block';
        if (auditLogTab) auditLogTab.style.display = 'none';
        
        if (newRequestTab) newRequestTab.style.display = 'none';
        if (myRequestsTab) myRequestsTab.style.display = 'none';
        
        if (allRequestsTab && !allRequestsTab.classList.contains('active')) {
            const allRequestsTabElement = document.querySelector('.tab[data-tab="all-requests"]');
            if (allRequestsTabElement) allRequestsTabElement.click();
        }
        
    } else if (currentUser.role === 'superadmin') {
        if (allRequestsTab) allRequestsTab.style.display = 'block';
        if (userManagementTab) userManagementTab.style.display = 'block';
        if (approvalQueueTab) approvalQueueTab.style.display = 'block';
        if (inventoryTab) inventoryTab.style.display = 'block';
        if (borrowTab) borrowTab.style.display = 'block';
        if (reportsTab) reportsTab.style.display = 'block';
        if (auditLogTab) auditLogTab.style.display = 'block';
        
        if (newRequestTab) newRequestTab.style.display = 'none';
        if (myRequestsTab) myRequestsTab.style.display = 'none';
        
        const allRequestsTabElement = document.querySelector('.tab[data-tab="all-requests"]');
        if (allRequestsTabElement && !allRequestsTabElement.classList.contains('active')) {
            allRequestsTabElement.click();
        }
        
        if (typeof renderApprovalQueue !== 'undefined') {
            renderApprovalQueue();
        }
    }
    
    if (typeof updateDashboardStats !== 'undefined') updateDashboardStats();
    if (typeof renderMyRequests !== 'undefined') renderMyRequests();
    if (typeof renderAllRequests !== 'undefined') renderAllRequests();
    if (typeof renderUsersTable !== 'undefined') renderUsersTable();
}

document.addEventListener('DOMContentLoaded', async function() {
    initializeAuthPages();
    if (!Database.initialized) Database.init();

    currentUser = await getAuthCurrentUser();
    const page = window.location.pathname.split('/').pop() || 'index.html';

    if (page === 'dashboard.html') {
        if (!currentUser) {
            localStorage.removeItem('currentUser');
            window.location.replace('login.html');
            return;
        }
        if (currentUser.active === false) {
            localStorage.removeItem('currentUser');
            await Database.supabase.auth.signOut();
            window.location.replace('login.html');
            return;
        }
        if (!currentUser.approved) {
            localStorage.removeItem('currentUser');
            const needsVerification = !currentUser.verificationDocument || Boolean(currentUser.rejectionReason);
            window.location.replace(needsVerification ? 'verification.html' : 'pending-approval.html');
            return;
        }
        saveCurrentUser(currentUser);
        showDashboard();
        await loadData();
        showDashboard();
        return;
    }

    if ((page === 'login.html' || page === 'register.html') && currentUser) {
        if (currentUser.approved) {
            window.location.replace('dashboard.html');
        } else {
            const needsVerification = !currentUser.verificationDocument || Boolean(currentUser.rejectionReason);
            window.location.replace(needsVerification ? 'verification.html' : 'pending-approval.html');
        }
    }
});

// Toggle password visibility for login
const togglePassword = document.getElementById('togglePassword');
const loginPassword = document.getElementById('login-password');

if (togglePassword && loginPassword) {
    togglePassword.addEventListener('click', function() {
        const type = loginPassword.getAttribute('type') === 'password' ? 'text' : 'password';
        loginPassword.setAttribute('type', type);
        this.classList.toggle('fa-eye');
        this.classList.toggle('fa-eye-slash');
    });
}

// Toggle password visibility for registration
const toggleRegPassword = document.getElementById('toggleRegPassword');
const regPassword = document.getElementById('reg-password');

if (toggleRegPassword && regPassword) {
    toggleRegPassword.addEventListener('click', function() {
        const type = regPassword.getAttribute('type') === 'password' ? 'text' : 'password';
        regPassword.setAttribute('type', type);
        this.classList.toggle('fa-eye');
        this.classList.toggle('fa-eye-slash');
    });
}