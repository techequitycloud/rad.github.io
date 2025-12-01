# Help & Support Technical Documentation

## 1. Overview

The Help & Support section is designed to provide users with guidance, support, and referral options. It features a dynamic, tabbed interface that adapts its content based on the authenticated user's role.

The main component for this feature is `Help.tsx`, located in `rad-ui/webapp/src/routes/`. This component manages the tabbed navigation, fetches and displays documentation, and conditionally renders different forms for support and user invitations.

## 2. User Guides

### 2.1. Available Guides

The Help section provides the following user guides:

-   **User Guide:** General information for all authenticated users.
-   **Partner Guide:** Specific information for users with the "partner" role.
-   **Admin Guide:** Documentation for administrators.
-   **Agent Guide:** Information for users with the "agent" role.

### 2.2. Content Source

The content for these guides is stored in markdown files located in the `rad-ui/webapp/public/docs/` directory:

-   `user-guide.md`
-   `partner-guide.md`
-   `admin-guide.md`
-   `agent-guide.md`

These files are served by a dedicated API endpoint at `/api/docs`, which is implemented in `rad-ui/webapp/src/pages/api/docs.ts`. The `Help.tsx` component fetches the content of the appropriate markdown file based on the selected tab and renders it using the `react-markdown` library.

### 2.3. Visibility and Access Control

The visibility of the guide tabs is determined by the user's role. The `Help.tsx` component retrieves the user's roles (isAdmin, isPartner, isAgent) from the Zustand store and filters the tabs accordingly.

-   **User Guide:** Visible to all authenticated users.
-   **Partner Guide:** Visible to users with the "partner" or "admin" role.
-   **Admin Guide:** Visible only to users with the "admin" role.
-   **Agent Guide:** Visible to users with the "agent" or "admin" role.
-   **Support Tab:** Visible to all authenticated users.

## 3. Support and Referral Features

### 3.1. Support Form

The **Support** tab provides a way for users to contact support, with the implementation differing based on the user's role:

-   **For non-admin users:** The `SupportForm.tsx` component is rendered. This is a simple form with a textarea for the message. Upon submission, it sends a POST request to the `/api/support/contact` endpoint. It uses Formik for form management and Yup for validation.
-   **For admin users:** The `SendMessageForm.tsx` component is rendered, which is a more advanced form that allows administrators to send messages to all users.

### 3.2. Referral and User Invitation

For non-admin users, the **Support** tab also displays the `InviteUserForm.tsx` component, which implements the user referral feature.

-   **Referral Link Generation:** It generates a unique referral link for the currently logged-in user by appending their user ID as a query parameter (`?ref=<user-id>`) to the application's origin URL.
-   **QR Code:** The referral link is displayed as a QR code using the `qrcode.react` library, making it easy to share on mobile devices.
-   **Sharing Options:**
    -   **Copy Link:** A button allows the user to copy the referral link to their clipboard.
    -   **Invite User:** This button triggers the browser's native share functionality (`navigator.share`) to share the referral link through other applications. If the native share API is not available, it defaults to copying the link to the clipboard.

## 4. ROI Calculator

The Help page also integrates the `ROICalculator` component.

-   **Location:** `rad-ui/webapp/src/components/ROICalculator.tsx`
-   **Purpose:** To help users estimate the potential cost and time savings of using the platform.
-   **Interactive Elements:** Sliders allow users to input their current operational metrics (number of deployments, manual time per deployment, engineer cost).
-   **Calculation:** It computes the "Net Monthly Savings" in real-time and displays the results.
