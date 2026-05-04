# App_CloudRun Backup Import Deep Dive

## 1. Overview
The `modules/App_CloudRun` module provides a built-in mechanism to hydrate the application database (MySQL or PostgreSQL) from a backup file stored in Google Cloud Storage (GCS) or Google Drive. This feature is critical for disaster recovery, environment cloning, and initial data seeding.

## 2. Architecture & Implementation

The feature is implemented using **Cloud Run Jobs**, decoupled from the main application service. This ensures that long-running imports (up to 30 minutes) do not block the application startup or cause timeouts in the Terraform execution context.

### Key Components

1.  **Terraform Configuration (`jobs.tf`)**:
    *   Defines `google_cloud_run_v2_job` resources:
        *   `gcs_backup_job`: For GCS sources.
        *   `gdrive_backup_job`: For Google Drive sources.
    *   Uses `null_resource` with `local-exec` provisioners to trigger these jobs synchronously during `terraform apply`.
    *   Manages dependency ordering: `Postgres Extensions` -> `Backup Import` -> `Custom SQL Scripts`.

2.  **Execution Scripts (`scripts/core/`)**:
    *   `import-gcs-backup.sh`: Handles GCS downloads via `gsutil`.
    *   `import-gdrive-backup.sh`: Handles Drive downloads via `gdown`.
    *   Both scripts run inside a `debian:12-slim` container, install necessary clients (`mysql-client`, `postgresql-client`), and pipe data to the DB.

## 3. Supported Formats & Sources

### Sources
*   **Google Cloud Storage (GCS):**
    *   **Variable:** `backup_source = "gcs"`
    *   **URI:** `gs://bucket-name/path/to/backup.sql`
    *   **Mechanism:** Uses `gsutil cp` (authenticated via the Cloud Run Service Account).
    *   **Recommendation:** Production standard due to reliability and speed.

*   **Google Drive:**
    *   **Variable:** `backup_source = "gdrive"`
    *   **ID:** The file ID string from the Drive URL.
    *   **Mechanism:** Uses `gdown` python package.
    *   **Limitation:** Subject to Google Drive download quotas and API limits.

### Formats
The scripts automatically detect and handle the following formats:
1.  **SQL (`.sql`)**: Raw SQL dump. Executed directly.
2.  **Archives (`.tar`, `.tar.gz`, `.tgz`, `.zip`)**:
    *   The script downloads the archive to `/tmp`.
    *   It extracts the contents.
    *   It searches for the **first** `.sql` file found in the extracted directory.
    *   It pipes that SQL file to the database.

### Databases
*   **MySQL:** Supported. Uses `mysql` command.
*   **PostgreSQL:** Supported. Uses `psql` command.
*   **SQL Server:** Not supported (scripts explicitly exit with "not yet implemented").

## 4. Process Flow

1.  **Initialization:**
    *   Terraform detects `enable_backup_import = true`.
    *   It provisions the Cloud Run Job with environment variables: `BACKUP_URI`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `BACKUP_FORMAT`, etc.

2.  **Trigger:**
    *   The `null_resource` triggers. It calculates a hash of the backup configuration. If the backup URI or format changes, the job runs.
    *   Command: `gcloud run jobs execute [JOB_NAME] --wait`.

3.  **Job Execution:**
    *   **Setup:** Installs `python3`, `pip`, `gdown` (if drive), `unzip`, `mysql-client`, `postgresql-client`.
    *   **Download:** Fetches the file to `/tmp/backup.[format]`.
    *   **Extraction:** If archive, extracts to `/tmp/backup_extracted`.
    *   **Import:**
        *   **MySQL:** `mysql -h $DB_HOST ... < file.sql`
        *   **Postgres:** `psql -h $DB_HOST ... -f file.sql`
    *   **Cleanup:** Removes temporary files.

## 5. Troubleshooting & Support

*   **Logs:** Execution logs are visible in the Google Cloud Console under Cloud Run Jobs -> Logs.
*   **Timeouts:** The job timeout is set to **1800 seconds (30 minutes)** in `jobs.tf`. For larger backups, this value needs to be increased in the Terraform module.
*   **Permissions:** The Cloud Run Service Account must have:
    *   `roles/storage.objectViewer` on the source GCS bucket.
    *   `roles/cloudsql.client` to connect to the DB.
*   **Connectivity:** The job runs in the VPC. Ensure Serverless VPC Access or Direct VPC Egress is configured correctly to reach the Cloud SQL private IP.
