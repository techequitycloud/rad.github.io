# Support Features

## 1. Introduction

The RAD platform features a centralized **Help Center** designed to provide role-specific support tools and documentation. Located at the `/help` route, this system dynamically adapts its interface based on the user's role (Admin, User, Partner, Agent, or Finance), ensuring that everyone has access to the appropriate resources without clutter.

## 2. Architecture & Access Control

The support interface is built using a tabbed navigation system that conditionally renders content:

*   **Support Tab:** The primary hub for communication.
    *   **Admins** see a **Message Center** to broadcast updates to users.
    *   **Users & Partners** see a **Support Form** to submit tickets.
    *   **Agents** see the Support Form plus an **Invite User** form (if enabled).
*   **Documentation Tabs:** Role-specific guides (e.g., *Admin Guide*, *Partner Guide*) are loaded dynamically from Markdown files.
*   **Tools:** Utilities like the **ROI Calculator** are available to all users.

## 3. Feature Breakdown

### 3.1. User Support Form
*Accessible to: Users, Partners, Agents*

The `SupportForm` component provides a structured way for users to request assistance.

*   **Categorization:** Users must classify their issue (Technical, Billing, Feature Request, Bug Report, Account, Other).
*   **Priority Levels:**
    *   **Low/Medium:** Standard processing.
    *   **High/Urgent:** Triggers a **confirmation dialog** warning the user that these levels alert on-call staff.
*   **Safety & Security:**
    *   **Sanitization:** All message content is passed through `DOMPurify` to prevent Cross-Site Scripting (XSS) attacks.
    *   **Rate Limiting:** A client-side cooldown (default: 5 seconds) prevents spam submissions.
    *   **Validation:** Inputs are validated for length and required fields using `Yup`.

### 3.2. Admin Message Center
*Accessible to: Admins*

The `SendMessageForm` component transforms the Support tab into a communication tool for administrators.

*   **User Search:** A real-time, debounced search field allows admins to find users by email (minimum 3 characters).
*   **Targeting:**
    *   **Individual:** Select multiple specific users from the search results.
    *   **Broadcast:** A "Send to all" toggle enables platform-wide announcements.
*   **Safety Mechanisms:**
    *   **Threshold Warnings:** Sending to "All" or more than 10 users triggers a confirmation modal to prevent accidental mass emails.
    *   **Capacity:** The UI supports selecting up to 100 specific recipients at once.

### 3.3. User Invitations
*Accessible to: Users, Partners, Agents (Conditional)*

If the platform is configured to allow referrals (`maximumReferrals > 0`), the `InviteUserForm` appears next to the support form. This allows users to invite others to the platform via email.

### 3.4. Interactive Documentation

The platform renders documentation from Markdown files stored in `public/docs/`.

*   **Audio Tutorials:** The `AudioTutorialSection` component embeds audio players for "Guide Audio" and "Workflow Audio," offering an alternative way to consume the documentation.
*   **Rich Text:** Markdown is rendered with `react-markdown` and `remark-gfm`, supporting tables, lists, and code blocks.

### 3.5. ROI Calculator

The `ROICalculator` is a standalone tool integrated into the Help center, allowing users to estimate the return on investment for their deployments directly within the platform.

## 4. Technical Implementation

The support features are built with a focus on reliability and user experience:

*   **Form Management:** `Formik` handles form state, submission cycles, and error tracking.
*   **Validation:** `Yup` schemas ensure data integrity before it reaches the API.
*   **API Interaction:** `Axios` is used for HTTP requests, with built-in timeout handling (10s) and request cancellation to prevent memory leaks on unmounted components.
*   **Feedback:** The system uses a global alert store to provide immediate success or error notifications (toasts) to the user.
