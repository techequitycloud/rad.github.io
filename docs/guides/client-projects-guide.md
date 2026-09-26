---
title: "Client Projects Guide"
description: "RAD Platform client projects guide — running applications for your own clients as a managed service: funding each project's wallet, inviting your client, deploying for them, pausing and deletion, and handing over."
---

# Client Projects Guide

For subscribers who run applications on RAD **for their own clients**, as a managed service. New to RAD? Start with [Using RAD](using-rad.md).

## What you can do

- Create a **client project** for each client. Each one has its own **wallet** that you fund from your purchased credits, and everything the project costs is paid from that wallet.
- Invite your client by email. They accept from their own RAD account.
- Deploy modules and solutions **for** your client, using the ordinary deploy forms. The deployments belong to your client, and you run them.
- Top up the wallet, or take unused credits back.
- When the engagement ends, **hand the project over** to your client, or let it end.

Your client never pays RAD for a client project. How your client pays you is agreed between the two of you, outside RAD.

## Getting access

Client Projects is for subscribers. Subscribe from **Credits → Subscriptions**. **Client Projects** is the first tab on **Solutions** (while the feature is switched on for the platform), and anyone can open it. Your clients use it to accept your invitation and to see the projects you run for them.

## Creating a client project

On **Solutions → Client Projects**, choose **New client project**:

- **Project name**: up to 100 characters.
- **Your client's email**: the address your client uses, or will use, for RAD. It can't be your own.
- **Region**: one of RAD's regions. Everything in the project runs here, and it can't be changed later.
- **Fund the wallet with**: credits taken from your **purchased** credits. Free credits you were given can't be used. You can start at 0 and top up later.

RAD emails your client an invitation. If it couldn't be sent, **Resend invitation** sends it again. You can resend once every ten minutes.

## Your client accepts

Your client signs in with the **exact address you invited**, creating an account if they don't have one, and confirms their email address if RAD asks. On **Solutions → Client Projects** they see your invitation under **Invitations for you** and choose **Accept**.

Nothing can be deployed until they accept.

## Deploying for your client

On a running project, choose **Deploy**. RAD switches to the **Solution Modules** tab (or pick a solution from **Platform Solutions** or **Custom Solutions**), and a banner at the top of every page says you are deploying for that client, with the region and the wallet balance. Pick a module or solution and deploy it as usual. While the banner is showing:

- the deployment **belongs to your client**, and you manage it;
- it goes into the project's own RAD-managed Google Cloud project, in the **production** environment, created the first time you deploy;
- it runs in the project's region;
- the cost estimate and every balance check use the **wallet**, not your own credits.

Choose **Stop deploying for this client** on the banner when you're done. Otherwise the next thing you deploy is also for them.

Your client's Google Cloud project gives you the same Console access your client has, so you can operate the service. You can view, update and delete the project's deployments, but you can't read the secret values in them, such as passwords and API keys. Those are your client's.

Your client can see what you deploy for them, but can't change or delete it while you manage it.

## What the wallet pays for

Everything the project costs is taken from its wallet:

- **module fees**. The module's publisher earns their usual share of these;
- **build costs** for each deploy, update and delete;
- the project's **Google Cloud running costs**, metered hourly.

A first build that fails is not charged. Google reports running costs a little late, so the wallet can go **below zero**; your next top-up covers that first.

The wallet balance is shown on **Client Projects**. In your credit history, charges paid from a wallet are labelled **Client project wallet**, with no balance of your own beside them. Money you put into, or take out of, a wallet shows as **To / From client project wallet**.

### Topping up and withdrawing

- **Top up**: adds credits from your purchased credits. Available whenever the project hasn't ended.
- **Withdraw**: returns unused credits to your top-up credits, which never expire. Available while the project is waiting for your client or running, up to what the wallet holds.

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

## If your subscription ends

Your client projects keep running on their wallets until the wallets run out, and then they pause and are deleted as above. While you have no active subscription you can't deploy, withdraw or hand over, but you **can** top up to keep a project running. Subscribe again and you manage them as before.

## Getting help

Use **Help → Support** in RAD, or email the support address shown there.
