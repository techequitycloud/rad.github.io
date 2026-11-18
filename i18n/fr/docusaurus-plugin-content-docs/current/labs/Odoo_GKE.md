---
title: "Odoo sur GKE Autopilot — Guide de lab"
description: "Labs pratiques : déployez une configuration de référence, puis choisissez des labs de fonctionnalités pour chaque groupe de configuration — chacun avec un objectif, des paramètres testés, une vérification, des pièges et les étapes de retour arrière — ainsi que les opérations, l'observabilité et le démantèlement."
---

<!-- translated-from: docs/labs/Odoo_GKE.md @ 2be24ed1 sha256:672697df6dab -->

# Odoo sur GKE Autopilot — Guide de lab {#odoo-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Odoo_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** parcours principal (tâches 1–2) environ 60 minutes, principalement consacrées
à l'attente du premier déploiement ; chaque lab de fonctionnalités 10–40 minutes ; l'ensemble des
labs de bout en bout environ 9–11 heures.

Odoo est une suite ERP open source complète couvrant le CRM, la comptabilité, l'inventaire, la
fabrication, les RH et l'e-commerce. Le module **Odoo sur GKE Autopilot** déploie Odoo Community
Edition en tant que charge de travail Kubernetes sur le socle `App_GKE` : une image Odoo personnalisée
générée par Cloud Build, une base de données PostgreSQL sur l'instance Cloud SQL partagée (accessible
via un sidecar Cloud SQL Auth Proxy), le filestore d'Odoo et le `odoo.conf` généré sur le serveur NFS partagé,
un bucket Cloud Storage `addons` monté sur `/mnt/extra-addons`, des secrets dans Secret Manager, et un équilibreur de
charge Gateway API avec un nom d'hôte HTTPS `nip.io` gratuit.

Ce lab vous guide à travers l'ensemble du cycle de vie opérationnel du module — déployez-le, connectez-vous
à Odoo, puis modifiez et vérifiez **chaque groupe de paramètres** proposé par le formulaire de déploiement,
exploitez-le au quotidien, observez-le, dépannez-le et démantelez-le. Il se concentre sur l'exploitation
du module et de la plateforme Google Cloud sous-jacente, et non sur les fonctionnalités métier d'Odoo.

### Organisation de ce lab {#how-this-lab-is-organised}

- **Partie 1 — Socle principal (tâches 1–2).** Obligatoire pour tous. Déployez une configuration de
  référence avec les valeurs par défaut, connectez-vous à Odoo pour la première fois et apprenez à
  identifier chaque composant provisionné par cette configuration de base.
- **Partie 2 — Labs de fonctionnalités (labs 2–22).** Un lab par groupe de variables, numéroté par
  groupe (le lab 4 correspond au groupe 4). Après la configuration de référence, ils sont
  **indépendants les uns des autres** — choisissez les fonctionnalités qui vous intéressent dans le menu
  et réalisez-les dans n'importe quel ordre. Chaque lab précise son objectif, sa durée, son coût et ses
  prérequis, énumère chaque paramètre du groupe et vous guide à travers les étapes configurer → apply →
  vérifier → explorer → retour arrière.
- **Partie 3 — Exploitation, observabilité, dépannage, démantèlement (tâches 3–6).**

### Menu des labs {#lab-menu}

| Lab | Groupe | Objectif (ce que vous serez en mesure de faire) | Durée | Coût supplémentaire ? | Configuration externe |
|---|---|---|---|---|---|
| Tâches 1–2 | 1 | Déployer Odoo, vous connecter en tant qu'administrateur et localiser chaque ressource créée | 60 min | Référence | Aucune |
| Lab 2 | 2 | Acheminer les alertes de surveillance vers des personnes et apposer des labels de suivi des coûts sur chaque ressource | 10 min | Non | Aucune |
| Lab 3 | 3 | Renommer l'application dans la console et comprendre quels champs d'identité peuvent être modifiés en toute sécurité | 10 min | Non | Aucune |
| Lab 4 | 4 | Dimensionner, redimensionner automatiquement (HPA ou VPA) et ajuster le pod Odoo ainsi que le délai d'expiration de l'équilibreur de charge | 30 min | Faible | Aucune |
| Lab 5 | 5 | Injecter en toute sécurité des paramètres texte brut et adossés à Secret Manager (ex. SMTP) dans Odoo | 20 min | Non | Un secret Secret Manager que vous créez |
| Lab 6 | 6 | Verrouiller le trafic des pods avec une NetworkPolicy et ajuster les délais d'arrêt et de déploiement | 25 min | Non | Les options Mesh/MCS nécessitent ASM / une flotte |
| Lab 7 | 7 | Convertir Odoo en StatefulSet avec son propre disque bloc et vérifier la persistance du disque | 30 min | Faible (disque) | Aucune |
| Lab 8 | 8 | Plafonner le CPU et la mémoire de l'espace de noms avec un ResourceQuota permettant toujours les déploiements | 15 min | Non | Aucune |
| Lab 9 | 9 | Protéger Odoo lors de la maintenance des nœuds avec un PodDisruptionBudget et la répartition par zone | 15 min | Non | Aucune |
| Lab 10 | 10 | Ajuster les sondes contrôlant le trafic, et ajouter un test de disponibilité et une alerte CPU | 25 min | Faible | Aucune |
| Lab 11 | 11 | Ajouter votre propre job d'initialisation, un CronJob nocturne et un service associé aux côtés d'Odoo | 35 min | Faible | Aucune |
| Lab 12 | 12 | Activer Binary Authorization et passer en revue l'intégration CI/CD GitHub et Cloud Deploy | 20 min (lecture seule pour CI/CD) | Faible | **[Configuration externe requise]** GitHub pour CI/CD |
| Lab 13 | 13 | Vérifier que le filestore d'Odoo réside sur NFS par écriture, redémarrage et relecture | 20 min | Non | Aucune |
| Lab 14 | 14 | Ajouter des buckets, monter le bucket addons et comprendre la rétention des images et CMEK | 25 min | Faible | Clé KMS pour CMEK sur Artifact Registry |
| Lab 15 | 15 | Connecter Odoo à Redis et confirmer que le paramètre a bien atteint `odoo.conf` | 15 min | Non | Aucune |
| Lab 16 | 16 | Installer des extensions PostgreSQL, ajouter des alias de variables d'environnement et renouveler le mot de passe de la base en toute sécurité | 40 min | Faible | Aucune |
| Lab 17 | 17 | Planifier les sauvegardes de la base de données, en exécuter une à la demande et comprendre la restauration au déploiement | 20 min (+import) | Faible | L'import de sauvegarde nécessite un fichier de sauvegarde préparé |
| Lab 18 | 18 | Exécuter vos propres scripts SQL depuis un bucket sur la base de données Odoo | 20 min | Non | Un bucket que vous créez |
| Lab 19 | 19 | Diffuser Odoo sur votre propre nom d'hôte avec un certificat géré et une IP statique nommée | 30 min | Non | Un nom DNS (ou nip.io) |
| Lab 20 | 20 | Placer l'authentification Google (IAP) devant Odoo | 30 min | Non | **[Configuration externe requise]** Client OAuth |
| Lab 21 | 21 | Associer un WAF Cloud Armor et observer le blocage des attaques XSS/SQLi | 25 min | Oui | Aucune |
| Lab 22 | 22 | Activer la journalisation d'audit détaillée et comprendre VPC Service Controls | 15 min | Faible (journaux) | **[Configuration externe requise]** pour VPC-SC (organisation) |

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD, vous connecter à Odoo et localiser chaque ressource provisionnée.
- Modifier n'importe quel groupe de paramètres via **Update** avec le mode avancé, anticiper ce que la mise à jour
  va créer, modifier ou remplacer, et vérifier le résultat directement sur la ressource déployée.
- Distinguer un paramètre modifiable sans interruption (update-safe) d'un paramètre risquant de détruire ou remplacer des ressources.
- Exploiter la charge de travail au quotidien — dimensionnement, mise à jour, gestion des secrets, du stockage, des jobs et de la base de données.
- Observer le déploiement avec Cloud Logging et Cloud Monitoring, y compris le fichier journal propre à Odoo.
- Diagnostiquer les modes de défaillance observés lors des tests de chaque groupe de ce module sur un déploiement réel.
- Démanteler proprement le déploiement et supprimer les ressources externes créées par les labs.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL,
  Filestore, Artifact Registry et les comptes de service partagés dont dépend ce
  module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et
  le provisionne avant ce module si nécessaire (voir tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- La **CLI gcloud** et **kubectl** installés, ainsi que le `gke-gcloud-auth-plugin`
  (`gcloud components install gke-gcloud-auth-plugin`) ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Les droits IAM **Project Owner** (ou équivalent) sur le projet, afin de pouvoir lire les informations du cluster, de Cloud SQL,
  de Secret Manager et de Monitoring. `kubectl` nécessite au moins **Kubernetes Engine Developer**.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation de déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que Project Owner, puis **Verify**) et d'attribuer au compte de service de déploiement RAD le rôle **Owner**. Un projet créé pour vous par RAD ne nécessite aucune de ces étapes.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet créé pour vous par RAD, guère plus que le nom du tenant et la région). Toutes les autres entrées du guide de configuration — y compris chaque paramètre des labs de fonctionnalités ci-dessous — se modifient ensuite via **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, accessible à tout compte tant que les builds sont inclus dans le prix (sur un environnement de lab, seul un administrateur peut l'utiliser). Les mises à jour n'entraînent jamais de frais de module.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- `curl`, et facultativement `jq`, sur votre poste de travail.

Définissez ces variables shell une seule fois ; chaque tâche et lab ci-dessous les réutilise :

```bash
export PROJECT="<your-project-id>"
export REGION="us-central1"     # the region you deploy into
export APP="odoo"               # application_name (Group 3) — change if you chose another
export TENANT="demo"            # tenant_id (Group 1)

# Connect to the GKE cluster provided by Services_GCP
export CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

# Derived names. The module names everything after the SERVICE NAME:
#   service_name = application_name + tenant_id + an 8-character hash
# and, unless you set namespace_name, the namespace has the same name.
export NS=$(kubectl get ns -o name | cut -d/ -f2 | grep -E "^${APP}${TENANT}[0-9a-f]{8}$" | head -1)
export SERVICE="$NS"                       # Deployment / Service / job prefix
export PREFIX="${SERVICE#${APP}}"          # tenant prefix, e.g. demo1a2b3c4d (Gateway, PDB, NetworkPolicy)
echo "Cluster=$CLUSTER  Namespace=$NS  Service=$SERVICE  TenantPrefix=$PREFIX"
```

Deux variables supplémentaires proviennent du déploiement en cours d'exécution et sont définies à l'étape 4 de la tâche 1 : `HOST` (le
nom d'hôte HTTPS public) et `URL`.

## Comment modifier les paramètres dans les labs de fonctionnalités {#how-to-change-settings-in-the-feature-labs}

- **Mise à jour avec le mode avancé.** Sur la page **Deployments**, ouvrez votre déploiement Odoo, cliquez sur
  **Update**, cochez **Enable advanced mode**, recherchez le groupe mentionné dans le lab, modifiez les valeurs,
  puis soumettez. Les extraits de configuration de ce lab sont rédigés en HCL afin que chaque valeur soit exacte ;
  saisissez-les champ par champ dans le formulaire. Les mises à jour n'entraînent jamais de frais de module.
- **Modifiable sans risque ou non (Update-safe).** Chaque tableau ci-dessous contient une colonne *Update-safe*. Un paramètre update-safe est
  signalé par le module comme pouvant être modifié sans risque sur un déploiement en cours. La modification de tout autre paramètre entraîne
  un avertissement du formulaire indiquant que la mise à jour peut détruire ou remplacer des ressources, et vous demande confirmation.
  Cet avertissement est réel : modifier `application_name` crée un tout nouvel Odoo ; supprimer une
  entrée `storage_buckets` supprime ce bucket et son contenu ; `static_ip_name` attribue une
  nouvelle adresse IP à la Gateway. Lorsqu'un administrateur active **Enforce Update Safe**, les champs non marqués deviennent
  accessibles en lecture seule lors des mises à jour. « Update-safe » signifie « ne détruira pas de données », et non « prend effet immédiatement » — certains
  champs update-safe ne sont pris en compte qu'à la création sur GKE, et les labs précisent lesquels.
- **La validation au moment du plan est votre alliée.** Le module refuse les combinaisons non valides avant
  d'appliquer toute modification — par exemple IAP sans client OAuth, VPA avec `min_instance_count` supérieur à 1,
  ou un PVC monté sur le chemin NFS. Une mise à jour refusée laisse le déploiement exactement dans son état précédent ; lisez
  l'erreur, corrigez les valeurs, puis soumettez à nouveau. Plusieurs labs en déclenchent une volontairement.
- **Un lab à la fois.** Appliquez un groupe, vérifiez-le, puis effectuez un **retour arrière (Revert)** (ou conservez-le si un lab
  ultérieur s'appuie dessus). Les labs supposent que seule la configuration de base est présente, sauf indication contraire.
- **Une mise à jour affichée en vert n'est pas une preuve.** Plusieurs paramètres de ce module sont acceptés, appliqués et
  n'ont silencieusement aucun effet (ils sont signalés comme *inertes* ou *pris en compte à la création uniquement*). Chaque étape de vérification
  relit l'objet déployé — `kubectl get … -o yaml`, l'environnement du conteneur, un `curl`
  du point de terminaison ou un cycle écriture-redémarrage-lecture pour le stockage. Faites de même à chaque modification.

---

## Tâche 1 — Déployer la configuration de référence [Automatisé] {#task-1--deploy-the-baseline-automated}

La configuration de référence correspond aux valeurs par défaut du module. Le groupe 1 (`project_id`, `tenant_id`, `region`) est le seul
groupe obligatoire ; il est donc traité ici plutôt que dans son propre lab.

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `project_id` | *(obligatoire)* | Non | Projet dans lequel l'ensemble des ressources est déployé. |
| `tenant_id` | `demo` | Non | 1–7 lettres minuscules/chiffres. Tous les modules sur le même tenant dans un projet partagent le réseau, le cluster, le serveur de base de données et les comptes de service de ce tenant ; modifiez-le pour obtenir un ensemble de noms distinct. |
| `region` | `us-central1` | Non | Région de secours ; la région du réseau Services_GCP prévaut lorsqu'un réseau est découvert. |

Ce que vous procurent les valeurs par défaut : un pod Odoo (1 vCPU / 2 GiB) redimensionné automatiquement de 1 à 3 pods par un HPA ;
un Deployment avec la stratégie de mise à jour `Recreate` (en raison de l'utilisation de NFS) ; un Service `LoadBalancer`
accompagné d'une Gateway avec une IP globale réservée, un certificat géré par Google et un nom d'hôte HTTPS
`<ip-with-dashes>.nip.io` ; une base de données PostgreSQL et un utilisateur nommés d'après le service ; le mot de passe maître et
le mot de passe de base de données dans Secret Manager ; les buckets `gcs-<service>-addons`, `gcs-<service>-data` et
`gcs-<service>-backups` ; un CronJob nocturne d'exportation de base de données ; et un PodDisruptionBudget.

1. Accédez à **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Odoo (GKE)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id`, et vérifiez les saisies.
   Laissez tout le reste sur les valeurs par défaut pour la référence. Si un Odoo tourne déjà sur le même
   tenant dans ce projet, définissez `application_name` (groupe 3) sur une autre valeur, par exemple `odoo-lab`,
   afin que ce lab obtienne son propre espace de noms, sa propre base de données, ses secrets, ses buckets et son répertoire NFS — et mettez à jour
   `APP` dans vos variables shell en conséquence.
   Cliquez sur **Deploy Module**, vérifiez l'estimation des coûts dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle s'affiche, puis cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, telle que la vérification de votre propre projet, complétez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie d'abord Services_GCP si le projet ne l'a pas encore, puis compile l'image
   Odoo avec Cloud Build (Ubuntu Noble avec le paquet nightly `.deb` pour `application_version`),
   crée les secrets de base de données, l'espace de noms, les Secrets Kubernetes synchronisés depuis Secret Manager,
   les buckets, et exécute les jobs ponctuels dans l'ordre : les jobs du socle `nfs-setup` et `db-create`,
   puis les jobs propres à Odoo `nfs-init` (qui crée `/mnt/filestore`, `/mnt/sessions` et `/mnt/extra-addons`
   appartenant à l'utilisateur odoo, uid 101) et `db-init` (qui crée ou met à jour le rôle et la base
   de données). Enfin, elle crée le Deployment Odoo et la Gateway. Un premier déploiement prend environ
   **25–40 minutes** ; Cloud SQL et la compilation de l'image constituent l'essentiel du temps lorsque Services_GCP est nouveau.

   > Sur un cluster flambant neuf, le premier apply peut se terminer avant que les ressources personnalisées Kubernetes (comme
   > la synchronisation Secret Manager) ne soient enregistrées. Le pipeline de création de la plateforme exécute automatiquement
   > un second apply prenant en compte Kubernetes, vous n'avez donc rien à faire — attendez-vous simplement à voir deux
   > phases d'apply dans le journal.

3. Lorsque le déploiement affiche un succès, réexécutez le bloc de variables shell de la section **Prérequis** afin
   que `NS`, `SERVICE` et `PREFIX` soient renseignées, puis listez les ressources de l'espace de noms :

   ```bash
   kubectl get deploy,sts,pods,svc,hpa,pdb,jobs,cronjobs -n "$NS"
   kubectl get gateway,httproute,healthcheckpolicy,gcpbackendpolicy -n "$NS"
   ```

   Vous devez obtenir un Deployment nommé `$SERVICE` avec un pod dont tous les conteneurs sont Ready, les jobs
   terminés `…-nfs-setup`, `…-db-create`, `…-nfs-init` et `…-db-init`, un CronJob `…-db-export`, et une
   Gateway `${PREFIX}-gateway`.

4. Identifiez l'adresse publique. La section **Outputs** du déploiement affiche `service_url` ; vous pouvez également
   la déduire de l'adresse de la Gateway :

   ```bash
   GW_IP=$(kubectl get gateway -n "$NS" -o jsonpath='{.items[0].status.addresses[0].value}')
   export HOST="$(echo "$GW_IP" | tr . -).nip.io"     # the dashed form is the one the certificate covers
   export URL="https://${HOST}"
   echo "$URL"
   ```

   La Gateway est l'unique point d'entrée public. Comme Odoo_GKE active la Gateway, le
   Service Odoo est créé sous forme de `ClusterIP` même si `service_type` a pour valeur par défaut
   `LoadBalancer`, de sorte qu'il n'a pas d'IP externe propre et que rien ne peut contourner IAP (lab 20) ou
   Cloud Armor (lab 21) : `kubectl get svc "$SERVICE" -n "$NS"` affiche `ClusterIP` et
   `EXTERNAL-IP <none>`.

---

## Tâche 2 — Accéder à la configuration de référence et la vérifier [Manuel] {#task-2--access--verify-the-baseline-manual}

1. **Santé.** Le point de terminaison `/web/health` d'Odoo ne répond `200` que lorsque le serveur est opérationnel et
   connecté à sa base de données. C'est également le chemin utilisé par le contrôle de santé de la Gateway, et ce contrôle
   exige un `200` littéral (une redirection marquerait le backend comme défaillant) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"      # expect: 200
   curl -s "${URL}/web/health"; echo                                  # expect: {"status": "pass"}
   ```

   > Un certificat géré par Google et une Gateway nouvellement créés peuvent nécessiter **5–15 minutes** après la fin
   > du déploiement avant que HTTPS ne réponde. Entre-temps, vous pouvez utiliser l'IP du Service en HTTP :
   > `curl -s -o /dev/null -w "%{http_code}\n" "http://$(kubectl get svc "$SERVICE" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')/web/health"`.
   > Lors du tout premier démarrage, Odoo installe son module de base ; la sonde de démarrage accorde jusqu'à 9 minutes
   > (délai de 180 s + 3 × 120 s) avant d'abandonner.

2. **Premier démarrage : la base de données est déjà créée pour vous.** Contrairement à une installation Odoo classique, ce module
   ne vous demande pas de créer une base de données dans le navigateur :
   - `db-init` crée une base de données PostgreSQL et un rôle, tous deux nommés d'après le service (les traits d'union
     deviennent des traits de soulignement, ex. `odoodemo1a2b3c4d`).
   - Au premier démarrage, le conteneur génère `/mnt/odoo.conf` sur le partage NFS et lance
     `odoo -c /mnt/odoo.conf -i base`, qui installe le module de base d'Odoo dans cette base de données.
   - La configuration générée définit `list_db = False`, désactivant ainsi le **gestionnaire de base de données dans le
     navigateur** — `/web/database/manager` signale que l'administrateur l'a désactivé, et
     personne ne peut créer, dupliquer, sauvegarder ou supprimer de bases de données depuis le web. Le cycle de vie de la base
     est pris en charge par le module (labs 16–18).

   Confirmez-le depuis l'intérieur du pod (cette commande n'affiche aucun secret) :

   ```bash
   kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- \
     grep -E '^(db_name|list_db|data_dir|addons_path|workers|logfile)[[:space:]]*=' /mnt/odoo.conf
   kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- odoo --version
   ```

3. **Se connecter en tant qu'administrateur.** Une base de données initialisée en ligne de commande avec
   `-i base` possède l'administrateur intégré d'Odoo : identifiant `admin`, mot de passe `admin`. Vérifiez que les
   identifiants fonctionnent avant d'ouvrir le navigateur (un nombre dans `"uid"` signifie un succès ; `false`
   indique un rejet) :

   ```bash
   DB=$(kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- printenv DB_NAME)
   curl -s -X POST "${URL}/web/session/authenticate" -H 'Content-Type: application/json' \
     -d "{\"jsonrpc\":\"2.0\",\"params\":{\"db\":\"${DB}\",\"login\":\"admin\",\"password\":\"admin\"}}" \
     | grep -o '"uid": *[0-9a-z]*'
   ```

   Ouvrez ensuite `$URL` dans un navigateur, connectez-vous avec `admin` / `admin`, et **changez le mot de passe
   immédiatement** : cliquez sur votre avatar (en haut à droite) → **My Profile** (intitulé **Preferences** dans les versions
   plus anciennes) → **Account Security** → **Change Password**. Le déploiement est accessible sur l'Internet public
   dès sa création, et `admin`/`admin` est la première combinaison testée par les attaquants. Définissez ensuite l'adresse e-mail de
   l'administrateur et les informations de l'entreprise sous **Settings**, puis installez les applications souhaitées depuis
   **Apps** (une installation peut prendre une minute ou deux sur le serveur mono-processus ; la page peut sembler
   inactive pendant ce temps).

   > Si `uid` renvoie `false`, la base de données n'a pas été initialisée par le premier démarrage de ce module —
   > par exemple, une sauvegarde a été importée par-dessus (lab 17) — et ses propres identifiants administrateur
   > s'appliquent. La tâche 5 explique comment réinitialiser le mot de passe administrateur depuis le cluster.

