---
title: "Understanding the RAD Platform Architecture"
sidebar_position: 1
description: "A technical deep dive into the architecture of the RAD Platform, explaining how it integrates with Google Cloud services to automate infrastructure deployment."
keywords: ["tutorial", "architecture", "technical overview", "GCP", "Cloud Build"]
---

# Understanding the RAD Platform Architecture

This tutorial provides a technical overview of the RAD Platform's architecture. Understanding how the platform works under the hood is essential for advanced users, partners, and administrators who want to leverage its full potential.

## What You'll Learn

- The key components of the RAD Platform.
- How the platform integrates with Google Cloud Platform (GCP) services.
- The end-to-end flow of a deployment, from user submission to resource creation.
- The role of Terraform and Cloud Build in the deployment pipeline.

### Prerequisites

- A basic understanding of cloud computing concepts.
- Familiarity with Google Cloud Platform is helpful but not required.

### Estimated Time

- **25 minutes**

---

## Core Components

The RAD Platform is composed of several key components that work together to provide a seamless user experience.

[DIAGRAM: High-level architecture diagram showing the RAD UI, Backend, and GCP services]

-   **RAD UI (Frontend):** A Next.js web application that provides the user interface for browsing modules, configuring deployments, and managing billing.
-   **RAD Backend (API):** A set of serverless functions that handle user authentication, data storage, and communication with GCP services.
-   **Google Cloud Platform (GCP):** The underlying cloud infrastructure that powers the platform.

## Integration with GCP Services

The RAD Platform is deeply integrated with several GCP services:

-   **Google Cloud Identity:** For secure user authentication and authorization.
-   **Firestore:** A NoSQL database used to store all platform data, including user profiles, module definitions, and deployment history.
-   **Cloud Build:** The engine that runs the deployment pipelines. It executes Terraform commands to create and manage infrastructure.
-   **Cloud Storage:** Used to store deployment artifacts, such as Terraform configuration files and logs.
-   **Pub/Sub:** A messaging service used to asynchronously trigger deployment pipelines.

## The Deployment Pipeline

Let's walk through the end-to-end process of a deployment.

[DIAGRAM: A sequence diagram illustrating the deployment pipeline flow]

1.  **User Submits Deployment:** The user configures a module in the RAD UI and clicks "Submit".

2.  **API Request:** The UI sends a request to the RAD backend API to create a new deployment.

3.  **Data Stored in Firestore:** The backend creates a new deployment document in Firestore with a `QUEUED` status.

4.  **Message Published to Pub/Sub:** The backend publishes a message to a Pub/Sub topic, containing the details of the deployment.

5.  **Cloud Function Triggered:** A Cloud Function is subscribed to this topic. When it receives the message, it triggers a new Cloud Build pipeline.

6.  **Cloud Build Executes Terraform:** The Cloud Build pipeline performs the following steps:
    a.  Clones the module's Git repository.
    b.  Initializes Terraform (`terraform init`).
    c.  Applies the Terraform configuration (`terraform apply`) using the variables provided by the user.
    d.  Streams the logs back to the RAD Platform in real-time.

7.  **Resources Created in GCP:** Terraform communicates with the GCP APIs to create the actual cloud resources (e.g., virtual machines, databases).

8.  **Status Updated in Firestore:** As the pipeline progresses, its status is updated in the Firestore document. Upon completion, the status is set to `SUCCESS` or `FAILURE`.

9.  **UI Updates in Real-Time:** The RAD UI listens for changes to the Firestore document and updates the deployment status in real-time for the user.

## Security and Permissions

-   **User Authentication:** All access to the platform is protected by Google Cloud Identity.
-   **Service Accounts:** Cloud Build pipelines execute with a dedicated service account. The permissions of this service account determine what resources can be created in the user's GCP project.
-   **Least Privilege:** The platform is designed to follow the principle of least privilege, ensuring that each component only has the permissions it needs to perform its function.

## Verification

By understanding this architecture, you can better diagnose issues, create more effective modules, and have a deeper appreciation for the automation the RAD Platform provides.

## Next Steps

-   [Security Best Practices on RAD Platform](./security-best-practices.md)
-   Review the `cloudbuild.yaml` file in a module repository to see the pipeline definition in action.
