---
title: "Migration Center — Environnement de découverte et d'évaluation"
description: "Référence de configuration du module RAD Migration Center sur Google Cloud — variables, architecture, réseau et opérations courantes (day-2)."
---

<!-- translated-from: docs/modules/Migration_Center.md @ 3055034 sha256:a8521a005372 -->

# Migration Center — Environnement de découverte et d'évaluation {#migration-center--discovery--assessment-environment}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Migration_Center.png" alt="Migration Center — Environnement de découverte et d'évaluation" style={{maxWidth: "100%", borderRadius: "8px"}} />

Google Cloud Migration Center est la plateforme unifiée et gratuite de Google Cloud pour la *phase d'évaluation* d'une migration vers le cloud — découvrir les charges de travail existantes, constituer un inventaire précis, estimer ce que coûterait leur exécution sur Google Cloud et planifier les vagues de migration. Ce module déploie un environnement pratique complet de découverte et d'évaluation Migration Center : il initialise le service Migration Center pour votre projet, enregistre une source de découverte et provisionne un ensemble de charges de travail sources d'exemple (un hôte Windows MCDCv6 plus des cibles d'analyse Linux Debian) afin que vous puissiez effectuer une découverte de bout en bout réaliste et produire un rapport de coût total de possession (TCO).

Il s'agit d'un **module autonome** — il ne s'appuie sur aucun socle partagé. Tout ce dont il a besoin (un VPC dédié, des règles de pare-feu, des VM d'exemple, un bucket pour la clé SSH et les objets du service Migration Center) est créé directement dans le projet cible. En option, lorsque des identifiants AWS sont fournis, il découvre et importe également l'inventaire EC2 AWS réel en plus des résultats d'analyse Google Cloud.

Ce guide se concentre sur les services cloud que provisionne le module et sur la manière de les explorer et de les exploiter depuis la console Google Cloud, la ligne de commande et l'API REST de Migration Center.

---

## 1. Vue d'ensemble {#1-overview}

Le module assemble un ensemble ciblé de services Google Cloud et, en option, AWS :

| Capacité | Service cloud | Remarques |
|---|---|---|
| Service Migration Center | Migration Center (`migrationcenter.googleapis.com`) | Initialisé pour la région choisie ; une source de découverte est enregistrée automatiquement |
| Hôte MCDCv6 | Compute Engine — VM Windows Server 2022 | Héberge le MC Discovery Client (MCDCv6), préinstallé par un script de démarrage ; prêt pour RDP |
| Cibles d'analyse de découverte | Compute Engine — VM Linux Debian 12 | Charges de travail sources d'exemple (par défaut : 3) analysées par MCDCv6 via SSH |
| Stockage de la clé SSH | Cloud Storage | Un bucket privé contenant le `lab-ssh-key.pem` généré pour l'identifiant SSH de MCDCv6 |
| Réseau | VPC + règles de pare-feu | VPC dédié en mode automatique isolant les VM du lab ; règles RDP/SSH/ICMP/internes/HTTP |
| Inventaire EC2 AWS (facultatif) | AWS IAM + EC2 (via le fournisseur/la CLI `aws`) | Un utilisateur IAM en lecture seule à portée limitée est créé et utilisé pour interroger EC2 et importer l'inventaire dans Migration Center |

**À savoir d'emblée :**

- **La région est permanente.** Lors de sa première initialisation, Migration Center associe toutes les données d'évaluation à une seule région Google Cloud. Vous ne pouvez pas la modifier ensuite sans un nouveau projet. Le module fige la valeur de `region` (par défaut `us-central1`).
- **Une étape est réellement manuelle.** La connexion Google (OAuth) de MCDCv6 nécessite une session de navigateur interactive et ne peut pas être scriptée. Tout le reste — initialisation du service, enregistrement de la source, VM d'exemple, importation AWS facultative — est automatisé. Après le déploiement, vous vous connectez en RDP à la VM Windows, effectuez la connexion Google, lancez l'analyse, puis créez les groupes, les préférences et les rapports.
- **AWS est facultatif et transparent sur son coût.** Laissez `aws_access_key_id` vide pour ignorer complètement AWS ; aucun appel d'API AWS n'est effectué et aucune ressource AWS n'est créée. Si vous fournissez des identifiants, il doit s'agir d'**identifiants d'amorçage disposant de droits d'écriture IAM** — le module crée un utilisateur IAM dédié, à portée limitée et en lecture seule sur EC2 (avec sa clé d'accès), et effectue la découverte avec cette clé, et non avec vos identifiants d'amorçage. La CLI `aws` doit être disponible dans l'environnement d'exécution pour que l'importation réussisse.
- **Les groupes d'assets, les ensembles de préférences et les rapports ne sont volontairement pas créés à l'avance.** Ils sont construits sous forme d'exercices pratiques après l'arrivée des données de découverte de MCDCv6 — les générer avant l'analyse produirait des résultats vides ou trompeurs.
- **Les objets Migration Center ne sont pas gérés par Terraform.** La source de découverte et l'éventuelle tâche d'importation sont créées via des appels à l'API REST (non suivis dans l'état). Lors de la destruction, les VM, le VPC, le pare-feu et le bucket sont supprimés, mais les objets Migration Center subsistent et doivent être nettoyés via la console/l'API ou en supprimant le projet.

