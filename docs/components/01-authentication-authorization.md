# Authentication & Authorization Module

## Overview

The Authentication & Authorization module provides secure user access control for the EasyISP multi-tenant platform. It handles user login, registration, session management, password security, and role-based access control (RBAC) with granular permissions.

---

## What It Does in the System

### Core Functionality
1. **User Authentication**
   - JWT-based stateless authentication
   - Secure password hashing using bcrypt (cost factor: 12)
   - Token generation with 7-day expiry
   - Login/logout functionality

2. **User Registration**
   - Creates new tenant organization + admin user in atomic transaction
   - Automatic 7-day trial period assignment
   - Unique email validation
   - Business profile setup

3. **Authorization & Access Control**
   - Role-based access control (RBAC) with 6 predefined roles
   - Granular permission system
   - Per-user permission customization (add/remove permissions)
   - Tenant isolation enforcement

4. **Profile Management**
   - Profile picture upload
   - Password change with validation
   - User information retrieval

5. **Trial & Subscription Management**
   - Automatic trial expiration checking on login
   - Subscription expiration enforcement
   - Tenant status validation (`ACTIVE`, `SUSPENDED`, `TRIAL`, `EXPIRED`)

---

## Roles & Permissions

### Available Roles
| Role | Description | Typical Use Case |
|------|-------------|------------------|
| `SUPER_ADMIN` | Platform owner | SaaS provider admin |
| `ADMIN` | ISP tenant administrator | Full ISP management |
| `STAFF` | General staff | Day-to-day operations |
| `CUSTOMER_CARE` | Support staff | Customer service |
| `FIELD_TECH` | Field technician | On-site installations |
| `VIEWER` | Read-only access | Monitoring/reporting |

### Permission Model
- **Base Permissions**: Derived from role
- **Added Permissions**: Extra permissions granted to user (stored in `addedPermissions[]`)
- **Removed Permissions**: Permissions revoked from user (stored in `removedPermissions[]`)
- **Final Permissions**: `(Base + Added) - Removed`

---

## API Endpoints

### POST `/api/auth/login`
**Purpose**: Authenticate user and issue JWT token

**Request Body**:
```json
{
  "email": "admin@example.com",
  "password": "securepassword"
}
```

