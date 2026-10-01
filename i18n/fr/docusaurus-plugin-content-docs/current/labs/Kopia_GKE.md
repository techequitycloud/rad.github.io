---
title: "Kopia sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Kopia sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Kopia_GKE.md @ 3055034 sha256:2741fa658f9c -->

# Kopia sur GKE Autopilot — Guide de lab {#kopia-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Kopia_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–75 minutes

Kopia est un outil de sauvegarde rapide, sécurisé et open source, avec chiffrement côté client,
compression et déduplication. Ce module exécute Kopia en **mode serveur de
dépôt** (repository-server) : un serveur unique, toujours joignable, auquel des clients CLI `kopia` distants
se connectent depuis d'autres machines pour y envoyer et en récupérer des instantanés, adossé nativement à un bucket Cloud
Storage. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du
module **Kopia on GKE Autopilot** : le déployer, connecter un client distant et réaliser un
véritable aller-retour d'instantané, l'exploiter au quotidien (y compris l'ajout de clients
nommés supplémentaires), l'observer, diagnostiquer les problèmes courants et le démanteler.

**Il n'existe pas de variante Cloud Run de ce module et il n'en existera jamais.** Le
protocole d'instantanés client-serveur de Kopia repose exclusivement sur gRPC, qui n'obtient un véritable
HTTP/2 qu'au travers du TLS+ALPN propre à Kopia — la périphérie de Cloud Run termine toujours elle-même le
HTTPS public et ne peut pas laisser passer un flux TLS terminé par le conteneur. Le simple
LoadBalancer L4 de GKE n'a pas cette restriction, c'est pourquoi ce module est réservé à GKE.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur la CLI propre à Kopia au-delà de ce qui est nécessaire pour prouver que le déploiement fonctionne. Pour la
liste complète des services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Kopia_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Récupérer les deux secrets générés et l'empreinte du certificat TLS, puis connecter un
  véritable client CLI `kopia` distant au travers d'un aller-retour complet de création/liste d'instantanés.
