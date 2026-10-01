---
title: "Castopod sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Castopod sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Castopod_GKE.md @ 3055034 sha256:5744812df744 -->

# Castopod sur GKE Autopilot — Guide de lab {#castopod-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Castopod_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Castopod est une plateforme open source d'hébergement de podcasts, nativement compatible ActivityPub, construite sur
CodeIgniter 4 (PHP 8) et servie par FrankenPHP/Caddy. Ce lab vous fait parcourir
tout le cycle de vie opérationnel du module **Castopod on GKE Autopilot** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités de Castopod. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Castopod_GKE) — ce
lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail Castopod en cours d'exécution.
- Terminer l'assistant d'installation web de Castopod et publier un épisode de test.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL,
  le NFS Filestore, Artifact Registry et les comptes de service partagés dont dépend
  ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon,
  le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Castopod (GKE)**
   dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Castopod_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme déploie la charge de travail FrankenPHP/Caddy dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager
   (le mot de passe de la base ainsi que le `CP_ANALYTICS_SALT` généré automatiquement), deux buckets
   Cloud Storage (`data` et `media`), un partage NFS (Filestore) pour le stockage durable de l'audio
   et des visuels des épisodes, construit l'image de conteneur personnalisée (un build léger au-dessus de l'image amont
   `castopod/castopod` qui y greffe le point d'entrée de la plateforme), puis exécute un
   job ponctuel d'initialisation de la base de données. Les premiers déploiements prennent environ **20 à 35 minutes**
   (la création de Cloud SQL représente l'essentiel du temps).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep castopod | head -1 | cut -d/ -f2)
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

2. Vérifiez que le service est sain. La page d'accueil non authentifiée `/` de Castopod renvoie
   HTTP 200 une fois l'application démarrée et connectée à MySQL — CodeIgniter exécute ses
   migrations de schéma automatiquement au premier démarrage (il n'y a pas de job de migration
   distinct), prévoyez donc quelques minutes sur un nouveau déploiement :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"
   ```

   Par défaut, `enable_custom_domain = true` avec `application_domains` laissé vide, si bien
   qu'App_GKE provisionne également une Gateway et un nom d'hôte HTTPS `<ip>.nip.io` sans configuration,
   doté d'un certificat géré par Google — vérifiez sa présence si vous préférez naviguer en
   HTTPS :

   ```bash
   kubectl get gateway,httproute -n "$NS"
   ```

3. Ouvrez `http://${EXTERNAL_IP}` (ou l'URL HTTPS nip.io) dans un navigateur et terminez
   l'**assistant d'installation web** de Castopod — créez le premier compte super-administrateur et définissez
   le nom de l'instance et les valeurs par défaut des podcasts. L'URL de base est dérivée automatiquement de
   l'URL du service injectée par la fondation, si bien que les liens de flux et de médias pointent vers le bon
   hôte. Le mot de passe de la base de données (dans Secret Manager) peut être récupéré si nécessaire :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~castopod"
   gcloud secrets versions access latest --secret=<db-password-secret-name> --project="$PROJECT"
   ```

4. Téléversez un court épisode de test (audio + visuel) et vérifiez que le flux RSS public
   s'affiche. Les médias téléversés sont conservés dans le répertoire adossé au NFS
   (`/var/lib/castopod`), partagé entre les pods, et survivent donc aux redémarrages de pods.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement Kubernetes, les pods et les persistent volume claims :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification de la charge de travail, donc la mise à l'échelle est une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application). Castopod utilise par défaut un seul réplica
   (`min_instance_count = max_instance_count = 1`) ; ne dépassez pas 1 sans
   avoir vérifié que le répertoire de médias NFS partagé et le cache d'objets basé sur le système de fichiers
   (`CP_CACHE_HANDLER = file`) se comportent correctement sur plusieurs pods. La
   charge de travail est adossée au NFS, donc les mises à jour sont déployées avec la stratégie `Recreate` (l'ancien
   pod s'arrête avant que le nouveau ne démarre) plutôt qu'avec une mise à jour progressive.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et le pod est
   recréé. CodeIgniter applique automatiquement les migrations de schéma en attente au
   premier démarrage du nouveau conteneur.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~castopod"
   kubectl get jobs -n "$NS"                                         # db-init job
   gcloud storage buckets list --project="$PROJECT" --filter="name~castopod"
   gcloud filestore instances list --project="$PROJECT"              # NFS for media
   ```

   Gardez `CP_ANALYTICS_SALT` stable — il anonymise les statistiques d'audience des podcasts, et
   le modifier après le premier démarrage rompt la continuité de la déduplication pour les statistiques
   déjà enregistrées (il ne corrompt pas les lignes existantes).

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. castopoddemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^castopod" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Facultatif : activer le cache d'objets Redis.** Castopod utilise par défaut un cache sur système de fichiers.
   Pour passer à Redis, définissez `enable_redis = true` (laissez `redis_host` vide pour utiliser
   l'IP de la VM du serveur NFS, ce qui requiert `enable_nfs = true`) et appliquez via **Update** :

   ```bash
   kubectl exec -n "$NS" deploy/<service-name> -- env | grep -i redis
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Les récupérations de flux par
   les applications de podcast apparaissent sous forme de trafic de requêtes de fond régulier. Le module peut
   provisionner un **test de disponibilité** (lorsqu'il est activé) ; consultez Monitoring → Uptime checks
   et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Castopod.

- **Pod non Ready / CrashLoopBackOff :** la sonde de démarrage est de type **TCP** sur le port du conteneur,
  avec un délai initial de 30 secondes et une fenêtre de 20 nouvelles tentatives (`period_seconds = 15`),
  ce qui laisse amplement le temps aux migrations CodeIgniter du premier démarrage de se terminer ; la sonde de vivacité
  est de type **HTTP `GET /`** avec un délai initial de 300 secondes. Examinez les événements et les journaux avant
  de conclure que la charge de travail a échoué :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (MySQL 8.0) est
  `RUNNABLE` et que le job `db-init` s'est terminé. Castopod atteint la base de données via
  le sidecar Cloud SQL Auth Proxy sur `127.0.0.1:3306` ; comme CodeIgniter lit sa
  connexion depuis des clés en notation pointée `database.default.*` qui ne peuvent pas être exprimées sous forme de
  variables d'environnement Kubernetes, le point d'entrée de la plateforme les écrit dans le fichier `.env` de Castopod
  au démarrage du conteneur — examinez-le directement si la connectivité semble incorrecte :
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- cat /var/www/castopod/.env
  ```
- **Échec du job d'initialisation :** examinez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Les fichiers téléversés disparaissent après un redémarrage de pod :** vérifiez que `enable_nfs = true` et que
  l'instance Filestore est saine — sans NFS, l'audio et les visuels des épisodes résident sur un
  disque éphémère et sont perdus à chaque redémarrage ou redéploiement.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes
  de ressources ou de quota, et vérifiez que le Service LoadBalancer s'est vu attribuer une IP.
- **Le déploiement semble bloqué lors d'une mise à jour :** il s'agit du comportement attendu, compatible avec le NFS, et non
  d'un échec — le Deployment utilise la stratégie `Recreate`, donc l'ancien pod s'arrête
  complètement avant que le nouveau ne démarre (une mise à jour progressive exécuterait deux pods sur
  le même répertoire de médias adossé au NFS et provoquerait un interblocage).
- **Erreurs de build/récupération d'image :** consultez l'historique de Cloud Build pour le journal du build en échec,
  et vérifiez que l'image existe dans Artifact Registry et que le compte de service des nœuds peut
  la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment les règles essentielles : ne jamais modifier `application_database_name`/
`application_database_user` ni `CP_ANALYTICS_SALT` après le premier démarrage, et conserver
`database_type` sur sa valeur par défaut `MYSQL_8_0`, puisque Castopod ne prend pas en charge d'autres
moteurs).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression
retire tout ce que le module a créé — la charge de travail Kubernetes et l'espace de noms, la base de données Cloud
SQL (podcasts, épisodes, utilisateurs, statistiques), les secrets Secret Manager
(y compris `CP_ANALYTICS_SALT`), les buckets GCS `data`/`media`, le partage NFS
contenant l'audio et les visuels téléversés, ainsi que les images d'Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), le NFS, les buckets de stockage et les secrets, construit l'image et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la page d'accueil renvoie 200 ; terminer l'assistant d'installation ; téléverser un épisode de test et vérifier le flux |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (un seul réplica par défaut), mettre à jour la version, gérer les secrets/le stockage/Redis, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de médias NFS, de déploiement et d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
