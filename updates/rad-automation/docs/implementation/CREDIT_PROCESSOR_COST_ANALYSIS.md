# Credit Processor Cost Analysis

## Overview

This document explains why the `cs-rl-credit-processor` Cloud Run service costs significantly more than other Cloud Functions in the same project, such as `cf-rl-credit-currency` and `cf-rl-credit-low`.

## Cost Drivers

The primary driver for the cost difference is the **execution frequency**.

### 1. Execution Frequency

*   **`cs-rl-credit-processor`**: Originally configured to run **every 5 minutes** (`*/5 * * * *`).
    *   288 executions per day.
    *   8,640 executions per month.
*   **Other Functions (e.g., `cf-rl-credit-currency`)**: Configured to run **once daily** (e.g., `0 1 * * *`).
    *   1 execution per day.
    *   30 executions per month.

This creates a ~288x difference in invocation volume.

### 2. Resource Allocation Model

The `cs-rl-credit-processor` is a Cloud Run Service configured with:
*   `min_instance_count = 0` (Scales to zero when idle).
*   `cpu = "1"`
*   `memory = "512Mi"`

Because it scales to zero, every execution after an idle period (usually 15 minutes) incurs a **cold start**. However, since it runs every 5 minutes, the instance might remain active but idle between requests.
Crucially, for Cloud Run Services with `min_instances=0`, you are billed for the **active processing time** of the request.

In contrast, `cf-rl-credit-currency` (Cloud Function Gen 2) is configured with:
*   `min_instance_count = 1` (Always keeps one instance warm).

For `min_instance_count = 1`, you are billed for the idle instance at a significantly lower rate (approx. 10x cheaper than active CPU).
The `credit-processor`, running every 5 minutes, accumulates significant **active CPU time** (processing requests), which is billed at the higher active rate.

### 3. Active Processing Time

Based on the cost of ~$11.51/month for `credit-processor`:
*   Estimated monthly active time: ~13,200 seconds (assuming standard pricing).
*   Estimated time per execution: ~46 seconds.

Each run involves:
1.  Checking Firestore for pending background jobs.
2.  Checking Firestore for webhook retries.
3.  Occasional cleanup tasks (10% probability).

Even if no jobs are pending, the overhead of container startup (if cold), runtime initialization, and Firestore connection setup contributes to the execution time. If the logic takes ~46 seconds on average, repeating this 288 times a day accumulates to a substantial billable duration compared to a single daily run of other functions.

## Remediation Plan

To optimize costs, we are implementing the following changes:

1.  **Reduce Frequency**: Changed schedule from every 5 minutes (`*/5 * * * *`) to **hourly (`0 * * * *`)**. This reduces daily invocations from 288 to 24 (a 12x reduction).
2.  **Resource Allocation**:
    *   Retained original resource allocations (CPU/Memory) for both `cs-rl-credit-processor` and `cs-rl-web-portal` to ensure performance stability.

This change significantly lowers the active billing footprint by reducing invocation volume while maintaining the necessary computational power for each execution.
