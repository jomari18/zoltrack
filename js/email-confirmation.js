const emailConfirmation = {
    config: {
        serviceId: 'service_jomari',
        mainTemplate: 'template_jomari',
        publicKey: 'oGBjj7OmcYwD7Ijal'
    },
    
    superAdminEmail: '', // Optional: configure privately if admin EmailJS alerts are needed
    
    init() {
        console.log('📧 Email System Initializing...');
        if (typeof emailjs === 'undefined') {
            console.warn('⚠️ EmailJS library not loaded');
            return false;
        }
        try {
            emailjs.init(this.config.publicKey);
            console.log('✅ EmailJS initialized');
            return true;
        } catch (error) {
            console.error('Init error:', error);
            return false;
        }
    },
    
    async sendEmail(to, userName, message, status, nextSteps) {
        console.log('📧 sendEmail called');
        console.log('📧 To:', to);
        console.log('📧 UserName:', userName);
        console.log('📧 Message:', message);
        console.log('📧 Status:', status);
        
        const params = {
            to: to,
            user_name: userName,
            message: message,
            status: status,
            next_steps: nextSteps
        };
        
        console.log('📧 EmailJS params:', params);
        
        try {
            const response = await emailjs.send(
                this.config.serviceId,
                this.config.mainTemplate,
                params
            );
            console.log('✅ Email sent! Status:', response.status);
            console.log('✅ Response:', response);
            return true;
        } catch (error) {
            console.error('❌ Email failed:', error);
            console.error('Error text:', error.text);
            return false;
        }
    },
    
    async sendRegistrationRequest(userData, documentFile) {
        console.log('📝 sendRegistrationRequest called for:', userData.fullName);
        
        const registrationId = 'REG-' + Date.now();
        
        let documentBase64 = null;
        if (documentFile) {
            documentBase64 = await this.fileToBase64(documentFile);
        }
        
        const registrationData = {
            id: registrationId,
            ...userData,
            documentFile: documentBase64,
            documentName: documentFile ? documentFile.name : null,
            submittedAt: new Date().toISOString(),
            status: 'pending'
        };
        
        await Database.createPendingRegistration(registrationData);
        console.log('✅ Registration saved');
        
        // Send email to user
        const userResult = await this.sendEmail(
            userData.email,
            userData.fullName,
            'Thank you for registering with ZolTrack!',
            'PENDING REVIEW',
            'Your registration is under review. You will receive an email once approved.'
        );
        
        // Send email to admin
        const adminResult = this.superAdminEmail ? await this.sendEmail(
            this.superAdminEmail,
            'Admin',
            `New registration from ${userData.fullName} (${userData.email}) as ${userData.role}.`,
            'ACTION REQUIRED',
            'Login to admin panel to approve or reject.'
        ) : true;
        
        console.log('User email result:', userResult);
        console.log('Admin email result:', adminResult);
        
        return registrationId;
    },
    
    // Legacy approval/rejection writers removed in v8.4.
    // dashboard.js uses approve_profile/reject_profile RPCs.

    fileToBase64(file) {
        return new Promise((resolve) => {
            if (!file) {
                resolve(null);
                return;
            }
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
        });
    }
};