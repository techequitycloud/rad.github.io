---
title: "Matomo sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Matomo sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Matomo_GKE.md @ 3055034 sha256:ea1ba650d8da -->

# Matomo sur GKE Autopilot — Guide de lab {#matomo-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Matomo_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Matomo est la principale plateforme open source d'analyse web — une alternative
auto-hébergée à Google Analytics, axée sur la confidentialité, sans échantillonnage des données et avec la
pleine propriété (100 %) des données collectées. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **Matomo on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants
et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités de Matomo. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Matomo_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et terminer l'installateur web de premier démarrage de Matomo.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL,
  le NFS Filestore et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement
  s'il existe déjà dans le projet cible et, sinon, le provisionne avant ce
  module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu'elle affiche, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Matomo (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Matomo_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (MySQL 8.0) avec son secret de mot de passe dans Secret Manager, un
   partage NFS Filestore qui conserve la racine documentaire de Matomo (`/var/www/html`), un
   bucket GCS `data` dédié, recopie l'image officielle `matomo:5-apache` dans
   Artifact Registry (pas d'étape Cloud Build — il s'agit d'un module **préconstruit**), et exécute
   un job ponctuel `db-init` qui crée la base de données vide et l'utilisateur. Les premiers déploiements
   prennent environ **20 à 35 minutes** (la création de Cloud SQL et de Filestore en représente l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep matomo | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est en bonne santé. Le chemin de vérification de santé de Matomo est `/`, qui renvoie HTTP
   200 — ou une **redirection 302 vers l'installateur sur un nouveau déploiement** — dès qu'Apache et PHP sont
   en cours d'exécution. La sonde de démarrage accorde une fenêtre généreuse (TCP sur `/`, délai initial de 30s,
   période de 15s, seuil de 40 échecs, ~10.5min au total) pour que le point d'entrée de l'image
   remplisse la racine documentaire vide montée sur NFS à partir de
   `/usr/src/matomo` au premier démarrage :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Sur un nouveau déploiement, Matomo présente son
   **installateur web** : l'écran de connexion à la base de données est prérempli à partir des
   variables d'environnement `MATOMO_DATABASE_HOST`/`USERNAME`/`DBNAME`/`PASSWORD`
   injectées (le job `db-init` a déjà créé la base de données vide et l'utilisateur, et
   la plateforme fait correspondre les identifiants Cloud SQL propres au déploiement à ces
   noms natifs de Matomo — le même schéma « remplacer les variables d'environnement génériques de base de données pour suivre la
   convention propre à l'application » utilisé ailleurs sur cette plateforme, par exemple la correspondance de style
   Laravel de SnipeIT). Parcourez l'installateur, créez le compte **superuser** (super-utilisateur)
   et enregistrez votre premier site web suivi. L'installateur écrit
   `config.ini.php` dans la racine documentaire conservée sur NFS, de sorte que la configuration survit aux redémarrages
   des pods. Si vous avez besoin du mot de passe de la base de données :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~matomo" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

4. **Durcissement immédiat :** l'URL de l'installateur est publique tant que la configuration n'est pas terminée —
   terminez l'assistant juste après le déploiement. Copiez ensuite l'extrait de suivi depuis
   **Administration → Websites → Tracking Code** dans une page de test et confirmez que la
   visite apparaît sous **Visitors → Visits Log**.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — déploiement et pods (Matomo se déploie en tant que
   `Deployment` avec la stratégie de mise à jour `Recreate`, car la charge de travail est
   adossée à NFS et une mise à jour progressive ferait tourner deux pods sur le même volume partagé
   et la même base de données) :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail ; la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors du prochain apply). Les deux
   valent **1** par défaut, et `max_instance_count` doit rester à **1** tant que le
   comportement multi-pod en matière de NFS, de sessions et de verrous d'archivage n'a pas été explicitement vérifié —
   Matomo ne coordonne pas nativement les écritures des journaux de suivi ni le traitement des archives
   entre des réplicas partageant un même volume NFS et une même base de données. `session_affinity =
   ClientIP` maintient les requêtes d'un client sur le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   (utilisez un tag de **variante Apache**, par exemple `5.11-apache`, `latest`) et en l'appliquant via
   **Update** ; l'image recopiée est mise à jour et un déploiement `Recreate` remplace le pod.
   Matomo exécute ses propres migrations de schéma depuis la racine documentaire persistante — il n'y a
   pas de job de migration sans interface.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~matomo"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~-data"
   gcloud filestore instances list --project="$PROJECT"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance (les tables d'analyse utilisent
   le préfixe fixe `matomo_`) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. matomodemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^matomo" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Traitement des archives (propre à l'application).** Ce module ne provisionne pas de CronJob
   pour le traitement périodique des archives de Matomo (`console core:archive`) — par défaut, les rapports
   utilisent l'archivage déclenché par le navigateur au sein des requêtes des visiteurs. Pour les sites
   plus fréquentés, ajoutez une tâche planifiée via le paramètre générique `cron_jobs` (groupe 11)
   pointant vers l'image déployée et la commande d'archivage.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes, ainsi que les métriques Cloud SQL
   de l'instance MySQL. Le module peut provisionner un **test de disponibilité** (lorsqu'il est
   activé) ; examinez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Matomo.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de démarrage
  est TCP sur `/` avec un seuil de 40 échecs (~10.5min) pour couvrir la copie, au premier démarrage,
  de l'application dans le volume NFS vide ; la sonde de vivacité est HTTP `GET /`
  avec un délai initial de 300s (une réponse 200 ou une redirection 302 vers l'installateur compte comme saine).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Racine documentaire corrompue de façon permanente après l'expiration de la sonde de démarrage :** le
  point d'entrée de l'image extrait avec `tar` `/usr/src/matomo` dans la racine documentaire montée sur NFS
  **en tant que root**, puis n'applique `chown -R` qu'une fois l'extraction
  terminée. Si le seuil d'échec de la sonde de démarrage a déjà été abaissé sous
  la valeur par défaut du module (40, ~10.5min) et que le pod a reçu un SIGKILL en pleine extraction,
  le volume NFS se retrouve avec une arborescence partiellement copiée et en partie détenue par root.
  Cela ne se répare **pas** de soi-même au redémarrage — le point d'entrée ne remplit plus
  la racine documentaire dès qu'il y trouve déjà `matomo.php` — et se manifeste
  par des erreurs persistantes `composer`/`vendor` « not installed », alors même que le pod
  est signalé `Ready`. Récupérez manuellement :
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- \
    rm -rf /var/www/html/* /var/www/html/.[!.]*
  kubectl delete pod -n "$NS" <pod>
  ```
  puis attendez de nouveau toute la fenêtre de la sonde de démarrage pour que le point d'entrée
  remplisse proprement le volume.
- **Erreurs de connexion à la base de données :** Matomo atteint Cloud SQL via le **sidecar Cloud SQL
  Auth Proxy sur `127.0.0.1:3306`** (`enable_cloudsql_volume = true` est
  requis sur GKE). Confirmez que l'instance MySQL 8.0 est `RUNNABLE`, que le secret du mot de passe
  de la base de données a été matérialisé dans l'espace de noms et que le job `db-init` s'est terminé — il
  vérifie les identifiants de l'utilisateur de l'application ; un job `db-init` au vert écarte donc la plupart des
  problèmes d'authentification.
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep MATOMO_DATABASE
  ```
- **Échec du job `db-init` :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **L'installateur réapparaît après chaque redémarrage / configuration non conservée :** vérifiez
  `enable_nfs = true` et `nfs_mount_path = /var/www/html`, et confirmez que le PVC est
  lié :
  ```bash
  kubectl get pvc -n "$NS"
  ```
  Si la racine documentaire n'est pas réellement conservée, `config.ini.php` est perdu à
  chaque recréation du pod et Matomo revient à l'installation.
- **Pod à l'état Pending / pas d'adresse IP externe :** consultez les événements de `kubectl describe pod` pour
  détecter des problèmes de ressources ou de quota, et confirmez que le Service LoadBalancer dispose d'une adresse IP
  attribuée (`reserve_static_ip = true` la maintient stable d'un redéploiement à l'autre).
- **Erreurs de pull de l'image :** il s'agit d'un module **préconstruit** — il n'y a pas d'étape Cloud Build.
  Confirmez que l'image recopiée existe dans Artifact Registry et que
  `application_version` est un véritable tag de **variante Apache** (`5-apache`,
  `5.11-apache`) ; les tags fpm/alpine ne servent pas HTTP sur le port 80.
- **La mise à jour progressive se bloque / deux pods se disputent le NFS :** confirmez que la stratégie de mise à jour
  du Deployment est `Recreate` (le module la définit automatiquement pour les
  charges de travail adossées à NFS) — une stratégie `RollingUpdate` sur cette charge de travail démarrerait
  un second pod sur le même volume NFS et la même base de données avant que le premier
  ne s'arrête.
- **Redis « activé » mais rien ne change :** `enable_redis = true` ne fait que câbler
  `REDIS_HOST`/`REDIS_PORT` dans l'environnement du pod — de la connectivité, pas de la
  configuration. Rien dans ce module ne modifie le backend `[Cache]` de
  `config.ini.php` de Matomo ; utiliser Redis comme cache d'objets de Matomo exige donc toujours
  une configuration manuelle après le déploiement.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre
(y compris l'immuabilité de `application_database_name`/
`application_database_user` après le premier déploiement et le moteur fixe `MYSQL_8_0`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, la base de données Cloud SQL, le secret Secret Manager, le bucket de données GCS,
le partage NFS Filestore et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), le NFS Filestore, le bucket GCS, le secret, et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la vérification de santé réussit ; terminer l'installateur web de Matomo et vérifier le suivi |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer secrets/stockage, accéder à la base de données, remarque sur la tâche d'archivage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de NFS, d'image, de stratégie de déploiement et de Redis |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
