/**
 * Captive Portal Script
 * 
 * Handles:
 * - Dynamic package loading from API
 * - M-Pesa STK push payment flow
 * - SMS fallback verification
 * - Voucher redemption
 * - Auto-login after payment
 */

// ============ Configuration ============
// IMPORTANT: When running on the router, window.location.origin is the router IP (e.g., 10.5.50.1)
// The placeholder below is replaced by the backend server when serving this file
const urlParams = new URLSearchParams(window.location.search);

// Backend API URL - __EASYISP_API_URL__ is replaced by the backend at serve time
const EASYISP_SERVER = '__EASYISP_API_URL__';
const detectedApiUrl = EASYISP_SERVER + '/api';

const CONFIG = {
    // API base URL - can be overridden via ?apiUrl= query param
    apiBaseUrl: urlParams.get('apiUrl') || detectedApiUrl,

    // Tenant ID - can be passed via query param or detected from NAS
    tenantId: urlParams.get('tenantId') || '',

    // Portal parameters from MikroTik (will be extracted from URL or page)
    macAddress: urlParams.get('mac') || '',
    nasIp: urlParams.get('nasIp') || '',

    // Polling interval for payment status (ms)
    pollInterval: 3000,

    // Payment timeout (ms)
    paymentTimeout: 5 * 60 * 1000, // 5 minutes
};

// ============ State ============
let state = {
    packages: [],
    selectedPackage: null,
    checkoutRequestId: null,
    pollTimer: null,
    countdownTimer: null,
    countdownSeconds: 300,
    activeSession: null, // Stores active session data if found
    receiptCode: null, // M-Pesa transaction code
};

// ============ DOM Elements ============
const elements = {
    // Header
    logo: document.getElementById('logo'),
    companyName: document.getElementById('company-name'),

    // Tabs
    tabs: document.querySelectorAll('.tab'),
    mpesaTab: document.getElementById('mpesa-tab'),
    voucherTab: document.getElementById('voucher-tab'),

    // Packages
    packagesSection: document.getElementById('packages-section'),
    packagesList: document.getElementById('packages-list'),

    // Phone input (now inside modal)
    phoneInput: document.getElementById('phone-input'),
    selectedPrice: document.getElementById('selected-price'),
    payBtn: document.getElementById('pay-btn'),
    backBtn: document.getElementById('back-to-packages'),

    // Payment
    paymentSection: document.getElementById('payment-section'),
    paymentMessage: document.getElementById('payment-message'),
    countdownTimer: document.getElementById('countdown-timer'),

    // Success
    successSection: document.getElementById('success-section'),
    successUsername: document.getElementById('success-username'),
    successPassword: document.getElementById('success-password'),
    connectBtn: document.getElementById('connect-btn'),

    // SMS Fallback
    smsFallback: document.getElementById('sms-fallback'),
    showSmsBtn: document.getElementById('show-sms-btn'),
    smsInputSection: document.getElementById('sms-input-section'),
    smsText: document.getElementById('sms-text'),
    verifySmsBtn: document.getElementById('verify-sms-btn'),

    // Voucher
    voucherInput: document.getElementById('voucher-input'),
    redeemBtn: document.getElementById('redeem-btn'),

    // Error
    errorMessage: document.getElementById('error-message'),

    // Footer
    supportLink: document.getElementById('support-link'),

    // MikroTik form
    mikrotikForm: document.getElementById('mikrotik-form'),
    formUsername: document.getElementById('form-username'),
    formPassword: document.getElementById('form-password'),

    // Modal
    phoneModal: document.getElementById('phone-modal'),
    modalClose: document.getElementById('modal-close'),
    modalPackageName: document.getElementById('modal-package-name'),

    // Session Popup
    sessionPopup: document.getElementById('session-popup'),
    popupPackageName: document.getElementById('popup-package-name'),
    popupRemainingTime: document.getElementById('popup-remaining-time'),
    useSessionBtn: document.getElementById('use-session-btn'),
    dismissPopupBtn: document.getElementById('dismiss-popup-btn'),
};

