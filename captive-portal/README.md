# Captive Portal Setup for MikroTik

This folder contains the captive portal files that should be uploaded to your MikroTik router for hotspot login.

## Files

- `login.html` - Main login page with M-Pesa payment and voucher support
- `status.html` - Connected status page with session info
- `error.html` - Error page for failed logins
- `styles.css` - Styling for all pages
- `script.js` - JavaScript for dynamic functionality

## Installation

### 1. Upload Files to MikroTik

Using WinBox or WebFig:

1. Go to **Files**
2. Create a folder called `hotspot`
3. Upload all files from this folder to `/hotspot/`

Or via FTP:
```bash
ftp router-ip
# Login with admin credentials
put login.html
put status.html
put error.html
put styles.css
put script.js
```

### 2. Configure Hotspot Server Profile

In MikroTik Terminal or WinBox:

```mikrotik
/ip hotspot profile set [find default=yes] \
    login-by=http-chap,http-pap,cookie,trial \
    html-directory=hotspot \
    http-cookie-lifetime=1d
```

### 3. Configure API URL

Edit `script.js` and update the `CONFIG` object:

```javascript
const CONFIG = {
    apiBaseUrl: 'https://your-backend-domain.com/api',
    // ... rest of config
};
```

### 4. Configure Tenant ID

You can pass the tenant ID via query parameter in MikroTik's walled garden:

```mikrotik
/ip hotspot walled-garden ip add dst-host=your-backend-domain.com action=accept
```

Then configure the login URL to include tenant ID:
```mikrotik
/ip hotspot profile set [find default=yes] login-page="/hotspot/login.html?tenantId=YOUR-TENANT-ID"
```

### 5. Allow API Access (Walled Garden)

Add your API domain to the walled garden so users can make API calls before authentication:

```mikrotik
/ip hotspot walled-garden
add dst-host=your-backend-domain.com action=accept
add dst-host=api.safaricom.co.ke action=accept comment="M-Pesa API"
add dst-host=sandbox.safaricom.co.ke action=accept comment="M-Pesa Sandbox"
```

## How It Works

### M-Pesa Payment Flow

1. User selects a package
2. User enters phone number
3. System sends STK Push (payment prompt) to user's phone
4. User enters M-Pesa PIN
5. M-Pesa sends callback to your backend
6. Backend creates hotspot customer with M-Pesa code as username/password
7. Portal polls for status, gets credentials
8. User is auto-logged in

### SMS Fallback

If M-Pesa callback is delayed:

1. User clicks "Already paid? Paste M-Pesa message"
2. User pastes M-Pesa SMS confirmation
3. System extracts transaction code
4. Backend verifies and creates customer
5. User gets credentials

### Voucher Login

1. User switch to "Voucher" tab
2. User enters voucher code
3. System validates voucher
4. User is authenticated

## Customization

### Branding

The portal automatically loads tenant branding from the API:
- Company name
- Logo
- Primary color
- Support phone number

### Styling

Edit `styles.css` to customize:
- Colors (CSS variables at top)
- Fonts
- Layout

## Troubleshooting

### Packages not loading
- Check API URL in script.js
- Check walled garden allows API domain
- Check tenantId is correct

### M-Pesa not working
- Verify tenant has M-Pesa configured in admin panel
- Check M-Pesa callback URL is accessible
- Check walled garden allows api.safaricom.co.ke

### Login not working
- Ensure username/password match (M-Pesa code should be same for both)
- Check RADIUS is configured properly
- Verify customer was created in database
