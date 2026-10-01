---
title: "Plausible Analytics sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Plausible Analytics sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Plausible_GKE.md @ 3055034 sha256:d48311405a34 -->

# Plausible Analytics sur GKE Autopilot — Guide de lab {#plausible-analytics-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Plausible_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60–120 minutes

Plausible Analytics Community Edition est une plateforme open source d'analyse web, respectueuse de la vie privée
et sans cookies — la principale alternative auto-hébergée à Google Analytics.
Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Plausible on GKE
Autopilot** sur Google Cloud, y compris sa **dépendance obligatoire** : le
module **ClickHouse_GKE**, qui fournit le magasin d'événements dans lequel chaque page vue et chaque
événement personnalisé est écrit (Cloud SQL PostgreSQL ne contient que les comptes et la configuration
des sites). Vous allez déployer ClickHouse, raccorder ses sorties à Plausible, déployer
Plausible, le vérifier de bout en bout, l'exploiter, puis démanteler les deux dans le bon ordre.

Le lab porte sur l'exploitation des **modules GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Plausible. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Plausible_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer ClickHouse_GKE et vérifier qu'il est en bonne santé avant que quoi que ce soit n'en dépende.
- Récupérer les sorties de ClickHouse et les raccorder à la configuration de Plausible.
- Déployer le module Plausible_GKE et vérifier l'architecture à deux magasins de données.
- Enregistrer le premier compte, ajouter un site et récupérer l'extrait de suivi.
- Effectuer les opérations du jour 2 — fermer les inscriptions, inspecter les journaux et les secrets.
- Démanteler proprement les deux déploiements, dans le bon ordre.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépendent les deux modules). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI**, **kubectl** et **OpenTofu** installés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.

## Tâche 1 — Prérequis et authentification [Manuel] {#task-1--prerequisites--authentication-manual}

1. Authentifiez-vous et définissez les variables shell que chaque tâche ci-dessous réutilise :

   ```bash
   gcloud auth login
   gcloud auth application-default login

   export PROJECT="<your-gcp-project-id>"
   export REGION="us-central1"           # the region you deploy into
   gcloud config set project "$PROJECT"
   ```

2. Vérifiez que la plateforme partagée est en place — un VPC et un cluster GKE
   Autopilot gérés par Services_GCP doivent exister avant le déploiement de l'un ou l'autre module :

   ```bash
   gcloud compute networks list --project="$PROJECT"
   gcloud container clusters list --project="$PROJECT"
   ```

