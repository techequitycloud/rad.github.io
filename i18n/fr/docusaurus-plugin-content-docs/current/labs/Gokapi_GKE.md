---
title: "Gokapi sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Gokapi sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Gokapi_GKE.md @ 3055034 sha256:276d52648050 -->

# Gokapi sur GKE Autopilot — Guide de lab {#gokapi-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gokapi_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Gokapi est un serveur de partage de fichiers léger et auto-hébergé, écrit en Go — une
alternative auto-hébergée à WeTransfer, qui génère des liens de téléchargement partageables avec
expiration, limite du nombre de téléchargements et protection par mot de passe facultatives. Ce lab vous guide
à travers le cycle de vie opérationnel complet du module **Gokapi on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Gokapi. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gokapi_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d'exécution et revendiquer le
  compte administrateur.
- Effectuer les opérations du jour 2 — inspecter la charge de travail, la mettre à l'échelle correctement, mettre à jour la
  version, et gérer la clé d'API facultative et le stockage PVC.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Gokapi (GKE)**
   dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Gokapi_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie Gokapi dans le cluster GKE Autopilot sous la forme d'un
   **StatefulSet** à pod unique avec un Persistent Volume Claim en mode bloc de 20Gi monté sur `/data` —
   ce PVC assure la persistance de Gokapi à la fois pour sa base de données SQLite interne et
   pour chaque fichier téléversé (il n'y a pas d'instance Cloud SQL ; `database_type` est fixé
   à `NONE`). Une Kubernetes Gateway avec une adresse IP externe statique réservée est
   provisionnée par défaut (`enable_custom_domain = true`, `reserve_static_ip =
   true`), ce qui donne à Gokapi un point de terminaison public d'emblée. Aucun
   job d'initialisation de base de données ne s'exécute — Gokapi gère son propre stockage. Comme
   il n'y a pas d'instance Cloud SQL à provisionner, les premiers déploiements sont nettement
   plus rapides que ceux des modules adossés à une base de données — généralement **10–20 minutes**, dominées
   par le provisionnement des nœuds, le build de l'image et la propagation de la Gateway.

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants du nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep gokapi | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,statefulset,pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse publique. Comme
   `service_type` vaut par défaut `ClusterIP`, le point d'entrée public est la
   Gateway/HTTPRoute, et non directement le Service Kubernetes :

   ```bash
   kubectl get pods,svc,statefulset,pvc -n "$NS"
   kubectl get gateway,httproute -n "$NS"
   gcloud compute addresses list --project="$PROJECT"   # the reserved static IP
   ```

   Le nom d'hôte par défaut est `<reserved-ip>.nip.io`, sauf si un domaine personnalisé a été
   configuré via `application_domains`.