4. **Le mot de passe maître.** Le mot de passe maître d'Odoo (`admin_passwd`, utilisé par le gestionnaire de base de données)
   est généré par le module, stocké dans Secret Manager, injecté sous la forme `ODOO_MASTER_PASS` et écrit
   dans `odoo.conf` à chaque démarrage. Avec le gestionnaire de base désactivé, vous n'en avez pas besoin au quotidien,
   mais gardez-le secret — c'est lui qui protégerait les opérations de base de données si le gestionnaire venait à être
   réactivé :

   ```bash
   MASTER_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~${PREFIX}-${APP}-master-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$MASTER_SECRET" --project="$PROJECT"
   ```

5. **Observer les ressources provisionnées par la configuration de base.** Exécutez chaque commande et comparez avec la description de la tâche 1 :

   ```bash
   # Workload, autoscaler, disruption budget
   kubectl get deploy,hpa,pdb -n "$NS"
   kubectl get deploy "$SERVICE" -n "$NS" -o jsonpath='{.spec.strategy.type}{"\n"}'   # Recreate

   # Containers in the pod: Odoo plus the Cloud SQL Auth Proxy (and the GCS FUSE sidecar)
   kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{range .items[0].spec.containers[*]}{.name}{"\n"}{end}'

   # Storage: NFS at /mnt, the addons bucket at /mnt/extra-addons
   kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- df -h /mnt /mnt/extra-addons
   gcloud storage buckets list --project="$PROJECT" --filter="name~${SERVICE}" --format="value(name)"

   # Database: the shared instance, your database and user
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --filter="databaseVersion~POSTGRES" --limit=1)
   gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" --filter="name~${SERVICE//-/_}"
   gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" --filter="name~${SERVICE//-/_}"

   # Secrets: Secret Manager and the Kubernetes Secrets synced from it
   gcloud secrets list --project="$PROJECT" --filter="name~${SERVICE} OR name~${PREFIX}-${APP}" --format="value(name)"
   kubectl get secretsync,secret -n "$NS"

   # Edge: Gateway IP, certificate, static address
   gcloud compute addresses list --global --project="$PROJECT" --filter="name~${SERVICE}"
   gcloud certificate-manager certificates list --project="$PROJECT" --filter="name~${SERVICE}"
   ```

   `df` doit afficher un export NFS (`<nfs-ip>:/share/<service>`) sur `/mnt`, et non `overlay` — s'il
   affiche `overlay`, le filestore se trouve sur le disque éphémère du pod (voir lab 13).

---

## Partie 2 — Labs de fonctionnalités {#part-2--feature-labs}

### Lab 2 — Environnement de déploiement (Groupe 2) {#lab-2--deployment-environment-group-2}

> **Objectif :** acheminer les notifications Cloud Monitoring vers des personnes désignées et étiqueter chaque ressource pour le suivi des coûts.

**Vous allez :** ajouter des contacts de support ; ajouter des labels aux ressources ; retrouver les deux sur les ressources déployées.
**Durée :** 10 min · **Coût :** aucun · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `support_users` | `[]` | Oui | Adresses e-mail recevant un accès au projet et un canal de notification par e-mail pour les alertes et tests de disponibilité de ce déploiement. |
| `resource_labels` | `{}` | Oui | Labels fusionnés sur chaque ressource créée par le module (espace de noms, charges de travail, buckets, secrets, surveillance). |

#### Étape 1 — Configurer {#step-1--configure}

```hcl
support_users   = ["<your-email>"]                                     # receives alert/uptime notifications
resource_labels = { environment = "lab", team = "erp", cost-centre = "it" }  # lowercase keys and values
```

#### Étape 2 — Appliquer {#step-2--apply}

Cliquez sur **Update**. Attendez-vous à la création d'une dizaine de ressources (canal de notification, IAM) et
à la mise à jour directe de nombreuses autres lors de l'ajout des labels. Aucun redémarrage de pod n'est requis. 3–8 minutes.

#### Étape 3 — Vérifier {#step-3--verify}

```bash
kubectl get ns "$NS" --show-labels                                        # environment=lab, team=erp …
kubectl get deploy "$SERVICE" -n "$NS" -o jsonpath='{.metadata.labels}{"\n"}'
gcloud storage buckets describe "gs://gcs-${SERVICE}-addons" --format="value(labels)"
gcloud beta monitoring channels list --project="$PROJECT" \
  --filter="displayName~${SERVICE}" --format="table(displayName,labels.email_address)"
```

Résultat attendu : les labels sur l'espace de noms, le Deployment et le bucket ; un canal de notification nommé
`<service>-notification-0` adressé à votre adresse e-mail.

#### Pour aller plus loin {#explore-further}

- Filtrez la facturation par label : dans **Billing → Reports**, regroupez par le label `cost-centre` (les labels apparaissent
  dans la facturation après un délai pouvant atteindre 24 heures).
- Ajoutez un second utilisateur de support et vérifiez qu'un second canal apparaît.

#### Points d'attention {#watch-out-for}

- Les clés et valeurs de labels doivent comporter uniquement des lettres minuscules, des chiffres, `_` et `-` ; une majuscule entraîne l'échec de
  l'apply sur la première ressource qui la refuse.
- Sur le **Service** Kubernetes, les labels ne sont pris en compte qu'à la création (voir lab 4) ; tout le reste
  les intègre lors d'une mise à jour.

#### Retour arrière {#revert}

Définissez `support_users = []` et `resource_labels = {}`. Le canal de notification est supprimé.

---

### Lab 3 — Identité de l'application (Groupe 3) {#lab-3--application-identity-group-3}

> **Objectif :** modifier le nom et la description d'Odoo dans la console, et comprendre quels champs d'identité peuvent être changés en toute sécurité.

**Vous allez :** changer le nom d'affichage et la description ; vérifier la version d'Odoo en cours d'exécution ; comprendre pourquoi `application_name` et `application_version` nécessitent des précautions.
**Durée :** 10 min · **Coût :** aucun · **Prérequis / configuration externe :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-1}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `application_name` | `odoo` | **Non** | Base du nom de chaque ressource (nom de service = ceci + tenant + hash). Sa modification crée un tout nouvel Odoo vide à côté de l'ancien. |
| `application_display_name` | `Odoo ERP` | Oui | Nom convivial dans la console et la surveillance. |
| `application_description` | `Odoo ERP on GKE Autopilot` | Oui | Annotation descriptive sur la charge de travail. |
| `application_version` | `18.0` | Oui | Série nightly d'Odoo à compiler (`18.0`, `17.0`, …). Transmise au Dockerfile sous la forme `ODOO_VERSION`. |

#### Étape 1 — Configurer {#step-1--configure-1}

```hcl
application_display_name = "Odoo ERP (lab)"                    # cosmetic
application_description  = "Odoo 18 ERP on GKE Autopilot - lab" # cosmetic
application_version      = "18.0"                               # leave the series unchanged
```

#### Étape 2 — Appliquer {#step-2--apply-1}

**Update**. Les métadonnées sont modifiées sur place ; quelques jobs et annotations sont actualisés. 3–6 minutes.

#### Étape 3 — Vérifier {#step-3--verify-1}

```bash
kubectl get deploy "$SERVICE" -n "$NS" -o yaml | grep -iE 'description|display' | head
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- odoo --version     # Odoo Server 18.0-…
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"           # 200
```

#### Pour aller plus loin {#explore-further-1}

- Comparez `odoo --version` avec le tag de l'image : `kubectl get deploy "$SERVICE" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}'`.
  Une nouvelle compilation sur la même série récupère la dernière version nightly de cette série.

#### Points d'attention {#watch-out-for-1}

- **`application_name`** constitue l'identité de l'ensemble du déploiement. Le modifier ne renomme
  rien — cela génère un second Odoo avec un nouvel espace de noms, une nouvelle base de données, de nouveaux secrets, buckets et répertoires
  NFS, tandis que l'ancien est détruit. Considérez-le comme figé après le premier déploiement.
- **`application_version` entre versions majeures.** Odoo ne migre pas automatiquement une base de données d'une version
  majeure à une autre. Passer une base existante 18.0 à 17.0 (rétrogradation) ou vers une
  série plus récente sans suivre le processus de mise à niveau d'Odoo peut empêcher le démarrage d'Odoo. Ne changez de série
  que sur un nouveau déploiement, ou après avoir appliqué la procédure officielle de migration d'Odoo.

#### Retour arrière {#revert-1}

Restaurez `Odoo ERP` / `Odoo ERP on GKE Autopilot`.

---

### Lab 4 — Exécution et mise à l'échelle (Groupe 4) {#lab-4--runtime--scaling-group-4}

> **Objectif :** dimensionner et redimensionner automatiquement le pod Odoo, choisir entre HPA et VPA, et ajuster le délai d'expiration des requêtes de l'équilibreur de charge.

**Vous allez :** augmenter la plage de réplicas ; comparer HPA et VPA ; définir le délai d'attente du backend ; identifier les paramètres d'exécution pris en compte à la création uniquement.
**Durée :** 30 min · **Coût :** faible — chaque pod supplémentaire coûte environ le même prix que le premier (Autopilot facture les requêtes CPU/mémoire) · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-2}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `deploy_application` | `true` | **Non** | `false` provisionne tout à l'exception de la charge de travail Odoo. Le désactiver sur un déploiement en cours supprime la charge de travail. |
| `container_image_source` | `custom` | **Non** | `custom` compile l'image Odoo avec Cloud Build ; `prebuilt` déploie `container_image` en l'état. Odoo nécessite `custom`. |
| `container_image` | `""` | Oui | URI de l'image pour `prebuilt`. |
| `container_build_config` | `{ enabled = true }` | Oui | Dockerfile, contexte et arguments de build pour `custom`. Le module transmet systématiquement `ODOO_VERSION` depuis `application_version`. |
| `enable_image_mirroring` | `true` | **Non** | Copie l'image dans Artifact Registry avant le déploiement. |
| `min_instance_count` | `1` | Oui | Minimum HPA. Conservez au moins 1 — les actions planifiées d'Odoo s'exécutent au sein du serveur. |
| `max_instance_count` | `3` | Oui | Maximum HPA (plafond de coût). |
| `enable_vertical_pod_autoscaling` | `false` | **Non** | Crée un VPA qui ajuste les requêtes de ressources selon l'usage constaté, et supprime le HPA. |
| `container_port` | `8069` | Oui | Port HTTP d'Odoo. Ne pas modifier. |
| `container_protocol` | `http1` | Oui | `h2c` s'adresse aux backends gRPC ; Odoo fonctionne en HTTP/1.1. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Oui (création uniquement) | Limites CPU/mémoire et options `cpu_request` / `mem_request`. |
| `timeout_seconds` | `300` | Oui | Délai d'attente du backend Gateway (`GCPBackendPolicy.timeoutSec`). |
| `enable_cloudsql_volume` | `true` | Oui | Ajoute le sidecar Cloud SQL Auth Proxy. Odoo en a besoin. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Oui | Emplacement de montage du répertoire de socket du proxy. |
| `service_annotations` | `{}` | Oui (création uniquement) | Annotations supplémentaires sur le Service Kubernetes. |
| `service_labels` | `{}` | Oui (création uniquement) | Labels supplémentaires sur le Service Kubernetes. |

#### Étape 1 — Configurer {#step-1--configure-2}

Partie A — plage HPA et délai d'expiration (le cas d'usage courant et sécurisé) :

```hcl
min_instance_count = 1       # always one Odoo running (scheduler, mail fetch)
max_instance_count = 2       # allow one extra pod under load
timeout_seconds    = 600     # long reports / imports over the Gateway
```

Partie B — tester le VPA à la place du HPA (valeurs testées) :

```hcl
enable_vertical_pod_autoscaling = true   # VPA sizes the single pod; the HPA is removed
min_instance_count              = 1      # must be 1 with VPA (plan-time guard)
```

#### Étape 2 — Appliquer {#step-2--apply-2}

Partie A : le HPA et la ressource `GCPBackendPolicy` sont mis à jour directement ; pas de redémarrage de pod. 3–6 minutes.
Partie B : crée un `VerticalPodAutoscaler` et supprime le HPA.

#### Étape 3 — Vérifier {#step-3--verify-2}

```bash
# Part A
kubectl get hpa -n "$NS"                                                    # MINPODS 1  MAXPODS 2
kubectl get gcpbackendpolicy -n "$NS" -o yaml | grep timeoutSec            # timeoutSec: 600

