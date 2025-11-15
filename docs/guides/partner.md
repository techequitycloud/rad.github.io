## 1. Partner Modules

As a partner, you can deploy modules from the public "Platform Modules" catalog as well as from your own private GitHub repository. Your exclusive modules will appear under the "Partner Modules" tab on the module selection page.

### 1.1. Deploying a Module

- From the **Deployments** page, click the **Create New** button.
- Select the **Partner Modules** tab.
- Browse the available modules. Each module card displays its name, a brief description, and the credit cost to deploy it.
- Click on the card of the module you wish to deploy.

### 1.2. Configuring the Deployment

After selecting a module, you will be taken to the provisioning page, where you need to configure the deployment.

- **Configuration Form:** A form will be displayed with a series of fields. These are the variables required to deploy the module, such as project IDs, regions, or other specific settings.
- **Fill out the Form:** Complete all the required fields with the appropriate information for your deployment.
- **Submit:** Once you have filled out the form, click the **Submit** button. The application will display module dependencies and validate your inputs and, if your credit balance is sufficient, begin the deployment process.

You will be redirected back to the **Deployments** page, where you can monitor the status of your new deployment.

## 2. Configuring Your GitHub Repository

To make your private modules available for deployment, you must first configure your GitHub repository in your profile.

- **Navigate to Profile:** Go to your profile page.
- **Provide a GitHub Token:** In the "Partner Settings" section, enter a GitHub Personal Access Token with `repo` scope.
- **Select the Repository:** Once the token is saved, you can select your private repository from the dropdown list.

The modules from this repository will now appear under the "Partner Modules" tab on the deployment page, visible only to you.

## 3. Publishing Modules

The "Publish" tab allows you to select and publish modules from your configured GitHub repository, making them available for deployment.

### 3.1. The Publish Tab

The publish tab displays a list of modules available for publishing from your configured GitHub repository. It also shows a list of modules that have already been published.

### 3.2. Publishing a Module

- Select the modules you wish to publish by clicking on their names.
- Click the **Publish** (or **Update**) button.

The selected modules will now be available for deployment under the "Partner Modules" tab.

### 3.3. Syncing Logic

The system includes a safeguard to ensure that any modules that no longer exist in your Git repository are removed from the "Deploy" tab. This is particularly important when you change your configured repository URL.

## 4. Credits

As a partner, you have access to the **Credits** page to manage your credits and subscriptions. In addition to purchasing credits, you may also be eligible to receive a monthly credit allowance directly from a platform administrator. These "Partner Credits" are added directly to your "Purchased" credit balance at the beginning of each month.

### 4.1. Buy Credits

This tab is your hub for acquiring more credits. It displays all available subscription tiers and also provides an option for making one-time credit purchases.

- **Subscribing to a Tier:** You can subscribe to a tier to receive a recurring amount of credits. Click the **Subscribe** button on your desired tier to be redirected to a secure payment page. If you have an active subscription, it will be highlighted.
- **One-Time Purchases:** The page also includes a simple interface for making one-time credit purchases through Stripe, which is useful if you need more credits than your subscription provides.

### 4.2. Credit Transactions

This tab provides a detailed history of all your credit transactions, including additions from subscriptions or purchases, and deductions from module deployments.

### 4.3. Project Costs

This tab shows you the ongoing costs associated with your deployed projects.

### 4.4. Monthly Invoices

Here you can view and download your monthly invoices.

## 5. ROI Calculator

The **ROI (Return on Investment) Calculator** is a tool designed to help you estimate the potential financial benefits of using the platform. By inputting data about your current deployment processes, you can see a projection of your savings and efficiency gains.

### 5.1. How to Use the Calculator

- **Navigate to the ROI page:** You can find this in the main navigation.
- **Adjust the sliders:** Modify the inputs to match your team's specific data:
    - **Projected Monthly Deployments:** The number of deployments you anticipate performing each month.
    - **Current Manual Deployment Time (hours):** The average time it takes to complete a deployment manually.
    - **Average Engineer Hourly Cost:** The average hourly cost of an engineer.
    - **Time Savings with RAD:** The percentage time difference between manual deployments and deploying with the platform.
- **View the Results:** The calculator will automatically update with a detailed breakdown of your estimated savings:
    - **Manual Labor Cost (Monthly):** The estimated monthly cost of performing deployments manually.
    - **RAD Labor Cost (Monthly):** The new, lower labor cost when using the RAD platform.
    - **RAD Platform Cost (Monthly):** The cost associated with using the RAD platform.
    - **Net Monthly Savings:** The final estimated monthly savings after subtracting all RAD-related costs from the original manual labor cost.

## 6. Help and Support

The **Help** page is your central resource for documentation and support. It contains:

- **User Guides:** Access to the Admin, Partner, Agent, and User guides.
- **Support Form:** A form to send a message directly to the support team.

## 7. Theme Customization

You can switch between light and dark themes to suit your preference. The theme selector is located in the user menu in the top-right corner of the navigation bar.
