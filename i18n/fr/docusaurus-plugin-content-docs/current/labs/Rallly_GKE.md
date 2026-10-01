---
title: "Rallly sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Rallly sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Rallly_GKE.md @ 3055034 sha256:963978f84e23 -->

# Rallly sur GKE Autopilot — Guide de lab {#rallly-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Rallly_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Rallly est une application open source et auto-hébergée de planification de réunions et de sondages de groupe —
une alternative respectueuse de la vie privée à Doodle — construite avec Next.js et Prisma. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Rallly on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités de Rallly. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Rallly_GKE) — ce lab
ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les paramètres SMTP.
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
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Rallly (GKE)** dans
   la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Rallly_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Contrairement à la variante Cloud Run,
   `smtp_host` est vide par défaut ici — renseignez dès maintenant `smtp_host`, `smtp_user` et
   `smtp_password` si vous voulez que la connexion par e-mail fonctionne dès le premier démarrage. Cliquez sur
   **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la
   page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (`SECRET_PASSWORD`, `NEXTAUTH_SECRET`, un `SMTP_PWD` facultatif et le mot de passe
   de la base), construit l'image de conteneur et exécute un job ponctuel
   d'initialisation de la base qui crée la base de données vide et le rôle. Les premiers
   déploiements prennent environ **15 à 25 minutes** (la création de Cloud SQL représente l'essentiel du temps).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep rallly | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
   kubectl get all -n "$NAMESPACE"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le pod est entièrement prêt. Le point de terminaison d'état de Rallly (qui est aussi le
   chemin configuré pour les sondes de démarrage et de vivacité sur GKE) renvoie 200 une fois que l'application a
   terminé la migration Prisma du premier démarrage et confirmé sa connexion à la base de données :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/api/status"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. La connexion à Rallly est **sans mot de passe et
   basée sur l'e-mail** — il n'existe aucun compte administrateur pré-créé. Saisissez votre e-mail sur la
   page de connexion ; Rallly envoie un lien/code de vérification par e-mail via le relais SMTP
   configuré. Si rien n'arrive, vérifiez que SMTP est réellement configuré (tâche 3, étape 4)
   avant de conclure que le déploiement est défaillant.

4. Une fois que vous connaissez l'IP externe (ou un domaine personnalisé), définissez `base_url` sur celle-ci et
   appliquez la modification via **Update** afin que les liens d'invitation et de connexion pointent vers l'adresse que les utilisateurs
   visitent réellement.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NAMESPACE"
   kubectl describe deploy -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification de la charge de travail, donc la mise à l'échelle est une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application). Rallly conserve tout son état dans PostgreSQL (type de charge de travail
   `Deployment`, sans PVC) ; les pods se mettent donc à l'échelle horizontalement sans système de fichiers partagé.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive
   remplace les pods. Le script `./docker-start.sh` de Rallly exécute `prisma migrate deploy`
   à chaque démarrage, de sorte que les migrations de schéma s'appliquent automatiquement — aucune étape de
   migration distincte n'est nécessaire.

4. **Gérez les secrets, SMTP et les jobs :**

   ```bash
   kubectl get secrets -n "$NAMESPACE"
   gcloud secrets list --project="$PROJECT" --filter="name~rallly"
   kubectl exec -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep -E 'SMTP_|NEXT_PUBLIC_BASE_URL'
   kubectl get jobs -n "$NAMESPACE"          # db-init and any scheduled jobs
   ```

   Ne renouvelez jamais `SECRET_PASSWORD` ni `NEXTAUTH_SECRET` en dehors d'une fenêtre de maintenance
   planifiée — voir la tâche 5.

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. ralllydemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^rallly" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner
   un **test de disponibilité** (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Rallly.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. Les sondes de démarrage
  et de vivacité ciblent toutes deux `/api/status` ; la sonde de démarrage accorde une fenêtre de 30 périodes
  et 10 échecs (environ 5 minutes) pour couvrir la migration Prisma du premier démarrage
  avant que la sonde de vivacité (délai initial de 60 s) ne commence ses vérifications.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous       # logs from the crashed container
  ```
- **Les utilisateurs ne peuvent pas se connecter :** la connexion à Rallly est sans mot de passe et basée sur l'e-mail. Vérifiez
  que `smtp_host` / `smtp_user` / `smtp_password` sont définis — contrairement à la variante Cloud Run,
  `smtp_host` est vide par défaut ici, donc l'e-mail est désactivé tant qu'il n'est pas explicitement configuré.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base a bien été matérialisé dans l'espace de noms et que le job d'initialisation s'est terminé.
- **Échec du job d'initialisation :** examinez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Les liens d'invitation/de connexion pointent vers le mauvais hôte :** définissez `base_url` sur l'IP
  externe du LoadBalancer ou sur un domaine personnalisé — sinon `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL`
  ne sont pas définis.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes
  de ressources ou de quota, et vérifiez que le Service LoadBalancer s'est vu attribuer une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment la règle essentielle : ne jamais renouveler `SECRET_PASSWORD` ni
`NEXTAUTH_SECRET` après le premier démarrage, et la règle d'immuabilité de `db_name`/`db_user`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, la base de données Cloud SQL, les secrets Secret Manager et les images
d'Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15) et les secrets, puis exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le point de terminaison d'état renvoie 200 ; connexion via le lien de vérification envoyé par e-mail |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/SMTP, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de SMTP, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