# Part B
kubectl get vpa -n "$NS"                                                    # ${SERVICE}-vpa
kubectl get hpa -n "$NS"                                                    # No resources found
kubectl describe vpa "${SERVICE}-vpa" -n "$NS" | sed -n '/Recommendation/,$p'

# Resources actually applied to the running container
kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.containers[0].resources}{"\n"}'
```

#### Pour aller plus loin {#explore-further-2}

- **Garde-fou à la planification :** avec le VPA activé, définissez `min_instance_count = 2` et soumettez. La mise à jour est refusée
  avec un message explicatif — le VPA supprime le HPA, et plus rien n'assurerait alors le respect du minimum.
- **Pris en compte à la création uniquement :** modifiez `container_resources` en `{ cpu_limit = "2000m", memory_limit = "4Gi" }`
  sur le déploiement en cours. La mise à jour réussit, mais les `resources` affichées ci-dessus ne changent pas :
  le module ignore les modifications ultérieures apportées aux requêtes et limites du conteneur (GKE Autopilot les réécrit,
  et le module entrerait en conflit avec lui à chaque apply sinon). Les nouvelles valeurs ne s'appliquent que lors de la
  création de la charge de travail — au premier déploiement, ou lorsque le lab 7 la convertit en StatefulSet.
  Il en va de même pour `service_annotations` et `service_labels` sur le Service.
- Utilisez `kubectl top pod -n "$NS"` avant et après une période de forte activité pour choisir un dimensionnement mémoire adapté.

#### Points d'attention {#watch-out-for-2}

- **Ne descendez pas en dessous de 2 GiB de mémoire.** Le mécanisme interne de protection de mémoire d'Odoo (`limit_memory_hard` ≈ 1,5 GiB,
  `limit_memory_soft` ≈ 640 MiB dans `odoo.conf`) ne fonctionne qu'en deçà de la limite du conteneur ; à 512 MiB,
  le noyau tue le processus Odoo avant qu'il ne puisse se recycler, particulièrement lors de `-i base` au premier démarrage.
- Le nom du champ est bien `mem_request` (et non `memory_request`). Un attribut mal orthographié est
  silencieusement ignoré, et la demande de ressource se rabat sur la limite.
- `min_instance_count = 0` arrête complètement Odoo entre deux montées en charge — les actions planifiées, la
  récupération des e-mails et les rappels s'arrêtent également.
- Modifier la charge de travail avec la stratégie par défaut `Recreate` provoque une courte interruption : l'ancien pod
  s'arrête avant que le nouveau ne démarre, afin d'éviter que deux pods Odoo n'accèdent simultanément aux mêmes fichiers NFS durant
  une mise à jour.

#### Retour arrière {#revert-2}

`enable_vertical_pod_autoscaling = false` (le VPA est supprimé et le HPA est restauré), `min_instance_count = 1`,
`max_instance_count = 3`, `timeout_seconds = 300`.

---

### Lab 5 — Variables d'environnement et secrets (Groupe 5) {#lab-5--environment-variables--secrets-group-5}

> **Objectif :** transmettre des configurations et des secrets à Odoo sans exposer les valeurs sensibles dans la spécification du pod.

**Vous allez :** ajouter des variables d'environnement texte brut ; référencer un secret Secret Manager ; observer le déplacement automatique d'une variable ressemblant à un identifiant dans un Secret Kubernetes.
**Durée :** 20 min · **Coût :** aucun · **Prérequis / configuration externe :** un secret Secret Manager créé par vos soins (ci-dessous).

#### Paramètres de ce groupe {#settings-in-this-group-3}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `environment_variables` | `{}` | Oui | Variables d'environnement texte brut pour le conteneur Odoo. |
| `secret_environment_variables` | `{}` | Oui | Correspondance variable d'environnement → nom du secret Secret Manager. Synchronisée dans un Secret Kubernetes et injectée avec `secretKeyRef`. |
| `secret_rotation_period` | `2592000s` | Oui | Calendrier de renouvellement pour les secrets du module ; crée le sujet Pub/Sub `secret-<service>-rotation`. |
| `secret_propagation_delay` | `30` | Oui | Secondes à attendre après l'écriture d'un secret avant son utilisation par les étapes dépendantes. |
| `protect_sensitive_environment_variables` | `true` | Oui | Déplace toute entrée de `environment_variables` dont le nom évoque un identifiant (`…_PASSWORD`, `…_TOKEN`, `…_SECRET`, `…_API_KEY` …) dans un Secret Kubernetes. Masqué dans les projets gérés par RAD. |

`explicit_secret_values` (par exemple un `ODOO_MASTER_PASS` personnalisé) ne figure pas sur le formulaire — consultez l'annexe.

#### Étape 1 — Configurer {#step-1--configure-3}

Créez d'abord le secret, dans votre région (les projets gérés par RAD refusent les secrets globaux) :

```bash
printf 'lab-secret-value' | gcloud secrets create odoo-lab-marker --project="$PROJECT" \
  --replication-policy=user-managed --locations="$REGION" --data-file=-
```

```hcl
environment_variables = {
  TZ                = "UTC"          # plain value
  ODOO_LAB_MARKER   = "group-5"      # plain marker to find in the pod
  SMTP_LAB_PASSWORD = "not-real"     # name ends in _PASSWORD → moved into a Kubernetes Secret
}
secret_environment_variables = { ODOO_LAB_SECRET = "odoo-lab-marker" }  # env var → Secret Manager secret
secret_propagation_delay     = 60
```

#### Étape 2 — Appliquer {#step-2--apply-3}

**Update**. La ressource SecretSync et le Secret Kubernetes intègrent une nouvelle clé, et le modèle de pod
du Deployment change, ce qui entraîne le redémarrage d'Odoo (courte interruption avec `Recreate`). 5–10 minutes.

#### Étape 3 — Vérifier {#step-3--verify-3}

```bash
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- printenv TZ ODOO_LAB_MARKER   # UTC / group-5
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- sh -c 'test -n "$ODOO_LAB_SECRET" && echo secret-present'

# How each variable is injected: plain value vs secretKeyRef
kubectl get deploy "$SERVICE" -n "$NS" -o yaml | grep -A4 -E 'name: (ODOO_LAB_MARKER|ODOO_LAB_SECRET|SMTP_LAB_PASSWORD)$'
```

Résultat attendu : `ODOO_LAB_MARKER` possède un `value:` ; `ODOO_LAB_SECRET` et `SMTP_LAB_PASSWORD` affichent
`valueFrom: secretKeyRef:` — la valeur sensible n'apparaît jamais dans le Deployment.

#### Pour aller plus loin {#explore-further-3}

- **Configuration SMTP réelle pour Odoo.** Le serveur de messagerie sortant d'Odoo se configure dans l'interface d'Odoo (**Settings →
  Technical → Outgoing Mail Servers**, avec le mode développeur activé). Utilisez le groupe 5 pour transporter les valeurs que vos
  propres modules complémentaires ou scripts exploitent.
- **Mises à jour de secrets.** Ajoutez une nouvelle version : `printf 'v2' | gcloud secrets versions add odoo-lab-marker --data-file=- --project="$PROJECT"`.
  La synchronisation Secret Manager du cluster actualise le Secret Kubernetes toutes les 2 minutes environ ;
  les variables d'environnement étant lues au démarrage du conteneur, redémarrez-le pour la prendre en compte :
  `kubectl rollout restart deploy/"$SERVICE" -n "$NS"`.

#### Points d'attention {#watch-out-for-3}

- Le secret doit exister **avant** la mise à jour, dans le même projet ; un secret manquant empêche
  le pod de passer à l'état Ready.
- Les noms de variables d'environnement contenant un double soulignement (`__`) ne peuvent pas être synchronisés en tant que clés de Secret Kubernetes ; utilisez
  des soulignements simples.
- Désactiver `protect_sensitive_environment_variables` inscrit les valeurs d'identifiants en clair dans
  la spécification du pod, visible par quiconque dispose des droits de lecture.

#### Retour arrière {#revert-3}

Définissez `environment_variables = {}`, `secret_environment_variables = {}`, `secret_propagation_delay = 30`,
puis supprimez le secret : `gcloud secrets delete odoo-lab-marker --project="$PROJECT" --quiet`.

---

### Lab 6 — Backend GKE et cluster (Groupe 6) {#lab-6--gke-backend--cluster-group-6}

> **Objectif :** isoler l'espace de noms d'Odoo avec une NetworkPolicy et ajuster les délais d'arrêt et de déploiement, tout en maintenant fonctionnel le chemin de l'équilibreur de charge.

**Vous allez :** activer la segmentation réseau ; vérifier qu'Odoo accède toujours à Cloud SQL et que le chemin Internet reste fonctionnel ; ajuster le délai de grâce et le délai d'expiration du déploiement.
**Durée :** 25 min · **Coût :** aucun · **Prérequis / configuration externe :** Multi-Cluster Services nécessite une flotte enregistrée ; le maillage de services nécessite Cloud Service Mesh — les deux sont facultatifs et non requis pour ce lab.

#### Paramètres de ce groupe {#settings-in-this-group-4}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `gke_cluster_name` | `""` | Oui | Cluster cible ; vide permet l'auto-découverte du cluster Services_GCP. Sa modification déplace l'application vers un autre cluster. |
| `namespace_name` | `""` | Oui | Espace de noms ; vide utilise le nom du service. Sa modification déplace chaque ressource de l'espace de noms. |
| `workload_type` | `null` | **Non** | `Deployment` ou `StatefulSet` ; `null` bascule sur StatefulSet quand `stateful_pvc_enabled = true` (lab 7). |
| `service_type` | `LoadBalancer` | **Non** | Type de Service Kubernetes. Lorsqu'une Gateway est utilisée (domaine personnalisé, CDN ou Cloud Armor — par défaut pour Odoo), `LoadBalancer` est créé comme `ClusterIP` pour que la Gateway soit le seul accès. `NodePort` est respecté selon sa définition. |
| `session_affinity` | `ClientIP` | Oui | Routage persistant (sticky sessions) sur le Service. |
| `enable_multi_cluster_service` | `false` | Oui | Crée un `ServiceExport` pour une consommation à l'échelle de la flotte. Nécessite une flotte avec MCS. |
| `configure_service_mesh` | `false` | **Non** | Étiquette l'espace de noms pour l'injection du sidecar Istio. Nécessite Cloud Service Mesh. |
| `deployment_strategy` | `null` | **Non** | `RollingUpdate` ou `Recreate`. `null` laisse le socle choisir — ici `Recreate`, car Odoo repose sur NFS. |
| `enable_network_segmentation` | `false` | **Non** | Crée la NetworkPolicy `<tenant-prefix>-namespace-isolation`. |
| `termination_grace_period_seconds` | `30` | Oui | Secondes accordées à Odoo après un signal SIGTERM avant son arrêt forcé. |
| `deployment_timeout` | `1800` | Oui | Durée maximale d'attente d'un apply avant la finalisation du déploiement. |

#### Étape 1 — Configurer {#step-1--configure-4}

```hcl
enable_network_segmentation      = true    # default-deny with explicit allow rules
termination_grace_period_seconds = 60      # let in-flight requests finish
deployment_timeout               = 2400    # first boots and big images take time
session_affinity                 = "ClientIP"
service_type                     = "LoadBalancer"
```

#### Étape 2 — Appliquer {#step-2--apply-4}

Crée une NetworkPolicy ; le modèle de pod change (délai de grâce), ce qui redémarre Odoo. 5–10 minutes.

#### Étape 3 — Vérifier {#step-3--verify-4}

```bash
kubectl get networkpolicy -n "$NS"
kubectl describe networkpolicy "${PREFIX}-namespace-isolation" -n "$NS" | sed -n '/Allowing egress/,$p' | head -40

# Odoo can still reach the database through the proxy, and the LB path still works
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"                       # 200
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- bash -c \
  'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select 1"'   # 1
kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.terminationGracePeriodSeconds}{"\n"}'  # 60
```

La politique autorise le trafic au sein de l'espace de noms, depuis les plages d'adresses de l'équilibreur
de charge et des contrôles de santé de Google, le DNS, l'IP privée de l'instance Cloud SQL, le serveur NFS et Redis.

#### Pour aller plus loin {#explore-further-4}

- Démarrez un pod temporaire dans un autre espace de noms et tentez de joindre Odoo directement — la requête doit expirer :
  `kubectl run np-test -n default --rm -it --image=curlimages/curl --restart=Never -- curl -m 5 -s -o /dev/null -w '%{http_code}\n' http://${SERVICE}.${NS}.svc.cluster.local/web/health`.
- Examinez les règles de sortie (egress) et notez que la règle Cloud SQL cible la véritable IP privée de l'instance.

#### Points d'attention {#watch-out-for-4}

- `gke_cluster_name` et `namespace_name` sont signalés comme update-safe, mais les modifier déplace
  l'application (et recrée la Gateway ainsi que son IP réservée). Si vous devez les fixer, fixez-les
  aux valeurs déduites actuelles (`$CLUSTER`, `$NS`).
- `deployment_strategy = "RollingUpdate"` exécute brièvement deux pods Odoo sur le même partage NFS et la même base de données durant une mise à jour. La valeur déduite `Recreate` évite précisément cela ; ne la surchargez que si vous acceptez ce chevauchement. Vérifiez le résultat avec `kubectl get deploy "$SERVICE" -n "$NS" -o jsonpath='{.spec.strategy.type}'`.
- Activer `configure_service_mesh` ou `enable_multi_cluster_service` sans la fonctionnalité
  de plateforme sous-jacente fait échouer l'apply ou ne produit aucun effet utile.

#### Retour arrière {#revert-4}

`enable_network_segmentation = false`, `termination_grace_period_seconds = 30`, `deployment_timeout = 1800`.

---

### Lab 7 — StatefulSet (Groupe 7) {#lab-7--statefulset-group-7}

> **Objectif :** exécuter Odoo en tant que StatefulSet avec son propre disque bloc, et prouver que les données sur ce disque survivent au remplacement du pod.

**Vous allez :** convertir la charge de travail en StatefulSet avec un PVC ; le monter à côté (et non par-dessus) du partage NFS ; écrire des données, supprimer le pod et vérifier leur persistance.
**Durée :** 30 min · **Coût :** faible — un disque persistant standard de 10 GiB · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-5}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `stateful_pvc_enabled` | `null` | **Non** | Ajoute un PVC par pod ; avec `workload_type = null`, la charge de travail devient un StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Oui | Taille du PVC. |
| `stateful_pvc_mount_path` | `/data` | Oui | Emplacement de montage du PVC. Ne doit pas être `/mnt` (le point de montage NFS). |
| `stateful_pvc_storage_class` | `standard-rwo` | Oui | `standard-rwo` correspond à un disque équilibré sur SSD ; `standard` correspond à un disque dur (HDD). |
| `stateful_headless_service` | `null` | **Non** | Ajoute un Service headless pour un DNS stable par pod. |
| `stateful_pod_management_policy` | `null` | Oui | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | Oui | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | Oui (création uniquement) | `fsGroup` du pod ; rend le disque accessible en écriture pour un processus non-root. Odoo s'exécute avec uid/gid 101. |

#### Étape 1 — Configurer {#step-1--configure-5}

```hcl
stateful_pvc_enabled           = true
stateful_pvc_size              = "10Gi"
stateful_pvc_mount_path        = "/var/lib/odoo-block"  # OUTSIDE /mnt, where the NFS share is
stateful_pvc_storage_class     = "standard"             # HDD: spares the tight SSD quota
stateful_headless_service      = true
stateful_pod_management_policy = "OrderedReady"
stateful_update_strategy       = "RollingUpdate"
stateful_fs_group              = 101                    # the odoo user's gid
```

#### Étape 2 — Appliquer {#step-2--apply-5}

Le Deployment est **remplacé** par un StatefulSet (courte interruption), un PVC est créé et associé (bound), et un
Service headless est ajouté. Les données Odoo proprement dites ne sont pas affectées — elles résident sur NFS et Cloud SQL.
8–15 minutes.