// ============ Initialization ============
document.addEventListener('DOMContentLoaded', init);

async function init() {
    // Log config for debugging
    console.log('Captive Portal Config:', CONFIG);

    // Try to get MikroTik variables if not set
    if (!CONFIG.macAddress) CONFIG.macAddress = getMikroTikVar('mac-esc');
    if (!CONFIG.nasIp) CONFIG.nasIp = getMikroTikVar('nas-ip');

    // If no tenantId, try to get from NAS IP
    if (!CONFIG.tenantId && CONFIG.nasIp) {
        await detectTenantFromNas();
    }

    // Setup event listeners
    setupEventListeners();

    // Load tenant info and packages
    if (CONFIG.tenantId) {
        await Promise.all([
            loadTenantInfo(),
            loadPackages(),
        ]);

        // Check for active session after loading packages
        if (CONFIG.macAddress) {
            await checkActiveSession();
        }
    } else {
        showError('Configuration error: Tenant ID not found. Add ?tenantId=YOUR_TENANT_ID to the URL.');
    }
}

// Try to extract MikroTik variable from page (they inject these)
function getMikroTikVar(name) {
    // MikroTik replaces $(variable) with actual values in the HTML
    const match = document.body.innerHTML.match(new RegExp(`\\$\\(${name}\\)`));
    return match ? '' : ''; // If $(var) still exists, it wasn't replaced
}

// Detect tenant from NAS IP
async function detectTenantFromNas() {
    try {
        const response = await fetch(`${CONFIG.apiBaseUrl}/portal/tenant?nasIp=${CONFIG.nasIp}`);
        if (response.ok) {
            const data = await response.json();
            CONFIG.tenantId = data.id;
        }
    } catch (error) {
        console.error('Failed to detect tenant:', error);
    }
}

// ============ Event Listeners ============
function setupEventListeners() {
    // Tab switching
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Phone input
    elements.phoneInput.addEventListener('input', validatePhoneInput);
    elements.payBtn.addEventListener('click', initiatePayment);
    elements.backBtn.addEventListener('click', closeModal);

    // Modal close
    elements.modalClose?.addEventListener('click', closeModal);
    elements.phoneModal?.addEventListener('click', (e) => {
        if (e.target === elements.phoneModal) closeModal();
    });

    // SMS fallback
    elements.showSmsBtn.addEventListener('click', toggleSmsInput);
    elements.verifySmsBtn.addEventListener('click', verifySmsPayment);

    // Voucher
    elements.redeemBtn.addEventListener('click', redeemVoucher);
    elements.voucherInput.addEventListener('input', () => {
        elements.voucherInput.value = elements.voucherInput.value.toUpperCase();
    });

    // Connect button
    elements.connectBtn.addEventListener('click', submitLogin);

    // Session popup
    elements.useSessionBtn?.addEventListener('click', useExistingSession);
    elements.dismissPopupBtn?.addEventListener('click', dismissSessionPopup);
}

// ============ Tab Management ============
function switchTab(tabName) {
    elements.tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    elements.mpesaTab.classList.toggle('active', tabName === 'mpesa');
    elements.voucherTab.classList.toggle('active', tabName === 'voucher');

    hideError();
}

// ============ API Functions ============
async function loadTenantInfo() {
    try {
        const response = await fetch(`${CONFIG.apiBaseUrl}/portal/tenant?tenantId=${CONFIG.tenantId}`);
        if (!response.ok) throw new Error('Failed to load tenant info');

        const data = await response.json();

        // Update branding
        elements.companyName.textContent = data.name;
        document.title = data.name + ' - WiFi Login';

        if (data.logo) {
            elements.logo.src = data.logo;
            elements.logo.classList.remove('hidden');
        }

        if (data.primaryColor) {
            document.documentElement.style.setProperty('--primary-color', data.primaryColor);
        }

        if (data.contact?.phone) {
            elements.supportLink.href = `tel:${data.contact.phone}`;
            elements.supportLink.textContent = `Call ${data.contact.phone}`;
        }
    } catch (error) {
        console.error('Failed to load tenant info:', error);
    }
}

