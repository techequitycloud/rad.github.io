---
title: "Uptime Kuma sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Uptime Kuma sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/UptimeKuma_CloudRun.md @ 3055034 sha256:ebe79fda7f6a -->

# Uptime Kuma sur Cloud Run — Guide de lab {#uptime-kuma-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/UptimeKuma_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Uptime Kuma est un outil auto-hébergé de supervision de disponibilité pour les sites web, les API, les ports TCP et les enregistrements DNS, avec des pages d'état et plus de 90 canaux de notification. Ce lab vous fait parcourir le cycle de vie opérationnel complet du module **Uptime Kuma on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Uptime Kuma. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/UptimeKuma_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service, effectuer la configuration administrateur initiale et vérifier son état de santé.
- Expliquer pourquoi Uptime Kuma a besoin d'un CPU toujours alloué et d'une instance en cours d'exécution pour superviser.
- Effectuer les opérations du jour 2 — inspecter les révisions, mettre à l'échelle, mettre à jour et vérifier l'état stocké sur NFS.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, la mise en réseau Filestore/NFS, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **UptimeKuma (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/UptimeKuma_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run avec un **CPU toujours alloué** (le
   planificateur de vérifications s'exécute entre les requêtes) et un partage NFS Filestore monté sur
   `/app/data` pour la base de données SQLite intégrée. Une étape Cloud Build construit une image
   personnalisée légère `FROM louislam/uptime-kuma` qui remplace le `journal_mode` SQLite codé en dur,
   de `WAL` à `DELETE` — le verrouillage par mémoire partagée de WAL n'est pas sûr sur
   le volume `/app/data` adossé à NFS — et l'image construite est poussée vers Artifact
   Registry. Il n'y a **ni instance Cloud SQL, ni secret applicatif, ni job
   d'initialisation** — c'est l'un des modules les plus rapides à déployer (généralement
   **10 à 15 minutes** ; aucun provisionnement de base de données).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~uptimekuma" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. Le chemin de santé d'Uptime Kuma est `/` sur le port 3001,
   qui renvoie HTTP 200 dès que le serveur Node.js est démarré (le premier démarrage crée aussi
   le schéma SQLite sur le volume NFS — comptez jusqu'à une minute sur un nouveau déploiement) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Au premier accès, Uptime Kuma présente sa
   **page de configuration** — créez le compte administrateur (aucun identifiant par défaut n'est
   intégré à l'image). **Faites-le immédiatement** : tant que le compte administrateur n'existe pas,
   la page de configuration est accessible publiquement à l'URL `run.app`. Le compte est
   stocké dans SQLite sur le volume NFS, il survit donc aux redémarrages et aux révisions.

3. Ajoutez une première sonde (par exemple une vérification HTTPS d'un site qui vous appartient) et regardez-la
   passer au vert. Notez qu'il n'y a **aucun secret à récupérer** — le module ne crée aucune
   entrée Secret Manager :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~uptimekuma"   # expect empty
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente révision saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mise à l'échelle — le paramètre le plus important pour cette application.** Avec la valeur par défaut
   `min_instance_count = 0`, le service descend à zéro instance en période d'inactivité et **aucune vérification
   ne s'exécute tant qu'il est arrêté**. Pour une véritable supervision 24 h/24, 7 j/7, définissez
   `min_instance_count = 1` et `max_instance_count = 1` (SQLite n'admet qu'un seul processus d'écriture)
   et cliquez sur **Update** sur la page de détails du déploiement — le module gère la
   spécification du service, la mise à l'échelle est donc une modification de configuration, et non une modification manuelle via `gcloud`
   (une modification manuelle serait annulée lors du prochain apply). Conservez
   `cpu_always_allocated = true` : sans CPU alloué, le planificateur interne au processus
   est bridé entre les requêtes et les vérifications se figent.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update**
   sur la page de détails du déploiement ; le nouveau tag d'image est mis en miroir et une nouvelle
   révision est déployée. Les sondes et l'historique sont conservés sur le volume NFS.

4. **Vérifiez que l'état persistant** réside sur NFS, et non sur un disque éphémère :

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="yaml(spec.template.spec.volumes)"
   ```

5. **Aucune session de base de données à ouvrir** — il n'y a pas d'instance Cloud SQL
   (`database_type = "NONE"`) ; tout l'état est le fichier SQLite sous `/app/data`.
   Sauvegardez-le par un export depuis l'interface d'Uptime Kuma (Settings → Backup) ou par
   un instantané du partage Filestore.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence, le **nombre d'instances** (avec `min = 1`, il ne doit jamais tomber à 0 —
   si c'est le cas, votre supervision présente des trous) et l'utilisation du CPU et de la mémoire. Comme
   le CPU est toujours alloué, attendez-vous à un niveau de CPU bas et constant même sans
   trafic sur le tableau de bord — c'est le planificateur de vérifications qui travaille.

3. **Surveillez le superviseur.** Vous pouvez activer le paramètre `uptime_check_config` du module
   (désactivé par défaut) afin que Google Cloud Monitoring sonde Uptime Kuma lui-même —
   un signal vu de l'extérieur indiquant que votre système de supervision fonctionne.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'Uptime Kuma.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et
  ses journaux ; la sonde de démarrage laisse un délai généreux pour le premier démarrage :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Les sondes présentent des trous / les alertes arrivent en retard :** la défaillance classique d'Uptime Kuma
  sur Cloud Run. Vérifiez `min_instance_count` (0 signifie que les vérifications s'interrompent en période d'inactivité) et
  `cpu_always_allocated` (doit valoir `true` ; la facturation à la requête bride le
  planificateur). Un nombre d'instances qui tombe à zéro dans Monitoring le confirme.
- **Données perdues après un redémarrage ou une mise à jour :** vérifiez que `enable_nfs = true`, que le chemin de
  montage est exactement `/app/data` et que l'environnement d'exécution est `gen2` (requis
  pour les montages Filestore dans Cloud Run). Si la liste des volumes de la tâche 3.4 est vide,
  Uptime Kuma a écrit sur un disque éphémère.
- **Erreurs de verrou SQLite / instabilité sous charge :** plus d'une instance écrit
  dans la base de données via NFS — définissez `max_instance_count = 1`.
- **Impossible d'atteindre des cibles privées supervisées :** les sondes vers des adresses RFC-1918 nécessitent
  une sortie VPC ; la valeur par défaut `vpc_egress_setting = "PRIVATE_RANGES_ONLY"` couvre
  ce cas. Pour les sondes qui doivent sortir via le VPC/NAT (IP source stable pour
  des cibles avec liste d'autorisation), définissez `ALL_TRAFFIC`.
- **Échec de la récupération de l'image / image obsolète :** confirmez que `container_image_source = "custom"`
  (la valeur par défaut — ce module comprend une véritable étape Cloud Build, et non une image préconstruite)
  et vérifiez le build et l'image poussée dans Artifact Registry
  (`gcloud builds list --project="$PROJECT"`,
  `gcloud artifacts docker images list ...`). Si le build n'apparaît jamais dans
  `tofu plan`/`tofu show -json plan.tfplan | jq`, vérifiez que `container_image_source`
  n'a pas été remplacé par `"prebuilt"` dans `deploy.tfvars` — cela saute le correctif SQLite
  WAL->DELETE et réexpose le risque de corruption NFS décrit dans la tâche 3.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
le partage NFS Filestore (y compris la base de données SQLite avec toutes les sondes et
l'historique — exportez d'abord une sauvegarde si vous souhaitez les conserver) et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le registre partagé) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run (CPU toujours alloué), NFS sur `/app/data`, et construit/met en miroir une image personnalisée corrigée pour un SQLite sûr sur NFS — sans base de données, secrets ni jobs d'initialisation |
| 2 — Accéder et vérifier | Manuel | La vérification de santé réussit ; compte administrateur créé sur la page de configuration initiale |
| 3 — Exploiter | Manuel | Inspecter les révisions, définir min=1/max=1 pour une supervision 24 h/24 à processus d'écriture unique, mettre à jour la version, vérifier l'état NFS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; surveiller le nombre d'instances et le niveau de CPU ; surveiller le superviseur (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de trous dus à la mise à zéro, de NFS/perte de données, de verrou SQLite, de sortie réseau et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
