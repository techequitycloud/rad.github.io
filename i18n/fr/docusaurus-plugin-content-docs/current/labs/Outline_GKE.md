---
title: "Outline sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Outline sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Outline_GKE.md @ 3055034 sha256:48cffdf12f0a -->

# Outline sur GKE Autopilot — Guide de lab {#outline-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Outline_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Outline est une base de connaissances et un wiki d'équipe rapides et collaboratifs, à la manière de Notion, avec
édition en temps réel, documents markdown riches et une recherche plein texte performante. Contrairement à
la plupart des modules de ce catalogue, Outline ne dispose d'aucun stockage intégré de noms d'utilisateur et de mots de passe —
il authentifie exclusivement via un fournisseur d'identité externe (OIDC, Google,
Slack, etc.), ce qui fait de la configuration de l'authentification une partie obligatoire, et non facultative, de ce lab.
Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Outline on GKE
Autopilot** sur Google Cloud : le déployer, vous connecter au cluster, configurer le
fournisseur d'authentification requis, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Outline. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Outline_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Configurer le fournisseur d'authentification OIDC **requis** pour que la connexion fonctionne réellement.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL,
  le partage NFS Filestore, Artifact Registry et les comptes de service partagés dont dépend ce module).
  Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Outline (GKE)** depuis
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Outline_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (`SECRET_KEY` et `UTILS_SECRET` générés automatiquement, ainsi que le mot de passe de la base de données), un
   partage Cloud Filestore (NFS) monté sur `/var/lib/outline/data` pour les fichiers
   téléversés, deux buckets Cloud Storage (créés mais inutilisés par défaut — Outline est
   configuré pour un stockage local/NFS, et non pour un stockage objet), construit l'image
   de conteneur personnalisée et exécute un job ponctuel d'initialisation de la base de données. Outline
   nécessite également Redis, qui est **activé par défaut** et pointe vers le processus
   Redis co-hébergé sur la VM NFS partagée — aucune instance Memorystore distincte n'est
   créée, sauf si vous en configurez une. Les premiers déploiements prennent environ **20–35 minutes**
   (la création de Cloud SQL et de Filestore en représente l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep outline | head -1 | cut -d/ -f2)
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

   Prévoyez plus de 60 secondes après le passage du pod à l'état `Running` pour que le point d'entrée se connecte à
   PostgreSQL, exécute les migrations Sequelize et se connecte à Redis avant que la
   sonde de démarrage (`GET /`) ne réussisse.

2. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. **Attendez-vous à une page de connexion vide** — c'est
   le fait le plus important du premier lancement de ce module, et non un échec. Les variables d'environnement
   `OIDC_*` sont livrées volontairement vides ; sans fournisseur d'identité
   configuré, Outline n'enregistre donc **aucune** méthode d'authentification. Le service est en bonne santé ;
   la connexion nécessite l'étape suivante.

