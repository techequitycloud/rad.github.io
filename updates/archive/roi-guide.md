import AudioPlayer from '@site/src/components/AudioPlayer';

# ROI Guide

<img src="https://storage.googleapis.com/rad-public-2b65/guides/roi_guide.png" alt="ROI Guide" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/guides/roi_guide.m4a" title="ROI Guide Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/guides/roi_guide.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction

The Return on Investment (ROI) Calculator is a powerful tool designed to help you quantify the value of the RAD platform. By inputting your team's specific metrics—such as engineering costs and manual deployment times—you can visualize the potential time and cost savings RAD brings to your organization.

## 2. Accessing the Calculator

The ROI Calculator is located on the **Help** page. Navigate to the **Help** link in the main navigation bar to access it. It is available to all users to help them understand the efficiency gains of using the platform.

## 3. Configuring Your Inputs

The calculator uses a set of sliders to build a financial model tailored to your workflow.

### 3.1. Projected Monthly Deployments
*   **What it is:** The number of deployments you expect to perform in a month.
*   **How it works:** If you have deployment history, the calculator automatically suggests a value based on your last 30 days of activity or your historical average. You can adjust this slider to forecast future growth.

### 3.2. Manual Deployment Time
*   **What it is:** The average time (in hours) it takes an engineer to manually provision infrastructure, deploy code, and verify a deployment without RAD.
*   **Tip:** Include time spent on context switching, waiting for builds, and manual verification steps.

### 3.3. Engineer Hourly Cost
*   **What it is:** The fully burdened hourly cost of an engineer on your team.
*   **Tip:** This should include salary, benefits, and overhead to get an accurate financial picture.

### 3.4. Time Savings with RAD
*   **What it is:** The estimated percentage of time saved per deployment by using RAD's automation compared to your manual process.
*   **Default:** The default is set to a conservative 80%, reflecting the significant reduction in manual toil provided by the platform.

## 4. Understanding the Results

The calculator updates in real-time to show you a breakdown of your potential savings.

### 4.1. Cost Breakdown
*   **Manual Labor Cost:** The estimated cost of doing things the "old way" (Deployments × Manual Time × Engineer Cost).
*   **RAD Labor Cost:** The reduced labor cost when using RAD, accounting for the time savings.
*   **RAD Platform Cost:** Your estimated platform usage fees (credits), based on your actual recent usage.
*   **Net Monthly Savings:** The bottom line: Manual Cost minus the total cost of using RAD (Labor + Platform fees).

### 4.2. ROI & Efficiency
*   **ROI %:** The return on investment percentage. A positive number indicates that the money saved on labor outweighs the cost of the platform.
*   **Time Saved:** See exactly how many hours per deployment—and how many hours per month—you are reclaiming for more productive work.

### 4.3. Actual Deployment Stats
For logged-in users with history, the calculator displays a "Actual Deployment Stats" box. This provides real data on your:
*   Last 30 days deployment count and spend.
*   All-time total deployments.
*   Average deployment duration on the platform.

Use these actuals to refine your inputs and make your ROI projection as accurate as possible.
