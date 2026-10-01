---
title: "NetBox sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez NetBox sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Netbox_GKE.md @ 3055034 sha256:d0680c9c47e2 -->

# NetBox sur GKE Autopilot — Guide de lab {#netbox-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Netbox_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60 à 90 minutes

NetBox est l'outil open source de référence pour la documentation des réseaux et
des infrastructures et l'IPAM (gestion des adresses IP) — inventaire des équipements et des baies,
suivi des adresses IP et des préfixes, câblage et topologie réseau,
modélisés sous forme de données structurées derrière une API complète. Ce lab vous fait parcourir le
cycle de vie opérationnel complet du module **NetBox on GKE Autopilot** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit NetBox. Pour la liste complète des services provisionnés
et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Netbox_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au pod en cours d'exécution et le vérifier, notamment en confirmant que les fichiers multimédias téléversés
  sont réellement conservés dans Cloud Storage.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, en utilisant
  `kubectl exec` pour obtenir de vraies preuves plutôt que de deviner à partir des seuls journaux.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
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
export NAMESPACE="<namespace-from-outputs>"

gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **NetBox (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez
   en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Netbox_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Si votre projet dispose d'un quota
   d'adresses IP statiques restreint, définissez `service_type = "ClusterIP"` et
   `reserve_static_ip = false` pour un déploiement uniquement interne. Cliquez sur **Deploy
   Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre
   la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail GKE, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`SECRET_KEY`, `SUPERUSER_PASSWORD`
   et le mot de passe de la base de données), un bucket Cloud Storage `media` monté via GCS
   Fuse CSI, construit l'image de conteneur personnalisée (qui encapsule `netboxcommunity/netbox`)
   et exécute un Job ponctuel d'initialisation de la base de données. Les premiers déploiements prennent environ
   **20 à 35 minutes** (la création de Cloud SQL domine).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms :

   ```bash
   kubectl get pods,svc -n "$NAMESPACE" -l app~netbox
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep -i netbox | head -1)
   echo "Service: $SERVICE"
   kubectl get "$SERVICE" -n "$NAMESPACE" -o wide
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le pod est en cours d'exécution et sain :

   ```bash
   kubectl get pods -n "$NAMESPACE"    # expect Running, 0 restarts
   ```

2. Accédez au service. Si `service_type = "LoadBalancer"`, utilisez l'adresse IP externe
   indiquée par `kubectl get svc` ; si `service_type = "ClusterIP"`, utilisez une redirection de port :

   ```bash
   kubectl port-forward -n "$NAMESPACE" "$SERVICE" 18080:8080
   curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:18080/login/"   # expect 200
   ```

3. Récupérez les identifiants administrateur générés automatiquement et connectez-vous via le navigateur
   (ou `http://localhost:18080/login/` si vous utilisez la redirection de port) :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Connectez-vous en tant que `admin` (ou votre `admin_user` configuré) avec ce mot de passe.
   Vous devriez arriver sur le tableau de bord de NetBox.

4. **Vérifiez que les fichiers multimédias téléversés sont réellement conservés** — cela met en jeu exactement le
   chemin de code pour lequel ce module a eu besoin d'un véritable correctif. Téléversez une image en pièce jointe sur
   un objet quelconque dans l'interface, puis confirmez qu'elle a bien atterri dans le bucket GCS sous-jacent plutôt
   que sur le disque local du pod :

   ```bash
   MEDIA_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~media" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$MEDIA_BUCKET/"
   ```

   Le fichier téléversé devrait apparaître en quelques secondes.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son historique de déploiement :**

   ```bash
   kubectl get deploy -n "$NAMESPACE"
   kubectl rollout status deploy/<service-name> -n "$NAMESPACE"
   kubectl rollout history deploy/<service-name> -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal de réplicas et en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification du Deployment ; la
   mise à l'échelle est donc une modification de configuration, et non un `kubectl scale` manuel (une
   modification manuelle est annulée lors du prochain apply, et GKE ne propose pas de mise à l'échelle à zéro : au moins
   `min_instance_count` pods s'exécutent toujours). Le worker RQ d'arrière-plan de NetBox
   est hébergé dans le même pod et, contrairement à Cloud Run, s'exécute
   en continu par défaut, puisque GKE maintient toujours au moins un pod en cours d'exécution.

3. **Mettez à jour l'étiquette de version de l'application** en modifiant le paramètre de version dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite (en transmettant
   `application_version` comme ARG de build `APPLICATION_VERSION` du Dockerfile)
   et une mise à jour progressive la déploie.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~netbox"
   kubectl get jobs -n "$NAMESPACE"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. netboxdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^netbox" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads du déploiement et
   examinez l'utilisation du CPU et de la mémoire des pods, le nombre de redémarrages et le comportement de mise à l'échelle
   du HPA. Les tests de disponibilité nécessitent un point de terminaison joignable publiquement
   (`service_type = "LoadBalancer"`) ; s'il est configuré, confirmez qu'il est au vert sous
   Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Contrairement à
Cloud Run, GKE vous donne un véritable shell dans le conteneur en cours d'exécution — servez-vous-en.

- **Pod non sain / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde
  de démarrage cible `/login/` et autorise jusqu'à 60 tentatives à 10 secondes d'intervalle
  lors du premier démarrage.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod-name>
  kubectl logs -n "$NAMESPACE" <pod-name> --previous
  ```
