---
title: "Keycloak sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Keycloak sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Keycloak_GKE.md @ 3055034 sha256:0b5a1fee0e05 -->

# Keycloak sur GKE Autopilot — Guide de lab {#keycloak-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Keycloak_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Keycloak est une plateforme open source de gestion des identités et des accès qui fournit l'authentification unique (SSO), OIDC et SAML à vos applications. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **Keycloak on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Keycloak. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Keycloak_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Accéder à la console d'administration de Keycloak avec l'identifiant d'amorçage stocké dans Secret Manager et vérifier le service.
- Effectuer les opérations du jour 2 : inspecter, mettre à l'échelle, mettre à jour, gérer les secrets et la base de données.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable : la plateforme détecte automatiquement
  s'il existe déjà dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que propriétaire (Owner) du projet les commandes affichées, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Keycloak (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Keycloak_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret
   Manager (mot de passe de la base de données + mot de passe de l'administrateur
   d'amorçage), construit avec Cloud Build l'image de conteneur Keycloak optimisée pour
   la production (`kc.sh build` → `start --optimized`) et exécute un Job ponctuel
   `db-init` qui crée la base de données et le rôle Keycloak. Sur GKE, Keycloak atteint
   Postgres via un **sidecar Cloud SQL Auth Proxy** à l'écoute sur `127.0.0.1:5432` —
   un véritable port d'écoute TCP en boucle locale, et non le montage de socket Unix
   qu'utilise Cloud Run ; le pilote JDBC
   (`KC_DB_URL=jdbc:postgresql://127.0.0.1:5432/<db>`) se connecte donc sans
   contournement lié au socket. Un premier déploiement prend environ
   **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Connectez-vous au cluster et repérez le namespace à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep keycloak | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est sain. Le document de découverte OIDC du realm intégré
   `master` est public et prouve que Keycloak est opérationnel **et** qu'il communique
   avec sa base de données :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     "http://${EXTERNAL_IP}/realms/master/.well-known/openid-configuration"   # expect 200
   curl -s "http://${EXTERNAL_IP}/realms/master/.well-known/openid-configuration" | head -c 300
   ```

   Remarque : le point de terminaison `/health` de Keycloak se trouve sur le port de
   gestion distinct 9000, qui n'est pas exposé par le Service Kubernetes — les sondes
   de disponibilité et de vivacité (readiness/liveness) qu'utilise réellement la
   plateforme sont de simples **vérifications TCP sur le port 8080**, et le document de
   découverte OIDC ci-dessus est la bonne vérification externe à exécuter.

3. Ouvrez `http://${EXTERNAL_IP}/admin` dans un navigateur pour accéder à la console
   d'administration. Connectez-vous avec l'**administrateur d'amorçage** — nom
   d'utilisateur `admin`, mot de passe issu de Secret Manager :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~keycloak-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

4. **Durcissement immédiat :** l'administrateur d'amorçage est temporaire par
   conception. Dans la console d'administration, créez un administrateur permanent
   (Users → Add user, attribuez le rôle `admin`), connectez-vous avec cet utilisateur,
   puis supprimez ou désactivez l'utilisateur d'amorçage `admin`.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le Deployment, les pods et les événements :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en
   cliquant sur **Update** sur la page de détails du déploiement — le module gère la
   spécification de la charge de travail ; la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle via `kubectl scale`
   (une modification manuelle serait annulée lors de l'application suivante). Notez
   que le `main.tf` de `Keycloak_GKE` code en dur les bornes effectives de réplicas à
   `min_instance_count = 1` / `max_instance_count = 5` pour cette charge de travail,
   quelles que soient les valeurs que vous définissez pour les deux paramètres de
   premier niveau — consultez la section Pitfalls du Guide de configuration avant de
   compter sur ces variables pour maîtriser les coûts. Vérifiez également la
   réplication des sessions et du cache avant de compter sur `max_instance_count > 1`
   pour la continuité des sessions — il n'a pas été confirmé que la pile de cache
   Infinispan de l'image déployée réplique l'état des sessions entre les pods (point
   documenté comme TODO ouvert dans le Guide de configuration). `session_affinity` vaut
   `ClientIP` par défaut afin de maintenir un client sur le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version
   dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est
   construite et une mise à jour progressive remplace les pods. **Ne revenez jamais à
   une version antérieure** — les migrations de schéma de Keycloak sont à sens unique.

4. **Gérez les secrets et les tâches :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~keycloak"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Ouvrez une session sur la base de données** pour l'inspection ou la maintenance
   (Keycloak conserve tous les realms, clients et utilisateurs dans PostgreSQL) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~keycloak" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer). Le
   point d'entrée affiche un résumé de la configuration (`KC_DB_URL`, `KC_HOSTNAME`,
   paramètres du proxy) à chaque démarrage :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=100
   ```

   Filtre pour l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods (surveillez la mémoire de près —
   Keycloak est une JVM, 4Gi par défaut), le nombre de redémarrages et les métriques de
   requêtes. Le module peut provisionner un **test de disponibilité** (uptime check,
   désactivé par défaut) ciblant la page d'accueil publique de Keycloak sur `/` ;
   activez `uptime_check_config` via **Update** et vérifiez qu'il est au vert sous
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Keycloak à l'autre.

- **Pod non Ready / CrashLoopBackOff :** la sonde de démarrage (startup probe) est une
  sonde **TCP sur le port 8080** avec une marge généreuse (délai initial de 30s,
  30 échecs ≈ jusqu'à ~330s) pour le démarrage de la JVM et la migration de schéma du
  premier lancement ; la sonde de vivacité (liveness probe) est également TCP (délai
  initial de 60s, 3 échecs). Inspectez les événements et les journaux avant de conclure
  que la charge de travail a échoué :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL
  (PostgreSQL 15) est `RUNNABLE`, que le Job `db-init` s'est terminé et que les journaux
  du pod affichent un `KC_DB_URL` pointant vers `127.0.0.1:5432`. Sur GKE,
  `enable_cloudsql_volume` doit rester à `true` — il provisionne le sidecar Cloud SQL
  Auth Proxy qui fournit au pilote JDBC un véritable port d'écoute TCP en boucle
  locale ; sans lui, il n'existe aucun chemin vers la base de données.
- **Échec de la tâche d'initialisation :** inspectez la tâche et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Pod en attente / pas d'adresse IP externe :** consultez les événements de
  `kubectl describe pod` à la recherche de problèmes de ressources ou de quotas, et
  vérifiez que le Service LoadBalancer dispose d'une adresse IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact
  Registry et que le compte de service des nœuds peut la récupérer.
  `imagePullPolicy=Always` est défini pour les images construites sur mesure : un
  redéploiement après reconstruction récupère donc toujours les dernières couches.
- **Spécifique à l'application — les redirections OIDC pointent vers le mauvais hôte :**
  `entrypoint.sh` détecte automatiquement l'URL publique comme `KC_HOSTNAME` via le
  serveur de métadonnées GCP, avec repli sur le `SERVICE_URL` injecté par la
  foundation. Si vous placez Keycloak derrière un domaine personnalisé, définissez
  explicitement `KC_HOSTNAME` dans `environment_variables` afin que les URL d'émetteur
  (issuer) et les redirections de connexion correspondent au nom d'hôte réellement
  visité par les utilisateurs. (Une erreur 404 sur `/health` au port 8080 n'est **pas**
  une défaillance — la santé et les métriques sont exposées sur le port de gestion
  distinct 9000, non publié.)

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre — en particulier les bornes de réplicas `1`/`5` codées en
dur, le masquage de `application_database_name`/`application_database_user` par
`db_name`/`db_user`, et celui de `container_resources` par `cpu_limit`/`memory_limit`,
qui peuvent tous rendre silencieusement sans effet la modification d'un paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son namespace, la base de données Cloud SQL, les secrets Secret Manager
(administrateur d'amorçage + mot de passe de la base de données) et les images Artifact
Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le
Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, construit l'image optimisée et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; la découverte OIDC renvoie 200 ; connexion avec l'administrateur d'amorçage ; création d'un administrateur permanent |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (en tenant compte des bornes de réplicas 1/5 codées en dur), mettre à jour la version, gérer les secrets, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de tâche d'initialisation, de planification, de récupération d'image et de nom d'hôte |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
