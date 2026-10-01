---
title: "Gitea sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Gitea sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Gitea_GKE.md @ 3055034 sha256:70aedab84f84 -->

# Gitea sur GKE Autopilot — Guide de lab {#gitea-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gitea_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Gitea est un service Git et une forge logicielle légers et auto-hébergés — hébergement de dépôts, tickets, pull requests, revue de code et registre de paquets, le tout depuis un seul binaire Go. Ce lab vous fait parcourir le cycle de vie opérationnel complet du module **Gitea sur GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes courants, puis le supprimer.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Gitea. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Gitea_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d’exécution.
- Accéder à la forge, revendiquer le compte administrateur du premier inscrit et vérifier l’état de santé.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et le stockage sur NFS.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Cloud
  Filestore (NFS), Artifact Registry et les comptes de service partagés dont dépend
  ce module). Vous n’avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s’il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu’elle affiche, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Gitea (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Gitea_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager (`SECRET_KEY`
   et `INTERNAL_TOKEN` générés automatiquement, ainsi que le mot de passe de la base), un partage
   Cloud Filestore (NFS) monté sur `/mnt/nfs` pour les dépôts, les objets Git LFS et les
   pièces jointes (aucun bucket GCS n’est créé pour ce module), construit l’image personnalisée
   légère au-dessus de `gitea/gitea` via Cloud Build, et exécute un job ponctuel
   d’initialisation de la base de données, propre à PostgreSQL. Un premier déploiement prend environ
   **20 à 35 minutes** (la création de Cloud SQL et de Filestore représente l’essentiel du temps).

3. Connectez-vous au cluster et repérez l’espace de noms à l’aide de filtres indépendants du nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep gitea | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s’exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. Les sondes de démarrage et de liveness ciblent
   toutes deux `GET /api/healthz`, que Gitea sert sans authentification avec un HTTP 200 une fois
   son démarrage terminé :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/api/healthz"
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. L’assistant d’installation web du premier
   lancement est ignoré (`GITEA__security__INSTALL_LOCK = "true"` — la configuration est
   entièrement pilotée par les variables d’environnement), et **le premier utilisateur qui s’inscrit
   devient l’administrateur** — aucun job géré par Terraform ne crée de compte administrateur.
   Cliquez sur **Register**, créez immédiatement votre compte administrateur et connectez-vous.

4. **Durcissement immédiat :** l’inscription libre est activée par défaut
   (`GITEA__service__DISABLE_REGISTRATION = "false"`). Pour une forge privée, désactivez-la
   juste après avoir revendiqué le compte administrateur en ajoutant
   `GITEA__service__DISABLE_REGISTRATION = "true"` à `environment_variables` via le
   flux **Update** de RAD. Définissez aussi `public_domain` / `public_url` sur l’IP externe
   attribuée ou sur votre véritable nom d’hôte — les deux valent `localhost` par défaut, ce qui
   casse sinon les URL de clonage, les rappels de webhook et les redirections OAuth.

5. Créez un dépôt de test dans l’interface et clonez-le en **HTTPS** — seul le port HTTP
   est raccordé au Service Kubernetes ; le `sshd` propre à l’image n’est pas exposé,
   donc les URL de clonage SSH ne sont pas joignables :

   ```bash
   git clone "http://${EXTERNAL_IP}/<your-user>/<test-repo>.git"
   ```

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter la charge de travail** — le déploiement, les pods et les persistent volume claims :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettre à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification de la charge de travail, la mise à l’échelle est donc une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée à l’application suivante). Les valeurs par défaut sont min `0` / max `3`. Comme les données
   des dépôts résident sur un NFS partagé plutôt que sur un stockage par pod, exécuter plus d’une
   réplique est en général sans risque pour les requêtes HTTP sans état, mais le verrouillage propre à Git et
   les jobs d’arrière-plan en cours ne sont pas explicitement coordonnés entre les répliques par
   ce module — gardez une valeur prudente pour `max_instance_count` sauf vérification. L’affinité
   de session (`ClientIP`) est définie par défaut pour qu’un client reste routé vers le même pod.