#### Étape 3 — Vérifier {#step-3--verify-5}

```bash
kubectl get sts,pvc,svc -n "$NS"                                     # PVC Bound, 10Gi, standard
POD=$(kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "$NS" "$POD" -c "$APP" -- df -h /var/lib/odoo-block   # a /dev/sd* block device

# Write – replace the pod – read back
kubectl exec -n "$NS" "$POD" -c "$APP" -- sh -c 'date -u > /var/lib/odoo-block/marker && cat /var/lib/odoo-block/marker'
kubectl delete pod "$POD" -n "$NS"
kubectl wait --for=condition=Ready pod/"$POD" -n "$NS" --timeout=900s
kubectl exec -n "$NS" "$POD" -c "$APP" -- cat /var/lib/odoo-block/marker   # same timestamp
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"               # 200
```

Désormais, utilisez `sts/"$SERVICE"` (ou `$POD`) au lieu de `deploy/"$SERVICE"` dans vos commandes.

#### Pour aller plus loin {#explore-further-5}

- **Garde-fous à la planification :** définissez `stateful_pvc_mount_path = "/mnt"` et soumettez — refusé, car un
  conteneur ne peut monter deux volumes sur le même chemin. Définissez `workload_type = "Deployment"` conjointement avec
  `stateful_pvc_enabled = true` — également refusé.
- Comparez `fsGroup` sur le pod (`kubectl get pod "$POD" -n "$NS" -o jsonpath='{.spec.securityContext}'`).

#### Points d'attention {#watch-out-for-5}

- Odoo conserve ses données sur NFS (`/mnt/filestore`) et dans Cloud SQL ; le disque bloc est un espace
  supplémentaire pour vos propres modules ou outils, et non un substitut à NFS.
- Montez le PVC **en dehors** de `/mnt` — monter par-dessus masquerait le filestore d'Odoo et `odoo.conf`.
- `stateful_fs_group` doit être défini lors de la création du StatefulSet ; le modifier plus tard est sans effet.
  Sans cela (ou avec un mauvais gid), l'utilisateur odoo ne peut pas écrire sur le disque.
- Le SSD (`standard-rwo`) consomme sur un quota SSD régional restreint ; réduire l'échelle à zéro conserve le PVC et son
  quota tant que le PVC n'est pas supprimé.

#### Retour arrière {#revert-5}

Définissez `stateful_pvc_enabled = null` et `stateful_headless_service = null` (en laissant les autres
champs sur leurs valeurs par défaut). Le StatefulSet est de nouveau remplacé par un Deployment (courte interruption).
Vérifiez si le PVC a été supprimé — `kubectl get pvc -n "$NS"` — et supprimez-le s'il subsiste :
`kubectl delete pvc -n "$NS" --all` (seuls les PVC de ce lab résident dans cet espace de noms).

---

### Lab 8 — Quotas de ressources (Groupe 8) {#lab-8--resource-quota-group-8}

> **Objectif :** plafonner la consommation totale de CPU et de mémoire de l'espace de noms sans bloquer les mises à jour et les jobs propres à Odoo.

**Vous allez :** créer un ResourceQuota dimensionné avec une marge suffisante ; observer la consommation imputée sur ce quota ; déclencher la validation des unités binaires.
**Durée :** 15 min · **Coût :** aucun · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-6}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_resource_quota` | `false` | **Non** | Crée le ResourceQuota `app-quota` dans l'espace de noms. |
| `quota_cpu_requests` | `""` | Oui | Total des requêtes CPU, ex. `4`. |
| `quota_cpu_limits` | `""` | Oui | Total des limites CPU, ≥ requêtes. |
| `quota_memory_requests` | `""` | Oui | Total des requêtes mémoire avec suffixe binaire, ex. `8Gi`. |
| `quota_memory_limits` | `""` | Oui | Total des limites mémoire avec suffixe binaire, ≥ requêtes. |

#### Étape 1 — Configurer {#step-1--configure-6}

Dimensionnez pour au moins le double des pods en cours d'exécution plus les jobs, afin qu'un nouveau pod puisse démarrer pendant que l'ancien est
toujours comptabilisé :

```hcl
enable_resource_quota = true
quota_cpu_requests    = "4"
quota_cpu_limits      = "8"
quota_memory_requests = "8Gi"     # binary suffix is mandatory
quota_memory_limits   = "16Gi"
```

#### Étape 2 — Appliquer {#step-2--apply-6}

Crée un ResourceQuota. Aucun redémarrage. 3–5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-6}

```bash
kubectl describe resourcequota app-quota -n "$NS"     # Used vs Hard for each resource
```

Résultat attendu : `requests.cpu`, `limits.memory` et les autres affichent une consommation non nulle issue d'Odoo et de ses
sidecars, largement inférieure aux limites strictes.

#### Pour aller plus loin {#explore-further-6}

- **Validation :** définissez `quota_memory_requests = "8000000000"` et soumettez — refusé ; un nombre
  brut représente des octets pour Kubernetes et bloquerait l'ordonnancement.
- Réduisez `quota_memory_limits` jusqu'à ce qu'un redémarrage (`kubectl rollout restart`) laisse un pod à l'état `Pending`
  avec un événement `exceeded quota` (`kubectl get events -n "$NS" --sort-by=.lastTimestamp | tail`).
  Augmentez-le ensuite à nouveau.

#### Points d'attention {#watch-out-for-6}

- Un quota dimensionné pour un seul pod bloque les mises à jour et l'exécution des jobs. Chaque pod de job d'initialisation et de CronJob
  est également pris en compte.

#### Retour arrière {#revert-6}

`enable_resource_quota = false` et réinitialisez les quatre champs de quota à `""`.

---

### Lab 9 — Politiques de fiabilité (Groupe 9) {#lab-9--reliability-policies-group-9}

> **Objectif :** déterminer la proportion d'Odoo pouvant être évincée lors de la maintenance des nœuds, et répartir les pods sur plusieurs zones.

**Vous allez :** configurer un PodDisruptionBudget ; ajouter des contraintes de répartition topologique ; vérifier le nombre d'interruptions autorisées.
**Durée :** 15 min · **Coût :** aucun (davantage si vous augmentez le nombre de réplicas) · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-7}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_pod_disruption_budget` | `true` | Oui | Crée `<tenant-prefix>-pdb`. |
| `pdb_min_available` | `1` | Oui | Pods devant rester disponibles lors des interruptions volontaires — un nombre ou un pourcentage. |
| `enable_topology_spread` | `false` | Oui | Ajoute des contraintes de répartition topologique par zone au pod. |
| `topology_spread_strict` | `false` | Oui | `true` = `DoNotSchedule` ; `false` = `ScheduleAnyway`. |

#### Étape 1 — Configurer {#step-1--configure-7}

```hcl
enable_pod_disruption_budget = true
pdb_min_available            = "50%"
enable_topology_spread       = true
topology_spread_strict       = false    # never leave a pod unscheduled because of spreading
```

#### Étape 2 — Appliquer {#step-2--apply-7}

Met à jour le PDB et le modèle de pod (Odoo redémarre). 5–8 minutes.

#### Étape 3 — Vérifier {#step-3--verify-7}

```bash
kubectl get pdb -n "$NS"     # MIN AVAILABLE 50%   ALLOWED DISRUPTIONS 0 (with one replica)
kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.topologySpreadConstraints}{"\n"}'
```

#### Pour aller plus loin {#explore-further-7}

- Avec un seul réplica, tant `"1"` que `"50%"` autorisent **zéro** interruption volontaire (50 % de 1 s'arrondit
  à 1), de sorte que les mises à niveau des nœuds attendent Odoo. Définissez `min_instance_count = 2` (lab 4) et observez
  `ALLOWED DISRUPTIONS` passer à 1.
- **Garde-fou à la planification :** avec `max_instance_count = 2`, définissez `pdb_min_available = "2"` — refusé,
  car un budget égal au maximum ne permettrait jamais la moindre éviction.

#### Points d'attention {#watch-out-for-7}

- Un PDB autorisant zéro interruption peut suspendre les mises à niveau du cluster tant que GKE le respecte.
- `topology_spread_strict = true` avec moins de zones disponibles que de pods peut laisser des pods bloqués à l'état `Pending`.

#### Retour arrière {#revert-7}

`pdb_min_available = "1"`, `enable_topology_spread = false`.

---

### Lab 10 — Observabilité et santé (Groupe 10) {#lab-10--observability--health-group-10}

> **Objectif :** ajuster les sondes qui contrôlent l'acheminement du trafic vers Odoo, et ajouter un test de disponibilité ainsi qu'une alerte CPU.

**Vous allez :** modifier les délais des sondes et les vérifier sur le pod et le contrôle de santé de la Gateway ; créer un test de disponibilité et une politique d'alerte.
**Durée :** 25 min · **Coût :** faible (les tests de disponibilité et les alertes bénéficient d'un quota gratuit) · **Prérequis :** `support_users` du lab 2 si vous souhaitez recevoir des notifications par e-mail.

#### Paramètres de ce groupe {#settings-in-this-group-8}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `startup_probe_config` | chemin `/web/health`, délai 180, expiration 60, période 120, seuil 3 | Oui | Sonde de démarrage — aucun trafic ni contrôle de vivacité tant qu'elle n'a pas réussi. |
| `health_check_config` | chemin `/web/health`, délai 30, expiration 5, période 30, seuil 3 | Oui | Sonde de vivacité **et de disponibilité (readiness)** ; également répliquée dans la ressource `HealthCheckPolicy` de la Gateway. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | **Non** | Test de disponibilité Cloud Monitoring ciblant le nom d'hôte HTTPS public. |
| `alert_policies` | `[]` | Oui | Politiques d'alerte sur métriques, notifiées à `support_users`. |

#### Étape 1 — Configurer {#step-1--configure-8}

```hcl
health_check_config  = { enabled = true, type = "HTTP", path = "/web/health",
                         initial_delay_seconds = 45, timeout_seconds = 10, period_seconds = 20, failure_threshold = 5 }
startup_probe_config = { enabled = true, type = "HTTP", path = "/web/health",
                         initial_delay_seconds = 60, timeout_seconds = 30, period_seconds = 15, failure_threshold = 40 }  # up to ~11 min
uptime_check_config  = { enabled = true, path = "/web/health", check_interval = "300s", timeout = "30s" }
alert_policies = [{
  name = "odoo-high-cpu", metric_type = "kubernetes.io/container/cpu/limit_utilization",
  comparison = "COMPARISON_GT", threshold_value = 0.85, duration_seconds = 300, aggregation_period = "60s"
}]
```

#### Étape 2 — Appliquer {#step-2--apply-8}

Le modèle de pod change (Odoo redémarre) ; la ressource `HealthCheckPolicy` est mise à jour ; un test de disponibilité, son
alerte et votre politique d'alerte sont créés. 5–10 minutes.

#### Étape 3 — Vérifier {#step-3--verify-8}

```bash
kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.containers[0].livenessProbe}{"\n"}{.items[0].spec.containers[0].startupProbe}{"\n"}'
kubectl get healthcheckpolicy -n "$NS" -o yaml | grep -E 'requestPath|checkIntervalSec|timeoutSec'
gcloud monitoring uptime list-configs --project="$PROJECT" --filter="displayName~${SERVICE}" \
  --format="table(displayName,httpCheck.path,period,monitoredResource.labels.host)"
gcloud alpha monitoring policies list --project="$PROJECT" --filter="displayName~${SERVICE}" --format="value(displayName)"
```

Résultat attendu : les délais de sondes définis ; une ressource `HealthCheckPolicy` vérifiant `/web/health` ; un test de
disponibilité `<service>-uptime-check` sur l'hôte avec tirets `nip.io` ; les politiques `<service>-odoo-high-cpu`
et `<service>-uptime-check-alert`.

#### Pour aller plus loin {#explore-further-8}

- Ouvrez **Monitoring → Uptime checks** et observez les résultats parvenir depuis différentes régions.
- Définissez un seuil CPU délibérément bas (ex. `0.01`) pour constater l'ouverture d'un incident et la réception d'un e-mail,
  puis rétablissez la valeur initiale.

#### Points d'attention {#watch-out-for-8}

- **Conservez le chemin de sonde sur `/web/health`.** Il renvoie un `200` littéral. Odoo répond à `/` par une
  redirection, acceptée par Kubernetes mais refusée par le contrôle de santé de l'équilibreur de charge de Google — le pod
  apparaîtrait sain alors que la Gateway renverrait des erreurs 503.
- `health_check_config` constitue la sonde active sur ce module et pilote également le contrôle de santé de la Gateway ;
  un délai d'expiration trop court ici écarte Odoo de l'équilibreur de charge lors des requêtes plus lentes.
- Accordez une marge généreuse pour le démarrage : le premier boot installe le module de base et peut durer plusieurs minutes.
- Le test de disponibilité n'est créé que si un point de terminaison public existe (la Gateway avec un domaine ou une
  IP réservée — ce qui est le cas par défaut).

#### Retour arrière {#revert-8}

Restaurez les objets de sonde par défaut présentés dans le tableau, `uptime_check_config = { enabled = false, path = "/" }`,
`alert_policies = []`.

---

### Lab 11 — Jobs et tâches planifiées (Groupe 11) {#lab-11--jobs--scheduled-tasks-group-11}

> **Objectif :** exécuter vos propres jobs ponctuels et planifiés aux côtés d'Odoo, et ajouter un service associé.

**Vous allez :** ajouter un troisième job d'initialisation après ceux d'Odoo ; ajouter un CronJob nocturne ; déployer un compagnon nginx et le joindre depuis Odoo.
**Durée :** 35 min · **Coût :** faible (un petit pod supplémentaire) · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-9}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `initialization_jobs` | `[]` | Oui | Jobs Kubernetes ponctuels. **Une liste vide signifie « utiliser les jobs Odoo `nfs-init` et `db-init` ». Une liste non vide les REMPLACE.** Les champs incluent `needs_db` et `needs_secrets`. |
| `cron_jobs` | `[]` | Oui | CronJobs Kubernetes `<service>-<name>`. |
| `additional_services` | `[]` | Oui | Déploiements et Services compagnons `<service>-<name>` dans l'espace de noms. |

#### Étape 1 — Configurer {#step-1--configure-9}

Déclarez à nouveau les deux jobs d'Odoo, puis ajoutez le vôtre (configuration validée) :

```hcl
initialization_jobs = [
  { # Odoo's own NFS layout job — restated because a non-empty list replaces the defaults
    name = "nfs-init", image = "alpine:3.19", mount_nfs = true, execute_on_apply = true, needs_db = false
    command = ["/bin/sh", "-c"]
    args = ["mkdir -p /mnt/filestore /mnt/sessions /mnt/extra-addons && chown -R 101:101 /mnt/filestore /mnt/sessions /mnt/extra-addons && chmod -R 777 /mnt/filestore /mnt/sessions /mnt/extra-addons"]
  },
  { # Odoo's own database/role job — the script ships with the module
    name = "db-init", image = "postgres:15-alpine", script_path = "../Odoo_Common/scripts/db-init.sh"
    depends_on_jobs = ["nfs-init"], execute_on_apply = true, timeout_seconds = 600
    secret_env_vars = { DB_PASSWORD = "DB_PASSWORD", ROOT_PASSWORD = "ROOT_PASSWORD" }
  },
  { # your job, third in the chain
    name = "lab-probe", image = "alpine:3.19", mount_nfs = true, needs_db = false, needs_secrets = false
    depends_on_jobs = ["db-init"], execute_on_apply = true
    command = ["/bin/sh", "-c"], args = ["date -u > /mnt/lab-probe.marker && cat /mnt/lab-probe.marker"]
    cpu_limit = "500m", memory_limit = "256Mi"
  },
]
cron_jobs = [{
  name = "lab-cron", schedule = "17 3 * * *", image = "alpine:3.19", mount_nfs = true
  command = ["/bin/sh", "-c"], args = ["echo \"lab cron tick $(date -u)\""]
  cpu_limit = "500m", memory_limit = "256Mi"
}]
additional_services = [{
  name = "lab-sidecar", image = "nginx:alpine", port = 80, cpu_limit = "500m", memory_limit = "256Mi"
}]
```

#### Étape 2 — Appliquer {#step-2--apply-9}

Crée le job `lab-probe`, le CronJob, ainsi qu'un Deployment et un Service pour nginx. Un job n'est
recréé que lorsque sa définition ou son script est modifié. 5–10 minutes.

#### Étape 3 — Vérifier {#step-3--verify-9}

```bash
kubectl get jobs,cronjobs -n "$NS"
kubectl logs -n "$NS" job/"${SERVICE}-lab-probe"                   # a UTC timestamp
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- cat /mnt/lab-probe.marker

# Run the CronJob now instead of waiting for 03:17 UTC
kubectl create job -n "$NS" --from=cronjob/"${SERVICE}-lab-cron" lab-cron-manual
kubectl logs -n "$NS" job/lab-cron-manual                           # lab cron tick …

# The companion service, reached from inside Odoo by cluster DNS
kubectl get deploy,svc -n "$NS" | grep lab-sidecar
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- curl -s -o /dev/null -w "%{http_code}\n" "http://${SERVICE}-lab-sidecar:80/"   # 200
```