async function loadPackages() {
    try {
        const response = await fetch(`${CONFIG.apiBaseUrl}/portal/packages?tenantId=${CONFIG.tenantId}`);
        if (!response.ok) throw new Error('Failed to load packages');

        const data = await response.json();
        state.packages = data.packages;

        renderPackages();
    } catch (error) {
        console.error('Failed to load packages:', error);

        // Check if offline
        const isOffline = !navigator.onLine;
        const errorMessage = isOffline
            ? 'No internet connection. Please check your WiFi and try again.'
            : 'Unable to load packages. Please try again.';

        elements.packagesList.innerHTML = `
            <div class="error-state">
                <div class="error-icon">${isOffline ? '📡' : '⚠️'}</div>
                <p class="error-title">${errorMessage}</p>
                <button class="btn btn-secondary" onclick="retryLoadPackages()">Try Again</button>
            </div>
        `;
    }
}

// Retry loading packages
function retryLoadPackages() {
    elements.packagesList.innerHTML = '<div class="loading">Loading packages...</div>';
    loadPackages();
}

async function checkMpesaConfigured() {
    try {
        const response = await fetch(`${CONFIG.apiBaseUrl}/portal/mpesa/check?tenantId=${CONFIG.tenantId}`);
        if (response.ok) {
            const data = await response.json();
            return data.configured;
        }
    } catch (error) {
        console.error('Failed to check M-Pesa config:', error);
    }
    return false;
}

// ============ Package Selection ============
function renderPackages() {
    if (state.packages.length === 0) {
        elements.packagesList.innerHTML = '<p>No packages available</p>';
        return;
    }

    elements.packagesList.innerHTML = state.packages.map(pkg => `
        <div class="package-card" data-id="${pkg.id}" data-price="${pkg.price}">
            <span class="package-name">${pkg.name}</span>
            <button class="btn btn-buy" data-id="${pkg.id}">Buy</button>
        </div>
    `).join('');

    // Add click handlers to Buy buttons
    document.querySelectorAll('.package-card .btn-buy').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectPackage(btn.dataset.id);
        });
    });
}

function selectPackage(packageId) {
    state.selectedPackage = state.packages.find(p => p.id === packageId);

    if (state.selectedPackage) {
        elements.selectedPrice.textContent = `KSH ${state.selectedPackage.price}`;
        elements.modalPackageName.textContent = state.selectedPackage.name;
        openModal();
    }
}

// ============ Modal Functions ============
function openModal() {
    elements.phoneModal.classList.add('active');

    // Load saved phone number from localStorage
    const savedPhone = localStorage.getItem('easyisp_phone');
    if (savedPhone) {
        elements.phoneInput.value = savedPhone;
        validatePhoneInput(); // Trigger validation to enable button
    }

    elements.phoneInput.focus();
    elements.smsFallback.classList.remove('hidden');
}

function closeModal() {
    elements.phoneModal.classList.remove('active');
    elements.phoneInput.value = '';
    elements.payBtn.disabled = true;
    hideError();
}

// ============ Phone Input ============
function validatePhoneInput() {
    // Allow digits and + sign for the input
    let phone = elements.phoneInput.value.replace(/[^\d+]/g, '');

    // Keep the + only at the start
    if (phone.includes('+')) {
        phone = '+' + phone.replace(/\+/g, '');
    }

    elements.phoneInput.value = phone;

    // Validate the phone number in any of the supported formats
    const isValid = isValidKenyanPhone(phone);
    elements.payBtn.disabled = !isValid;
}

