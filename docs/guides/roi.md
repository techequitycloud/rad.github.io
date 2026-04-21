
# ROI Guide

<YouTubeEmbed videoId="0UefEWxQ9Rk" poster="https://storage.googleapis.com/rad-public-2b65/guides/roi_guide.png" />

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/guides/roi_guide.pdf" target="_blank" rel="noopener noreferrer">Download Guide PDF</a>

## 1. Introduction

The ROI (Return on Investment) Calculator is an interactive tool available to all platform users. It allows you to estimate the time and cost savings your organisation achieves by deploying infrastructure with RAD compared to traditional manual provisioning workflows. This guide explains each input field, how calculations are performed, and how to interpret the results.

## 2. Accessing the ROI Calculator

Navigate to the **ROI** page using the link in the top navigation bar. The page is available to all authenticated users regardless of role.

## 3. Input Fields

### 3.1. Deployments per Month
Enter the total number of infrastructure deployments your team performs each month across all projects. This includes new deployments, re-deployments, and environment refreshes.

### 3.2. Manual Deployment Time
Enter the average number of hours required to manually provision an equivalent environment without RAD automation. This should include time spent on:
- Writing and reviewing infrastructure code
- Configuring cloud resources manually in the console
- Running tests and validating the deployment
- Documenting the process

### 3.3. Hourly Engineering Cost
Enter the fully-loaded hourly cost of a software or infrastructure engineer performing this work. Include salary, benefits, and any applicable overhead rates to arrive at a realistic figure.

### 3.4. RAD Deployment Time
Enter the average time (in hours or fractions thereof) that RAD takes to complete the same deployment end-to-end. This can be found on the deployment status page after a deployment completes.

## 4. Calculated Outputs

| Metric | Description |
|--------|-------------|
| **Hours Saved per Month** | `(Manual Time − RAD Time) × Deployments per Month` |
| **Cost Saved per Month** | `Hours Saved per Month × Hourly Engineering Cost` |
| **Annual Cost Savings** | `Cost Saved per Month × 12` |
| **Efficiency Gain (%)** | `((Manual Time − RAD Time) / Manual Time) × 100` |

## 5. Interpreting Results

- **High hours saved** indicates significant automation leverage, especially valuable for teams with frequent deployment cycles.
- **Annual cost savings** can be used directly in budget justification documents or platform adoption proposals.
- **Efficiency gain percentage** communicates the productivity uplift to non-technical stakeholders.

## 6. Tips for Accurate Estimates

- Use actual deployment logs to determine your RAD deployment time rather than estimates.
- Include all roles involved in manual deployments (e.g., DevOps, security review, QA) when calculating the hourly cost.
- Re-run the calculator periodically as your deployment volume grows to track cumulative savings.