3. **Configurez le fournisseur OIDC requis.** Vérifiez d'abord quelle `URL` la charge de travail
   utilise déjà — sur GKE, `App_GKE` injecte systématiquement l'adresse
   calculée sous la forme `GKE_SERVICE_URL`, et le point d'entrée définit automatiquement `URL` sur cette valeur
   chaque fois que `URL` n'est pas déjà définie ; un déploiement neuf dispose donc d'une `URL` fonctionnelle sans
   aucune substitution manuelle (sauf si vous souhaitez imposer un nom d'hôte avant le provisionnement du DNS ou du certificat) :

   ```bash
   kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E '^(URL|GKE_SERVICE_URL)'
   ```

   Créez un client OAuth auprès de votre IdP (par exemple Google : APIs & Services →
   Credentials) avec `<URL>/auth/oidc.callback` comme URI de redirection autorisé —
   le callback **doit se trouver sur le même hôte** que l'`URL` injectée. Ensuite, sur la
   page de configuration du déploiement dans la plateforme RAD, définissez les valeurs simples
   des points de terminaison dans `environment_variables` et cliquez sur **Update** :

   ```
   OIDC_AUTH_URI      = https://accounts.google.com/o/oauth2/v2/auth
   OIDC_TOKEN_URI      = https://oauth2.googleapis.com/token
   OIDC_USERINFO_URI   = https://openidconnect.googleapis.com/v1/userinfo
   OIDC_USERNAME_CLAIM = email
   ```

   Liez les identifiants du client en tant que secrets dans `secret_environment_variables`
   (`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`) en pointant vers des secrets Secret Manager
   contenant l'ID et le secret de votre client OAuth, puis cliquez de nouveau sur **Update**. Contrairement à la variante Cloud
   Run — où `gcloud run services update` refuse de convertir en un seul appel une variable d'environnement simple
   directement en référence de secret (« already set with a different
   type »), ce qui impose un passage `--remove-env-vars` avant `--update-secrets` — le
   chemin de GKE est déclaratif : sur GKE, les valeurs adossées à Secret Manager sont matérialisées
   dans le cluster sous forme de Secrets Kubernetes natifs par le contrôleur **SecretSync**
   (la CRD `secretsyncs.secret-sync.gke.io`), et un seul `tofu apply` (le
   **Update** de la plateforme) produit en une passe toute la liste `env` souhaitée du pod —
   nul besoin d'une manipulation gcloud en deux étapes. Le seul point à soigner vous-même : **retirez
   `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` de `environment_variables` dans le même
   apply** qui les ajoute à `secret_environment_variables`. Laisser la même clé
   dans les deux maps place deux entrées `env` du même nom dans la spécification du Pod (une
   `value`, une `valueFrom.secretKeyRef`) — Kubernetes l'accepte sans
   erreur, mais la valeur réellement observée par le processus en cours d'exécution n'est pas
   quelque chose sur quoi compter ; conservez exactement une source par clé.

   Vérifiez que le secret a été matérialisé et rechargez la page de connexion — le bouton de votre fournisseur
   doit apparaître ; le premier utilisateur à se connecter crée l'espace de travail.

   ```bash
   kubectl get secret -n "$NS"                       # look for the SecretSync-materialised secret object
   gcloud secrets list --project="$PROJECT" --filter="name~outline"
   ```

4. **Avant même d'activer l'authentification, assurez-vous que le LoadBalancer est placé derrière HTTPS.**
   La valeur par défaut `service_type = LoadBalancer` est du HTTP simple, sans terminaison TLS.
   Le flux OAuth d'Outline définit le cookie `state` avec `secure: true` ; en HTTP
   simple, `/auth/<provider>` renvoie `500 — Cannot send secure cookie over
   unencrypted connection` alors même que la page d'accueil se charge correctement. Activez
   `enable_custom_domain` avec `application_domains` défini sur un vrai nom d'hôte (ainsi qu'un
   DNS pointant vers l'IP statique réservée) avant de raccorder l'IdP, sinon attendez-vous à
   l'erreur 500 ci-dessus.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — déploiement, pods et volumes persistants :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   kubectl get pvc -n "$NS"          # the Filestore-backed NFS claim
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification de la charge de travail ; la mise à l'échelle est donc un
   changement de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors du prochain apply). Outline utilise par défaut un plafond plus élevé que la plupart des
   modules adossés à NFS présentés ici (`min_instance_count = 1`, `max_instance_count = 3`)
   car Redis coordonne l'état temps réel et de session entre les réplicas. L'affinité de
   session (`ClientIP`) est définie par défaut pour qu'un client reste routé vers le même
   pod. Comme `enable_nfs = true`, les déploiements progressifs utilisent la stratégie `Recreate` — **tous**
   les réplicas en cours d'exécution sont arrêtés avant le démarrage du nouvel ensemble ; attendez-vous donc à
   une brève interruption complète à chaque redéploiement, et non à un déploiement progressif sans interruption.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et le déploiement `Recreate`
   remplace les pods (le point d'entrée exécute au démarrage les éventuelles migrations Sequelize
   en attente).

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~outline"    # DB password, SECRET_KEY, UTILS_SECRET
   kubectl get jobs -n "$NS"                                           # db-init and any scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~outline"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. outlinedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^outline" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   Au démarrage, recherchez le journal d'assemblage de `DATABASE_URL` émis par le point d'entrée, la
   sortie des migrations Sequelize et la confirmation de connexion à Redis.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. `uptime_check_config`
   est **désactivé par défaut** pour ce module — laissez-le désactivé tant que l'application n'est pas
   accessible en HTTPS avec l'authentification configurée (d'ici là, l'application est censée être
   pratiquement inutilisable), puis activez-le et consultez Monitoring → Uptime checks
   et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'Outline.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. La sonde de
  démarrage accorde environ 120 secondes (délai initial de 60 s, 6 tentatives) au
  point d'entrée pour joindre PostgreSQL et exécuter les migrations avant que Kubernetes n'abandonne.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Page de connexion vide (le cas propre à l'application) :** il ne s'agit *pas* d'un échec de
  déploiement — les espaces réservés `OIDC_*` restent vides tant que vous n'avez pas configuré d'IdP
  (tâche 2). Si un fournisseur est configuré mais que la connexion boucle ou échoue, vérifiez que
  l'URI de redirection est `<URL>/auth/oidc.callback` sur l'hôte exact de l'`URL`
  injectée, et que le LoadBalancer est placé derrière HTTPS (en HTTP simple, `/auth/<provider>`
  renvoie une erreur 500 liée à un cookie `secure`) :
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E '^(URL|OIDC_)'
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (PostgreSQL 15)
  est `RUNNABLE`, que le secret du mot de passe de la base a été matérialisé dans l'espace de noms via
  SecretSync, et que le job `db-init` s'est terminé. La connexion utilise le sidecar Cloud SQL
  Auth Proxy (boucle locale `127.0.0.1:5432`) — `enable_cloudsql_volume` doit
  rester à `true`.
- **Échec du job d'initialisation :** examinez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Erreurs Redis / boucle de reconnexion dans les journaux :** Outline nécessite Redis même avec un
  seul réplica — ce n'est pas ici un niveau de cache facultatif. Vérifiez `enable_redis =
  true` et que la VM NFS partagée (qui co-héberge Redis) est `RUNNING`, ou que
  `redis_host` pointe vers un point de terminaison joignable :
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E '^REDIS_'
  ```
- **Téléversements non persistés / problèmes de montage NFS :** vérifiez `enable_nfs = true`,
  que `nfs_mount_path` vaut `/var/lib/outline/data`, et que l'instance Filestore et le PVC
  sont en bon état :
  ```bash
  gcloud filestore instances list --project="$PROJECT"
  kubectl get pvc -n "$NS"
  ```
- **Le déploiement progressif semble bloqué lors d'une mise à jour :** comme `enable_nfs = true` impose la
  stratégie `Recreate`, une mise à jour affiche brièvement zéro pod en cours d'exécution (tous les réplicas
  sont arrêtés ensemble) avant le démarrage du nouvel ensemble — c'est attendu, et non
  un blocage, même si avec `max_instance_count = 3` l'interruption visible est plus longue que pour une
  application à réplica unique.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer
  des problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer dispose d'une
  IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer ; il s'agit d'un module à build personnalisé, consultez donc aussi
  l'historique Cloud Build pour repérer un échec de build d'image.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre — notamment les règles essentielles : ne jamais faire tourner
`SECRET_KEY` après le premier démarrage, ne jamais désactiver `enable_redis`, et placer HTTPS
devant le Service avant d'activer tout fournisseur d'authentification.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager (mot de passe de la base,
`SECRET_KEY`, `UTILS_SECRET`), le partage NFS Filestore, les deux buckets Cloud Storage
et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le
VPC, le cluster GKE, le Cloud SQL partagé, la VM NFS/Redis, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), le NFS Filestore, les buckets GCS, les secrets, construit l'image et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la vérification d'état réussit ; configurer le fournisseur OIDC requis (points de terminaison + ID/secret client adossés à des secrets via SecretSync) et effectuer la première connexion |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, accéder à la base ; noter l'interruption due au déploiement `Recreate` |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité facultatif |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, d'OIDC, de base de données, de job d'initialisation, de Redis, de NFS, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
