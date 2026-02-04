# Explore

The RAD platform integrates with **Jules AI** to provide an intelligent assistant for exploring, understanding, and refining your infrastructure modules. This feature allows you to interactively query module details, generate improvement plans, and even automatically create Pull Requests for changes.

## Overview

The Module Exploration feature allows you to:
*   **Understand Modules:** Ask questions about what a specific module does, its inputs, outputs, and dependencies.
*   **Refine Configuration:** Request changes or improvements to module configurations.
*   **Generate Plans:** Get step-by-step plans for implementing new features or fixes.
*   **Create Pull Requests:** Jules can generate code changes and open Pull Requests (PRs) directly against your repository.

## Prerequisites

To use the AI-Powered Module Exploration feature, ensure the following are configured:

1.  **GitHub Repository:** You must have a GitHub repository configured in your [User Profile](./your-profile.md).
2.  **Jules Source:** The repository must be added as a valid **Source** in the Jules AI dashboard.
3.  **API Access:** Your account must be provisioned with the necessary API keys for Jules AI access.

## Accessing the Feature

1.  Navigate to the **Deploy** page or any view where **Module Cards** are displayed.
2.  Locate the module you wish to explore.
3.  Click the **Sparkles Icon** (✨) button located in the bottom-left corner of the module card.
4.  This will open the **Module Exploration** modal.

## Using the Interface

The interface is designed to facilitate a conversation with the AI agent while keeping track of activities and artifacts.

### 1. Session Management
*   **Start/Resume:** When you open the modal, it checks for an existing session for that repository. You can **Resume** the previous session or start a **New Session**.
*   **Status:** The top panel displays the current **Session ID**, **Name**, **State**, and a direct link to the **Session URL** for deep debugging if needed.
*   **End Session:** Click **End Session** to terminate the current interaction. This clears the session history and allows you to start fresh.

### 2. Module Context
The **Current Module** dropdown at the top of the chat interface allows you to focus the AI's attention.
*   **Select a Module:** Choose a specific module from the list to provide context for your questions.
*   **Contextual Prompts:** When a module is selected, your messages are automatically prefixed with `[Context: <module_name>]`, ensuring the AI knows exactly which component you are referring to.
*   **Save Preference:** You can save your preferred module context for future sessions.

### 3. Chat Interface
*   **Message Input:** Type your questions or instructions in the input bar at the bottom.
*   **AI Responses:** Jules will respond with explanations, code snippets, or confirmation of actions. Markdown is fully supported for rich text rendering.

### 4. Activity Log
The Activity Log tracks all interactions and background processes. You can filter the view using the **Filter** menu:
*   **All Activities:** Shows everything.
*   **Messages:** Shows only the chat history between you and Jules.
*   **Progress:** Shows system status updates and background steps.
*   **Plans:** Shows generated plans and strategies.

### 5. Outputs & Artifacts
*   **Plans:** When you ask for a complex change, Jules may generate a structured **Plan** with numbered steps. These appear as cards in the Activity Log.
*   **Pull Requests:** If Jules successfully implements a change, a link to the created **Pull Request (PR)** will appear in the **Outputs** section at the top of the modal.

## Troubleshooting

*   **Source Not Found:** If you see a "No matching source repository found" error, ensure that your GitHub repository URL in your profile matches a repository that has been onboarded to the Jules platform.
*   **Session Errors:** If a session becomes unresponsive, try clicking **Refresh** or **End Session** to restart.
*   **Missing Modules:** If the module list is empty, ensure the system has successfully fetched the latest module data from your repository.
