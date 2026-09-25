---
title: "User Guide"
description: "RAD Platform user guide — building a solution from a plain description, deploying modules and solutions to Google Cloud, managing your deployments, and credits and subscriptions."
---

# User Guide

<img src="https://storage.googleapis.com/rad-public-2b65/guides/User_Guide.png" alt="User Guide" style={{maxWidth: "100%", borderRadius: "8px"}} />

This guide is for anyone using RAD to deploy and manage cloud modules — the default **User** role. New to RAD? Start with [Using RAD](using-rad.md).

## What you can do

- Answer four plain questions on **Build Solution** and have RAD work out which applications you need, what the whole thing costs, and deploy them.
- Browse the module catalog on **Solutions → Solution Modules** and deploy ready-made modules through a guided form.
- Track and manage your own **Deployments** — view results and logs, update, and tear down.
- Manage **Credits** — check your balance, review your transaction history, and buy more while the platform is selling credits.
- Subscribe to a recurring credit plan, when plans are on offer.
- Estimate your savings with **Calculate ROI**, on the **Credits** page.
- Get help through the **Send Message** form on **Help**.
- Invite others with your referral link, from **Profile → Refer and earn**.

After you sign in you land on **Solutions**, on the **Build Solution** tab — signing in opens on what you can build rather than the list of what you built last time.

**Solutions** holds everything you can deploy, on four tabs:

- **Build Solution** — four questions that end in a working, priced solution. Start here if you know what you want to achieve but not what it is called.
- **Custom Solutions** — the bundles you have composed yourself.
- **Platform Solutions** — ready-made bundles curated by RAD.
- **Solution Modules** — the full catalog of individual applications.

Your top navigation shows **Credits** (when credits are enabled), **Deployments**, **Solutions**, and **Help**.

## Building a solution from a description

On **Solutions → Build Solution** — also reachable directly at **/build** — describe what you want people to be able to do, in your own words, no app names needed. RAD works out which applications deliver it, then asks three short questions:

1. **Where should it run?** Your own Google Cloud project is the default: you keep the billing relationship, your organization's policies, and the project itself afterwards. Choosing a **RAD-managed project** instead puts the infrastructure inside RAD's own organization and billing account, and you then also say what the environment is for — trying things out, for your developers, or for your end users. A RAD-managed project also asks you to be holding a minimum balance of purchased credits, which the page states. That is a balance requirement, not a charge.
2. **Where should it live?** Pick the location closest to the people who will use it. Your own project can use any Google Cloud region; a RAD-managed project offers the locations RAD supports — the cheapest in each part of the world. RAD checks this again when you deploy: a location outside that list, in any location setting (including one that takes several locations), is refused before anything is reserved or built, and the message names the setting to change.
3. **What should we call it?** A name for your own reference, plus a short name (up to seven letters or numbers) used inside your cloud resources. Reuse that short name later to share the same cloud resources.

If the applications RAD proposes aren't quite right, use **Not quite? Tell us what to change** underneath them — say what to add or drop, and RAD reworks the set instead of starting from scratch. You can also remove a single application, or **Start over** to clear your answers and the proposal together.

A panel beside the questions shows **what you'll get**, **what it costs** and **how long it takes** — the whole cost, including the shared services RAD adds for you, split into what is taken when you build and what is metered as each part finishes, alongside a build-duration estimate such as "about 1h 20m". **Build this** deploys it. **Show the engineering detail** opens the same solution on the full configuration form if you would rather set everything yourself.

### Bringing your own Google Cloud project

Deploying into a project you already own means RAD's deployment service account does the work inside it, so it needs access first. Before anything deploys, you prove you control the project: choose **Get verification code**, run the commands shown as a project Owner (for example in Cloud Shell) — they add a verification label and give RAD read-only **Browser** access — then choose **Verify**; the code expires in one hour. You then grant the deployment service account the **Owner** role on the project; RAD names the exact account and shows the command. If another RAD account has already registered the same project, you are added to it as a collaborator. Free (awarded) credits can pay for a deployment into your own project.

