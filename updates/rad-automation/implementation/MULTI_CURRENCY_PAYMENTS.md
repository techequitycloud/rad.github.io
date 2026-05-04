# Multi-Currency Payment Support

This document describes the multi-currency payment feature that allows users to pay in their preferred currency while maintaining USD as the base currency for internal accounting.

## Overview

The multi-currency payment feature enables users to:
1. **Select their preferred payment currency** from a list of supported currencies
2. **View the USD equivalent** of their payment amount in real-time
3. **Pay in their local currency** through Flutterwave
4. **Receive credits based on USD amount** for consistent internal accounting

## Supported Currencies

The following currencies are supported through Flutterwave:
- USD (US Dollar)
- EUR (Euro)
- GBP (British Pound)
- NGN (Nigerian Naira)
- GHS (Ghanaian Cedi)
- KES (Kenyan Shilling)
- ZAR (South African Rand)
- TZS (Tanzanian Shilling)
- UGX (Ugandan Shilling)
- RWF (Rwandan Franc)
- XAF (Central African CFA Franc)
- XOF (West African CFA Franc)

## Architecture

### Components

#### 1. Exchange Rates Management (`/src/utils/exchange-rates.ts`)
- Fetches exchange rates from exchangerate-api.com (free API)
- Stores rates in Firestore settings collection
- Provides currency conversion utilities
- Caches rates for 24 hours

#### 2. Exchange Rates API Endpoints
- **GET `/api/exchange-rates`** - Retrieves current exchange rates (with 24h cache)
- **POST `/api/exchange-rates/sync`** - Manually syncs fresh exchange rates (admin only)

#### 3. Buy Credits Form (`/src/components/forms/BuyCreditsForm.tsx`)
- Currency selector dropdown
- Real-time USD equivalent display
- Automatic credits calculation based on USD amount
- Multi-currency payment provider support

#### 4. Checkout Session API (`/src/pages/api/flutterwave/checkout-session.ts`)
- Accepts both local currency amount and USD amount
- Calculates credits based on USD amount
- Sends local currency amount to Flutterwave
- Stores both amounts in transaction metadata

#### 5. Webhook Handler (`/src/pages/api/flutterwave/webhook.ts`)
- Extracts USD amount from transaction metadata
- Verifies amounts against USD equivalent
- Stores both local and USD amounts in credit transactions
- Uses USD amount for internal accounting

#### 6. Cloud Function (`/automation/terraform/infrastructure/function/credit_currency/`)
- Automatically syncs both currency codes and exchange rates daily via Cloud Scheduler
- Calls both the currency sync and exchange rates sync API endpoints in parallel
- Uses secure token authentication from Secret Manager (`currency-sync-token`)
- Existing function extended to handle exchange rates in addition to currency codes

## Payment Flow

1. **User selects currency** in Buy Credits form
2. **User enters amount** in selected currency
3. **System displays USD equivalent** using current exchange rates
4. **System calculates credits** based on USD amount (consistent with creditsPerUnit setting)
5. **User submits payment**
6. **Checkout session created** with:
   - Local currency amount (sent to Flutterwave)
   - USD amount (for internal accounting)
   - Both amounts stored in metadata
7. **User completes payment** on Flutterwave in their selected currency
8. **Webhook receives payment confirmation**
9. **System verifies USD amount** matches expected value
10. **Credits added to user account** based on USD amount
11. **Transaction recorded** with both local and USD amounts

## Data Storage

### Firestore Settings Document
```typescript
{
  exchange_rates: {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    NGN: 1650,
    // ... other currencies
  },
  exchange_rates_last_updated: 1704412800000 // Timestamp
}
```

### Credit Transaction Document
```typescript
{
  userId: string,
  credits: number,
  amountPaid: number,        // Local currency amount
  currency: string,          // Local currency code
  amountUSD: number,         // USD equivalent (for accounting)
  localCurrency: string,     // Local currency code (duplicate for clarity)
  localAmount: number,       // Local currency amount (duplicate for clarity)
  provider: 'flutterwave',
  // ... other fields
}
```

## Configuration

### Environment Variables

