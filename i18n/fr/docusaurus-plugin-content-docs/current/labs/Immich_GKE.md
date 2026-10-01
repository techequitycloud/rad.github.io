---
title: "Immich sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Immich sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Immich_GKE.md @ 3055034 sha256:06eaec48ea3d -->

# Immich sur GKE Autopilot — Guide de lab {#immich-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Immich_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60–90 minutes

Immich est une plateforme open source et auto-hébergée de gestion de photos et de vidéos — une
alternative à Google Photos avec sauvegarde automatique depuis le mobile, recherche intelligente et
reconnaissance faciale. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du
module **Immich on GKE Autopilot** : le déployer, créer le compte administrateur, téléverser une
photo, prouver que la recherche intelligente sollicite réellement le service d'apprentissage automatique,
prouver que la photothèque adossée à NFS survit à la perte d'un pod, puis le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Immich. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Immich_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Attendre que la charge de travail soit en bonne santé et la vérifier de bout en bout.
- Effectuer le premier lancement interactif d'Immich (compte administrateur) et téléverser des médias.
- Vérifier que la recherche intelligente atteint réellement le service d'apprentissage automatique.
- Démontrer que la photothèque survit à la suppression d'un pod (persistance NFS et
  stratégie de déploiement Recreate).
- Démanteler proprement le déploiement.

## Tâche 1 — Prérequis et authentification {#task-1--prerequisites--authentication}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, la **VM du serveur NFS** — qui héberge à la fois la photothèque et Redis, deux éléments sans lesquels Immich ne peut pas fonctionner — et Artifact Registry). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche 1). Vérifiez que la VM NFS est `RUNNING` avant de déployer :
  ```bash
  gcloud compute instances list --project="$PROJECT" --filter="name~nfs" \
    --format="table(name,zone,status)"
  ```
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; authentifiez-vous :
  ```bash
  gcloud auth login
  gcloud auth application-default login
  gcloud config set project "$PROJECT"
  ```
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 2 — Déployer le module et attendre qu'il soit en bonne santé [Automatisé] {#task-2--deploy-the-module-and-wait-for-healthy-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Immich (GKE)** depuis
   la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Immich_GKE)
   documente chaque paramètre par groupe. Notez que `enable_nfs`, `enable_redis` et
   `max_instance_count = 1` sont imposés par des validations au moment du plan — ne
   cherchez pas à les contourner. Cliquez sur **Deploy Module**, vérifiez le coût estimé en crédits dans la boîte de dialogue
   **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**) ; la page d'état du déploiement diffuse
   les journaux en temps réel.

2. La plateforme construit l'image serveur personnalisée minimale (basée sur
   `ghcr.io/immich-app/immich-server` — `latest` se résout vers le tag évolutif
   `release` d'Immich), provisionne Cloud SQL (PostgreSQL 15), exécute le job ponctuel
   `db-init` (base de données, utilisateur, extensions `pgvector` + `earthdistance`), monte
   la photothèque NFS sur `/usr/src/app/upload` et déploie deux charges de travail : le
   serveur Immich (port 2283) et le service d'apprentissage automatique (port 3003,
   interne uniquement). Les premiers déploiements prennent environ **20–35 minutes** (la création de Cloud SQL
   en représente l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep immich | head -1 | cut -d/ -f2)
   echo "Namespace: $NS"
   kubectl get pods -A | grep immich
   ```

4. Attendez que les deux Deployments (serveur et ML) soient déployés :

   ```bash
   for D in $(kubectl get deploy -n "$NS" -o name); do
     kubectl rollout status -n "$NS" "$D" --timeout=600s
   done
   kubectl get pods,svc -n "$NS"
   ```

5. Vérifiez la santé au niveau de l'application. Le point de terminaison `/api/server/ping` d'Immich est
   accessible sans authentification et renvoie `{"res":"pong"}` :

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}:2283/api/server/ping"            # expect {"res":"pong"}
   curl -s "http://${EXTERNAL_IP}:2283/api/server/ping" | wc -c    # must be non-zero
   ```

   Vérifiez le **corps de la réponse**, et pas seulement le code d'état — un `200` avec un corps
   vide (content-length 0) est un véritable mode de défaillance, c'est pourquoi le décompte `wc -c`
   doit être non nul. Si le port n'est pas directement joignable, vérifiez le port exposé par le Service avec
   `kubectl get svc -n "$NS"` et utilisez-le à la place. Les premières lignes du journal du pod
   serveur affichent la configuration base de données/Redis/médias résolue, imprimée par le point d'entrée
   cloud — la vérification de cohérence la plus rapide :

   ```bash
   kubectl logs -n "$NS" "$(kubectl get pods -n "$NS" -o name | grep -v ml | head -1)" | head -15
   ```

