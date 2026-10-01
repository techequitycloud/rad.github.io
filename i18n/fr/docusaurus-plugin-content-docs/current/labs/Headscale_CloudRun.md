---
title: "Headscale sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Headscale sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Headscale_CloudRun.md @ 3055034 sha256:cf8b679e4fcf -->

# Headscale sur Cloud Run — Guide de lab {#headscale-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Headscale_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–45 minutes

Headscale est une implémentation open source et auto-hébergée du serveur de
coordination Tailscale — le plan de contrôle d'un VPN maillé WireGuard privé,
compatible avec les clients Tailscale officiels. Ce lab vous fait parcourir
l'intégralité du cycle de vie opérationnel du module **Headscale on Cloud Run** sur
Google Cloud : le déployer, y accéder et le vérifier, enregistrer votre premier client,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.
Contrairement à la plupart des modules de ce catalogue, il n'y a **aucune base de données externe**
à attendre — Headscale est entièrement autonome autour d'un fichier SQLite
intégré, si bien que les premiers déploiements sont relativement rapides.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les concepts réseau de Tailscale/WireGuard. Pour la liste complète
des services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Headscale_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact
dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, y compris via son véritable point de terminaison `/health`.
- Créer le premier utilisateur Headscale et une clé de pré-authentification, puis enregistrer un vrai client Tailscale auprès du serveur.
- Effectuer les opérations du jour 2 — inspecter les révisions, comprendre pourquoi la mise à l'échelle horizontale ne s'applique pas, et mettre à jour la version.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, y compris le compromis SQLite/gcsfuse propre à cette plateforme.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifiée : `gcloud auth login` et
  `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- *(Facultatif, pour la tâche 2)* le [client Tailscale](https://tailscale.com/download)
  installé sur un appareil que vous pouvez utiliser pour tester un véritable enregistrement.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Headscale (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Headscale_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit l'image Headscale personnalisée (une base amont construite avec `ko`
   à laquelle s'ajoute une configuration intégrée), provisionne le service Cloud Run et son
   bucket GCS `storage` (monté sur `/var/lib/headscale` pour le fichier
   SQLite), puis démarre le service. Il n'y a **ni instance Cloud SQL ni
   tâche d'initialisation de base de données** à attendre — SQLite se crée lui-même au premier
   démarrage — si bien que les premiers déploiements se terminent généralement en **5–10 minutes** environ,
   l'essentiel du temps étant consacré au build de l'image.

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~headscale" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Headscale expose un véritable point de terminaison
   de santé, sans authentification :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"   # expect 200
   ```

