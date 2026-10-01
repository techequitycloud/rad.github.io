---
title: "Uptime Kuma sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Uptime Kuma sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/UptimeKuma_GKE.md @ 3055034 sha256:8855645cdabd -->

# Uptime Kuma sur GKE Autopilot — Guide de lab {#uptime-kuma-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/UptimeKuma_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Uptime Kuma est un outil auto-hébergé de supervision de disponibilité pour les sites web, les API, les ports TCP et les enregistrements DNS, avec des pages d'état et plus de 90 canaux de notification. Ce lab vous fait parcourir le cycle de vie opérationnel complet du module **Uptime Kuma on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Uptime Kuma. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/UptimeKuma_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, trouver la charge de travail Uptime Kuma et vérifier qu'elle est saine.
- Expliquer pourquoi ce module n'a ni instance Cloud SQL ni entrée Secret Manager, et pourquoi tout l'état durable réside sur un unique partage Filestore (NFS).
- Effectuer les opérations du jour 2 — inspecter la charge de travail, comprendre pourquoi elle doit rester à un seul réplica, mettre à jour la version et vérifier les données stockées sur NFS.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, y compris le correctif du mode de journalisation SQLite sur NFS que ce module applique par défaut.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, la mise en réseau Filestore/NFS,
  Artifact Registry et les comptes de service partagés dont dépend ce
  module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon,
  le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **UptimeKuma (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/UptimeKuma_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme planifie la charge de travail sur le cluster GKE Autopilot, ne provisionne aucune
   instance Cloud SQL (`database_type = "NONE"`), ne crée aucune entrée Secret Manager
   et n'exécute aucun job d'initialisation de base de données — Uptime Kuma stocke tout dans une
   base de données SQLite intégrée qu'il crée lui-même au premier démarrage. La plateforme
   monte un partage Filestore (NFS) sur le chemin fixe du conteneur `/app/data`. Comme
   `container_image_source = "custom"` (la valeur par défaut), une étape Cloud Build
   construit d'abord une image légère `FROM louislam/uptime-kuma` qui remplace le `journal_mode`
   SQLite codé en dur, de `WAL` à `DELETE` — le verrouillage par mémoire partagée de WAL n'est pas sûr sur
   le volume `/app/data` adossé à NFS qu'utilise cette application (voir la tâche 3.5) — puis l'image
   construite est mise en miroir dans Artifact Registry (`enable_image_mirroring = true`).
   Comme il n'y a aucune base de données à provisionner, la durée de ce déploiement est dominée par l'étape Cloud
   Build, la planification des nœuds Autopilot et le montage NFS plutôt que par la création de Cloud SQL
   — attendez-vous à ce qu'il se termine sensiblement plus vite que les modules GKE adossés à une base de données,
   mais pas aussi vite qu'un module reposant réellement sur une image préconstruite.

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep uptimekuma | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est sain. Les sondes de démarrage et d'activité sont toutes deux un simple
   `GET /` HTTP sur le port `3001` — le port natif d'Uptime Kuma :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

   La sonde de démarrage est volontairement généreuse (délai initial de 30 s, période de 10 s, seuil
   d'échec de 30 — jusqu'à plusieurs minutes), ce qui couvre la création du schéma SQLite
   au premier démarrage sur un nouveau volume NFS.

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Au premier accès, Uptime Kuma présente son
   **assistant de configuration** — créez immédiatement le compte administrateur. Il n'existe aucun identifiant
   par défaut ou généré automatiquement à récupérer dans Secret Manager :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~uptimekuma"   # expect empty
   ```

   Tant que le compte administrateur n'existe pas, la page de configuration est accessible à quiconque trouve
   l'IP externe — ne laissez pas longtemps une instance fraîchement déployée sans configuration.

4. Ajoutez une première sonde (par exemple une vérification HTTPS d'un site qui vous appartient) et regardez-la
   passer au vert.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et le PVC adossé à NFS :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Ne dépassez pas un réplica.** `min_instance_count` et
   `max_instance_count` valent tous deux `1` par défaut et doivent le rester — la
   base de données SQLite intégrée d'Uptime Kuma n'admet qu'un seul processus d'écriture, et chaque pod partagerait sinon
   le même fichier de base de données monté via NFS. Contrairement aux modules qui se mettent à l'échelle via une file
   d'attente adossée à Redis, il n'existe aucun moyen pris en charge d'exécuter plus d'un réplica d'Uptime Kuma
   sur le même volume de données.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update**. Comme ce module est adossé à NFS, la
   Foundation définit la stratégie de mise à jour du Deployment sur `Recreate` plutôt que sur
   la valeur par défaut `RollingUpdate` — le pod en cours d'exécution est entièrement arrêté avant le démarrage
   de son remplaçant, au lieu de lancer un second pod qui écrirait sinon
   le même fichier SQLite simultanément. Attendez-vous à une courte interruption de la couverture de supervision
   pendant la mise à jour, et non à un remplacement progressif sans coupure.

4. **Confirmez qu'il n'y a ni secrets ni jobs d'initialisation à gérer** — ce module ne crée
   ni les uns ni les autres :

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~uptimekuma"   # expect empty
   kubectl get jobs -n "$NS"                                             # expect none by default
   ```

5. **Vérifiez que l'état persistant réside sur Filestore (NFS), et non sur un disque éphémère,**
   et sauvegardez-le :

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" -- ls -la /app/data
   ```

   Exportez régulièrement une sauvegarde depuis l'interface d'Uptime Kuma (Settings → Backup), en
   complément de toute stratégie d'instantanés Filestore.

   **SQLite sur NFS — corrigé par le build personnalisé du module.** Uptime Kuma
   définit inconditionnellement `PRAGMA journal_mode = WAL` à chaque démarrage (codé en dur dans
   `server/database.js`, non configurable par variable d'environnement). WAL repose sur un
   verrouillage par plages d'octets en mémoire partagée entre le fichier de base de données et son fichier annexe `-wal`,
   ce que NFS ne fournit pas de façon fiable — cette combinaison a déjà produit
   des erreurs `SQLITE_CORRUPT` constatées **même lorsque le montage Filestore/NFS lui-même
   était correctement configuré**. Ce module définit désormais par défaut
   `container_image_source = "custom"` (voir la tâche 1.2), qui construit une image légère
   `FROM louislam/uptime-kuma` dont le code source est corrigé pour passer le PRAGMA en mode `DELETE` —
   DELETE ne nécessite qu'un verrouillage standard du fichier entier, que NFS gère correctement.
   Ne remplacez pas `container_image_source` par `"prebuilt"` : cela saute le correctif
   et réexpose le risque de corruption WAL/NFS. L'étape d'export/sauvegarde depuis l'interface ci-dessus reste
   une bonne pratique pour la reprise après sinistre, mais elle ne compense plus un
   risque de corruption connu en fonctionnement normal.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et
   de la mémoire des pods ainsi que le nombre de redémarrages (un pod qui redémarre est le signal le plus rapide
   que la couverture de supervision présente des trous). Le module peut, en option, provisionner un
   **test de disponibilité** Cloud Monitoring sur le point de terminaison `GET /` d'Uptime Kuma lui-même
   (`uptime_check_config.enabled = false` par défaut) — un signal vu de l'extérieur indiquant que
   votre système de supervision fonctionne lui-même. Il est distinct des sondes que vous
   configurez dans l'interface d'Uptime Kuma.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'Uptime Kuma.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde
  d'activité est un `GET /` HTTP sur le port `3001` ; une charge de travail qui n'ouvre jamais ce port
  n'atteindra jamais l'état Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod en attente (Pending) / NFS non monté :** confirmez que l'instance Filestore est
  `READY` et que le PVC est `Bound` avant de conclure à un bogue applicatif :
  ```bash
  gcloud filestore instances list --project="$PROJECT"
  kubectl get pvc -n "$NS"
  kubectl describe pod -n "$NS" <pod>          # look for mount errors in Events
  ```
- **« database is corrupted » / SQLITE_CORRUPT dans les journaux :** voir la remarque de la tâche 3.5
  ci-dessus. Le build personnalisé de ce module remplace déjà le mode de journalisation de SQLite,
  de `WAL` à `DELETE` ; confirmez donc d'abord que `container_image_source = "custom"` a
  réellement été appliqué — consultez `gcloud builds list --project="$PROJECT"` pour le
  build et `kubectl exec -n "$NS" deploy/<name> -- grep journal_mode
  /app/server/database.js` pour confirmer que l'image déployée contient `DELETE`, et non
  `WAL`. Si `deploy.tfvars` indique `"prebuilt"` ou si le grep affiche toujours
  `WAL`, c'est la cause première — corrigez `container_image_source` et redéployez. Si
  le correctif est bien appliqué et que la corruption persiste, restaurez la
  sauvegarde Uptime Kuma la plus récente, ou supprimez le fichier SQLite sous `/app/data`
  et laissez Uptime Kuma recréer son schéma au prochain démarrage (l'historique des sondes est perdu
  jusqu'à la dernière sauvegarde).
- **Les sondes présentent des trous dans l'historique :** confirmez que le pod n'a pas redémarré
  (nombre de redémarrages dans `kubectl get pods -n "$NS"`) et qu'un seul réplica
  s'exécute — un `max_instance_count` supérieur à `1` risque une contention de verrou sur le fichier
  SQLite partagé, qui peut elle-même se manifester par des trous ou une corruption.
- **Pas d'IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes de ressources ou de
  quota, et confirmez que le Service LoadBalancer dispose d'une IP attribuée
  (`kubectl get svc -n "$NS"`).
- **Erreurs de récupération d'image / image obsolète :** ce module construit une image personnalisée via
  Cloud Build (`container_image_source = "custom"`, la valeur par défaut) et la pousse
  vers Artifact Registry — confirmez que le build a réussi
  (`gcloud builds list --project="$PROJECT"`), que l'image existe dans Artifact
  Registry et que le compte de service des nœuds peut la récupérer. Si le build ne s'exécute jamais,
  recherchez dans `deploy.tfvars` un remplacement de `container_image_source` par `"prebuilt"`
  — cela saute silencieusement le build et déploie l'image amont non corrigée
  (voir la tâche 3.5).
- **La mise à jour semble provoquer une interruption :** c'est attendu — voir la remarque sur la stratégie `Recreate`
  dans la tâche 3.3. Il s'agit d'un compromis délibéré pour éviter que deux pods écrivent le
  fichier SQLite en même temps, et non d'un déploiement bloqué.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment la raison pour laquelle `enable_nfs`, `nfs_mount_path` et
`max_instance_count` sont marqués à risque Critical/High).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, ainsi que le partage NFS Filestore (y compris la base de données SQLite avec toutes
les sondes et l'historique — exportez d'abord une sauvegarde si vous souhaitez les conserver). Il n'y a
par défaut ni instance Cloud SQL, ni secret Secret Manager, ni bucket GCS à nettoyer.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, la mise en réseau Filestore
partagée, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE avec un montage NFS Filestore sur `/app/data` et construit/met en miroir une image personnalisée corrigée pour un SQLite sûr sur NFS — sans Cloud SQL, secrets ni jobs d'initialisation |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la vérification de santé réussit ; créer le compte administrateur initial sur la page de configuration initiale |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, maintenir le nombre de réplicas à 1, mettre à jour la version (stratégie Recreate), vérifier et sauvegarder l'état SQLite stocké sur NFS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les redémarrages de pods et le CPU/la mémoire ; surveiller le superviseur (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de montage NFS, de corruption SQLite sur NFS, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