---

## Tâche 3 — Créer le compte administrateur [Manuel] {#task-3--create-the-admin-account-manual}

1. Ouvrez `http://${EXTERNAL_IP}` (ou le port du Service de la tâche 2) dans un navigateur. Lors de la
   première visite, Immich affiche l'écran d'inscription **Getting Started** — il n'existe aucun
   identifiant prédéfini nulle part ; le premier compte enregistré devient administrateur.

2. Saisissez l'e-mail, le mot de passe et le nom de l'administrateur, puis terminez l'inscription. Vous arrivez
   dans l'interface web d'Immich.

3. (Facultatif) Installez l'application mobile Immich (iOS/Android) et faites-la pointer vers la même
   URL de serveur — la sauvegarde automatique mobile utilise exactement l'API que vous venez de vérifier.

---

## Tâche 4 — Téléverser une photo [Manuel] {#task-4--upload-a-photo-manual}

1. Dans l'interface web, cliquez sur **Upload** (en haut à droite) et sélectionnez une photo sur votre
   machine. N'importe quel JPEG convient ; une photo comportant des objets reconnaissables (un chien, une voiture, une
   plage) rend la tâche 5 plus parlante.

2. Vérifiez que l'élément apparaît dans la chronologie, puis vérifiez qu'il a physiquement atterri sur
   la photothèque adossée à NFS :

   ```bash
   SERVER_POD=$(kubectl get pods -n "$NS" -o name | grep -v ml | head -1 | cut -d/ -f2)
   kubectl exec -n "$NS" "$SERVER_POD" -- df -h /usr/src/app/upload   # NFS mount, not overlay
   kubectl exec -n "$NS" "$SERVER_POD" -- find /usr/src/app/upload -type f | head
   ```

   Le chemin de téléversement est `IMMICH_MEDIA_LOCATION` — le module vérifie qu'il s'agit
   d'un montage NFS précisément pour que les fichiers que vous venez de lister survivent à toute perte de pod
   (démontré à la tâche 6).

---

## Tâche 5 — Vérifier que la recherche intelligente atteint le service ML [Manuel] {#task-5--verify-smart-search-hits-the-ml-service-manual}

La recherche intelligente et la reconnaissance faciale s'exécutent dans un **conteneur d'apprentissage automatique distinct**
(inférence sur CPU), que le serveur atteint via la variable injectée
`IMMICH_MACHINE_LEARNING_URL`. Prouvez le raccordement de bout en bout :

1. Vérifiez la variable d'environnement, prouvez que le serveur peut réellement atteindre le service ML
   grâce à elle, et trouvez le pod ML :

   ```bash
   kubectl exec -n "$NS" "$SERVER_POD" -- env | grep IMMICH_MACHINE_LEARNING_URL
   # Server → ML connectivity via the injected URL (the real Service DNS name):
   kubectl exec -n "$NS" "$SERVER_POD" -- sh -c 'curl -s "$IMMICH_MACHINE_LEARNING_URL/ping"'
   kubectl exec -n "$NS" "$SERVER_POD" -- sh -c 'curl -s "$IMMICH_MACHINE_LEARNING_URL/ping" | wc -c'  # must be non-zero
   ML_POD=$(kubectl get pods -n "$NS" -o name | grep ml | head -1 | cut -d/ -f2)
   echo "ML pod: $ML_POD"
   ```

   L'appel `/ping` doit renvoyer un **corps non vide** — un `200` avec une réponse
   vide est un échec. Si le curl reste bloqué ou est refusé, le pod ML écoute probablement
   sur le mauvais port (`IMMICH_PORT` doit valoir `3003` sur le service ML)
   ou l'URL n'est pas le véritable nom DNS du Service (`http://<service>-ml:3003`).

2. Suivez les journaux du pod ML dans un terminal :

   ```bash
   kubectl logs -n "$NS" "$ML_POD" -f
   ```