### What a RAD-managed project needs

A RAD-managed project asks for two things before RAD can create it: a **verified email address**, and a minimum balance of **purchased** credits for the purpose you chose. Free (awarded) credits — such as the ones you receive when you sign up — do not count toward that minimum. The page shows how many purchased credits you have against what is needed, with a **Buy credits** link, as soon as you choose the option. The header shows your balance split into purchased and free credits for the same reason.

## Finding a module

Open **Solutions** and choose the **Solution Modules** tab to browse the module catalog. Modules appear as cards.

- **Browse:** You see a single combined catalog of public modules — both modules published by RAD and public modules published by partners.
- **Search:** Use the search bar to find a module by name, then page through the results.
- **Filter by category:** Use the category list beside the grid to narrow the catalog to one category. Each entry shows how many modules it holds; **All** clears the filter.
- **Pin:** Click the pin on a card to keep a favourite module at the top of your catalog for quick access.
- **Read each card:** Every card shows the module description, a **documentation** link, an average star rating, how many times it has been deployed, and a **credit cost** badge.
- **Get help on a module:** Click **Help** on a card to open the Get Support dialog. It has three tabs: **End User Support** raises a support ticket about the module, **End User Training** requests paid help setting it up (RAD gets in touch within one business day), and **Contact Publisher** emails the module's publisher with a question.

A stats strip at the top shows total deployments, your current credit balance (when credits are enabled), and how long deployment history is retained.

## Deploying a module

1. **Choose how to configure it.** Click a module card and pick **Configuration Form** (the default) or **Conversational Assistant**. The assistant describes every setting in one go, then applies only the changes you accept — each proposed change is shown for you to apply individually, so nothing is set without your say-so. You can switch between the two at any time. Two things the assistant will not do: it never sees or sets a **secret** (an API key or password) — it tells you the field exists and you type the value into the highlighted box on the page, never into the chat — and it will not accept a value that breaks a field's own rule, telling you what the rule is and asking for a corrected one rather than quietly changing what you typed.
2. **Open the form.** The guided configuration form. The first time you deploy a module, the form shows only the essential (mandatory) fields — administrative and internal fields are hidden from you, and optional advanced configuration is deferred. You can unlock the full set of configuration steps later, from the deployment's **Update** action: tick **Enable advanced mode**, which is available once your credit balance covers the estimated cost of the update. Advanced mode carries no module fee — updates never do — and is not available on a lab environment.
3. **Fill in the configuration.** Complete the required fields on each step (for example, project and region). Move forward when each step is valid. The form is generated from the module itself, so where the module declares a rule for a field — a naming pattern, a length limit — you see that module's own error as you type rather than several minutes into a failed build. Fields holding a secret (an API token, a password) are masked and stored in Google Secret Manager rather than saved with the rest of your configuration; because the value never comes back to the browser, such a field shows **Configured** or **Not configured** instead, and leaving a configured one blank keeps it rather than clearing it.
4. **Confirm.** The **What will be deployed** panel at the top of the form lists everything this deployment builds — in a RAD-managed project that includes the Google Cloud project and shared services — and marks each one **Will be created**, **Will be updated first**, **Already exists, reused** (free) or **Needs attention first**; you cannot deploy while anything needs attention. Before launching, a confirmation dialog may appear — for example when the module costs credits, has dependencies, or needs special permissions. Review the details, including how many credits the deployment will cost.
5. **Deploy.** Click **Deploy Module** to queue the deployment. If you don't have enough credits, RAD shows the module's credit cost against your current balance and prompts you to top up first.

**What happens next:** Your deployment is queued and then provisioned on Google Cloud. RAD opens the deployment's own page on its **Build Status** tab so you can follow its progress; it is also listed on the **Deployments** page.

## Deploying a solution