- **La connexion échoue avec une erreur CSRF :** le paramètre `CSRF_TRUSTED_ORIGINS` de la charge de travail
  doit correspondre à son URL réellement joignable. Vérifiez ce qui est réellement injecté :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CSRF
  ```
- **Les téléversements « réussissent » dans l'interface mais n'apparaissent jamais dans le bucket GCS — c'est
  le mode de défaillance le plus instructif de ce module.** Un volume GCS Fuse
  monté au mauvais chemin laisse les téléversements sur le système de fichiers éphémère du pod,
  où ils se relisent sans problème (ce qui trompe une vérification rapide dans l'interface) mais disparaissent
  au redémarrage suivant du pod, **sans aucune erreur dans les journaux**. C'est
  exactement le bug livré dans une révision antérieure de ce module — et il n'a
  réellement été diagnostiqué qu'en ouvrant un vrai shell dans le pod et en demandant
  à NetBox lui-même où il pense que se trouve sa racine multimédia, plutôt qu'en devinant à partir de
  la documentation ou de l'organisation de l'image :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py shell \
    -c "from django.conf import settings; print(settings.MEDIA_ROOT)"
  # then confirm the GCS mount matches:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /etc/netbox/media
  gcloud storage ls "gs://$MEDIA_BUCKET/"
  ```
  Si une version de ce module réservée à Cloud Run présente un jour un symptôme qui
  ressemble à « la plateforme ne peut pas conserver de données ici » et qu'un équivalent GKE
  existe, déployer la variante GKE uniquement pour obtenir un accès shell est une
  étape de diagnostic légitime — c'est ce qui a réellement résolu ce bug précis.
- **Autorisation refusée lors de l'écriture sur le montage GCS :** confirmez que les options `uid`/`gid`
  du montage correspondent à l'utilisateur d'exécution réel du conteneur (l'image officielle de NetBox
  s'exécute en tant que root, uid 0) :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- id
  ```
- **Les webhooks, rapports ou jobs planifiés ne s'exécutent jamais :** confirmez que le processus du worker RQ
  est réellement actif dans le pod (il devrait l'être, en continu, puisque
  GKE ne propose pas de mise à l'échelle à zéro) :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ps aux | grep rqworker
  ```
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base de données existe et que le Job d'initialisation
  s'est terminé avec succès.
- **Échec du job d'initialisation :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez la liaison Workload Identity et les
  rôles IAM du ServiceAccount Kubernetes.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). Cela supprime tout ce que le module a créé —
la charge de travail GKE et son Service, la base de données Cloud SQL, les secrets Secret Manager, les buckets
GCS et les images Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées séparément et
ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, le bucket media, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Pod sain ; se connecter avec l'identifiant administrateur généré automatiquement ; confirmer que les fichiers multimédias téléversés arrivent dans GCS |
| 3 — Exploiter | Manuel | Inspecter le déploiement progressif, mettre à l'échelle, mettre à jour la version, gérer les secrets et les sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner le tableau de bord GKE Workloads et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de CSRF, d'autorisation sur le montage GCS, de persistance des fichiers multimédias, de worker d'arrière-plan, de base de données, de job d'initialisation, de build et d'IAM à l'aide de `kubectl exec` |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
