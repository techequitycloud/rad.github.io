# Invite Friends Feature

## Overview

The "Invite Friends" feature allows users to refer others to the platform using a unique referral code. This incentivizes user growth by rewarding referrers with credits when their invited friends sign up. The system includes configurable rewards, monthly limits, and an easy-to-use sharing interface.

## User Experience

Users can access the "Invite Friends" feature through the **Help** tab in the application.

### Finding the Invite Tool
1. Navigate to the **Help** section in the main menu.
2. If the feature is enabled (see [Admin Configuration](#admin-configuration)), an "Invite Friends" card will be displayed alongside the support form.

### Sharing a Referral
The "Invite Friends" card provides several tools for sharing:
*   **Referral Link**: A unique URL (e.g., `https://platform.com/?ref=CODE`) that automatically tracks the referral.
*   **QR Code**: A scannable code for mobile sharing.
*   **Copy Link Button**: Quickly copies the referral link to the clipboard.
*   **Share Button**: Uses the device's native sharing menu (on supported browsers/devices) to send the link via email, SMS, or social media.

### Tracking Progress
The interface displays a progress bar showing the user's current referral count against the monthly limit.
*   **Green**: Active and available.
*   **Yellow**: Approaching the monthly limit.
*   **Red**: Limit reached (sharing is disabled until the next month).

## Admin Configuration

Administrators can manage the "Invite Friends" feature via the **Credit Settings** tab in the Admin Dashboard.

### 1. Referral Credits
The **Referral Credit Form** allows admins to set the number of credits awarded to a referrer for each successful signup.
*   **Configuration**: Enter the amount of credits to award.
*   **Effect**: When a new user signs up with a valid referral code, the referrer's account is credited with this amount.

### 2. Maximum Referrals
The **Maximum Referrals Form** controls the monthly limit on referrals per user.
*   **Disabled (`0`)**: Completely hides the "Invite Friends" feature from all users.
*   **Unlimited (`-1`)**: Allows users to refer an unlimited number of friends.
*   **Limited (e.g., `5`)**: Sets a specific cap on the number of rewarded referrals a user can make per month. Once reached, the user cannot refer more people until the count resets on the 1st of the next month.

## Reward System

The reward logic is handled automatically by the system:

1.  **Code Generation**: Every user is assigned a unique referral code.
2.  **Attribution**: When a new user visits the platform using a referral link (e.g., `?ref=CODE`), the system identifies the referrer.
3.  **Signup & Reward**:
    *   The new user completes the sign-up process.
    *   The system verifies that the referrer exists and hasn't reached their monthly limit.
    *   The configured **Referral Credit Amount** is added to the referrer's `creditAwards` balance.
    *   A transaction record is created in `credit_transactions` for auditing.
    *   The relationship is logged in `referral_analytics`.

## Limits & Controls

To prevent abuse and manage costs, the system includes:
*   **Monthly Limits**: Referrals are tracked on a monthly basis. Usage counts are reset automatically at the beginning of each month.
*   **Self-Referral Prevention**: Users cannot refer themselves.
*   **Rate Limiting**: The sharing interface includes cool-down periods to prevent spamming.
