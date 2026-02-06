# Flutterwave Payment Options Configuration

## Issue
Users only see credit card payment options when using Flutterwave, even though mobile money and bank transfer are enabled in the code.

## Root Cause
Flutterwave's `payment_options` API parameter **only works if you disable dashboard payment options** in your Flutterwave account settings.

## Solution

### Step 1: Update Flutterwave Dashboard Settings

1. Log in to your [Flutterwave Dashboard](https://dashboard.flutterwave.com/)
2. Go to **Settings** → **Account Settings**
3. Find the **"Enable Dashboard Payment Options"** setting
4. **Uncheck/Disable** this option
5. Save your changes

**Why this is necessary:** When "Enable Dashboard Payment Options" is enabled, Flutterwave ignores the `payment_options` parameter from the API and uses the dashboard configuration instead.

### Step 2: Configure Payment Methods in Dashboard (Alternative)

If you prefer to use dashboard configuration instead of API parameters:

1. Keep **"Enable Dashboard Payment Options"** checked
2. Go to **Settings** → **Payment Options**
3. Enable the payment methods you want:
   - ✅ Card
   - ✅ Mobile Money
   - ✅ Bank Transfer
   - ✅ USSD
   - ✅ Account

### Step 3: Rebuild and Deploy Application

After making changes to the code, rebuild and redeploy:

```bash
# For development
npm run dev

# For production build
npm run build
npm start
```

## Available Payment Methods

The code now includes all available Flutterwave payment options:

```typescript
payment_options: 'card,mobilemoney,banktransfer,ussd,account'
```

### Payment Method Availability by Currency

| Payment Method | Currencies |
|---------------|------------|
| Card | All currencies |
| Mobile Money | NGN, KES, GHS, UGX, RWF, TZS, ZMW |
| Bank Transfer | NGN (Nigeria only) |
| USSD | NGN (Nigeria only) |
| Account | NGN, KES, GHS, ZAR |

Flutterwave automatically filters payment methods based on the selected currency.

## Code Changes Made

### Files Modified

1. **rad-ui/webapp/src/utils/flutterwave.ts**
   - Added `payment_options` parameter to `createPaymentLink()` function
   - Added `payment_options` parameter to `createSubscriptionPaymentLink()` function

2. **rad-ui/webapp/src/pages/api/flutterwave/checkout-session.ts**
   - Added `payment_options: 'card,mobilemoney,banktransfer,ussd,account'` to payment link creation

3. **rad-ui/webapp/src/pages/api/flutterwave/subscription-checkout.ts**
   - Added `payment_options: 'card,mobilemoney,banktransfer,ussd,account'` to subscription checkout

## Debugging

### Check Logs

After rebuilding, check your application logs for:

```
[flutterwave.ts] createPaymentLink called with payment_options: card,mobilemoney,banktransfer,ussd,account
[Flutterwave] Creating payment link with params: ...
[Flutterwave] Payment link response: ...
```

### Verify API Request

The request to Flutterwave should include:

```json
{
  "amount": 100,
  "currency": "NGN",
  "tx_ref": "rad_fw_...",
  "payment_options": "card,mobilemoney,banktransfer,ussd,account",
  "customer": { ... },
  "customizations": { ... },
  "meta": { ... }
}
```

## References

- [Flutterwave Payment Methods Documentation](https://developer.flutterwave.com/docs/payment-methods)
- [Flutterwave Standard Payment Forum Discussion](https://forum.flutterwave.com/t/payment-options-only-one-visible-in-my-live/1200)

## Troubleshooting

### Still Only Seeing Card Options?

1. ✅ Verify "Enable Dashboard Payment Options" is **disabled** in Flutterwave dashboard
2. ✅ Confirm application has been rebuilt and redeployed
3. ✅ Check server logs for the `payment_options` parameter in API requests
4. ✅ Clear browser cache and try again
5. ✅ Verify your Flutterwave account has the payment methods enabled for your business

### Testing

To test different payment methods:

- **NGN (Nigeria)**: Should show all options (card, mobile money, bank transfer, USSD, account)
- **KES (Kenya)**: Should show card, mobile money (M-Pesa), account
- **GHS (Ghana)**: Should show card, mobile money (MTN, Vodafone, AirtelTigo), account
- **USD**: Should show card and possibly account (limited options)

## Next Steps

1. Disable "Enable Dashboard Payment Options" in Flutterwave dashboard
2. Rebuild and redeploy the application
3. Test credit purchase with different currencies
4. Verify all payment methods appear as expected