#### Pour aller plus loin {#explore-further-9}

- **L'ordonnancement concerne la création, pas l'achèvement.** `depends_on_jobs` régit l'ordre dans lequel les jobs sont *créés* ; un job
  n'attend la *fin* de son prédécesseur que si ce dernier comporte `execute_on_apply = true` (ce qui
  impose également l'attente à l'apply). Supprimez-le de `db-init` et comparez l'heure de démarrage des jobs
  (`kubectl get jobs -n "$NS" -o custom-columns=NAME:.metadata.name,START:.status.startTime`).
- Modifiez uniquement la commande de `lab-probe` et appliquez : seul ce Job est recréé.

#### Points d'attention {#watch-out-for-9}

- **Oublier de re-déclarer `nfs-init` et `db-init`** les supprime : un déploiement existant continue
  de fonctionner, mais une nouvelle base de données ou un nouveau partage NFS ne seraient jamais initialisés.
- Les chaînes de dépendance dépassant quatre niveaux sont refusées dès la planification.
- `needs_db = false` empêche l'injection du sidecar proxy Cloud SQL sur un job n'utilisant pas la
  base de données ; un job qui en a besoin avec cette option désactivée ne pourra pas s'y connecter.

#### Retour arrière {#revert-9}

Rétablissez les trois listes sur `[]` (les jobs par défaut d'Odoo sont restaurés). Supprimez le job manuel :
`kubectl delete job lab-cron-manual -n "$NS"`, et le marqueur : `kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- rm -f /mnt/lab-probe.marker`.

---

### Lab 12 — Intégration CI/CD et GitHub (Groupe 12) {#lab-12--cicd--github-integration-group-12}

> **Objectif :** appliquer Binary Authorization sur le cluster d'Odoo et comprendre comment une chaîne CI/CD GitHub et Cloud Deploy prendraient en charge la livraison des images.

**Vous allez :** activer Binary Authorization et consulter la politique du cluster et du projet ; passer en revue les paramètres CI/CD et Cloud Deploy.
**Durée :** 20 min (CI/CD en revue théorique) · **Coût :** faible · **Prérequis / configuration externe :** **[Configuration externe requise]** pour CI/CD — un dépôt GitHub avec un jeton d'accès personnel (`repo`, `admin:repo_hook`) ou l'installation de l'application GitHub Cloud Build. Vous pouvez réaliser la partie Binary Authorization sans cela.

#### Paramètres de ce groupe {#settings-in-this-group-10}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | Oui | Crée une connexion GitHub Cloud Build et un déclencheur qui compile et déploie à chaque push. |
| `github_repository_url` | `""` | Oui | URL du dépôt ; requise avec le déclencheur. |
| `github_token` | `""` | Oui | PAT utilisé pour créer la connexion (stocké dans Secret Manager après le premier apply). |
| `github_app_installation_id` | `""` | Oui | Identifiant d'installation de l'application GitHub Cloud Build (recommandé pour les organisations). |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Oui | Schéma de branche, fichiers inclus/ignorés, substitutions. |
| `enable_cloud_deploy` | `false` | Oui | Achemine les releases via un pipeline Cloud Deploy. Requiert le déclencheur. |
| `cloud_deploy_stages` | dev, staging, prod (prod requiert approbation) | Oui | Étapes du pipeline ; chaque étape reçoit son propre espace de noms `<service>-<stage>`. |
| `enable_binary_authorization` | `false` | **Non** | Impose la politique Binary Authorization du projet sur le cluster. |

#### Étape 1 — Configurer {#step-1--configure-10}

```hcl
enable_binary_authorization = true    # enforced on the cluster; the project policy stays ALWAYS_ALLOW
enable_cicd_trigger         = false   # [EXT] leave off unless you have the GitHub setup
enable_cloud_deploy         = false
```

#### Étape 2 — Appliquer {#step-2--apply-10}

La politique du projet est importée/mise à jour et le cluster l'applique. Odoo continue de fonctionner. 5–10 minutes.

#### Étape 3 — Vérifier {#step-3--verify-10}

```bash
gcloud container clusters describe "$CLUSTER" --region="$REGION" --project="$PROJECT" \
  --format="value(binaryAuthorization.evaluationMode)"          # PROJECT_SINGLETON_POLICY_ENFORCE
gcloud container binauthz policy export --project="$PROJECT" | grep -A2 defaultAdmissionRule   # ALWAYS_ALLOW
kubectl get pods -n "$NS"                                       # Odoo still Running
```

#### Pour aller plus loin (présentation CI/CD) {#explore-further-cicd-walkthrough}

1. Créez un fork ou un dépôt contenant votre Dockerfile Odoo et vos modules complémentaires.
2. Générez un PAT avec `repo` et `admin:repo_hook`, ou installez l'application GitHub Cloud Build et notez son
   identifiant d'installation.
3. Définissez `enable_cicd_trigger = true`, `github_repository_url`, `github_token` (premier apply uniquement),
   facultativement `github_app_installation_id` et `cicd_trigger_config.branch_pattern`. Appliquez, puis
   `gcloud builds triggers list --region="$REGION" --project="$PROJECT"` affichera le déclencheur, et tout push
   sur la branche lancera une compilation.
4. Cloud Deploy (`enable_cloud_deploy = true`) déplace la charge de travail dans des espaces de noms par environnement
   (`<service>-dev`, `<service>-staging`, `<service>-prod`), chacun avec sa propre base de données, et la
   Gateway dessert l'environnement `dev` jusqu'à votre promotion. Il s'agit d'une modification importante sur un Odoo en production — testez-la
   sur un déploiement distinct.

#### Points d'attention {#watch-out-for-10}

- Une politique plus stricte (exigeant des attestations) bloque toute image non signée, y compris les
  recompilations propres à Odoo et les images des jobs. Le module ne modifie pas les règles de politique du projet à votre place.
- `enable_cloud_deploy = true` sans `enable_cicd_trigger = true` est refusé dès la planification.

#### Retour arrière {#revert-10}

`enable_binary_authorization = false`.

---

### Lab 13 — Système de fichiers (NFS) (Groupe 13) {#lab-13--filesystem-nfs-group-13}

> **Objectif :** vérifier que le filestore d'Odoo, les sessions et `odoo.conf` résident sur le serveur NFS partagé et survivent au remplacement du pod.

**Vous allez :** inspecter le montage NFS et son répertoire dédié à l'application ; joindre un fichier dans Odoo ; remplacer le pod et retrouver la pièce jointe.
**Durée :** 20 min · **Coût :** aucun · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-11}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_nfs` | `true` | **Non** | Monte le serveur NFS de Services_GCP dans Odoo et ses jobs. Requis par Odoo. |
| `nfs_mount_path` | `/mnt` | Oui | Chemin de montage. Doit rester `/mnt` : la configuration, le filestore et les sessions d'Odoo y sont écrits. |
| `nfs_volume_name` | `nfs-data-volume` | Oui | Nom du volume dans la spécification du pod. |
| `nfs_instance_name` | `""` | Oui | Utilise une VM NFS spécifique au lieu d'en découvrir une. |
| `nfs_instance_base_name` | `app-nfs` | Oui | Nom de base si une VM NFS devait être créée de manière intégrée (inline, non avec Services_GCP). |

#### Étape 1 — Configurer {#step-1--configure-11}

Ce groupe s'explore idéalement avec les valeurs par défaut. Vous pouvez éventuellement renommer le volume pour observer la propagation
d'une modification sans risque :

```hcl
enable_nfs      = true
nfs_mount_path  = "/mnt"            # do not change for Odoo
nfs_volume_name = "odoo-nfs-data"   # cosmetic: the pod-spec volume name
```

#### Étape 2 — Appliquer {#step-2--apply-11}

Uniquement si vous avez modifié le nom du volume : le modèle de pod change et Odoo redémarre. 5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-11}

```bash
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- df -h /mnt /mnt/filestore   # <nfs-ip>:/share/<service>, NOT overlay
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- ls -la /mnt                  # odoo.conf filestore sessions extra-addons
kubectl get deploy "$SERVICE" -n "$NS" -o jsonpath='{.spec.template.spec.volumes[*].name}{"\n"}'
```

Vérifiez maintenant la persistance. Dans Odoo, ouvrez **Contacts**, choisissez un contact quelconque, et attachez un fichier dans le
chatter. Puis :

```bash
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- sh -c 'find /mnt/filestore -type f -newermt "-10 minutes" | head'
kubectl rollout restart deploy/"$SERVICE" -n "$NS"
kubectl rollout status deploy/"$SERVICE" -n "$NS" --timeout=900s
```

Rouvrez le contact dans le navigateur et téléchargez la pièce jointe : elle est toujours présente.

#### Pour aller plus loin {#explore-further-10}

- Consultez le partage depuis le serveur NFS : `gcloud compute instances list --project="$PROJECT" --filter="name~nfs"`.
- Observez `REDIS_HOST` et `NFS_SERVER_IP` dans le pod (`printenv NFS_SERVER_IP`) : la VM NFS héberge
  également Redis, utilisé au lab 15.

#### Points d'attention {#watch-out-for-11}

- Si `df` affiche `overlay` pour `/mnt/filestore`, le chemin de montage est incorrect et chaque pièce jointe est
  perdue au redémarrage du pod — même si le pod paraît en parfaite santé.
- `enable_nfs = false` n'est pas pris en charge pour Odoo ; cela supprimerait également l'hôte Redis par défaut.
- Chaque application dispose de son propre répertoire (`/share/<service>`) sur un serveur partagé ; ne pointez pas deux
  déploiements vers le même chemin.

#### Retour arrière {#revert-11}

`nfs_volume_name = "nfs-data-volume"`.

---

### Lab 14 — Cloud Storage et Artifact Registry (Groupe 14) {#lab-14--cloud-storage--artifact-registry-group-14}

> **Objectif :** ajouter un bucket, comprendre la fusion du bucket `addons` et du montage natifs du module avec les vôtres, et identifier les paramètres de rétention réellement actifs.

**Vous allez :** ajouter un bucket versionné ; redéclarer le montage des addons ; charger un fichier de module complémentaire via le bucket ; vérifier la rétention des images.
**Durée :** 25 min · **Coût :** faible (stockage bucket) · **Prérequis / configuration externe :** CMEK pour Artifact Registry nécessite une clé Cloud KMS — facultatif.

#### Paramètres de ce groupe {#settings-in-this-group-12}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `create_cloud_storage` | `true` | **Non** | Création effective des buckets. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | **Non** | Buckets `gcs-<service>-<suffix>`. Fusionnés par `name_suffix` avec le propre bucket `addons` du module. **Supprimer une entrée détruit ce bucket et son contenu.** |
| `gcs_volumes` | `[]` | Oui | Montages GCS FUSE. **Une liste non vide REMPLACE le montage par défaut `addons` d'Odoo** sur `/mnt/extra-addons`. |
| `manage_storage_kms_iam` | `false` | **Non** | Crée une clé CMEK et chiffre les buckets avec celle-ci. À définir au premier déploiement. |
| `enable_artifact_registry_cmek` | `false` | **Non** | CMEK pour Artifact Registry. |
| `max_images_to_retain` | `7` | Oui | Limite du nombre d'images — ne s'applique qu'à un dépôt créé directement par ce déploiement. |
| `delete_untagged_images` | `true` | Oui | Ne s'applique qu'à un dépôt créé directement par ce déploiement. |
| `image_retention_days` | `30` | Oui | Ne s'applique qu'à un dépôt créé directement par ce déploiement. |

#### Étape 1 — Configurer {#step-1--configure-12}

```hcl
storage_buckets = [
  { name_suffix = "data" },                                   # keep the default bucket
  { name_suffix = "addons", versioning_enabled = true,        # override settings of Odoo's addons bucket
    public_access_prevention = "enforced" },
]
gcs_volumes = [{                                              # restate Odoo's addons mount: a list REPLACES it
  name = "addons", mount_path = "/mnt/extra-addons", readonly = false
  mount_options = ["implicit-dirs", "metadata-cache-ttl-secs=60"]
}]
```

#### Étape 2 — Appliquer {#step-2--apply-12}

Le bucket `addons` est mis à jour sur place (versioning activé) ; le modèle de pod reste inchangé si le
montage correspond. 3–8 minutes.

#### Étape 3 — Vérifier {#step-3--verify-12}

```bash
gcloud storage buckets list --project="$PROJECT" --filter="name~${SERVICE}" --format="table(name,versioning_enabled)"
kubectl get deploy "$SERVICE" -n "$NS" -o yaml | grep -B2 -A6 'gcsfuse.csi.storage.gke.io' | grep -E 'bucketName|mountOptions|mountPath'

# Load a file through the bucket and read it from Odoo's addons path
echo "# lab" | gcloud storage cp - "gs://gcs-${SERVICE}-addons/lab_readme.txt"
sleep 70   # metadata cache is 60 s
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- ls -l /mnt/extra-addons/
```

Résultat attendu : les buckets `gcs-<service>-addons` (versioning `True`), `-data`, `-backups` ; le fichier visible
sous `/mnt/extra-addons`. Pour déployer un véritable module complémentaire, copiez son dossier dans le bucket, redémarrez Odoo,
puis accédez à **Apps → Update Apps List** (mode développeur) et installez-le.

#### Pour aller plus loin {#explore-further-11}

- Les écritures depuis l'intérieur du pod s'exécutent sous l'utilisateur odoo (uid 101). Si
  `kubectl exec … -- touch /mnt/extra-addons/x` est refusé, ajoutez `"uid=101", "gid=101"` à
  `mount_options` et appliquez.
- Rétention des images : `gcloud artifacts repositories list --project="$PROJECT"` — avec Services_GCP, le
  dépôt est partagé et sa politique de nettoyage relève de Services_GCP ; les trois champs de rétention
  ci-dessus n'ont donc aucun effet sur celui-ci.

#### Points d'attention {#watch-out-for-12}

- `storage_buckets` n'est **pas** update-safe : retirer `data` de la liste supprime
  `gcs-<service>-data` et tout ce qu'il contient (`force_destroy` a la valeur true par défaut).
- Un `gcs_volumes` vide conserve le montage d'Odoo ; une liste omettant `addons` démonte silencieusement votre
  répertoire de modules.
- `enable_artifact_registry_cmek` et `manage_storage_kms_iam` modifient le chiffrement — décidez-en dès le premier déploiement.

#### Retour arrière {#revert-12}

`storage_buckets = [{ name_suffix = "data" }]`, `gcs_volumes = []`. Le versioning sur le bucket des addons
est désactivé ; les anciennes versions d'objets ne seront plus conservées lors des écritures ultérieures. Supprimez le fichier de test :
`gcloud storage rm "gs://gcs-${SERVICE}-addons/lab_readme.txt"`.

---

### Lab 15 — Cache Redis (Groupe 15) {#lab-15--redis-cache-group-15}

> **Objectif :** connecter Odoo à Redis et confirmer que le paramètre a bien atteint la configuration d'Odoo, et pas seulement son environnement.

**Vous allez :** activer Redis à l'aide de l'instance co-hébergée sur le serveur NFS ; vérifier les variables d'environnement, `odoo.conf` et l'accessibilité réseau.
**Durée :** 15 min · **Coût :** aucun avec le Redis co-hébergé · **Prérequis :** aucun (Memorystore facultatif).

#### Paramètres de ce groupe {#settings-in-this-group-13}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_redis` | `false` | Oui | Injecte `ENABLE_REDIS`, `REDIS_HOST`, `REDIS_PORT` ; le script de démarrage d'Odoo inscrit `redis_host`/`redis_port` dans `odoo.conf` à chaque démarrage. |
| `redis_host` | `""` | Oui | Hôte Redis ; vide utilise le serveur NFS, qui co-héberge Redis. |
| `redis_port` | `6379` | Oui | Port Redis. |
| `redis_auth` | `""` | Oui | Mot de passe Redis, injecté sous forme de secret. Le renseigner empêche la plateforme d'injecter `REDIS_URL`. |

#### Étape 1 — Configurer {#step-1--configure-13}

```hcl
enable_redis = true
redis_host   = ""        # use the NFS VM's Redis
redis_port   = "6379"
```

#### Étape 2 — Appliquer {#step-2--apply-13}

Le modèle de pod change ; Odoo redémarre. 5–8 minutes.

#### Étape 3 — Vérifier {#step-3--verify-13}

```bash
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- sh -c 'echo ENABLE_REDIS=$ENABLE_REDIS REDIS_HOST=$REDIS_HOST NFS_SERVER_IP=$NFS_SERVER_IP'
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- grep -E '^redis_(host|port)' /mnt/odoo.conf
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- python3 -c \
  "import os,redis; print(redis.Redis(host=os.environ.get('REDIS_HOST') or os.environ['NFS_SERVER_IP'], port=int(os.environ.get('REDIS_PORT','6379')), socket_timeout=5).ping())"   # True
```

