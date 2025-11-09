---
title: "Managing Module Versions and Updates"
sidebar_position: 3
description: "Learn how to manage the lifecycle of your custom modules, including versioning, updating, and handling breaking changes."
keywords: ["tutorial", "partner", "module versioning", "updates", "breaking changes"]
---

# Managing Module Versions and Updates

This tutorial covers the best practices for managing the lifecycle of your custom modules. Proper versioning and update strategies are essential for maintaining stability and trust with your module's users.

## What You'll Learn

- How to use Git branches and tags for versioning.
- The process for safely updating a published module.
- How to handle backward-compatible vs. breaking changes.
- Best practices for communicating changes to users.

### Prerequisites

- You have completed the [Creating a Production-Ready Module](./production-module.md) tutorial.
- A solid understanding of Git (branches, tags, and releases).

### Estimated Time

- **30 minutes**

---

## Step 1: Use Git for Versioning

Git is the foundation of module versioning. The RAD Platform uses your Git repository as the source of truth.

### Branching Strategy

-   **`main` branch:** Your `main` branch should always represent the most stable, production-ready version of your module.
-   **Feature branches:** Create new branches for developing new features or making changes (e.g., `feature/add-new-variable`, `fix/bug-in-resource`).

### Tagging and Releases

Once a new version of your module is ready, create a Git tag and a GitHub release.

1.  Merge your feature branch into `main`.
2.  Create a semantic version tag (e.g., `v1.0.0`, `v1.1.0`).

    ```bash
    git tag -a v1.1.0 -m "Add support for new resource type"
    git push origin v1.1.0
    ```

3.  On GitHub, create a new **Release** from this tag. Use the release notes to document what has changed.

    [SCREENSHOT: GitHub release creation page with tag and release notes]

## Step 2: Updating a Published Module

When you update the code in your GitHub repository, you need to re-publish the module in the RAD Console for the changes to take effect.

1.  Push your code changes and new tag to your GitHub repository.
2.  Navigate to the **"Publish"** tab in the RAD Console.
3.  The platform will detect that your module has been updated. The button will now say **"Update"** instead of "Publish".

    [SCREENSHOT: Publish tab showing a module with an "Update" button]

4.  Select the module and click **"Update"**.

This will sync the latest version of your module from GitHub to the RAD Platform.

## Step 3: Handling Different Types of Changes

It's crucial to understand the difference between backward-compatible and breaking changes.

### Backward-Compatible Changes

These are changes that will not break existing deployments.

-   Adding a new optional variable (with a default value).
-   Adding a new resource that doesn't affect existing ones.
-   Adding a new output.

For these changes, you can increment the **minor** version (e.g., `v1.0.0` -> `v1.1.0`).

### Breaking Changes

These are changes that will cause issues for users of the existing module.

-   Renaming a variable.
-   Changing the type of a variable.
-   Removing a resource.
-   Changing the fundamental behavior of the module.

For these changes, you must increment the **major** version (e.g., `v1.1.0` -> `v2.0.0`). This signals to users that they need to review their configurations before upgrading.

## Step 4: Communicate Changes Clearly

Good communication builds trust with your users.

### Use a Changelog

Maintain a `CHANGELOG.md` file in your module's directory. This file should list all the important changes for each version.

```markdown
# Changelog

## [v2.0.0] - 2023-10-27

### BREAKING CHANGES

- Renamed `project_name` variable to `project_id` to be more consistent.

### Features

- Added support for resource X.

## [v1.1.0] - 2023-10-20

### Features

- Added a new variable `enable_logging`.
```

### Write Detailed Release Notes

When you create a GitHub release, use the release notes to explain:

-   What has changed.
-   Why it has changed.
-   How users can upgrade (especially for breaking changes).

## Verification

Your versioning and update process is working well if:

-   Users can successfully deploy different versions of your module.
-   Breaking changes are clearly communicated and don't cause unexpected failures.
-   Your `main` branch remains stable.

## Next Steps

-   Consider setting up a CI/CD pipeline to automate the testing and release process for your modules
-   Explore advanced module development techniques in the documentation
-   Review the [Production-Ready Module](./production-module.md) tutorial for best practices
