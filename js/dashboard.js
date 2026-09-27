async function refreshData() {
    try {
        requests = await Database.getRequests();
        
        console.log('✅ Data refreshed from database');
        
        // Re-render charts if reports tab is currently active
        const reportsTab = document.getElementById('reports');
        if (reportsTab && reportsTab.classList.contains('active')) {
            await renderReports();
        }
        
    } catch (error) {
        console.error('Error refreshing data:', error);
    }
}

// Global filter variables for All Requests
let currentRequestFilters = {
    search: '',
    status: 'all',
    priority: 'all'
};

// Global filter variables for Borrow History
let currentBorrowFilter = '';
let currentBorrowStatus = 'all';

// Global filter variable for Inventory
let currentInventoryCategory = 'all';

// Chart variables
let statusChart = null;
let priorityChart = null;
let trendsChart = null;

function initializeDashboard() {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const maintenanceForm = document.getElementById('maintenance-form');
    const closeModal = document.querySelectorAll('.close-modal');
    const requestModal = document.getElementById('request-modal');
    const documentModal = document.getElementById('document-modal');
    const attachmentInput = document.getElementById('attachment');
    const issuePhotoPreview = document.getElementById('issue-photo-preview');
    const issuePreviewImage = document.getElementById('issue-preview-image');
    const addInventoryBtn = document.getElementById('add-inventory-btn');
    
    // Setup request filters
    setupRequestFilters();

    // Remove existing event listeners to prevent duplicates
    const newTabs = document.querySelectorAll('.tab');
    newTabs.forEach(tab => {
        const newTab = tab.cloneNode(true);
        tab.parentNode.replaceChild(newTab, tab);
    });

    // Re-select after cloning
    const freshTabs = document.querySelectorAll('.tab');
    freshTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');
            
            freshTabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const targetContent = document.getElementById(tabId);
            if (targetContent) targetContent.classList.add('active');
            
            if (tabId === 'approval-queue' && currentUser && currentUser.role === 'superadmin') {
                renderApprovalQueue();
            }
            if (tabId === 'user-management' && currentUser && currentUser.role === 'superadmin') {
                renderUsersTable();
            }
            if (tabId === 'all-requests') {
                renderAllRequests();
            }
            if (tabId === 'my-requests') {
                renderMyRequests();
            }
            if (tabId === 'inventory' && currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin')) {
                renderInventory();
            }
            if (tabId === 'reports' && currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin')) {
                renderReports();
            }
            if (tabId === 'borrow' && currentUser) {
                renderBorrowPage();
            }
            if (tabId === 'audit-log' && currentUser && currentUser.role === 'superadmin') {
                renderAuditLog();
            }
        });
    });
  
    if (attachmentInput) {
        attachmentInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    issuePreviewImage.src = e.target.result;
                    issuePhotoPreview.style.display = 'block';
                };
                reader.readAsDataURL(file);
            } else {
                issuePhotoPreview.style.display = 'none';
            }
        });
    }
  
    if (maintenanceForm) {
        maintenanceForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            console.log('📝 Form submitted');
            
            const classroomSelect = document.getElementById('classroom');
            const issueTypeSelect = document.getElementById('issue-type');
            const prioritySelect = document.getElementById('priority');
            const description = document.getElementById('description').value;
            const attachment = document.getElementById('attachment').files[0];
            
            if (!classroomSelect.value || !issueTypeSelect.value || !description) {
                showToast('Please fill in all required fields', 'error');
                return;
            }
            
            const classroom = classroomSelect.options[classroomSelect.selectedIndex]?.text || classroomSelect.value;
            const issueType = issueTypeSelect.options[issueTypeSelect.selectedIndex]?.text || issueTypeSelect.value;
            const priority = prioritySelect.value;
            
            console.log('Request data:', { classroom, issueType, priority, description });
            
            const submitBtn = maintenanceForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';
            
            async function saveRequest(attachmentBase64) {
                // v8.0.1: request ID is generated atomically by PostgreSQL.
                const newRequest = {
                    id: null,
                    classroom: classroom,
                    issueType: issueType,
                    description: description,
                    priority: priority,
                    submittedBy: currentUser.fullName,
                    dateSubmitted: new Date().toISOString().split('T')[0],
                    status: "pending",
                    assignedTo: "",
                    dateCompleted: "",
                    notes: "",
                    attachment: attachmentBase64,
                    attachmentName: attachment ? attachment.name : null
                };
                
                console.log('💾 Saving request:', newRequest);
                
                showToast('Submitting request...', 'info');
                
                try {
                    const createdRequest = await Database.createRequest(newRequest, currentUser.id);
                    newRequest.id = createdRequest.id;
                    console.log('✅ Request saved to database:', createdRequest.id);
                    
                    const freshRequests = await Database.getRequests();
                    requests.length = 0;
                    requests.push(...freshRequests);
                    
                    console.log('📊 Data refreshed, requests count:', requests.length);
                
                    updateDashboardStats();
                    await renderMyRequests();
                    await renderAllRequests();
                    
                    showToast('Request submitted successfully!', 'success');
                    
                    maintenanceForm.reset();
                    const issuePhotoPreview = document.getElementById('issue-photo-preview');
                    if (issuePhotoPreview) issuePhotoPreview.style.display = 'none';
                    
                    const myRequestsTab = document.querySelector('.tab[data-tab="my-requests"]');
                    if (myRequestsTab) {
                        myRequestsTab.click();
                    }
                } catch (error) {
                    console.error('Error saving request:', error);
                    showToast('Error submitting request. Please try again.', 'error');
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                }
            }
            
            if (attachment) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    saveRequest(e.target.result);
                };
                reader.onerror = function() {
                    saveRequest(null);
                };
                reader.readAsDataURL(attachment);
            } else {
                saveRequest(null);
            }
        });
    }
    
    if (addInventoryBtn) {
        addInventoryBtn.addEventListener('click', showAddInventoryModal);
        
    }
    
    // Setup inventory category filter
    const inventoryCategoryFilter = document.getElementById('inventory-category-filter');
    if (inventoryCategoryFilter) {
        inventoryCategoryFilter.addEventListener('change', (e) => {
            currentInventoryCategory = e.target.value;
            renderInventory();
        });
    }
    
    closeModal.forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) modal.style.display = 'none';
        });
    });
    
    window.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    });
}

// ============ TOAST NOTIFICATION ============
function showToast(message, type = 'info') {
    // v5.2: Important feedback is a visible SweetAlert modal again.
    // Informational progress notices stay lightweight so they do not block the workflow.
    if (type === 'info') {
        return Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'info',
            title: message,
            showConfirmButton: false,
            timer: 1800,
            timerProgressBar: true
        });
    }

    const isSuccess = type === 'success';
    return Swal.fire({
        icon: type,
        title: isSuccess ? 'Success' : 'Action Required',
        text: message,
        confirmButtonText: 'OK',
        confirmButtonColor: '#dc2626',
        showConfirmButton: !isSuccess,
        timer: isSuccess ? 1700 : undefined,
        timerProgressBar: isSuccess
    });
}

// ============ REQUEST FILTERS FUNCTION ============
function setupRequestFilters() {
    const searchInput = document.getElementById('search-request-input');
    const statusFilter = document.getElementById('status-filter');
    const priorityFilter = document.getElementById('priority-filter');
    const clearBtn = document.getElementById('clear-filters-btn');
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentRequestFilters.search = e.target.value;
            renderAllRequests();
        });
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            currentRequestFilters.status = e.target.value;
            renderAllRequests();
        });
    }
    
    if (priorityFilter) {
        priorityFilter.addEventListener('change', (e) => {
            currentRequestFilters.priority = e.target.value;
            renderAllRequests();
        });
    }
    
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (statusFilter) statusFilter.value = 'all';
            if (priorityFilter) priorityFilter.value = 'all';
            currentRequestFilters = { search: '', status: 'all', priority: 'all' };
            renderAllRequests();
        });
    }
}

async function renderApprovalQueue() {
    if (!currentUser || currentUser.role !== 'superadmin') return;
    
    const approvalTable = document.getElementById('approval-table');
    if (!approvalTable) return;
    
    const tbody = approvalTable.querySelector('tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    try {
        const pendingRegistrations = await Database.getPendingRegistrations();
        
        if (!pendingRegistrations || pendingRegistrations.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No pending registrations</td></tr>';
            return;
        }
        
        pendingRegistrations.forEach(registration => {
            const row = tbody.insertRow();
            row.innerHTML = `
                  <td>${escapeHtml(registration.fullName)}</td>
                  <td>${escapeHtml(registration.email)}</td>
                  <td>${formatRole(registration.role)}</td>
                  <td>
                    ${registration.documentFile ? 
                        `<button class="btn view-document" data-id="${registration.id}"><i class="fa-regular fa-file-lines"></i> View Document</button>` : 
                        '<span>No document</span>'
                    }
                  </td>
                  <td>${new Date(registration.submittedAt).toLocaleDateString()}</td>
                  <td>
                    <button class="btn btn-success approve-registration" data-id="${registration.id}">Approve</button>
                    <button class="btn btn-danger reject-registration" data-id="${registration.id}">Reject</button>
                  </td>
            `;
        });
        
        document.querySelectorAll('.approve-registration').forEach(btn => {
            btn.removeEventListener('click', handleApprove);
            btn.addEventListener('click', handleApprove);
        });
        
        document.querySelectorAll('.reject-registration').forEach(btn => {
            btn.removeEventListener('click', handleReject);
            btn.addEventListener('click', handleReject);
        });
        
        document.querySelectorAll('.view-document').forEach(btn => {
            btn.removeEventListener('click', handleViewDoc);
            btn.addEventListener('click', handleViewDoc);
        });
        
    } catch (error) {
        console.error('Error loading pending registrations:', error);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Error loading registrations</td></tr>';
    }
}

