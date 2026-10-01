---
title: "PeerTube sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez PeerTube sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/PeerTube_GKE.md @ 3055034 sha256:f3b6bb6d0bc2 -->

# PeerTube sur GKE Autopilot — Guide de lab {#peertube-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/PeerTube_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60 à 90 minutes

PeerTube est une plateforme open source d'hébergement vidéo fédérée via ActivityPub —
une alternative auto-hébergée à YouTube qui fédère les vidéos, les commentaires et les chaînes
avec d'autres instances PeerTube (et plus largement le Fediverse). Ce lab vous fait
parcourir tout le cycle de vie opérationnel du module **PeerTube on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités de PeerTube. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/PeerTube_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans
le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à la charge de travail en cours d'exécution et la vérifier, y compris le compte administrateur créé automatiquement.
- Vérifier que le correctif d'autorisations UID/GID GCS-FUSE propre à GKE sur `/data` est bien appliqué, et comprendre ce qui ne fonctionne pas sans lui.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Comprendre quand préférer cette variante à `PeerTube_CloudRun` (transcodage en production, futur streaming en direct).
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, le réseau Cloud SQL,
  Artifact Registry et les comptes de service partagés dont dépend ce
  module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"                 # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **PeerTube (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/PeerTube_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Si votre projet dispose
   d'un quota d'IP externes/statiques limité, définissez `service_type = "ClusterIP"` et prévoyez
   de vérifier via `kubectl port-forward` (tâche 2). Si vous disposez déjà d'un vrai domaine,
   définissez `host` dès maintenant (il devient immuable dès qu'un contenu ActivityPub réel
   existe) — sinon, laissez-le vide et le déploiement dérivera automatiquement un
   domaine de fédération fonctionnel à partir de l'URL prévue du service GKE.
   Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux
   en temps réel.

