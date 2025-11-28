# Module Rating & Deployment Tracking Feature

## Overview

The Module Rating and Deployment Tracking feature empowers users to provide feedback on modules they have deployed and helps the community identify high-quality and popular modules. By tracking both user ratings (1-5 stars) and the total number of deployments, the platform provides valuable social signals to guide module selection.

## Key Features

1.  **User Ratings**: Users can rate their specific deployments on a scale of 1 to 5 stars.
2.  **Module Aggregation**: Individual deployment ratings are aggregated to calculate an average score and total rating count for the corresponding module.
3.  **Deployment Tracking**: The system tracks the total number of successful deployments for each module.
4.  **Smart Sorting**: The module catalog is sorted to highlight popular and highly-rated modules (Pinned > Deployment Count > Average Rating > Name).

## Technical Implementation

### Data Model

The feature relies on fields added to both the `deployments` and `modules` Firestore collections.

#### Deployment Document (`deployments`)
Each deployment record stores the specific rating given by the user.
-   `rating` (number, optional): The user's rating, an integer between 1 and 5.

#### Module Document (`modules`)
Each module record stores aggregated statistics.
-   `averageRating` (number, optional): The calculated average of all user ratings (floating-point).
-   `ratingCount` (number, optional): The total number of ratings received.
-   `deploymentCount` (number, optional): The total number of successful deployments.

### Backend Logic

#### API: Update Rating (`PATCH /api/deployments/[id]`)
The rating logic is handled by the deployment API endpoint. It employs a **Firestore Transaction** to ensure data consistency when updating both the deployment and the parent module simultaneously.

**Process Flow:**
1.  **Validation**: The API verifies the input is a valid integer between 1 and 5.
2.  **Authorization**: Checks if the user is the owner of the deployment or an admin.
3.  **Transaction**:
    -   Reads the current deployment and associated module documents.
    -   Calculates the new `averageRating` and `ratingCount`.
        -   *New Rating*: Adds the new value to the weighted sum and increments the count.
        -   *Update Rating*: Adjusts the weighted sum by removing the old value and adding the new one; count remains the same.
    -   Updates both documents atomically.

#### Deployment Counting
The `deploymentCount` on a module is managed by the `notification_status` Cloud Function. This function runs asynchronously after a deployment finishes and increments the counter on the module document only for successful `CREATE` actions.

### Frontend Components

#### `StarRating.tsx`
A reusable, accessible React component responsible for rendering the star UI.
-   **Features**: Hover effects, keyboard navigation, and readonly modes.
-   **Validation**:Client-side validation to ensure ratings are within bounds.

#### `ModuleDeployment.tsx` (My Deployments)
Handles the user interaction for rating a deployment.
-   **Optimistic Updates**: Immediately updates the UI state while the API request is pending to provide a responsive experience.
-   **Debouncing**: Prevents excessive API calls by debouncing user input.
-   **Error Handling**: Reverts the UI state and displays an error message if the API call fails.

#### `ModuleCard.tsx` (Module Catalog)
Displays the aggregated data for a module.
-   Shows the star rating, average score, and total rating count.
-   Displays the total number of deployments.

#### `Deploy.tsx` (Sorting)
The module list uses a weighted sorting algorithm to present the most relevant content:
1.  **Pinned Modules**: Admin-pinned modules appear first.
2.  **Popularity**: Modules are sorted by `deploymentCount` (descending).
3.  **Quality**: Ties are broken by `averageRating` (descending).
4.  **Alphabetical**: Final tie-breaker by module `name`.
