import AudioPlayer from '@site/src/components/AudioPlayer';

# Partner Workflow

<img src="https://storage.googleapis.com/rad-public-2b65/workflows/partner_workflow.png" alt="Partner Workflow" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/workflows/partner_workflow.m4a" title="Partner Workflow Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/workflows/partner_workflow.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction
This tutorial is for Partners. You will learn how to connect your own Git repository, publish private modules, deploy and test them, retrieve deployment outputs, and use the Jules AI assistant to refine your modules.

## 2. Step 1: Connect GitHub
1.  Click your **Profile Avatar** -> **Profile**.
2.  Scroll to **Partner Settings**.
3.  Enter your **GitHub Access Token** (ensure it has `repo` scope).
4.  Click the **Fetch Repos** button.
5.  Select your **Repository** from the dropdown list that appears.
6.  Click **Save Github Settings**.

> **Multiple repositories:** You can connect more than one repository. Repeat the steps above for each additional repository — each saved token/repo pair is stored separately, and modules from all connected repositories appear on the Publish page.

## 3. Step 2: Configure Jules (Optional)
Jules is an AI assistant that can help you analyse and improve your Terraform modules directly within the platform.

1.  In the same **Partner Settings** section, scroll to **API Settings**.
2.  Enter your **Jules API Key**.
3.  Click **Save API Settings**.

Once configured, the Jules sparkle icon (✨) will appear on module cards in the Publish page.

### Using Jules to Refine a Module

1.  Navigate to **Publish**.
2.  Find the module you want to improve and click the **Sparkles Icon** (✨).
3.  A Jules session panel opens scoped to that module. You can:
    *   Ask Jules to explain what the module does or review its structure.
    *   Describe an issue a user reported and ask Jules to suggest a fix.
    *   Request that Jules propose improvements to variable names, descriptions, defaults, or module logic.
    *   Attach additional context using **Add Source** (e.g., paste a log snippet or a second Terraform file).
4.  Review Jules's suggestions in the **Activities** list.
5.  Click **Approve** on any suggestion you want to apply, or dismiss ones that don't apply.
6.  After applying improvements, return to the Publish page and click **Update** to push the refreshed module definition to the platform.

## 4. Step 3: Publish a Module
1.  Click **Publish** in the navigation bar.
2.  The page will scan your connected repositories and list valid modules.
3.  Find the module you want to share (e.g., `my-custom-app`).
4.  **Click the module card** to select it.
5.  Click the **Publish** (or **Update**) button.
6.  Success! You are redirected to the Deploy page.

> **Module visibility:** By default, a newly published Partner Module is visible only to you and platform Administrators. To grant access to specific users, contact your platform administrator.

## 5. Step 4: Deploy and Test Your Module
1.  On the **Deploy** page, click the **Partner Modules** tab.
2.  You should see `my-custom-app` listed there.
3.  Click it, configure the variables, and deploy it just like a standard module.
4.  **Partner exemption:** When you deploy a module you own, the credit cost is always zero — no credits are deducted from your balance regardless of the module's defined `credit_cost`.

### Viewing Deployment Outputs

After a successful deployment, the Terraform outputs from your module are available in the platform UI:

1.  Navigate to **Deployments** and click the **Deployment ID** of your module's deployment.
2.  Click the **Outputs** tab.
3.  You will see all values exported by your module's `outputs.tf` — URLs, IP addresses, service endpoints, generated resource names, etc.
4.  These outputs are also the values that your end users will see after deploying your module. Verify that all expected outputs are present and correctly named before sharing the module broadly.

> **Tip:** If an output is missing, check that it is defined in `outputs.tf` and that `terraform apply` completed without errors. Partial apply failures can result in some outputs being unavailable.

## 6. Step 5: Contact a Module Publisher

If you need to reach the publisher of a platform module (for example, to report an issue or request a feature):

1.  Navigate to **Deploy** and open the module card.
2.  Click **Contact Publisher** (if the option is available for that module).
3.  Fill in your message and submit. The message is routed to the module's registered owner.
