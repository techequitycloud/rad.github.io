# Testing Strategy Proposal

This document outlines the recommended testing strategy for the Terraform modules in this repository. The goal is to ensure reliability, maintainability, and security across all modules, particularly given the shared "Symlink Architecture" where changes in core modules (e.g., `App_GKE`) impact multiple consuming applications.

## 1. Static Analysis & Linting
These checks should run on every commit/PR to catch syntax errors and style violations early.

*   **`terraform fmt`**: Ensures consistent formatting.
*   **`terraform validate`**: Checks for syntax validity and internal consistency.
*   **`tflint`**: A pluggable linter for Terraform.
    *   **Recommendation**: Enable the Google Cloud plugin for `tflint` to catch provider-specific issues (e.g., invalid machine types).

## 2. Policy as Code (Unit/Property Testing)
These tests verify that the infrastructure code adheres to security and compliance policies without deploying resources.

*   **Tools**: `Checkov` or `Conftest` (Open Policy Agent).
*   **Scope**:
    *   Ensure encryption is enabled (e.g., Cloud SQL, GCS).
    *   Verify public access is restricted (e.g., no open firewall rules 0.0.0.0/0).
    *   Validate resource naming conventions.

## 3. Integration Testing (Recommended: Terratest)
Integration tests verify that the Terraform modules actually work by deploying them to a real environment (GCP) and validating the results. This is the industry standard for robust Terraform testing.

*   **Tool**: **Terratest** (Go library).
*   **Why**:
    *   Allows writing tests in Go, leveraging a powerful programming language.
    *   Provides helper functions for Terraform, GCP, Kubernetes, and more.
    *   Supports parallel execution.
*   **Workflow**:
    1.  **Setup**: `terraform init` and `terraform apply`.
    2.  **Verify**: Use GCP SDK or Kubernetes client to check:
        *   Resources exist.
        *   Applications are running (HTTP 200 OK).
        *   Outputs are correct.
    3.  **Teardown**: `terraform destroy` (always runs, even on failure).

### Proposed Directory Structure
```
tests/
├── go.mod                  # Go module definition
├── go.sum                  # Go dependencies
├── test_structure.go       # Helper functions
├── sample_gke_test.go      # Test for Sample_GKE module
├── moodle_gke_test.go      # Test for Moodle_GKE module
└── ...
```

## 4. End-to-End (E2E) Testing
E2E tests validate the entire stack, from foundational infrastructure (`Services_GCP`) to application deployment (`App_GKE`).

*   **Scope**:
    *   Deploy `Services_GCP` (VPC, GKE Cluster, Cloud SQL).
    *   Deploy an application module (e.g., `Moodle_GKE`) into that infrastructure.
    *   Perform functional tests on the application (e.g., log in, create a post).

## 5. CI/CD Integration
*   **Pull Requests**: Run Static Analysis and Unit Tests. Optionally run a subset of Integration Tests (e.g., for modified modules) using a temporary environment.
*   **Nightly/Weekly**: Run full Integration and E2E suites to catch regressions in long-running resources or external dependencies.

## Implementation Plan
1.  Initialize `tests/` directory with Go and Terratest.
2.  Implement a baseline test for `Sample_GKE`.
3.  Gradually add tests for critical modules (`App_GKE`, `Moodle_GKE`).
