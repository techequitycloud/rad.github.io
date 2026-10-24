---
title: "PhpMyAdmin sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de PhpMyAdmin sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/PhpMyAdmin_GKE.md @ e69407af sha256:ffc0b0df580e -->

# PhpMyAdmin sur GKE Autopilot {#phpmyadmin-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PhpMyAdmin_GKE.png" alt="PhpMyAdmin sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

phpMyAdmin est l'outil web open-source (GPLv2) le plus populaire pour
administrer les bases de données MySQL et MariaDB via le navigateur — parcourir
et modifier les tables, exécuter des requêtes SQL, gérer les utilisateurs et
importer/exporter des données. Ce module déploie phpMyAdmin sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par phpMyAdmin et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls et le cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte PhpMyAdmin sur RAD, et comment cela se compare {#what-phpmyadmin-costs-on-rad-and-how-that-compares}

**L'exécution de PhpMyAdmin dans votre propre projet Google Cloud coûte environ 24,04 US$/mois en infrastructure, plus des frais de module uniques de 40 crédits RAD** (dimensionnés à 0,5 vCPU / 0,5 GiB sur les pods GKE Autopilot). RAD facture les frais de module une seule fois, au moment du déploiement — jamais plus lors d'une mise à jour — plus le temps de build mesuré en crédits ; l'utilisation de Google Cloud elle-même est facturée à votre propre compte de facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les mêmes ressources sont mesurées toutes les heures en crédits au prix catalogue plus la marge de RAD — environ 55 crédits/jour — et les frais de module sont inférieurs de 10 %, soit 36 crédits. Voir "Mettez-le en pause gratuitement" ci-dessous pour savoir comment un déploiement PhpMyAdmin géré par RAD peut être arrêté, sans frais d'exécution, jusqu'à ce que vous en ayez à nouveau besoin. (ou consultez le [guide Cloud Run](PhpMyAdmin_CloudRun.md) pour l'option à moindre coût)

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Article | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 40 crédits (une fois) | 36 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût d'exécution Google Cloud | ~24,04 US$/mois, facturés à votre propre compte de facturation au prix catalogue de Google | ~55 crédits/jour, mesurés toutes les heures au prix catalogue + marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 0,5 vCPU / 0,5 GiB | 18,04 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 |
| Frais de gestion de cluster GKE\* | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **24,04 $** |

\* Non inclus dans le total ci-dessus — il est partagé entre toutes les applications GKE exécutées dans le même projet, il est donc de 0 $ si c'est votre seul cluster GKE.

