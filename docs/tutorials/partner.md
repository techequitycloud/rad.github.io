---
title: Partner Tutorial
---

# Tutorial: Partner Workflow

## Overview

Partners can connect their own GitHub repositories to publish private or shared modules that appear alongside the platform's built-in module catalog. This tutorial walks through connecting your repository, optionally configuring the Jules AI agent, and publishing and deploying your first custom module.

**Audience:** Users with the **Partner** role  
**Estimated time:** 10–15 minutes

By the end of this tutorial you will have:
- Connected your GitHub repository to the platform
- Optionally configured the Jules AI refinement agent
- Published a custom module to the deployment catalog
- Deployed that module as a Partner

---

## Step 1: Connect Your GitHub Repository

1. Click your **Profile Avatar** in the top-right corner and select **Profile**.
2. Scroll down to the **Partner Settings** section.
3. **GitHub Token** — Enter a Personal Access Token with at least `repo` scope. Click **Save Token**. The platform will immediately fetch a list of repositories accessible to that token.
4. **GitHub Repository** — Select your target repository from the dropdown list that appears. Click **Update Repo**.

> **Security:** Keep your GitHub token confidential. Never commit it to a public repository. If you suspect the token has been exposed, revoke it in your GitHub settings and generate a new one.

---

## Step 2: Configure Jules (Optional)

Jules is an AI refinement agent that can analyse your module code, suggest improvements, and help debug deployment failures. This step is optional but recommended for Partners who maintain active module development.

1. In the same **Partner Settings** section, locate the **Jules API Key** field.
2. Enter your Jules API Key. Click **Save Key** (or **Update Key** if a key is already stored).

> **Security:** Treat your Jules API Key like a password. Store it in a secrets manager, not in plain text. Rotate it regularly, particularly after any team member with access leaves your organisation.

---

## Step 3: Publish a Module

1. Click **Publish** in the navigation bar.
2. The platform scans your connected repository and lists all detected valid modules.
3. Find the module you want to publish (for example, `my-custom-app`) and click its card to select it (selected modules are highlighted).
4. Click **Publish** (or **Update** if this module was previously published and you want to refresh its definition).
5. You will be redirected to the **Deploy** page upon success.

> **Note:** Only you and platform Administrators can see modules you publish under the **Partner Modules** tab. Other users will not have visibility unless an Administrator explicitly grants access or promotes the module to the platform catalog.

---

## Step 4: Deploy Your Published Module

1. On the **Deploy** page, click the **Partner Modules** tab.
2. Locate your newly published module (`my-custom-app`) in the list.
3. Click the module card, complete the configuration form, and click **Deploy** — the process is identical to deploying any platform module.
4. Monitor the deployment progress on the **Deployments** page. The build logs will reflect your module's specific Terraform code.

---

## Next Steps

- **[Support Tutorial](./support)** — As a Partner, you share some Support capabilities. Learn how to update module definitions and use Jules for debugging.
- **[User Tutorial](./user)** — Understand the full deployment management workflow available to all users.
- **[Admin Tutorial](./admin)** — If you also hold the Admin role, learn how to promote Partner modules to the platform-wide catalog.
