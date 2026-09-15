# Automatic production deployment

Updates to `main` run `.github/workflows/deploy.yml`. The workflow installs locked dependencies, runs lint, unit tests, TypeScript and a production build, deploys `gamba-league-web` in `us-central1`, then publishes Firebase Hosting and checks the public URL. It can also be run manually from GitHub Actions on `main`.

Deployments are serialized and running deployments are not cancelled. Failed checks prevent deployment. Cloud Run and Hosting are separate releases: if Hosting fails after Cloud Run succeeds, inspect the failure and rerun the workflow. There is no automatic rollback. Cloud Run retains the service's existing public-access policy.

This automates the two existing web-host deployment commands. Cloud Functions, Firestore rules/indexes and season/data administration remain separate releases. Deploy backend/index changes before a frontend that depends on them. Emulator integration tests require their own demo setup and are not run by this web deployment workflow.

## One-time Google Cloud connection

Use Workload Identity Federation with a dedicated deployment service account; no downloaded service-account key is needed. Restrict the provider to repository ID `1361481095`, owner ID `38513074`, and `refs/heads/main`. Grant `roles/iam.workloadIdentityUser` on the deployment service account to that repository's federated principal.

The deployment identity needs `roles/run.sourceDeveloper`, `roles/serviceusage.serviceUsageConsumer`, and `roles/firebasehosting.admin` on project `gamba-league`, plus `roles/iam.serviceAccountUser` on the existing Cloud Run runtime service account. Verify the Cloud Build identity used for source deployment has `roles/run.builder`. Inspect existing identities and permissions before adding bindings.

Set these repository Actions variables after creating the provider:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`: full `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` name.
- `GCP_DEPLOY_SERVICE_ACCOUNT`: dedicated deployment service-account email.

Exclude `gha-creds-*.json` in `.gitignore`, `.gcloudignore`, and `.dockerignore` before activating the workflow so temporary authentication files cannot enter a build or release.

After configuration, run the workflow once and verify both the Actions result and the live site. A committed workflow alone does not mean automatic deployment is operational.