3. **Mettre à jour la version de l’application** en modifiant `application_version` dans la plateforme
   RAD et en l’appliquant via **Update** ; Cloud Build reconstruit l’image et un nouveau
   déploiement progressif remplace les pods. **Attendez-vous à une brève interruption pendant le déploiement progressif, et non à un
   blocage :** comme cette application s’appuie sur NFS, la stratégie de déploiement du Deployment est
   `Recreate` et non `RollingUpdate`, la valeur par défaut — la fondation arrête délibérément
   le pod existant avant de démarrer son remplaçant, plutôt que d’exécuter les
   deux simultanément sur le même volume NFS et la même base de données Cloud SQL (un
   pod supplémentaire sous `RollingUpdate` ne deviendrait jamais Ready et bloquerait le déploiement progressif
   indéfiniment). Une courte indisponibilité pendant une mise à jour est donc un comportement attendu
   et sûr — suivez son achèvement avec :

   ```bash
   kubectl rollout status deploy/<service-name> -n "$NS"
   ```

4. **Gérer les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~gitea"
   kubectl get jobs -n "$NS"          # db-init and any scheduled backup jobs
   gcloud filestore instances list --project="$PROJECT"
   kubectl exec -n "$NS" deploy/<service-name> -- df -h /mnt/nfs
   ```

5. **Ouvrir une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. giteademo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^gitea" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^gitea" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l’explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l’utilisation du processeur
   et de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes, ainsi que les tableaux de bord
   Cloud SQL et Filestore pour la base de données et le partage NFS. Le module peut provisionner un
   **test de disponibilité** (uptime check, lorsqu’il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous risquez le plus de rencontrer. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Gitea.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. Les sondes de démarrage et de
  liveness ciblent toutes deux `/api/healthz` ; un échec de connexion à PostgreSQL
  empêchera le pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **`lookup $(DB_HOST): no such host` ou variables de base de données non résolues dans les journaux :**
  c’est l’image amont d’origine qui a été déployée au lieu du build personnalisé. `container_image_source`
  doit valoir `custom` — le point d’entrée de la plateforme qui compose `GITEA__database__*`
  à partir des `DB_HOST`/`DB_IP` injectés n’existe que dans le build personnalisé.
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL (PostgreSQL 15) est
  `RUNNABLE`, que le secret du mot de passe de la base a bien été matérialisé dans l’espace de noms, et que le
  job `db-init` s’est terminé. `database_type` doit rester sur une valeur Postgres — le
  `db-init.sh` fourni est codé en dur pour `psql`, donc une valeur MySQL passe la validation
  mais laisse la base de données non initialisée.
- **Le job d’initialisation a échoué :** examinez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **La mise à jour / le déploiement progressif semble bloqué :** vérifiez que la stratégie de déploiement est `Recreate` (attendu pour cette application sur NFS) et que le pod précédent s’est réellement arrêté avant de conclure à un véritable blocage :
  ```bash
  kubectl get deploy -n "$NS" -o jsonpath='{.spec.strategy.type}'
  kubectl get pods -n "$NS" -w
  ```
  Un véritable blocage (pod bloqué en `Terminating` au-delà de son délai de grâce, ou nouveau pod
  bloqué en `Pending`/`Init`) indique une autre cause — vérifiez l’état du montage NFS et
  la planification sur les nœuds, et non le mécanisme de mise à jour lui-même.
- **URL de clonage cassées / redirections vers `localhost` :** `public_domain` / `public_url`
  conservent leurs valeurs par défaut — définissez-les sur l’IP externe ou votre véritable nom d’hôte via
  **Update**.
- **Le clonage SSH échoue :** c’est attendu — seul le port HTTP est raccordé au Service
  Kubernetes. Utilisez des remotes HTTPS avec un jeton d’accès Gitea.
- **Montage NFS / dépôts manquants :** vérifiez que `enable_nfs = true`, que
  l’instance Filestore est disponible et que le PVC du pod est `Bound` :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl exec -n "$NS" deploy/<service-name> -- df -h /mnt/nfs
  ```
- **Pod en attente / pas d’IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quotas, et vérifiez que le Service LoadBalancer a une IP attribuée.
- **Erreurs de récupération d’image :** vérifiez que l’image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (y compris la règle essentielle de ne jamais modifier `SECRET_KEY` ni
`INTERNAL_TOKEN` après le premier démarrage).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager et les données des dépôts
stockées sur Filestore (NFS). Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), NFS (Filestore), des secrets, construit l’image et exécute l’initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit ; le premier inscrit revendique le compte administrateur ; inscription durcie |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l’échelle, mettre à jour la version (déploiement progressif Recreate — brève indisponibilité, pas un blocage), gérer secrets/NFS, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d’initialisation, de déploiement progressif, d’URL de clonage, de NFS et de récupération d’image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