### Comment cela se compare {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel, directement comparable, pour ce projet open-source exact, donc la comparaison honnête est un serveur autogéré nu : Hetzner CPX22 (2 vCPU/4 Go, ~24 $/mois), un DigitalOcean 2 vCPU/4 Go Droplet (~24 $/mois), ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, ~49 $/mois). L'empreinte de cette application (1 vCPU ou moins, 1 GiB ou moins) est plus petite que n'importe laquelle de ces classes, donc une machine autogérée nue dimensionnée pour correspondre coûterait moins cher que les chiffres ci-dessus — mais vous seriez toujours responsable de chaque correctif, sauvegarde et mise à jour de sécurité.
- RAD ne prétend **pas** battre un VPS nu sur le prix affiché — ce n'est généralement pas le cas. Ce que RAD ajoute pour le même montant ou un montant similaire est une base de données gérée, des identifiants conservés dans Secret Manager, la surveillance et la mise à jour en un clic, dont aucun n'est fourni gratuitement par un VPS nu.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du système d'exploitation/de la base de données, effectuez et testez les sauvegardes, et renouvelez les certificats ; Cloud SQL géré par RAD, Secret Manager et la surveillance gèrent les trois pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option principale sur un projet **géré par RAD**, et elle est gratuite
pendant la pause. La suppression d'un projet géré par RAD délie d'abord sa
facturation, puis demande à Google de supprimer le projet lui-même — la
suppression logique récupérable de 30 jours de Google. Contrairement à la
suppression d'un seul module, cela ne détruit pas la base de données, aucune VM
ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et comme la facturation est déjà déliée, rien n'est facturé pendant
qu'il attend.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration — dans les 30 jours, et uniquement par le propriétaire du projet
— demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter Update sur chaque déploiement pour
confirmer que tout est revenu. Parce que rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes :
c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau les frais de module. L'ensemble de la restauration ne coûte
qu'une poignée de crédits (moins de 1 US$) en temps de build pour une chaîne de
déploiements typique. Ce qu'il faut : vous devez être propriétaire du projet (pas
seulement faire gérer sa facturation par RAD), vous devez le restaurer vous-même
dans les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, de sorte que
votre solde de crédits achetés doit toujours dépasser le seuil du palier (100
crédits pour le palier sandbox que la plupart des utilisations d'étude et de
démonstration conviennent). Google indique que la plupart des services
fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, de sorte que le bucket de sauvegarde est très
probablement supprimé dès que vous supprimez le projet — même si le projet
lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce
déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde
(vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour
une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **propre projet** (ou un projet géré par RAD au-delà de
sa fenêtre de restauration de 30 jours), consiste à supprimer PhpMyAdmin
purement et simplement et à le redéployer plus tard. Un redéploiement coûte à
nouveau les frais de module plus les builds — environ **43-46 crédits** au total
pour ce module.

La suppression ne permet d'économiser de l'argent que si PhpMyAdmin devait
rester inutilisé suffisamment longtemps pour compenser ce coût de redéploiement
par rapport à son propre coût d'exécution — pour ce module, cela représente
environ 6 jours ou plus d'inactivité, basé sur son propre coût d'exécution de
24,04 US$/mois ci-dessus. La majeure partie de ce coût d'exécution est
généralement la base de données et toute VM de fichier/cache partagée, et elles
ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la
suppression de cette application seule n'économise que sa propre part de
calcul si quelque chose d'autre partage le projet.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
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

phpMyAdmin s'exécute comme une charge de travail web **PHP + Apache sans état**
sur GKE Autopilot. C'est l'un des déploiements les plus légers de ce dépôt — il
ne connecte que les services dont il a vraiment besoin :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache, autoscalés ; facturés pour le CPU/mémoire demandé |
| Base de données | **Aucune provisionnée** | phpMyAdmin n'a pas sa propre base de données ; il se connecte à un serveur MySQL/MariaDB *externe* que vous lui indiquez |
| Stockage d'objets | **Aucun** | Sans état — aucun bucket GCS n'est créé |
| Cache | Redis (optionnel, désactivé) | Uniquement pour la limitation de débit/détection de bots sur les déploiements publics ; non requis |
| Secrets | **Aucun généré** | phpMyAdmin ne détient aucun secret ; les utilisateurs se connectent avec les propres identifiants du serveur MySQL cible |
| Image de conteneur | Artifact Registry | Build personnalisé léger `FROM phpmyadmin/phpmyadmin`, mis en miroir et épinglé par tag |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe par défaut ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Aucune base de données n'est provisionnée pour phpMyAdmin.** `database_type = "NONE"` est
  fixe et appliqué par une garde de validation au moment de la planification.
  phpMyAdmin est un *client* — il administre un serveur MySQL qui se trouve
  ailleurs (l'IP privée Cloud SQL de la plateforme, une autre instance Cloud
  SQL, ou tout hôte MySQL/MariaDB accessible). Rien ici ne crée ce serveur.
- **La cible MySQL est sélectionnée par des variables d'environnement, pas par
  le code.** `PMA_ARBITRARY = "1"` (la valeur par défaut) affiche une boîte de saisie de
  serveur sur la page de connexion afin que les utilisateurs puissent taper
  n'importe quel hôte. Définissez `pma_host` (et `PMA_ARBITRARY = "0"`) pour épingler un
  seul serveur.
- **Aucun secret n'est généré.** Il n'y a pas de clé de chiffrement, de secret
  JWT ou de mot de passe d'application à protéger. L'authentification se fait
  par rapport aux propres comptes de la *base de données cible* (authentification
  par cookie).
- **Déploiement sans état, minimum 1 réplica.** `workload_type` par défaut est un
  `Deployment` (pas un StatefulSet — il n'y a pas d'état par pod) et GKE
  maintient au moins un réplica en cours d'exécution (pas de mise à l'échelle à
  zéro) afin que la console soit toujours accessible.
