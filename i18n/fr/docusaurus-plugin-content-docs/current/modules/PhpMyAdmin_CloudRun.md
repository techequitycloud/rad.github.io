---
title: "PhpMyAdmin sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de PhpMyAdmin sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/PhpMyAdmin_CloudRun.md @ e69407af sha256:3b78b8cf3af4 -->

# PhpMyAdmin sur Google Cloud Run {#phpmyadmin-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PhpMyAdmin_CloudRun.png" alt="PhpMyAdmin sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

phpMyAdmin est l'outil web open-source (GPLv2) le plus populaire pour
administrer les bases de données MySQL et MariaDB via le navigateur — parcourir
et modifier les tables, exécuter des requêtes SQL, gérer les utilisateurs et
importer/exporter des données. Ce module déploie phpMyAdmin sur **Cloud Run v2**
sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par phpMyAdmin et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls et le cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Coût de PhpMyAdmin sur RAD et comparaison {#what-phpmyadmin-costs-on-rad-and-how-that-compares}

**L'exécution de PhpMyAdmin dans votre propre projet Google Cloud coûte environ
16,78 $ US/mois en infrastructure, plus des frais de module uniques de 40
crédits RAD** (dimensionnés à 1 vCPU / 0,5 GiB sur une instance Cloud Run
« scale-to-zero »). RAD facture les frais de module une seule fois, au moment
du déploiement — jamais plus lors d'une mise à jour — plus le temps de build
mesuré en crédits ; l'utilisation de Google Cloud elle-même est facturée à
votre propre compte de facturation au prix catalogue de Google. Sur un projet
**géré par RAD**, les mêmes ressources sont mesurées toutes les heures en
crédits au prix catalogue plus la marge de RAD — environ 3 crédits/jour — et
les frais de module sont inférieurs de 10 %, à 36 crédits. Voir
« Mettez-le en pause gratuitement » ci-dessous pour savoir comment un
déploiement PhpMyAdmin géré par RAD peut être arrêté, sans frais de
fonctionnement, jusqu'à ce que vous en ayez à nouveau besoin. (ou voir le
[guide GKE](PhpMyAdmin_GKE.md) si vous avez besoin de Kubernetes)

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Élément | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 40 crédits (une fois) | 36 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût de fonctionnement Google Cloud | ~16,78 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~3 crédits/jour, mesurés toutes les heures au prix catalogue + marge de RAD |

**Coût de fonctionnement par défaut dans votre propre projet**

| Ressource | $/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 |
| **Total** | **16,78 $** |

### Comparaison {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel, directement
  comparable, pour ce projet open-source exact, donc la comparaison honnête est
  un serveur auto-géré nu : Hetzner CPX22 (2 vCPU/4 Go, ~24 $/mois), un Droplet
  DigitalOcean 2 vCPU/4 Go (~24 $/mois), ou un GCP Compute Engine e2-standard-2
  (2 vCPU/8 Go, ~49 $/mois). L'empreinte propre de cette application (1 vCPU ou
  moins, 1 GiB ou moins) est plus petite que n'importe laquelle de ces classes,
  donc une machine auto-gérée nue dimensionnée pour correspondre coûterait moins
  cher que les chiffres ci-dessus — mais vous seriez toujours responsable de
  chaque correctif, sauvegarde et mise à jour de sécurité.
- RAD ne prétend **pas** battre un VPS nu sur le prix affiché — ce n'est
  généralement pas le cas. Ce que RAD ajoute pour le même montant ou un montant
  similaire est une base de données gérée, des identifiants conservés dans
  Secret Manager, une surveillance et une mise à jour en un clic, dont aucun
  n'est fourni gratuitement par un VPS nu.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du
  système d'exploitation/de la base de données, effectuez et testez les
  sauvegardes, et renouvelez les certificats ; Cloud SQL géré par RAD, Secret
  Manager et la surveillance s'occupent des trois pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option principale sur un projet **géré par RAD**, et elle est gratuite