**Response** (200):
```json
{
  "user": {
    "id": "uuid",
    "name": "John Doe",
    "email": "admin@example.com",
    "role": "ADMIN",
    "tenantId": "uuid",
    "addedPermissions": [],
    "removedPermissions": []
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Security Checks**:
- Verifies user exists and password matches
- Checks if tenant is activated
- Validates trial period hasn't expired
- Validates subscription hasn't expired (if activated)

---

### POST `/api/auth/register`
**Purpose**: Register new ISP tenant with admin user

**Request Body**:
```json
{
  "name": "John Doe",
  "email": "admin@newisp.com",
  "password": "securepassword",
  "businessName": "NewISP Networks",
  "phone": "+254700000000"
}
```

**Response** (201):
```json
{
  "user": { /* user object */ },
  "token": "jwt_token"
}
```

**What Happens**:
1. Checks email uniqueness
2. Hashes password with bcrypt
3. Creates tenant with 7-day trial
4. Creates admin user
5. Returns JWT token for immediate login

---

### POST `/api/auth/logout`
**Purpose**: Logout user (client-side token deletion)

**Auth**: Required  
**Response** (200):
```json
{
  "success": true
}
```

**Note**: JWT is stateless, so logout is handled client-side by deleting the token. For production, consider implementing token blacklisting.

---

### GET `/api/auth/me`
**Purpose**: Get current authenticated user info

**Auth**: Required  
**Response** (200):
```json
{
  "id": "uuid",
  "name": "John Doe",
  "email": "admin@example.com",
  "role": "ADMIN",
  "tenantId": "uuid",
  "profilePicture": "/uploads/profiles/abc123.jpg",
  "phone": "+254700000000"
}
```

---

### POST `/api/auth/profile-picture`
**Purpose**: Upload user profile picture

**Auth**: Required  
**Request**: Multipart form data with `profilePicture` file  
**Response** (200):
```json
{
  "user": {
    "profilePicture": "/uploads/profiles/1234567890.jpg"
  }
}
```

**File Handling**:
- Saves to `/public/uploads/profiles/`
- Filename: `{timestamp}-{random}.{ext}`
- Deletes old profile picture if exists

---

### PUT `/api/auth/password`
**Purpose**: Change user password

**Auth**: Required  
**Request Body**:
```json
{
  "oldPassword": "currentpassword",
  "newPassword": "newsecurepassword"
}
```

**Response** (200):
```json
{
  "success": true,
  "message": "Password updated successfully"
}
```

---

## What's Complete ✅

1. ✅ JWT-based authentication with secure token generation
2. ✅ User registration with tenant creation
3. ✅ Login with comprehensive security checks
4. ✅ Password hashing with bcrypt (cost factor 12)
5. ✅ Role-based access control (6 roles)
6. ✅ Granular permission system (add/remove permissions)
7. ✅ Trial period management (7-day default)
8. ✅ Subscription expiration checking
9. ✅ Profile picture upload
10. ✅ Password change functionality
11. ✅ Tenant status validation on login

---

## What's NOT Complete ⚠️

1. ⚠️ **Token Blacklisting**: No server-side token invalidation on logout
2. ⚠️ **Password Reset/Recovery**: No forgot password flow
3. ⚠️ **Email Verification**: No email confirmation on registration
4. ⚠️ **2FA/MFA**: No two-factor authentication
5. ⚠️ **Session Management**: No active session tracking/termination
6. ⚠️ **Login Attempt Limiting**: No brute force protection
7. ⚠️ **OAuth/SSO**: No third-party authentication (Google, Microsoft, etc.)
8. ⚠️ **API Key Authentication**: No API key generation for programmatic access
9. ⚠️ **Permission Caching**: Permissions recalculated on every request

---

## What's Working ✅

All implemented features are functional:
- User login/logout
- User registration
- JWT token generation and validation
- Password hashing and verification
- Role and permission enforcement via middleware
- Trial and subscription validation
- Profile picture upload
- Password changes

---

## What's NOT Working ❌

No known breaking issues. All completed features are operational.

Potential runtime issues:
- Large file uploads for profile pictures may timeout (no size limit enforced)

---

## Security Issues 🔐

### Critical Issues

1. **No Token Blacklisting**
   - **Risk**: Logout doesn't invalidate JWT tokens
   - **Impact**: Stolen tokens remain valid until expiry (7 days)
   - **Mitigation**: Implement Redis-based token blacklist

2. **No Rate Limiting on Login**
   - **Risk**: Vulnerable to brute force attacks
   - **Impact**: Attackers can attempt unlimited passwords
   - **Mitigation**: Add rate limiting (e.g., 5 attempts per 15 minutes)

3. **JWT Secret in Environment Variable**
   - **Risk**: If `.env` is exposed, all tokens can be forged
   - **Impact**: Complete authentication bypass
   - **Mitigation**: Rotate secrets regularly, use secure key management

4. **No Account Lockout**
   - **Risk**: No protection after failed login attempts
   - **Impact**: Password guessing attacks
   - **Mitigation**: Lock account after N failed attempts

### Medium Issues

5. **No Password Strength Enforcement**
   - **Risk**: Weak passwords accepted (minimum 6 characters)
   - **Impact**: Easy to crack passwords
   - **Mitigation**: Enforce complexity rules (uppercase, lowercase, numbers, symbols)

6. **No Email Verification**
   - **Risk**: Anyone can register with any email
   - **Impact**: Fake accounts, email abuse
   - **Mitigation**: Send verification email before activation

7. **Profile Picture Upload Without Validation**
   - **Risk**: Malicious file uploads (e.g., PHP shells disguised as images)
   - **Impact**: Server compromise
   - **Mitigation**: Validate file type, use virus scanning, store in isolated directory

8. **No CSRF Protection**
   - **Risk**: Cross-site request forgery
   - **Impact**: Unauthorized actions via malicious sites
   - **Mitigation**: Implement CSRF tokens or SameSite cookies

### Low Issues

9. **Long Token Expiry (7 days)**
   - **Risk**: Extended exposure window for stolen tokens
   - **Impact**: Prolonged unauthorized access
   - **Mitigation**: Reduce to 1-2 hours, implement refresh tokens

10. **No Audit Logging for Auth Events**
    - **Risk**: No trail for suspicious login activity
    - **Impact**: Difficult to detect breaches
    - **Mitigation**: Log all auth events (login, failed attempts, password changes)

---

## Possible Improvements 🚀

### High Priority

1. **Implement Token Refresh**
   - Short-lived access tokens (15-60 minutes)
   - Long-lived refresh tokens (30 days)
   - Reduces risk of token theft

2. **Add Rate Limiting**
   ```typescript
   // Example: 5 login attempts per 15 minutes per IP
   import { RateLimiterMemory } from 'rate-limiter-flexible';
   ```

3. **Password Strength Validation**
   ```typescript
   const passwordSchema = z.string()
     .min(12)
     .regex(/[A-Z]/, 'Must contain uppercase')
     .regex(/[a-z]/, 'Must contain lowercase')
     .regex(/[0-9]/, 'Must contain number')
     .regex(/[^A-Za-z0-9]/, 'Must contain special char');
   ```

4. **Email Verification Flow**
   - Send verification token on registration
   - Mark tenant as unverified until confirmed
   - Resend verification email endpoint

### Medium Priority

5. **Password Reset Flow**
   ```
   POST /api/auth/forgot-password
   POST /api/auth/reset-password
   ```

6. **Two-Factor Authentication (2FA)**
   - TOTP support (Google Authenticator)
   - SMS OTP as fallback
   - Backup codes

7. **Session Management Dashboard**
   - List active sessions (stored in Redis/DB)
   - Revoke sessions remotely
   - Device/location tracking

8. **OAuth Integration**
   - Google SSO
   - Microsoft Azure AD
   - GitHub (for developer accounts)

### Low Priority

9. **API Key Generation**
   - For programmatic access
   - Scoped permissions
   - Rate limiting per key

10. **Advanced Audit Logging**
    - Log all login attempts (success/failure)
    - Track IP addresses, user agents
    - Anomaly detection (new device, new location)

11. **Permission Caching**
    - Cache resolved permissions in Redis
    - Invalidate on permission changes
    - Reduces DB queries on every request

12. **Account Recovery Questions**
    - Security questions for account recovery
    - Alternative to email-only reset

---

## Dependencies

- **bcryptjs**: Password hashing (v2.4.3)
- **jsonwebtoken**: JWT token generation/validation (v9.0.2)
- **zod**: Request validation (v3.23.8)
- **@prisma/client**: Database access (v5.22.0)

---

## Configuration

Environment variables in `.env`:
```bash
JWT_SECRET=your-super-secret-key-change-this-in-production
JWT_EXPIRY=604800  # 7 days in seconds
```

---

## Testing Recommendations

1. **Unit Tests**
   - Password hashing/verification
   - JWT token generation/validation
   - Permission calculation logic

2. **Integration Tests**
   - Login flow (success/failure cases)
   - Registration with tenant creation
   - Trial expiration enforcement
   - Subscription expiration enforcement

3. **Security Tests**
   - SQL injection in login
   - XSS in profile fields
   - Brute force login attempts
   - Token validation edge cases

---

## Related Modules

- **Middleware**: `authMiddleware`, `requirePermission`
- **Audit Logging**: Should log auth events (not currently implemented)
- **Tenant Management**: Tenant status affects login
- **Super Admin**: Can manage all tenants

---

## Migration Path

To improve security:

1. **Immediate** (Week 1):
   - Add rate limiting on login endpoint
   - Implement password strength validation
   - Add file type validation on profile picture upload

2. **Short-term** (Month 1):
   - Implement token refresh mechanism
   - Add email verification on registration
   - Create password reset flow

3. **Long-term** (Quarter 1):
   - Implement 2FA
   - Add OAuth providers
   - Build session management dashboard
   - Implement comprehensive audit logging