- Effectuer les opérations du jour 2 — ajouter des clients nommés supplémentaires, inspecter la charge de travail
  et exécuter la maintenance du dépôt.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et de connexion les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- **La CLI `kopia` installée localement** (ou sur la machine qui jouera le rôle de client
  de sauvegarde distant) — voir [kopia.io/docs/installation](https://kopia.io/docs/installation/).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Kopia (GKE)** depuis
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Les valeurs par défaut sont adaptées à la production — accessibilité externe via
   `LoadBalancer`, mise à l'échelle jusqu'à zéro, mise à l'échelle limitée à un seul serveur — la plupart des déploiements n'ont donc besoin
   d'aucune modification au-delà de `project_id`/`tenant_id`. Configurez tout autre élément dont vous
   avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Kopia_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme construit une image de conteneur personnalisée (l'image officielle `kopia/kopia`
   plus un point d'entrée cloud), génère deux secrets indépendants
   (`ADMIN_PASSWORD`, `REPO_PASSWORD`) dans Secret Manager, provisionne le bucket
   Cloud Storage `storage` et déploie la charge de travail dans le cluster GKE Autopilot.
   Il n'y a **aucune instance Cloud SQL** — le dépôt de Kopia réside nativement dans Cloud
   Storage. La durée du premier déploiement est généralement de **10–15 minutes**, dominée par le
   build de l'image.

3. Connectez-vous au cluster et repérez l'espace de noms avec un filtre indépendant des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep kopia | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification avec un vrai client [Manuel] {#task-2--access--verify-with-a-real-client-manual}

1. Vérifiez que le pod s'exécute et consultez ses journaux du premier démarrage pour y trouver l'empreinte
   TLS (affichée **une seule fois**, au moment de la génération du certificat) :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl get pods -n "$NS"
   kubectl logs -n "$NS" "$POD" | grep -B2 -A2 -i fingerprint
   ```

   Si le pod s'exécute depuis un moment et que l'empreinte est sortie du
   tampon des journaux, recalculez-la directement — GKE offre un véritable accès shell, contrairement à Cloud
   Run :

   ```bash
   kubectl exec -n "$NS" "$POD" -- \
     openssl x509 -in /var/lib/kopia/tls/cert.pem -noout -fingerprint -sha256
   ```

2. Trouvez l'IP externe et le port externe **réel**. `Kopia_GKE` n'expose pas
   le paramètre `service_port` de `App_GKE`, le Service écoute donc en externe sur
   la valeur par défaut d'`App_GKE` (`80`) et redirige vers le port réel de Kopia (`51515`) en
   simple transfert TCP — vérifiez toujours la correspondance plutôt que de supposer un port :

   ```bash
   kubectl get svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   SERVICE_PORT=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].spec.ports[0].port}')
   echo "External IP: $EXTERNAL_IP   Service port: $SERVICE_PORT"
   ```

3. Récupérez les deux secrets générés :

   ```bash
   PREFIX=$(kubectl get ns "$NS" -o jsonpath='{.metadata.labels.tenant}' 2>/dev/null || true)
   gcloud secrets list --project="$PROJECT" --filter="name~admin-password OR name~repo-password"

   ADMIN_PASSWORD=$(gcloud secrets versions access latest --project="$PROJECT" \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" --format='value(name)')")
   REPO_PASSWORD=$(gcloud secrets versions access latest --project="$PROJECT" \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~repo-password" --format='value(name)')")
   ```

4. Connectez un véritable client CLI `kopia`. **Le mot de passe à utiliser ici est `REPO_PASSWORD`, et non
   `ADMIN_PASSWORD`** — `kopia repository connect server` ne dispose d'aucun indicateur distinct
   pour le mot de passe d'un utilisateur du serveur ; son unique paramètre de mot de passe est l'identifiant de session
   gRPC, vérifié par rapport à l'utilisateur stocké dans le dépôt et provisionné par le
   point d'entrée (`admin@kopia`), qui a lui-même reçu `REPO_PASSWORD`. Utiliser
   `ADMIN_PASSWORD` ici échoue avec `PermissionDenied: access denied` — confirmé
   en conditions réelles.

   ```bash
   FINGERPRINT="<sha256-fingerprint-from-step-1>"

   kopia repository connect server \
     --url="https://${EXTERNAL_IP}:${SERVICE_PORT}" \
     --server-cert-fingerprint="$FINGERPRINT" \
     --password="$REPO_PASSWORD" \
     --override-username=admin --override-hostname=kopia
   ```

5. Réalisez un véritable aller-retour d'instantané pour prouver que la session gRPC fonctionne réellement de
   bout en bout (et pas seulement l'API REST du plan de contrôle) :

   ```bash
   mkdir -p /tmp/kopia-lab-test && echo "hello from the Kopia GKE lab" > /tmp/kopia-lab-test/hello.txt

   kopia snapshot create /tmp/kopia-lab-test
   kopia snapshot list
   ```

   Un `snapshot create`/`snapshot list` réussi confirme que le déploiement est pleinement
   fonctionnel — il s'agit du même aller-retour que celui vérifié en conditions réelles pendant
   le développement.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Ajoutez un client nommé supplémentaire.** Chaque source de sauvegarde doit se connecter sous sa
   propre identité plutôt que de partager `admin@kopia`. Depuis un shell du pod (ou toute machine
   disposant de la CLI `kopia` et d'un accès direct au dépôt), provisionnez un nouvel utilisateur du dépôt
   et accordez-lui l'accès :

   ```bash
   kubectl exec -it -n "$NS" "$POD" -- sh -c '
     kopia server users add "backup-host-1@kopia" --user-password="<a-strong-password-you-choose>"
   '
   ```

   Les ACL sont déjà activées (le point d'entrée exécute `kopia server acl enable` à chaque
   démarrage) — la stratégie par défaut de Kopia accorde à tout `user@host` authentifié un accès complet
   en lecture/écriture aux instantanés de son propre nom d'hôte, le nouvel utilisateur n'a donc besoin d'aucune
   autorisation distincte. Le nouveau client se connecte ensuite avec son propre identifiant :

   ```bash
   kopia repository connect server \
     --url="https://${EXTERNAL_IP}:${SERVICE_PORT}" \
     --server-cert-fingerprint="$FINGERPRINT" \
     --password="<the-password-you-set-for-backup-host-1>" \
     --override-username=backup-host-1 --override-hostname=kopia
   ```

   Listez à tout moment les utilisateurs provisionnés :

   ```bash
   kubectl exec -n "$NS" "$POD" -- kopia server users list
   ```

2. **Inspectez la charge de travail :**

   ```bash
   kubectl get deployment,pods,svc -n "$NS"
   kubectl describe deployment -n "$NS"
   ```

3. **Maintenance du dépôt.** Le nettoyage de la mémoire (garbage collection) et le compactage propres à Kopia supposent qu'un
   seul serveur possède le dépôt — exécutez-les depuis l'intérieur du pod (ou planifiez-les
   via `cron_jobs`) :

   ```bash
   kubectl exec -n "$NS" "$POD" -- kopia maintenance run
   kubectl exec -n "$NS" "$POD" -- kopia maintenance info
   ```

4. **Mettez à jour la version de l'application** en modifiant `application_version` dans la plateforme
   RAD et en l'appliquant via **Update**. Une nouvelle image est construite, le pod est
   recréé et la logique du point d'entrée (connexion ou création / utilisateur / ACL) s'exécute à nouveau
   — le certificat TLS persistant et le dépôt ne sont pas modifiés, les clients existants
   continuent donc de fonctionner sans changement d'empreinte.

5. **Ne dépassez pas une instance.** `max_instance_count` doit rester à `1` —
   la maintenance du dépôt propre à Kopia suppose qu'un seul serveur en est propriétaire ; un second
   serveur simultané entrerait en concurrence avec le nettoyage/compactage sur le même dépôt.
   La mise à l'échelle jusqu'à zéro (`min_instance_count = 0`) est sans risque et constitue la valeur par défaut du module — un
   démarrage à froid se reconnecte simplement au dépôt existant.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — le serveur Kopia journalise sur stdout, y compris l'empreinte TLS
   affichée une seule fois et la sortie du point d'entrée (connexion ou création / provisionnement des utilisateurs) :

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=100
   ```

   Filtre de l'explorateur de journaux (Logs Explorer) :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods (les envois d'instantanés sont limités par le CPU — compression, chiffrement,
   hachage) et le nombre de redémarrages. `uptime_check_config` est **désactivé par défaut** —
   si vous l'activez, sachez qu'il effectue une vérification HTTP sur un chemin, or chaque
   point de terminaison de Kopia exige une authentification, il échouera donc en permanence ; laissez-le
   désactivé ou dirigez plutôt une surveillance externe vers une vérification TCP brute.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Kopia.

