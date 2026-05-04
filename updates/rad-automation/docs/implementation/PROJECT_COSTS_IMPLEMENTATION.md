# Project Costs Implementation - GCP Asset Repository Integration

## Overview

This implementation ensures that the **Project Costs** tab in the Credits navigation menu now correctly uses the **GCP asset repository search** (Cloud Asset Inventory) and **BigQuery billing data** instead of Firestore credit transactions. This makes it distinct from Module Costs and Project Invoices tabs.

## Changes Made

### 1. New API Endpoint: `/api/project-costs`

**File:** `/home/user/rad-automation/rad-ui/webapp/src/pages/api/project-costs/index.ts`

**Purpose:** Retrieve actual GCP project costs from BigQuery billing table using Cloud Asset Inventory for project discovery.

**Key Features:**
- **Data Source:** BigQuery billing table (`process.env.BIGQUERY_BILLING_TABLE`)
- **Project Discovery:** Cloud Asset Inventory (`AssetServiceClient.searchAllIamPolicies`)
- **Date Range Filtering:** Flexible date range (not monthly like invoices)
- **Module Filtering:** Returns only projects related to selected module's deployments
- **Access Control:**
  - **Admin/Finance:** Access to all projects in organization/folder scope
  - **Partner/User:** Access to projects they own or deployed

**Implementation Details:**
- Uses `searchAllIamPolicies` from Cloud Asset Inventory to discover accessible projects
- Queries BigQuery billing table with date range filters on `usage_start_time` and `usage_end_time`
- Aggregates costs per project over the selected date range
- Supports module filtering by querying Firestore deployments and intersecting with accessible projects
- Fetches project owners from Firestore deployments or IAM policies as fallback
- Returns enriched data with project ID, name, owner, module, and cost information

### 2. Updated Component: `ProjectCosts.tsx`

**File:** `/home/user/rad-automation/rad-ui/webapp/src/components/ProjectCosts.tsx`

**Changes:**
- Updated API endpoint from `/api/costs` to `/api/project-costs`
- Added documentation header clarifying the component's purpose and data sources
- Updated `ICostData` interface to include `projectName`, `totalCredits`, and `netCost` fields
- Modified data mapping to use module information from API response

**Key Points:**
- Module filtering is now handled server-side in the API endpoint
- Component maintains same UI/UX but now displays actual GCP costs
- Retains all existing features: date range selection, CSV export, pagination

## Data Source Comparison

| Feature | Data Source | Discovery Method | Date Filtering | Use Case |
|---------|-------------|------------------|----------------|----------|
| **Module Costs** | Firestore `credit_transactions` | Firestore `deployments` | Date range (flexible) | Platform credit usage by deployment |
| **Project Costs** | **BigQuery billing table** | **Cloud Asset Inventory** | **Date range (flexible)** | **Actual GCP project costs** |
| **Project Invoices** | BigQuery billing table | Cloud Asset Inventory | Monthly (`invoice.month`) | Monthly billing data |

## How It Works

1. **User Action:** User selects date range and optionally a module, then clicks "Fetch Project Cost"

2. **Project Discovery:**
   - For Admin/Finance: All projects in organization/folder scope
   - For Partner/User:
     - Projects they deployed (Firestore)
     - Projects they own (Firestore)
     - Projects with IAM permissions (Cloud Asset Inventory)

3. **Module Filtering (Optional):**
   - Query Firestore for deployments matching the selected module
   - Extract project IDs from matching deployments
   - Intersect with user's accessible projects

4. **BigQuery Query:**
   - Query billing table for selected date range
   - Filter by accessible project IDs (if applicable)
   - Aggregate costs per project
   - Apply organization/folder scope filtering

5. **Enrichment:**
   - Fetch project owners from Firestore deployments
   - Fallback to IAM policies if not found in Firestore
   - Fetch module names from Firestore deployments

6. **Display:**
   - Show results in paginated table
   - Display: Date Created, Module, Project ID, Owner, Total Cost, Credit Debit

## Access Control

### Admin/Finance Users
- Access to all projects within configured scope (organization or folder)
- Can filter by specific modules
- See all GCP costs within their scope

### Partner/Regular Users
- Access limited to:
  - Projects they deployed
  - Projects where they are listed as owner
  - Projects where they have IAM permissions in GCP
- Module filtering further restricts results
- Only see costs for their accessible projects

## API Parameters

**GET `/api/project-costs`**

Query Parameters:
- `startDate` (required): Start date in YYYY-MM-DD format
- `endDate` (required): End date in YYYY-MM-DD format
- `module` (optional): Module name to filter by
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Items per page (default: 10, max: 1000)

Response:
```json
{
  "costData": [
    {
      "projectId": "my-project-123",
      "projectName": "My Project",
      "projectOwner": "user@example.com",
      "module": "wordpress",
      "totalCost": 123.45,
      "totalCredits": -10.00,
      "netCost": 113.45
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 10,
  "userRole": "user",
  "accessibleProjectsCount": 5,
  "moduleFilter": "wordpress"
}
```

## Testing Verification

To verify the implementation is working correctly:

1. **Check Data Source:**
   - Module Costs should query `/api/costs` (Firestore)
   - Project Costs should query `/api/project-costs` (BigQuery)
   - Project Invoices should query `/api/invoices` (BigQuery)

2. **Verify Cloud Asset Inventory Usage:**
   - Check logs for "Searching Asset Inventory IAM policies" messages
   - Verify non-admin users see projects beyond their Firestore deployments

3. **Test Module Filtering:**
   - Select a module from dropdown
   - Click "Fetch Project Cost"
   - Verify only projects from that module's deployments are shown

4. **Test Access Control:**
   - Admin users should see all projects in scope
   - Regular users should only see their accessible projects
   - Module filtering should work for both user types

## Environment Variables Required

Ensure these environment variables are configured:

```env
BIGQUERY_BILLING_PROJECT_ID=your-billing-project-id
BIGQUERY_BILLING_TABLE=your-project.dataset.billing_table
BIGQUERY_BILLING_LOCATION=US
NEXT_PUBLIC_GCP_PROJECT_ID=your-project-id
```

## Benefits

1. **Accurate GCP Costs:** Shows actual GCP billing data, not internal platform credits
2. **Comprehensive Discovery:** Uses Cloud Asset Inventory to find all accessible projects
3. **Module Association:** Links GCP costs to specific modules when deployed through platform
4. **Flexible Date Ranges:** Unlike monthly invoices, supports any date range up to 365 days
5. **Clear Separation:** Distinct from transaction-based Module Costs and monthly Project Invoices

## Migration Notes

- **No Breaking Changes:** Existing functionality remains intact
- **Backward Compatible:** UI/UX unchanged, only data source is different
- **Performance:** Includes caching for IAM policy lookups (5-minute TTL)
- **Scalability:** Handles large result sets with pagination