2. Consultez les journaux de démarrage pour retrouver la séquence de confirmation qu'un premier démarrage
   réussi produit — génération de la clé privée, ouverture réussie de la base de données, et le
   serveur annonçant qu'il est à l'écoute :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   # Look for lines resembling:
   #   ...generating new private key...
   #   ...database opened successfully...
   #   ...listening and serving HTTP...
   ```

3. **Créez le premier utilisateur et une clé de pré-authentification.** Headscale n'a pas de parcours
   d'inscription web — la CLI est le seul moyen de créer un utilisateur et d'enregistrer
   des clients. Lancez une exécution ponctuelle du même binaire que celui utilisé par le service
   (adaptez à la façon dont la plateforme nomme sa ressource de tâche/d'exécution pour ce
   déploiement — consultez `gcloud run jobs list` si le nom exact de la tâche ci-dessous
   ne correspond pas) :

   ```bash
   JOB=$(gcloud run jobs list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~headscale" --format="value(metadata.name)" --limit=1)

   gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" \
     --command="/ko-app/headscale" --args="users,create,myuser" --wait

   gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" \
     --command="/ko-app/headscale" --args="preauthkeys,create,--user,myuser,--reusable,--expiration,1h" --wait
   ```

   Lisez la clé de pré-authentification dans les journaux de l'exécution de la tâche.

4. **Enregistrez un vrai client Tailscale** (facultatif, nécessite que le client
   Tailscale soit installé) :

   ```bash
   tailscale up --login-server="$SERVICE_URL" --authkey=<preauthkey-from-step-3>
   ```

   L'appareil devrait se connecter et apparaître dans le registre des nœuds de Headscale.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions :**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **La mise à l'échelle ne s'applique pas comme pour les autres modules.**
   `max_instance_count` est fixé en dur à `1` dans `Headscale_Common` —
   modifier le paramètre `max_instance_count` dans la plateforme RAD n'a **aucun
   effet** ; Headscale ne prend pas en charge le mode actif-actif et deux processus écrivant dans
   le même fichier SQLite le corrompraient. `min_instance_count = 0` (la
   valeur par défaut) permet la mise à l'échelle jusqu'à zéro avec des démarrages à froid rapides, puisqu'il n'y a
   ni base de données ni index à préchauffer.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite
   à partir de la base amont épinglée `headscale/headscale:<version>-debug` et une
   nouvelle révision est déployée.

4. **Listez les nœuds enregistrés :**

   ```bash
   gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" \
     --command="/ko-app/headscale" --args="nodes,list" --wait
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   **Surveillez tout particulièrement les erreurs d'écriture gcsfuse** (`BufferedWriteHandler.OutOfOrderError`)
   faisant référence à `db.sqlite`/`db.sqlite-wal`/`db.sqlite-shm` — voir la tâche 5 pour
   leur signification et pourquoi il s'agit d'un risque accepté et documenté sur cette
   plateforme.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes, le nombre d'instances (qui ne doit indiquer que 0 ou 1 —
   la mise à l'échelle au-delà de 1 ne se produit jamais sur ce module) et l'utilisation du CPU/de la
   mémoire. Le module peut provisionner un **test de disponibilité** (uptime check) sur `/health`
   (lorsque `uptime_check_config.enabled = true` — la valeur par défaut est `false`) ; s'il est
   activé, vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il
s'agit de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Headscale.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision
  et ses journaux à la recherche d'erreurs de démarrage — le plus souvent un échec de validation
  de la configuration. Headscale 0.26.1 échoue brutalement si `noise.private_key_path` est absent
  ou si le bloc `dns:` est incomplet ; ces deux cas sont déjà correctement gérés dans le
  `config.yaml` livré, donc voir l'une de ces erreurs suggère que l'image a été construite
  à partir d'une configuration modifiée.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs SQLite/de stockage — un compromis de plateforme connu et accepté, pas
  nécessairement un bug.** Des entrées de journal `BufferedWriteHandler.OutOfOrderError` répétées
  faisant référence à `db.sqlite`/`db.sqlite-wal`/`db.sqlite-shm` signifient que
  la sémantique d'écriture de gcsfuse entre en conflit avec les exigences de verrouillage de fichiers
  du mode WAL de SQLite. C'est documenté et attendu sur Cloud Run — voir
  la section Pitfalls du Guide de configuration. Ce n'est sûr que parce que
  `max_instance_count` est fixé en dur à `1`. Si vous avez besoin de garanties d'intégrité
  des données plus fortes que ce que gcsfuse peut offrir, déployez plutôt
  [Headscale_GKE](https://docs.radmodules.dev/docs/modules/Headscale_GKE)
  — il utilise par défaut un véritable PVC de stockage en mode bloc.
- **Le client Tailscale ne parvient pas à s'enregistrer / `tailscale up` échoue :** vérifiez
  `ingress_settings = "all"` (l'entrée publique est nécessaire pour que de vrais appareils
  clients atteignent le serveur) et `enable_iap = false` (IAP exige une
  identité Google, que la CLI `tailscale` ne peut pas présenter). Vérifiez que la
  valeur de `--login-server` correspond exactement à `server_url`/l'URL du service
  déployé.
- **Échec de la construction de l'image :** consultez l'historique Cloud Build pour le journal du build
  en échec — le plus souvent un problème transitoire de récupération de l'image amont depuis Docker Hub
  (atténué par `enable_image_mirroring = true`, la valeur par défaut).
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service
  d'exécution.

Consultez la section *Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre, notamment la règle essentielle selon laquelle `server_url` ne doit pas changer
une fois que des clients se sont enregistrés.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles
en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Cela supprime tout ce que le module a créé —
le service Cloud Run, le bucket GCS `storage` (et avec lui, l'intégralité du registre
des nœuds et la clé privée Noise — chaque client précédemment enregistré devrait
se réenregistrer auprès d'un nouveau déploiement) et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le registre partagé) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image personnalisée et provisionne le service Cloud Run et le bucket `storage` ; ni Cloud SQL, ni tâche d'initialisation |
| 2 — Accès et vérification | Manuel | `/health` renvoie 200 ; créer le premier utilisateur + une clé de pré-authentification ; enregistrer un vrai client Tailscale |
| 3 — Exploiter | Manuel | Inspecter les révisions ; comprendre pourquoi `max_instance_count` n'a aucun effet ; mettre à jour la version ; lister les nœuds |
| 4 — Observer | Manuel | Interroger Cloud Logging (surveiller les erreurs d'écriture gcsfuse) ; consulter les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de validation de configuration, SQLite/gcsfuse, d'enregistrement des clients et de build |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le registre des nœuds |
