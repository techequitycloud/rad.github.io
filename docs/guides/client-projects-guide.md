---
title: "Client Projects Guide"
description: "RAD Platform client projects guide — running applications for your own clients as a managed service: funding each project's wallet, inviting your client, deploying for them, pausing and deletion, and handing over."
---

# Client Projects Guide

For partners and users with purchased credits who run applications on RAD **for their own clients**, as a managed service. New to RAD? Start with [Using RAD](using-rad.md).

## What you can do

- Create a **client project** for each client. Each one has its own **wallet** that you fund from your purchased credits, and everything the project costs is paid from that wallet.
- Invite your client by email. They accept from their own RAD account.
- Deploy modules and solutions **for** your client, using the ordinary deploy forms. The deployments belong to your client, and you run them.
- Top up the wallet, or take unused credits back.
- When the engagement ends, **hand the project over** to your client, or let it end.

Your client never pays RAD for a client project. How your client pays you is agreed between the two of you, outside RAD.

## Getting access

Starting a client project needs **purchased credits** (a top-up or a subscription; free signup, monthly and referral credits do not count) — partners always have access. Buy credits from **Credits → Buy Credits**. Once a project exists you can go on managing it whatever your balance: deploying, topping up, withdrawing, handing over and ending all stay open to you. Client projects live on **Solutions → Managed Environments**, after **Solution Catalog** (while the feature is switched on for the platform), next to lab sessions, and anyone can open it. Your clients use it to accept your invitation and to see the projects you run for them.

## Creating a client project

On **Solutions → Managed Environments**, filter to **Client projects** and choose **New client project**:

- **Project name**: up to 100 characters.
- **Your client's email**: the address your client uses, or will use, for RAD. It can't be your own.
- **Region**: one of RAD's regions. Everything in the project runs here, and it can't be changed later.
- **Fund the wallet with**: credits taken from your **purchased** credits. Free credits you were given can't be used. You can start at 0 and top up later.

RAD emails your client an invitation. If it couldn't be sent, **Resend invitation** sends it again. You can resend once every ten minutes.

## Your client accepts

Your client signs in with the **exact address you invited**, creating an account if they don't have one, and confirms their email address if RAD asks. On **Solutions → Managed Environments** they see your invitation under **Invitations for you** and choose **Accept**.

Nothing can be deployed until they accept.

If they don't want it, they choose **Decline** instead. The project is closed, the whole wallet comes back to your top-up credits, and RAD emails you. You can invite them again with a new project.

## Deploying for your client

Choose **Open / Deploy** on a running project. Its own page shows the wallet, what has been spent, roughly how many days the wallet covers at the current rate, and everything deployed for the client. Deploy from the **Deploy for** panel on the same page:

- **Module**, **Platform solution** or **Custom solution**: pick one and choose **Configure**. The usual deploy form opens.
- **Describe what they need instead (Build Solution)**: answer the questions in plain language. You aren't asked where it runs or where it lives, because a client project already decides both.

That one deployment is for your client:

- the deployment **belongs to your client**, and you manage it;
- it goes into the project's own RAD-managed Google Cloud project, in the **production** environment, created the first time you deploy;
- it runs in the project's region;
- the cost estimate and every balance check use the **wallet**, not your own credits.

The confirmation dialog names the client wallet that pays, so check it before you confirm. **Deploy** covers one deployment: once it is submitted, your next deploy is your own again. To deploy something else for the client, deploy from their project's page again. Coming back to **Managed Environments** without deploying also cancels it.

Your client's Google Cloud project gives you the same Console access your client has, so you can operate the service. You can view, update and delete the project's deployments, but you can't read the secret values in them, such as passwords and API keys. Those are your client's.

Your client can see what you deploy for them, but can't change or delete it while you manage it.

## What the wallet pays for

Everything the project costs is taken from its wallet:

- **module fees**. The module's publisher earns their usual share of these;
- **build costs** for each deploy, update and delete;
- the project's **Google Cloud running costs**, metered hourly.

A first build that fails is not charged. Google reports running costs a little late, so the wallet can go **below zero**; your next top-up covers that first.

The wallet balance is shown in the **Client projects** view and on the project's own page. In your credit history, everything to do with a wallet is labelled **Client wallet**: charges paid from it (with no balance of your own beside them), and the credits you put in or take out, where the sign shows the direction.

### Topping up and withdrawing

- **Top up**: adds credits from your purchased credits. Available whenever the project hasn't ended.
- **Withdraw**: returns unused credits to your top-up credits, which never expire. Available while the project is waiting for your client or running. Once the project has running costs, two days of them stay in the wallet: RAD pauses a project with a day or less left, so withdrawing more would switch your client's services off. With nothing running yet, you can withdraw everything.

## When the wallet runs low

When about **a day** of running costs is left, RAD **pauses** the project: billing is switched off, and everything is kept. You and your client are both emailed.

Top up so the wallet holds at least **two days** of running costs, and the project comes back on its own, usually within 15 minutes.

If a paused project isn't topped up within the **pause period** (set by RAD, 7 days unless your administrator has changed it), it is **permanently deleted**:

- the day before, you're emailed a final warning;
- once it's deleted, you and your client are both told;
- a couple of days later, when Google's final costs are in, the wallet is settled with you. Unused credits go back to your top-up credits, and any shortfall is charged to your purchased credits.

If you've switched off deployment notifications, RAD holds the deletion rather than deleting without warning you.

## Handing over to your client

At the end of an engagement you can hand the project over. It then becomes your client's own, and your part ends. Only a **running** project can be handed over.

1. Choose **Hand over**, then **Request handover**. From then on nothing new can be deployed, while the project keeps running on its wallet. You can cancel the request.
2. RAD waits until every cost from before your request is in: any build still running has finished and Google's usage for the period has been reported. This usually takes less than a day.
3. Choose **Complete handover**. If RAD is still waiting, it says what for; try again later.

When the handover completes:

- unused wallet credits go back to your top-up credits, and any shortfall is charged to your purchased credits. Any refund you give your client is agreed between you, outside RAD;
- the deployments become your client's ordinary deployments, paid from **their** credits from then on;
- your access to them, and your Console access to their project, ends.

Your client needs enough **purchased** credits to keep a production project running. If they don't have them, the handover is refused and RAD tells you how many they need, so ask them to buy credits first.

## Ending a project

To stop running a project without giving it to your client, choose **End project** on a project that is invited, running or paused, and confirm. It works like a lab's **End now**:

1. The project becomes **Ending**. Nothing new can be deployed, and RAD starts removing its deployments: the apps first, then the shared services and the Google Cloud project itself. Nothing is kept.
2. Choose **Finish ending** to move it along. Each time, RAD removes the next part or says what it is waiting for: a removal still running, or Google's final usage for the project, which usually arrives within a day. The removal builds are paid from the wallet, like any other build.
3. When nothing is left and every cost is in, the project closes. Unused wallet credits go back to your top-up credits, and any shortfall is charged to your purchased credits.

A project that was never deployed, such as one your client hasn't accepted yet, closes straight away. A pending handover must be cancelled before you can end the project.

## If your balance runs out or your subscription ends

Nothing changes for the projects you already run. Managing them does not depend on a subscription or on your own balance: each runs on its own wallet, and you can deploy, top up, withdraw, hand over and end it as before. You need purchased credits only to **start** a new client project.

## Oversight

Finance and administrators see every client project on the platform, read-only, under **All client projects** on the same tab: who runs it, for which client, its status and its wallet. They cannot change or end a project from there.

## Getting help

Use **Help → Send Message** in RAD to raise a ticket, and follow it on the **My Tickets** tab beside it.
