---
title: "Uptime Kuma sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Uptime Kuma sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/UptimeKuma_CloudRun.md @ 15fd4c7 sha256:adfbfdfe38a5 -->

# Uptime Kuma sur Cloud Run — Guide de lab {#uptime-kuma-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/UptimeKuma_CloudRun)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Uptime Kuma est un outil de surveillance de la disponibilité auto-hébergé pour les sites web, les API, les ports TCP et les enregistrements DNS, avec des pages d'état et plus de 90 canaux de notification. Ce lab vous guide à travers le cycle de vie opérationnel complet du module **Uptime Kuma sur Cloud Run** sur Google Cloud : déployez-le, accédez-y et vérifiez-le, exécutez-le au quotidien, observez-le, diagnostiquez les problèmes courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Uptime Kuma. Pour la liste complète des services provisionnés et de chaque entrée de configuration (organisée par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/UptimeKuma_CloudRun) — ce lab ne duplique délibérément pas ces détails afin qu'ils restent précis au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service, effectuer la configuration d'administration initiale et vérifier l'état de santé.
- Expliquer pourquoi Uptime Kuma a besoin d'un CPU toujours alloué et d'une instance en cours d'exécution pour surveiller.
- Effectuer les opérations de jour 2 — inspecter les révisions, mettre à l'échelle, mettre à jour et vérifier l'état sauvegardé par NFS.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer le déploiement proprement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, la mise en réseau Filestore/NFS, Artifact Registry et les comptes de service partagés dont ce module dépend). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà dans le projet cible et le provisionne avant ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM de **Propriétaire de projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la boîte de dialogue de confirmation de déploiement vous demande de prouver que vous le contrôlez (**Obtenir le code de vérification**, exécutez les commandes qu'il affiche en tant que Propriétaire de projet, puis **Vérifier**) et de donner le rôle de **Propriétaire** au compte de service de déploiement RAD. Un projet créé par RAD pour vous n'a besoin ni de l'un ni de l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées (et, dans un projet que RAD crée pour vous, guère plus que le nom du locataire et la région). Toutes les autres entrées du Guide de configuration — y compris les entrées de mise à l'échelle et de version dans les tâches de jour 2 — sont modifiées ultérieurement avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la navigation supérieure de la plateforme RAD, ouvrez **UptimeKuma (Cloud Run)** depuis la liste **Modules de plateforme** pour commencer la configuration, choisissez **Formulaire de configuration** sous *Comment souhaitez-vous configurer ce déploiement ?* (le formulaire s'ouvre sur l'**Assistant conversationnel** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`, et examinez les entrées. Ne configurez que ce dont vous avez besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/UptimeKuma_CloudRun) documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur **Déployer le module**, examinez le coût estimé dans la boîte de dialogue **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run avec le **CPU toujours alloué** (le planificateur de vérification s'exécute entre les requêtes) et un partage NFS Filestore monté à `/app/data` pour la base de données SQLite embarquée. Une étape Cloud Build construit une image personnalisée mince `FROM louislam/uptime-kuma` qui corrige le SQLite codé en dur `journal_mode` de `WAL` à `DELETE` — le verrouillage de la mémoire partagée de WAL est dangereux sur le volume `/app/data` sauvegardé par NFS — et l'image construite est poussée vers Artifact Registry. Il n'y a **pas d'instance Cloud SQL, pas de secret d'application et pas de job d'initialisation** — c'est l'un des modules les plus rapides à déployer (généralement **10 à 15 minutes** ; pas de provisionnement de base de données).

3. Une fois terminé, découvrez les ressources avec des filtres agnostiques au nom (afin que les commandes continuent de fonctionner quel que soit le suffixe de déploiement) :

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

1. Confirmez que le service est sain. Le chemin de santé d'Uptime Kuma est `/` sur le port 3001, qui renvoie HTTP 200 une fois que le serveur Node.js est démarré (le premier démarrage crée également le schéma SQLite sur le volume NFS — prévoyez jusqu'à une minute pour un nouveau déploiement) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Lors du premier accès, Uptime Kuma présente sa **page de configuration** — créez le compte administrateur (il n'y a pas de identifiants par défaut intégrés à l'image). **Faites-le immédiatement** : tant que le compte administrateur n'existe pas, la page de configuration est accessible publiquement à l'URL `run.app`. Le compte est stocké dans SQLite sur le volume NFS, il survit donc aux redémarrages et aux révisions.

3. Ajoutez un premier moniteur (par exemple, une vérification HTTPS sur un site que vous possédez) et regardez-le passer au vert. Notez qu'il n'y a **aucun secret à récupérer** — le module ne crée aucune entrée Secret Manager :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~uptimekuma"   # expect empty
   ```

---

## Tâche 3 — Opérer et le maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision immuable ; le trafic bascule vers la plus récente et saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mise à l'échelle — le paramètre le plus important pour cette application.** Les valeurs par défaut sont `min_instance_count = 1` et `max_instance_count = 1` (SQLite est à un seul rédacteur) ; conservez-les. À `min_instance_count = 0`, le service se met à l'échelle à zéro lorsqu'il est inactif et **aucune vérification ne s'exécute lorsqu'il est arrêté**. Toute modification passe par **Update** sur la page des détails du déploiement — le module possède la spécification du service, donc la mise à l'échelle est un changement de configuration, pas une modification manuelle `gcloud` (une modification manuelle serait annulée lors du prochain apply). Conservez `cpu_always_allocated = true` : sans CPU alloué, le planificateur intégré est ralenti entre les requêtes et les vérifications s'arrêtent.

3. **Mettez à jour la version de l'application** en modifiant l'entrée de version via **Update** sur la page des détails du déploiement ; la nouvelle balise d'image est mise en miroir et une nouvelle révision est déployée. Les moniteurs et l'historique persistent sur le volume NFS.

4. **Vérifiez que l'état persistant** réside sur NFS, et non sur un disque éphémère :

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="yaml(spec.template.spec.volumes)"
   ```

5. **Aucune session de base de données à ouvrir** — il n'y a pas d'instance Cloud SQL (`database_type = "NONE"`) ; tout l'état est le fichier SQLite sous `/app/data`. Sauvegardez-le en exportant depuis l'interface utilisateur d'Uptime Kuma (Paramètres → Sauvegarde) ou en créant un instantané du partage Filestore.

---

## Tâche 4 — Observer : Journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'Explorateur de journaux :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run pour le service et examinez le nombre de requêtes, la latence, le **nombre d'instances** (avec `min = 1`, il ne devrait jamais tomber à 0 — si c'est le cas, votre surveillance présente des lacunes), et l'utilisation du CPU / de la mémoire. Étant donné que le CPU est toujours alloué, attendez-vous à une ligne de base CPU faible et stable même sans trafic sur le tableau de bord — c'est le planificateur de vérification qui fonctionne.

3. **Surveiller le moniteur.** Activez éventuellement `uptime_check_config` du module (désactivé par défaut) afin que Google Cloud Monitoring sonde Uptime Kuma lui-même — un signal externe indiquant que votre système de surveillance est opérationnel.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme et ils ne changent pas avec les versions d'Uptime Kuma.

- **Révision non saine / le service ne fonctionne pas :** inspectez la dernière révision et ses journaux ; la sonde de démarrage accorde un temps généreux pour le premier démarrage :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Les moniteurs présentent des lacunes / les alertes arrivent en retard :** la défaillance classique d'Uptime Kuma sur Cloud Run. Vérifiez `min_instance_count` (0 signifie que les vérifications sont interrompues en cas d'inactivité) et `cpu_always_allocated` (doit être `true` ; la facturation basée sur les requêtes ralentit le planificateur). La chute du nombre d'instances à zéro dans Monitoring le confirme.
- **Données perdues après un redémarrage ou une mise à jour :** vérifiez `enable_nfs = true`, le chemin de montage est exactement `/app/data`, et l'environnement d'exécution est `gen2` (requis pour les montages Filestore dans Cloud Run). Si la liste des volumes de la tâche 3.4 est vide, Uptime Kuma a écrit sur un disque éphémère.
- **Erreurs de verrouillage SQLite / instabilité sous charge :** plus d'une instance écrit dans la base de données via NFS — définissez `max_instance_count = 1`.
- **Impossible d'atteindre les cibles privées surveillées :** les sondes vers les adresses RFC-1918 nécessitent une sortie VPC ; la valeur par défaut `vpc_egress_setting = "PRIVATE_RANGES_ONLY"` couvre cela. Pour les sondes qui doivent sortir via le VPC/NAT (adresse IP source stable pour les cibles autorisées), définissez `ALL_TRAFFIC`.
- **Échec de l'extraction d'image / image obsolète :** confirmez `container_image_source = "custom"` (la valeur par défaut — ce module livre une véritable étape Cloud Build, pas une image pré-construite) et vérifiez le build et l'image poussée dans Artifact Registry (`gcloud builds list --project="$PROJECT"`, `gcloud artifacts docker images list ...`). Si le build n'apparaît jamais dans `tofu plan`/`tofu show -json plan.tfplan | jq`, vérifiez que `container_image_source` n'a pas été remplacé par `"prebuilt"` dans `deploy.tfvars` — cela ignore le correctif SQLite WAL->DELETE et réexpose le risque de corruption NFS décrit dans la tâche 3.
- **403 / erreurs d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Pièges de configuration* du Guide de configuration pour les problèmes spécifiques aux paramètres.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône **Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles qui entrent en conflit avec l'état Terraform), utilisez **Purger** à la place (depuis la même boîte de dialogue **Supprimer**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD). Cela supprime tout ce que le module a créé — le service Cloud Run, le partage NFS Filestore (y compris la base de données SQLite avec tous les moniteurs et l'historique — exportez d'abord une sauvegarde si vous souhaitez les conserver), et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le registre partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run (CPU toujours alloué), NFS à `/app/data`, et construit/met en miroir une image personnalisée corrigée pour un SQLite compatible NFS — pas de base de données, de secrets ou de jobs d'initialisation |
| 2 — Accéder et vérifier | Manuel | La vérification de santé réussit ; le compte administrateur est créé sur la page de configuration initiale |
| 3 — Opérer | Manuel | Inspecter les révisions, définir min=1/max=1 pour une surveillance 24h/24 et 7j/7 à un seul rédacteur, mettre à jour la version, vérifier l'état NFS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; surveiller le nombre d'instances et la ligne de base du CPU ; éventuellement surveiller le moniteur |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes de révision, les lacunes de mise à l'échelle à zéro, la perte de données/NFS, le verrouillage SQLite, la sortie et les problèmes IAM |
| 6 — Supprimer | Automatisé | Supprimer (Corbeille) supprime toutes les ressources du module |
