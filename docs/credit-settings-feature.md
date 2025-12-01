# Credit Settings Feature

The Credit Settings feature allows administrators to configure various aspects of the platform's credit system. These settings control how credits are awarded, consumed, and managed for users, including sign-up bonuses, referral rewards, and low-balance alerts.

The configuration interface is located in the **Admin -> Credit Settings** tab and is composed of several modular forms.

## Form Components

The credit settings interface is aggregated by the `AdminCreditForms` component, which organizes the following individual forms into a responsive grid layout.

### 1. Signup Credit Form (`SignupCreditForm.tsx`)

Configures the number of credits awarded to new users upon registration.

*   **Field:** `Signup Credits` (Number input)
*   **Option:** `Monthly` (Checkbox) - If checked, the credits are awarded as a monthly recurring allowance. If unchecked, it is a one-time award.
*   **Validation:**
    *   Minimum: 0
    *   Maximum: 100,000
    *   Must be a whole number.
*   **Behavior:**
    *   Debounced input validation.
    *   Displays a warning confirmation dialog for "significant changes" (difference >= 1000 credits or toggling the monthly status).
    *   Updates the `signupCreditAmount` and `monthlySignUpCredit` settings in the backend.

### 2. Credit Adjustment Form (`CreditAdjustmentForm.tsx`)

Allows administrators to manually add or remove credits from all users globally. *Note: This is an action form, not a persistent setting.*

*   **Functionality:** Triggers a batch job to adjust user credit balances.
*   **Usage:** Typically used for compensation, promotions, or correcting system-wide issues.

### 3. Referral Credit Form (`ReferralCreditForm.tsx`)

Sets the number of credits a user receives when they successfully refer a new user to the platform.

*   **Field:** `Referral Credits` (Number input)
*   **Validation:**
    *   Minimum: 0
    *   Maximum: 10,000
*   **Behavior:** Updates the `referralCreditAmount` setting.

### 4. Low Credit Form (`LowCreditForm.tsx`)

Configures the threshold for sending low-balance alerts to users.

*   **Field:** `Low Credit Threshold` (Number input)
*   **Validation:**
    *   Minimum: 0
    *   Maximum: 100,000
*   **Behavior:**
    *   When a user's credit balance falls below this amount, the system (via a daily scheduled job) sends an email notification.
    *   Updates the `lowCreditTriggerAmount` setting.

### 5. Price Per Credit Form (`PricePerCreditForm.tsx`)

Defines the conversion rate between currency units and platform credits. This is used to calculate project costs.

*   **Field:** `Credits per Unit` (Number input)
*   **Validation:**
    *   Minimum: 0.01
    *   Maximum: 1,000,000
    *   Supports up to 2 decimal places.
*   **Behavior:** Updates the `creditsPerUnit` setting.

### 6. Refresh Interval Form (`RefreshIntervalForm.tsx`)

Sets the frequency (in hours) at which the system calculates and deducts credits for running projects.

*   **Field:** `Refresh Interval (Hours)` (Number input)
*   **Validation:**
    *   Minimum: 1 hour
    *   Maximum: 168 hours (1 week)
*   **Behavior:** Updates the `refreshInterval` setting used by the credit deduction Cloud Function.

### 7. Agent Revenue Share Form (`AgentRevenueShareForm.tsx`)

Configures the percentage of revenue shared with Agents for users they refer.

*   **Field:** `Agent Revenue Share %` (Number input)
*   **Validation:**
    *   Minimum: 0%
    *   Maximum: 100%
*   **Behavior:** Updates the `agentRevenueSharePercentage` setting.

### 8. Partner Revenue Share Form (`PartnerRevenueShareForm.tsx`)

Configures the percentage of revenue shared with Partners for modules they publish.

*   **Field:** `Partner Revenue Share %` (Number input)
*   **Validation:**
    *   Minimum: 0%
    *   Maximum: 100%
*   **Behavior:** Updates the `partnerRevenueSharePercentage` setting.

### 9. Max Referrals Form (`MaxReferralsForm.tsx`)

Limits the maximum number of successful referrals a single user can be credited for.

*   **Field:** `Max Referrals` (Number input)
*   **Validation:**
    *   Minimum: 0
    *   Maximum: 1,000
*   **Behavior:** Updates the `maximumReferrals` setting.

## Technical Implementation

*   **State Management:** The forms use local React state for input handling and rely on the global `useStore` (Zustand) and `fetchSettings` callbacks to synchronize with the backend.
*   **API Interaction:** All settings (except manual adjustments) are persisted via `POST` requests to the `/api/settings` endpoint.
*   **Validation:**
    *   Client-side validation ensures inputs are within safe ranges and formats.
    *   Debouncing (300ms) is used to prevent excessive validation calls and UI flickering.
    *   Rate limiting (2000ms cooldown) prevents accidental double-submissions.
*   **Error Handling:**
    *   User-friendly error messages are displayed for network issues or API failures.
    *   Invalid inputs are highlighted with visual cues (red borders, error text).
*   **Accessibility:** Forms are designed with screen reader support (ARIA labels, status announcements) and keyboard navigation.

## Usage

1.  Navigate to the **Admin** dashboard.
2.  Select the **Credit Settings** tab.
3.  Modify the desired values in the respective forms.
4.  Click the **Set** or **Save** button (e.g., "Set Amount", "Set Price").
5.  A success notification will appear upon successful update.
