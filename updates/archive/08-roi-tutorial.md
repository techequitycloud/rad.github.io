import AudioPlayer from '@site/src/components/AudioPlayer';

# ROI Workflow

<img src="https://storage.googleapis.com/rad-public-2b65/workflows/roi_workflow.png" alt="ROI Workflow" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/workflows/roi_workflow.m4a" title="ROI Workflow Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/workflows/roi_workflow.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction
This tutorial will guide you through using the ROI Calculator to build a business case for the RAD platform. You will learn how to input your specific data to see exactly how much time and money you can save.

## 2. Step 1: Open the Calculator
1.  Log in to the RAD platform.
2.  Click **Help** in the top navigation bar.
3.  Scroll down to the **ROI Calculator** section.

## 3. Step 2: Set Your Baseline
To get an accurate result, you need to define what your process costs *without* RAD.

1.  **Manual Deployment Time:** Think about your old workflow. How long did a full deployment take? Slide the **Manual Deployment Time** slider to match (e.g., `2` hours).
2.  **Engineer Cost:** Enter your estimated hourly engineering cost. Slide the **Engineer Hourly Cost** slider to an appropriate value (e.g., `$80`/hour).

*Result:* Look at the "Manual Labor Cost" in the results section. This is your baseline monthly spend on deployment toil.

## 4. Step 3: Forecast Your Volume
Next, tell the calculator how much work you plan to do.

1.  **Projected Deployments:**
    *   If you have been using the platform, the calculator will pre-fill this based on your history.
    *   If you plan to scale up, slide the **Projected Monthly Deployments** slider to your target number (e.g., `50`).

## 5. Step 4: Analyze the Savings
Now, see the impact of RAD's automation.

1.  **Review the Savings:** Look at the **Net Monthly Savings**. This is the cash value of the efficiency you gain.
2.  **Check Time Savings:** Look at the **Time Saved per Deployment** summary.
    *   *Example:* If you save 1.5 hours per deployment and do 50 deployments, that's 75 hours of engineering time saved per month!
3.  **Adjust Assumptions:** Try moving the **Time Savings with RAD** slider. Even with a conservative estimate (e.g., 50%), you will likely see a positive ROI.

## 6. Conclusion
You now have a data-driven estimate of the value RAD provides. Use these numbers to:
*   Justify budget for platform credits.
*   Demonstrate the value of automation to stakeholders.
*   Track your efficiency improvements over time.
