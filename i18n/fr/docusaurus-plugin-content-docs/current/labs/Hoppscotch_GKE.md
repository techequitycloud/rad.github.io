---
title: "Hoppscotch sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Hoppscotch sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Hoppscotch_GKE.md @ 3055034 sha256:ae0ff668ed09 -->

# Hoppscotch sur GKE Autopilot — Guide de lab {#hoppscotch-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Hoppscotch_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 20–40 minutes

Hoppscotch est une plateforme open source de développement d'API, dans l'esprit de Postman, permettant de concevoir,
d'envoyer et d'inspecter des requêtes HTTP, GraphQL et WebSocket depuis le navigateur. Ce
lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Hoppscotch on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les
fonctionnalités du produit Hoppscotch. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Hoppscotch_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle et mettre à jour le déploiement.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Hoppscotch (GKE)**
   depuis la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Hoppscotch_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme construit avec Cloud Build une image de conteneur personnalisée minimale (`FROM
   hoppscotch/hoppscotch-frontend`), la réplique dans Artifact
   Registry et la déploie comme Deployment sans état sur le cluster GKE Autopilot,
   derrière un Service LoadBalancer doté d'une adresse IP statique réservée. Hoppscotch est
   volontairement sans état — aucune instance Cloud SQL, aucun secret Secret Manager et aucun
   bucket Cloud Storage ne sont créés (`database_type = "NONE"` est imposé par un
   garde-fou au moment du plan). Sans base de données à provisionner, un premier déploiement
   se termine généralement bien plus vite que ce dont a besoin un module avec état.

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep hoppscotch | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service répond. Hoppscotch n'a aucun backend qui devrait être joignable —
   le chemin racine renvoie l'interface de l'application dès que Caddy se lie au port 3000 :

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Contrairement à la plupart des modules, Hoppscotch n'a
   **aucun compte administrateur à créer au premier lancement** — le frontend auto-hébergé ne dispose d'aucune connexion
   ni gestion des utilisateurs qui lui soit propre. Vous pouvez commencer à construire des requêtes immédiatement.
   Les collections, environnements et l'historique sont conservés dans le stockage local du navigateur sur
   la machine de chaque utilisateur, et non sur le serveur.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — Deployment, pods et autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification de la charge de travail, la mise à l'échelle est donc une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application). Comme Hoppscotch ne conserve ni file d'attente partagée ni
   base de données, la mise à l'échelle n'est pas contrainte — augmentez librement `max_instance_count` comme
   plafond de débit. Notez que GKE ne permet pas de descendre à zéro ; `min_instance_count`
   doit donc rester au moins à `1` (la valeur par défaut). `session_affinity` vaut `None` par défaut,
   car le bundle statique est identique sur chaque pod ; un routage persistant (sticky) est donc
   inutile.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive
   remplace les pods (sans risque ici — la SPA est sans état ; il n'existe donc aucun NFS partagé ni
   verrou de base de données susceptible de provoquer un interblocage). `HOPPSCOTCH_VERSION` (et non le générique
   `APP_VERSION`) épingle le tag amont `hoppscotch-frontend` ; ainsi,
   `application_version = "latest"` se résout au moment du build en un tag épinglé et éprouvé,
   plutôt qu'en la chaîne littérale `latest`.

4. **Vérifiez les secrets** — Hoppscotch n'en provisionne aucun par conception ; vérifiez que rien
   d'inattendu n'apparaît :

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~hoppscotch"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods ainsi que le nombre de redémarrages. Le module peut provisionner un **test de
   disponibilité** (uptime check) sur l'hôte du LoadBalancer (lorsqu'il est activé) ; consultez Monitoring → Uptime
   checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Hoppscotch.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de vivacité
  cible la racine `/`, qui renvoie HTTP 200 quelques secondes après que Caddy s'est lié au port
  3000 — une sonde en échec signifie presque toujours que le tag d'image est invalide, et non qu'un
  backend est injoignable (il n'y a pas de backend).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer. Les images personnalisées/répliquées utilisent `imagePullPolicy=Always` ;
  un tag reconstruit n'est donc jamais servi périmé depuis le cache d'un nœud.
  ```bash
  kubectl get deploy -n "$NS" -o jsonpath='{.items[0].spec.template.spec.containers[0].image}'
  ```
- **Pod en attente (Pending) / pas d'adresse IP externe :** consultez les événements de `kubectl describe pod` pour détecter
  des problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer a une adresse IP attribuée.
- **Le plan échoue avec une erreur `database_type` :** ce module impose
  `database_type = "NONE"` au moment du plan — Hoppscotch n'a aucun backend à connecter à une
  base de données. Conservez la valeur par défaut au lieu d'essayer de sélectionner un moteur.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment pourquoi `container_image_source` doit rester `custom` et pourquoi
`min_instance_count` ne peut pas valoir `0` sur GKE).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes,
l'espace de noms, le LoadBalancer et l'adresse IP statique réservée, ainsi que l'image Artifact Registry
(Hoppscotch ne provisionne ni base de données, ni secrets, ni buckets de stockage ; il n'y a donc rien
d'autre à nettoyer). Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre
partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image personnalisée et déploie la charge de travail GKE + le LoadBalancer — sans base de données, secrets ni bucket de stockage |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; la vérification d'état réussit ; ouvrir l'adresse IP externe et utiliser Hoppscotch immédiatement (aucun compte administrateur) |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (sans contrainte, min ≥ 1), mettre à jour la version, confirmer l'absence de secrets |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de récupération d'image, d'ordonnancement et du garde-fou `database_type` |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime la charge de travail, le LoadBalancer et l'image |