A **solution** deploys several modules together as one unit, in the right order, into a single tenant. Click **Solutions** in the top navigation. Two of its four tabs hold ready-to-deploy bundles — the other two are **Build Solution** and **Solution Modules**, described above.

**Platform Solutions** are pre-composed by RAD — browse by category, open one to see its members, fill in the shared configuration once, and deploy the whole bundle. Members that depend on another wait for it automatically.

A solution with three or more members costs less than deploying the same modules one by one: its **module fees** are discounted by 15% for three or four members, 20% for five or six, and 25% for seven or more. The discount covers module fees only — build time, and a RAD-managed project's own costs, are charged as normal. The confirmation dialog shows the discount it applied.

**Custom Solutions** are your own, composed in conversation. Describe what you want to build — "I need a marketing site with a blog and email campaigns" — and RAD suggests modules from the catalog with a short reason for each. Add the ones you want (up to 12), give it a name, and save it. Your custom solutions are private to you.

- A saved solution shows **Draft** until you deploy it, then **Deployed**. A draft can be edited in place; once it has deployed, editing offers to copy it into a new draft instead, so the record of what you actually built stays accurate.
- **Delete** removes the saved solution only. It never touches infrastructure you have already deployed — tear that down from the **Deployments** page.
- RAD connects members to each other only where a known connection exists between those two applications. Where two members have no such connection, it says so on the card rather than guessing — they still deploy, you just wire them up yourself if they need to talk.

## Managing your deployments

Click **Deployments** to see your deployments. Each row shows the module, the deployment ID, an editable **star rating**, when it was created, how long it took, the status, and the action. There's no project or credits column — open a deployment for its project, and its **Builds** tab for what each build consumed.

Deployment statuses include Queued, Pending, Working, Waiting (on a prerequisite deployment to finish), Success, Failure, Internal Error, Deleting, Deleted, Cancelled, Timeout, and Expire.

Open a deployment to see its details, which has these tabs:

- **Outputs** — starts with the page to open: **First-time setup** when the application needs setting up before its first use, **Open application** otherwise, or — for a module with no web interface — the API address to connect to. Below that are the rest of the non-sensitive results (such as addresses and endpoints exported by the module). These appear once the deployment succeeds.
- **Build Status** — live logs, useful for watching progress or troubleshooting a failure. Once the deployment has succeeded, **Explain this** opens a plain-English explanation of the Google Cloud resources it created, written for someone who does not read Terraform. It sends only the *kinds* of resource involved and how many of each — never your project ID, resource names, email addresses or any configured values. It also links the module's own documentation page, so the explanation is grounded in how that module actually works rather than in general knowledge. On a step that has *failed*, **Search for a fix** opens a search built from the actual error the step printed, and **Ask for help** raises a support request with that same output attached.
- **Builds** — the build history for the deployment.

From the details view you can also:

- **Update** — reopen the configuration form (pre-filled with the current values), change what you need, and re-apply. Available once a deployment has finished — succeeded, failed, timed out, been cancelled, or expired. Update also needs some *purchased* credits on your account: if you hold only awarded credits, RAD shows a **Credits Required** prompt instead of opening the form, with a **Top Up Credits** button to **Buy Credits** while the platform is selling credits.

  Two things can stop an update before you get to the form. If this deployment depends on another one that has **failed**, been cancelled or timed out, RAD refuses and lists the deployments to start first — fix those, then retry. (A prerequisite that is still building is fine: the update is accepted and parked until it finishes.) And if you edit a setting that cannot be changed on a running deployment — a region, an encryption key, a toggle that creates a resource — RAD raises a confirmation naming exactly which settings will destroy and rebuild resources. Where your administrator has switched on **Enforce Update Safe**, those fields are read-only instead, and the only way to change one is to delete the deployment and create a new one.
