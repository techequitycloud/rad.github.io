---
title: "Documenso sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Documenso sur GKE Autopilot dans votre propre projet Google Cloud — installation guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Documenso_GKE.md @ 3055034 sha256:e0ca3e2665e2 -->

# Documenso sur GKE Autopilot — Guide de lab {#documenso-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Documenso_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Documenso est une alternative open source à DocuSign — une application Next.js + Prisma
pour envoyer, signer et gérer des documents à signature électronique. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Documenso on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Documenso. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Documenso_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d'exécution et effectuer
  la configuration initiale du compte de Documenso.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant qu'Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Documenso (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Documenso_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, par exemple la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (`NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`,
   `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`, une paire de clés HMAC pour le transport facultatif
   des téléversements via S3, et le mot de passe de la base de données), un bucket Cloud Storage `uploads`,
   une instance Cloud Filestore (NFS), une Gateway avec une IP statique
   réservée, construit l'image de conteneur personnalisée et exécute un job unique
   d'initialisation de la base de données. Les premiers déploiements prennent environ **20–35 minutes**
   (la création de Cloud SQL en représente l'essentiel).

3. Connectez-vous au cluster et découvrez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep documenso | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe. Documenso
   utilise par défaut `enable_custom_domain = true`, si bien qu'une Gateway avec une IP statique
   réservée est provisionnée automatiquement ; si `application_domains` est laissé vide, un
   nom d'hôte `nip.io` basé sur cette IP est utilisé :

   ```bash
   kubectl get pods,svc,gateway -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service répond. Documenso n'a pas de point de terminaison de santé dédié —
   la sonde de démarrage est un `GET /` HTTP avec une marge généreuse d'environ 10 minutes pour
   absorber le démarrage à froid et les migrations Prisma du premier démarrage :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}"   # expect 200 (or a redirect to /signin)
   ```

3. Ouvrez `http://${EXTERNAL_IP}` (ou l'URL `nip.io`/de domaine personnalisé attribuée) dans
   un navigateur. Documenso ne provisionne **aucun compte administrateur initial** — la première
   personne qui termine l'inscription via l'interface web de l'application devient propriétaire
   du compte. Créez ce compte maintenant.

4. Définissez `webapp_url` sur le domaine/l'IP stable via **Update**. Tant qu'il n'est pas défini
   explicitement, le point d'entrée recalcule `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL`
   à partir de la variable `GKE_SERVICE_URL` injectée par la plateforme à chaque démarrage.

5. **Certificat de signature.** Si aucun certificat n'est fourni, l'application génère au démarrage un
   `.p12` jetable auto-signé afin que la signature de documents fonctionne de bout en bout pour les tests —
   mais la signature n'est pas reconnue comme fiable par les lecteurs PDF. Pour tout usage au-delà de ce
   lab, fournissez un vrai certificat (voir la tâche 3, étape 5).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le deployment, les pods et le stockage :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module est propriétaire de la spécification de la charge de travail, la mise à l'échelle est donc un changement de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de l'application suivante).
   Documenso utilise par défaut `min_instance_count = 0` (mise à l'échelle jusqu'à zéro) et
   `max_instance_count = 3`. L'affinité de session (`ClientIP`) est définie par défaut pour
   router un client vers le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite (à partir de
   `docker.io/documenso/documenso:${DOCUMENSO_VERSION}`) et une mise à jour progressive
   remplace les pods. Les migrations Prisma s'exécutent automatiquement au démarrage du conteneur —
   il n'y a pas de job de migration distinct à exécuter.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~documenso"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Branchez un certificat de signature de production** (recommandé avant un usage réel) : définissez
   `secret_environment_variables` pour associer `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`
   (un `.p12` encodé en base64) et `NEXT_PRIVATE_SIGNING_PASSPHRASE` à des secrets dans
   Secret Manager, puis appliquez via **Update**. Ne régénérez jamais
   `NEXT_PRIVATE_ENCRYPTION_KEY` sur place par la suite — elle déchiffre les données déjà
   stockées dans Postgres ; effectuez la rotation uniquement via l'emplacement de la clé secondaire.

6. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~documenso" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. documensodemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^documenso" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner
   un **uptime check** (lorsqu'il est activé) ; examinez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Documenso.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de
  démarrage est un `GET /` HTTP avec une marge d'environ 10 minutes (le démarrage à froid et les migrations
  Prisma du premier démarrage s'y imputent) ; la sonde de vivacité est un `GET /` HTTP avec
  un délai initial de 60 s, de sorte qu'un premier démarrage sain mais lent peut tout de même ressembler à un
  redémarrage si la marge est dépassée.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base de données a été matérialisé dans le namespace via le pilote Secret Store CSI,
  et que le job `db-init` s'est terminé. `enable_cloudsql_volume` vaut
  `true` par défaut sur ce module (le sidecar cloud-sql-proxy), ce que la logique de connexion
  du point d'entrée attend — laissez-le activé.
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E 'DATABASE_URL|WEBAPP_URL|SIGNING'
  ```
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour détecter des problèmes
  de ressources ou de quotas, et vérifiez que le Service Gateway/LoadBalancer s'est vu attribuer une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment l'immuabilité de `db_name`/`db_user`
après le premier déploiement, et l'interdiction de faire tourner `NEXT_PRIVATE_ENCRYPTION_KEY` sur place).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et le namespace, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS, l'instance Filestore et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), des secrets, un bucket de téléversements, Filestore, une IP statique/Gateway, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le service répond ; création du compte propriétaire initial dans l'interface ; prise en compte de la réserve sur le certificat auto-signé |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, brancher un certificat de signature de production, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et l'uptime check |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
