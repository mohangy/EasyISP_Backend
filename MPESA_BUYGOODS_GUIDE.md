# M-Pesa BuyGoods Integration Guide

## Overview

The EasyISP Backend now supports M-Pesa BuyGoods (Till Numbers) in addition to PayBill and Bank integrations. This guide explains how to configure and use the BuyGoods feature.

## What is BuyGoods?

BuyGoods is M-Pesa's merchant payment service that uses a **Till Number** instead of a PayBill number. Key differences:

- **PayBill**: Uses a business shortcode (paybill number)
- **BuyGoods**: Uses a Till Number for the merchant, plus a Store Number (Head Office) for API operations
- **Bank**: Uses a bank paybill with a target account number

## Configuration Requirements

### For BuyGoods Till Number Configuration:

1. **Till Number** (shortcode): Your BuyGoods till number
2. **Store Number**: Your BuyGoods Head Office/Store number (required for STK Push)
3. **Consumer Key**: Daraja API consumer key
4. **Consumer Secret**: Daraja API consumer secret
5. **Passkey**: Lipa Na M-Pesa Online passkey
6. **Environment**: `sandbox` or `production`

## Default Configuration (System-wide)

The system administrator can configure default BuyGoods **API credentials** that will be used when tenants don't provide their own. This is configured via environment variables:

**Important Note:** Only the API credentials (Consumer Key, Consumer Secret, Passkey) can use defaults. The Till Number and Store Number are **tenant-specific** and must always be provided by each tenant.

```bash
# Add to your .env file
# These are ONLY for API credentials, NOT for till/store numbers
MPESA_BUYGOODS_CONSUMER_KEY=your-buygoods-consumer-key
MPESA_BUYGOODS_CONSUMER_SECRET=your-buygoods-consumer-secret
MPESA_BUYGOODS_PASSKEY=your-buygoods-passkey
```

### How Default Configuration Works

1. When a tenant creates a BuyGoods gateway, they **must** provide:
   - Their Till Number (shortcode)
   - Their Store Number (Head Office number)

2. If they don't provide API credentials (Consumer Key, Secret, Passkey):
   - The system automatically uses default credentials from environment variables
   - This allows tenants to use the system's API app without their own Daraja app

3. Tenants can still provide their own API credentials to override defaults

## Setting Up BuyGoods Gateway

### Via API

**Create a new BuyGoods gateway:**

```bash
POST /api/payment-gateways
Content-Type: application/json
Authorization: Bearer <token>

{
  "type": "MPESA_API",
  "subType": "BUYGOODS",
  "name": "My Till Number",
  "shortcode": "123456",           # Your Till Number
  "storeNumber": "654321",         # Your Store/Head Office Number
  "consumerKey": "your-key",       # Optional if using defaults
  "consumerSecret": "your-secret", # Optional if using defaults
  "passkey": "your-passkey",       # Optional if using defaults
  "env": "production",
  "forHotspot": true,
  "forPppoe": false
}
```

**Using Default API Credentials (Minimal Setup):**

If your system administrator has configured default API credentials, tenants can set up their gateway with just their till and store numbers:

```bash
POST /api/payment-gateways
Content-Type: application/json
Authorization: Bearer <token>

{
  "type": "MPESA_API",
  "subType": "BUYGOODS",
  "name": "My Till Number",
  "shortcode": "123456",      # Your Till Number (required, tenant-specific)
  "storeNumber": "654321",    # Your Store/Head Office Number (required, tenant-specific)
  "env": "production",
  "forHotspot": true
}
```

In this case, the system will use default API credentials (Consumer Key, Secret, Passkey) from environment variables.

## How BuyGoods STK Push Works

When initiating an STK Push with BuyGoods:

1. **BusinessShortCode**: Uses the Store Number (Head Office)
2. **PartyB**: Uses the Till Number
3. **TransactionType**: Set to `CustomerBuyGoodsOnline`
4. **Password**: Generated using BusinessShortCode + Passkey + Timestamp

This differs from PayBill where both BusinessShortCode and PartyB use the same paybill number.

## Validation

The system validates BuyGoods configuration to ensure:

- Till Number (shortcode) is provided
- Store Number is provided (required for STK Push)
- Consumer Key and Consumer Secret are provided (or available from defaults)
- Passkey is provided (or available from defaults)
- Callback URL is configured

### Testing Your Configuration

Test your gateway connection:

```bash
POST /api/payment-gateways/:id/test
Authorization: Bearer <token>
```

This will attempt to get an OAuth token from M-Pesa to verify credentials.

## Migration from Legacy Configuration

If you have existing M-Pesa configuration in the Tenant model, it will be automatically migrated to the PaymentGateway model on first access.

## Troubleshooting

### "Store Number is required for BuyGoods STK Push"

**Solution**: Add the `storeNumber` field to your gateway configuration. This is your BuyGoods Head Office number.

### "Consumer Key/Secret/Passkey is required"

**Solutions**:
1. Provide the credentials in the gateway configuration
2. OR configure system-wide defaults in environment variables
3. Check that credentials are not empty strings

### STK Push Fails with "Invalid Access Token"

**Solutions**:
1. Verify your Consumer Key and Consumer Secret are correct
2. Ensure you're using the correct environment (sandbox vs production)
3. Test the connection using the `/test` endpoint

### Transaction Type Error

If you see errors about transaction types:
- **BuyGoods**: Should use `CustomerBuyGoodsOnline`
- **PayBill**: Should use `CustomerPayBillOnline`

The system automatically sets the correct transaction type based on `subType`.

## API Reference

### Daraja API Documentation

For the latest M-Pesa Daraja API documentation, visit:
- Production: https://developer.safaricom.co.ke/
- Sandbox: https://sandbox.safaricom.co.ke/

### Key Endpoints

- **OAuth**: `/oauth/v1/generate?grant_type=client_credentials`
- **STK Push**: `/mpesa/stkpush/v1/processrequest`
- **STK Query**: `/mpesa/stkpushquery/v1/query`

## Security Considerations

1. **Never commit credentials to version control**
2. **Use environment variables for default configurations**
3. **Rotate credentials regularly**
4. **Use production credentials only in production environment**
5. **Validate callback requests to prevent replay attacks**
6. **The system automatically validates transaction amounts against package prices**

## Best Practices

1. **Test in sandbox first**: Always test your configuration in sandbox before using production
2. **Set appropriate gateway names**: Use descriptive names to distinguish between multiple gateways
3. **Configure callback URLs correctly**: Ensure your callback URL is publicly accessible
4. **Monitor logs**: Check application logs for M-Pesa transaction details
5. **Keep credentials secure**: Store credentials in environment variables, not in database for defaults

## Support

For M-Pesa Daraja API support:
- Email: apisupport@safaricom.co.ke
- Portal: https://developer.safaricom.co.ke/support

For EasyISP Backend support:
- Check application logs for detailed error messages
- Use the `/test` endpoint to verify gateway configuration
- Review this documentation for common issues