Résultat attendu : `REDIS_HOST` identique à `NFS_SERVER_IP` (ou vide, le script de démarrage se rabattant
sur cette valeur), `redis_host = <that IP>` dans `odoo.conf`, et la réponse `True` au ping — ce qui prouve
également que le chemin réseau est ouvert (avec la NetworkPolicy du lab 6 active, Redis dispose de sa propre règle d'autorisation).

#### Pour aller plus loin {#explore-further-12}

- Désactivez-le à nouveau et vérifiez que les lignes `redis_*` disparaissent de `odoo.conf` après le redémarrage —
  le script de démarrage les supprime aussi proprement qu'il les ajoute.
- Pointez `redis_host` vers une instance Memorystore dans le même VPC.

#### Points d'attention {#watch-out-for-13}

- Le module relie Redis à la configuration d'Odoo ; la version Odoo Community standard n'inclut pas de
  gestionnaire de sessions Redis, assurez-vous donc que le module complémentaire utilisé lit effectivement `redis_host`.
- `enable_redis = true` sans `redis_host` et avec NFS désactivé est refusé dès la planification.

#### Retour arrière {#revert-13}

`enable_redis = false`.

---

### Lab 16 — Backend de base de données (Groupe 16) {#lab-16--database-backend-group-16}

> **Objectif :** étendre la base PostgreSQL d'Odoo avec des extensions, exposer ses paramètres de connexion sous d'autres noms de variables d'environnement, et renouveler son mot de passe sans interrompre Odoo.

**Vous allez :** installer `pg_trgm` et `unaccent` ; ajouter des alias `ODOO_DB_*` ; activer le renouvellement automatique et exécuter une rotation complète.
**Durée :** 40 min · **Coût :** faible (un job Cloud Run et un déclencheur Eventarc pour la rotation) · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-14}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `database_type` | `POSTGRES` | Oui | Moteur de base de données. Odoo ne prend en charge que PostgreSQL — ne pas modifier. |
| `application_database_name` | `gkeappdb` | Oui | **Inerte** : la base réelle est nommée d'après le service. |
| `application_database_user` | `gkeappuser` | Oui | **Inerte** : l'utilisateur réel est nommé d'après le service. |
| `database_password_length` | `32` | **Non** | Longueur du mot de passe généré. À définir une seule fois au premier déploiement. |
| `enable_postgres_extensions` | `false` | Oui | Exécute le job `<service>-db-extensions`. |
| `postgres_extensions` | `[]` | Oui | Extensions à créer. |
| `enable_mysql_plugins` | `false` | Oui | MySQL uniquement — sans objet pour Odoo. |
| `mysql_plugins` | `[]` | Oui | MySQL uniquement. |
| `enable_auto_password_rotation` | `false` | Oui | Déploie un job Cloud Run de renouvellement et un déclencheur Eventarc, exécutés selon `secret_rotation_period` (lab 5). |
| `rotation_propagation_delay_sec` | `90` | Oui | Délai d'attente entre l'écriture de la nouvelle version du secret et la désactivation de l'ancienne. |
| `db_password_env_var_name` | `""` | Oui | Variable d'environnement supplémentaire pour le mot de passe de base. |
| `db_host_env_var_name` | `""` | Oui | Variable d'environnement supplémentaire pour l'hôte de base (`127.0.0.1` sur GKE — le proxy). |
| `db_user_env_var_name` | `""` | Oui | Variable d'environnement supplémentaire pour l'utilisateur de base. |
| `db_name_env_var_name` | `""` | Oui | Variable d'environnement supplémentaire pour le nom de la base. |
| `db_port_env_var_name` | `""` | Oui | Variable d'environnement supplémentaire pour le port de la base. |

#### Étape 1 — Configurer {#step-1--configure-14}

```hcl
database_type                  = "POSTGRES"
enable_postgres_extensions     = true
postgres_extensions            = ["pg_trgm", "unaccent"]   # Odoo uses both for fuzzy/accent-insensitive search
enable_auto_password_rotation  = true
rotation_propagation_delay_sec = 120
db_host_env_var_name           = "ODOO_DB_HOST_ALIAS"
db_port_env_var_name           = "ODOO_DB_PORT_ALIAS"
db_user_env_var_name           = "ODOO_DB_USER_ALIAS"
db_password_env_var_name       = "ODOO_DB_PASSWORD_ALIAS"
db_name_env_var_name           = "ODOO_DB_NAME_ALIAS"
```

#### Étape 2 — Appliquer {#step-2--apply-14}

Crée le job d'extensions, le job de rotation `<service>-pw-rotator`, le déclencheur Eventarc
`<service>-pw-rot-trigger`, et redémarre Odoo avec les variables d'environnement alias. 8–15 minutes.

#### Étape 3 — Vérifier {#step-3--verify-14}

```bash
# Extensions, checked from inside Odoo through the proxy
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- bash -c \
  'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select extname from pg_extension order by 1"'
# Aliases equal the standard variables
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- sh -c 'echo "$DB_HOST=$ODOO_DB_HOST_ALIAS $DB_NAME=$ODOO_DB_NAME_ALIAS $DB_USER=$ODOO_DB_USER_ALIAS"'
# Rotation plumbing
gcloud run jobs list --region="$REGION" --project="$PROJECT" --filter="metadata.name~${SERVICE}-pw-rotator"
gcloud eventarc triggers list --location="$REGION" --project="$PROJECT" --filter="name~${SERVICE}"
```

Exécutez maintenant une rotation complète :

```bash
DB_SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~${SERVICE}" --format="value(name)" \
  | grep -v -e master-password -e github -e rotation | head -1)
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --limit=3
gcloud run jobs execute "${SERVICE}-pw-rotator" --region="$REGION" --project="$PROJECT" --wait
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --limit=3     # a new ENABLED version, the old one DISABLED

# The Kubernetes Secret follows within ~2 minutes; compare fingerprints, not values
sleep 150
for s in $(kubectl get secret -n "$NS" -o name); do
  kubectl get "$s" -n "$NS" -o jsonpath='{.data.DB_PASSWORD}' 2>/dev/null | base64 -d | sha256sum | sed "s|-|$s|"; done | grep -v e3b0c442
gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT" | sha256sum

# Restart Odoo so it reads the new password, then check it reconnects
kubectl rollout restart deploy/"$SERVICE" -n "$NS" && kubectl rollout status deploy/"$SERVICE" -n "$NS" --timeout=900s
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"                          # 200
```

Le script de démarrage d'Odoo réécrit `db_password` dans `/mnt/odoo.conf` depuis l'environnement à chaque
démarrage ; ainsi, après le redémarrage, Odoo se connecte avec le mot de passe renouvelé.

#### Pour aller plus loin {#explore-further-13}

- Observez la ligne de journal de redémarrage `Reconciled database connection settings in /mnt/odoo.conf.` avec
  `kubectl logs -n "$NS" deploy/"$SERVICE" -c "$APP" | head -40`.
- Testez `postgres_extensions = ["not_a_real_ext"]` et consultez le journal du job d'extensions pour voir l'échec
  clairement rapporté.

#### Points d'attention {#watch-out-for-14}

- **Redémarrer après une rotation.** Le pod en cours conserve le mot de passe avec lequel il a démarré ; dès que l'ancien
  mot de passe est désactivé, les nouvelles connexions à la base de données issues de ce pod peuvent échouer jusqu'à son redémarrage.
- **Ne modifiez pas `database_password_length` sur un déploiement en cours.** Cela écrit un nouveau mot de passe dans
  Secret Manager alors que la base de données conserve l'ancien, et l'ancienne version du secret est détruite —
  les connexions à la base échouent jusqu'à la réexécution du job de configuration de la base. La rotation (ci-dessus) constitue la
  méthode officielle pour renouveler le mot de passe.
- `application_database_name` / `application_database_user` ne changent rien ; la base de données et l'utilisateur
  portent systématiquement le nom du service (`printenv DB_NAME` indique le nom réel).
- `database_type = "NONE"` exigerait également `enable_cloudsql_volume = false` (règle de planification),
  et Odoo ne peut pas fonctionner sans PostgreSQL.

#### Retour arrière {#revert-14}

`enable_postgres_extensions = false`, `postgres_extensions = []` (les extensions installées restent dans la
base — sans incidence), `enable_auto_password_rotation = false` (le job et le déclencheur sont supprimés ;
le mot de passe actuel reste valide), et réinitialisez les cinq `db_*_env_var_name` à `""`.

---

### Lab 17 — Sauvegarde et maintenance (Groupe 17) {#lab-17--backup--maintenance-group-17}

> **Objectif :** planifier les exports de base d'Odoo, en exécuter un à la demande, et comprendre l'effet d'une restauration au déploiement.

**Vous allez :** modifier le calendrier et la rétention des sauvegardes ; déclencher une sauvegarde immédiate et localiser le fichier ; découvrir le déroulement d'un import de sauvegarde.
**Durée :** 20 min (+20 min pour un import) · **Coût :** faible (stockage bucket) · **Prérequis / configuration externe :** un import nécessite un fichier de sauvegarde préalablement préparé ; il **écrase la base de données en production**.

#### Paramètres de ce groupe {#settings-in-this-group-15}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `backup_schedule` | `0 2 * * *` | Oui | Expression Cron (UTC) pour le CronJob `<service>-db-export`. |
| `backup_retention_days` | `7` | Oui | Règle de cycle de vie sur `gcs-<service>-backups` supprimant les sauvegardes plus anciennes. |
| `enable_backup_import` | `false` | **Non** | Exécute un job d'importation ponctuel durant la mise à jour. |
| `backup_source` | `gcs` | Oui | `gcs` (le bucket de sauvegardes de ce déploiement) ou `gdrive`. |
| `backup_file` | `backup.sql` | Oui | Nom de fichier simple dans le bucket de sauvegardes (ou identifiant de fichier Drive). |
| `backup_format` | `sql` | Oui | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip` ou `auto` (`auto` n'est pas autorisé avec `gdrive`). |

#### Étape 1 — Configurer {#step-1--configure-15}

```hcl
backup_schedule       = "30 3 * * *"   # 03:30 UTC daily
backup_retention_days = 14
enable_backup_import  = false          # keep off unless you mean to overwrite the database
```

#### Étape 2 — Appliquer {#step-2--apply-15}

La planification du CronJob et la règle de cycle de vie du bucket sont mises à jour sur place. 3–5 minutes.

#### Étape 3 — Vérifier {#step-3--verify-15}

```bash
kubectl get cronjob "${SERVICE}-db-export" -n "$NS" -o jsonpath='{.spec.schedule}{"\n"}'       # 30 3 * * *
gcloud storage buckets describe "gs://gcs-${SERVICE}-backups" --format="yaml(lifecycle_config)"   # age: 14

# Take a backup now
kubectl create job -n "$NS" --from=cronjob/"${SERVICE}-db-export" backup-now
kubectl wait --for=condition=complete job/backup-now -n "$NS" --timeout=900s
kubectl logs -n "$NS" job/backup-now -c "$(kubectl get job backup-now -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].name}')" | tail
gcloud storage ls -l "gs://gcs-${SERVICE}-backups/**" | tail -5
```

#### Pour aller plus loin (déroulement d'un import de sauvegarde) {#explore-further-backup-import-walkthrough}

1. Copiez d'abord une sauvegarde **hors** du projet (Drive, ou un bucket que vous conservez) — le bucket de sauvegardes est
   supprimé lors du démantèlement du déploiement.
2. Pour restaurer, déposez le fichier dans `gs://gcs-<service>-backups/` et définissez `enable_backup_import = true`,
   `backup_source = "gcs"`, `backup_file = "<file name only>"`, `backup_format` en conséquence. Depuis Drive,
   utilisez `backup_source = "gdrive"` et l'identifiant du fichier.
3. La mise à jour exécute un job d'importation (`kubectl get jobs -n "$NS" | grep -i import`) qui charge le dump
   **directement dans la base de données active**. Redémarrez Odoo par la suite et vérifiez vos données et pièces jointes — l'export
   ne concerne que la base de données ; les pièces jointes résident sur NFS (lab 13).
4. Rétablissez `enable_backup_import = false` pour éviter qu'une mise à jour ultérieure ne relance l'importation.

#### Points d'attention {#watch-out-for-15}

- Une importation écrase l'existant. Ne l'activez jamais sur un déploiement dont vous souhaitez conserver les données,
  sauf si la sauvegarde est plus récente.
- `backup_file` correspond à un simple nom de fichier, et non à une URI `gs://`.
- `backup_schedule` est exprimé en UTC.

#### Retour arrière {#revert-15}

`backup_schedule = "0 2 * * *"`, `backup_retention_days = 7` ; `kubectl delete job backup-now -n "$NS"`.

---

### Lab 18 — Scripts SQL personnalisés (Groupe 18) {#lab-18--custom-sql-scripts-group-18}

> **Objectif :** exécuter vos propres scripts SQL depuis un bucket Cloud Storage sur la base d'Odoo dans le cadre d'une mise à jour.

**Vous allez :** préparer deux scripts ordonnés ; les exécuter sous l'utilisateur applicatif ; consulter le journal du job et vérifier le résultat.
**Durée :** 20 min · **Coût :** aucun · **Prérequis / configuration externe :** un bucket créé par vos soins (ci-dessous).

#### Paramètres de ce groupe {#settings-in-this-group-16}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | **Non** | Exécute le job `<service>-custom-sql-scripts`. |
| `custom_sql_scripts_bucket` | `""` | Oui | Bucket contenant les scripts ; le module accorde un droit de lecture à son identité de charge de travail (workload identity). |
| `custom_sql_scripts_path` | `""` | Oui | Préfixe ; chaque fichier `.sql` situé dessous est exécuté dans l'ordre lexicographique. |
| `custom_sql_scripts_use_root` | `false` | Oui | Exécution sous le superutilisateur `postgres` au lieu de l'utilisateur de l'application. |

#### Étape 1 — Configurer {#step-1--configure-16}

Préparez les scripts. Utilisez votre propre table — ne modifiez jamais directement les tables internes d'Odoo en SQL :

```bash
export SQL_BUCKET="<your-bucket>"
gcloud storage buckets create "gs://${SQL_BUCKET}" --project="$PROJECT" --location="$REGION" --uniform-bucket-level-access
printf 'CREATE TABLE IF NOT EXISTS lab_marker (id serial primary key, note text, at timestamptz default now());\n' \
  | gcloud storage cp - "gs://${SQL_BUCKET}/sql/01-create.sql"
printf "INSERT INTO lab_marker (note) VALUES ('group 18 ran');\n" \
  | gcloud storage cp - "gs://${SQL_BUCKET}/sql/02-insert.sql"
```

```hcl
enable_custom_sql_scripts   = true
custom_sql_scripts_bucket   = "<your-bucket>"
custom_sql_scripts_path     = "sql"
custom_sql_scripts_use_root = false   # app user owns the new table, so Odoo's user can read it
```

#### Étape 2 — Appliquer {#step-2--apply-16}

Crée une liaison IAM sur votre bucket, une ConfigMap et le job. 5–8 minutes.

#### Étape 3 — Vérifier {#step-3--verify-16}

```bash
kubectl logs -n "$NS" job/"${SERVICE}-custom-sql-scripts" --all-containers | grep -E 'Found|\.sql|CREATE|INSERT|as application'
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- bash -c \
  'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select note, at from lab_marker"'
```

Résultat attendu : `Found 2 SQL script(s)`, `01-create.sql` avant `02-insert.sql`, et une ligne `group 18 ran`.

#### Pour aller plus loin {#explore-further-14}

- Renommez `02-insert.sql` en `00-insert.sql` avec un nouveau nom de table et constatez l'échec immédiat — preuve
  du respect de l'ordonnancement.
- Le simple téléversement d'un nouveau contenu de script ne relance **pas** le job à lui seul ; il se réexécute lorsque
  la définition du job change (par exemple un `custom_sql_scripts_path` ou un bucket différent). Concevez des scripts
  pouvant être exécutés plusieurs fois sans risque (idempotents).

#### Points d'attention {#watch-out-for-16}

- `custom_sql_scripts_use_root = true` s'exécute en tant que superutilisateur ; les objets créés appartiendront à
  `postgres`, et l'utilisateur standard d'Odoo pourrait ne pas être en mesure de les manipuler.

#### Retour arrière {#revert-16}

Rétablissez `enable_custom_sql_scripts = false` et les trois autres champs à leurs valeurs par défaut. Supprimez la table
(`... -c "drop table lab_marker"` avec la même commande `psql`) et supprimez le bucket lors de la tâche 6.

---

### Lab 19 — Domaine personnalisé, IP statique et réseau (Groupe 19) {#lab-19--custom-domain-static-ip--networking-group-19}

> **Objectif :** diffuser Odoo sur le nom d'hôte de votre choix, avec un certificat géré par Google, sur une IP statique nommée.

