import AudioPlayer from '@site/src/components/AudioPlayer';

# Partner Workflow

<img src="https://storage.googleapis.com/rad-public-2b65/workflows/partner_workflow.png" alt="Partner Workflow" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/workflows/partner_workflow.m4a" title="Partner Workflow Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/workflows/partner_workflow.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction
This tutorial is for Partners. You will learn how to connect your own Git repository and publish a private module for deployment.

## 2. Step 1: Connect GitHub
1.  Click your **Profile Avatar** -> **Profile**.
2.  Scroll to **Partner Settings**.
3.  Enter your **GitHub Access Token** (ensure it has `repo` scope).
4.  Click the **Fetch Repos** button.
5.  Select your **Repository** from the dropdown list that appears.
6.  Click **Save Github Settings**.

## 3. Step 2: Configure Jules (Optional)
1.  In the same **Partner Settings** section.
2.  Enter your **Jules API Key** if you wish to use the AI refinement agent.
3.  Click **Save API Settings**.

## 4. Step 3: Publish a Module
1.  Click **Publish** in the navigation bar.
2.  The page will scan your repo and list valid modules.
3.  Find the module you want to share (e.g., `my-custom-app`).
4.  **Click the module card** to select it.
5.  Click the **Publish** (or **Update**) button.
6.  Success! You are redirected to the Deploy page.

## 5. Step 4: Deploy Your Module
1.  On the **Deploy** page, click the **Partner Modules** tab.
2.  You should see `my-custom-app` listed there.
3.  Click it, configure it, and deploy it just like a standard module.
4.  Remember: Only **you** and **Administrators** can see this module.
