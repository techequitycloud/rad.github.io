---
title: ROI Tutorial
---

# Tutorial: Maximising ROI with the Calculator

## Overview

The ROI Calculator helps you build a data-driven business case for the RAD platform. By entering your current deployment process metrics, the calculator shows you exactly how much engineering time and money RAD's automation saves — both per deployment and at scale.

**Audience:** Any authenticated user  
**Estimated time:** 5–10 minutes

By the end of this tutorial you will have:
- Set a baseline representing your current manual deployment process
- Projected your expected deployment volume
- Analysed the time and cost savings RAD delivers
- Produced figures you can use for stakeholder reporting or budget justification

---

## Step 1: Open the ROI Calculator

1. Log in to the RAD platform.
2. Click **Help** in the top navigation bar.
3. Click the **ROI** tab.

The calculator page consists of two sections: **Input Sliders** on the left (or top) and a **Results Panel** on the right (or bottom) that updates in real time as you adjust the inputs.

---

## Step 2: Set Your Baseline

The baseline represents what your deployment process costs **without RAD**. Accurate inputs here are essential — if you are unsure of exact figures, use conservative estimates; even conservative estimates typically show a strong positive ROI.

1. **Manual Deployment Time** — Slide to the number of hours a complete manual deployment takes from start to finish in your current workflow. This should include provisioning, configuration, testing, and any handoffs (for example, `2` hours).
2. **Engineer Hourly Cost** — Enter your blended hourly engineering cost, including salary, benefits, and overhead (for example, `$80`/hour).

The **Manual Labour Cost** in the results panel now shows your baseline monthly expenditure on deployment work, calculated as:

```
Manual Labour Cost = Manual Deployment Time × Engineer Hourly Cost × Monthly Deployments
```

---

## Step 3: Forecast Your Deployment Volume

1. **Projected Monthly Deployments** — Slide to the number of deployments you plan to run per month.
   - If you have already been using the platform, the calculator may pre-fill this based on your actual deployment history.
   - If you are evaluating RAD before adoption, set this to your realistic near-term target (for example, `50`).

> **Tip:** It is worth running the calculator twice — once with a conservative volume estimate and once with an ambitious target — to show the range of potential savings to stakeholders.

---

## Step 4: Analyse the Savings

With your baseline and volume set, review the output in the Results Panel.

1. **Net Monthly Savings** — The total cash value of engineering time reclaimed by RAD's automation, net of platform costs.
2. **Time Saved per Deployment** — The number of hours saved on each individual deployment compared to your manual process.
3. **Total Monthly Hours Saved** — Net Monthly Savings expressed in engineering hours.

   *Example: If RAD saves 1.5 hours per deployment and you run 50 deployments per month, that is 75 hours of engineering time saved — nearly two full working weeks.*

4. **Adjust the Time Savings with RAD slider** — This represents your confidence level in the automation efficiency. Even at a conservative `50%` efficiency assumption, most teams see a strongly positive ROI. Slide it upward as you accumulate real deployment history.

---

## Conclusion

The ROI Calculator gives you a defensible, data-driven estimate of the value RAD delivers. Use the output to:

- **Justify platform budget** — Demonstrate to finance stakeholders that credit costs are significantly outweighed by engineering time savings.
- **Demonstrate automation value** — Show leadership concrete numbers rather than anecdotal efficiency claims.
- **Track improvements over time** — Run the calculator monthly as your deployment volume grows to show the compounding value of the platform.

---

## Next Steps

- **[User Tutorial](./user)** — Learn how to manage deployments and credits to maximise the efficiency gains the calculator models.
- **[Agent Tutorial](./agent)** — If you refer others to the platform, the ROI Calculator is a useful tool for demonstrating value to potential sign-ups.
- **[Getting Started Tutorial](./getting-started)** — If you haven't deployed your first module yet, start here.
