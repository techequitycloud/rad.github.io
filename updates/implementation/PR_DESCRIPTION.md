# Pull Request: Enable Flutterwave Mobile Money, Bank Transfer, and USSD Payment Options

## Summary

Enables all available Flutterwave payment methods (mobile money, bank transfer, USSD, and account payments) in addition to card payments for both credit purchases and subscriptions.

### Problem
Users selecting "Pay with Flutterwave" only saw credit card payment options. Mobile money, bank transfer, USSD, and account payment methods were not available.

### Root Cause
The `payment_options` parameter was not being passed to the Flutterwave API when creating payment links. Without this parameter, Flutterwave defaults to showing only card payments.

### Solution
Added `payment_options: 'card,mobilemoney,banktransfer,ussd,account'` to all Flutterwave payment link creation calls.

## Changes Made

### Code Changes
1. **rad-ui/webapp/src/utils/flutterwave.ts**
   - Added `payment_options` parameter to `createPaymentLink()` function signature
   - Added `payment_options` parameter to `createSubscriptionPaymentLink()` function signature
   - Added debug logging to track parameter usage

2. **rad-ui/webapp/src/pages/api/flutterwave/checkout-session.ts**
   - Added `payment_options: 'card,mobilemoney,banktransfer,ussd,account'` when creating payment links
   - Added comprehensive debug logging for troubleshooting

3. **rad-ui/webapp/src/pages/api/flutterwave/subscription-checkout.ts**
   - Added `payment_options: 'card,mobilemoney,banktransfer,ussd,account'` for subscription checkouts

### Documentation
4. **FLUTTERWAVE_PAYMENT_OPTIONS.md** (new file)
   - Comprehensive configuration guide
   - Critical requirement: Must disable "Enable Dashboard Payment Options" in Flutterwave dashboard
   - Payment method availability by currency
   - Debugging and troubleshooting steps

## Payment Methods Enabled

✅ **Card** - Credit/Debit cards (all currencies)
✅ **Mobile Money** - MTN, Airtel, Vodafone, M-Pesa, etc. (NGN, KES, GHS, UGX, RWF, TZS, ZMW)
✅ **Bank Transfer** - Direct bank transfers (NGN only)
✅ **USSD** - USSD banking codes (NGN only)
✅ **Account** - Bank account payments (NGN, KES, GHS, ZAR)

Flutterwave automatically filters these options based on the selected currency.

## ⚠️ Critical Configuration Required

**The `payment_options` API parameter only works if you disable "Enable Dashboard Payment Options" in your Flutterwave Account Settings.**

### Required Steps After Deployment:

1. Log in to [Flutterwave Dashboard](https://dashboard.flutterwave.com/)
2. Go to **Settings** → **Account Settings**
3. Find **"Enable Dashboard Payment Options"**
4. **Uncheck/Disable** this setting
5. Save changes

Without this step, Flutterwave will ignore the API parameter and use dashboard settings instead.

### Alternative: Configure in Dashboard

If you prefer to keep "Enable Dashboard Payment Options" enabled:

1. Keep the setting checked
2. Go to **Settings** → **Payment Options**
3. Manually enable: Card, Mobile Money, Bank Transfer, USSD, Account
4. Save changes

(The API parameter will be ignored, but dashboard settings will apply)

## Testing

### Before Testing
1. ✅ Deploy this PR
2. ✅ Rebuild and restart the application (`npm run build && npm start`)
3. ✅ Disable "Enable Dashboard Payment Options" in Flutterwave dashboard
4. ✅ Clear browser cache

### Test Plan
- [ ] Test credit purchase with NGN currency - should show all payment options
- [ ] Test credit purchase with KES currency - should show card, mobile money, account
- [ ] Test credit purchase with USD currency - should show card
- [ ] Test subscription purchase with NGN - should show all payment options
- [ ] Verify payment completion with mobile money (if available)
- [ ] Verify payment completion with bank transfer (if available)

### Expected Logs
After deployment, server logs should show:
```
[flutterwave.ts] createPaymentLink called with payment_options: card,mobilemoney,banktransfer,ussd,account
[Flutterwave] Creating payment link with params: { ... payment_options: 'card,mobilemoney,banktransfer,ussd,account' ... }
[Flutterwave] Payment link response: { status: 'success', hasLink: true }
[Flutterwave] Returning payment URL: https://checkout.flutterwave.com/...
```

## Files Changed

```
 FLUTTERWAVE_PAYMENT_OPTIONS.md                                | 138 ++++++++++++++++++++++++++++++++++++++
 rad-ui/webapp/src/pages/api/flutterwave/checkout-session.ts   |  22 +++++-
 rad-ui/webapp/src/pages/api/flutterwave/subscription-checkout.ts |   2 +
 rad-ui/webapp/src/utils/flutterwave.ts                        |   7 +-
 4 files changed, 165 insertions(+), 4 deletions(-)
```

## Impact

### User Impact
- Users can now pay with mobile money (M-Pesa, MTN, Airtel, etc.)
- Users can pay with bank transfer (Nigeria)
- Users can pay with USSD banking codes (Nigeria)
- Better payment experience for African users
- More payment options = higher conversion rates

### Technical Impact
- No breaking changes
- Backward compatible (existing behavior preserved if dashboard controls payment options)
- Added debug logging for easier troubleshooting
- Changes limited to Flutterwave integration only

## Security Considerations

- No security concerns introduced
- Uses existing Flutterwave API security
- All payment processing handled by Flutterwave
- No changes to authentication or authorization

## References

- [Flutterwave Payment Methods Documentation](https://developer.flutterwave.com/docs/payment-methods)
- [Flutterwave Mobile Money Documentation](https://developer.flutterwave.com/docs/mobile-money)
- [Flutterwave Bank Transfer Documentation](https://developer.flutterwave.com/docs/bank-transfer)

## Rollback Plan

If issues occur:
1. Revert this PR
2. Or set `payment_options: 'card'` to show only card payments
3. The changes are backward compatible - if parameter is ignored, behavior is same as before

## Branch
`claude/add-flutterwave-mobile-money-ZOPRy`

## Commits
- `1ffbf1f` - Add mobile money and bank transfer payment options to Flutterwave
- `4dfb251` - Add debug logging for Flutterwave payment_options parameter
- `f31707a` - Add comprehensive Flutterwave payment options configuration guide