3. Dans l'interface web, utilisez la barre de recherche pour lancer une **recherche intelligente** sur un terme correspondant
   à votre photo (par exemple « dog » ou « beach »). Attendez-vous à deux choses :

   - Le journal ML montre de l'activité — à la toute première requête, il **télécharge le modèle
     CLIP** avant de répondre ; la première recherche prend donc nettement plus de temps
     (les recherches suivantes sont rapides). Les fichiers du modèle sont mis en cache sur le disque éphémère
     du pod ML et sont retéléchargés après une replanification ; c'est attendu.
   - La recherche renvoie votre photo (les tâches d'embedding s'exécutent peu après le téléversement ; si
     le résultat est vide, attendez une minute et consultez Administration → Jobs
     dans l'interface pour la file Smart Search).

4. Si la recherche ne renvoie rien et que le journal ML ne bouge jamais, vérifiez si le pod ML subit une
   pression mémoire — le chargement du modèle échoue par manque de mémoire (OOM) en dessous des 4Gi par défaut, et l'application principale continue
   de paraître en bonne santé tandis que la recherche intelligente échoue silencieusement :

   ```bash
   kubectl describe pod -n "$NS" "$ML_POD" | grep -A3 "Last State"   # look for OOMKilled
   ```

---

## Tâche 6 — Prouver que la photothèque survit à la suppression d'un pod [Manuel] {#task-6--prove-the-library-survives-a-pod-delete-manual}

La photothèque réside sur NFS, et les applications adossées à NFS sont déployées avec la stratégie `Recreate`
(l'ancien pod s'arrête complètement avant qu'un nouveau ne démarre — jamais deux écrivains sur la
même photothèque). Simulez la perte d'un pod et vérifiez que rien n'est perdu :

1. Supprimez le pod serveur et observez l'arrivée de son remplaçant :

   ```bash
   kubectl delete pod -n "$NS" "$SERVER_POD"
   kubectl rollout status -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o name | grep -v ml | head -1 | cut -d/ -f2)" --timeout=600s
   kubectl get pods -n "$NS"
   ```

   Attendez-vous à une courte fenêtre sans **aucun** pod serveur (Recreate, réplica unique) —
   c'est voulu, et non un défaut.

2. Vérifiez que le point de terminaison de santé répond de nouveau et que la photo est toujours là :

   ```bash
   curl -s "http://${EXTERNAL_IP}:2283/api/server/ping"
   NEW_POD=$(kubectl get pods -n "$NS" -o name | grep -v ml | head -1 | cut -d/ -f2)
   kubectl exec -n "$NS" "$NEW_POD" -- find /usr/src/app/upload -type f | head
   ```

3. Rechargez l'interface web : la chronologie affiche toujours votre photo, servie par un
   pod tout neuf depuis la même photothèque NFS. C'est exactement la défaillance contre laquelle protège la
   validation `enable_nfs = true` — sur un disque éphémère, l'étape 2
   aurait renvoyé une photothèque vide.

---

## Tâche 7 — Démanteler [Automatisé] {#task-7--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne
peut plus le gérer, utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud. Delete supprime tout ce que le
module a créé — les charges de travail Kubernetes et l'espace de noms (serveur et ML), la base de données
et l'utilisateur Cloud SQL, ainsi que les images Artifact Registry construites. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, l'instance Cloud SQL partagée, le serveur NFS
et ses données, le registre) sont gérées séparément et ne sont pas supprimées ici — notez
que le répertoire de la photothèque réside sur le volume NFS partagé.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Prérequis | Manuel | Authentification effectuée ; présence de Services_GCP et de la VM NFS confirmée, à l'état RUNNING |
| 2 — Déployer et attendre la bonne santé | Automatisé | Charges de travail serveur + ML déployées ; `/api/server/ping` renvoie `pong` |
| 3 — Compte administrateur | Manuel | Inscription du premier lancement effectuée dans l'interface web |
| 4 — Téléversement | Manuel | Photo téléversée et confirmée sur la photothèque adossée à NFS |
| 5 — Recherche intelligente | Manuel | Recherche vérifiée de bout en bout auprès du pod d'apprentissage automatique (journaux + `IMMICH_MACHINE_LEARNING_URL`) |
| 6 — Persistance | Manuel | Pod supprimé ; déploiement Recreate observé ; la photo a survécu sur NFS |
| 7 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
