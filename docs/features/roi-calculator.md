---
sidebar_label: 'ROI Calculator'
---

# ROI Calculator Explained

The ROI calculator is a tool designed to help you estimate the potential financial benefits of using the RAD platform. It works by comparing the costs of your current manual deployment processes to the projected costs and savings you could achieve with RAD.

## Key Assumptions

The calculator's primary assumption is the percentage of time saved by using the RAD platform for deployments. This is a critical variable in the calculation, and it is fully customizable.

- **Time Savings with RAD**:The default assumption is that the RAD platform will save 80% of the time it currently takes to perform a manual deployment.

## User Input Required

To tailor the calculation to your specific situation, you are prompted to provide the following inputs, which are presented as adjustable sliders:

- **Projected Monthly Deployments**:The number of deployments you expect to perform each month.
  - **Default Value**: 20 (This value is automatically updated with your actual monthly deployment count from the last month if you are an existing user).
- **Current Manual Deployment Time (hours)**:The time it takes for you to perform a single deployment manually.
  - **Default Value**: 24 hours.
- **Average Engineer Hourly Cost**:The average hourly cost of one of your engineers.
  - **Default Value**: $75/hour.
- **Projection Years**:The number of years over which you want to project the cumulative savings.
  - **Default Value**: 3 years.

## How the ROI is Calculated

The ROI and other savings metrics are calculated using the following formulas:

- **Manual Monthly Cost**: This establishes the baseline cost of your current manual deployment process.
  - **Formula**: `Projected Monthly Deployments * Current Manual Deployment Time * Average Engineer Hourly Cost`

- **RAD Labor Cost (Monthly)**: This is the estimated labor cost when using the RAD platform, factoring in the time savings.
  - **Formula**:First, it calculates the Time Saved per Deployment based on the Time Savings with RAD percentage. Then, it determines the New Deployment Time and calculates the cost.

- **RAD Platform Cost (Monthly)**: This is the cost of using the RAD platform, which is fetched from your historical data. For new users, this is $0.

- **Net Monthly Savings**: The total savings you can expect per month.
  - **Formula**: `Manual Monthly Cost - (RAD Labor Cost + RAD Platform Cost)`

- **Potential Annual Savings**: The total savings you can expect per year.
  - **Formula**: `Net Monthly Savings * 12`

- **Annual ROI**: The return on your investment on an annual basis.
  - **Formula**: `((Annual Savings - Annual RAD Platform Cost) / Annual RAD Platform Cost) * 100`

- **Payback Period (Months)**: The number of months it will take for your savings to cover the platform's cost.
  - **Formula**: `Monthly RAD Platform Cost / Net Monthly Savings`

- **Cumulative Savings**: The total projected savings over the number of Projection Years you select.
  - **Formula**: `(Net Monthly Savings * Projection Years * 12) - (Monthly RAD Platform Cost * Projection Years * 12)`

## Customization Options

- **Inputs**:You can adjust all the input values using sliders to see how the results change in real-time, allowing you to model various scenarios.
- **Assumptions**:You can also customize the "Time Savings with RAD" percentage to align with your expectations.

## Scenario for New Users

If you are a new user with no historical data on the platform:

- The **Projected Monthly Deployments** will default to 20.
- The **RAD Platform Cost (Monthly)** will be $0.
- The calculations will be based entirely on the default values and your manual inputs, providing a projection-based estimate.

## How Calculations Evolve with Platform Usage

As. you use the RAD platform, the calculator becomes more accurate and personalized:

- The **Projected Monthly Deployments** value is automatically updated with your actual deployment count from the previous month.
- The **RAD Platform Cost (Monthly)** is updated with your actual platform costs.

This use of real data transforms the ROI calculator into a dynamic tool that provides an increasingly accurate reflection of the value you are getting from the platform.