- **Exposé via un LoadBalancer externe** (`service_type = "LoadBalancer"`). Étant donné que
  phpMyAdmin est un outil puissant d'administration de base de données,
  envisagez sérieusement de le placer derrière **IAP** (via Ingress) ou de
  restreindre le LoadBalancer avant de l'exposer à Internet.
- **NFS et Redis sont désactivés par défaut.** phpMyAdmin ne conserve aucun
  état ; activez Redis uniquement pour la protection contre les abus sur un
  déploiement public.
- **Le conteneur écoute sur le port 80** (Apache `apache2-foreground`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail phpMyAdmin {#a-gke-autopilot--the-phpmyadmin-workload}

Les pods phpMyAdmin sont planifiés sur Autopilot, qui facture le CPU/mémoire
demandé par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimum et maximum de réplicas. Le conteneur écoute
sur le **port 80**.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail phpMyAdmin pour voir les pods et les événements. Kubernetes Engine
  → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  # Confirm the MySQL-target env vars injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep PMA_
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et
le type de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Le serveur MySQL/MariaDB cible (externe) {#b-the-target-mysqlmariadb-server-external}

phpMyAdmin ne provisionne **pas** de base de données — il se connecte à une base
de données que vous avez déjà. Cette cible est sélectionnée via `pma_host` /
`pma_port` (fixe) ou `PMA_ARBITRARY = "1"` (l'utilisateur tape l'hôte à la
connexion). Un modèle courant consiste à pointer phpMyAdmin vers l'IP privée
Cloud SQL partagée de la plateforme :

- **Console :** SQL → sélectionnez l'instance pour trouver son **IP privée** et
  son nom de connexion.
- **CLI :**
  ```bash
  # Find a MySQL instance's private IP to use as pma_host:
  gcloud sql instances list --project "$PROJECT" --filter="databaseVersion~MYSQL"
  gcloud sql instances describe <instance-name> --project "$PROJECT" \
    --format='value(ipAddresses[0].ipAddress)'
  ```

Les pods atteignent un serveur MySQL à IP privée directement via le réseau VPC
du cluster (aucun sidecar Auth Proxy n'est nécessaire — `enable_cloudsql_volume` est
`false` pour phpMyAdmin car il n'utilise pas l'intégration Cloud SQL
propre à la plateforme). Les utilisateurs s'authentifient sur la page de
connexion phpMyAdmin avec les propres comptes MySQL de cette base de données.

### C. Cloud Storage {#c-cloud-storage}

**Non utilisé.** phpMyAdmin est sans état et ne déclare aucun bucket GCS.
L'importation/exportation dans l'interface utilisateur de phpMyAdmin diffuse les
fichiers via le navigateur, et non vers GCS.

### D. Redis (protection optionnelle contre les abus) {#d-redis-optional-abuse-protection}

Redis est **désactivé par défaut** (`enable_redis = false`). Il n'est pertinent que si
vous activez la limitation de débit/détection de bots de phpMyAdmin sur un
déploiement public. Lorsqu'il est désactivé, phpMyAdmin fonctionne
entièrement — Redis n'est pas requis pour un fonctionnement normal.

- **CLI (uniquement si activé) :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager {#e-secret-manager}

**Aucun secret n'est généré par ce module.** phpMyAdmin ne détient aucune clé de
chiffrement, secret JWT ou mot de passe d'application — la connexion se fait
avec les propres identifiants du serveur MySQL cible, saisis sur la page de
connexion phpMyAdmin et jamais stockés. Vous pouvez toujours ajouter votre
propre `secret_environment_variables`, que la fondation matérialise via l'intégration Secret
Store CSI.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~phpmyadmin"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI.

### F. Réseau et Ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = "LoadBalancer"`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une IP statique peut être réservée afin que
l'adresse survive aux redéploiements. IAP (via Ingress) peut contrôler l'accès
avec la connexion Google — fortement recommandé pour un outil
d'administration de base de données.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring. Des tests de disponibilité
et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application PhpMyAdmin {#3-phpmyadmin-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a
  pas de job `db-init` et aucun schéma à créer — phpMyAdmin n'a pas sa
  propre base de données. Le pod est prêt dès que Apache/PHP démarre.
- **Pas de migrations, pas de clés immuables.** phpMyAdmin ne stocke rien entre
  les redémarrages, il n'y a donc pas de schéma à migrer et aucune clé
  cryptographique qui pourrait être corrompue lors d'un redéploiement. Les
  mises à jour continues et les augmentations de version présentent un faible
  risque.
- **Déploiement sans état.** `workload_type` se résout en un `Deployment` et
  `stateful_pvc_enabled` est désactivé — il n'y a pas d'état par pod à préserver. Une
  mise à jour continue est sûre car les pods ne partagent ni volume ni verrou.
- **Connexion par cookie.** Les utilisateurs se connectent sur la page phpMyAdmin
  avec le **nom d'utilisateur et le mot de passe du serveur MySQL cible** ; la
  session vit dans un cookie de courte durée. phpMyAdmin ne persiste jamais ces
  identifiants, et il n'y a pas de "compte administrateur" phpMyAdmin à créer
  après le déploiement.
- **Sélection de la cible MySQL.** Vérifiez les variables d'environnement
  `PMA_*` injectées sur le pod en cours d'exécution :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep PMA_
  ```
  Avec `PMA_ARBITRARY = "1"`, la page de connexion affiche un champ de serveur ; avec un
  `pma_host` fixe, les utilisateurs ne voient que le nom d'utilisateur/mot de
  passe pour ce seul serveur.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent `/` — Apache sert la page de connexion avec un
  `200` une fois que PHP est démarré. Le premier démarrage est rapide ;
  aucune longue fenêtre de migration n'est nécessaire.
- **Posture de sécurité.** phpMyAdmin expose l'administration complète de la
  base de données à quiconque peut atteindre le LoadBalancer *et* détient des
  identifiants MySQL valides. Protégez-le avec IAP ou restreignez le Service, et
  définissez `PMA_ARBITRARY = "0"` avec un `pma_host` fixe si les utilisateurs ne
  doivent atteindre qu'un seul serveur.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
phpMyAdmin sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard de App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard de App_GKE.

### Groupe 3 — Identité de l'application et cible MySQL {#group-3--application-identity--mysql-target}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `phpmyadmin` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image phpMyAdmin ; `latest` se résout en `5.2.2` épinglé. Épinglez explicitement en production. |
| `pma_arbitrary` | `"1"` | `"1"` affiche une boîte de saisie de serveur (les utilisateurs tapent n'importe quel hôte) ; `"0"` restreint à `pma_host`. |
| `pma_host` | `""` | Hôte MySQL/MariaDB fixe (injecté comme `PMA_HOST`). Laissez vide en mode arbitraire ; définissez-le sur une IP privée Cloud SQL pour épingler un serveur. |
| `pma_port` | `"3306"` | Port MySQL cible (injecté comme `PMA_PORT`). |

Toutes les autres entrées suivent le comportement standard de App_GKE.

### Groupe 4 — Image de conteneur et exécution {#group-4--container-image--runtime}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | phpMyAdmin est livré sous forme de build personnalisé léger (`FROM phpmyadmin/phpmyadmin`) ; conservez `custom`. |
| `container_port` | `80` | Apache écoute sur le port 80. **Codé en dur** — la sortie de configuration de `PhpMyAdmin_Common` fixe `container_port = 80` sans que l'entrée `container_port` ne soit transmise par cette variable, donc la définition d'une valeur différente dans `deploy.tfvars` n'a aucun effet sur la charge de travail déployée. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE n'a pas de mise à l'échelle à zéro, maintenez ≥ 1 pour que la console soit accessible. **Codé en dur** — `phpmyadmin.tf` fusionne `min_instance_count = 1` directement dans la configuration de l'application que `App_GKE` déploie (`local.selected_module.min_instance_count`, pas le `var.min_instance_count` de niveau supérieur), donc cette entrée est immunisée contre les surcharges utilisateur. |
| `max_instance_count` | `3` | Réplicas maximum. |
| `enable_cloudsql_volume` | `false` | phpMyAdmin n'utilise pas l'intégration Cloud SQL de la plateforme ; il se connecte directement à un hôte MySQL externe. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image phpMyAdmin dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard de App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `PMA_HOST` / `PMA_PORT` / `PMA_ARBITRARY` sont définis à partir des entrées du groupe 3. |
| `secret_environment_variables` | `{}` | Optionnel — phpMyAdmin ne génère aucun secret propre. |

Toutes les autres entrées suivent le comportement standard de App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | LoadBalancer externe par défaut. Envisagez `ClusterIP` derrière un Ingress protégé par IAP pour un outil d'administration de base de données. |
| `workload_type` | `null` → `Deployment` | Déploiement sans état ; pas de StatefulSet nécessaire. |
| `session_affinity` | `None` | Non requis — phpMyAdmin ne conserve aucun état de session par pod au-delà du cookie du navigateur. |

Toutes les autres entrées suivent le comportement standard de App_GKE.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe et appliqué par une garde de validation au moment de la planification. phpMyAdmin n'a pas sa propre base de données. |

Toutes les autres entrées suivent le comportement standard de App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | phpMyAdmin est sans état — NFS n'est pas requis. |

Toutes les autres entrées suivent le comportement standard de App_GKE.

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Limitation de débit/détection de bots optionnelle pour les déploiements publics ; non requise. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison Redis si activé. |

Toutes les autres entrées suivent le comportement standard de App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre phpMyAdmin. |
| `storage_buckets` | Buckets Cloud Storage créés (vides pour phpMyAdmin). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (vides pour phpMyAdmin). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md) et une garde
> locale au module (`validation.tf`), qui valide les valeurs *et les
> combinaisons* au moment de la planification — `database_type` autre que
> `NONE`, IAP sans identifiants OAuth, `min_instance_count` au-dessus de
> `max_instance_count`. Une configuration invalide fait échouer le **plan** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que la
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à
> l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `service_type` / `enable_iap` | Restreindre ou protéger avec IAP | Critique | phpMyAdmin est une administration complète de base de données ; un LoadBalancer externe non authentifié expose chaque serveur MySQL accessible aux attaques par bourrage d'identifiants et par force brute. |
| `pma_host` + `PMA_ARBITRARY = "0"` | Épingler un serveur pour un accès restreint | Élevé | Avec `PMA_ARBITRARY = "1"`, les utilisateurs peuvent cibler *n'importe quel* hôte MySQL accessible, élargissant la zone d'impact d'une session compromise. |
| `database_type` | `NONE` (fixe) | Élevé | Toute autre valeur échoue à la garde de validation du module au moment de la planification — cela provisionnerait autrement une instance Cloud SQL inutilisée et entraînerait des coûts. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette `min > max`. Maintenir 1 garantit que la console est toujours accessible. |
| `enable_iap` sans identifiants OAuth | Fournir `iap_oauth_client_id`/`_secret` | Élevé | L'activation d'IAP sans identifiants le désactive silencieusement, exposant phpMyAdmin sans authentification — bloqué par une garde au moment de la planification. |
| `application_version` | Épingler explicitement (par exemple `5.2.2`) | Moyen | `latest` se résout en `5.2.2` épinglé aujourd'hui ; épinglez en production pour qu'un changement de tag en amont ne modifie jamais l'image sous vous. |
| `enable_cloudsql_volume` | `false` | Faible | phpMyAdmin se connecte directement à un hôte MySQL externe et n'utilise pas l'intégration Cloud SQL de la plateforme ; le laisser désactivé est correct. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization et VPC-SC — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à phpMyAdmin partagée avec la variante Cloud Run est
décrite dans **[PhpMyAdmin_Common](PhpMyAdmin_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PhpMyAdmin sur GKE Autopilot](../labs/PhpMyAdmin_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [PhpMyAdmin sur Google Cloud Run](PhpMyAdmin_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [PhpMyAdmin Common — Configuration d'application partagée](PhpMyAdmin_Common.md) — la configuration partagée par les deux cibles de déploiement.
