---
title: "Wallos sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Wallos sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Wallos_CloudRun.md @ 3055034 sha256:0af0009dcc2d -->

# Wallos sur Cloud Run — Guide de lab {#wallos-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallos_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Wallos est un outil open source et auto-hébergé de suivi des abonnements et des dépenses récurrentes,
construit en PHP 8.3 + php-fpm simple — il suit les abonnements récurrents, convertit
les prix entre devises, envoie des notifications de renouvellement et prend en charge un mode
multi-utilisateur pour un foyer, sans base de données externe. Ce lab vous fait parcourir l'intégralité du
cycle de vie opérationnel du module **Wallos on Cloud Run** sur Google Cloud :
le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Wallos. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallos_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris la connexion administrateur par défaut.
- Comprendre pourquoi ce module est fixé à une seule instance toujours active et ne doit
  jamais être réduit à zéro ni dépasser un réplica.
- Effectuer les opérations du jour 2 — inspecter les révisions, gérer l'ingress et inspecter
  l'état persistant stocké dans GCS.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Wallos (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallos_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Notez que **l'ingress vaut par défaut
   `all`** (public) — décidez dès le départ si vous avez besoin de `ingress_settings = "internal"`
   pour restreindre l'accès au VPC. Notez également que `min_instance_count`,
   `max_instance_count` et `cpu_always_allocated` sont tous fixés à leurs valeurs par défaut
   raisonnables (`1`, `1`, `true`) pour une vraie raison — consultez la tâche 3 avant de les modifier.
   Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui
   ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, un volume **NFS** partagé monté
   sur `/var/www/html/db` contenant la base de données SQLite (`enable_nfs` vaut par défaut
   `true` et `enable_gcs_db_volume` vaut `false` — GCS FUSE ne peut pas supporter le verrouillage
   de SQLite), un bucket Cloud Storage `uploads` monté sur
   `/var/www/html/images/uploads/logos` contenant les logos personnalisés des fournisseurs (un bucket `db`
   est tout de même créé mais n'est pas monté par défaut),
   et récupère l'image préconstruite `bellamy/wallos`. Il n'y a ni instance Cloud SQL,
   ni secret applicatif dans Secret Manager, ni job d'initialisation de la base de données —
   Wallos est autonome. Les premiers déploiements se terminent généralement en **5–10 minutes**.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~wallos" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Wallos ne documente aucun point de terminaison de santé dédié ;
   la sonde (et cette vérification) interroge donc la page de connexion sur `/` :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. `ingress_settings` vaut par défaut `all` (public) ; l'URL ci-dessus devrait donc déjà être
   accessible depuis votre poste de travail. Si elle a été changée en `internal`, le service n'est
   accessible que depuis l'intérieur du VPC — interrogez-le avec curl depuis Cloud Shell ou une VM sur le même
   réseau, ou définissez `ingress_settings = "all"` dans la plateforme RAD et appliquez via
   **Update** pour y accéder de nouveau depuis votre poste de travail.

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec l'identifiant par défaut initialisé
   **`admin` / `admin`**. Changez immédiatement le mot de passe sous **Settings →
   Account** — cet identifiant est bien connu et donne le contrôle total des
   données d'abonnement.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez jamais une instance et ne réduisez jamais à zéro.** C'est plus strict
   que la règle empirique habituelle « éviter les démarrages à froid » — Wallos exécute un véritable
   démon cron toujours actif (8 tâches planifiées intégrées : actualisation des taux de change,
   notifications de renouvellement, une interrogation de vérification d'e-mail toutes les 2 minutes, et d'autres)
   qui ne se déclenche que lorsqu'une instance s'exécute avec du CPU alloué. Laissez
   `min_instance_count = 1`, `max_instance_count = 1` et `cpu_always_allocated =
   true` dans la plateforme RAD ; une modification manuelle avec `gcloud` serait de toute façon annulée lors de la prochaine
   application, et une réduction à zéro arrête silencieusement toutes les tâches planifiées sans aucune
   erreur — les notifications de renouvellement cessent tout simplement d'arriver.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; `bellamy/wallos` est récupérée à nouveau, et une
   nouvelle révision est déployée.

4. **Modifiez l'ingress ou ajoutez un contrôle d'accès** — basculez `ingress_settings` entre
   `internal` et `all`, ou activez `enable_iap` avec des utilisateurs/groupes autorisés, puis
   appliquez via **Update**.

5. **Inspectez l'état persistant** — la base de données SQLite réside sur le volume NFS
   monté sur `/var/www/html/db`, et les logos personnalisés des fournisseurs résident dans le bucket GCS `uploads`
   indiqué dans les Outputs du déploiement. Ne supprimez jamais le volume NFS ni
   le bucket `uploads` ; cela détruirait définitivement cet état :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~wallos"
   gcloud storage ls gs://<uploads-bucket>/
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer). Comme le démon cron de Wallos s'exécute
   dans le processus, l'activité de ses tâches planifiées n'est visible qu'ici (il n'existe pas
   de Cloud Run Job distinct pour lui) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes, le nombre d'instances (qui doit rester exactement à 1) et l'utilisation du CPU /
   de la mémoire. Si `uptime_check_config` est activé, vérifiez qu'il est au vert
   sous Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Wallos.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux pour repérer les erreurs de démarrage. La sonde de démarrage cible `/` avec un délai de 15 secondes —
  le démarrage est rapide puisqu'il n'y a aucune migration à attendre.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Service inaccessible depuis votre poste de travail :** vérifiez `ingress_settings` — la
  valeur par défaut est `all` (public) ; si elle a été changée en `internal` (VPC uniquement), il s'agit
  du comportement attendu, et non d'une panne.