**Vous allez :** nommer l'IP statique de la Gateway ; y faire pointer un nom d'hôte ; observer l'activation du certificat ; identifier les paramètres réseau inertes.
**Durée :** 30 min (les certificats nécessitent 10–60 min) · **Coût :** aucun (l'adresse existe déjà) · **Prérequis / configuration externe :** un nom DNS sous votre contrôle, ou utilisez un nom `nip.io` comme indiqué ci-dessous.

#### Paramètres de ce groupe {#settings-in-this-group-17}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_custom_domain` | `true` | **Non** | Utilise l'équilibreur de charge Gateway API avec HTTPS. `false` supprime la Gateway (sauf si Cloud Armor ou le CDN l'exigent) pour ne laisser que l'IP HTTP simple du Service. |
| `application_domains` | `[]` | **Non** | Noms d'hôtes à desservir ; un certificat géré par nom. Vide → un nom d'hôte `<ip-with-dashes>.nip.io`. |
| `reserve_static_ip` | `true` | Oui | Conserve une adresse réservée stable et le nom d'hôte `nip.io` associé. |
| `static_ip_name` | `""` | **Non** | Nom de l'adresse globale réservée ; vide → `<service>-gateway-ip`. **Le modifier crée une nouvelle adresse — l'IP de la Gateway change.** |
| `network_tags` | `["nfsserver"]` | Oui | **Inerte** : aucune ressource ne l'exploite ; NFS fonctionne sans lui. |

#### Étape 1 — Configurer {#step-1--configure-17}

Deux mises à jour sont nécessaires, la nouvelle adresse IP n'étant connue qu'à l'issue de la première.

Mise à jour 1 — nommer l'adresse :

```hcl
static_ip_name = "odoo-lab-ip"     # a new global address; the Gateway moves to it
```

Une fois appliquée, récupérez la nouvelle IP et composez un nom d'hôte associé (ou créez un enregistrement `A` dans votre propre DNS) :

```bash
gcloud compute addresses describe odoo-lab-ip --global --project="$PROJECT" --format="value(address)"
```

Mise à jour 2 — desservir un hôte nommé :

```hcl
enable_custom_domain = true
application_domains  = ["<new-ip-with-dashes>.nip.io"]   # or ["erp.example.com"] with an A record to the IP
reserve_static_ip    = true
```

#### Étape 2 — Appliquer {#step-2--apply-17}

La mise à jour 1 crée une nouvelle adresse globale et réoriente la Gateway (l'ancien nom d'hôte
cesse de fonctionner pendant quelques minutes). La mise à jour 2 crée un certificat, une entrée de mappage de certificats et met à jour
la ressource HTTPRoute. 5–10 minutes pour chacune, plus le délai de provisionnement du certificat.

#### Étape 3 — Vérifier {#step-3--verify-17}

```bash
kubectl get gateway -n "$NS" -o jsonpath='{.items[0].status.addresses[0].value}{"\n"}'
kubectl get httproute -n "$NS" -o jsonpath='{.items[0].spec.hostnames}{"\n"}'
gcloud certificate-manager certificates list --project="$PROJECT" --filter="name~${SERVICE}" \
  --format="table(name,managed.domains,managed.state)"        # ACTIVE when ready
export HOST="<your-new-host>"; export URL="https://${HOST}"
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"   # 200 once the certificate is ACTIVE
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- printenv GKE_SERVICE_URL   # the URL Odoo is told it lives at
```

#### Pour aller plus loin {#explore-further-15}

- Dans Odoo, **Settings → Technical → System Parameters** : `web.base.url` adopte l'URL utilisée pour ouvrir
  Odoo lorsqu'un administrateur est connecté. Définissez-la explicitement, et verrouillez-la avec
  `web.base.url.freeze = True`, afin que les liens envoyés par e-mail exploitent votre nouveau nom d'hôte.

#### Points d'attention {#watch-out-for-17}

- `static_ip_name` et `application_domains` ne sont pas modifiables sans risque (not update-safe) : l'adresse et les certificats sont
  remplacés, et les favoris, enregistrements DNS et tests de disponibilité sur l'ancien hôte cessent de répondre.
- Le certificat d'un domaine personnalisé réel reste à l'état `PROVISIONING` tant que son enregistrement DNS `A` ne pointe pas vers l'IP de la Gateway.
- Utilisez la forme avec **tirets** de `nip.io` (`1-2-3-4.nip.io`) — c'est le nom couvert par le certificat.

#### Retour arrière {#revert-17}

`application_domains = []` et `static_ip_name = ""` (la Gateway reçoit une adresse `<service>-gateway-ip`
nouvellement réservée — l'IP change à nouveau ; recalculez `HOST` comme à l'étape 4 de la tâche 1).
Supprimez tout enregistrement DNS que vous avez créé.

---

### Lab 20 — Identity-Aware Proxy (IAP) (Groupe 20) {#lab-20--identity-aware-proxy-iap-group-20}

> **Objectif :** exiger une authentification Google avant que quiconque ne puisse accéder à la page de connexion d'Odoo.

**Vous allez :** créer un client OAuth ; activer IAP sur le backend de la Gateway ; constater la redirection des requêtes non authentifiées vers Google.
**Durée :** 30 min · **Coût :** aucun · **Prérequis / configuration externe :** **[Configuration externe requise]** — un écran de consentement OAuth et un client OAuth 2.0 (via la Console uniquement). Vous pouvez lire ce lab sans cela ; les vérifications à la planification présentées dans « Pour aller plus loin » fonctionnent sans client.

#### Paramètres de ce groupe {#settings-in-this-group-18}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_iap` | `false` | Oui | Active IAP sur le backend de la Gateway. |
| `iap_authorized_users` | `[]` | Oui | Utilisateurs autorisés à passer, ex. `user:alice@example.com`. |
| `iap_authorized_groups` | `[]` | Oui | Groupes autorisés, ex. `group:erp@example.com`. |
| `iap_oauth_client_id` | `""` | Oui | Identifiant du client OAuth (sensible). |
| `iap_oauth_client_secret` | `""` | Oui | Secret du client OAuth (sensible). |
| `iap_support_email` | `""` | Oui | E-mail d'assistance pour l'écran de consentement. |

#### Étape 1 — Configurer {#step-1--configure-18}

Configuration externe : dans la Console, rendez-vous dans **Google Auth Platform → Branding** (écran de consentement OAuth) — créez-le
si le projet n'en possède pas ; puis **Clients → Create client → Web application**. Ajoutez l'URI de redirection
autorisée `https://iap.googleapis.com/v1/oauth/clientIds/<CLIENT_ID>:handleRedirect` après la
création du client. Relevez l'identifiant et le secret du client.

```hcl
enable_iap              = true
iap_authorized_users    = ["user:<your-email>"]
iap_authorized_groups   = []
iap_oauth_client_id     = "<client-id>.apps.googleusercontent.com"
iap_oauth_client_secret = "<client-secret>"
iap_support_email       = "<your-email>"
enable_cdn              = false     # IAP and CDN cannot be combined
```

#### Étape 2 — Appliquer {#step-2--apply-18}

Crée un Secret Kubernetes `<service>-iap-oauth`, met à jour la ressource `GCPBackendPolicy`, et accorde les accès
IAP. 5–10 minutes, plus quelques minutes pour que l'activation d'IAP soit effective.

#### Étape 3 — Vérifier {#step-3--verify-18}

```bash
kubectl get gcpbackendpolicy -n "$NS" -o yaml | grep -A4 'iap:'          # enabled: true
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "${URL}/web/login"
# expect: 302 https://accounts.google.com/...
```

Ouvrez `$URL` dans une fenêtre de navigation privée : la mire de connexion Google s'affiche en premier ; une fois authentifié avec un
compte autorisé, la page de connexion d'Odoo apparaît (IAP se place devant la connexion Odoo, et ne la remplace pas).

#### Pour aller plus loin {#explore-further-16}

- **Garde-fous à la planification (sans client OAuth requis) :** définissez `enable_iap = true` avec un identifiant de client vide —
  refusé ; sans utilisateur ni groupe autorisé — refusé ; sans e-mail d'assistance — refusé ; conjointement
  avec `enable_cdn = true` — refusé.
- Connectez-vous avec un compte non autorisé : IAP affiche une page de refus d'accès.

#### Points d'attention {#watch-out-for-18}

- **IAP ne protège que le trafic transitant par la Gateway.** Lorsque la Gateway est active, le Service Odoo est de type
  `ClusterIP` et ne possède pas d'IP externe, rendant impossible tout contournement d'IAP. `service_type = "NodePort"`
  n'est pas converti et ne traverse pas IAP — conservez la valeur par défaut. Vérifiez qu'aucune seconde
  adresse n'est exposée :

  ```bash
  kubectl get svc "$SERVICE" -n "$NS"     # TYPE ClusterIP, EXTERNAL-IP <none>
  ```
- Le test de disponibilité (lab 10) ne pouvant s'authentifier, il signalera le service en échec si IAP est actif.
- Les applications mobiles d'Odoo et les intégrations externes (XML-RPC/JSON-RPC depuis l'extérieur) ne peuvent pas franchir IAP.
- Les autorisations d'accès IAP s'appliquent à l'échelle du projet : toute autre application du projet exploitant également IAP les partagera.

#### Retour arrière {#revert-18}

`enable_iap = false` et effacez les cinq autres champs. Supprimez le client OAuth dans la Console si vous
n'en avez plus l'usage.

---

### Lab 21 — Cloud Armor (Groupe 21) {#lab-21--cloud-armor-group-21}

> **Objectif :** déployer un pare-feu d'application web (WAF) devant Odoo et observer le blocage des requêtes suspectes.

**Vous allez :** associer une politique Cloud Armor avec une liste verte d'administrateurs ; tester des motifs d'injection SQL et XSS ; comprendre la portée réelle de `enable_cdn`.
**Durée :** 25 min (+5–10 min de propagation) · **Coût :** **Oui** — Cloud Armor facture par politique et par règle chaque mois, plus un coût par requête · **Prérequis :** aucun.

#### Paramètres de ce groupe {#settings-in-this-group-19}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_cloud_armor` | `false` | **Non** | Crée `<service>-waf-policy` et l'associe au backend de la Gateway (impose le passage par la Gateway). |
| `admin_ip_ranges` | `[]` | Oui | Blocs CIDR bénéficiant d'une règle d'autorisation explicite prioritaire sur les règles WAF. |
| `cloud_armor_policy_name` | `default-waf-policy` | Oui | **Non appliqué** : le module crée et associe systématiquement sa propre règle `<service>-waf-policy`, et n'en associe aucune si Cloud Armor est désactivé. |
| `enable_cdn` | `false` | Oui | Impose uniquement le passage par la Gateway ; le module ne peut pas activer Cloud CDN à lui seul. Exclut IAP. |

#### Étape 1 — Configurer {#step-1--configure-19}

```hcl
enable_cloud_armor = true
admin_ip_ranges    = ["203.0.113.0/24"]   # replace with your office/VPN range
enable_cdn         = false
```

#### Étape 2 — Appliquer {#step-2--apply-19}

Crée la politique de sécurité et met à jour la ressource `GCPBackendPolicy`. 5–8 minutes, puis **5–10 minutes**
supplémentaires avant que les règles ne soient effectives en périphérie (edge).

#### Étape 3 — Vérifier {#step-3--verify-19}

```bash
gcloud compute security-policies describe "${SERVICE}-waf-policy" --project="$PROJECT" \
  --format="table(rules.priority,rules.action,rules.description)"
kubectl get gcpbackendpolicy -n "$NS" -o yaml | grep securityPolicy

# After ~5-10 minutes:
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"                                  # 200
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/login?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E"  # 403
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/login?id=1%27%20OR%20%271%27%3D%271"          # 403
```

#### Pour aller plus loin {#explore-further-17}

- **CDN :** définissez `enable_cdn = true` (avec Cloud Armor activé ou non), appliquez, et examinez le service
  backend : `gcloud compute backend-services list --global --project="$PROJECT" --format="table(name,enableCDN,securityPolicy)"`.
  `enableCDN` reste à `False` — le module prépare le routage de la Gateway, mais le CDN doit être activé
  en dehors du module.
- Consultez **Network Security → Cloud Armor policies → `<service>-waf-policy` → Logs** pour visualiser les
  requêtes bloquées.

#### Points d'attention {#watch-out-for-19}

- **Cloud Armor ne filtre que le flux passant par la Gateway.** Avec la Gateway active, le Service Odoo
  est en `ClusterIP` sans IP externe, garantissant le filtrage de l'ensemble des requêtes. Les déploiements
  mis à jour avant l'introduction de ce comportement perdront leur ancienne IP de Service à la prochaine mise à jour — ce
  comportement est normal et prévu.
- Les requêtes de test renvoient `200` durant les premières minutes — cela est dû au délai de propagation et n'indique pas une anomalie de configuration.
- Les formulaires standards d'Odoo peuvent déclencher les règles WAF génériques lorsque les utilisateurs y collent du code HTML ; consultez les
  journaux de la politique avant de chercher une défaillance dans Odoo.
- `enable_cloud_armor = true` combiné avec `enable_custom_domain = false` et un Service qui n'est pas de type LoadBalancer est
  refusé dès la planification.

#### Retour arrière {#revert-19}

`enable_cloud_armor = false`, `admin_ip_ranges = []`, `enable_cdn = false`. La politique est supprimée.

---

### Lab 22 — VPC Service Controls et journalisation d'audit (Groupe 22) {#lab-22--vpc-service-controls--audit-logging-group-22}

> **Objectif :** activer les journaux Cloud Audit détaillés pour le projet et comprendre la gestion par le module d'un périmètre VPC Service Controls qu'il ne peut pas créer.

**Vous allez :** activer la journalisation d'audit et consulter la configuration d'audit du projet ; demander l'activation de VPC-SC en mode simulation (dry-run) et analyser les rapports du module.
**Durée :** 15 min · **Coût :** faible (volume de journaux supplémentaire) · **Prérequis / configuration externe :** **[Configuration externe requise]** pour VPC-SC — une organisation, les autorisations Access Context Manager, et un projet directement rattaché à l'organisation (ou `organization_id` configuré). Ces paramètres sont masqués dans les projets gérés par RAD.

#### Paramètres de ce groupe {#settings-in-this-group-20}

| Variable | Valeur par défaut | Update-safe | Ce qu'elle fait |
|---|---|---|---|
| `enable_vpc_sc` | `false` | Oui | Crée un périmètre VPC-SC autour des API du projet. |
| `vpc_cidr_ranges` | `[]` | Oui | Blocs CIDR pour le niveau d'accès réseau du périmètre ; vide = sous-réseaux découverts. |
| `vpc_sc_dry_run` | `true` | Oui | Journalise uniquement les infractions. |
| `organization_id` | `""` | Oui | Nécessaire lorsque le projet réside dans un dossier (folder). |
| `enable_audit_logging` | `false` | **Non** | Ajoute les journaux d'audit DATA_READ, DATA_WRITE et ADMIN_READ. |

#### Étape 1 — Configurer {#step-1--configure-20}

```hcl
enable_audit_logging = true
enable_vpc_sc        = true    # [EXT] — only takes effect with an organisation behind the project
vpc_sc_dry_run       = true    # never start in enforced mode
```

#### Étape 2 — Appliquer {#step-2--apply-20}

Les configurations d'audit sont ajoutées à la politique IAM du projet. Le périmètre VPC-SC est créé — ou, lorsque l'organisation
est introuvable (par exemple un projet imbriqué dans un dossier sans `organization_id` défini), l'étape est ignorée avec
un avertissement dans le journal de l'apply. 3–6 minutes.

#### Étape 3 — Vérifier {#step-3--verify-20}

```bash
gcloud projects get-iam-policy "$PROJECT" --format=json | python3 -c \
  "import json,sys; print([c['service'] for c in json.load(sys.stdin).get('auditConfigs',[])])"
```

Consultez la section **Outputs** du déploiement : `audit_logging_enabled = true` ; `vpc_sc_enabled` indique
si un périmètre a réellement été créé (`false` s'il a été ignoré), avec `vpc_sc_perimeter_name`
et `vpc_sc_dry_run_mode`. Dans l'explorateur de journaux (Logs Explorer), `logName:"cloudaudit.googleapis.com%2Fdata_access"`
renvoie désormais des entrées.

#### Pour aller plus loin {#explore-further-18}

- Si vous disposez d'une organisation, visualisez le périmètre en mode simulation dans **Security → VPC Service
  Controls** et analysez ses journaux d'infraction avant d'envisager d'activer `vpc_sc_dry_run = false`.

#### Points d'attention {#watch-out-for-20}

- La configuration d'audit s'applique à **l'échelle du projet** : toute autre application qui la gère partage
  le même réglage, et la désactiver ici la désactive pour l'ensemble du projet.
- Un périmètre imposé de manière stricte (enforced) peut bloquer les appels de déploiement et de compilation propres à la plateforme ; restez en mode simulation (dry-run).

#### Retour arrière {#revert-20}

`enable_audit_logging = false`, `enable_vpc_sc = false`.

---

## Tâche 3 — Exploiter et maintenir en service (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter la charge de travail :**

   ```bash
   kubectl get deploy,sts,pods,hpa,vpa,pvc,pdb -n "$NS"
   kubectl describe deploy "$SERVICE" -n "$NS" | sed -n '/Containers:/,/Volumes:/p'
   kubectl top pod -n "$NS"
   ```

2. **Ajuster l'échelle** en modifiant `min_instance_count` / `max_instance_count` et en cliquant sur **Update** sur la
   page des détails du déploiement (Lab 4). Le module est propriétaire de la spécification de la charge de travail — un `kubectl scale` manuel est
   écrasé par le HPA. Conservez au moins un pod : les actions planifiées d'Odoo s'exécutent à l'intérieur.

3. **Mettre à jour l'application.** Modifier `application_version` (ou réexécuter **Update** pour récupérer une
   version nightly plus récente de la même série) reconstruit l'image et remplace le pod selon la
   stratégie `Recreate` — une brève interruption de service. Faites-le en dehors des heures ouvrées et effectuez une sauvegarde au préalable (étape 6).

