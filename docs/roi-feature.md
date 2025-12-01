# ROI Calculator Feature

The ROI (Return on Investment) Calculator is an interactive tool designed to help users estimate the potential cost savings and financial benefits of using the RAD platform compared to manual deployment processes. It is integrated directly into the **Help** section of the platform.

## Overview

The calculator compares the costs associated with manual software deployments against the costs of using RAD's automated platform. It combines user-provided inputs with real-time platform statistics to provide a personalized savings estimation.

## Key Features

*   **Dynamic Data Integration**: Automatically initializes with real-time data from the RAD platform (e.g., your actual monthly deployment count and platform costs) to provide a baseline for calculations.
*   **Interactive Controls**: Users can fine-tune four key variables using sliders to match their specific team profile and operational costs.
*   **Real-Time Feedback**: All calculations are performed instantly as inputs change, providing immediate visibility into potential savings.
*   **Transparent Methodology**: A built-in "Assumptions & Methodology" section clearly explains the math behind the numbers.
*   **Responsive Design**: The interface is fully responsive, featuring a clean layout with separate sections for inputs and results.

## How to Use

1.  Navigate to the **Help** page via the main navigation menu.
2.  Select the **ROI Calculator** tab.
3.  Adjust the following sliders to reflect your current situation:
    *   **Projected Monthly Deployments**: The number of deployments your team performs per month (Defaults to your actual usage if available).
    *   **Current Manual Deployment Time**: The average time (in hours) it takes a human engineer to perform a single deployment manually.
    *   **Average Engineer Hourly Cost**: The fully loaded hourly cost of your engineering resources.
    *   **Time Savings with RAD**: The estimated percentage of time saved per deployment by using RAD automation (Default is 80%).
4.  View the results in the "Your Estimated Savings" panel on the right (or below on mobile).

## Calculation Logic

The calculator uses the following formulas to determine your estimated savings:

### 1. Manual Labor Cost
The cost of doing deployments the "old way" without automation.

`Manual Cost = Monthly Deployments * Manual Time per Deployment * Hourly Engineer Cost`

### 2. RAD Labor Cost
The reduced labor cost when using the RAD platform, factoring in the time savings.

`New Deployment Time = Manual Time * (1 - Time Savings %)`
`RAD Labor Cost = Monthly Deployments * New Deployment Time * Hourly Engineer Cost`

### 3. Total RAD Cost
The sum of the reduced labor cost and the platform fees.

`Total RAD Cost = RAD Labor Cost + Monthly RAD Platform Cost`
*(Note: Monthly RAD Platform Cost is fetched from your actual usage history)*

### 4. Net Savings & ROI
The final estimated financial benefit.

`Net Monthly Savings = Manual Cost - Total RAD Cost`
`ROI % = (Net Monthly Savings / Manual Cost) * 100`

## Technical Implementation details

*   **Component**: `ROICalculator.tsx`
*   **API Endpoint**: `/api/roi/stats` (Fetches `averageDeploymentTimeInMinutes`, `monthlyDeploymentCost`, `monthlyDeploymentCount`)
*   **Libraries**:
    *   `@tanstack/react-query` for data fetching, caching, and state management.
    *   `DaisyUI` / `Tailwind CSS` for styling and UI components (sliders, alerts).
*   **Safety**: The calculator includes overflow protection and input clamping to prevent mathematical errors or unrealistic values.