- **Montage NFS / GCS FUSE / état non persisté :** vérifiez que `execution_environment = gen2`
  (requis pour les montages NFS et GCS FUSE) et que le volume NFS et le
  bucket `uploads` existent toujours.
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  gcloud storage buckets list --project="$PROJECT" --filter="name~wallos"
  ```
- **Les notifications de renouvellement ou les mises à jour des taux de change n'arrivent plus :** cela signifie presque
  toujours que l'instance a été réduite à zéro ou que `cpu_always_allocated` a été basculé
  à `false` — vérifiez d'abord `min_instance_count` et `cpu_always_allocated`, avant de
  supposer un bogue au niveau de l'application.
- **La connexion indique que `admin`/`admin` est toujours actif après un redéploiement :** c'est attendu —
  l'identifiant n'est initialisé que si aucune base SQLite n'existe encore à
  `/var/www/html/db/wallos.db`. Si une invite admin/admin vierge apparaît
  de manière inattendue, le volume NFS qui sous-tend ce chemin a peut-être été remplacé ou
  vidé ; recherchez une suppression/recréation dans Cloud Audit Logs.
- **Logos de fournisseurs par défaut manquants au premier déploiement :** si `bellamy/wallos` intègre
  des ressources par défaut sous les chemins montés, elles peuvent être masquées par le montage
  du volume (voir le tableau des pièges du Guide de configuration) — c'est une zone de risque connue
  mais non confirmée, à vérifier en premier.
- **Échec de la récupération de l'image :** vérifiez que `bellamy/wallos` (ou la copie miroir dans Artifact
  Registry) est accessible ; consultez l'historique Cloud Build si la mise en miroir des images est
  activée.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle de conserver `min_instance_count = max_instance_count
= 1` avec `cpu_always_allocated = true`, et de ne jamais supprimer le volume NFS de la base de données
ni le bucket `uploads`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — le service Cloud Run, les buckets GCS `db` et `uploads` (y compris les logos personnalisés — c'est destructif et irrécupérable) et les images Artifact Registry. La base de données SQLite elle-même réside sur le volume NFS monté sur `/var/www/html/db` ; copiez-la d'abord si vous souhaitez la conserver. Les ressources appartenant à **Services_GCP** (le VPC, l'Artifact Registry partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, le volume NFS de la base de données et le bucket GCS FUSE `uploads` ; pas de Cloud SQL, pas de job d'initialisation |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit ; se connecter avec l'identifiant initialisé `admin`/`admin` et changer immédiatement le mot de passe |
| 3 — Exploiter | Manuel | Inspecter les révisions, conserver `min = max = 1` + `cpu_always_allocated = true`, mettre à jour la version, ajuster l'ingress, inspecter l'état NFS/GCS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, d'ingress, de NFS/GCS FUSE, de démon cron et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime le service et les buckets `db`/`uploads` (destructif) — la base de données SQLite réside sur le volume NFS |