2. Vérifiez que le service est opérationnel. Les sondes de santé de Gokapi interrogent la racine publique ; un
   simple `curl` suffit donc comme test de disponibilité (aucun point de terminaison d'API ni authentification requis) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://<reserved-ip>.nip.io/"   # expect 200
   ```

3. Ouvrez `http://<reserved-ip>.nip.io` dans un navigateur **immédiatement**. Gokapi n'a aucun
   identifiant administrateur pré-initialisé — à la première visite, il affiche son propre assistant de configuration
   initiale, et la première personne qui y accède revendique le compte administrateur. Comme
   la Gateway est publique par défaut, ne remettez pas cette étape à plus tard.

4. Vérifiez que les données arrivent bien sur le PVC après avoir utilisé l'interface pour
   téléverser un fichier :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- ls -la /data/config /data/data
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — StatefulSet, pod et PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Ne dépassez pas un pod.** `min_instance_count = 1` /
   `max_instance_count = 1` est une limite opérationnelle stricte, et non une valeur par défaut ajustable —
   la base de données SQLite de Gokapi n'accepte qu'un seul rédacteur, sans clustering ni
   réplication ; augmenter `max_instance_count` risque donc de corrompre la base de données et
   de rendre les téléversements incohérents. Il n'y a rien à configurer ici ; laissez les deux à 1.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update**. Le Dockerfile de Gokapi associe la valeur par défaut
   `latest` de la plateforme à un tag fixé et éprouvé (`v1.9.6`) via un argument de build
   propre à l'application ; laisser la version sur `latest` est donc sûr et
   reproductible ; fixez-la explicitement si vous avez besoin d'une autre version. Une nouvelle image
   est construite et l'unique pod du StatefulSet est remplacé.

4. **Gérez la clé d'API opérateur facultative et le stockage adossé au PVC :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~api-key"
   kubectl get pvc -n "$NS"
   ```

   La clé d'API (présente uniquement si `enable_api_key = true` a été défini lors du déploiement)
   n'est qu'une commodité — les véritables clés d'API de téléversement/téléchargement de Gokapi sont normalement
   générées depuis l'interface d'administration après la configuration. Elle est injectée sous forme de Secret
   Kubernetes natif et exposée via la sortie de module `gokapi_api_key_secret_id`.

5. **Inspectez directement le contenu du PVC** pour obtenir un instantané de l'état persisté
   (il n'y a pas de session de base de données à ouvrir — Gokapi n'a pas d'instance Cloud SQL) :

   ```bash
   kubectl exec -n "$NS" statefulset/<service-name> -- ls -la /data/config /data/data
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et
   de la mémoire des pods (Gokapi est un binaire Go léger ; attendez-vous donc à une consommation faible
   en régime établi), le nombre de redémarrages et l'utilisation du disque du PVC. Le module peut
   provisionner un **test de disponibilité** (désactivé par défaut) ; consultez Monitoring →
   Uptime checks et Alerting → Policies s'il est activé.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Gokapi.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes
  de démarrage et de vivacité ciblent toutes deux `/` (non authentifié, sans dépendance à une
  base de données externe) ; un échec ici pointe donc généralement vers le montage du PVC ou
  la planification plutôt que vers l'application elle-même.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC bloqué en `Pending` / `Quota 'SSD_TOTAL_GB' exceeded` :** la valeur par défaut
  `stateful_pvc_storage_class = "standard-rwo"` repose sur du SSD et consomme le quota SSD
  régional (souvent serré). Le profil d'E/S de Gokapi ne nécessite pas d'IOPS de niveau SSD
  — remplacez-la par du HDD avec `-var stateful_pvc_storage_class=standard` si
  le quota est limité.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>
  ```
- **Pas d'IP externe / Gateway injoignable :** vérifiez que `enable_custom_domain` et
  `reserve_static_ip` valent tous deux `true`, et qu'une IP statique a bien été
  réservée :
  ```bash
  kubectl get gateway,httproute -n "$NS"
  gcloud compute addresses list --project="$PROJECT"
  ```
- **Quelqu'un d'autre a revendiqué le compte administrateur en premier :** comme
  l'assistant de configuration initiale est public et non authentifié par défaut, il n'existe aucune
  récupération intégrée — prévoyez de le revendiquer immédiatement dès que la charge de travail devient
  joignable.
- **Secret de la clé d'API facultative introuvable :** vérifiez que `enable_api_key` était défini sur
  `true` lors du déploiement — sa valeur par défaut est `false` et aucun secret n'est créé
  dans le cas contraire.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment pourquoi `max_instance_count` et
`stateful_pvc_mount_path` doivent conserver leurs valeurs par défaut).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cette opération supprime tout ce que le module a créé — le StatefulSet
Kubernetes, l'espace de noms, le PVC (et avec lui la base de données SQLite et chaque
fichier téléversé — il n'existe par défaut aucune sauvegarde séparée de ces données), le
secret facultatif de la clé d'API et les images Artifact Registry. Les ressources détenues par
**Services_GCP** (le VPC, le cluster GKE, Artifact Registry) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie un StatefulSet à pod unique avec un PVC de 20Gi, une Gateway publique avec une IP statique réservée, et construit l'image Gokapi fixée |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le test de santé réussit ; revendiquer immédiatement le compte administrateur de configuration initiale (public par défaut) |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, conserver la mise à l'échelle à 1, mettre à jour la version, gérer la clé d'API facultative/le PVC |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC/quota SSD, de Gateway, de course à la revendication de l'administrateur et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris la base SQLite et les téléversements |
