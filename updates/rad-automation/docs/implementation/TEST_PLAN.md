# RAD Automation Platform - End User Test Plan

## Document Information
- **Version:** 1.0
- **Date:** 2025-12-10
- **Platform:** RAD (Rapid Application Deployment) - GCP Automation Platform
- **Test Environment:** Production/Staging

---

## Table of Contents
1. [Test Objectives](#test-objectives)
2. [Test Scope](#test-scope)
3. [Test Environment Setup](#test-environment-setup)
4. [User Roles & Access Levels](#user-roles--access-levels)
5. [Test Execution Strategy](#test-execution-strategy)
6. [Test Cases by Role](#test-cases-by-role)
7. [Integration Test Scenarios](#integration-test-scenarios)
8. [Performance & Load Testing](#performance--load-testing)
9. [Security Testing](#security-testing)
10. [Test Data Requirements](#test-data-requirements)
11. [Exit Criteria](#exit-criteria)

---

## Test Objectives

### Primary Goals
- Verify all user roles have appropriate access to features and data
- Validate end-to-end deployment workflows function correctly
- Ensure credit system accurately tracks purchases, awards, and spending
- Confirm billing and revenue calculations are accurate
- Test integration points with external services (GCP, Stripe, Firebase, GitHub)
- Validate real-time data synchronization across the platform
- Ensure proper error handling and user feedback

### Success Criteria
- 100% of critical path scenarios pass
- All role-based access controls function as designed
- Zero data integrity issues in credit/billing calculations
- All payment integrations work without errors
- Performance meets acceptable thresholds (page load < 3s, API response < 2s)

---

## Test Scope

### In Scope
✅ All six user roles (Admin, Finance, Support, Partner, Agent, User)
✅ Complete deployment lifecycle (create, monitor, update, delete)
✅ Credit management (awards, purchases, deductions, history)
✅ Billing and subscription management
✅ Module publishing and management
✅ Revenue tracking and ROI calculations
✅ User management and provisioning
✅ Authentication and authorization
✅ Real-time data updates
✅ Integration with Stripe, GCP, Firebase, GitHub

### Out of Scope
❌ Infrastructure/Terraform code validation (separate testing)
❌ Cloud Build pipeline internal logic
❌ Third-party service functionality (Stripe/GCP internals)
❌ Browser compatibility testing (assume modern browsers)
❌ Mobile app testing (web only)

---

## Test Environment Setup

### Prerequisites
1. **Test Accounts:**
   - 1 Admin user
   - 1 Finance user
   - 1 Support user
   - 1 Partner user
   - 1 Agent user
   - 3 Regular users (for various credit/subscription states)

2. **Test Data:**
   - At least 5 published modules (mix of platform and partner modules)
   - Credit balances: users with 0, low (< 100), medium (100-500), high (> 500) credits
   - Active subscriptions for some users
   - Historical deployments in various states (SUCCESS, FAILURE, WORKING)

3. **External Service Access:**
   - Stripe test mode configured
   - GCP project with appropriate permissions
   - GitHub test repositories
   - Test email account for notifications

4. **Browser & Tools:**
   - Latest Chrome/Firefox/Safari
   - Browser DevTools for network inspection
   - Access to Firestore console for data verification

---

## User Roles & Access Levels

| Role | Key Permissions | Primary Features |
|------|----------------|------------------|
| **Admin** | Full platform access | User management, system settings, all deployments, module publishing |
| **Finance** | Billing & financial data | Credit management, subscriptions, billing reports, invoices, revenue |
| **Support** | Read all deployments | View all user deployments, troubleshoot issues |
| **Partner** | Publishing & revenue | Publish modules, view module revenue |
| **Agent** | Revenue & referrals | View referral revenue, manage referral codes |
| **User** | Self-service only | Deploy modules, view own deployments, manage credits |

---

## Test Execution Strategy

### Testing Phases
1. **Phase 1: Authentication & Access Control** (All Roles)
2. **Phase 2: Core User Workflows** (User role)
3. **Phase 3: Administrative Functions** (Admin role)
4. **Phase 4: Financial Operations** (Finance role)
5. **Phase 5: Support Operations** (Support role)
6. **Phase 6: Partner Functions** (Partner role)
7. **Phase 7: Agent Functions** (Agent role)
8. **Phase 8: Integration Testing** (Cross-role workflows)
9. **Phase 9: Performance & Load Testing**
10. **Phase 10: Security Testing**

### Test Case Priority Levels
- **P0 (Critical):** Blocks core functionality, must pass before release
- **P1 (High):** Important features, should pass before release
- **P2 (Medium):** Nice-to-have features, can be addressed post-release
- **P3 (Low):** Edge cases, cosmetic issues

---

## Test Cases by Role

---

## PHASE 1: Authentication & Access Control

### TC-AUTH-001: User Sign In
**Priority:** P0
**Role:** All
**Prerequisites:** Valid user account exists

**Steps:**
1. Navigate to `/signin`
2. Enter valid email and password
3. Click "Sign In"

**Expected Results:**
- User is authenticated
- Redirected to appropriate home page based on role
- User session stored in cookies
- Real-time listeners initialized

**Test Variations:**
- Invalid email format → Error message displayed
- Incorrect password → Authentication error shown
- Inactive account → Redirected to `/access-denied`
- First-time login → Profile setup prompted

---

### TC-AUTH-002: Session Management
**Priority:** P0
**Role:** All
**Prerequisites:** User logged in

**Steps:**
1. Log in successfully
2. Wait 10 minutes (token refresh interval)
3. Perform an action requiring authentication
4. Leave browser idle for extended period
5. Attempt to perform action

**Expected Results:**
- Token refreshes automatically after 10 minutes
- User remains authenticated with valid actions
- Session persists across page refreshes
- Inactive users redirected to access denied page

---

### TC-AUTH-003: Role-Based Access Control
**Priority:** P0
**Role:** All
**Prerequisites:** One account per role type

**Test Matrix:**

| Feature/Route | Admin | Finance | Support | Partner | Agent | User |
|--------------|-------|---------|---------|---------|-------|------|
| `/deploy` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/deployments` (all) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/deployments` (own) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/setup` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/users` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/billing` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/publish` | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `/revenue` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| `/admin/credits` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

**Steps:**
1. Log in as each role type
2. Attempt to access each route listed
3. Verify access granted/denied as per matrix

**Expected Results:**
- ✅ routes load successfully
- ❌ routes redirect to unauthorized/home page
- API calls return 403 for unauthorized actions

---

### TC-AUTH-004: Sign Out
**Priority:** P0
**Role:** All
**Prerequisites:** User logged in

**Steps:**
1. Click sign out button
2. Attempt to access protected route
3. Check cookie storage

**Expected Results:**
- User logged out successfully
- Session cookies cleared
- Redirected to `/signin`
- Cannot access protected routes

---

## PHASE 2: Core User Workflows (User Role)

---

### TC-USER-001: Browse Available Modules
**Priority:** P0
**Role:** User
**Prerequisites:** At least 5 published modules exist

**Steps:**
1. Log in as User
2. Navigate to `/deploy`
3. Browse module cards
4. Search for specific module
5. Filter by category/cost

**Expected Results:**
- All published modules displayed as cards
- Module info shows: name, description, cost, rating, deployment count
- Search filters results correctly
- Clicking module opens details/deployment form

---

### TC-USER-002: Create New Deployment (Sufficient Credits)
**Priority:** P0
**Role:** User
**Prerequisites:** User has sufficient credits, module requires variables

**Steps:**
1. Navigate to `/deploy`
2. Select a module with credit cost
3. Fill in all required variables
4. Review credit cost
5. Click "Deploy"

**Expected Results:**
- Deployment form validates required fields
- Credit cost displayed clearly
- Deployment created with status QUEUED
- Credits deducted from user balance
- Credit transaction recorded in history
- Pub/Sub message sent to Cloud Build
- User redirected to `/deployments/:id`
- Status updates to WORKING, then SUCCESS/FAILURE

**Verify in Firestore:**
- New document in `deployments` collection
- New document in `credit_transactions` collection
- User's `creditAwards` or `creditPurchases` decreased

---

### TC-USER-003: Create Deployment (Insufficient Credits)
**Priority:** P0
**Role:** User
**Prerequisites:** User has insufficient credits for selected module

**Steps:**
1. Navigate to `/deploy`
2. Select module with cost > user's balance
3. Fill in variables
4. Click "Deploy"

**Expected Results:**
- Error message: "Insufficient credits"
- Deployment NOT created
- Credits NOT deducted
- User prompted to purchase credits

---

### TC-USER-004: View Own Deployments
**Priority:** P0
**Role:** User
**Prerequisites:** User has at least 3 deployments

**Steps:**
1. Navigate to `/deployments`
2. Verify list shows only user's deployments
3. Check sorting options (date, status)
4. Check filtering options
5. Test pagination (if > 10 deployments)

**Expected Results:**
- Only user's deployments visible
- Deployments sorted by creation date (newest first)
- Filters work correctly (status, module)
- Pagination controls appear if needed
- Real-time status updates reflected

---

### TC-USER-005: View Deployment Details
**Priority:** P0
**Role:** User
**Prerequisites:** User has completed deployment

**Steps:**
1. Navigate to `/deployments/:id`
2. Review deployment information
3. Check tabs: Overview, Logs, Outputs, Variables, Credit History

**Expected Results:**
- Deployment details displayed: status, module, project ID, timestamps
- **Logs tab:** Shows Cloud Build logs
- **Outputs tab:** Shows Terraform outputs (if any)
- **Variables tab:** Shows deployment variables
- **Credit History tab:** Shows credit transactions for this deployment
- Status badge reflects current state
- Action buttons visible (Update, Delete) based on status

---

### TC-USER-006: Update Deployment Variables
**Priority:** P1
**Role:** User
**Prerequisites:** User has active deployment

**Steps:**
1. Navigate to `/deployments/:id`
2. Click "Update" button
3. Modify variable values
4. Click "Save"

**Expected Results:**
- Update form pre-fills with current variables
- Variables can be modified
- Save triggers new Cloud Build with UPDATE action
- Additional credits deducted if applicable
- Status changes to WORKING
- Deployment updates successfully

---

### TC-USER-007: Delete Deployment
**Priority:** P1
**Role:** User
**Prerequisites:** User has deployment to delete

**Steps:**
1. Navigate to `/deployments/:id`
2. Click "Delete" button
3. Confirm deletion

**Expected Results:**
- Confirmation modal appears
- Deletion triggers Cloud Build with DELETE action
- Status changes to DELETED
- Deployment soft-deleted (still in Firestore but marked deleted)
- Credits NOT refunded
- Deleted deployment still visible in history

---

### TC-USER-008: Purchase Credits
**Priority:** P0
**Role:** User
**Prerequisites:** Stripe test mode configured

**Steps:**
1. Navigate to `/credits`
2. Click "Purchase Credits"
3. Select credit amount
4. Complete Stripe checkout
5. Return to platform

**Expected Results:**
- Stripe checkout session opens
- Test card accepted (4242 4242 4242 4242)
- Webhook processes payment
- Credits added to user's `creditPurchases`
- Transaction recorded in `credit_transactions`
- User balance updated in real-time

**Test Variations:**
- Payment fails → No credits added, error message shown
- Cancel checkout → Return to platform, no changes

---

### TC-USER-009: View Credit History
**Priority:** P1
**Role:** User
**Prerequisites:** User has credit transactions

**Steps:**
1. Navigate to `/credits`
2. Review credit history table
3. Filter by type (AWARD, PURCHASE, SPEND)
4. Search by date range

**Expected Results:**
- All transactions displayed chronologically
- Each transaction shows: date, type, amount, category, balance
- Filters work correctly
- Pagination if > 10 transactions

---

### TC-USER-010: Update Profile Settings
**Priority:** P1
**Role:** User
**Prerequisites:** User logged in

**Steps:**
1. Navigate to `/profile`
2. Update notification preferences
3. Add GitHub token
4. Update contact info
5. Save changes

**Expected Results:**
- Profile fields editable
- Changes saved to Firestore
- Notification preferences respected
- GitHub token stored securely
- Success message displayed

---

### TC-USER-011: Delete Account
**Priority:** P2
**Role:** User
**Prerequisites:** User account exists

**Steps:**
1. Navigate to `/profile`
2. Click "Delete Account"
3. Confirm deletion
4. Verify account status

**Expected Results:**
- Confirmation modal with warning
- User document moved to `deleted_users` collection
- User marked inactive in Firestore
- Cannot log in after deletion
- Deployments preserved for audit

---

### TC-USER-012: Pin Favorite Modules
**Priority:** P2
**Role:** User
**Prerequisites:** Modules available

**Steps:**
1. Navigate to `/deploy` or `/explore`
2. Click pin icon on module card
3. Verify pinned modules section
4. Unpin module

**Expected Results:**
- Module added to user's `pinnedModules` array
- Pinned modules displayed at top
- Pin icon changes to indicate pinned state
- Unpinning removes from list

---

## PHASE 3: Administrative Functions (Admin Role)

---

### TC-ADMIN-001: View All Users
**Priority:** P0
**Role:** Admin
**Prerequisites:** Multiple users exist in system

**Steps:**
1. Log in as Admin
2. Navigate to `/users`
3. Browse user list
4. Search for specific user
5. Filter by role or status

**Expected Results:**
- All users displayed with key info (email, roles, status, credits)
- Pagination works for > 20 users
- Search filters results correctly
- Role badges displayed accurately

---

### TC-ADMIN-002: Manage User Roles
**Priority:** P0
**Role:** Admin
**Prerequisites:** Test user account exists

**Steps:**
1. Navigate to `/users`
2. Click on user row
3. Toggle role checkboxes (isAdmin, isPartner, isAgent, etc.)
4. Save changes
5. Log in as modified user to verify access

**Expected Results:**
- Role toggles update Firestore user document
- Changes reflected immediately in UI
- Modified user has appropriate access
- Google Group membership synced if applicable

---

### TC-ADMIN-003: Deactivate/Reactivate User
**Priority:** P0
**Role:** Admin
**Prerequisites:** Active user account

**Steps:**
1. Navigate to `/users`
2. Toggle user's "Active" status to OFF
3. User attempts to log in
4. Reactivate user
5. User attempts to log in again

**Expected Results:**
- User marked `active: false` in Firestore
- Inactive user redirected to `/access-denied` on login
- Real-time listener detects status change
- Reactivated user can log in successfully

---

### TC-ADMIN-004: Configure System Settings
**Priority:** P0
**Role:** Admin
**Prerequisites:** Admin access to `/setup`

**Steps:**
1. Navigate to `/setup`
2. Update credit settings (enable/disable, cost per unit)
3. Update subscription settings
4. Configure email settings
5. Save changes

**Expected Results:**
- Settings saved to Firestore `settings` collection
- Changes applied globally across platform
- Credit system respects enable/disable flag
- Subscription features toggle accordingly

---

### TC-ADMIN-005: Publish Platform Module
**Priority:** P0
**Role:** Admin
**Prerequisites:** GitHub repo with Terraform module

**Steps:**
1. Navigate to `/publish`
2. Enter GitHub repo URL
3. System extracts variables from HCL files
4. Configure module settings:
   - Name, description
   - Credit cost
   - Variable configurations (required, defaults)
   - Revenue share percentages
5. Publish module

**Expected Results:**
- Variables extracted correctly from Terraform files
- Module saved to `modules` collection
- Module appears in `/deploy` and `/explore`
- Users can deploy the module

---

### TC-ADMIN-006: View All Deployments
**Priority:** P1
**Role:** Admin
**Prerequisites:** Multiple deployments from various users

**Steps:**
1. Navigate to `/deployments`
2. Verify all users' deployments visible
3. Filter by user, module, status
4. Sort by date, status

**Expected Results:**
- All deployments across all users displayed
- Filters and sorting work correctly
- Can view details of any deployment
- Can see deployment owner

---

### TC-ADMIN-007: Adjust User Credits
**Priority:** P1
**Role:** Admin
**Prerequisites:** User account exists

**Steps:**
1. Navigate to `/admin/credits` or user detail page
2. Select user
3. Award credits (positive amount)
4. Deduct credits (negative amount)
5. Verify balance updated

**Expected Results:**
- Credits added to user's `creditAwards`
- Transaction recorded as type AWARD
- User balance updates in real-time
- Credit history shows admin adjustment

---

### TC-ADMIN-008: Delete Module
**Priority:** P2
**Role:** Admin
**Prerequisites:** Published module exists

**Steps:**
1. Navigate to `/explore` or module management
2. Select module to delete
3. Confirm deletion
4. Verify module removed

**Expected Results:**
- Module removed from `modules` collection
- No longer appears in `/deploy` or `/explore`
- Existing deployments using module unaffected

---

## PHASE 4: Financial Operations (Finance Role)

---

### TC-FINANCE-001: View Project Costs
**Priority:** P0
**Role:** Finance
**Prerequisites:** GCP billing data available in BigQuery

**Steps:**
1. Log in as Finance
2. Navigate to `/billing`
3. View "Project Costs" tab
4. Filter by date range
5. Review cost breakdown

**Expected Results:**
- BigQuery data fetched correctly
- Costs displayed by project/service
- Date range filter works
- Total costs calculated accurately
- Export option available

---

### TC-FINANCE-002: View Project Revenue
**Priority:** P0
**Role:** Finance
**Prerequisites:** Credit purchases and deployments exist

**Steps:**
1. Navigate to `/billing`
2. View "Project Revenue" tab
3. Filter by date range
4. Review revenue sources (purchases, subscriptions)

**Expected Results:**
- Total revenue calculated from Stripe payments
- Revenue breakdown by source type
- Date range filter works
- Monthly trends displayed
- Export option available

---

### TC-FINANCE-003: Generate Monthly Invoices
**Priority:** P0
**Role:** Finance
**Prerequisites:** Billing data for previous month

**Steps:**
1. Navigate to `/billing`
2. Select "Invoices" tab
3. Choose month/year
4. Click "Generate Invoices"
5. Download invoice file

**Expected Results:**
- Invoices generated from BigQuery data
- One invoice per customer/project
- Accurate line items and totals
- PDF/CSV export available
- Invoices stored for audit

---

### TC-FINANCE-004: Manage Subscription Tiers
**Priority:** P0
**Role:** Finance
**Prerequisites:** Stripe configured with products

**Steps:**
1. Navigate to `/billing`
2. View "Subscription Tiers" section
3. Create new tier:
   - Name, price, credits included, period
4. Activate/deactivate tier
5. Verify tier appears in user checkout

**Expected Results:**
- Tier saved to `subscription_tiers` collection
- Stripe product/price ID linked
- Active tiers visible in user subscription page
- Inactive tiers hidden from users

---

### TC-FINANCE-005: View User Credit History
**Priority:** P1
**Role:** Finance
**Prerequisites:** Users have credit transactions

**Steps:**
1. Navigate to `/admin/credits` or user management
2. Select user
3. View complete credit history
4. Filter by transaction type
5. Export history

**Expected Results:**
- All transactions visible (AWARD, PURCHASE, SPEND)
- Balance progression shown
- Filter and sort work correctly
- Export generates accurate report

---

### TC-FINANCE-006: Adjust Credit Costs
**Priority:** P1
**Role:** Finance
**Prerequisites:** Access to settings

**Steps:**
1. Navigate to `/billing` or settings
2. Update `creditsPerUnit` (exchange rate)
3. Save changes
4. Verify new rate applies to purchases

**Expected Results:**
- Credit cost updated in settings
- New purchases use updated rate
- Existing credit balances unaffected
- UI displays correct pricing

---

### TC-FINANCE-007: View Revenue by Module
**Priority:** P1
**Role:** Finance
**Prerequisites:** Deployments with revenue data

**Steps:**
1. Navigate to `/revenue` (if Finance has access) or billing reports
2. View revenue breakdown by module
3. Filter by date range
4. Export report

**Expected Results:**
- Revenue calculated per module
- Partner/agent shares calculated correctly
- Date filters work
- Export includes all relevant data

---

## PHASE 5: Support Operations (Support Role)

---

### TC-SUPPORT-001: View All Deployments
**Priority:** P0
**Role:** Support
**Prerequisites:** Multiple user deployments exist

**Steps:**
1. Log in as Support
2. Navigate to `/deployments`
3. View all users' deployments
4. Search for specific deployment or user
5. Filter by status

**Expected Results:**
- All deployments visible across all users
- Search finds deployments by ID or user email
- Status filter works correctly
- Can view deployment details

---

### TC-SUPPORT-002: Troubleshoot Failed Deployment
**Priority:** P0
**Role:** Support
**Prerequisites:** Deployment in FAILURE status

**Steps:**
1. Navigate to failed deployment
2. Review deployment details
3. Check logs tab for error messages
4. Review variables for misconfigurations
5. Access Cloud Build console for detailed logs

**Expected Results:**
- Failure status clearly displayed
- Logs show error details
- Variables visible for review
- Can identify root cause
- Can provide guidance to user

---

### TC-SUPPORT-003: Monitor Active Deployments
**Priority:** P1
**Role:** Support
**Prerequisites:** Deployments in WORKING status

**Steps:**
1. Navigate to `/deployments`
2. Filter for WORKING status
3. Monitor progress of active deployments
4. Check for stalled deployments (timeout)

**Expected Results:**
- Active deployments listed
- Real-time status updates
- Can identify long-running deployments
- Can escalate issues to admin if needed

---

### TC-SUPPORT-004: View User Deployment History
**Priority:** P1
**Role:** Support
**Prerequisites:** User has multiple deployments

**Steps:**
1. Search for user's email
2. View all deployments for that user
3. Review success/failure patterns
4. Identify recurring issues

**Expected Results:**
- All user deployments visible
- Can filter by status, module, date
- Pattern analysis possible
- Can provide targeted support

---

### TC-SUPPORT-005: Cannot Modify Deployments
**Priority:** P0
**Role:** Support
**Prerequisites:** Support role has read-only access

**Steps:**
1. Navigate to any deployment
2. Attempt to click "Update" or "Delete"
3. Verify buttons disabled or hidden

**Expected Results:**
- Update/delete actions NOT available
- Support can only view, not modify
- API calls return 403 for modification attempts

---

## PHASE 6: Partner Functions (Partner Role)

---

### TC-PARTNER-001: Publish New Module
**Priority:** P0
**Role:** Partner
**Prerequisites:** GitHub repo with Terraform module, Partner role

**Steps:**
1. Log in as Partner
2. Navigate to `/publish`
3. Enter GitHub repo URL (partner's repo)
4. Configure module:
   - Name, description
   - Credit cost
   - Variable settings
   - Partner revenue share percentage
5. Publish

**Expected Results:**
- Module extracted from GitHub
- Module saved with `publishedByEmail` = partner's email
- Module appears in `/explore` and `/deploy`
- Users can deploy partner module

---

### TC-PARTNER-002: View Module Revenue
**Priority:** P0
**Role:** Partner
**Prerequisites:** Partner has published modules, users have deployed them

**Steps:**
1. Navigate to `/revenue`
2. Select "Module Revenue" tab
3. View revenue for own modules
4. Filter by date range
5. Verify revenue calculations

**Expected Results:**
- Only partner's modules shown
- Revenue calculated correctly:
  - Total revenue from deployments
  - Partner share percentage applied
  - "True revenue" calculated (excluding free credit deployments chronologically)
- Date filters work
- Export available

---

### TC-PARTNER-003: View Module Deployment Stats
**Priority:** P1
**Role:** Partner
**Prerequisites:** Partner modules deployed by users

**Steps:**
1. Navigate to `/explore` or module management
2. View own published modules
3. Check deployment count
4. Check average rating

**Expected Results:**
- Deployment count accurate
- Average rating calculated from user ratings
- Stats update in real-time

---

### TC-PARTNER-004: Update Published Module
**Priority:** P1
**Role:** Partner
**Prerequisites:** Partner has published module

**Steps:**
1. Navigate to module management
2. Select own module
3. Update settings (description, cost, variables)
4. Save changes

**Expected Results:**
- Module settings updated in Firestore
- Changes reflected immediately
- Existing deployments unaffected
- New deployments use updated settings

---

### TC-PARTNER-005: Cannot Access Other Modules
**Priority:** P0
**Role:** Partner
**Prerequisites:** Other partners/admin have published modules

**Steps:**
1. Attempt to edit another partner's module
2. Attempt to delete another partner's module
3. Verify access denied

**Expected Results:**
- Cannot modify modules published by others
- API returns 403 for unauthorized modifications
- Can only manage own modules

---

### TC-PARTNER-006: View Agent Revenue Share
**Priority:** P1
**Role:** Partner
**Prerequisites:** Agent revenue sharing configured

**Steps:**
1. Navigate to `/revenue`
2. View revenue breakdown
3. Check agent share deducted from partner revenue

**Expected Results:**
- Partner revenue = (total deployment revenue) × (partner %) - (agent %)
- Agent share calculated correctly
- Breakdown shows partner vs agent split

---

## PHASE 7: Agent Functions (Agent Role)

---

### TC-AGENT-001: View Referral Revenue
**Priority:** P0
**Role:** Agent
**Prerequisites:** Agent has referral code, referred users have made purchases/deployments

**Steps:**
1. Log in as Agent
2. Navigate to `/revenue`
3. View "User Revenue" tab
4. Filter by referred users
5. View total referral revenue

**Expected Results:**
- Revenue from referred users displayed
- Agent commission calculated correctly
- Date range filter works
- Export available

---

### TC-AGENT-002: Manage Referral Code
**Priority:** P0
**Role:** Agent
**Prerequisites:** Agent role assigned

**Steps:**
1. Navigate to `/profile`
2. View or generate referral code
3. Copy referral link
4. Share with potential users

**Expected Results:**
- Unique referral code generated
- Referral link formatted correctly
- Code stored in user's `referralCode` field
- Link can be shared externally

---

### TC-AGENT-003: Track Referral Signups
**Priority:** P1
**Role:** Agent
**Prerequisites:** Users signed up with agent's referral code

**Steps:**
1. Navigate to referral dashboard or user list
2. View users referred by agent
3. Check referral signup count
4. View conversion rate

**Expected Results:**
- All referred users listed
- Signup count accurate
- Can see referred user activity
- Conversion metrics displayed

---

### TC-AGENT-004: View Commission Structure
**Priority:** P1
**Role:** Agent
**Prerequisites:** Commission percentages configured

**Steps:**
1. Navigate to `/revenue` or settings
2. View agent commission rate
3. Calculate expected commission from revenue

**Expected Results:**
- Commission rate displayed clearly
- Agent revenue = (total referred user revenue) × (agent %)
- Calculations match expectations

---

### TC-AGENT-005: Cannot Access Admin Functions
**Priority:** P0
**Role:** Agent
**Prerequisites:** Agent role only

**Steps:**
1. Attempt to access `/users`, `/setup`, `/admin/credits`
2. Attempt to modify system settings
3. Verify access denied

**Expected Results:**
- Admin routes return 403 or redirect
- Cannot manage users or settings
- Limited to revenue viewing only

---

## PHASE 8: Integration Test Scenarios

---

### TC-INTEG-001: End-to-End Deployment Workflow
**Priority:** P0
**Roles:** User, Admin, Support
**Prerequisites:** Module published, user has credits

**Steps:**
1. **User:** Browse modules, select one, deploy
2. **System:** Deduct credits, trigger Cloud Build
3. **GCP:** Execute Terraform, return outputs
4. **System:** Update deployment status to SUCCESS
5. **Support:** View deployment in monitoring
6. **Admin:** Review deployment logs

**Expected Results:**
- Complete workflow executes without errors
- Credits deducted accurately
- Cloud Build triggered successfully
- Terraform executes and creates resources
- Status updates in real-time
- All roles can access appropriate data

---

### TC-INTEG-002: Credit Purchase to Deployment Flow
**Priority:** P0
**Roles:** User
**Prerequisites:** User has 0 credits, module requires credits

**Steps:**
1. Attempt to deploy module
2. Receive insufficient credits error
3. Navigate to `/credits`
4. Purchase credits via Stripe
5. Stripe webhook processes payment
6. Credits added to account
7. Deploy module successfully

**Expected Results:**
- Deployment blocked when credits insufficient
- Stripe checkout completes
- Webhook adds credits immediately
- Deployment succeeds after purchase
- All transactions recorded

---

### TC-INTEG-003: Partner Module Publishing to User Deployment
**Priority:** P0
**Roles:** Partner, User, Finance
**Prerequisites:** Partner account, GitHub repo

**Steps:**
1. **Partner:** Publish module with revenue share
2. **User:** Browse modules, deploy partner module
3. **System:** Deduct credits, record revenue
4. **Partner:** View revenue in dashboard
5. **Finance:** Verify revenue calculations

**Expected Results:**
- Partner module published successfully
- User can deploy partner module
- Revenue split calculated correctly
- Partner sees their share
- Finance sees total revenue and breakdown

---

### TC-INTEG-004: Agent Referral to Revenue Flow
**Priority:** P1
**Roles:** Agent, User, Finance
**Prerequisites:** Agent with referral code

**Steps:**
1. **Agent:** Generate referral code
2. **New User:** Sign up using referral link
3. **New User:** Purchase credits and deploy modules
4. **System:** Calculate agent commission
5. **Agent:** View commission in revenue dashboard
6. **Finance:** Verify commission calculations

**Expected Results:**
- Referral code tracks signup correctly
- User linked to agent via `referredBy`
- Agent commission calculated on user's spending
- Agent sees commission in dashboard
- Finance reports include agent payouts

---

### TC-INTEG-005: Deployment Failure Recovery
**Priority:** P0
**Roles:** User, Support
**Prerequisites:** Module that can fail (e.g., invalid variables)

**Steps:**
1. **User:** Deploy module with incorrect configuration
2. **System:** Cloud Build fails
3. **System:** Update status to FAILURE
4. **User:** Receive notification (if enabled)
5. **User:** View error logs
6. **Support:** Investigate failure
7. **User:** Correct variables, redeploy

**Expected Results:**
- Failure status updated correctly
- Credits deducted (no refund on failure)
- Error logs accessible
- User can retry deployment
- Support can assist with troubleshooting

---

### TC-INTEG-006: Real-Time Data Synchronization
**Priority:** P0
**Roles:** User, Admin
**Prerequisites:** Multiple users, active deployments

**Steps:**
1. **User A:** Deploy module (status WORKING)
2. **User B:** View same deployment in real-time
3. **System:** Deployment completes (status SUCCESS)
4. **Admin:** Adjust User A's credits
5. **User A:** See credit balance update without refresh

**Expected Results:**
- Real-time listeners detect Firestore changes
- Status updates appear immediately
- Credit balance updates in real-time
- No page refresh required
- All users see consistent data

---

### TC-INTEG-007: Subscription Purchase to Credit Addition
**Priority:** P1
**Roles:** User, Finance
**Prerequisites:** Subscription tier configured

**Steps:**
1. **Finance:** Create subscription tier (e.g., $50/month = 500 credits)
2. **User:** Subscribe to tier via Stripe
3. **Stripe:** Process subscription payment
4. **System:** Webhook adds credits monthly
5. **User:** Verify credits added

**Expected Results:**
- Subscription checkout completes
- Initial credits added immediately
- Recurring credits added monthly (via scheduler)
- Subscription status tracked in Firestore
- User can cancel subscription

---

### TC-INTEG-008: Multi-User Concurrent Deployments
**Priority:** P1
**Roles:** Multiple Users
**Prerequisites:** 5+ users, sufficient credits

**Steps:**
1. **5 Users:** Simultaneously deploy different modules
2. **System:** Process all deployments concurrently
3. **System:** Deduct credits for each user
4. **System:** Trigger Cloud Build for each deployment

**Expected Results:**
- All deployments created successfully
- No race conditions in credit deduction
- Each user's balance updated correctly
- All Cloud Builds triggered
- No data corruption

---

## PHASE 9: Performance & Load Testing

---

### TC-PERF-001: Page Load Performance
**Priority:** P1
**Role:** All
**Prerequisites:** Typical data load (100 deployments, 50 modules, 20 users)

**Test Cases:**

| Page | Target Load Time | Metrics to Monitor |
|------|------------------|-------------------|
| `/signin` | < 1s | Time to interactive |
| `/deploy` | < 2s | Module cards rendering |
| `/deployments` | < 3s | Pagination, filtering |
| `/deployments/:id` | < 2s | Detail view, tabs |
| `/billing` | < 4s | BigQuery data fetch |
| `/revenue` | < 3s | Revenue calculations |
| `/users` | < 2s | User list pagination |

**Steps:**
1. Use browser DevTools Performance tab
2. Measure First Contentful Paint (FCP)
3. Measure Time to Interactive (TTI)
4. Identify slow queries or rendering

**Expected Results:**
- All pages load within target times
- No blocking JavaScript
- Efficient Firestore queries
- Lazy loading implemented where appropriate

---

### TC-PERF-002: API Response Times
**Priority:** P1
**Role:** All
**Prerequisites:** Production-like data

**Test Cases:**

| API Endpoint | Target Response | Max Response |
|--------------|----------------|--------------|
| `GET /api/deployments` | < 1s | < 2s |
| `POST /api/deployments` | < 2s | < 3s |
| `GET /api/modules` | < 1s | < 2s |
| `GET /api/revenue` | < 2s | < 4s |
| `GET /api/billing/costs` | < 3s | < 5s |
| `POST /api/credits/adjust` | < 1s | < 2s |

**Steps:**
1. Use browser DevTools Network tab
2. Monitor API response times
3. Check server-side processing time
4. Identify slow database queries

**Expected Results:**
- API responses within target times
- No N+1 query issues
- Proper indexing on Firestore collections
- Efficient BigQuery queries

---

### TC-PERF-003: Pagination Performance
**Priority:** P1
**Role:** All
**Prerequisites:** Large datasets (500+ deployments, 100+ users)

**Steps:**
1. Navigate to `/deployments` with 500+ records
2. Test pagination controls (next, previous, jump to page)
3. Measure load time for each page
4. Test filtering and sorting with pagination

**Expected Results:**
- Pagination loads each page in < 2s
- Cursor-based pagination efficient
- Filtering/sorting doesn't reload all data
- Smooth user experience

---

### TC-PERF-004: Real-Time Listener Performance
**Priority:** P1
**Role:** All
**Prerequisites:** Active deployments updating status

**Steps:**
1. Open `/deployments` with 20+ active (WORKING) deployments
2. Monitor real-time status updates
3. Check browser memory usage
4. Leave page open for 30 minutes
5. Verify no memory leaks

**Expected Results:**
- Status updates appear within 2-3 seconds
- No excessive listener re-registrations
- Memory usage stable
- No performance degradation over time

---

### TC-PERF-005: Concurrent User Load
**Priority:** P2
**Role:** All
**Prerequisites:** Load testing tool (e.g., Apache JMeter, k6)

**Steps:**
1. Simulate 50 concurrent users
2. Each user performs typical workflow:
   - Sign in
   - Browse modules
   - Create deployment
   - View deployments
3. Monitor server resources (Cloud Run CPU, memory)
4. Check for errors or timeouts

**Expected Results:**
- All users complete workflows successfully
- No 500 errors or timeouts
- Cloud Run scales appropriately
- Response times remain acceptable under load

---

### TC-PERF-006: BigQuery Query Performance
**Priority:** P1
**Role:** Finance
**Prerequisites:** Billing data spanning 6+ months

**Steps:**
1. Navigate to `/billing`
2. Query project costs for 6-month range
3. Query revenue for 6-month range
4. Generate invoices for large dataset

**Expected Results:**
- BigQuery queries complete in < 5s
- Results cached appropriately
- No timeout errors
- Data aggregation accurate

---

## PHASE 10: Security Testing

---

### TC-SEC-001: Authentication Token Validation
**Priority:** P0
**Role:** All
**Prerequisites:** User logged in

**Steps:**
1. Log in and capture auth token
2. Make API call with valid token
3. Wait for token expiration (> 1 hour)
4. Make API call with expired token
5. Attempt API call with no token
6. Attempt API call with tampered token

**Expected Results:**
- Valid token → Request succeeds
- Expired token → 401 error, user redirected to login
- No token → 401 error
- Tampered token → 401 error, user signed out

---

### TC-SEC-002: Role-Based API Authorization
**Priority:** P0
**Role:** All
**Prerequisites:** Multiple role accounts

**Steps:**
1. **User role:** Attempt to call admin-only API (e.g., `POST /api/users`)
2. **Partner role:** Attempt to delete another partner's module
3. **Agent role:** Attempt to access billing API
4. **Support role:** Attempt to create deployment for another user

**Expected Results:**
- All unauthorized API calls return 403
- No data exposure or modification
- Proper error messages returned
- Audit log records unauthorized attempts

---

### TC-SEC-003: Input Validation & Injection Prevention
**Priority:** P0
**Role:** All
**Prerequisites:** Module deployment form

**Steps:**
1. Attempt SQL injection in input fields:
   - `'; DROP TABLE users; --`
2. Attempt XSS in module variables:
   - `<script>alert('XSS')</script>`
3. Attempt NoSQL injection in Firestore queries:
   - `{"$ne": null}`
4. Test path traversal in file uploads:
   - `../../etc/passwd`

**Expected Results:**
- All malicious input sanitized or rejected
- No script execution
- No database manipulation
- Error messages don't reveal system details

---

### TC-SEC-004: Credit System Manipulation Attempts
**Priority:** P0
**Role:** User
**Prerequisites:** User with low credits

**Steps:**
1. Intercept deployment API call
2. Attempt to modify credit cost in request body
3. Attempt to deploy without sufficient credits by manipulating client-side checks
4. Attempt negative credit values
5. Attempt to replay credit purchase webhook

**Expected Results:**
- Server-side credit validation enforced
- Client-side manipulation has no effect
- Negative values rejected
- Webhook replay detection prevents duplicate credits

---

### TC-SEC-005: Firestore Security Rules
**Priority:** P0
**Role:** All
**Prerequisites:** Direct Firestore access (via SDK)

**Steps:**
1. Attempt to read another user's deployments directly from Firestore
2. Attempt to modify deployment without authentication
3. Attempt to write to admin-only collections
4. Attempt to delete user documents

**Expected Results:**
- Firestore security rules block unauthorized access
- Users can only read/write their own data
- Admin-only operations blocked for non-admins
- Error messages indicate permission denied

---

### TC-SEC-006: Stripe Webhook Signature Verification
**Priority:** P0
**Role:** System
**Prerequisites:** Stripe webhook configured

**Steps:**
1. Send valid webhook with correct signature
2. Send webhook with invalid signature
3. Send webhook with tampered payload
4. Send replay of old webhook

**Expected Results:**
- Valid webhook processed successfully
- Invalid signature rejected, no credits added
- Tampered payload rejected
- Replay prevention (idempotency) works

---

### TC-SEC-007: Session Hijacking Prevention
**Priority:** P0
**Role:** All
**Prerequisites:** Logged in user

**Steps:**
1. Log in and capture session cookie
2. Copy cookie to different browser/device
3. Attempt to use session from different IP
4. Use tools to test cookie security flags

**Expected Results:**
- Cookies have `Secure` and `HttpOnly` flags
- Session invalidates on suspicious activity (optional)
- CSRF tokens prevent cross-site attacks
- Session timeout enforced

---

### TC-SEC-008: Sensitive Data Exposure
**Priority:** P0
**Role:** All
**Prerequisites:** Various data in system

**Steps:**
1. Inspect API responses for sensitive data
2. Check browser console for logged secrets
3. Review error messages for system details
4. Check deployment logs for credentials
5. Verify Stripe keys are not exposed

**Expected Results:**
- No passwords, API keys, or tokens in responses
- Secrets stored in Cloud Secret Manager
- Error messages generic, not revealing internals
- Logs don't contain sensitive information
- Stripe secret keys never sent to client

---

### TC-SEC-009: Denial of Service (Rate Limiting)
**Priority:** P1
**Role:** All
**Prerequisites:** Rate limiting configured

**Steps:**
1. Make rapid API requests (100+ per second)
2. Attempt to create 100 deployments simultaneously
3. Attempt to brute force login (100+ attempts)

**Expected Results:**
- Rate limiting kicks in after threshold
- 429 Too Many Requests error returned
- User/IP temporarily blocked
- Legitimate users unaffected

---

### TC-SEC-010: Privilege Escalation Attempts
**Priority:** P0
**Role:** User
**Prerequisites:** Regular user account

**Steps:**
1. Manipulate API requests to add admin role to own account
2. Attempt to access admin routes by direct URL
3. Modify JWT token claims (if accessible)
4. Attempt to impersonate another user

**Expected Results:**
- Server validates roles from authoritative source (Firestore)
- Client-side role modifications ignored
- Admin routes reject non-admin users
- User impersonation prevented

---

## Test Data Requirements

### User Accounts
| Role | Email | Credits (Awards) | Credits (Purchases) | Subscription | Status |
|------|-------|------------------|---------------------|--------------|--------|
| Admin | admin@test.com | 1000 | 0 | None | Active |
| Finance | finance@test.com | 500 | 0 | None | Active |
| Support | support@test.com | 500 | 0 | None | Active |
| Partner | partner@test.com | 500 | 500 | None | Active |
| Agent | agent@test.com | 200 | 0 | None | Active |
| User 1 | user1@test.com | 0 | 1000 | Premium | Active |
| User 2 | user2@test.com | 100 | 0 | None | Active |
| User 3 | user3@test.com | 500 | 500 | None | Active |
| User 4 | user4@test.com | 0 | 0 | None | Active |
| Inactive User | inactive@test.com | 100 | 0 | None | Inactive |

### Published Modules
| Module Name | Published By | Credit Cost | Variables | Source |
|-------------|--------------|-------------|-----------|--------|
| Basic VM | Admin | 10 | 3 required | Platform |
| Storage Bucket | Admin | 5 | 2 required | Platform |
| Cloud Function | Partner | 20 | 5 required | Partner GitHub |
| Database Setup | Partner | 50 | 8 required | Partner GitHub |
| Network Config | Admin | 15 | 4 required | Platform |

### Deployments
- 10 deployments in SUCCESS status (various users)
- 3 deployments in FAILURE status (various users)
- 2 deployments in WORKING status (simulated in-progress)
- 5 deployments in DELETED status (soft-deleted)
- Mix of platform and partner module deployments

### Credit Transactions
- 20+ AWARD transactions (admin adjustments)
- 15+ PURCHASE transactions (Stripe payments)
- 30+ SPEND transactions (deployment costs)

### Subscription Tiers
| Tier Name | Price | Credits | Period | Active |
|-----------|-------|---------|--------|--------|
| Basic | $10 | 100 | month | Yes |
| Pro | $50 | 600 | month | Yes |
| Enterprise | $200 | 3000 | month | Yes |
| Legacy | $20 | 150 | month | No |

---

## Exit Criteria

### Pass Criteria
✅ **All P0 (Critical) test cases pass** - No blockers to core functionality
✅ **95%+ of P1 (High) test cases pass** - Important features working
✅ **No critical security vulnerabilities** - All SEC tests pass
✅ **No data integrity issues** - Credit/billing calculations accurate
✅ **All role-based access controls working** - Proper authorization enforced
✅ **Real-time updates functioning** - Firestore listeners working correctly
✅ **Payment integration verified** - Stripe checkout and webhooks working
✅ **Performance benchmarks met** - Page loads and API responses within targets

### Acceptable Issues (Not Blockers)
⚠️ P2/P3 test failures (cosmetic, edge cases)
⚠️ Known limitations documented
⚠️ Minor UI inconsistencies
⚠️ Non-critical performance issues (with mitigation plan)

### Blockers (Cannot Release)
🚫 Any P0 test failure
🚫 Security vulnerabilities (injection, auth bypass, data exposure)
🚫 Data corruption or loss
🚫 Payment processing failures
🚫 Credit calculation errors
🚫 Complete feature unavailability for any role

---

## Test Execution Tracking

### Recommended Approach
1. **Create Test Matrix:** Track each test case with status (Not Run, Pass, Fail, Blocked)
2. **Assign Testers:** Distribute tests across team members
3. **Execute Phase by Phase:** Complete all Phase 1 tests before Phase 2
4. **Log Defects:** Document all failures with steps to reproduce
5. **Retest After Fixes:** Verify defect fixes don't introduce regressions
6. **Final Smoke Test:** Run subset of critical tests before release

### Test Metrics to Track
- **Total Test Cases:** 100+
- **Pass Rate:** Target 95%+
- **Defect Density:** Defects per module
- **Critical Defects:** Must be 0
- **Test Coverage:** % of features tested
- **Execution Time:** Hours per phase

---

## Appendix

### Test Tools
- **Browser:** Chrome DevTools for network/performance analysis
- **Firestore Console:** Verify data integrity
- **Cloud Build Console:** Monitor deployment pipelines
- **Stripe Dashboard:** Verify payment events
- **BigQuery Console:** Validate billing queries
- **Postman/Insomnia:** API testing
- **Load Testing:** k6, Apache JMeter, or Locust

### Test Environments
- **Staging:** Pre-production environment with test data
- **Production:** Limited testing, monitoring only
- **Local Development:** For debugging specific issues

### Reference Documentation
- Product Requirements Document (PRD)
- API Documentation
- Firestore Schema Documentation
- Terraform Module Specifications
- Stripe Integration Guide

---

## Test Plan Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| QA Lead | | | |
| Engineering Lead | | | |
| Product Manager | | | |
| Security Lead | | | |

---

**End of Test Plan**

*This test plan should be reviewed and updated quarterly or after major feature releases.*