// Check if phone number is valid in any format
function isValidKenyanPhone(phone) {
    // Remove + if present
    const cleaned = phone.replace(/^\+/, '');

    // Format: 254XXXXXXXXX (12 digits, starts with 254)
    if (cleaned.length === 12 && cleaned.startsWith('254')) {
        const suffix = cleaned.substring(3);
        return suffix.startsWith('7') || suffix.startsWith('1');
    }

    // Format: 07XXXXXXXX or 01XXXXXXXX (10 digits, starts with 0)
    if (cleaned.length === 10 && cleaned.startsWith('0')) {
        const suffix = cleaned.substring(1);
        return suffix.startsWith('7') || suffix.startsWith('1');
    }

    // Format: 7XXXXXXXX or 1XXXXXXXX (9 digits)
    if (cleaned.length === 9) {
        return cleaned.startsWith('7') || cleaned.startsWith('1');
    }

    return false;
}

// Normalize phone number to 254XXXXXXXXX format
function normalizePhoneNumber(phone) {
    // Remove + and any non-digit characters
    const cleaned = phone.replace(/\D/g, '');

    // Already in 254XXXXXXXXX format
    if (cleaned.length === 12 && cleaned.startsWith('254')) {
        return cleaned;
    }

    // Format: 07XXXXXXXX or 01XXXXXXXX - remove leading 0
    if (cleaned.length === 10 && cleaned.startsWith('0')) {
        return '254' + cleaned.substring(1);
    }

    // Format: 7XXXXXXXX or 1XXXXXXXX - add 254
    if (cleaned.length === 9) {
        return '254' + cleaned;
    }

    return cleaned;
}

// ============ Payment Flow ============
async function initiatePayment() {
    if (!state.selectedPackage) return;

    const phone = normalizePhoneNumber(elements.phoneInput.value);

    // Show payment status inside modal
    showModalSection('payment');
    elements.paymentMessage.textContent = 'Initiating payment...';

    try {
        const response = await fetch(`${CONFIG.apiBaseUrl}/portal/mpesa/initiate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenantId: CONFIG.tenantId,
                phone: phone,
                packageId: state.selectedPackage.id,
                macAddress: CONFIG.macAddress,
                nasIp: CONFIG.nasIp,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || data.message || 'Payment failed');
        }

        // Save phone number to localStorage on successful initiation
        localStorage.setItem('easyisp_phone', elements.phoneInput.value);

        state.checkoutRequestId = data.checkoutRequestId;
        elements.paymentMessage.textContent = data.message || 'Check your phone for the M-Pesa prompt';

        // Start polling for status
        startPolling();
        startCountdown();

    } catch (error) {
        showError(error.message);
        showModalSection('phone');
    }
}

function startPolling() {
    clearInterval(state.pollTimer);

    state.pollTimer = setInterval(async () => {
        try {
            const response = await fetch(
                `${CONFIG.apiBaseUrl}/portal/mpesa/status?checkoutRequestId=${state.checkoutRequestId}&tenantId=${CONFIG.tenantId}`
            );

            const data = await response.json();

            if (data.status === 'completed') {
                stopPolling();
                state.receiptCode = data.receiptCode || data.transactionId || data.username;
                showSuccess(data.username, data.password);
            } else if (data.status === 'failed') {
                stopPolling();
                showError(data.message || 'Payment failed');
                showSection('phone');
            } else if (data.status === 'expired') {
                stopPolling();
                showError('Payment session expired. Please try again.');
                showSection('packages');
            }
        } catch (error) {
            console.error('Polling error:', error);
        }
    }, CONFIG.pollInterval);
}

function stopPolling() {
    clearInterval(state.pollTimer);
    clearInterval(state.countdownTimer);
    state.pollTimer = null;
    state.countdownTimer = null;
}

function startCountdown() {
    state.countdownSeconds = 300; // 5 minutes
    updateCountdownDisplay();

    state.countdownTimer = setInterval(() => {
        state.countdownSeconds--;
        updateCountdownDisplay();

        if (state.countdownSeconds <= 0) {
            stopPolling();
            showError('Payment session expired');
            showSection('packages');
        }
    }, 1000);
}

function updateCountdownDisplay() {
    const minutes = Math.floor(state.countdownSeconds / 60);
    const seconds = state.countdownSeconds % 60;
    elements.countdownTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ============ SMS Fallback ============
function toggleSmsInput() {
    elements.smsInputSection.classList.toggle('hidden');
}

async function verifySmsPayment() {
    const smsText = elements.smsText.value.trim();

    if (!smsText || smsText.length < 10) {
        showError('Please paste a valid M-Pesa message');
        return;
    }

    if (!state.selectedPackage) {
        showError('Please select a package first');
        return;
    }

    elements.verifySmsBtn.disabled = true;
    elements.verifySmsBtn.textContent = 'Verifying...';

    try {
        const response = await fetch(`${CONFIG.apiBaseUrl}/portal/mpesa/verify-sms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenantId: CONFIG.tenantId,
                smsText: smsText,
                packageId: state.selectedPackage.id,
                macAddress: CONFIG.macAddress,
                nasIp: CONFIG.nasIp,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || data.message || 'Verification failed');
        }

        showSuccess(data.username, data.password);

    } catch (error) {
        showError(error.message);
    } finally {
        elements.verifySmsBtn.disabled = false;
        elements.verifySmsBtn.textContent = 'Verify Payment';
    }
}