pendant la pause. La suppression d'un projet géré par RAD délie d'abord sa
facturation, puis demande à Google de supprimer le projet lui-même — la
suppression logique récupérable de 30 jours de Google. Contrairement à la
suppression d'un seul module, cela ne démolit pas la base de données, aucune
VM, ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et comme la facturation est déjà déliée, rien n'est facturé pendant
qu'il attend.

La restauration — dans les 30 jours, et uniquement par le propriétaire du
projet — demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
: c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. L'ensemble de la restauration ne coûte
qu'une poignée de crédits (moins de 1 $ US) en temps de build pour une chaîne
typique de déploiements. Ce qu'il faut : vous devez être propriétaire du projet
(pas seulement faire gérer sa facturation par RAD), vous devez le restaurer
vous-même dans les 30 jours — après quoi Google le supprime définitivement — et
la restauration est admise comme la création d'un nouveau projet, donc votre
solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits
pour le niveau sandbox que la plupart des études et démos utilisent). Google
affirme que la plupart des services sont à nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un
bucket à l'intérieur du projet, et ce bucket a la suppression logique de Cloud
Storage explicitement désactivée, de sorte que le bucket de sauvegarde est très
probablement supprimé dès que vous supprimez le projet — même si le projet
lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce
déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde
(vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour
une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **projet propre** (ou un projet géré par RAD au-delà de
sa fenêtre de restauration de 30 jours), consiste à supprimer PhpMyAdmin
purement et simplement et à le redéployer plus tard. Un redéploiement coûte à
nouveau les frais de module plus les builds — environ **43-46 crédits** au
total pour ce module.

La suppression ne permet d'économiser de l'argent que si PhpMyAdmin restait
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût de fonctionnement — pour ce module, cela représente
environ 8 jours ou plus d'inactivité, basé sur son coût de fonctionnement de
16,78 $ US/mois ci-dessus. La majeure partie de ce coût de fonctionnement est
généralement la base de données et toute VM de fichier/cache partagée, et ils
ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la
suppression de cette application seule n'économise que sa propre part de
calcul si quelque chose d'autre partage le projet.

**Conservez d'abord les données :** les sauvegardes nocturnes sont stockées
dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci.
Copiez donc la dernière sauvegarde avant de la supprimer si vous souhaitez la
conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille est
  faible, la facturation est suspendue et les données sont conservées, de sorte
  que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ; [Resource
Manager : supprimer et restaurer des
projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

phpMyAdmin s'exécute comme un conteneur **PHP + Apache sans état** sur Cloud
Run v2. C'est l'un des déploiements les plus légers de ce dépôt — il ne relie
que les services dont il a réellement besoin :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 512 MiB par défaut, autoscaling sans serveur ; scale-to-zero |
| Base de données | **Aucune provisionnée** | phpMyAdmin n'a pas sa propre base de données ; il se connecte à un serveur MySQL/MariaDB *externe* que vous lui indiquez |
| Stockage d'objets | **Aucun** | Sans état — aucun bucket GCS n'est créé |
| Cache | Redis (optionnel, désactivé) | Uniquement pour la limitation de débit/détection de bots sur les déploiements publics ; non requis |
| Secrets | **Aucun généré** | phpMyAdmin ne détient aucun secret ; les utilisateurs se connectent avec les propres identifiants du serveur MySQL cible |
| Image de conteneur | Artifact Registry | Build personnalisé léger `FROM phpmyadmin/phpmyadmin`, mis en miroir et épinglé par tag |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée pour phpMyAdmin.** `database_type = "NONE"` est
  fixé par la couche d'application partagée. phpMyAdmin est un *client* — il
  administre un serveur MySQL qui réside ailleurs (l'IP privée Cloud SQL de la
  plateforme, une autre instance Cloud SQL, ou tout hôte MySQL/MariaDB
  accessible). Rien ici ne crée ce serveur.
- **La cible MySQL est sélectionnée par des variables d'environnement, pas par
  du code.** `PMA_ARBITRARY = "1"` (la valeur par défaut) affiche une boîte de saisie de
  serveur sur la page de connexion afin que les utilisateurs puissent saisir
  n'importe quel hôte. Définissez `pma_host` (et `PMA_ARBITRARY = "0"`) pour épingler un
  seul serveur.
- **Aucun secret n'est généré.** Il n'y a pas de clé de chiffrement, de secret
  JWT ou de mot de passe d'application à protéger — et donc rien qui puisse être
  corrompu lors d'un redéploiement. L'authentification se fait par rapport aux
  propres comptes de la *base de données cible* (authentification par cookie).
- **Le scale-to-zero est activé** (`min_instance_count = 0`, forcé par le module).
  phpMyAdmin est une console d'administration interactive sans travail en
  arrière-plan, elle ne devrait donc rien coûter lorsqu'elle est inactive. Les
  démarrages à froid ajoutent quelques secondes à la première requête après
  l'inactivité.
- **Facturation basée sur les requêtes** (`cpu_always_allocated = false`). phpMyAdmin n'effectue
  aucun travail en arrière-plan en cours de processus, le CPU n'est donc
  facturé que pendant le traitement d'une requête.
- **Ingress public par défaut** (`ingress_settings = "all"`). Étant donné que phpMyAdmin est
  un outil d'administration de base de données puissant, envisagez sérieusement
  de le protéger avec **IAP** ou de restreindre l'ingress avant de l'exposer à
  Internet.
- **NFS et Redis sont désactivés par défaut.** phpMyAdmin ne conserve aucun
  état ; n'activez Redis que pour la protection contre les abus sur un
  déploiement public.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms des services et des ressources sont rapportés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service phpMyAdmin {#a-cloud-run--the-phpmyadmin-service}

phpMyAdmin s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre le nombre minimum (0)
et maximum d'instances. Chaque déploiement crée une révision immuable ; le
trafic peut être réparti entre les révisions pour des déploiements sûrs. Le
conteneur écoute sur le **port 80**.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~phpmyadmin"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the MySQL-target env vars injected into the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Le serveur MySQL/MariaDB cible (externe) {#b-the-target-mysqlmariadb-server-external}

phpMyAdmin ne provisionne **pas** de base de données — il se connecte à une
base de données que vous possédez déjà. Cette cible est sélectionnée via
`pma_host` / `pma_port` (fixe) ou `PMA_ARBITRARY = "1"` (l'utilisateur saisit l'hôte
lors de la connexion). Un modèle courant consiste à pointer phpMyAdmin vers
l'adresse IP privée partagée de Cloud SQL de la plateforme :

- **Console :** SQL → sélectionnez l'instance pour trouver son **adresse IP
  privée** et son nom de connexion.
- **CLI :**
  ```bash
  # Find a MySQL instance's private IP to use as pma_host:
  gcloud sql instances list --project "$PROJECT" \
    --filter="databaseVersion~MYSQL"
  gcloud sql instances describe <instance-name> --project "$PROJECT" \
    --format='value(ipAddresses[0].ipAddress)'
  ```

Pour que phpMyAdmin puisse atteindre un serveur MySQL à IP privée, le service
doit avoir un egress VPC vers le VPC partagé (géré par la fondation lorsque
`vpc_egress_setting` achemine les plages privées). Les utilisateurs
s'authentifient sur la page de connexion de phpMyAdmin avec les propres comptes
MySQL de cette base de données.

### C. Cloud Storage {#c-cloud-storage}

**Non utilisé.** phpMyAdmin est sans état et ne déclare aucun bucket GCS.
(L'importation/exportation dans l'interface utilisateur de phpMyAdmin diffuse
les fichiers via le navigateur, pas vers GCS.)

### D. Redis (protection optionnelle contre les abus) {#d-redis-optional-abuse-protection}

Redis est **désactivé par défaut** (`enable_redis = false`). Il n'est pertinent que si
vous activez la limitation de débit/détection de bots de phpMyAdmin sur un
déploiement public. Lorsqu'il est désactivé, phpMyAdmin fonctionne
entièrement — Redis n'est pas requis pour un fonctionnement normal.

- **CLI (uniquement si activé) :**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager {#e-secret-manager}

**Aucun secret n'est généré par ce module.** phpMyAdmin ne détient aucune clé
de chiffrement, secret JWT ou mot de passe d'application — la connexion se fait
avec les propres identifiants du serveur MySQL cible, saisis sur la page de
connexion de phpMyAdmin et jamais stockés. Vous pouvez toujours ajouter votre
propre `secret_environment_variables` (par exemple, pour injecter un
`PMA_PASSWORD`/`PMA_USER` fixe pour une cible d'authentification unique), que la
fondation monte à partir de Secret Manager.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~phpmyadmin"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails de l'injection de
secrets.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN
et Cloud Armor peuvent être superposés ; IAP peut contrôler l'accès avec la
connexion Google — fortement recommandé pour un outil d'administration de base
de données.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur Apache/PHP sont envoyés à Cloud Logging ; les
métriques Cloud Run sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application PhpMyAdmin {#3-phpmyadmin-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a
  pas de job `db-init` et aucun schéma à créer — phpMyAdmin n'a pas sa propre
  base de données. Le service est prêt dès que Apache/PHP démarre.
- **Pas de migrations, pas de clés immuables.** phpMyAdmin ne stocke rien entre
  les redémarrages, il n'y a donc pas de schéma à migrer et aucune clé
  cryptographique qui puisse être corrompue lors d'un redéploiement. Le
  redéploiement ou le changement de version d'image présente un faible risque.
- **Connexion sans état, basée sur les cookies.** Les utilisateurs se
  connectent sur la page phpMyAdmin avec le **nom d'utilisateur et le mot de
  passe du serveur MySQL cible** ; la session réside dans un cookie de courte
  durée. phpMyAdmin ne persiste jamais ces identifiants. Il n'y a pas de
  « compte administrateur » phpMyAdmin à créer après le déploiement.
- **Sélection de la cible MySQL.** Vérifiez les variables d'environnement
  `PMA_*` injectées sur la révision en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
  Avec `PMA_ARBITRARY = "1"`, la page de connexion affiche un champ de serveur ; avec un
  `pma_host` fixe, les utilisateurs ne voient que le nom d'utilisateur/mot de
  passe pour ce seul serveur.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent `/` — Apache sert la page de connexion avec un `200`
  une fois que PHP est opérationnel. Le premier démarrage est rapide (quelques
  secondes) ; aucune longue fenêtre de migration n'est nécessaire.
- **Posture de sécurité.** phpMyAdmin expose l'administration complète de la
  base de données à quiconque peut l'atteindre *et* détient des identifiants
  MySQL valides. Étant donné que le service est public par défaut, protégez-le
  avec IAP ou un équilibreur de charge HTTPS + Cloud Armor, et restreignez
  `PMA_ARBITRARY` à `"0"` avec un `pma_host` fixe si les utilisateurs ne
  doivent atteindre qu'un seul serveur.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
phpMyAdmin sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application et cible MySQL {#group-3--application-identity--mysql-target}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `phpmyadmin` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image phpMyAdmin ; `latest` se résout en `5.2.2` épinglé. Épinglez explicitement en production. |
| `pma_arbitrary` | `"1"` | `"1"` affiche une boîte de saisie de serveur (les utilisateurs saisissent n'importe quel hôte) ; `"0"` restreint à `pma_host`. |
| `pma_host` | `""` | Hôte MySQL/MariaDB fixe (injecté comme `PMA_HOST`). Laissez vide en mode arbitraire ; définissez une IP privée Cloud SQL pour épingler un serveur. |
| `pma_port` | `"3306"` | Port MySQL cible (injecté comme `PMA_PORT`). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Image de conteneur et exécution {#group-4--container-image--runtime}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | phpMyAdmin est livré sous forme de build personnalisé léger (`FROM phpmyadmin/phpmyadmin`) ; conservez `custom`. |
| `container_port` | `80` | Apache écoute sur le port 80. |
| `cpu_limit` | `1000m` | CPU par instance ; phpMyAdmin est léger. |
| `memory_limit` | `512Mi` | Mémoire par instance (le minimum de gen2 est 512 MiB). |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — pas de travail en arrière-plan à maintenir actif. |
| `min_instance_count` | `0` | Forcé à `0` par le module (scale-to-zero). |
| `max_instance_count` | `3` | Plafond de coût / limite de concurrence. |
| `execution_environment` | `gen2` | gen2 recommandé. |
| `container_protocol` | `http1` | phpMyAdmin sert HTTP/1.1. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image phpMyAdmin dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut. Envisagez `internal-and-cloud-load-balancing` ou IAP pour un outil d'administration de base de données. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Requis pour atteindre un serveur MySQL à IP privée. |
| `enable_iap` | `false` | Exiger la connexion Google — **fortement recommandé** pour phpMyAdmin. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | phpMyAdmin est sans état — aucun bucket n'est créé à moins que vous n'activiez cette option et n'ajoutiez `storage_buckets`. |
| `enable_nfs` | `false` | phpMyAdmin est sans état — NFS n'est pas requis. |
| `gcs_volumes` | `[]` | Non nécessaire pour phpMyAdmin. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — phpMyAdmin n'a pas sa propre base de données. Ne définissez pas de moteur. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` | La page de connexion renvoie `200` une fois que PHP est opérationnel. |
| `liveness_probe` | HTTP `/` | Sonde de vivacité. |
| `uptime_check_config` | _(défini)_ | Vérification de disponibilité Cloud Monitoring (uniquement lorsqu'il est accessible publiquement). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Limitation de débit/détection de bots optionnelle pour les déploiements publics ; non requise. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison Redis si activé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (vides pour phpMyAdmin). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide pour phpMyAdmin). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — IAP
> sans identités autorisées, un environnement d'exécution `gen1` avec des
> montages NFS/GCS, un `redis_port` hors plage, `min_instance_count` au-dessus de
> `max_instance_count`. Une configuration invalide fait échouer le **plan** avec une
> erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que
> la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment
> de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ingress_settings` / `enable_iap` | Restreindre ou protéger avec IAP | Critique | phpMyAdmin est une administration complète de base de données ; le laisser public sans IAP expose chaque serveur MySQL accessible aux attaques par bourrage d'identifiants et par force brute. |
| `pma_host` + `PMA_ARBITRARY = "0"` | Épingler un serveur pour un accès restreint | Élevé | Avec `PMA_ARBITRARY = "1"`, les utilisateurs peuvent cibler *n'importe quel* hôte MySQL accessible, élargissant le rayon d'action d'une session compromise. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Élevé | Sans egress VPC vers des plages privées, phpMyAdmin ne peut pas atteindre un serveur MySQL à IP privée Cloud SQL — la page de connexion ne se connecte à rien. |
| `database_type` | `NONE` (fixe) | Moyen | La définition d'un moteur provisionne une instance Cloud SQL inutilisée et entraîne des coûts inutiles ; la variante GKE bloque cela au moment de la planification, Cloud Run gaspille simplement la ressource. |
| `application_version` | Épingler explicitement (par exemple `5.2.2`) | Moyen | `latest` se résout en `5.2.2` épinglé aujourd'hui ; épinglez en production pour qu'un changement de tag en amont ne déplace jamais l'image sous vous. |
| `memory_limit` | `512Mi` | Faible | En dessous du seuil de 512 MiB de gen2, le plan est rejeté ; phpMyAdmin n'a guère besoin de plus. |
| `min_instance_count` | `0` (par défaut) | Faible | Le scale-to-zero ajoute quelques secondes de latence de démarrage à froid à la première requête après l'inactivité — acceptable pour un outil interactif. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à phpMyAdmin partagée avec la variante GKE est décrite
dans **[PhpMyAdmin_Common](PhpMyAdmin_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PhpMyAdmin sur Cloud Run](../labs/PhpMyAdmin_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [PhpMyAdmin sur GKE Autopilot](PhpMyAdmin_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [PhpMyAdmin Common — Configuration d'application partagée](PhpMyAdmin_Common.md) — la configuration partagée par les deux cibles de déploiement.
