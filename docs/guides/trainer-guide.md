---
title: "Trainer Guide"
description: "RAD Platform trainer guide — provisioning lab environments for a course cohort, how the roster works, who pays, and what a trainer can and cannot see."
---

# Trainer Guide

For trainers who run a course on RAD and provision lab environments for their participants. New to RAD? Start with [Using RAD](using-rad.md).

## What you can do

- Deploy a lab environment **for each participant on your roster**, in one action, from the ordinary module form.
- See the lab deployments you provisioned for them, on your own **Deployments** page.
- Update or tear down anything you provisioned, so a finished course does not leave infrastructure behind.

Your top navigation is the same as a standard user's — Trainer adds no page of its own. What it adds is a **Deploy for participants** selector on the deployment form, and sight of the labs you created.

## Your cohort roster

An administrator grants the Trainer role and fills in your **cohort roster**: the participant email addresses you may deploy for. The roster is stored on your own account and is capped at **30 participants**.

Two things follow from that, and they are the ones people find surprising:

- **The roster is the grant.** Emptying it revokes your access completely, without removing the Trainer role. If a participant leaves the course, ask an administrator to take them off the roster.
- **Each participant needs their own RAD account.** A cohort of twenty is twenty accounts, not one shared login. Participants sign up as ordinary users; your roster simply names them.

If someone is missing from your selector, the roster is where to look first.

## Provisioning a cohort

1. **Open a module** from the **Modules** catalog and fill in its configuration as usual.
2. **Switch on "GCP Project on RAD".** The participant selector only appears once this is on. Deploying on someone's behalf into a project *you* brought would attribute their deployment to infrastructure they do not own, so RAD does not offer it.
3. **Choose your participants** in **Deploy for participants**. You can pick from your roster and nothing else; administrators can search every account.
4. **Deploy.** RAD creates **one deployment per participant**, each owned by that participant.

There is no separate cohort screen and no batch import — it is the same form everyone else uses, with one extra field.

### The tier is chosen for you

Selecting participants puts the deployment on the **lab** tier and hides the tier picker. That is not a restriction so much as a definition: the lab tier *is* the cohort case. It has its own Google Cloud folder, its own organization policies and its own budget, kept separate from the customer tiers so that a change made for customers cannot land in the middle of your course.

Select no participants and you get the ordinary three tiers — sandbox, development and production — exactly as any other user does. `lab` is never offered by name on any picker.

### Who pays

**Each participant pays for their own deployment.** Credits come out of the participant's balance, never yours, and every figure on the form — balance, affordability, the cost breakdown — follows the participant rather than your account.

A participant can only be selected once they hold enough **purchased** credits to cover the tier's minimum. Awarded credits do not count toward it. The selector shows each participant's top-up balance beside their address, and greys out anyone who is short, saying exactly how many more credits they need. That is deliberate: a participant hidden from the list looks like a roster mistake, whereas "needs 40 more purchased credits" is something you or they can act on.

Two behaviours worth expecting:

- Change the tier and eligibility is recalculated; anyone who no longer qualifies is dropped from your selection rather than left selected and greyed out.
- Turn **GCP Project on RAD** back off and your participant selection is cleared, because the deployment is no longer one you can make on someone's behalf.

## Managing what you provisioned

The labs you created appear on your own **Deployments** page alongside your personal deployments, and you can **update** or **delete** them.

Being able to destroy them is intentional. A cohort's environments otherwise outlive the course — thirty participants each tearing down their own lab does not reliably happen — and a visible row carrying a Delete button that always fails is worse than either answer.

Note this differs from the Support role, which sees deployments but may never destroy them. The two roles sit on deliberately different lines.

## What a trainer can't do

- **Read a deployment's secrets.** The **Outputs** tab and the deployment's configuration variables stay with the deployment's owner and administrators. If you need a generated password or connection string from a participant's lab, ask them for it — that is a conversation, not a platform read.
- **See a participant's own deployments.** Your visibility covers the labs *you* provisioned, not everything that person owns. Someone on your roster who deploys something for themselves keeps it private from you.
- **Add or remove people from your own roster.** Only an administrator can change it.
- **Deploy for someone into your own project.** The participant selector is unavailable unless RAD manages the project.
- **Act as a participant.** There is no impersonation anywhere in RAD.

## Getting help

- For platform basics — signing in, navigation, credits, and how deployments work — see [Using RAD](using-rad.md).
- For anything about the roster, the tier, or a participant's credits, use the **Help** page's **Support** tab; administrators and finance staff work that queue.