- **Cancel** — shown while a deployment is in Queued or Waiting, before it starts building. Cancelling releases it so you can try again, and a cancelled Waiting deployment also releases anything waiting behind it. The same button appears for a purge that has gone an hour without progress.
- **Delete** — remove the deployment. You get two choices:
  - **Delete** runs a teardown that destroys the cloud resources the deployment created. This includes a RAD-managed GCP project (the "GCP Project on RAD" option): because deleting it takes the whole project with it, RAD refuses while any other deployment is still running in that project and lists the ones to delete first. Google keeps a deleted project recoverable for about 30 days.
  - **Purge** removes the deployment from RAD *without* destroying the cloud resources. Use Purge when a deployment is stuck or was changed outside RAD.

  A deployment that is part of a solution can be deleted or purged only from the solution's page.

To **rate a module**, go back to the **Deployments** list and click the stars on that deployment's row — the rating isn't set from the details page, and you can only rate deployments you made yourself.

## Credits

Open the **Credits** page to manage your balance.

Your credits sit in four separate balances, and they behave differently:

- **Awards** — free credits: your signup grant, monthly grants, and referral rewards. These are reset each month.
- **Event credits** — free credits you claimed with an event code (see below). They expire on their own date, shown when you claim them, rather than with the monthly reset.
- **Subscription** — credits from a subscription plan. Where the platform is set to reset them, a renewal replaces the allowance rather than adding to it.
- **Top-up** — credits you bought outright as a one-off. These never expire.

Spending draws on awards first, then event credits, then subscription, then top-up — so the credits that expire soonest are used first, and the ones you bought outright are kept until last.

Deploying a module charges two things. The **module fee** is reserved when you confirm and charged when the deployment first succeeds — including when a failed deployment is later fixed by an update. The **build cost** is metered from how long each build actually runs, at the platform's credits-per-build-hour rate, and charged as each build finishes.

**The confirmation dialog quotes the whole chain, not just the application you picked.** Deploying into a RAD-managed project also creates your private Google Cloud project and the shared services your applications use, and those carry their own costs — the dialog lists them under *"RAD also sets these up for you"* with a combined total. It also separates what is reserved when you confirm from what is metered as each build finishes, so the second charge is not a surprise. Build costs are estimates until the build completes, so the final figure can differ a little.

Updating a deployment charges the build cost only.

**Failed deployments.** Whether a deployment that fails is charged is a platform setting rather than a fixed rule: Finance decides, separately for the build cost and the module fee, whether either is taken when a new deployment fails or is cancelled. **In the current release neither is charged — a failed deployment costs you nothing.** A failed update or teardown is not charged either.

The Credits page has these tabs:

- **Credit Transactions** — your full history of awards, purchases, and spend, with an **Awards**, **Top-up**, and **Subscription** balance after each entry. Filter by deployment and by date, and use **Export CSV** to download a report.
- **Project Transactions** (when project credits are enabled) — what each Google Cloud project cost you, one row per project, with a project search and a date range. A project charge lands on Credit Transactions as a single combined row covering all your projects at once; this tab is the breakdown of that charge.
- **Subscriptions** (only while the platform is selling credits) — subscribe to a recurring credit plan, or cancel or reinstate the one you have.
- **Buy Credits** (only while the platform is selling credits) — top up your balance.
- **Calculate ROI** — the ROI calculator described below, always the last tab.

Whether credits can be bought at all is a single platform switch. While it is off there are no new subscriptions and no one-off top-ups, and the two tabs above are not shown; if you already have a subscription, a notice on **Credit Transactions** still lets you cancel it.

**To buy credits:** open the **Buy Credits** tab, pick a payment provider, choose a currency and amount, and complete checkout on the provider's secure page. The form shows the minimum top-up (set by RAD's finance team, in USD) converted into your currency, and the form tells you how many credits the amount will buy before you pay. Your credits are added automatically once the payment confirms.

Some deployments require *purchased* credits (subscription or top-up, not awards or event credits) before you can start them — in that case, buy credits first even if you have a free balance.

