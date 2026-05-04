# Deployment Rollback Runbook

Use this runbook when a production deployment fails its post-deploy health
check or when a regression is detected after a successful deploy.

## When to use this runbook

- The deploy workflow reports health check failures after three retries.
- `/api/health` or `/api/health/payment-providers` returns non-200 after a
  release.
- A rollback is requested by an incident commander during an active incident.

## Step 1 — Identify the previous stable image

Every successful deploy pushes three GCR tags: `latest`, the commit SHA,
and the GitHub Actions run number. To find the last known-good image:

```bash
# List recent images (replace PROJECT and SERVICE values as needed)
gcloud container images list-tags gcr.io/tec-rad-ui-2b65/cs-rl-web-portal \
  --sort-by=~TIMESTAMP --limit=10
```

Note the tag (commit SHA or run number) of the image immediately before the
bad release.

## Step 2 — Redeploy the previous image via manual workflow

Trigger `.github/workflows/deploy-webapp-manual.yml` with:

- **Deployment method:** `cloudrun` (direct Cloud Run update, faster than
  a full Cloud Build cycle)
- **Custom version tag:** the commit SHA or run number from Step 1
- **Force rebuild:** `false` (the image already exists in GCR)
- **Skip health check:** `false` unless the health endpoint itself is broken

The workflow will deploy the tagged image and run post-deploy health checks.

## Step 3 — Verify recovery

After the workflow completes:

```bash
# Replace URL with the Cloud Run service URL
curl -sf https://<SERVICE_URL>/api/health
curl -sf https://<SERVICE_URL>/api/health/payment-providers
```

Both endpoints should return `200`. The payment-providers endpoint should
show all providers as `healthy` and circuit breakers in `CLOSED` state.

## Step 4 — Communicate and post-mortem

Once traffic is stable:

1. Update the incident channel with the rollback completion time and the
   stable image tag.
2. Open a GitHub issue against the bad commit to track root-cause
   investigation.
3. Block the bad commit from being re-merged until the root cause is
   resolved.

## Terraform rollback

For infrastructure changes applied via `terraform-apply.yml`, the state is
stored in GCS and is versioned. To revert a Terraform change:

1. Identify the previous state version in the GCS bucket.
2. Use `terraform-helper.sh state-list` locally to inspect current state.
3. Restore the previous state version via the GCS console or `gsutil`.
4. Open a PR reverting the offending Terraform change and run the normal
   plan/apply cycle.

Do not use `terraform destroy` on individual resources without team
review — prefer a revert PR through the standard GitOps pipeline.

## See also

- [CI/CD](../practices/cicd.md) — pipeline configuration and health check
  parameters.
- [SRE](../practices/sre.md) — health endpoints and resilience patterns.
- [GitOps & IaC](../practices/gitops_iac.md) — Terraform state management.
- [Disaster Recovery](../capabilities/disaster_recovery.md) — snapshot and
  restore for data-layer recovery.