---

## 2. Services cloud et comment les explorer {#2-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT`, `REGION` et `ZONE` sont définis. Les noms des ressources suivent le modèle `migcenter-<id>-…`, où `<id>` est le suffixe de déploiement indiqué dans les [sorties](#5-outputs).

### A. Service Migration Center {#a-migration-center-service}

Lors de l'application, le module appelle l'API Migration Center pour initialiser le service pour le projet/la région et pour enregistrer une source de découverte de type *discovery client*. L'identifiant de la source (indiqué dans `mc_source_id`) est celui auquel MCDCv6 se rattache lors de la connexion, et son nom d'affichage doit correspondre à `mc_discovery_client_name`.

- **Console :** Migration Center → utilisez la sortie `migration_center_url` pour accéder directement à la console de ce projet. Examinez **Data sources**, **Assets**, **Groups**, **Migration preferences** et **Reports**.
- **CLI / REST :**
  ```bash
  TOKEN=$(gcloud auth print-access-token)
  # List discovery sources
  curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/sources" \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.sources[] | {id: (.name|split("/")|last), displayName, type}'
  # List discovered/imported assets
  curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/assets" \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.assets[] | {name: (.name|split("/")|last), os: .machineDetails.guestOsDetails.osName}'
  ```

### B. L'hôte MCDCv6 (VM Windows) {#b-the-mcdcv6-host-windows-vm}

La VM Windows Server 2022 (`migcenter-<id>-winvm01`) est le poste de travail interactif. Un script de démarrage PowerShell s'exécute une seule fois au premier démarrage et : crée l'utilisateur local `migrationcenter` (mot de passe RDP `m1grat10nc#nt#r`), active RDP, installe Google Chrome (nécessaire au flux OAuth de MCDCv6), installe MCDCv6 en mode silencieux et prépare un zip d'exemple d'importation CSV AWS dans le dossier Downloads de l'utilisateur `migrationcenter`.

- **Console :** Compute Engine → VM instances → sélectionnez la VM Windows. Utilisez l'adresse IP externe (sortie `windows_vm_external_ip`) avec un client RDP.
- **CLI :**
  ```bash
  gcloud compute instances describe migcenter-<id>-winvm01 --zone "$ZONE" --project "$PROJECT" \
    --format="value(networkInterfaces[0].accessConfigs[0].natIP)"
  # Watch the startup script (Chrome/MCDCv6 install) progress:
  gcloud compute instances get-serial-port-output migcenter-<id>-winvm01 \
    --zone "$ZONE" --project "$PROJECT" | grep -Ei "mcdc|chrome|lab setup"
  ```

Les identifiants RDP sont **nom d'utilisateur : `migrationcenter`  mot de passe : `m1grat10nc#nt#r`** (codés en dur pour la simplicité du lab ; également indiqués dans la description de la sortie `windows_vm_external_ip`).

### C. Les cibles d'analyse de découverte (VM Linux) {#c-the-discovery-scan-targets-linux-vms}