3. Récupérez les identifiants du cluster — les deux modules se déploient dans le même cluster :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"
   kubectl get nodes
   ```

---

## Tâche 2 — Déployer ClickHouse_GKE et attendre qu'il soit en bonne santé [Automatisé] {#task-2--deploy-clickhouse_gke-and-wait-for-it-to-be-healthy-automated}

Plausible **ne peut pas démarrer sans ClickHouse** — une validation au moment du plan dans
Plausible_GKE bloque l'application lorsque `clickhouse_url` est vide. Déployez d'abord ClickHouse
et ne poursuivez pas tant qu'il ne répond pas.

1. Déployez le module **ClickHouse (GKE)** — depuis la plateforme RAD (ouvrez **Solutions → Solution Catalog → RAD modules**,
   ouvrez **ClickHouse (GKE)**, choisissez **Configuration Form**, renseignez `project_id`, cliquez sur **Deploy Module**), ou directement :

   ```bash
   cd modules/ClickHouse_GKE
   tofu init
   tofu plan -var="project_id=$PROJECT" -out=plan.tfplan
   tofu apply plan.tfplan
   ```

   Conservez le `application_version` figé (`latest` correspond à la version éprouvée
   `24.12-alpine`) — Plausible fige la version de ClickHouse, car des versions non testées
   l'ont cassé en amont (plausible/analytics#3855).

2. **Attendez que la charge de travail ClickHouse soit entièrement déployée.** ClickHouse s'exécute en tant que
   StatefulSet avec un volume persistant ; le provisionnement du volume au premier démarrage peut prendre
   quelques minutes :

   ```bash
   kubectl get pods -A | grep clickhouse
   CH_NS=$(kubectl get ns -o name | grep clickhouse | head -1 | cut -d/ -f2)
   kubectl rollout status statefulset -n "$CH_NS" --timeout=600s
   ```

3. **Prouvez que ClickHouse répond** avec son point de terminaison `/ping` (attendez `Ok.`) :

   ```bash
   CH_SVC=$(kubectl get svc -n "$CH_NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl run ch-ping --rm -it --restart=Never --image=curlimages/curl -- \
     curl -s "http://${CH_SVC}.${CH_NS}.svc.cluster.local:8123/ping"
   ```

Ne commencez pas la tâche 3 avant que le déploiement soit terminé et que `/ping` réponde — déployer
Plausible contre un ClickHouse encore en cours de provisionnement gaspille un cycle de déploiement en
tentatives de migration qui bouclent en échec.

---

## Tâche 3 — Récupérer les sorties de ClickHouse et les raccorder à Plausible [Manuel] {#task-3--capture-clickhouse-outputs-and-wire-them-into-plausible-manual}

Plausible consomme quatre sorties de ClickHouse_GKE. Récupérez-les :

```bash
cd modules/ClickHouse_GKE
tofu output clickhouse_internal_endpoint     # -> clickhouse_url (same cluster, preferred)
tofu output clickhouse_endpoint              # -> clickhouse_url (external LB, if cross-cluster)
tofu output clickhouse_database              # -> clickhouse_db
tofu output clickhouse_username              # -> clickhouse_user
tofu output clickhouse_password_secret_id    # -> clickhouse_password_secret
```

Collez-les dans les tfvars de déploiement de Plausible (`modules/Plausible_GKE/config/deploy.tfvars`
ou les paramètres de votre plateforme) :

```hcl
project_id                 = "<your-gcp-project-id>"
tenant_id       = "demo"

# From the ClickHouse_GKE outputs above:
clickhouse_url             = "http://<clickhouse-svc>.<namespace>.svc.cluster.local:8123"
clickhouse_db              = "plausible_events_db"
clickhouse_user            = "plausible"
clickhouse_password_secret = "<clickhouse_password_secret_id output>"
```

Remarques sur le raccordement :

- Privilégiez `clickhouse_internal_endpoint` — les deux charges de travail s'exécutent dans le même cluster ;
  le DNS Kubernetes interne au cluster évite donc le passage par le LoadBalancer externe.
- `clickhouse_url` doit être un point de terminaison de base `http(s)://host[:port]` nu — sans
  identifiants ni chemin de base de données (une validation de format sur la variable l'impose).
- Le mot de passe n'apparaît jamais dans les tfvars : `clickhouse_password_secret` est un ID de secret
  Secret Manager **appartenant à ClickHouse_GKE**. La fondation accorde au compte de service
  de la charge de travail Plausible le rôle `secretAccessor` sur ce secret et l'injecte sous la forme
  `CLICKHOUSE_PASSWORD` ; le point d'entrée de Plausible l'intègre (encodé pour URL) dans
  `CLICKHOUSE_DATABASE_URL` à l'exécution.

---

## Tâche 4 — Déployer le module Plausible_GKE [Automatisé] {#task-4--deploy-the-plausible_gke-module-automated}

1. Déployez — depuis la plateforme RAD (ouvrez **Plausible (GKE)**, collez les quatre
   valeurs ClickHouse, cliquez sur **Deploy Module**), ou directement :

   ```bash
   cd modules/Plausible_GKE
   tofu init
   tofu plan -var-file=config/deploy.tfvars -out=plan.tfplan
   tofu apply plan.tfplan
   ```

   Si `clickhouse_url` est vide, le plan **échoue immédiatement** avec une erreur claire
   indiquant la correction — c'est la garde de validation qui fait son travail ; revenez à la tâche 3.

2. Le déploiement provisionne la charge de travail GKE, une base de données Cloud SQL PostgreSQL 15
   avec ses secrets Secret Manager (`SECRET_KEY_BASE`, `TOTP_VAULT_KEY` et le mot de passe
   de la base de données), construit l'image personnalisée minimale (`FROM
   ghcr.io/plausible/community-edition`, figée sur `v3.2.1` lorsque
   `application_version = "latest"`) et exécute le job ponctuel `db-init`. Les premiers
   déploiements prennent environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Repérez la charge de travail avec des filtres indépendants des noms :

   ```bash
   NS=$(kubectl get ns -o name | grep plausible | head -1 | cut -d/ -f2)
   echo "Namespace: $NS"
   kubectl get all -n "$NS"
   ```

4. Observez le point d'entrée composer les deux URL de base de données et exécuter les migrations :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=100
   # Look for: [plausible-entrypoint] DATABASE_URL host / CLICKHOUSE host / BASE_URL,
   # then "Running db createdb + db migrate..." before the server starts.
   ```

---

## Tâche 5 — Vérifier, enregistrer le premier compte, ajouter un site [Manuel] {#task-5--verify-register-the-first-account-add-a-site-manual}

1. Trouvez l'adresse externe et vérifiez l'état de santé. `/api/health` est non authentifié
   par conception (c'est aussi pourquoi il est sûr de l'utiliser comme chemin de sonde) :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"

   # Status code AND body — a 200 alone is not proof (a 200 with an empty body
   # means the wrong process answered the port):
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}:8000/api/health"   # expect: 200
   curl -s "http://${EXTERNAL_IP}:8000/api/health"    # or the service_url output
   # Expect a non-empty JSON body like:
   #   {"sessions":"ok","postgres":"ok","clickhouse":"ok",...}
   curl -s "http://${EXTERNAL_IP}:8000/api/health" | wc -c    # must be non-zero
   ```

2. Ouvrez `http://${EXTERNAL_IP}:8000/register` dans un navigateur et créez le **premier
   compte** — il n'existe aucun identifiant prédéfini, et les inscriptions sont ouvertes par défaut
   (vous les fermerez dans la tâche 6).

3. Ajoutez un site (votre domaine) dans l'interface. Plausible affiche l'**extrait de suivi** :

   ```html
   <script defer data-domain="yourdomain.com" src="http://<EXTERNAL_IP>:8000/js/script.js"></script>
   ```

   L'hôte du `src` de l'extrait provient de `BASE_URL` — si vous servez plus tard Plausible sur
   un domaine personnalisé, définissez `base_url` et redéployez afin que les extraits et les liens des e-mails l'utilisent.

4. Prouvez la séparation entre les deux magasins de données : envoyez une page vue de test (visitez une page portant
   l'extrait, ou utilisez le flux « verify installation » du site) et vérifiez qu'elle apparaît sur
   le tableau de bord. L'événement a été écrit dans **ClickHouse** ; seuls votre compte et la
   définition du site résident dans PostgreSQL :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=postgres --project="$PROJECT"
   # \c <database_name output>; \dt   -- users/sites tables, but NO events tables
   ```

---

## Tâche 6 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-6--operate--keep-it-running-day-2-manual}

1. **Fermez les inscriptions** maintenant que le premier compte existe. Ajoutez à
   `environment_variables` et réappliquez (ou cliquez sur **Update** dans la plateforme) :

   ```hcl
   environment_variables = {
     DISABLE_REGISTRATION = "true"     # or "invite_only"
   }
   ```

   Vérification : `curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}:8000/register"`
   ne devrait plus proposer d'inscription ouverte.

2. **Inspectez les secrets.** Deux secrets appartenant à Plausible ne doivent jamais faire l'objet d'une rotation —
   `SECRET_KEY_BASE` (sa rotation déconnecte tous les utilisateurs) et `TOTP_VAULT_KEY` (sa rotation
   casse tous les appareils 2FA enregistrés) :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~plausible"
   kubectl get secrets -n "$NS"
   # Confirm the cross-module grant: Plausible's SA can read the ClickHouse password
   gcloud secrets get-iam-policy "$(cd modules/ClickHouse_GKE && tofu output -raw clickhouse_password_secret_id)" \
     --project="$PROJECT"
   ```

3. **Journaux et surveillance :**

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NS"'"' \
     --project="$PROJECT" --limit=20
   ```

4. **Dépannage express :**
   - Pod qui boucle en échec avec `[plausible-entrypoint] ERROR: PLATFORM_CLICKHOUSE_URL is
     empty` — le raccordement à ClickHouse n'a pas atteint le pod ; revérifiez les valeurs de la tâche 3.
   - Pod non Ready alors que les journaux de l'application montrent qu'elle a démarré — vérifiez que le chemin de sonde est toujours
     `/api/health` (un chemin authentifié renvoie 403 et la sonde ne réussit jamais).
   - Connexion à ClickHouse refusée — vérifiez que le StatefulSet ClickHouse est toujours
     déployé (`kubectl get pods -A | grep clickhouse`) et que `/ping` répond.
   - Mise à niveau de version — définissez `application_version` sur un tag CE explicite (CE ne publie
     aucun tag `latest` ; la valeur par défaut fige `v3.2.1`), réappliquez, et les migrations s'exécutent au
     prochain démarrage du conteneur.

---

## Tâche 7 — Démanteler (Plausible d'abord, puis ClickHouse) [Automatisé] {#task-7--tear-down-plausible-first-then-clickhouse-automated}

L'ordre compte : détruisez **Plausible en premier**, puis ClickHouse. Détruire ClickHouse
alors que Plausible s'exécute encore laisse les pods Plausible boucler en échec face à un magasin
d'événements disparu et laisse en suspens l'autorisation de secret inter-modules.

```bash
# 1. Destroy Plausible
cd modules/Plausible_GKE
tofu destroy -var-file=config/deploy.tfvars

# 2. Then destroy ClickHouse (this deletes the event data on its PVC)
cd ../ClickHouse_GKE
tofu destroy -var="project_id=$PROJECT"
```

Dans la plateforme RAD, supprimez le déploiement **Plausible** (icône Trash) et attendez
qu'il se termine, puis supprimez le déploiement **ClickHouse**. Cela supprime tout ce
que les modules ont créé — les charges de travail Kubernetes et leurs espaces de noms, la base de données
Cloud SQL, les secrets Secret Manager et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, l'instance Cloud SQL partagée, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Prérequis et authentification | Manuel | gcloud/kubectl/tofu authentifiés ; plateforme Services_GCP confirmée |
| 2 — Déployer ClickHouse_GKE | Automatisé | Magasin d'événements déployé ; `/ping` répond `Ok.` avant que quoi que ce soit n'en dépende |
| 3 — Récupérer et raccorder les sorties | Manuel | Quatre valeurs `tofu output` collées dans les tfvars de déploiement de Plausible |
| 4 — Déployer Plausible_GKE | Automatisé | Charge de travail, Cloud SQL PG15, secrets, image personnalisée, job `db-init` ; le point d'entrée compose les deux URL de base de données et effectue les migrations |
| 5 — Vérifier et premier compte | Manuel | `/api/health` renvoie 200 avec un corps d'état JSON non vide ; premier compte enregistré sur `/register` ; site ajouté ; extrait de suivi récupéré |
| 6 — Exploiter (jour 2) | Manuel | Inscriptions fermées ; secrets et autorisation inter-modules inspectés ; journaux examinés |
| 7 — Démanteler | Automatisé | Plausible détruit en premier, puis ClickHouse |