// ============ Voucher ============
async function redeemVoucher() {
    const code = elements.voucherInput.value.trim();

    if (!code) {
        showError('Please enter a voucher code');
        return;
    }

    elements.redeemBtn.disabled = true;
    elements.redeemBtn.textContent = 'Redeeming...';

    try {
        const response = await fetch(`${CONFIG.apiBaseUrl}/portal/voucher`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                macAddress: CONFIG.macAddress,
                nasId: CONFIG.nasIp,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || data.message || 'Invalid voucher');
        }

        // For vouchers, the session is created server-side
        // The username is typically V-{CODE}
        showSuccess(`V-${code.toUpperCase()}`, code.toUpperCase());

    } catch (error) {
        showError(error.message);
    } finally {
        elements.redeemBtn.disabled = false;
        elements.redeemBtn.textContent = 'Redeem Voucher';
    }
}

// ============ Success & Login ============
function showSuccess(username, password) {
    stopPolling();
    hideError();

    elements.successUsername.textContent = username;
    elements.successPassword.textContent = password;

    // Show receipt code if available
    const receiptEl = document.getElementById('success-receipt');
    if (receiptEl && state.receiptCode) {
        receiptEl.textContent = state.receiptCode;
        receiptEl.parentElement.classList.remove('hidden');
    }

    // Store credentials for form submission
    state.credentials = { username, password };

    showModalSection('success');
}

function submitLogin() {
    if (!state.credentials) return;

    // Set form values
    elements.formUsername.value = state.credentials.username;
    elements.formPassword.value = state.credentials.password;

    // Submit the MikroTik login form
    elements.mikrotikForm.submit();
}

// Copy credentials to clipboard
function copyCredentials() {
    if (!state.credentials) return;

    const text = `Username: ${state.credentials.username}\nPassword: ${state.credentials.password}`;

    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copy-btn');
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('copied');
            }, 2000);
        }
    }).catch(err => {
        console.error('Failed to copy:', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    });
}

// ============ UI Helpers ============
function showSection(section) {
    hideError();
    elements.packagesSection.classList.toggle('hidden', section !== 'packages');
}