4. **Redémarrer Odoo** sans rien changer (par exemple après une rotation de mot de passe, Lab 16) :

   ```bash
   kubectl rollout restart deploy/"$SERVICE" -n "$NS"
   kubectl rollout status deploy/"$SERVICE" -n "$NS" --timeout=900s
   ```

5. **Secrets, stockage et jobs :**

   ```bash
   kubectl get secretsync,secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~${SERVICE} OR name~${PREFIX}-${APP}"
   kubectl get jobs,cronjobs -n "$NS"
   kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- du -sh /mnt/filestore    # filestore size on NFS
   ```

6. **Session de base de données et sauvegarde à la demande.** L'instance Cloud SQL dispose uniquement d'une adresse IP privée ;
   connectez-vous donc depuis l'intérieur du pod via le proxy plutôt qu'avec `gcloud sql connect` :

   ```bash
   kubectl exec -it -n "$NS" deploy/"$SERVICE" -c "$APP" -- bash -c \
     'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME"'
   # Then e.g.:  select login, active from res_users;   \q to quit

   kubectl create job -n "$NS" --from=cronjob/"${SERVICE}-db-export" "backup-$(date +%s)"
   ```

7. **Maintenance courante d'Odoo.** Veillez à modifier le mot de passe administrateur (Tâche 2), attribuez aux collaborateurs leurs propres
   utilisateurs plutôt que de partager `admin`, et passez en revue **Settings → Technical → Scheduled Actions** —
   elles s'exécutent dans le pod Odoo et s'interrompent donc si le nombre de pods tombe à zéro.

---

## Tâche 4 — Observer : Journaux et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Emplacement des journaux.** Le fichier généré `odoo.conf` définit `logfile = /var/log/odoo/odoo.log`, ainsi :
   - `kubectl logs` et Cloud Logging affichent le script de démarrage du module (génération de configuration,
     messages de réconciliation, vérification d'écriture NFS, `Starting Odoo server...`) ainsi que les sidecars.
   - Le journal propre aux requêtes et erreurs d'Odoo se trouve dans le fichier à l'intérieur du conteneur, et est perdu lors du
     remplacement du pod.

   ```bash
   kubectl logs -n "$NS" deploy/"$SERVICE" -c "$APP" --tail=50
   kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- tail -n 100 /var/log/odoo/odoo.log
   kubectl logs -n "$NS" deploy/"$SERVICE" -c cloud-sql-proxy --tail=20 2>/dev/null \
     || kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.containers[*].name}{"\n"}'
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

   > **Facultatif — envoyer les journaux d'Odoo vers Cloud Logging.** Le module n'écrit `/mnt/odoo.conf` que lorsqu'il
   > n'existe pas déjà, et lors des démarrages ultérieurs, il ne réécrit que les lignes relatives à la base de données, au mot de passe maître et à Redis.
   > La suppression de la ligne `logfile` persiste donc, et Odoo journalise alors vers la sortie standard :
   > `kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- sed -i '/^logfile[[:space:]]*=/d' /mnt/odoo.conf`
   > suivi d'un redémarrage (Tâche 3, étape 4). Il s'agit d'une modification manuelle apportée à un fichier sur le partage — notez-la
   > dans votre runbook.

2. **Surveillance.** Ouvrez **Kubernetes Engine → Workloads → `<service>`** pour consulter l'utilisation du processeur, de la mémoire et les
   compteurs de redémarrages, et **SQL → votre instance → Monitoring** pour les connexions et le processeur. Une fois le Lab 2 et le Lab 10
   appliqués, consultez **Monitoring → Uptime checks** et **Alerting → Policies** (`<service>-…`) :

   ```bash
   gcloud monitoring uptime list-configs --project="$PROJECT" --filter="displayName~${SERVICE}" --format="value(displayName)"
   kubectl get events -n "$NS" --sort-by=.lastTimestamp | tail -20
   ```

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques éprouvées pour résoudre les modes de défaillance les plus probables, y compris ceux identifiés lors du
test de chaque groupe de ce module sur un déploiement réel.

- **Pod non Ready / CrashLoopBackOff** — lisez les événements, puis les journaux du conteneur précédent et le fichier
  journal d'Odoo :
  ```bash
  POD=$(kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].metadata.name}')
  kubectl describe pod "$POD" -n "$NS" | sed -n '/Events:/,$p'
  kubectl logs "$POD" -n "$NS" -c "$APP" --previous | tail -40
  ```
  `ERROR: Cannot write to /mnt/filestore` → le montage NFS ou `nfs-init` est incorrect (Lab 13, Lab 11).
  `exitCode 137` avec `reason: Error` correspond à un arrêt déclenché par une sonde, et non par un manque de mémoire (`OOMKilled`).
- **Test de santé différent de 200 au premier démarrage.** Le premier démarrage installe le module de base ; attendez que la
  sonde de démarrage (jusqu'à 9 minutes par défaut) réponde et que chaque job d'initialisation soit `Complete` :
  `kubectl get jobs -n "$NS"`.
- **La Gateway renvoie une erreur 503 alors que le pod est Ready.** Le test de santé du répartiteur de charge nécessite un code
  `200` exact sur le chemin de la sonde. Vérifiez que le chemin est toujours `/web/health` (Lab 10), testez-le directement sur le pod —
  `kubectl exec -n "$NS" "$POD" -c "$APP" -- curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8069/web/health` —
  et comptez 5 à 15 minutes après une modification de Gateway ou de certificat.
- **« password authentication failed » après un changement de mot de passe.** Vérifiez la concordance des trois copies
  (empreintes, comme dans le Lab 16) : la dernière version de Secret Manager, le Secret Kubernetes et le fichier
  `DB_PASSWORD` du pod. Si le Secret Kubernetes tarde à se synchroniser, attendez deux minutes ; puis redémarrez Odoo afin qu'il réécrive
  `odoo.conf`. Si `database_password_length` a été modifié sur un déploiement en cours d'exécution, la base de données
  conserve encore l'ancien mot de passe — activez la rotation (Lab 16) et exécutez le job de rotation pour définir un nouveau
  mot de passe des deux côtés.
- **Odoo ne peut pas joindre la base de données ou Redis après l'activation de la segmentation réseau.** Inspectez la
  NetworkPolicy (Lab 6) et confirmez que les règles de sortie (egress) existent pour l'adresse IP de Cloud SQL et celle de Redis/NFS ;
  testez avec les commandes `psql select 1` et de ping Redis issues des Labs 6 et 15.
- **Le job d'initialisation a échoué ou ne s'est jamais exécuté :**
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/"${SERVICE}-db-init" --all-containers | tail -30
  kubectl logs -n "$NS" job/"${SERVICE}-nfs-init" | tail
  ```
  Si vous avez défini `initialization_jobs`, vérifiez que `nfs-init` et `db-init` figurent toujours dans la liste (Lab 11).
- **Un paramètre « n'a rien fait ».** Consultez le tableau du lab : `container_resources`, `stateful_fs_group`,
  `service_annotations` et `service_labels` ne s'appliquent qu'à la création ; `network_tags`,
  `application_database_name`/`_user` et `cloud_armor_policy_name` sont inertes.
- **Mise à jour refusée lors de la phase de plan.** Lisez le message — il indique les paramètres en conflit (VPA avec
  `min_instance_count` supérieur à 1, IAP sans client OAuth, un PVC sur le chemin NFS, un quota de mémoire
  sous forme de simple nombre, Cloud Deploy sans déclencheur…). Aucune modification n'a été appliquée.
- **Le premier déploiement d'un nouveau cluster signale des CRD manquantes.** La plateforme exécute automatiquement
  un second apply ; si vous avez déployé d'une autre manière, relancez un apply.
- **Pod en attente (Pending) / aucune adresse IP externe.** Vérifiez les événements pour détecter d'éventuels quotas dépassés (`exceeded quota` → Lab 8 ; quota SSD →
  utilisez le stockage `standard` au Lab 7) et `gcloud compute project-info describe --project="$PROJECT"`
  pour les quotas d'adresses.
- **Accès bloqué au compte administrateur d'Odoo.** Réinitialisez le mot de passe depuis le cluster à l'aide du
  shell Odoo (remplacez `new-strong-password`) :
  ```bash
  kubectl exec -it -n "$NS" deploy/"$SERVICE" -c "$APP" -- bash -c \
    'odoo shell -c /mnt/odoo.conf -d "$DB_NAME" --no-http' <<'PY'
  u = env.ref('base.user_admin'); u.password = 'new-strong-password'; env.cr.commit()
  PY
  ```

Consultez la section *Configuration Pitfalls* du Guide de configuration pour connaître les pièges spécifiques à chaque paramètre.

---

## Tâche 6 — Détruire l'environnement [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône de **Corbeille** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette option supprime le déploiement des registres de RAD **sans** détruire les ressources cloud (elle permet à RAD d'oublier le déploiement). Cela supprime l'ensemble des ressources créées par le module — la charge de travail et l'espace
de noms Kubernetes, la base de données Cloud SQL, les secrets Secret Manager, le répertoire NFS, les
buckets GCS (y compris le bucket de sauvegardes — copiez d'abord toute sauvegarde que vous souhaitez conserver) et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC,
le cluster GKE, l'instance partagée Cloud SQL, le registre) sont gérées séparément et ne sont pas supprimées
ici.

Supprimez vous-même les ressources créées par les labs fonctionnels **en dehors** du module :

```bash
gcloud secrets delete odoo-lab-marker --project="$PROJECT" --quiet          # Lab 5
gcloud storage rm -r "gs://<your-bucket>"                                    # Lab 18 SQL bucket
kubectl get pvc -n "$NS" 2>/dev/null                                         # Lab 7: should be gone with the namespace
gcloud compute addresses list --global --project="$PROJECT" --filter="name~odoo"   # no leftover named IP (Lab 19)
```

Supprimez également le client OAuth du Lab 20 (Console → Google Auth Platform → Clients), tous les
enregistrements DNS créés dans le Lab 19, Cloud CDN si vous l'avez activé manuellement dans le Lab 21, ainsi que les sauvegardes que vous
auriez copiées en dehors du projet si vous n'en avez plus besoin. Si vous avez activé la journalisation des audits dans le Lab 22,
vérifiez ensuite la configuration d'audit du projet — elle s'applique à l'échelle du projet.

---

## Annexe — Variables d'interconnexion de plateforme du Groupe 0 {#appendix--group-0-platform-wiring-variables}

Ces variables ne sont jamais affichées sur le formulaire. La plateforme ou le module les définit ; vous ne devez généralement pas les modifier.

| Variable | Rôle |
|---|---|
| `module_description`, `module_documentation`, `module_dependency`, `module_services` | Texte du catalogue, lien vers la documentation, dépendance envers Services_GCP, liste des services. |
| `requires_services` | Fonctionnalités de Services_GCP requises par ce module (PostgreSQL, VM NFS, GKE). |
| `credit_cost`, `require_credit_purchases`, `enable_purge`, `public_access`, `shared_users`, `technical_support_users` | Tarification, autorisation de purge, visibilité dans le catalogue et routage du support. |
| `require_services_gcp_module` | Refuser le déploiement si aucun réseau Services_GCP n'existe (valeur par défaut : `true`). |
| `resource_creator_identity`, `impersonation_service_account` | Identité utilisée par la plateforme pour déployer / emprunter une identité. |
| `explicit_secret_values` | Valeurs inscrites dans le Secret Kubernetes du module — la méthode pour fournir votre propre `ODOO_MASTER_PASS`. |
| `job_execution_wait_timeout`, `job_active_deadline_seconds` | Budgets temporels des jobs ; déclarés ici, mais les valeurs propres au module socle s'appliquent. |
| `network_name`, `gke_cluster_selection_mode`, `sql_instance_name`, `sql_instance_base_name`, `scripts_dir` | Déclarées pour des raisons de compatibilité ; non utilisées par ce module. |
| `quota_max_pods`, `quota_max_services`, `quota_max_pvcs` | Non utilisées par ce module (le Lab 8 couvre les champs de quota effectivement pris en compte). |
| `prereq_gke_subnet_cidr`, `prereq_subnet_cidr_override`, `prereq_gke_master_cidr_override`, `binauthz_evaluation_mode`, `extra_service_ports` | Non utilisées par ce module. |

---

## Résumé {#summary}

| Tâche / Lab | Type | Résultat |
|---|---|---|
| 1 — Déployer la configuration de référence | Automatisé | Charge de travail Odoo, base Cloud SQL, répertoire NFS, buckets, secrets, Gateway avec HTTPS via nip.io ; jobs d'initialisation terminés |
| 2 — Accéder et vérifier | Manuel | `/web/health` 200 ; base précréée, gestionnaire désactivé ; connecté en tant que `admin` et mot de passe modifié ; chaque ressource localisée |
| Lab 2 — Environnement de déploiement | Fonctionnalité | Les contacts de support reçoivent des alertes ; étiquettes sur chaque ressource |
| Lab 3 — Identité de l'application | Fonctionnalité | Nom d'affichage/description modifiés ; explications sur la fixation du nom et de la version majeure |
| Lab 4 — Exécution et mise à l'échelle | Fonctionnalité | Plage HPA et délai d'expiration du backend ajustés ; VPA essayé ; ressources valables uniquement à la création comprises |
| Lab 5 — Variables d'environnement et secrets | Fonctionnalité | Variables d'environnement brutes, issues de Secret Manager et auto-protégées injectées et vérifiées |
| Lab 6 — Backend GKE et cluster | Fonctionnalité | NetworkPolicy isolant l'espace de noms tout en maintenant fonctionnels les chemins vers la base de données, Redis et le LB |
| Lab 7 — StatefulSet | Fonctionnalité | Odoo sur un StatefulSet avec PVC ; persistance prouvée par écriture-suppression-lecture |
| Lab 8 — Quota de ressources | Fonctionnalité | Quota d'espace de noms avec marge pour les rollouts ; validation des unités binaires observée |
| Lab 9 — Politiques de fiabilité | Fonctionnalité | PDB et répartition inter-zones ; perturbations tolérées comprises |
| Lab 10 — Observabilité et santé | Fonctionnalité | Sondes ajustées sur le pod et la Gateway ; test de disponibilité et alerte processeur créés |
| Lab 11 — Jobs et tâches planifiées | Fonctionnalité | Job d'initialisation personnalisé chaîné après celui d'Odoo, CronJob et service compagnon accessible |
| Lab 12 — Intégration CI/CD et GitHub | Fonctionnalité | Application de Binary Authorization ; parcours guidé de CI/CD et Cloud Deploy |
| Lab 13 — Système de fichiers (NFS) | Fonctionnalité | Filestore sur NFS validé par une pièce jointe conservée après redémarrage |
| Lab 14 — Cloud Storage et Artifact Registry | Fonctionnalité | Buckets fusionnés/remplacés, montage des addons reformulé, portée de rétention comprise |
| Lab 15 — Cache Redis | Fonctionnalité | Redis configuré dans les variables d'environnement, `odoo.conf` et le chemin réseau |
| Lab 16 — Backend de base de données | Fonctionnalité | Extensions installées, alias ajoutés, rotation de mot de passe effectuée de bout en bout |
| Lab 17 — Sauvegarde et maintenance | Fonctionnalité | Planning/rétention des sauvegardes configurés, sauvegarde effectuée à la demande, import compris |
| Lab 18 — Scripts SQL personnalisés | Fonctionnalité | Scripts SQL ordonnés exécutés depuis un bucket et vérifiés dans la base de données |
| Lab 19 — Domaine personnalisé, IP statique et réseau | Fonctionnalité | IP statique nommée, nom d'hôte personnalisé avec certificat géré à l'état ACTIVE |
| Lab 20 — Identity-Aware Proxy | Fonctionnalité | Connexion Google imposée devant Odoo (redirection 302 vers Google) |
| Lab 21 — Cloud Armor | Fonctionnalité | WAF associé ; sondes XSS/SQLi bloquées avec un code 403 ; comportement de Cloud CDN compris |
| Lab 22 — VPC Service Controls et journalisation des audits | Fonctionnalité | Journaux d'audit détaillés activés ; VPC-SC demandé et son résultat lu dans les sorties |
| 3 — Exploiter | Manuel | Inspecter, mettre à l'échelle, mettre à jour, redémarrer, gérer secrets/stockage/jobs, accès base et sauvegardes |
| 4 — Observer | Manuel | Emplacements des journaux de démarrage et d'Odoo ; Monitoring, tests de disponibilité et alertes |
| 5 — Dépanner | Manuel | Diagnostiquer les pods, le premier démarrage, les erreurs Gateway 503, les mots de passe, NetworkPolicy, les jobs, les paramètres inertes, les blocages d'accès |
| 6 — Détruire l'environnement | Automatisé | Delete supprime toutes les ressources du module ; éléments complémentaires des labs supprimés à la main |