The exchange rates sync uses the existing currency sync token. Ensure this environment variable is set:

```bash
# Currency Sync Cron Token (used for both currency and exchange rates sync)
CURRENCY_SYNC_CRON_TOKEN=your-secure-random-token
```

**Note**: Both the currency sync and exchange rates sync use the **same token** for authentication.

### Secret Manager

The exchange rates sync uses the existing secret. Ensure it exists:
```bash
# Verify the secret exists
gcloud secrets describe currency-sync-token

# If not, create it:
gcloud secrets create currency-sync-token \
  --data-file=- <<< "your-secure-random-token"
```

### Cloud Scheduler

**No additional configuration needed!** The exchange rates sync is automatically handled by the existing `credit-currency` Cloud Scheduler job which runs daily at 1 AM UTC. This job now:
1. Syncs currency codes from Google Cloud Billing
2. Syncs exchange rates from exchangerate-api.com

Both operations run in parallel for efficiency. The scheduler is already configured via Terraform:
- **Schedule**: Daily at 1 AM UTC (`0 1 * * *`)
- **Function**: `credit_currency`
- **Timeout**: 540 seconds
- **Retry**: 3 attempts with exponential backoff

## Exchange Rate API

The system uses [exchangerate-api.com](https://www.exchangerate-api.com/), a free exchange rate API that:
- Provides real-time exchange rates
- Doesn't require API key for basic usage
- Updates rates daily
- Covers all major currencies

**Note:** For production use with high traffic, consider upgrading to a paid tier or using an alternative API like:
- Open Exchange Rates
- Fixer.io
- Currency API

## Manual Exchange Rate Sync

Administrators can manually sync exchange rates:

1. Navigate to Admin Settings
2. Call POST `/api/exchange-rates/sync`
3. Or use the Cloud Function trigger

## Testing

### Test Currency Conversion
1. Select a non-USD currency in the Buy Credits form
2. Enter an amount (e.g., 100 NGN)
3. Verify USD equivalent is displayed correctly
4. Verify credits calculation matches USD amount × creditsPerUnit

### Test Payment Flow
1. Complete a test payment in a non-USD currency
2. Verify payment is processed in the selected currency
3. Check transaction record includes both amounts:
   - `amountPaid` and `currency` (local currency)
   - `amountUSD` (USD equivalent)
4. Verify credits match USD amount × creditsPerUnit

## Troubleshooting

### Exchange rates not loading
- Check `/api/exchange-rates` endpoint
- Verify API connectivity to exchangerate-api.com
- Check Firestore settings document has `exchange_rates` field

### Incorrect USD equivalent
- Verify exchange rates are up to date
- Check `exchange_rates_last_updated` timestamp
- Manually trigger sync if rates are stale

### Credits calculation mismatch
- Verify `creditsPerUnit` setting in Firestore
- Check `amountUSD` is being passed correctly
- Review checkout session API logs

### Webhook amount verification fails
- Check metadata includes `amountUSD`
- Verify tolerance (0.5%) allows for rounding
- Review webhook logs for actual vs expected amounts

## Future Enhancements

1. **Stripe Multi-Currency Support** - Extend to Stripe payments
2. **Paystack Multi-Currency Support** - Extend to Paystack payments
3. **Currency-Specific Pricing** - Allow different pricing per currency
4. **Exchange Rate Fallback** - Secondary API if primary fails
5. **Historical Exchange Rates** - Track rate changes over time
6. **Admin Dashboard** - UI for viewing and managing exchange rates

## Security Considerations

1. **Rate Verification** - Webhook verifies amounts with 0.5% tolerance
2. **Token Authentication** - Cloud Function uses secure token
3. **Metadata Validation** - All transaction metadata is validated
4. **Idempotency** - Prevents duplicate charges
5. **Amount Matching** - USD amounts verified against expected values

## Performance

- Exchange rates cached for 24 hours
- Firestore settings cached with TTL
- Minimal overhead on payment flow
- Automatic cleanup of stale rates

## Compliance

- Supports multi-currency requirements for global customers
- Maintains USD as base currency for accounting
- Records both local and USD amounts for auditing
- Complies with payment processor requirements
