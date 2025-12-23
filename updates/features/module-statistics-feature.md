# Module Statistics & Deployment Tracking

## Overview
The platform provides comprehensive tools for users to track their deployments and understand the value they are deriving from the platform. This document outlines the implementation of these tracking tools and statistics.

## Deployment Dashboard
The Deployments page (`/deployments`) serves as the central hub for user statistics. It features a dashboard that provides an immediate view of key metrics:

### Key Metrics
*   **Deployment Count**: A real-time counter showing the total number of deployments initiated by the user.
*   **Credit Balance**: (When credits are enabled) Displays the user's current available credits, combining both awarded and purchased credits. This is a direct indicator of available "spending power" on the platform.
*   **Retention Policy**: Clearly displays the configured data retention period (e.g., 30 days, 365 days, or Indefinite), informing users how long their deployment history is preserved.

## Deployment Tracking Tools

### 1. My Deployments View
The default view for users is "My Deployments", which filters the deployment list to show only those initiated by the current user. This personalized view ensures users can easily track their own activities without noise from the broader organization.

### 2. Search & Filtering
A powerful client-side search feature allows users to instantly filter their deployment history. Users can search by:
*   **Deployment ID**: To find a specific transaction.
*   **Module Name**: To group deployments by type.
*   **Status**: To quickly find failed or successful deployments.

### 3. Real-Time Updates
The platform utilizes Firestore real-time listeners to ensure the statistics and deployment lists are always up-to-date.
*   **Auto-Refresh**: When a deployment status changes (e.g., from `QUEUED` to `SUCCESS`), the UI updates automatically without requiring a page reload.
*   **Credit Sync**: As deployments consume credits, the credit balance is updated in real-time, providing immediate feedback on the "cost" of platform usage.

## Value Assessment

### Rating System
Users can rate their deployments (1-5 stars). This feedback loop allows users to signal the quality and value of specific modules, contributing to the overall "average rating" of a module that benefits the entire community.

### Cost & Revenue Tracking
For a deeper view of value:
*   **Project Costs**: (If enabled) Users can view the historical credit consumption of their projects.
*   **Revenue**: (For Agents and Partners) Specialized views track revenue generated from their modules or referrals, directly translating platform activity into financial value.