// Show section inside modal
function showModalSection(section) {
    hideError();
    // Hide phone input elements when showing other sections
    const phoneElements = elements.phoneModal.querySelector('.phone-input-group');
    const payBtn = elements.payBtn;
    const backBtn = elements.backBtn;
    const helperText = elements.phoneModal.querySelector('.helper-text');

    if (section === 'phone') {
        phoneElements?.classList.remove('hidden');
        payBtn?.classList.remove('hidden');
        backBtn?.classList.remove('hidden');
        helperText?.classList.remove('hidden');
        elements.paymentSection.classList.add('hidden');
        elements.successSection.classList.add('hidden');
    } else if (section === 'payment') {
        phoneElements?.classList.add('hidden');
        payBtn?.classList.add('hidden');
        backBtn?.classList.add('hidden');
        helperText?.classList.add('hidden');
        elements.paymentSection.classList.remove('hidden');
        elements.successSection.classList.add('hidden');
    } else if (section === 'success') {
        phoneElements?.classList.add('hidden');
        payBtn?.classList.add('hidden');
        backBtn?.classList.add('hidden');
        helperText?.classList.add('hidden');
        elements.paymentSection.classList.add('hidden');
        elements.successSection.classList.remove('hidden');
    }
}

function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorMessage.classList.remove('hidden');
}

function hideError() {
    elements.errorMessage.classList.add('hidden');
}

// ============ Active Session Detection ============
async function checkActiveSession() {
    try {
        const response = await fetch(
            `${CONFIG.apiBaseUrl}/portal/check-session?mac=${encodeURIComponent(CONFIG.macAddress)}&tenantId=${CONFIG.tenantId}`
        );

        const data = await response.json();

        if (data.hasActiveSession && data.customer) {
            state.activeSession = data.customer;
            showSessionPopup(data.customer);
        }
    } catch (error) {
        console.error('Failed to check active session:', error);
    }
}

function showSessionPopup(customer) {
    elements.popupPackageName.textContent = customer.packageName || 'Hotspot';
    elements.popupRemainingTime.textContent = formatRemainingTime(customer.remainingMinutes);
    elements.sessionPopup.classList.add('active');
}

function formatRemainingTime(minutes) {
    if (minutes >= 60 * 24) {
        const days = Math.floor(minutes / (60 * 24));
        return `${days} day${days > 1 ? 's' : ''}`;
    } else if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    } else {
        return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
}

function useExistingSession() {
    if (!state.activeSession) return;

    // Set credentials and submit login form
    state.credentials = {
        username: state.activeSession.username,
        password: state.activeSession.password,
    };

    elements.sessionPopup.classList.remove('active');
    submitLogin();
}

function dismissSessionPopup() {
    elements.sessionPopup.classList.remove('active');
    state.activeSession = null;
}

// ============ FAQ Toggle ============
function toggleFaq(button) {
    const faqItem = button.closest('.faq-item');
    const isActive = faqItem.classList.contains('active');

    // Close all other FAQ items
    document.querySelectorAll('.faq-item.active').forEach(item => {
        if (item !== faqItem) {
            item.classList.remove('active');
        }
    });

    // Toggle current item
    faqItem.classList.toggle('active', !isActive);
}

// ============ Terms & Privacy Modals ============
function showTermsModal() {
    document.getElementById('terms-modal').classList.add('active');
}

function closeTermsModal() {
    document.getElementById('terms-modal').classList.remove('active');
}

function showPrivacyModal() {
    document.getElementById('privacy-modal').classList.add('active');
}

function closePrivacyModal() {
    document.getElementById('privacy-modal').classList.remove('active');
}

function showFaqModal() {
    document.getElementById('faq-modal').classList.add('active');
}

function closeFaqModal() {
    document.getElementById('faq-modal').classList.remove('active');
}

// Close modals on outside click
document.addEventListener('click', (e) => {
    if (e.target.id === 'terms-modal') closeTermsModal();
    if (e.target.id === 'privacy-modal') closePrivacyModal();
    if (e.target.id === 'faq-modal') closeFaqModal();
});