Les VM Linux Debian 12 (`migcenter-<id>-linvm-1…N`) sont les charges de travail sources d'exemple que MCDCv6 analyse via SSH. Sur chaque VM, l'utilisateur système `migrationcenter` est autorisé avec la clé publique SSH générée (injectée à la fois via les métadonnées de l'instance et un script de démarrage). MCDCv6 les atteint par leurs adresses IP internes ; la sortie `linux_vm_internal_ips` vous fournit les valeurs permettant de définir la plage d'analyse IP de MCDCv6.

- **Console :** Compute Engine → VM instances → filtrez sur `linvm`.
- **CLI :**
  ```bash
  gcloud compute instances list --filter="name~migcenter AND name~linvm" --project "$PROJECT" \
    --format="table(name, zone, status, networkInterfaces[0].networkIP)"
  # Optional: verify SSH manually with the generated key
  gcloud storage cp "gs://migcenter-<id>-mc-keys/lab-ssh-key.pem" ./lab-ssh-key.pem --project "$PROJECT"
  chmod 600 ./lab-ssh-key.pem
  ssh -i ./lab-ssh-key.pem migrationcenter@<linux-vm-internal-ip>
  ```

### D. Stockage de la clé SSH (Cloud Storage) {#d-ssh-key-storage-cloud-storage}

Une paire de clés RSA de 4096 bits est générée au moment du déploiement. La clé publique est placée sur chaque VM Linux ; la clé privée est téléversée sous le nom `lab-ssh-key.pem` dans un bucket privé (`migcenter-<id>-mc-keys`) avec un accès uniforme au niveau du bucket. Pendant le lab, vous téléchargez cette clé et la chargez dans MCDCv6 comme identifiant SSH `Lab-key` (nom d'utilisateur `migrationcenter`).

- **Console :** Cloud Storage → Buckets → le bucket `migcenter-<id>-mc-keys`.
- **CLI :**
  ```bash
  gcloud storage ls "gs://migcenter-<id>-mc-keys/" --project "$PROJECT"
  ```

La clé privée est stockée comme valeur sensible dans l'état Terraform. Restreignez l'accès au backend d'état et au bucket, et faites tourner la clé après la session si nécessaire.

### E. Inventaire source AWS (facultatif) {#e-aws-source-inventory-optional}

Lorsque `aws_access_key_id` est fourni, le module provisionne un utilisateur IAM AWS à portée limitée (`mc-ec2-discovery-<id>`) doté d'une règle n'accordant que `ec2:DescribeInstances`, `ec2:DescribeInstanceTypes` et `ec2:DescribeVolumes`, puis génère une clé d'accès pour celui-ci. La découverte s'exécute avec cette clé à portée limitée : elle interroge EC2 dans `aws_region`, construit des CSV au format Migration Center (`vmInfo`, `diskInfo`, `tagInfo` et un `perfInfo` vide), puis crée, téléverse, valide et exécute une tâche d'importation sur la source de découverte. L'utilisateur IAM, la règle et la clé sont supprimés lors de la destruction.

- **Console (GCP) :** Migration Center → Data sources → la tâche d'importation ; les instances EC2 importées apparaissent sous Assets.
- **Console (AWS) :** IAM → Users → `mc-ec2-discovery-<id>`.
- **CLI :**
  ```bash
  # GCP: list import jobs
  curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/importJobs" \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    | jq '.importJobs[] | {displayName, state}'
  # AWS: confirm the scoped user exists (using your own AWS credentials)
  aws iam list-attached-user-policies --user-name mc-ec2-discovery-<id>
  ```

L'ARN de l'utilisateur IAM à portée limitée est indiqué dans `aws_iam_user_arn` (null lorsque AWS est désactivé).

### F. VPC et pare-feu {#f-vpc--firewall}

Un VPC dédié en mode automatique (`migcenter-<id>-vpc`) isole le lab. Le mode automatique crée un sous-réseau par région à partir de la plage `10.128.0.0/9`, de sorte que toutes les VM du lab d'une même région se joignent via la plage interne — c'est ainsi que MCDCv6 analyse les cibles Linux.

- **Console :** VPC network → VPC networks / Firewall.
- **CLI :**
  ```bash
  gcloud compute networks list --filter="name~migcenter" --project "$PROJECT"
  gcloud compute firewall-rules list --filter="network~migcenter" --project "$PROJECT" \
    --format="table(name, direction, sourceRanges.list(), allowed[].map().firewall_rule().list())"
  ```

Les règles de pare-feu créées sont : `allow-internal` (tous les protocoles dans la plage du VPC), `allow-ssh` (TCP 22), `allow-rdp` (TCP 3389), `allow-icmp` et `allow-http` (TCP 80/443 vers les instances portant le tag `windows-vm`, pour l'accès sortant de MCDCv6 aux API Google et à OAuth). Les quatre premières peuvent être supprimées avec `create_default_firewall_rules = false` si elles existent déjà sur le réseau cible.

---

## 3. Comportement {#3-behaviour}

**Ce qui est provisionné lors de l'application.** Le module active les API requises, crée le VPC en mode automatique et les règles de pare-feu, génère la paire de clés RSA et téléverse la clé privée dans un bucket Cloud Storage, déploie l'hôte Windows MCDCv6 et les cibles d'analyse Linux Debian, puis initialise le service Migration Center pour la région et enregistre la source de découverte. Si des identifiants AWS sont fournis, il crée en outre l'utilisateur IAM à portée limitée et exécute l'importation EC2. Le provisionnement Terraform est rapide (environ 5 à 8 minutes) ; le script de démarrage Windows (installation de Chrome + MCDCv6) s'exécute en arrière-plan et est généralement prêt dans les 3 à 5 minutes qui suivent.

**Le flux de découverte/d'évaluation.** Après le déploiement : connectez-vous en RDP à la VM Windows → lancez MCDCv6 → effectuez la connexion Google (la seule étape manuelle) → sélectionnez le projet et saisissez `mc_discovery_client_name` pour que MCDCv6 se rattache à la source préenregistrée → chargez `lab-ssh-key.pem` comme identifiant SSH `Lab-key` → configurez une plage d'analyse IP couvrant `linux_vm_internal_ips` → lancez la collecte. Les assets Linux découverts sont transmis en continu à Migration Center, où ils rejoignent l'éventuel inventaire AWS importé. Vous créez ensuite des groupes d'assets et des ensembles de préférences de migration, puis générez un rapport TCO depuis la console (ou l'API REST).

**Agents/collecteurs.** MCDCv6 est l'agent — il effectue une analyse au niveau du système d'exploitation invité via SSH et collecte les profils matériels, les détails du système d'exploitation, les logiciels installés, les processus en cours, les interfaces réseau et les ports ouverts, en transmettant les résultats en continu à la source Migration Center. L'importation CSV (AWS) apporte l'inventaire matériel/des tags, mais aucun détail du système d'exploitation en direct ; le contraste entre ces deux niveaux de profondeur fait partie de l'intérêt pédagogique.

**Suivi manuel.** La connexion OAuth de MCDCv6, la configuration de l'identifiant SSH, la configuration de la plage d'analyse et la création des groupes, des préférences et des rapports sont effectuées par l'utilisateur après le déploiement. Le module s'arrête volontairement au stade « service initialisé, source enregistrée, charges de travail d'exemple prêtes, AWS importé (si configuré) ».

**Comportement de nettoyage.** La destruction supprime toutes les ressources gérées par Terraform : les VM Windows et Linux, le VPC et les règles de pare-feu, ainsi que le bucket Cloud Storage (qui utilise force-destroy afin que l'objet de la clé soit supprimé avec lui). Lorsque AWS est activé, l'utilisateur IAM à portée limitée, la règle et la clé d'accès sont également détruits. Les objets Migration Center — la source de découverte, les tâches d'importation et les groupes, préférences et rapports que vous avez créés — ne figurent **pas** dans l'état Terraform et survivent à la destruction ; supprimez-les via la console/l'API ou en supprimant le projet. Notez que les API activées le restent lors de la destruction (afin de ne pas perturber un projet partagé).

**Remarques sur l'exécution.** Une analyse MCDCv6 unique est un instantané ponctuel ; les évaluations réelles exécutent MCDCv6 pendant 2 à 4 semaines pour constituer un historique d'utilisation permettant un dimensionnement précis. Pour le lab, une seule analyse suffit à alimenter l'inventaire et à produire un rapport TCO représentatif.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et emplacement {#group-1--project--location}

| Variable | Défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. Il doit déjà exister ; le compte de service de provisionnement doit disposer du rôle Owner. |
| `region` | `us-central1` | Région de toutes les ressources. Définit **de façon permanente** la région d'évaluation de Migration Center. |
| `zone` | `us-central1-a` | Zone des VM Compute Engine (doit se trouver dans `region`). |
| `tenant_id` | `demo` | Champ d'espace de noms de la plateforme (1 à 20 lettres minuscules, chiffres, traits d'union). Accepté par le formulaire mais **non utilisé par ce module** — chaque nom de ressource est dérivé de l'identifiant de déploiement (`migcenter-<id>-…`), donc le modifier n'a aucun effet sur ce qui est créé. |

### Groupe 2 — Réseau {#group-2--networking}

| Variable | Défaut | Description |
|---|---|---|
| `create_vpc` | `true` | Crée un VPC dédié en mode automatique pour le lab. Définissez `false` pour utiliser un réseau existant nommé `migcenter-<id>-vpc`. |
| `create_default_firewall_rules` | `true` | Crée les quatre règles standard (allow-internal, allow-ssh, allow-rdp, allow-icmp). Définissez `false` si elles existent déjà sur le réseau cible. |
| `internal_traffic_cidr` | `10.128.0.0/9` | Plage source de la règle allow-internal ; correspond à la plage des sous-réseaux en mode automatique. |

### Groupe 3 — Compute Engine {#group-3--compute-engine}

| Variable | Défaut | Description |
|---|---|---|
| `create_windows_vm` | `true` | Déploie l'hôte Windows Server 2022 MCDCv6. Le script de démarrage installe automatiquement MCDCv6 et Chrome. |
| `windows_vm_machine_type` | `e2-medium` | Type de machine de l'hôte Windows (suffisant pour MCDCv6 + Chrome). |
| `windows_vm_boot_disk_size_gb` | `50` | Taille du disque de démarrage Windows. Conservez ≥ 50 GB pour Windows Server 2022 plus MCDCv6. |
| `linux_vm_count` | `3` | Nombre de cibles d'analyse Linux Debian. Définissez `0` pour n'en déployer aucune. |
| `linux_vm_machine_type` | `e2-medium` | Type de machine de chaque cible Linux. |
| `linux_vm_boot_disk_size_gb` | `20` | Taille du disque de démarrage de chaque cible Linux. |

### Groupe 7 — Stockage de la clé SSH {#group-7--ssh-key-storage}

| Variable | Défaut | Description |
|---|---|---|
| `create_ssh_key_bucket` | `true` | Crée un bucket Cloud Storage et y stocke le `lab-ssh-key.pem` généré. Le nom du bucket est exposé dans les sorties pour la récupération. |

### Groupe 8 — Migration Center {#group-8--migration-center}

| Variable | Défaut | Description |
|---|---|---|
| `initialize_migration_center` | `true` | Initialise le service Migration Center et enregistre la source de découverte. Définissez `false` pour provisionner uniquement les VM, le VPC et le bucket. |
| `mc_discovery_client_name` | `mc-discovery-client` | Nom d'affichage de la source de découverte. Il doit être saisi **à l'identique** dans MCDCv6 lors de la connexion, sinon les résultats d'analyse aboutissent dans une source non enregistrée. |
| `aws_access_key_id` | `""` | Access Key ID AWS d'amorçage disposant de droits d'**écriture IAM**. Laissez vide pour ignorer complètement AWS. Lorsqu'il est défini, le module crée un utilisateur IAM à portée limitée en lecture seule sur EC2 et importe l'inventaire EC2 réel. (sensible) |
| `aws_secret_access_key` | `""` | Secret Access Key AWS d'amorçage correspondant à l'Access Key ID ci-dessus. (sensible) |
| `aws_region` | `us-east-1` | Région AWS dans laquelle découvrir les instances EC2. Consultée uniquement lorsque des identifiants AWS sont fournis. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `deployment_id` | Le suffixe de déploiement intégré à tous les noms de ressources. |
| `project_id` | Projet Google Cloud cible. |
| `windows_vm_name` | Nom de l'hôte Windows MCDCv6 (null lorsqu'il n'est pas créé). |
| `windows_vm_external_ip` | Adresse IP externe pour RDP. Nom d'utilisateur `migrationcenter`, mot de passe `m1grat10nc#nt#r`. |
| `linux_vm_names` | Noms des cibles d'analyse Linux Debian. |
| `linux_vm_internal_ips` | Adresses IP internes des cibles Linux — utilisez-les pour définir la plage d'analyse IP de MCDCv6. |
| `ssh_key_bucket_name` | Bucket Cloud Storage contenant `lab-ssh-key.pem` (null lorsqu'il n'est pas créé). |
| `ssh_key_user` | Nom d'utilisateur Linux pour l'identifiant SSH (`migrationcenter`). |
| `mc_discovery_client_name` | Nom à saisir dans MCDCv6 lors de la connexion (doit correspondre exactement). |
| `migration_center_url` | URL directe vers la console Migration Center de ce projet. |
| `mc_source_id` | Identifiant de la source de découverte enregistrée (null lorsque l'initialisation est désactivée). |
| `vpc_name` | Nom du réseau VPC du lab. |
| `aws_iam_user_arn` | ARN de l'utilisateur IAM à portée limitée en lecture seule sur EC2 (null lorsque l'intégration AWS est désactivée). |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `region` | à définir une seule fois, correctement | Critical | La région d'évaluation de Migration Center est permanente. Pour la modifier, vous devez utiliser un nouveau projet — toutes les données d'évaluation sont liées à la région. |
| `mc_discovery_client_name` | à faire correspondre dans MCDCv6 | High | La valeur doit être saisie à l'identique (sensible à la casse) dans MCDCv6 lors de la connexion. Une différence crée une seconde source non enregistrée, et les résultats d'analyse n'atteignent jamais la source attendue. |
| `aws_access_key_id` / `aws_secret_access_key` | les deux ou aucun | High | Les deux doivent être fournis ensemble. La clé d'amorçage doit disposer de droits d'écriture IAM (`iam:CreateUser`, `iam:CreatePolicy`, `iam:AttachUserPolicy`, `iam:CreateAccessKey` et leurs équivalents de suppression) — des identifiants en lecture seule sur EC2 échouent à l'étape de provisionnement IAM. La CLI `aws` doit être présente dans l'environnement d'exécution. |
| `aws_region` | la région hébergeant vos instances EC2 | Medium | Consultée uniquement lorsque des identifiants AWS sont définis ; une mauvaise région importe zéro instance (l'étape d'importation ne fait alors rien). |
| `create_vpc` + `create_default_firewall_rules` | `true` / `true` | Medium | Avec `create_vpc = false`, un réseau nommé `migcenter-<id>-vpc` doit déjà exister (il n'existe pas de variable de nom personnalisé). Créer des règles de pare-feu sur un VPC inexistant fait échouer l'application. |
| `create_ssh_key_bucket` | `true` | Medium | Avec `false`, la clé privée n'existe que dans l'état Terraform — il n'y a aucun `lab-ssh-key.pem` à télécharger, donc l'étape d'identifiant SSH de MCDCv6 n'a rien à charger. |
| Identifiants RDP | à changer pour tout usage hors lab | High | L'utilisateur et le mot de passe de la VM Windows sont codés en dur pour la commodité du lab, et `allow-rdp` est ouvert à `0.0.0.0/0`. Restreignez la plage source et changez le mot de passe pour tout usage non jetable. |
| Exposition de `lab-ssh-key.pem` | restreignez le bucket et l'état | High | La clé privée RSA réside dans l'état et dans le bucket. Verrouillez les deux, et faites tourner la clé après la session. |
| `linux_vm_count` | `3` | Low/Medium | Un nombre plus élevé donne un inventaire plus riche mais coûte plus cher ; `0` ne déploie aucune cible d'analyse (seule l'importation AWS alimenterait alors les assets). |
| Objets Migration Center lors de la destruction | à nettoyer manuellement | Medium | Les sources, les tâches d'importation, les groupes, les préférences et les rapports ne figurent pas dans l'état Terraform et survivent à la destruction. Supprimez-les via la console/l'API ou en supprimant le projet. |
| Dimensionnement à partir d'une seule analyse MCDCv6 | à exécuter plus longtemps pour un travail réel | Medium | Une analyse unique sous-estime la demande réelle ; les évaluations de production collectent 2 à 4 semaines d'utilisation avant de se fier aux recommandations de dimensionnement. |

---

## Pour aller plus loin {#further-reading}

- [Vue d'ensemble de Migration Center](https://cloud.google.com/migration-center/docs/overview)
- [MC Discovery Client (MCDCv6)](https://cloud.google.com/migration-center/docs/discovery-client-overview)
- [Référence de l'API REST de Migration Center](https://cloud.google.com/migration-center/docs/reference/rest)
- [Rapports de coût total de possession](https://cloud.google.com/migration-center/docs/create-tco-report)
- [Groupes d'assets et ensembles de préférences](https://cloud.google.com/migration-center/docs/create-groups)
- [Importer un inventaire depuis AWS](https://cloud.google.com/migration-center/docs/import-aws-data)
