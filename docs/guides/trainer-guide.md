---
title: "Trainer Guide"
description: "RAD Platform trainer guide — running lab sessions: creating a session, choosing who pays, onboarding participants, provisioning and starting environments, and how unused credits come back to you."
---

# Trainer Guide

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Trainer_Guide.png" alt="Trainer Guide" style={{maxWidth: "100%", borderRadius: "8px"}} />

For trainers who run a course on RAD and give each participant their own lab environment in Google Cloud. New to RAD? Start with [Using RAD](using-rad.md).

## What you can do

- Run **lab sessions** from the **Labs** page. A session is a named cohort of participants that shares a time window, a per-participant credit allowance and a region.
- Choose, per session, **who pays** for a participant's place: you, or each participant.
- Build the same module or solution into every participant's environment in one action, start their clocks, add time or credits, and end environments early.
- Get back every credit your participants did not use once the session settles. Those credits are yours to keep.

You don't need a separate roster or a special deploy form. Everything happens on the **Labs** page. If you open an ordinary deploy form, it points you back there with **Open lab sessions**.

## Getting access

You need the **Trainer** role, and an administrator must have switched **lab sessions** on for the platform. Once both are true, **Labs** appears in your navigation. If it doesn't, ask an administrator.

Administrators and finance staff can see and manage every trainer's sessions. When they add credits or participants to your session, the credits still come from **your** purchased credits, and you are told who acted.

## Creating a session

On **Labs**, choose **New session**. The dialog asks for:

- **Session name** — up to 100 characters.
- **Participant emails** — paste a list. The dialog confirms how many addresses it recognised. An address it can't read stops the whole session from being created, so nothing is charged for a list that was only partly understood. How many participants a session may hold is set by your administrator.
- **Credits per participant** — each participant's allowance. It can't be lower than the minimum a lab environment needs, or higher than the ceiling your administrator sets.
- **Duration (minutes)** — how long each participant's environment runs once their clock starts, up to 24 hours.
- **Countdown starts** — **By trainer** (you start the clocks) or **When ready** (each clock starts as soon as that environment is built).
- **Region** — one of RAD's regions, fixed for the session.
- **Overrun ceiling (%)** — how far above an allowance an environment may run before it is switched off (default 20%). You can change this while the session is open.
- **Participants buy their own place** — who pays. See the next section.

You choose the module or solution later, on the session itself, not in this dialog.

## Who pays

You decide when you create the session. **That choice is fixed once the session exists.** To run a session the other way, create a new one.

**You pay (the default).** The whole cohort's allowance — participants × credits per participant — is reserved from your **purchased** credits when you create the session. Free credits you were given can't be used. The dialog shows what you hold, what is taken and what you'll have left. Adding participants or credits later is also paid from your purchased credits.

**Participants buy their own place.** Nothing is reserved from your credits. Each participant pays the credits per participant from their own purchased credits (free credits don't count), and that payment becomes their allowance. **Nobody's environment is built until they have paid.** Participants you add later buy their own place too.

When does a participant's payment become yours? Only once **that participant's clock starts**, which is the moment they get access to their lab. Until then their payment is held. If they never get access — their environment was never built, or failed to build, or was never started — their payment is returned to them when the session settles.

### What happens to unused credits

Whichever way the session is funded, whatever the participants did not use comes back to **you** when the session settles, into your top-up credits, which don't expire. In a session where participants pay, that remainder is your margin.

If environments run beyond their allowance, the overrun is charged to your purchased credits, up to the ceiling you set.

### When a session settles

Settlement waits until Google has reported the session's cloud costs. That usually takes up to a day after the last environment was switched off, because Google's billing data arrives late. Settling any earlier would pay you back credits the environments had in fact already used.

The session's **Settlement** panel shows what was committed, consumed and refunded, plus any overrun charged to you. You also get an email, **"Lab session settled"**, unless you turned it off in your notification preferences. Every movement appears in your credit history as **Lab session escrow** and **Lab session refund** entries.

## Participants

**Each participant needs their own RAD account**, under the exact email address you enrolled.

- **Participants without an account** are emailed an invitation to sign up. A **Resend** button on their row sends it again, but not more often than every 10 minutes.
- **Participants who already have an account** are emailed to say they have been added.
- **In a session where participants pay,** both emails tell them they must buy their place before anything is built, and how to do it. They pay from the lab banner at the top of every RAD page.

To add people to a running session, use **Add participants**. In a session you fund, the dialog shows what it will take from your credits before you confirm. An address already in the session — even one you removed earlier — can't be added again.

To stop people, tick their rows. **End selected** switches their environments off. **Remove** also takes them off the session. Their unused allowance comes back to you at settlement.

## Building and running environments

1. **Choose what to build** on the session: **Module** or **Solution**, then search the catalogue. Fill in the module's first page of settings; the region always comes from the session.
2. **Provision.** RAD shows a plan with the cost per participant and in total before anything starts. Environments build a few at a time, so a large cohort takes longer to finish.
3. **Start the clocks.** An environment that has finished building shows **Ready** and waits for you. Use **Start all** or **Start selected**. With **When ready**, clocks start on their own. Each participant gets the full duration from their own start.
4. **While it runs,** use **Extend time** to add time to running environments (the total can't pass the session's maximum), **Add credits** to top up allowances, or **Add to running** to deploy something extra into environments that are already running without touching their clocks.

An environment that is built but never started can't wait for ever: by default, after a week unstarted it is torn down, not started.

### When time runs out

Participants are warned 15 and 5 minutes before their time ends. At the end, the environment's billing is switched off, the participant's access is removed and the lab project is deleted. An environment is also switched off early if it uses up its credits, or if its spending passes the overrun ceiling.

Use **End now** to end the whole session at any time. A session nobody provisions is ended automatically after 14 days.

## What your participants see

Participants see a lab banner at the top of every RAD page. It shows:

- when their environment is being built;
- when it is ready and waiting for you to start their clock;
- once it runs, their time and credits left, and a link to their project in the Google Cloud console.

When their clock starts they get access to their project in the console. They can look at deployments, logs and storage, restart workloads and run existing jobs. They can't read secrets or create resources, and everything is deleted when the lab ends.

Participants can't deploy anything themselves in a lab. Every lab deployment is yours.

## What a trainer can't do

- **Change who pays** after creating a session. Create a new session instead.
- **Read secrets** on lab deployments: their configuration variables, outputs and generated passwords stay with administrators.
- **Use advanced settings** when updating a lab deployment. Only administrators can.
- **See a participant's own deployments.** Your access covers the lab environments in your sessions, not anything a participant deploys for themselves.
- **Force a teardown.** Only administrators can.
- **Change a session's region, or edit a session once it has ended.**

## Getting help

- For platform basics — signing in, navigation, credits, and how deployments work — see [Using RAD](using-rad.md).
- For access to lab sessions, the participant ceiling or a participant's credits, use the **Help** page's **Support** tab. Administrators and finance staff work that queue.
