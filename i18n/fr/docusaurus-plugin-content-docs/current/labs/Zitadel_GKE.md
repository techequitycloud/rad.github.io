---
title: "Zitadel sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Zitadel sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Zitadel_GKE.md @ 3055034 sha256:e347feb976a7 -->

# Zitadel sur GKE Autopilot — Guide de lab {#zitadel-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Zitadel_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Zitadel est une plateforme open source et cloud-native de gestion des identités et des accès (IAM)
qui fournit OpenID Connect, OAuth 2.0, SAML ainsi que la gestion des utilisateurs et des organisations. Ce lab
vous fait parcourir le cycle de vie opérationnel complet du module **Zitadel on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
la configuration IAM propre à Zitadel (organisations, projets, applications OIDC/SAML). Pour
la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Zitadel_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d'exécution et vous connecter avec le
  compte administrateur initialisé.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
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

1. Dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Zitadel (GKE)** dans la liste
   **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Zitadel_GKE) documente
   chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux
   en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une base de données
   Cloud SQL for PostgreSQL 15 avec ses secrets Secret Manager (`ZITADEL_MASTERKEY`
   et le mot de passe administrateur initial, ainsi que le mot de passe de la base de données), un bucket Cloud Storage,
   construit l'image de conteneur et exécute un job ponctuel d'initialisation de la base de données
   (`db-init`) qui crée la base de données et le rôle de l'application via un sidecar Cloud SQL Auth Proxy
   — Zitadel crée ensuite son propre schéma au premier démarrage via
   `zitadel start-from-init`. Les premiers déploiements prennent environ **20 à 35 minutes** (la création
   de Cloud SQL représente l'essentiel du temps), et le premier démarrage lui-même peut prendre **7 à 8 minutes**
   supplémentaires pour la mise en place du schéma et les migrations avant que la sonde de santé ne réussisse.

3. Connectez-vous au cluster et découvrez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep zitadel | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe (une IP statique est
   réservée par défaut afin que l'adresse survive aux redéploiements) :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est sain. Zitadel expose un point de terminaison de santé non authentifié :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/debug/healthz"   # expect 200
   ```

3. Récupérez le mot de passe administrateur initial depuis Secret Manager :

   ```bash
   gcloud secrets versions access latest \
     --secret="secret-<resource_prefix>-zitadel-admin-password" --project="$PROJECT"
   ```

   (Trouvez le nom exact du secret avec `gcloud secrets list --project="$PROJECT"
   --filter="name~zitadel"` si vous ne connaissez pas déjà le préfixe des ressources.)

4. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur et connectez-vous à la Console avec le nom d'utilisateur
   `zitadel-admin` et le mot de passe obtenu à l'étape précédente. Zitadel initialise ce compte
   avec `PASSWORDCHANGEREQUIRED = false`, vous pouvez donc vous connecter immédiatement. Une fois connecté,
   créez un véritable administrateur, puis désactivez ou restreignez le compte `zitadel-admin` initialisé
   et configurez vos organisations, projets et applications OIDC/SAML.

5. **Cette étape est obligatoire sur GKE, et non facultative.** Sur GKE, le point d'entrée dérive
   `ZITADEL_EXTERNALDOMAIN` de l'URL du service interne au cluster, et non de l'adresse externe —
   l'accès externe exige donc **toujours** de le définir explicitement. Modifiez le déploiement en cours d'exécution
   pour pointer vers l'hôte de l'IP du LoadBalancer (ou votre domaine personnalisé) :

   ```bash
   kubectl set env deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -n "$NS" ZITADEL_EXTERNALDOMAIN="${EXTERNAL_IP}.nip.io"
   ```

   Sans cela, l'émetteur OIDC et les URI de redirection de la Console pointent vers le mauvais hôte, et
   les connexions et l'échange de jetons échouent.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et le budget d'interruption :

   ```bash
   kubectl get deploy,pods,pdb -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification de la charge de travail, la mise à l'échelle est donc un
   changement de configuration, et non un `kubectl scale` manuel (une modification manuelle serait annulée lors
   de la prochaine application). GKE conserve au minimum 1 réplica (pas de mise à l'échelle à zéro) ; vous pouvez
   augmenter `max_instance_count` sans risque, car tout l'état réside dans PostgreSQL. L'affinité de session
   (`ClientIP`) est définie par défaut afin que les sessions de l'interface de la Console restent attachées à un seul pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive remplace les
   pods. Zitadel applique ses propres migrations de schéma de manière idempotente au démarrage — il n'y a pas
   d'étape de migration distincte à exécuter.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~zitadel"
   kubectl get jobs -n "$NS"          # db-init job
   ```

   Ne changez pas `ZITADEL_MASTERKEY` après le premier démarrage — elle chiffre toutes les données au repos, et
   la changer rend les données chiffrées auparavant (secrets clients, éléments de clé)
   définitivement illisibles. Les secrets sont transmis au pod par le pilote Secret Store CSI.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. zitadeldemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^zitadel" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer). Les lignes de journal `[cloud-entrypoint]`
   indiquent le mode SSL de la base de données et le domaine externe résolus — utile pour diagnostiquer les échecs
   de connexion :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -c zitadel --tail=50
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -c zitadel | grep cloud-entrypoint
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire
   des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner un
   **test de disponibilité** (uptime check, lorsqu'il est activé) ; consultez Monitoring → Uptime checks et Alerting →
   Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous risquez le plus de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas au fil des versions de Zitadel.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. Les sondes de démarrage et
  de vivacité ciblent `/debug/healthz` et laissent environ **7 à 8 minutes** au premier
  démarrage pour la mise en place du schéma et les migrations.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> -c zitadel --previous       # logs from the crashed container
  ```
- **La connexion / l'échange de jetons échoue après le déploiement :** l'émetteur OIDC et les redirections de la Console
  sont construits à partir de `ZITADEL_EXTERNALDOMAIN`. Sur GKE, il doit **toujours** être défini sur l'hôte de
  l'IP externe du LoadBalancer ou sur un domaine personnalisé — la valeur par défaut du point d'entrée dérive de
  l'URL interne au cluster, inaccessible depuis un navigateur. Corrigez-la avec
  `kubectl set env` (voir la tâche 2) et confirmez avec `grep cloud-entrypoint` dans les journaux.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le secret
  du mot de passe de la base a bien été matérialisé dans l'espace de noms et que le job d'initialisation s'est terminé.
- **Échec du job d'initialisation :** examinez le job et les journaux de son pod. Notez que ce job ne fait que
  créer la base de données et le rôle — il ne crée pas le schéma propre à Zitadel (cela se fait
  dans le conteneur au démarrage) :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pod en attente (Pending) / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources ou
  de quotas, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration pour
les pièges propres à chaque paramètre (y compris la règle essentielle de ne jamais changer
`ZITADEL_MASTERKEY` après le premier démarrage, et l'exigence obligatoire de PostgreSQL).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, le bucket de stockage, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit ; connexion avec le compte `zitadel-admin` initialisé ; définition de `ZITADEL_EXTERNALDOMAIN` pour l'accès externe |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets et le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging (y compris les lignes `[cloud-entrypoint]`) ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de domaine externe, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