// ============ APPROVE FUNCTION WITH EMAIL ============
async function handleApprove(e) {
    const button = e.currentTarget;
    const registrationId = button.getAttribute('data-id');
    
    button.disabled = true;
    button.textContent = 'Processing...';
    
    try {
        const pendingRegs = await Database.getPendingRegistrations();
        const registration = pendingRegs.find(reg => reg.id == registrationId);
        
        if (registration) {
            console.log('📧 Sending APPROVAL email to:', registration.email);
            
            if (typeof emailConfirmation !== 'undefined') {
                await emailConfirmation.sendEmail(
                    registration.email,
                    registration.fullName,
                    'Great news! Your account has been approved! 🎉',
                    'APPROVED',
                    'You can now login to the ZolTrack system to submit maintenance requests.\n\nLogin here: ' + window.location.origin
                );
            }
            await Database.approveAuthProfile(registration.id);
            
            showToast(`${registration.fullName} has been approved.`, 'success');
            
            await renderApprovalQueue();
            await renderUsersTable();
            await refreshData();
        }
    } catch (error) {
        console.error('Approval error:', error);
        showToast('Error approving registration', 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Approve';
    }
}

// ============ REJECT FUNCTION WITH EMAIL ============
async function handleReject(e) {
    const button = e.currentTarget;
    const registrationId = button.getAttribute('data-id');
    
    const { value: reason } = await Swal.fire({
        title: 'Enter rejection reason',
        input: 'text',
        inputLabel: 'Reason for rejection',
        inputPlaceholder: 'Type your reason here...',
        showCancelButton: true,
        confirmButtonColor: '#d32f2f',
        confirmButtonText: 'Reject',
        cancelButtonText: 'Cancel'
    });
    
    if (!reason) return;
    
    button.disabled = true;
    button.textContent = 'Processing...';
    
    try {
        const pendingRegs = await Database.getPendingRegistrations();
        const registration = pendingRegs.find(reg => reg.id == registrationId);
        
        if (registration) {
            console.log('📧 Sending REJECTION email to:', registration.email);
            
            if (typeof emailConfirmation !== 'undefined') {
                await emailConfirmation.sendEmail(
                    registration.email,
                    registration.fullName,
                    'Regarding your registration request...',
                    'REJECTED',
                    `Your registration was not approved.\n\nReason: ${reason}`
                );
            }
        }
        await Database.rejectAuthProfile(registrationId, reason);
        
        showToast(`Registration rejected and removed.`, 'success');
        await renderApprovalQueue();
        await refreshData();
        
    } catch (error) {
        console.error('Rejection error:', error);
        showToast('Error rejecting registration', 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Reject';
    }
}

async function handleViewDoc(e) {
    const registrationId = e.currentTarget.getAttribute('data-id');

    try {
        const pendingRegs = await Database.getPendingRegistrations();
        const registration = pendingRegs.find(reg => reg.id == registrationId);

        if (registration && registration.documentFile) {
            const documentUrl = await Database.getVerificationDocumentUrl(registration.documentFile);
            if (!documentUrl) throw new Error('Verification document could not be opened.');
            const modalBody = document.getElementById('document-modal-body');
            const modal = document.getElementById('document-modal');
            const isPdf = registration.documentName?.toLowerCase().endsWith('.pdf');
            const submitted = registration.submittedAt
                ? new Date(registration.submittedAt).toLocaleString()
                : 'Submission date unavailable';

            modalBody.innerHTML = `
                <div class="verification-viewer">
                    <div class="verification-viewer__header">
                        <div>
                            <span class="verification-viewer__eyebrow">ACCESS VERIFICATION</span>
                            <h3>Verification Document</h3>
                            <div class="verification-viewer__identity">
                                <strong>${escapeHtml(registration.fullName)}</strong>
                                <span>${escapeHtml(registration.email)}</span>
                            </div>
                        </div>
                        <div class="verification-viewer__header-actions">
                            <a class="verification-icon-btn" href="${documentUrl}" target="_blank" rel="noopener noreferrer" title="Open full size" aria-label="Open full size">
                                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                            </a>
                            <button class="verification-icon-btn" type="button" onclick="closeVerificationViewer()" title="Close" aria-label="Close">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </div>

                    <div class="verification-viewer__preview">
                        ${isPdf
                            ? `<iframe src="${documentUrl}" title="Verification document preview"></iframe>`
                            : `<img src="${documentUrl}" alt="Verification document submitted by ${escapeHtml(registration.fullName)}">`
                        }
                    </div>

                    <div class="verification-viewer__footer">
                        <div class="verification-viewer__submitted">
                            <i class="fa-regular fa-clock"></i>
                            <span>Submitted ${submitted}</span>
                        </div>
                        <div class="verification-viewer__decisions">
                            <button class="btn verification-reject" type="button" onclick="closeVerificationViewer(); triggerRegistrationAction('${registration.id}', 'reject')">
                                <i class="fa-solid fa-xmark"></i> Reject
                            </button>
                            <button class="btn verification-approve" type="button" onclick="closeVerificationViewer(); triggerRegistrationAction('${registration.id}', 'approve')">
                                <i class="fa-solid fa-check"></i> Approve
                            </button>
                        </div>
                    </div>
                </div>
            `;
            modal.style.display = 'flex';
        } else {
            showToast('No document available', 'error');
        }
    } catch (error) {
        console.error('Error viewing document:', error);
        showToast('Error loading document', 'error');
    }
}

function closeVerificationViewer() {
    const modal = document.getElementById('document-modal');
    if (modal) modal.style.display = 'none';
}

function triggerRegistrationAction(registrationId, action) {
    const selector = action === 'approve'
        ? `.approve-registration[data-id="${registrationId}"]`
        : `.reject-registration[data-id="${registrationId}"]`;
    const button = document.querySelector(selector);

    if (button) {
        button.click();
    } else {
        showToast('Registration action is unavailable. Refresh the approval queue and try again.', 'error');
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateDashboardStats() {
    const total = requests.length;
    const pending = requests.filter(req => req.status === 'pending').length;
    const inProgress = requests.filter(req => req.status === 'in-progress').length;
    const completed = requests.filter(req => req.status === 'completed').length;
    
    const totalEl = document.getElementById('total-requests');
    const pendingEl = document.getElementById('pending-requests');
    const inprogressEl = document.getElementById('inprogress-requests');
    const completedEl = document.getElementById('completed-requests');
    
    if (totalEl) totalEl.textContent = total;
    if (pendingEl) pendingEl.textContent = pending;
    if (inprogressEl) inprogressEl.textContent = inProgress;
    if (completedEl) completedEl.textContent = completed;
}

async function renderMyRequests() {
    const tbody = document.querySelector('#my-requests-table tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    try {
        const myRequests = await Database.getRequests(currentUser.id);
        
        if (!myRequests || myRequests.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No requests found</td></tr>';
            return;
        }
        
        myRequests.forEach(request => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${escapeHtml(request.id)}</td>
                <td>${escapeHtml(request.classroom)}</td>
                <td>${escapeHtml(request.issueType)}</td>
                <td>${escapeHtml(request.dateSubmitted)}</td>
                <td><span class="status status-${request.status}">${formatStatus(request.status)}</span></td>
                <td>
                    <button class="btn view-details" data-id="${request.id}">View Details</button>
                    ${request.attachment ? '<span class="badge">📎</span>' : ''}
                </td>
            `;
        });
        
        document.querySelectorAll('#my-requests-table .view-details').forEach(btn => {
            btn.removeEventListener('click', showRequestDetailsWrapper);
            btn.addEventListener('click', showRequestDetailsWrapper);
        });
    } catch (error) {
        console.error('Error loading my requests:', error);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Error loading requests</td></tr>';
    }
}

async function showRequestDetailsWrapper(e) {
    const requestId = e.currentTarget.getAttribute('data-id');
    await showRequestDetails(requestId);
}

// ============ ALL REQUESTS WITH FILTERS ============
async function renderAllRequests() {
    const tbody = document.querySelector('#all-requests-table tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Loading...</td></tr>';
    
    try {
        let filteredRequests = await Database.getRequests();
        
        if (currentRequestFilters.status !== 'all') {
            filteredRequests = filteredRequests.filter(req => req.status === currentRequestFilters.status);
        }
        
        if (currentRequestFilters.priority !== 'all') {
            filteredRequests = filteredRequests.filter(req => req.priority === currentRequestFilters.priority);
        }
        
        if (currentRequestFilters.search !== '') {
            const searchTerm = currentRequestFilters.search.toLowerCase();
            filteredRequests = filteredRequests.filter(req => 
                req.id.toLowerCase().includes(searchTerm) ||
                req.classroom.toLowerCase().includes(searchTerm) ||
                req.submittedBy.toLowerCase().includes(searchTerm) ||
                req.issueType.toLowerCase().includes(searchTerm)
            );
        }
        
        if (!filteredRequests || filteredRequests.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">No requests found</td></tr>';
            return;
        }
        
        tbody.innerHTML = '';
        
        filteredRequests.forEach(request => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${escapeHtml(request.id)}</td>
                <td>${escapeHtml(request.classroom)}</td>
                <td>${escapeHtml(request.issueType)}</td>
                <td>${escapeHtml(request.submittedBy)}</td>
                <td>${escapeHtml(request.dateSubmitted)}</td>
                <td><span class="priority priority-${request.priority}">${escapeHtml(request.priority).toUpperCase()}</span></td>
                <td><span class="status status-${request.status}">${formatStatus(request.status)}</span></td>
                <td>
                    <button class="btn view-details request-manage-btn" data-id="${request.id}"><i class="fa-solid fa-sliders"></i> View / Manage</button>
                </td>
            `;
        });
        
        document.querySelectorAll('#all-requests-table .view-details').forEach(btn => {
            btn.removeEventListener('click', showRequestDetailsWrapper);
            btn.addEventListener('click', showRequestDetailsWrapper);
        });
        
    } catch (error) {
        console.error('Error loading all requests:', error);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Error loading requests</td></tr>';
    }
}

async function renderUsersTable() {
    if (!currentUser || currentUser.role !== 'superadmin') return;
    const tbody = document.querySelector('#users-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Loading approved accounts...</td></tr>';
    try {
        const managedUsers = await Database.getManagedUsers();
        if (!managedUsers.length) { tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No approved accounts found.</td></tr>'; return; }
        tbody.innerHTML = '';
        managedUsers.forEach(user => {
            const row = tbody.insertRow();
            const isSelf = String(user.id) === String(currentUser.id);
            const protectedAccount = user.role === 'superadmin';
            const isActive = user.status === 'active';
            const roleControl = (isSelf || protectedAccount)
                ? `<span class="role-badge role-${escapeHtml(user.role)}"><i class="fa-solid fa-shield-halved"></i> ${formatRole(user.role)}</span>`
                : `<div class="managed-role-control">
                    <select class="managed-role-select form-control" data-id="${user.id}" data-current="${escapeHtml(user.role)}" aria-label="Role for ${escapeHtml(user.fullName || user.username || 'user')}">
                        <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                    <button type="button" class="btn managed-role-save" data-id="${user.id}" disabled>Save Role</button>
                </div>`;
            const statusControl = (isSelf || protectedAccount) ? '<span class="badge">Protected</span>' : `<button class="btn managed-status ${isActive ? 'btn-warning' : 'btn-success'}" data-id="${user.id}" data-active="${isActive}"><i class="fa-solid ${isActive ? 'fa-user-lock' : 'fa-user-check'}"></i> ${isActive ? 'Deactivate' : 'Activate'}</button>`;
            row.innerHTML = `<td>${escapeHtml(user.username || '—')}</td><td>${escapeHtml(user.fullName || '—')}</td><td>${escapeHtml(user.email || '—')}</td><td>${roleControl}</td><td><span class="status-badge">${isActive ? 'Active' : 'Inactive'}</span></td><td>${statusControl}</td>`;
        });
        document.querySelectorAll('.managed-role-save').forEach(el => el.addEventListener('click', changeManagedUserRole));
        document.querySelectorAll('.managed-role-select').forEach(select => {
            select.addEventListener('change', () => {
                const saveButton = select.closest('.managed-role-control')?.querySelector('.managed-role-save');
                if (saveButton) saveButton.disabled = select.value === select.dataset.current;
            });
        });
        document.querySelectorAll('.managed-status').forEach(el => el.addEventListener('click', toggleManagedUserStatus));
    } catch (error) {
        console.error('Error loading managed users:', error);
        tbody.innerHTML = `<tr><td colspan="6" class="table-empty">${escapeHtml(error.message || 'Error loading users')}</td></tr>`;
    }
}
async function changeManagedUserRole(e) {
    const button = e.currentTarget;
    const userId = button.dataset.id;
    const control = button.closest('.managed-role-control');
    const select = control?.querySelector('.managed-role-select');
    if (!select) return;
    const oldRole = select.dataset.current;
    const newRole = select.value;
    if (oldRole === newRole) { showToast('No role change to save.', 'info'); return; }
    const result = await Swal.fire({title:'Change account role?',text:`Change this approved account from ${formatRole(oldRole)} to ${formatRole(newRole)}?`,icon:'question',showCancelButton:true,confirmButtonColor:'#d32f2f',confirmButtonText:'Change Role'});
    if(!result.isConfirmed){select.value=oldRole;return;}
    select.disabled=true; button.disabled=true; button.textContent='Saving...';
    try{await Database.setManagedUserRole(userId,newRole);showToast('User role updated successfully.','success');await renderUsersTable();}catch(error){console.error('Role update failed:',error);select.value=oldRole;showToast(error.message||'Unable to update role.','error');}finally{select.disabled=false;button.textContent='Save Role';button.disabled=select.value===select.dataset.current;}
}
async function toggleManagedUserStatus(e) {
    const button=e.currentTarget,userId=button.dataset.id,currentlyActive=button.dataset.active==='true',nextActive=!currentlyActive;
    const result=await Swal.fire({title:`${nextActive?'Activate':'Deactivate'} account?`,text:nextActive?'This user will be able to sign in again.':'This user will be blocked from ZolTrack after their next authentication check.',icon:'warning',showCancelButton:true,confirmButtonColor:'#d32f2f',confirmButtonText:nextActive?'Activate':'Deactivate'});
    if(!result.isConfirmed)return;
    button.disabled=true;
    try{await Database.setManagedUserActive(userId,nextActive);showToast(`Account ${nextActive?'activated':'deactivated'}.`,'success');await renderUsersTable();}catch(error){console.error('Status update failed:',error);showToast(error.message||'Unable to update account status.','error');}finally{button.disabled=false;}
}

// ============ SHOW REQUEST DETAILS WITH INVENTORY DEDUCTION (FIXED - ADMIN/SUPERADMIN ONLY) ============
async function showRequestDetails(requestId) {
    try {
        let request = requests.find(req => req.id === requestId);
        
        if (!request) {
            const allRequests = await Database.getRequests();
            request = allRequests.find(req => req.id === requestId);
        }
        
        if (!request) {
            showToast('Request not found.', 'error');
            return;
        }
        
        const modalBody = document.getElementById('modal-body');
        
        let itemTypeFilter = '';
        const issueTypeLower = request.issueType.toLowerCase();
        
        if (issueTypeLower.includes('technology') || issueTypeLower.includes('computer') || issueTypeLower.includes('projector')) {
            itemTypeFilter = 'technology';
        } else if (issueTypeLower.includes('furniture') || issueTypeLower.includes('chair') || issueTypeLower.includes('table')) {
            itemTypeFilter = 'furniture';
        } else if (issueTypeLower.includes('electrical') || issueTypeLower.includes('light') || issueTypeLower.includes('aircon')) {
            itemTypeFilter = 'electrical';
        } else if (issueTypeLower.includes('plumbing') || issueTypeLower.includes('faucet') || issueTypeLower.includes('toilet')) {
            itemTypeFilter = 'plumbing';
        } else if (issueTypeLower.includes('tool') || issueTypeLower.includes('hammer') || issueTypeLower.includes('wrench')) {
            itemTypeFilter = 'tools';
        } else if (issueTypeLower.includes('supplies') || issueTypeLower.includes('marker') || issueTypeLower.includes('paper')) {
            itemTypeFilter = 'supplies';
        } else {
            itemTypeFilter = 'other';
        }
        
        let allInventory = await Database.getInventory();
        let filteredInventory = allInventory.filter(item => item.item_type === itemTypeFilter);
        
        if (filteredInventory.length === 0) {
            filteredInventory = allInventory;
        }
        
        const inventoryOptions = filteredInventory.map(item => 
            `<option value="${item.id}" data-name="${item.item_name}" data-qty="${item.quantity}" data-unit="${item.unit}">${item.item_name} (Stock: ${item.quantity} ${item.unit})</option>`
        ).join('');
        
        let attachmentHtml = '';
        if (request.attachment) {
            if (request.attachmentName && request.attachmentName.toLowerCase().endsWith('.pdf')) {
                attachmentHtml = `
                    <div class="form-group">
                        <label>Attached File</label>
                        <div>
                            <a href="${request.attachment}" download="${request.attachmentName}" class="btn btn-primary"><i class="fa-solid fa-download"></i> Download PDF</a>
                        </div>
                    </div>
                `;
            } else {
                attachmentHtml = `
                    <div class="form-group">
                        <label>Attached Photo</label>
                        <div>
                            <img src="${request.attachment}" style="max-width: 100%; max-height: 300px;">
                            <div><a href="${request.attachment}" download="${request.attachmentName || 'attachment.jpg'}" class="btn btn-primary"><i class="fa-solid fa-download"></i> Download Image</a></div>
                        </div>
                    </div>
                `;
            }
        }
        
        // Only show completion options for admin or superadmin
        const canComplete = (currentUser.role === 'admin' || currentUser.role === 'superadmin');
        const requestStageIndex = request.status === 'completed' ? 2 : request.status === 'in-progress' ? 1 : 0;
        const requestTimeline = `<div class="request-timeline">
            ${['Submitted','In Progress','Completed'].map((label, i) => `${i ? '<div class="timeline-line"></div>' : ''}<div class="timeline-step ${i <= requestStageIndex ? 'done' : ''}"><i class="${i === 0 ? 'fa-regular fa-paper-plane' : i === 1 ? 'fa-solid fa-screwdriver-wrench' : 'fa-regular fa-circle-check'}"></i><span>${label}</span></div>`).join('')}
        </div>`;
        
        modalBody.innerHTML = `
            ${requestTimeline}
            <div class="form-group"><label>Request ID</label><p><strong>${escapeHtml(request.id)}</strong></p></div>
            <div class="form-group"><label>Classroom</label><p>${escapeHtml(request.classroom)}</p></div>
            <div class="form-group"><label>Issue Type</label><p>${escapeHtml(request.issueType)}</p></div>
            <div class="form-group"><label>Description</label><p>${escapeHtml(request.description)}</p></div>
            <div class="form-group"><label>Submitted By</label><p>${escapeHtml(request.submittedBy)}</p></div>
            <div class="form-group"><label>Date Submitted</label><p>${escapeHtml(request.dateSubmitted)}</p></div>
            <div class="form-group"><label>Status</label><p><span class="status status-${request.status}">${formatStatus(request.status)}</span></p></div>
            
            ${request.status !== 'completed' && canComplete ? `
                <div class="management-panel">
                    <div class="management-panel-heading">
                        <div><span class="eyebrow">Administrator Controls</span><h4>Manage Request</h4></div>
                        ${request.status === 'pending' ? '<button id="start-progress-btn" class="btn btn-secondary"><i class="fa-solid fa-screwdriver-wrench"></i> Mark In Progress</button>' : '<span class="status status-in-progress">In Progress</span>'}
                    </div>
                    <p class="management-help">Advance the request to In Progress, then complete it below. Completion uses the protected atomic inventory workflow.</p>
                </div>
                <div class="form-group">
                    <label>Completion decision</label>
                    <select id="deduct-decision" class="form-control">
                        <option value="">-- Select Decision --</option>
                        <option value="yes">YES - Item is broken/damaged (Deduct from inventory)</option>
                        <option value="no">NO - Item can be repaired (No deduction)</option>
                    </select>
                </div>
                
                <div id="inventory-selector" style="display: none;">
                    <div class="form-group">
                        <label>Select Item to Deduct (${filteredInventory.length} items available)</label>
                        <select id="inventory-item" class="form-control">
                            <option value="">-- Select Item --</option>
                            ${inventoryOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Quantity to Deduct</label>
                        <input type="number" id="deduct-quantity" class="form-control" value="1" min="1">
                    </div>
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button id="complete-request-btn" class="btn btn-success">Complete Request</button>
                    <button id="cancel-modal-btn" class="btn">Cancel</button>
                </div>
            ` : (request.status !== 'completed' ? `<p class="permission-note"><i class="fa-solid fa-shield-halved"></i> Only administrators can complete requests.</p>` : `<p><em>Request already completed.</em></p>`)}
            
            ${attachmentHtml}
        `;
        
        if (request.status !== 'completed' && canComplete) {
            const startProgressBtn = document.getElementById('start-progress-btn');
            if (startProgressBtn) {
                startProgressBtn.onclick = async () => {
                    startProgressBtn.disabled = true;
                    try {
                        await Database.updateRequest(requestId, { status: 'in-progress', assigned_to: currentUser.id });
                        showToast(`Request ${requestId} is now In Progress.`, 'success');
                        document.getElementById('request-modal').style.display = 'none';
                        await refreshData(); updateDashboardStats(); await renderMyRequests(); await renderAllRequests();
                    } catch (error) {
                        console.error('Unable to start request:', error);
                        showToast(error.message || 'Unable to mark request In Progress.', 'error');
                    } finally { startProgressBtn.disabled = false; }
                };
            }
            const deductDecision = document.getElementById('deduct-decision');
            const inventorySelector = document.getElementById('inventory-selector');
            
            if (deductDecision) {
                deductDecision.addEventListener('change', function() {
                    if (this.value === 'yes') {
                        inventorySelector.style.display = 'block';
                    } else {
                        inventorySelector.style.display = 'none';
                    }
                });
            }
            
            const completeBtn = document.getElementById('complete-request-btn');
            if (completeBtn) {
                completeBtn.onclick = async () => {
                    const decision = deductDecision.value;
                    
                    if (!decision) {
                        showToast('Please select a decision.', 'error');
                        return;
                    }
                    
                    completeBtn.disabled = true;
                    try {
                        if (decision === 'yes') {
                            const inventorySelect = document.getElementById('inventory-item');
                            const selectedItemId = inventorySelect.value;
                            const deductQty = parseInt(document.getElementById('deduct-quantity').value, 10);

                            if (!selectedItemId) {
                                showToast('Please select an item to deduct.', 'error');
                                return;
                            }
                            if (isNaN(deductQty) || deductQty < 1) {
                                showToast('Please enter a valid quantity.', 'error');
                                return;
                            }

                            // v8.6: server locks both rows, rechecks live stock, deducts inventory,
                            // and completes the request in ONE database transaction.
                            const result = await Database.completeMaintenanceRequest(requestId, true, selectedItemId, deductQty);
                            showToast(`Request completed. Deducted ${result.quantity_deducted} ${result.unit} from ${result.item_name}. Remaining: ${result.remaining_quantity} ${result.unit}.`, 'success');
                        } else {
                            await Database.completeMaintenanceRequest(requestId, false);
                                }
                    } catch (error) {
                        console.error('Maintenance completion failed:', error);
                        showToast(error.message || 'Unable to complete request. No partial changes were saved.', 'error');
                        return;
                    } finally {
                        completeBtn.disabled = false;
                    }
                    
                    document.getElementById('request-modal').style.display = 'none';
                    await refreshData();
                    updateDashboardStats();
                    await renderMyRequests();
                    await renderAllRequests();
                    await renderInventory();
                    
                    showToast('Request completed successfully!', 'success');
                };
            }
            
            const cancelBtn = document.getElementById('cancel-modal-btn');
            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    document.getElementById('request-modal').style.display = 'none';
                };
            }
        }
        
        document.getElementById('request-modal').style.display = 'flex';
    } catch (error) {
        console.error('Error showing request details:', error);
        showToast('Error loading request details', 'error');
    }
}

// ============ INVENTORY FUNCTIONS ============
async function renderInventory() {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) return;
    
    const tbody = document.querySelector('#inventory-table tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Loading...<\/td><\/tr>';
    
    try {
        let inventory = await Database.getInventory();
        
        if (currentInventoryCategory !== 'all') {
            inventory = inventory.filter(item => item.category === currentInventoryCategory);
        }
        
        if (!inventory || inventory.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center;">No inventory items found. Click "Add New Item" to get started.<\/td><\/tr>`;
            return;
        }
        
        tbody.innerHTML = '';
        
        inventory.forEach(item => {
            const isLowStock = item.quantity <= item.min_stock;
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${escapeHtml(item.item_number || '-')}<\/td>
                <td>${escapeHtml(item.item_name)}<\/td>
                <td>${escapeHtml(item.category)}<\/td>
                <td>${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}<\/td>
                <td>${escapeHtml(item.min_stock)}<\/td>
                <td>${escapeHtml(item.location || '-')}<\/td>
                <td><span class="status ${isLowStock ? 'status-pending' : 'status-active'}">${isLowStock ? 'Low Stock' : 'In Stock'}</span><\/td>
                <td>
                    <button class="btn edit-inventory" data-id="${item.id}"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
                    <button class="btn btn-danger delete-inventory" data-id="${item.id}"><i class="fa-regular fa-trash-can"></i> Delete</button>
                 <\/td>
            `;
        });
        
        document.querySelectorAll('.edit-inventory').forEach(btn => {
            btn.addEventListener('click', () => editInventoryItem(btn.getAttribute('data-id')));
        });
        
        document.querySelectorAll('.delete-inventory').forEach(btn => {
            btn.addEventListener('click', () => deleteInventoryItem(btn.getAttribute('data-id')));
        });
        if (typeof refreshProductionOverview === 'function') setTimeout(refreshProductionOverview, 0);
        
    } catch (error) {
        console.error('Error loading inventory:', error);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Error loading inventory<\/td><\/tr>';
    }
}

async function editInventoryItem(itemId) {
    const inventory = await Database.getInventory();
    const item = inventory.find(i => i.id == itemId);
    
    if (!item) return;
    
    const { value: newQuantity } = await Swal.fire({
        title: `Edit ${item.item_name}`,
        text: `Current quantity: ${item.quantity} ${item.unit}`,
        input: 'number',
        inputLabel: 'Enter new quantity',
        inputValue: item.quantity,
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Update'
    });
    
    if (newQuantity !== null && !isNaN(newQuantity)) {
        await Database.updateInventoryItem(itemId, { 
            quantity: parseInt(newQuantity),
            last_updated: new Date().toISOString().split('T')[0]
        });
        showToast(`${item.item_name} quantity updated to ${newQuantity}`, 'success');
        await renderInventory();
    }
}

async function deleteInventoryItem(itemId) {
    const result = await Swal.fire({
        title: 'Are you sure?',
        text: "This item will be permanently deleted.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d32f2f',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, delete it!'
    });
    
    if (!result.isConfirmed) return;
    
    await Database.deleteInventoryItem(itemId);
    showToast('Item deleted successfully', 'success');
    await renderInventory();
}

function showAddInventoryModal() {
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
        <div class="form-group">
            <label>Item Number / Serial Number</label>
            <input type="text" id="inv-item-number" class="form-control" placeholder="e.g., PRJ-001, SCC-12345, ABC-001" required>
            <small class="form-text">Unique identifier for this item (e.g., Serial number, Asset tag, Property number)</small>
        </div>
        <div class="form-group">
            <label>Item Name</label>
            <input type="text" id="inv-name" class="form-control" required>
        </div>
        <div class="form-group">
            <label>Category</label>
            <select id="inv-category" class="form-control">
                <option value="Technology">Technology</option>
                <option value="Furniture">Furniture</option>
                <option value="Electrical">Electrical</option>
                <option value="Plumbing">Plumbing</option>
                <option value="Tools">Tools</option>
                <option value="Supplies">Supplies</option>
            </select>
        </div>
        <div class="form-group">
            <label>Item Type (for matching with issue type)</label>
            <select id="inv-item-type" class="form-control">
                <option value="technology">Technology (Projectors, Computers, etc.)</option>
                <option value="furniture">Furniture (Chairs, Tables, etc.)</option>
                <option value="electrical">Electrical (Lights, Aircon, etc.)</option>
                <option value="plumbing">Plumbing (Faucet, Toilet, etc.)</option>
                <option value="tools">Tools (Hammer, Wrench, Drill, etc.)</option>
                <option value="supplies">Supplies (Markers, Paper, Cleaning materials)</option>
            </select>
        </div>
        <div class="form-group">
            <label>Quantity</label>
            <input type="number" id="inv-quantity" class="form-control" value="1" required>
            <small class="form-text">Usually 1 for unique serialized items</small>
        </div>
        <div class="form-group">
            <label>Unit</label>
            <input type="text" id="inv-unit" class="form-control" value="pcs">
        </div>
        <div class="form-group">
            <label>Minimum Stock Alert</label>
            <input type="number" id="inv-min-stock" class="form-control" value="1">
        </div>
        <div class="form-group">
            <label>Location</label>
            <input type="text" id="inv-location" class="form-control" placeholder="e.g., Stock Room, Room 101">
        </div>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="save-inventory-btn" class="btn btn-success">Save Item</button>
            <button id="cancel-modal-btn" class="btn">Cancel</button>
        </div>
    `;
    
    document.getElementById('save-inventory-btn').onclick = async () => {
        const itemNumber = document.getElementById('inv-item-number').value.trim();
        const itemName = document.getElementById('inv-name').value;
        
        if (!itemNumber) {
            showToast('Please enter item number or serial number', 'error');
            return;
        }
        
        if (!itemName) {
            showToast('Please enter item name', 'error');
            return;
        }
        
        const newItem = {
            item_number: itemNumber,
            item_name: itemName,
            category: document.getElementById('inv-category').value,
            item_type: document.getElementById('inv-item-type').value,
            quantity: parseInt(document.getElementById('inv-quantity').value),
            unit: document.getElementById('inv-unit').value,
            min_stock: parseInt(document.getElementById('inv-min-stock').value),
            location: document.getElementById('inv-location').value,
            status: 'available',
            last_updated: new Date().toISOString().split('T')[0]
        };
        
        await Database.createInventoryItem(newItem);
        showToast('Item added successfully', 'success');
        document.getElementById('request-modal').style.display = 'none';
        await renderInventory();
    };
    
    document.getElementById('cancel-modal-btn').onclick = () => {
        document.getElementById('request-modal').style.display = 'none';
    };
    
    document.getElementById('request-modal').style.display = 'flex';
}

// ============ REPORTS FUNCTIONS WITH CHARTS ============

async function renderReports() {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) return;
    
    // v8.9: production reporting metrics are calculated server-side.
    // Fall back to the already-loaded secure staff data only if the v8.9 RPC is unavailable.
    let metrics = null;
    try { metrics = await Database.getReportMetrics(); }
    catch (error) { console.warn('v8.9 reporting metrics unavailable:', error.message); }

    const inventory = await Database.getInventory();
    const totalRequests = Number(metrics?.maintenance?.total ?? requests.length);
    const completedRequests = Number(metrics?.maintenance?.completed ?? requests.filter(r => r.status === 'completed').length);
    const pendingRequests = Number(metrics?.maintenance?.pending ?? requests.filter(r => r.status === 'pending').length);
    const totalItems = Number(metrics?.inventory?.items ?? inventory.length);

    const reportValues = {
        'report-total': totalRequests,
        'report-completed': completedRequests,
        'report-pending': pendingRequests,
        'report-inventory': totalItems,
        'report-low-stock': Number(metrics?.inventory?.low_stock ?? inventory.filter(i => Number(i.quantity) <= Number(i.min_stock || 0)).length),
        'report-borrowed': Number(metrics?.borrowing?.borrowed ?? 0),
        'report-overdue': Number(metrics?.borrowing?.overdue ?? 0),
        'report-active-users': Number(metrics?.users?.active ?? 0)
    };
    Object.entries(reportValues).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = Number(value || 0).toLocaleString();
    });
    
    // Destroy existing charts if they exist
    if (statusChart) statusChart.destroy();
    if (priorityChart) priorityChart.destroy();
    if (trendsChart) trendsChart.destroy();
    
    // Create Status Chart (Doughnut Chart)
    const pending = requests.filter(r => r.status === 'pending').length;
    const inProgress = requests.filter(r => r.status === 'in-progress').length;
    const completed = requests.filter(r => r.status === 'completed').length;
    
    const statusCtx = document.getElementById('statusChart')?.getContext('2d');
    if (statusCtx) {
        statusChart = new Chart(statusCtx, {
            type: 'doughnut',
            data: {
                labels: ['Pending', 'In Progress', 'Completed'],
                datasets: [{
                    data: [pending, inProgress, completed],
                    backgroundColor: ['#ff9800', '#2196f3', '#4caf50'],
                    borderWidth: 0,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#fff', font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.raw || 0;
                                const total = pending + inProgress + completed;
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
    
    // Create Priority Chart (Bar Chart)
    const low = requests.filter(r => r.priority === 'low').length;
    const medium = requests.filter(r => r.priority === 'medium').length;
    const high = requests.filter(r => r.priority === 'high').length;
    const urgent = requests.filter(r => r.priority === 'urgent').length;
    
    const priorityCtx = document.getElementById('priorityChart')?.getContext('2d');
    if (priorityCtx) {
        priorityChart = new Chart(priorityCtx, {
            type: 'bar',
            data: {
                labels: ['Low', 'Medium', 'High', 'Urgent'],
                datasets: [{
                    label: 'Number of Requests',
                    data: [low, medium, high, urgent],
                    backgroundColor: ['#4caf50', '#ff9800', '#f44336', '#9c27b0'],
                    borderRadius: 8,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { labels: { color: '#fff' } } },
                scales: {
                    y: { beginAtZero: true, ticks: { color: '#fff', stepSize: 1 }, grid: { color: '#333' } },
                    x: { ticks: { color: '#fff' }, grid: { color: '#333' } }
                }
            }
        });
    }
    
    // Create Monthly Trends Chart
    await renderTrendsChart();
    
    // Setup export buttons
    const exportRequestsBtn = document.getElementById('export-requests-csv');
    const exportInventoryBtn = document.getElementById('export-inventory-csv');
    
    if (exportRequestsBtn) {
        exportRequestsBtn.removeEventListener('click', () => exportToCSV('requests'));
        exportRequestsBtn.addEventListener('click', () => exportToCSV('requests'));
    }
    if (exportInventoryBtn) {
        exportInventoryBtn.removeEventListener('click', () => exportToCSV('inventory'));
        exportInventoryBtn.addEventListener('click', () => exportToCSV('inventory'));
    }
}

async function renderTrendsChart() {
    const months = [];
    const monthlyCounts = [];
    const today = new Date();
    
    for (let i = 5; i >= 0; i--) {
        const month = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthName = month.toLocaleString('default', { month: 'short' });
        months.push(monthName);
        
        const monthStart = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthEnd = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
        
        const count = requests.filter(r => {
            const reqDate = new Date(r.dateSubmitted);
            return reqDate >= monthStart && reqDate <= monthEnd;
        }).length;
        
        monthlyCounts.push(count);
    }
    
    const trendsCtx = document.getElementById('trendsChart')?.getContext('2d');
    if (trendsCtx) {
        trendsChart = new Chart(trendsCtx, {
            type: 'line',
            data: {
                labels: months,
                datasets: [{
                    label: 'Requests Submitted',
                    data: monthlyCounts,
                    borderColor: '#d32f2f',
                    backgroundColor: 'rgba(211, 47, 47, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#d32f2f',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { labels: { color: '#fff' } },
                    tooltip: { callbacks: { label: function(context) { return `Requests: ${context.raw}`; } } }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { color: '#fff', stepSize: 1 }, grid: { color: '#333' } },
                    x: { ticks: { color: '#fff' }, grid: { color: '#333' } }
                }
            }
        });
    }
}

function csvCell(value) {
    const text = value == null ? '' : String(value);
    return `"${text.replaceAll('"', '""')}"`;
}

function exportToCSV(type) {
    if (type === 'requests') {
        const headers = ['ID', 'Classroom', 'Issue Type', 'Description', 'Priority', 'Submitted By', 'Date', 'Status'];
        const data = requests.map(r => [
            r.id, r.classroom, r.issueType, r.description, r.priority, r.submittedBy, r.dateSubmitted, r.status
        ]);
        
        let csvContent = headers.join(',') + '\n';
        data.forEach(row => {
            csvContent += row.map(csvCell).join(',') + '\n';
        });
        
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `maintenance_requests_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        showToast('Requests exported successfully!', 'success');
    } else if (type === 'inventory') {
        Database.getInventory().then(inventory => {
            const headers = ['Item Name', 'Category', 'Quantity', 'Unit', 'Min Stock', 'Location', 'Last Updated'];
            const data = inventory.map(i => [
                i.item_name, i.category, i.quantity, i.unit, i.min_stock, i.location || '', i.last_updated || ''
            ]);
            
            let csvContent = headers.join(',') + '\n';
            data.forEach(row => {
                csvContent += row.map(csvCell).join(',') + '\n';
            });
            
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `inventory_${new Date().toISOString().split('T')[0]}.csv`;
            link.click();
            URL.revokeObjectURL(link.href);
            showToast('Inventory exported successfully!', 'success');
        });
    }
}

// ============ BORROW APPROVAL / RETURN FUNCTIONS ============

function borrowStatusMeta(status, isOverdue = false) {
    if (isOverdue) return { label: 'Overdue', cls: 'borrow-status-overdue' };
    const map = {
        pending: { label: 'Pending Approval', cls: 'borrow-status-pending' },
        borrowed: { label: 'Approved / Borrowed', cls: 'borrow-status-approved' },
        rejected: { label: 'Rejected', cls: 'borrow-status-rejected' },
        returned: { label: 'Returned', cls: 'borrow-status-returned' }
    };
    return map[status] || { label: status || 'Unknown', cls: 'borrow-status-neutral' };
}

async function refreshBorrowInventoryOptions() {
    const borrowSelect = document.getElementById('borrow-item');
    if (!borrowSelect) return;

    const inventory = await Database.getInventory();
    borrowSelect.innerHTML = '<option value="">-- Select Item --</option>' +
        inventory.filter(item => Number(item.quantity) > 0).map(item =>
            `<option value="${item.id}" data-name="${escapeHtml(item.item_name || '')}" data-stock="${Number(item.quantity) || 0}">${escapeHtml(item.item_name || 'Item')} (Available: ${Number(item.quantity) || 0})</option>`
        ).join('');
}

async function renderBorrowPage() {
    if (!currentUser) return;
    await refreshBorrowInventoryOptions();
    await renderBorrowHistory();
    setupBorrowEventListeners();
}

async function renderBorrowHistory() {
    const tbody = document.querySelector('#borrow-table tbody');
    if (!tbody || !currentUser) return;

    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Loading borrow requests...</td></tr>';

    try {
        let transactions = await Database.getBorrowTransactions();

        if (currentUser.role === 'user') {
            transactions = transactions.filter(t => String(t.borrower_auth) === String(currentUser.id));
        }

        if (currentBorrowFilter !== '') {
            const searchTerm = currentBorrowFilter.toLowerCase();
            transactions = transactions.filter(t =>
                t.item_name?.toLowerCase().includes(searchTerm) ||
                t.borrower_name?.toLowerCase().includes(searchTerm) ||
                t.status?.toLowerCase().includes(searchTerm) ||
                t.purpose?.toLowerCase().includes(searchTerm)
            );
        }

        if (currentBorrowStatus !== 'all') {
            transactions = transactions.filter(t => {
                const overdue = t.status === 'borrowed' && t.expected_return_date && new Date(t.expected_return_date + 'T23:59:59') < new Date();
                if (currentBorrowStatus === 'overdue') return overdue;
                return t.status === currentBorrowStatus;
            });
        }

        if (!transactions || transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No borrow requests found.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        const canApprove = currentUser.role === 'admin' || currentUser.role === 'superadmin';

        for (const trans of transactions) {
            const row = tbody.insertRow();
            const isOverdue = trans.status === 'borrowed' && trans.expected_return_date && new Date(trans.expected_return_date + 'T23:59:59') < new Date();
            const statusMeta = borrowStatusMeta(trans.status, isOverdue);
            const showDecisionButtons = canApprove && trans.status === 'pending';
            const showReturnButton = canApprove && trans.status === 'borrowed';

            let workflowAction = '<span class="muted-action">No action required</span>';
            if (showDecisionButtons) {
                workflowAction = `
                    <button class="btn btn-success btn-sm approve-borrow" data-id="${trans.id}" data-item-id="${trans.item_id}" data-qty="${trans.quantity}" data-item-name="${escapeHtml(trans.item_name || 'item')}"><i class="fa-solid fa-check"></i> Approve</button>
                    <button class="btn btn-danger btn-sm reject-borrow" data-id="${trans.id}" data-item-name="${escapeHtml(trans.item_name || 'item')}"><i class="fa-solid fa-xmark"></i> Reject</button>`;
            } else if (showReturnButton) {
                workflowAction = `<button class="btn btn-secondary btn-sm return-item" data-id="${trans.id}" data-item-id="${trans.item_id}" data-qty="${trans.quantity}"><i class="fa-solid fa-rotate-left"></i> Mark Returned</button>`;
            } else if (trans.status === 'pending') {
                workflowAction = '<span class="muted-action">Awaiting approval</span>';
            } else if (trans.status === 'rejected') {
                workflowAction = '<span class="muted-action">Request closed</span>';
            } else if (trans.status === 'returned') {
                workflowAction = '<span class="muted-action">Completed</span>';
            } else if (trans.status === 'borrowed') {
                workflowAction = '<span class="muted-action">Currently borrowed</span>';
            }
            const actionHtml = `<div class="table-actions"><button class="btn btn-secondary btn-sm view-borrow-details" data-id="${trans.id}"><i class="fa-regular fa-eye"></i> Details</button>${workflowAction}</div>`;

            row.innerHTML = `
                <td><strong>${escapeHtml(trans.item_name || 'N/A')}</strong><div class="table-secondary">${escapeHtml(trans.purpose || '')}</div></td>
                <td>${escapeHtml(trans.borrower_name || 'N/A')}</td>
                <td>${Number(trans.quantity) || 0}</td>
                <td>${trans.borrow_date || '—'}</td>
                <td>${trans.expected_return_date || '—'}</td>
                <td><span class="borrow-status ${statusMeta.cls}">${statusMeta.label}</span></td>
                <td>${actionHtml}</td>
            `;
        }

        document.querySelectorAll('.approve-borrow').forEach(btn => btn.addEventListener('click', handleApproveBorrow));
        document.querySelectorAll('.reject-borrow').forEach(btn => btn.addEventListener('click', handleRejectBorrow));
        document.querySelectorAll('.return-item').forEach(btn => btn.addEventListener('click', handleReturnItem));
        document.querySelectorAll('.view-borrow-details').forEach(btn => btn.addEventListener('click', handleBorrowDetails));
        if (typeof refreshProductionOverview === 'function') setTimeout(refreshProductionOverview, 0);

    } catch (error) {
        console.error('Error loading borrow history:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Unable to load borrow requests.</td></tr>';
    }
}

async function handleApproveBorrow(e) {
    if (!currentUser || !['admin', 'superadmin'].includes(currentUser.role)) return;

    const button = e.currentTarget;
    const transactionId = button.dataset.id;
    const itemId = button.dataset.itemId;
    const quantity = Number(button.dataset.qty);
    const itemName = button.dataset.itemName || 'this item';

    const result = await Swal.fire({
        title: 'Approve borrow request?',
        text: `${quantity} × ${itemName} will be reserved from inventory.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#16a34a',
        cancelButtonColor: '#475569',
        confirmButtonText: 'Approve request'
    });
    if (!result.isConfirmed) return;

    button.disabled = true;
    button.textContent = 'Approving...';

    try {
        await Database.approveBorrowTransaction(transactionId);

        showToast('Borrow request approved.', 'success');
        await Promise.all([renderBorrowHistory(), refreshBorrowInventoryOptions()]);
        if (typeof renderInventory === 'function') await renderInventory();
    } catch (error) {
        console.error('Approve borrow error:', error);
        showToast(error.message || 'Unable to approve borrow request.', 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Approve';
    }
}

async function handleRejectBorrow(e) {
    if (!currentUser || !['admin', 'superadmin'].includes(currentUser.role)) return;

    const button = e.currentTarget;
    const transactionId = button.dataset.id;
    const itemName = button.dataset.itemName || 'this item';

    const result = await Swal.fire({
        title: 'Reject borrow request?',
        text: `The request for ${itemName} will be closed without changing inventory.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#475569',
        confirmButtonText: 'Reject request'
    });
    if (!result.isConfirmed) return;

    button.disabled = true;
    button.textContent = 'Rejecting...';
    try {
        const updated = await Database.rejectBorrowTransaction(transactionId);
        if (!updated) throw new Error('Could not reject borrow transaction.');
        showToast('Borrow request rejected.', 'success');
        await renderBorrowHistory();
    } catch (error) {
        console.error('Reject borrow error:', error);
        showToast('Unable to reject borrow request.', 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Reject';
    }
}

async function handleReturnItem(e) {
    const button = e.currentTarget;
    const transactionId = button.dataset.id;
    const itemId = button.dataset.itemId;
    const quantity = Number(button.dataset.qty);

    const result = await Swal.fire({
        title: 'Confirm equipment return?',
        text: 'The borrowed quantity will be restored to inventory.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#2563eb',
        cancelButtonColor: '#475569',
        confirmButtonText: 'Mark as returned'
    });
    if (!result.isConfirmed) return;

    button.disabled = true;
    button.textContent = 'Processing...';
    try {
        const returnResult = await Database.returnItem(transactionId);
        if (!returnResult) throw new Error('Return failed.');
        showToast('Equipment marked as returned.', 'success');
        await Promise.all([renderBorrowHistory(), refreshBorrowInventoryOptions()]);
        if (typeof renderInventory === 'function') await renderInventory();
    } catch (error) {
        console.error('Return error:', error);
        showToast('Unable to process the return.', 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Mark Returned';
    }
}

function setupBorrowEventListeners() {
    const borrowBtn = document.getElementById('borrow-btn');
    const searchInput = document.getElementById('search-borrow-input');
    const statusFilter = document.getElementById('borrow-status-filter');

    if (borrowBtn && !borrowBtn.dataset.listenerBound) {
        borrowBtn.addEventListener('click', handleBorrowItem);
        borrowBtn.dataset.listenerBound = 'true';
    }
    if (searchInput && !searchInput.dataset.listenerBound) {
        searchInput.addEventListener('input', handleBorrowSearch);
        searchInput.dataset.listenerBound = 'true';
    }
    if (statusFilter && !statusFilter.dataset.listenerBound) {
        statusFilter.addEventListener('change', (e) => {
            currentBorrowStatus = e.target.value;
            renderBorrowHistory();
        });
        statusFilter.dataset.listenerBound = 'true';
    }
}

async function handleBorrowItem() {
    const itemSelect = document.getElementById('borrow-item');
    const quantityInput = document.getElementById('borrow-quantity');
    const purposeInput = document.getElementById('borrow-purpose');
    const returnDateInput = document.getElementById('borrow-return-date');
    const borrowBtn = document.getElementById('borrow-btn');

    const quantity = Number(quantityInput?.value);
    const purpose = purposeInput?.value.trim() || '';
    const expectedReturn = returnDateInput?.value || '';
    const selectedOption = itemSelect?.options[itemSelect.selectedIndex];
    const itemId = itemSelect?.value || '';
    const itemName = selectedOption?.getAttribute('data-name') || '';
    const currentStock = Number(selectedOption?.getAttribute('data-stock') || 0);

    if (!itemId) return showToast('Please select an item.', 'error');
    if (!quantity || quantity < 1) return showToast('Please enter a valid quantity.', 'error');
    if (quantity > currentStock) return showToast(`Only ${currentStock} item(s) are currently available.`, 'error');
    if (!purpose) return showToast('Please enter the borrowing purpose.', 'error');
    if (!expectedReturn) return showToast('Please select an expected return date.', 'error');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expected = new Date(expectedReturn + 'T00:00:00');
    if (expected < today) return showToast('Expected return date cannot be in the past.', 'error');

    const confirmResult = await Swal.fire({
        title: 'Submit borrow request?',
        html: `<strong>${quantity} × ${escapeHtml(itemName)}</strong><br><span style="color:#64748b">An Admin or Super Admin must approve this request before inventory is deducted.</span>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#d32f2f',
        cancelButtonColor: '#475569',
        confirmButtonText: 'Submit request'
    });
    if (!confirmResult.isConfirmed) return;

    borrowBtn.disabled = true;
    borrowBtn.textContent = 'Submitting...';

    try {
        const transaction = {
            item_id: parseInt(itemId),
            item_name: itemName,
            borrower_name: currentUser.fullName,
            borrower_id: currentUser.id,
            quantity,
            purpose,
            expected_return_date: expectedReturn,
            status: 'pending'
        };

        // Inventory is intentionally NOT deducted here.
        // It is deducted only when an Admin/Super Admin approves the request.
        const result = await Database.borrowItem(transaction);
        if (!result) throw new Error('Request could not be saved.');

        showToast('Borrow request submitted for approval.', 'success');
        itemSelect.value = '';
        quantityInput.value = '1';
        purposeInput.value = '';
        returnDateInput.value = '';
        await renderBorrowHistory();
    } catch (error) {
        console.error('Borrow request error:', error);
        showToast('Unable to submit borrow request.', 'error');
    } finally {
        borrowBtn.disabled = false;
        borrowBtn.textContent = 'Submit Borrow Request';
    }
}

function handleBorrowSearch(e) {
    currentBorrowFilter = e.target.value;
    renderBorrowHistory();
}


// ============ V6 PRODUCTION POLISH ============
function formatActivityDate(value) {
    if (!value) return 'Date unavailable';
    const d = new Date(String(value).length <= 10 ? value + 'T12:00:00' : value);
    if (Number.isNaN(d.getTime())) return escapeHtml(value);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getBorrowTimestamp(transaction) {
    return transaction.actual_return_date || transaction.expected_return_date || transaction.borrow_date || '';
}

async function buildOperationalSnapshot() {
    const isStaff = currentUser && ['admin', 'superadmin'].includes(currentUser.role);
    const [transactions, inventory, pendingRegistrations] = await Promise.all([
        Database.getBorrowTransactions().catch(() => []),
        isStaff ? Database.getInventory().catch(() => []) : Promise.resolve([]),
        currentUser?.role === 'superadmin' ? Database.getPendingRegistrations().catch(() => []) : Promise.resolve([])
    ]);

    const visibleTransactions = currentUser?.role === 'user'
        ? transactions.filter(t => String(t.borrower_auth) === String(currentUser.id))
        : transactions;
    const now = new Date();
    const overdue = visibleTransactions.filter(t => t.status === 'borrowed' && t.expected_return_date && new Date(t.expected_return_date + 'T23:59:59') < now);
    const pendingBorrow = visibleTransactions.filter(t => t.status === 'pending');
    const lowStock = inventory.filter(item => Number(item.quantity) <= Number(item.min_stock));
    const pendingMaintenance = currentUser?.role === 'user'
        ? requests.filter(r => String(r.submittedById) === String(currentUser.id) && r.status !== 'completed')
        : requests.filter(r => r.status === 'pending');

    return { transactions: visibleTransactions, inventory, pendingRegistrations, overdue, pendingBorrow, lowStock, pendingMaintenance };
}

function attentionCard(icon, label, value, tone, detail) {
    return `<div class="attention-card attention-${tone}">
        <div class="attention-icon"><i class="${icon}"></i></div>
        <div><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(detail)}</small></div>
    </div>`;
}

async function refreshProductionOverview() {
    if (!currentUser) return;
    try {
        const snapshot = await buildOperationalSnapshot();
        const grid = document.getElementById('attention-grid');
        if (grid) {
            if (currentUser.role === 'user') {
                grid.innerHTML = [
                    attentionCard('fa-regular fa-clock', 'Open maintenance', snapshot.pendingMaintenance.length, 'neutral', 'Requests still in progress'),
                    attentionCard('fa-solid fa-hourglass-half', 'Borrow approvals', snapshot.pendingBorrow.length, 'warning', 'Waiting for staff review'),
                    attentionCard('fa-solid fa-triangle-exclamation', 'Overdue equipment', snapshot.overdue.length, snapshot.overdue.length ? 'danger' : 'neutral', 'Items past expected return')
                ].join('');
            } else {
                const cards = [
                    attentionCard('fa-regular fa-clipboard', 'Pending maintenance', snapshot.pendingMaintenance.length, 'warning', 'Requests awaiting action'),
                    attentionCard('fa-solid fa-arrow-right-arrow-left', 'Borrow approvals', snapshot.pendingBorrow.length, 'warning', 'Requests awaiting approval'),
                    attentionCard('fa-solid fa-triangle-exclamation', 'Overdue equipment', snapshot.overdue.length, snapshot.overdue.length ? 'danger' : 'neutral', 'Approved items past due'),
                    attentionCard('fa-solid fa-box-open', 'Low stock', snapshot.lowStock.length, snapshot.lowStock.length ? 'danger' : 'neutral', 'Inventory at or below minimum')
                ];
                if (currentUser.role === 'superadmin') cards.push(attentionCard('fa-solid fa-user-check', 'Account approvals', snapshot.pendingRegistrations.length, 'info', 'Registrations awaiting review'));
                grid.innerHTML = cards.join('');
            }
        }

        const activityFeed = document.getElementById('activity-feed');
        if (activityFeed) {
            const activity = [];
            const visibleRequests = currentUser.role === 'user'
                ? requests.filter(r => String(r.submittedById) === String(currentUser.id))
                : requests;
            visibleRequests.forEach(r => activity.push({
                type: 'request', date: r.dateCompleted || r.dateSubmitted || '',
                icon: r.status === 'completed' ? 'fa-regular fa-circle-check' : 'fa-regular fa-clipboard',
                title: `${r.id || 'Request'} · ${formatStatus(r.status)}`,
                detail: `${r.classroom || 'Location'} · ${r.issueType || 'Maintenance request'}`
            }));
            snapshot.transactions.forEach(t => {
                const meta = borrowStatusMeta(t.status, t.status === 'borrowed' && t.expected_return_date && new Date(t.expected_return_date + 'T23:59:59') < new Date());
                activity.push({
                    type: 'borrow', date: getBorrowTimestamp(t), icon: 'fa-solid fa-arrow-right-arrow-left',
                    title: `${t.item_name || 'Equipment'} · ${meta.label}`,
                    detail: currentUser.role === 'user' ? (t.purpose || 'Borrow request') : `${t.borrower_name || 'Unknown borrower'} · Qty ${Number(t.quantity) || 0}`
                });
            });
            activity.sort((a,b) => String(b.date).localeCompare(String(a.date)));
            activityFeed.innerHTML = activity.length ? activity.slice(0, 6).map(item => `
                <div class="activity-item">
                    <div class="activity-icon"><i class="${item.icon}"></i></div>
                    <div class="activity-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div>
                    <time>${formatActivityDate(item.date)}</time>
                </div>`).join('') : '<div class="activity-empty">No recent activity to display.</div>';
        }

        renderNotificationCenter(snapshot);
    } catch (error) {
        console.warn('Production overview error:', error);
    }
}

async function renderNotificationCenter(snapshot) {
    const list = document.getElementById('notification-list');
    const badge = document.getElementById('notification-badge');
    if (!list || !badge || !currentUser) return;
    try {
        const items = await Database.getNotifications(30);
        const unread = items.filter(n => !n.is_read).length;
        badge.textContent = unread > 9 ? '9+' : String(unread);
        badge.style.display = unread ? 'inline-flex' : 'none';
        const iconFor = (type) => ({maintenance:'fa-solid fa-screwdriver-wrench',borrow:'fa-solid fa-arrow-right-arrow-left',approval:'fa-solid fa-user-check',account:'fa-solid fa-user-shield'}[type] || 'fa-regular fa-bell');
        list.innerHTML = items.length ? items.map(item => `
            <div class="notification-item notification-${item.is_read ? 'read' : 'info'} ${item.is_read ? '' : 'notification-unread'}">
                <div class="notification-item-icon"><i class="${iconFor(item.type)}"></i></div>
                <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message)}</span><small>${formatActivityDate(item.created_at)}</small></div>
            </div>`).join('') : '<div class="notification-empty"><i class="fa-regular fa-circle-check"></i><strong>All caught up</strong><span>No persistent notifications yet.</span></div>';
    } catch (error) {
        console.warn('Persistent notifications unavailable:', error);
        list.innerHTML = '<div class="notification-empty"><strong>Notifications unavailable</strong><span>Run the v8.8 database migration first.</span></div>';
        badge.style.display = 'none';
    }
}

function setupNotificationCenter() {
    const button = document.getElementById('notification-button');
    const panel = document.getElementById('notification-panel');
    const close = document.getElementById('close-notifications');
    const markRead = document.getElementById('mark-notifications-read');
    if (!button || !panel) return;
    button.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('open'); });
    close?.addEventListener('click', () => panel.classList.remove('open'));
    markRead?.addEventListener('click', async (e) => { e.stopPropagation(); try { await Database.markNotificationsRead(); await renderNotificationCenter(); } catch (err) { showToast(err.message || 'Could not mark notifications read.', 'error'); } });
    document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && !button.contains(e.target)) panel.classList.remove('open');
    });
}

async function handleBorrowDetails(e) {
    const id = e.currentTarget.dataset.id;
    const transactions = await Database.getBorrowTransactions();
    const t = transactions.find(x => String(x.id) === String(id));
    if (!t) return showToast('Borrow request not found.', 'error');
    const overdue = t.status === 'borrowed' && t.expected_return_date && new Date(t.expected_return_date + 'T23:59:59') < new Date();
    const meta = borrowStatusMeta(t.status, overdue);
    const stages = [
        { key: 'pending', label: 'Submitted', icon: 'fa-regular fa-paper-plane' },
        { key: 'borrowed', label: 'Approved / Borrowed', icon: 'fa-solid fa-check' },
        { key: 'returned', label: 'Returned', icon: 'fa-solid fa-rotate-left' }
    ];
    const stageIndex = t.status === 'returned' ? 2 : t.status === 'borrowed' ? 1 : 0;
    const timeline = t.status === 'rejected'
        ? `<div class="borrow-timeline"><div class="timeline-step done"><i class="fa-regular fa-paper-plane"></i><span>Submitted</span></div><div class="timeline-line"></div><div class="timeline-step rejected"><i class="fa-solid fa-xmark"></i><span>Rejected</span></div></div>`
        : `<div class="borrow-timeline">${stages.map((stage, i) => `${i ? '<div class="timeline-line"></div>' : ''}<div class="timeline-step ${i <= stageIndex ? 'done' : ''}"><i class="${stage.icon}"></i><span>${stage.label}</span></div>`).join('')}</div>`;
    await Swal.fire({
        title: 'Borrow Request Details',
        width: 720,
        confirmButtonColor: '#d32f2f',
        html: `<div class="detail-sheet">${timeline}<div class="detail-grid">
            <div><span>Item</span><strong>${escapeHtml(t.item_name || 'N/A')}</strong></div>
            <div><span>Status</span><strong class="${meta.cls}">${escapeHtml(meta.label)}</strong></div>
            <div><span>Borrower</span><strong>${escapeHtml(t.borrower_name || 'N/A')}</strong></div>
            <div><span>Quantity</span><strong>${Number(t.quantity) || 0}</strong></div>
            <div><span>Borrow date</span><strong>${escapeHtml(t.borrow_date || '—')}</strong></div>
            <div><span>Expected return</span><strong>${escapeHtml(t.expected_return_date || '—')}</strong></div>
            ${t.actual_return_date ? `<div><span>Actual return</span><strong>${escapeHtml(t.actual_return_date)}</strong></div>` : ''}
            <div class="detail-wide"><span>Purpose</span><strong>${escapeHtml(t.purpose || 'No purpose provided')}</strong></div>
        </div></div>`
    });
}

const originalUpdateDashboardStats = updateDashboardStats;
updateDashboardStats = function() {
    originalUpdateDashboardStats();
    // Hydrate secondary production widgets without blocking the core dashboard.
    setTimeout(() => refreshProductionOverview(), 0);
};

document.addEventListener('DOMContentLoaded', setupNotificationCenter);

document.addEventListener('DOMContentLoaded', initializeDashboard);

async function renderAuditLog() {
    const body = document.getElementById('audit-log-body');
    if (!body || !currentUser || currentUser.role !== 'superadmin') return;
    body.innerHTML = '<tr><td colspan="5">Loading audit activity...</td></tr>';
    try {
        const rows = await Database.getAuditLog(100);
        body.innerHTML = rows.length ? rows.map(row => `<tr>
            <td>${escapeHtml(formatActivityDate(row.created_at))}</td>
            <td>${escapeHtml(row.actor_name || 'System')}</td>
            <td><span class="audit-action">${escapeHtml(String(row.action || '').replaceAll('_',' '))}</span></td>
            <td>${escapeHtml(row.entity_type || '')}${row.entity_id ? ` · ${escapeHtml(row.entity_id)}` : ''}</td>
            <td>${escapeHtml(row.summary || '')}</td>
        </tr>`).join('') : '<tr><td colspan="5">No audit events yet. New v8.8 actions will appear here.</td></tr>';
    } catch (error) {
        body.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message || 'Unable to load audit log.')}</td></tr>`;
    }
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#refresh-audit-log')) renderAuditLog();
});
