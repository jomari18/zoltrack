const Database = {
    config: {
        supabaseUrl: 'https://varnpfurkldmdsnkecos.supabase.co',
        supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhcm5wZnVya2xkbWRzbmtlY29zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MjkxMTYsImV4cCI6MjA5MjAwNTExNn0.Q55F4ESFzwB_A0ieFFXZA5Uu7rxvFAYoyq8VcZbhUN8',
        useLocalStorage: false
    },
    
    supabase: null,
    initialized: false,
    
    init() {
        console.log('🔄 Database System Initializing...');
        
        if (!this.config.supabaseUrl || !this.config.supabaseKey) {
            console.warn('⚠️ Supabase credentials not set');
            return false;
        }
        
        if (typeof window.supabase === 'undefined') {
            console.warn('⚠️ Supabase JS not loaded');
            return false;
        }
        
        try {
            this.supabase = window.supabase.createClient(
                this.config.supabaseUrl,
                this.config.supabaseKey
            );
            this.initialized = true;
            console.log('✅ Supabase connected to:', this.config.supabaseUrl);
            return true;
        } catch (error) {
            console.warn('⚠️ Supabase init failed:', error.message);
            return false;
        }
    },
    
    async getPublicStats() {
        if (!this.initialized) this.init();
        const { data, error } = await this.supabase.rpc('get_public_stats_v89');
        if (error) throw error;
        return data || {};
    },

    async getReportMetrics() {
        if (!this.initialized) this.init();
        const { data, error } = await this.supabase.rpc('get_report_metrics_v89');
        if (error) throw error;
        return data || {};
    },

    async testConnection() {
        console.log('🔧 Testing Supabase connection...');
        
        if (!this.initialized) {
            console.error('❌ Database not initialized');
            return false;
        }
        
        try {
            const { data, error } = await this.supabase
                .from('profiles')
                .select('id', { count: 'exact', head: true });
            
            if (error) {
                console.error('❌ Database test failed:', error);
                return false;
            }
            
            console.log('✅ Database connection successful');
            return true;
        } catch (error) {
            console.error('❌ Database test exception:', error);
            return false;
        }
    },
  
    async getManagedUsers() {
        if (!this.initialized) this.init();
        const { data, error } = await this.supabase.rpc('get_managed_users');
        if (error) throw error;
        return (data || []).map(user => ({
            id: user.id, fullName: user.full_name || '', email: user.email || '',
            username: user.username || '', role: user.role || 'user',
            status: user.active === false ? 'inactive' : 'active', approved: user.approved === true,
            createdAt: user.created_at
        }));
    },

    async setManagedUserRole(userId, role) {
        const { error } = await this.supabase.rpc('set_managed_user_role', { p_profile_id: userId, p_role: role });
        if (error) throw error;
    },

    async setManagedUserActive(userId, active) {
        const { error } = await this.supabase.rpc('set_managed_user_active', { p_profile_id: userId, p_active: active });
        if (error) throw error;
    },

    // Legacy public.users helpers removed in v8.4. Authentication and user management
    // now use Supabase Auth + public.profiles/RPCs exclusively.

    async getRequests(userId = null) {
        console.log('📋 Fetching maintenance requests through v8 Auth RPC...');
        if (!this.initialized) this.init();
        if (!this.supabase) throw new Error('Database not initialized');

        const { data, error } = await this.supabase.rpc('get_maintenance_requests_v8');
        if (error) {
            console.error('Maintenance fetch failed:', error);
            throw error;
        }

        let mapped = (data || []).map(req => {
            return {
                id: req.request_id,
                classroom: req.classroom,
                issueType: req.issue_type,
                description: req.description,
                priority: req.priority,
                submittedBy: req.submitted_by_name || 'Legacy User',
                submittedById: req.submitted_by_auth || req.submitted_by_legacy,
                dateSubmitted: req.date_submitted,
                status: req.status,
                assignedTo: req.assigned_to_name || '',
                assignedToId: req.assigned_to_auth || req.assigned_to_legacy,
                dateCompleted: req.date_completed,
                notes: req.notes || '',
                attachment: req.photo_url || null
            };
        });
        if (userId) mapped = mapped.filter(r => String(r.submittedById) === String(userId));
        return mapped;
    },

    async createRequest(requestData, currentUserId) {
        if (!this.initialized) this.init();
        if (!this.supabase) throw new Error('Database not initialized');
        const { data, error } = await this.supabase.rpc('submit_maintenance_request_v801', {
            p_classroom: requestData.classroom,
            p_issue_type: requestData.issueType,
            p_description: requestData.description,
            p_priority: requestData.priority,
            p_date_submitted: requestData.dateSubmitted,
            p_photo_url: requestData.attachment || null
        });
        if (error) {
            console.error('Maintenance submit failed:', error);
            throw error;
        }
        return { ...requestData, id: data };
    },

    async completeMaintenanceRequest(requestId, deductInventory, inventoryItemId = null, quantity = null) {
        if (!this.initialized) this.init();
        if (!this.supabase) throw new Error('Database not initialized');
        const { data, error } = await this.supabase.rpc('complete_maintenance_request_v86', {
            p_request_id: String(requestId),
            p_deduct_inventory: Boolean(deductInventory),
            p_inventory_item_id: inventoryItemId ? Number(inventoryItemId) : null,
            p_quantity: deductInventory ? Number(quantity) : null
        });
        if (error) {
            console.error('Atomic maintenance completion failed:', error);
            throw error;
        }
        return data;
    },

    async updateRequest(requestId, updates) {
        if (!this.initialized) this.init();
        if (!this.supabase) return false;
        const { error } = await this.supabase.rpc('update_maintenance_request_v8', {
            p_request_id: String(requestId),
            p_status: updates.status || null,
            p_notes: updates.notes ?? null,
            p_assigned_to: updates.assigned_to || null,
            p_date_completed: updates.date_completed || null
        });
        if (error) {
            console.error('Maintenance update failed:', error);
            return false;
        }
        return true;
    },

    async getPendingRegistrations() {
        if (!this.initialized) this.init();
        const { data, error } = await this.supabase.rpc('get_pending_approval_applications');
        if (error) throw error;
        return (data || []).map(reg => ({
            id: reg.id, fullName: reg.full_name, email: reg.email,
            username: reg.username, role: reg.role,
            documentFile: reg.verification_document,
            documentName: reg.verification_document_name,
            submittedAt: reg.created_at,
            status: reg.approved ? 'approved' : 'pending'
        }));
    },

    async createPendingRegistration(regData) {
        if (!this.initialized) this.init();

        const { data: { session }, error: sessionError } = await this.supabase.auth.getSession();
        if (sessionError || !session?.user) throw new Error('Authenticated session required.');

        let documentPath = regData.documentFile;
        if (regData.file instanceof File) {
            const safeName = String(regData.documentName || regData.file.name || 'verification')
                .replace(/[^a-zA-Z0-9._-]/g, '_');
            documentPath = `${session.user.id}/${Date.now()}-${safeName}`;
            const { error: uploadError } = await this.supabase.storage
                .from('verification-documents')
                .upload(documentPath, regData.file, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: regData.file.type || undefined
                });
            if (uploadError) throw uploadError;
        }

        try {
            const { error } = await this.supabase.rpc('submit_verification_document', {
                p_document: documentPath,
                p_document_name: regData.documentName || null
            });
            if (error) throw error;
        } catch (error) {
            if (regData.file instanceof File && documentPath) {
                await this.supabase.storage.from('verification-documents').remove([documentPath]).catch(() => {});
            }
            throw error;
        }
        return { ...regData, documentFile: documentPath };
    },

    async getVerificationDocumentUrl(documentRef) {
        if (!documentRef) return '';
        // Backward compatibility for any pre-v8.7 Base64/Data URL submission.
        if (/^(data:|https?:|blob:)/i.test(documentRef)) return documentRef;
        if (!this.initialized) this.init();
        const { data, error } = await this.supabase.storage
            .from('verification-documents')
            .createSignedUrl(documentRef, 300);
        if (error) throw error;
        return data?.signedUrl || '';
    },

    async approveAuthProfile(profileId) {
        if (!this.initialized) this.init();
        const { error } = await this.supabase.rpc('approve_profile', { p_profile_id: profileId });
        if (error) throw error;
        return true;
    },

    async rejectAuthProfile(profileId, reason) {
        if (!this.initialized) this.init();
        const { error } = await this.supabase.rpc('reject_profile', {
            p_profile_id: profileId, p_reason: reason
        });
        if (error) throw error;
        return true;
    },

    // Legacy public.pending_registrations mutation helpers removed in v8.4.
    // Approval now uses profile RPCs only.

    // ============ INVENTORY METHODS ============
    
    async getInventory() {
        console.log('📦 Fetching inventory...');
        
        if (this.initialized && this.supabase) {
            try {
                const { data, error } = await this.supabase
                    .from('inventory')
                    .select('*')
                    .order('id', { ascending: true });
                
                if (!error && data) {
                    console.log(`✅ ${data.length} items from Supabase`);
                    return data;
                } else {
                    console.warn('Supabase inventory error:', error);
                }
            } catch (error) {
                console.warn('Supabase inventory exception:', error.message);
            }
        }
        
        const inventory = JSON.parse(localStorage.getItem('fixitInventory')) || [];
        return inventory;
    },
    
    async createInventoryItem(itemData) {
        console.log('➕ Creating inventory item:', itemData.item_name);
        
        if (this.initialized && this.supabase) {
            try {
                const { data, error } = await this.supabase
                    .from('inventory')
                    .insert([itemData])
                    .select()
                    .single();
                
                if (!error && data) {
                    console.log('✅ Item created in Supabase, ID:', data.id);
                    return data;
                } else {
                    console.warn('Supabase insert error:', error);
                }
            } catch (error) {
                console.warn('Supabase create error:', error.message);
            }
        }
        
        const inventory = JSON.parse(localStorage.getItem('fixitInventory')) || [];
        const newItem = { id: Date.now(), ...itemData };
        inventory.push(newItem);
        localStorage.setItem('fixitInventory', JSON.stringify(inventory));
        return newItem;
    },
    
    async updateInventoryItem(itemId, updates) {
        console.log('🔄 Updating inventory item:', itemId);
        
        if (this.initialized && this.supabase) {
            try {
                const { error } = await this.supabase
                    .from('inventory')
                    .update(updates)
                    .eq('id', itemId);
                
                if (!error) {
                    console.log('✅ Item updated in Supabase');
                    return true;
                } else {
                    console.warn('Supabase update error:', error);
                }
            } catch (error) {
                console.warn('Supabase update exception:', error.message);
            }
        }
        
        const inventory = JSON.parse(localStorage.getItem('fixitInventory')) || [];
        const index = inventory.findIndex(item => item.id == itemId);
        if (index !== -1) {
            inventory[index] = { ...inventory[index], ...updates };
            localStorage.setItem('fixitInventory', JSON.stringify(inventory));
            return true;
        }
        return false;
    },
    
    async deleteInventoryItem(itemId) {
        console.log('🗑️ Deleting inventory item:', itemId);
        
        if (this.initialized && this.supabase) {
            try {
                const { error } = await this.supabase
                    .from('inventory')
                    .delete()
                    .eq('id', itemId);
                
                if (!error) {
                    console.log('✅ Item deleted from Supabase');
                    return true;
                } else {
                    console.warn('Supabase delete error:', error);
                }
            } catch (error) {
                console.warn('Supabase delete exception:', error.message);
            }
        }
        
        const inventory = JSON.parse(localStorage.getItem('fixitInventory')) || [];
        const updatedInventory = inventory.filter(item => item.id != itemId);
        localStorage.setItem('fixitInventory', JSON.stringify(updatedInventory));
        return true;
    },

    // ============ BORROW/RETURN METHODS (V8.1 Auth + atomic workflow) ============

    async getBorrowTransactions() {
        const { data, error } = await this.supabase.rpc('get_borrow_transactions_v81');
        if (error) { console.error('V8.1 borrow fetch error:', error); throw error; }
        return data || [];
    },

    async borrowItem(transactionData) {
        const { data, error } = await this.supabase.rpc('submit_borrow_request_v81', {
            p_item_id: Number(transactionData.item_id),
            p_quantity: Number(transactionData.quantity),
            p_purpose: transactionData.purpose,
            p_expected_return_date: transactionData.expected_return_date
        });
        if (error) { console.error('V8.1 borrow submit error:', error); throw error; }
        return data;
    },

    async approveBorrowTransaction(transactionId) {
        const { data, error } = await this.supabase.rpc('approve_borrow_request_v81', { p_transaction_id: Number(transactionId) });
        if (error) { console.error('V8.1 approve error:', error); throw error; }
        return data;
    },

    async rejectBorrowTransaction(transactionId) {
        const { data, error } = await this.supabase.rpc('reject_borrow_request_v81', { p_transaction_id: Number(transactionId) });
        if (error) { console.error('V8.1 reject error:', error); throw error; }
        return data;
    },

    async returnItem(transactionId) {
        const { data, error } = await this.supabase.rpc('return_borrow_item_v81', { p_transaction_id: Number(transactionId) });
        if (error) { console.error('V8.1 return error:', error); throw error; }
        return !!data;
    }
,

    async getNotifications(limit = 30) {
        if (!this.initialized) this.init();
        const { data, error } = await this.supabase.rpc('get_notifications_v88', { p_limit: limit });
        if (error) throw error;
        return data || [];
    },

    async markNotificationsRead() {
        if (!this.initialized) this.init();
        const { data, error } = await this.supabase.rpc('mark_notifications_read_v88');
        if (error) throw error;
        return data || 0;
    },

    async getAuditLog(limit = 100) {
        if (!this.initialized) this.init();
        const { data, error } = await this.supabase.rpc('get_audit_log_v88', { p_limit: limit });
        if (error) throw error;
        return data || [];
    }

};

console.log('✅ Database loaded successfully');