- **Pod non Ready / CrashLoopBackOff :**
  ```bash
  kubectl describe pod -n "$NS" "$POD"    # Events: scheduling / probe / mount errors
  kubectl logs -n "$NS" "$POD" --previous # logs from the crashed container
  ```
  Les sondes de démarrage et de liveness sont de type **TCP**, et non HTTP — Kopia n'a aucun point de terminaison HTTP
  non authentifié, une sonde HTTP échouerait donc toujours, même sur un serveur en bonne santé. Si les sondes
  échouent, vérifiez que l'étape de connexion ou de création du dépôt s'est bien terminée
  (recherchez `Connected to existing repository` / `Creating a new
  repository` dans les journaux) plutôt que de supposer un problème de santé HTTP.
- **`PermissionDenied: access denied` sur `kopia snapshot create`/`list` :** vous vous êtes
  presque certainement connecté avec `--password=<ADMIN_PASSWORD>` au lieu de
  `<REPO_PASSWORD>`. Déconnectez-vous (`kopia repository disconnect`) et reconnectez-vous avec
  le mot de passe du dépôt — voir la tâche 2, étape 4.
- **Connexion du client refusée / expirée :** vérifiez que le port de l'URL correspond au
  port externe réel du Service (`kubectl get svc -n "$NS"`) — il vaut par défaut
  `80`, et non le port interne `51515` de Kopia, et ce module n'offre aucun moyen de le
  modifier. Un simple `https://<ip>` sans port implique le port 443, qui n'est pas ouvert.
- **Empreinte de certificat non concordante sur un client existant :** le certificat TLS
  ne devrait jamais changer d'un redémarrage à l'autre (il est persistant et réutilisé). Une non-concordance signifie
  soit que les fichiers du certificat persistant ont été supprimés hors du cadre normal (vérifiez le
  préfixe `tls/` du bucket `storage`), soit que vous ciblez un autre déploiement.
  Recalculez l'empreinte actuelle avec la commande `openssl x509` de la tâche 2,
  étape 1, et réépinglez chaque client concerné.
- **Échec de la connexion au dépôt au premier démarrage (« repository probably doesn't exist
  yet ») :** attendu et auto-correctif — le mécanisme de repli du point d'entrée le crée
  automatiquement. Vérifiez dans les journaux du pod que l'étape `create gcs` qui suit a bien
  réussi (IAM : vérifiez que le compte de service de la charge de travail dispose d'un accès en écriture au
  bucket `storage`).
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry
  (`enable_image_mirroring = true` y met en miroir `kopia/kopia` pour éviter les limites de débit
  de Docker Hub) et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la distinction entre `REPO_PASSWORD` et `ADMIN_PASSWORD`, les sondes TCP
et la valeur par défaut de `service_port`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec
l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le
déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes et
son espace de noms, le bucket Cloud Storage (**y compris tous les instantanés jamais écrits — ce
sont vos véritables données de sauvegarde**), les deux secrets Secret Manager et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre) sont
gérées séparément et ne sont pas supprimées ici.

> **Avant de démanteler un déploiement contenant de vraies données de sauvegarde**, exportez ou vérifiez
> que vous disposez d'une copie indépendante — supprimer le bucket `storage` supprime le
> dépôt définitivement, sans « suppression réversible » distincte pour le contenu des sauvegardes
> lui-même.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image, génère deux secrets, provisionne le bucket `storage` et déploie sur GKE |
| 2 — Accès et vérification | Manuel | Récupérer l'empreinte TLS et les secrets ; connecter un véritable client CLI `kopia` et réaliser un aller-retour de création/liste d'instantanés |
| 3 — Exploiter | Manuel | Ajouter des clients nommés supplémentaires, inspecter la charge de travail, exécuter la maintenance du dépôt, mettre à jour la version |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, d'authentification, de port de connexion et d'initialisation du dépôt |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le dépôt de sauvegarde lui-même |
