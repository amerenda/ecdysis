# Adding a UAT Environment

Steps to set up a new UAT database and backend for ecdysis.

## 1. Create the database and user on Cloud SQL

```bash
gcloud sql databases create ecdysis_uat --instance=k3s-dean-postgres --project=amerenda-k3s

ECDYSIS_UAT_PASS=$(openssl rand -base64 24)
echo "ecdysis_uat password: $ECDYSIS_UAT_PASS"

gcloud sql users create ecdysis_uat \
  --instance=k3s-dean-postgres \
  --password="$ECDYSIS_UAT_PASS" \
  --project=amerenda-k3s
```

## 2. Create Bitwarden secret

Create a secret named `dean-cloud-sql-ecdysis-uat-password` with the password value.

## 3. Gitops manifests (k3s-dean-gitops)

Three files are needed in `apps/ecdysis/ecdysis-backend-uat/`:

### deployment.yaml

- Copy from `ecdysis-backend/deployment.yaml`
- Change `name` and `app` labels to `ecdysis-backend-uat`
- Set `replicas: 1`
- Change secret ref to `cloud-sql-postgres-credentials-uat`
- Change DATABASE_URL user to `ecdysis_uat` and database to `ecdysis_uat`
- Cloud SQL proxy points at the same instance: `amerenda-k3s:us-east1:k3s-dean-postgres`
- Reuses the same `cloud-sql-sa-key` secret (already in ecdysis namespace)

### service.yaml

- ClusterIP service named `ecdysis-backend-uat` on port 8082

### cloud-sql-externalsecret.yaml

- ExternalSecret `cloud-sql-postgres-credentials-uat` pulling `dean-cloud-sql-ecdysis-uat-password` from Bitwarden

## 4. Frontend UAT

The frontend-uat deployment in `apps/ecdysis/frontend-uat/` should have its nginx config proxy `/api` to `ecdysis-backend-uat:8082` instead of the prod backend.

## 5. Database reset

The backend has a `POST /api/admin/reset-database` endpoint that:
- Drops and recreates all moltbook tables
- **Hardcoded safety**: refuses if the database name doesn't contain "uat"
- The Setup page shows a "Reset Database" button only when `is_uat` is true in the health response

## 6. Verify

After ArgoCD syncs:
```bash
kubectl get pods -n ecdysis -l app=ecdysis-backend-uat
kubectl logs -n ecdysis -l app=ecdysis-backend-uat -c cloud-sql-proxy --tail=5
```

Tables are auto-created on first startup. No data migration needed — UAT starts empty.