2. La plateforme provisionne le Deployment Kubernetes (ou un StatefulSet, si vous
   avez choisi `stateful_pvc_enabled = true`), une base de données Cloud SQL PostgreSQL 15
   avec un sidecar Cloud SQL Auth Proxy, ses secrets Secret Manager
   (`PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD`, les clés d'accès/secrètes HMAC
   GCS), deux buckets Cloud Storage (un bucket `videos` public et un bucket `data` privé
   monté via GCS-FUSE), construit l'image de conteneur personnalisée via
   Cloud Build et exécute un Job ponctuel d'initialisation de la base de données (création du rôle
   et de la base, plus les extensions `pg_trgm`/`unaccent`). Les premiers déploiements prennent
   généralement **20 à 35 minutes** (la création de Cloud SQL représente l'essentiel du temps).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin
   que les commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep peertube | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

   Si vous avez déployé avec `service_type = "ClusterIP"`, il n'y a pas d'IP
   externe — utilisez plutôt `kubectl port-forward` (tâche 2).

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est sain — **3/3 Running, 0 redémarrage** est le signal de santé
   de la plateforme par rapport auquel ce module a été vérifié (un pod qui redémarre en boucle
   correspond au bug d'autorisations GCS-FUSE que corrige ce module — voir la tâche 5) :

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"
   ```

2. Atteignez le point de terminaison de configuration public. Avec une IP externe :

   ```bash
   curl -s "http://$EXTERNAL_IP/api/v1/config" | head -c 500   # expect real JSON
   ```

   Sans IP externe (`service_type = "ClusterIP"`) :

   ```bash
   POD=$(kubectl get pods -n "$NAMESPACE" -l app="$SERVICE" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward -n "$NAMESPACE" "$POD" 19000:9000 &
   curl -s "http://localhost:19000/api/v1/config" | head -c 500        # expect real JSON
   curl -s "http://localhost:19000/api/v1/config/about" | head -c 500  # expect real JSON
   ```

3. **Vérifiez que le correctif UID/GID GCS-FUSE de GKE a bien pris effet.** Si le pod est
   `Running` avec `0` redémarrage (vérifié ci-dessus), ce contrôle est déjà réussi — une
   option de montage `uid=`/`gid=` manquante ou mal configurée se manifesterait par un
   `CrashLoopBackOff` avec `Error: EACCES: permission denied, mkdir
   '/data/logs'` dans les événements du pod, et non par un échec silencieux. Pour une
   confirmation positive, vérifiez que le répertoire de données monté est accessible en écriture et
   appartient au bon propriétaire :

   ```bash
   kubectl exec -n "$NAMESPACE" "$POD" -- ls -la /data
   # expect: logs/, avatars/, torrents/, plugins/, tmp/ — all owned peertube:peertube (uid/gid 999)
   ```

4. Récupérez le mot de passe de l'administrateur `root` créé automatiquement. PeerTube ne nécessite **aucune
   étape d'amorçage manuelle** — le compte `root` est créé automatiquement au
   premier démarrage à partir du secret `PT_INITIAL_ROOT_PASSWORD` :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~root-password" --format="value(name)")
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

5. Ouvrez l'URL du service (ou `http://localhost:19000` via le port-forward
   ci-dessus) sur `/login` dans un navigateur et connectez-vous en tant que `root` avec le
   mot de passe récupéré. Vérifiez que le domaine de fédération public de l'instance (Settings →
   visible dans le pied de page / la page « About » de l'instance) correspond à ce que vous
   attendez — si vous avez laissé `host` vide, il doit afficher l'URL du service
   dérivée.

6. Si vous prévoyez d'exploiter cette instance en production, décidez dès maintenant de la politique
   d'inscription : `enable_open_registration` vaut `false` par défaut. Conservez cette
   valeur sauf si vous souhaitez délibérément une instance ouverte aux inscriptions publiques.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son historique de déploiement :**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"           # Deployment mode (default)
   kubectl get statefulset "$SERVICE" -n "$NAMESPACE"       # StatefulSet mode, if stateful_pvc_enabled = true
   kubectl rollout status deploy/"$SERVICE" -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update**
   sur la page de détails du déploiement — le module est propriétaire de la spécification de la charge de travail, la
   mise à l'échelle est donc une modification de configuration, et non une modification manuelle via `kubectl` (une
   modification manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour le tag de version de l'application** en modifiant le paramètre de version dans
   la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite via
   l'ARG de build dédié `PEERTUBE_VERSION` et un nouveau déploiement progressif s'achève.

4. **Gérez les secrets et inspectez les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~peertube"
   kubectl get jobs -n "$NAMESPACE"    # the db-init job
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. peertubedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^peertube" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Vérifiez les buckets de stockage des vidéos :**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~peertube"
   gcloud storage ls gs://<videos-bucket>/
   ```

7. **Si vous avez besoin d'une véritable charge de transcodage en production**, c'est la bonne
   variante — augmentez `cpu_limit`/`memory_limit` bien au-delà de la valeur par défaut prudente
   `2000m`/`2Gi` (la FAQ de PeerTube recommande jusqu'à 8
   vCPU/8Gi) via le flux **Update** de la plateforme RAD. La variante Cloud Run est
   volontairement limitée au VOD/transcodage léger.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100 -f
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads de la charge de travail et
   examinez l'utilisation CPU/mémoire, le nombre de réplicas et le nombre de redémarrages des pods (0
   redémarrage est l'état stable attendu — tout redémarrage mérite une
   investigation, voir la tâche 5). Si un test de disponibilité est activé et que
   `service_type = "LoadBalancer"`, vérifiez qu'il est au vert sous Monitoring →
   Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de PeerTube.

- **Pod en `CrashLoopBackOff` avec `Error: EACCES: permission denied, mkdir
  '/data/logs'`.** Il s'agit du bug UID/GID GCS-FUSE propre à GKE que ce module
  corrige au niveau de la couche `PeerTube_Common` — le point d'entrée fourni par PeerTube applique un chown
  de `/data` vers l'uid/gid 999 dans le conteneur, mais le pilote CSI GCS FUSE de GKE
  ne respecte pas ce chown sans une option de montage explicite `uid=999,gid=999`.
  Si vous observez ce problème sur un fork ou avec une surcharge personnalisée de `gcs_volumes` qui
  contourne les options de montage de `PeerTube_Common`, la cause est là :
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Pod non sain pour une autre raison :** inspectez les événements et les journaux du pod. La
  sonde de démarrage est en **TCP** sur le port 9000 (et non en HTTP) — si le pod ne
  devient jamais Ready, c'est probablement que le conteneur n'écoute pas du tout sur le port (vérifiez
  s'il y a un échec de connexion à la base de données ou un secret manquant) plutôt qu'une
  vérification de disponibilité applicative trop lente.
  ```bash
  kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base existe, que le job `db-init` s'est terminé
  avec succès et que `enable_cloudsql_volume = true` (le sidecar Auth Proxy
  doit être en cours d'exécution pour fournir le loopback `127.0.0.1` qu'attend PeerTube).
- **Échec du job d'initialisation :** consultez l'état du Job et lisez les journaux du pod en échec :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<service-name>-db-init
  ```
- **L'envoi ou la lecture de vidéos échoue avec une erreur d'accès :** vérifiez que la
  prévention de l'accès public du bucket `videos` est à `inherited`, et non à `enforced`
  — si une modification manuelle l'a rétablie, l'attribution `allUsers:objectViewer` dont
  PeerTube a besoin échouera :
  ```bash
  gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
  ```
- **Pas d'IP externe / service inaccessible depuis un navigateur.** C'est attendu si vous
  avez déployé avec `service_type = "ClusterIP"` (un choix délibéré face à une
  contrainte de quota d'IP) — utilisez `kubectl port-forward` (tâche 2, étape 2) au lieu
  d'attendre une IP publique.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal
  du build en échec — une cause fréquente est une valeur `application_version` invalide qui ne
  correspond à aucun tag `chocobozzz/peertube` réel.
- **Erreurs 403 / d'autorisation :** vérifiez la liaison Workload Identity du
  compte de service de stockage, et en particulier son attribution sur le bucket
  `videos`.
- **Le streaming en direct ne fonctionne pas :** c'est le comportement attendu — `enable_live_streaming`
  n'est pas encore câblé à ce stade. Contrairement à la variante Cloud Run (où c'est impossible
  du fait de l'architecture), le modèle réseau de GKE pourrait le prendre en charge avec des ports
  supplémentaires sur le Service LoadBalancer, mais ce câblage n'a pas encore été implémenté.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment la règle essentielle de ne jamais modifier `host`
une fois qu'un contenu ActivityPub réel existe, et de ne jamais désactiver `enable_redis`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). La suppression retire tout ce que le module a
créé — la charge de travail et le Service Kubernetes (ou le StatefulSet + PVC, le cas
échéant), la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS `videos` et
`data`, et les images d'Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, l'instance Cloud SQL partagée, le registre)
sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, les buckets `videos`/`data`, et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | Pod `3/3 Running`, 0 redémarrage ; le point de terminaison de configuration répond ; propriété GCS-FUSE confirmée ; se connecter en tant qu'administrateur `root` créé automatiquement |
| 3 — Exploiter | Manuel | Inspecter le déploiement progressif, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base et aux buckets, augmenter les ressources pour un vrai transcodage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer le bug UID/GID GCS-FUSE et les problèmes de pod, de base de données, de job d'initialisation, d'IAM du stockage, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