**Event codes.** A RAD partner event may give you a code for free credits. Enter it under **Have an event code?** on the **Credits** page, or open the link the event gave you, which fills the code in for you. Each code can be claimed once per account and needs a verified email address; some codes are limited to particular attendees or email domains, and every code has a closing date. Event credits pay for module fees and build time, but not for Google Cloud usage in a RAD-managed project, and they do not count toward the purchased-credit minimum a RAD-managed project asks for.

## Subscriptions

A subscription is an optional recurring plan that grants a set number of credits each billing cycle.

- **Subscribe:** choose a plan and complete checkout via your chosen payment provider. You can hold only one subscription at a time — to move to a different tier, or a different payment provider, cancel the one you have first and wait for it to lapse at the end of the current billing period.
- **Cancel:** stop future renewals. Your remaining credits stay available until you spend them.
- **Reinstate:** resume automatic renewals on a cancelled plan if you change your mind.

A subscription only grants credits — it does not change your role on the platform.

## ROI calculator

Open **Credits** and go to the **Calculate ROI** tab to use the interactive ROI calculator. It comes pre-filled with your real recent activity (your deployments and spend) and lets you adjust assumptions — monthly deployments, manual deployment time, engineer hourly cost, and time-savings percentage — to estimate your labour cost, platform cost, net savings, and return on investment. It's an estimator only: it never deploys anything or charges your account.

## Seeing what you've spent

You can see your own spending two ways on the **Credits** page. **Credit Transactions** lists every award, purchase, and deployment charge on your account, filterable by deployment and date. **Project Transactions** — available whenever project credits are enabled — breaks the project side of that down per Google Cloud project, showing the credits debited and the underlying cloud cost for each one over a date range you choose.

Platform-wide reporting is still restricted: the **Module Costs** and **Project Invoices** tabs and the whole **Billing** page are limited to administrators and finance users. If you need a formal invoice, ask through the Support form.

## Email notifications

Choose which emails RAD sends you on your **Profile** page, under **Email Notification Settings**. **Deployments** covers every email about your deployments — build results, lab emails, and the warnings RAD sends before it permanently removes something of yours. **Billing** covers credit and payment emails. (Support staff also see **Support ticket assigned to me**.) One email ignores these settings: if a build costs more credits than you have, you are always told what you owe, because it explains why your next top-up gives you less.

Turning **Deployments** off stops all of those emails, including the warnings. Because RAD never permanently removes anything without warning you first, those removals are **held** while the setting is off: a RAD-managed project whose billing was switched off for lack of credits is not deleted, and a deployment removed from your list after the retention period is kept rather than permanently erased. When you turn deployment emails back on, the warnings are sent. For a held deployment record, the full notice period starts from that warning. For a held RAD-managed project, the project can be deleted as soon as the following day, so act on that warning straight away.

## Getting help

Open **Help** and use the **Send Message** tab to raise a question or report a problem. Fill in the form to send your message — this raises a support ticket and notifies the support team, who follow up with you. Raising a ticket needs purchased credits (a subscription or a top-up) while credits are on sale; without any, the form shows a prompt to buy credits instead. While the platform is not selling credits, anyone can raise a ticket. You can raise up to 5 tickets in 24 hours. A **Contact us** link in the footer also takes you to the Help page.

Your tickets are on the **My tickets** tab, next to **Send Message**, newest first: each shows its status (**New**, **In progress**, **Resolved** or **Closed**), subject and the date you sent it, and expanding one shows its category, priority, module, the date it was resolved and your message. **Refresh** reloads the list. Sending a ticket takes you straight to this tab, so the one you just raised is what you see.

## Inviting others

Your referral link is on your **Profile**, in the **Refer and earn** section (the **Credits** page also has a **Get your referral link** shortcut). People who sign up through it are linked to your account, and you earn referral credits for them, subject to any monthly limit the platform sets. The section is hidden only when the platform has turned referral rewards off.
