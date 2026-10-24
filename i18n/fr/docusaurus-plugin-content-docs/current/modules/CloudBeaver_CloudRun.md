---
title: "CloudBeaver sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de CloudBeaver sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CloudBeaver_CloudRun.md @ 1665a43e sha256:00b988aa9409 -->

# CloudBeaver sur Google Cloud Run {#cloudbeaver-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CloudBeaver_CloudRun.png" alt="CloudBeaver sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

CloudBeaver est un gestionnaire de base de données web accessible par navigateur,
issu du projet DBeaver — une console administrative unique pour se connecter et
interroger PostgreSQL, MySQL, SQL Server, Oracle, SQLite et de nombreux autres
moteurs. Ce module déploie CloudBeaver sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par CloudBeaver et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité du service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Coût de CloudBeaver sur RAD et comparaison {#what-cloudbeaver-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de CloudBeaver sur RAD coûte environ 19,14 $ US par mois
dans un projet Google Cloud que vous possédez, plus des frais de module uniques
de 40 crédits (4 $ US).** CloudBeaver est un gestionnaire de base de données
basé sur navigateur pour PostgreSQL, MySQL, SQL Server, Oracle, SQLite et plus
encore. GKE Autopilot convient à CloudBeaver qui doit rester actif, s'adapter
aux pods ou fonctionner à côté d'autres charges de travail Kubernetes ; pour le
coût le plus bas, ce module Cloud Run est généralement le bon choix — voir le
[guide GKE](CloudBeaver_GKE.md) si vous avez besoin de l'autre.

Si CloudBeaver n'est nécessaire qu'occasionnellement — une démo, un essai, une
charge de travail saisonnière ou d'étude — un projet géré par RAD peut être
supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte
que les 19,14 $ US deviennent quelques dollars par mois. Voir **Mettez-le en
pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6) | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **19,14 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **9 crédits par jour**, environ 270 par mois (environ 27 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un
projet géré par RAD, la base de données, le serveur de fichiers et le réseau
sont partagés par chaque application du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1,
prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 19,14 $ US** |

### Comparaison {#how-it-compares}

- Si vous l'exécutez vous-même, un petit VPS exécutant le conteneur de
  CloudBeaver coûte moins cher en espèces : un Hetzner CPX22 ou un DigitalOcean
  2 vCPU/4 Go coûte environ 24 $ par mois, ou un GCP `e2-standard-2` environ 49 $ par mois
  — plus votre propre temps pour les sauvegardes, les correctifs de sécurité et
  les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la
  surveillance couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes
  monétaires — ce n'est généralement pas le cas. La différence est ce que RAD
  gère pour vous : les correctifs, les sauvegardes, les secrets et la
  surveillance, ainsi que la possibilité de mettre CloudBeaver en pause
  gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si CloudBeaver s'exécute dans **un projet géré par RAD pour vous**, vous avez
une deuxième option qui va bien au-delà de la mise à l'échelle à zéro :
**supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour
presque rien.** Cela convient bien mieux à CloudBeaver dont vous n'avez besoin
qu'occasionnellement que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  cette attente. Contrairement à la suppression d'un module, cela ne détruit
  pas les ressources Cloud Run une par une — l'ensemble du projet, et tout ce
  qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.**
  Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à
  Google de récupérer le projet et de rattacher son compte de facturation, puis
  vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que
  tout est revenu. Comme rien n'a été détruit individuellement, cette mise à
  jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas
  une reconstruction, et une mise à jour ne facture jamais les frais de module
  à nouveau. Cela représente une poignée de crédits (moins de 1 $ US) au total
  pour une chaîne CloudBeaver typique, contre les 45 crédits que coûte un
  redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 19,14 $ US.** Déployez CloudBeaver, utilisez-le, supprimez le projet.
  Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec
  Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez
  les frais de module qu'une seule fois, les builds et les heures où il était
  réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que
  vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre
  solde de crédits achetés doit toujours dépasser le seuil du palier (100
  crédits pour le palier sandbox que la plupart des utilisations d'étude et de
  démo conviennent). Google indique que la plupart des services
  fonctionnent à nouveau pleinement dans les 36 heures suivant une
  restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les
  sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et
  ce bucket n'est **pas** protégé par la suppression logicielle de Cloud
  Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé CloudBeaver et que vous souhaitez conserver ce
  travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du
  projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run conserve une instance chaude, il ne se met donc pas complètement à
l'échelle à zéro par lui-même. L'option ci-dessus ne s'applique qu'à un projet
géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le
déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 45 crédits (4,50 $ US) dans votre propre projet. La
  suppression ne permet d'économiser de l'argent que si CloudBeaver restait
  inutilisé pendant environ 8 jours ou plus dans votre propre projet (0,64 $ US
  par jour), ou environ 5 jours ou plus dans un projet géré par RAD (9 crédits
  par jour).
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites
  dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci,
  alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez
  la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour
  vous ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant reçoit l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le
  formateur. Soit le formateur finance toutes les places, soit chaque
  participant paie la sienne. Tout est supprimé à la fin de la session et les
  crédits non utilisés sont restitués au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets
Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque
source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

CloudBeaver s'exécute comme un conteneur JVM unique sur Cloud Run v2. Parce que
CloudBeaver conserve tout son propre état dans un espace de travail persistant
et ne provisionne aucune base de données d'application, le déploiement relie
un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service JVM unique, 1 vCPU / 1 GiB par défaut, port 8978 |
| Espace de travail persistant | Cloud Storage (GCS FUSE) | Un bucket dédié monté à `/opt/cloudbeaver/workspace` contient tout l'état de CloudBeaver |
| Base de données | **Aucune provisionnée** | `database_type = "NONE"` — CloudBeaver stocke son propre état ; il *se connecte* aux bases de données que vous configurez dans l'interface utilisateur |
| Cache et file d'attente | **Aucun** | CloudBeaver n'utilise pas Redis ; `enable_redis` est désactivé |
| Secrets | Secret Manager | Aucun secret au niveau de l'application n'est généré — le compte administrateur est créé via l'assistant de configuration de première exécution |
| Ingress | URL Cloud Run / Cloud Load Balancing | **`all` par défaut** (internet public) ; définissez `ingress_settings = "internal"` pour restreindre au VPC, ou placez-le derrière un équilibreur de charge HTTPS externe |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Aucune base de données d'application n'est provisionnée.** `database_type = "NONE"`.
  CloudBeaver conserve ses métadonnées dans un magasin H2 intégré au volume de
  l'espace de travail. Les bases de données qu'il *gère* sont ajoutées par un
  opérateur dans l'interface utilisateur après le déploiement.
- **Tout l'état réside dans un espace de travail sauvegardé par GCS.** Le
  bucket `storage` est monté via GCS FUSE à `/opt/cloudbeaver/workspace`. Perdez ou
  remplacez ce bucket et vous perdrez toutes les connexions, utilisateurs et
  paramètres enregistrés.
- **Instance unique par conception.** `min_instance_count = 1` (évitez les démarrages à froid
  lents de la JVM) et `max_instance_count = 1` (l'espace de travail est un magasin à
  écrivain unique). Ne **pas** augmenter `max_instance_count` — les écrivains
  concurrents corrompent la base de données H2 intégrée.
- **L'ingress est `all` par défaut.** Le service est accessible depuis
  l'internet public dès la sortie de la boîte — une véritable considération
  pour une console d'administration de base de données. Pour restreindre
  l'accès au sein du VPC, définissez `ingress_settings = "internal"`, ou placez-le derrière
  un équilibreur de charge HTTPS externe (et IAP) pour un accès public
  contrôlé.
- **Le compte administrateur est revendiqué par le premier visiteur.**
  CloudBeaver n'a pas d'administrateur pré-configuré — complétez l'assistant de
  configuration immédiatement une fois le service accessible.
- **`application_version = "latest"` passe proprement.** L'image est construite à partir de
  `dbeaver/cloudbeaver:<version>` via un ARG de build `CLOUDBEAVER_VERSION` spécifique à l'application ;
  épinglez une balise spécifique pour des déploiements reproductibles.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service CloudBeaver {#a-cloud-run--the-cloudbeaver-service}

CloudBeaver s'exécute en tant que service Cloud Run v2 écoutant sur le port
**8978**. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements sûrs. Comme l'espace de
travail est à écrivain unique, maintenez le service à une seule instance.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the container port and image:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].ports[0].containerPort, spec.template.spec.containers[0].image)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le volume de l'espace de travail {#b-cloud-storage--the-workspace-volume}

L'état complet de CloudBeaver — sa base de données de métadonnées H2 intégrée,
les connexions enregistrées, les utilisateurs et la configuration — persiste
sous `/opt/cloudbeaver/workspace`, qui est un montage **GCS FUSE** d'un bucket Cloud Storage
dédié (le bucket `storage` déclaré par CloudBeaver_Common). Ce bucket est le
cœur durable du déploiement.

- **Console :** Cloud Storage → Buckets → le bucket `storage` de CloudBeaver.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<workspace-bucket>/          # bucket name is in the Outputs
  gcloud storage ls -r gs://<workspace-bucket>/       # inspect workspace contents
  ```

Voir [App_CloudRun](App_CloudRun.md) pour GCS FUSE (nécessite l'environnement
d'exécution gen2) et les options CMEK.

### C. Connectivité de la base de données (aucune instance gérée) {#c-database-connectivity-no-managed-instance}

Ce module ne provisionne **aucune instance Cloud SQL** — `gcloud sql instances list` n'en
affichera aucune créée par CloudBeaver. Au lieu de cela, CloudBeaver se
connecte aux bases de données que vous enregistrez dans son interface
utilisateur. Pour atteindre le Cloud SQL partagé du déploiement (ou toute base
de données privée), le service doit avoir une sortie VPC configurée (gérée par
la fondation) et la cible doit être accessible sur le VPC.

- **CLI (vérifier que le chemin de sortie existe, puis tester depuis le VPC) :**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.metadata.annotations)'   # VPC connector / egress annotations
  ```

### D. Secret Manager {#d-secret-manager}

CloudBeaver ne génère **aucun secret au niveau de l'application** — il n'y a
pas de clé de chiffrement, pas de secret JWT et pas de mot de passe de base de
données à gérer (il n'y a pas de base de données). Le compte administrateur est
créé via l'assistant de configuration de première exécution, et tout l'état
réside dans l'espace de travail. Les secrets au niveau de la fondation (le cas
échéant) suivent le modèle standard.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Le service est par défaut **`ingress_settings = "all"`** — accessible depuis l'internet
public sur l'URL `run.app` dès la sortie de la boîte, une véritable
considération pour une console d'administration de base de données. La sortie
`cloudbeaver_url` est cette URL de service public dans ce mode. Pour restreindre
l'accès au sein du VPC, définissez `ingress_settings = "internal"`, ou placez le service derrière
un équilibreur de charge HTTPS externe (éventuellement avec un domaine
personnalisé, Cloud CDN, Cloud Armor et IAP) pour un accès public contrôlé.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour l'équilibrage de charge, les domaines
personnalisés et IAP.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité
et des politiques d'alerte facultatives (`uptime_check_config.enabled` est par défaut
`false`, donc aucune n'est créée par défaut). Si vous l'activez, notez
qu'une vérification de disponibilité Cloud Monitoring n'est provisionnée que
lorsque le point de terminaison est publiquement accessible — l'ingress par
défaut `all` qualifie l'URL `run.app` ; la définition de
`ingress_settings = "internal"` supprime le point de terminaison public et, avec lui, la
possibilité de provisionner une vérification de disponibilité.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application CloudBeaver {#3-cloudbeaver-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a
  pas de job d'initialisation de base de données et pas de base de données
  d'application. CloudBeaver initialise son propre magasin de métadonnées
  intégré dans l'espace de travail au premier démarrage.
- **L'état est entièrement dans le volume de l'espace de travail.** La base de
  données H2 intégrée, les connexions enregistrées, les utilisateurs gérés et
  la configuration résident tous sous `/opt/cloudbeaver/workspace`, sauvegardés par le
  bucket GCS `storage`. Conservez ce bucket lors des redéploiements pour
  conserver tout l'état de CloudBeaver.
- **Assistant de configuration de première exécution.** Lors du premier accès,
  CloudBeaver présente un assistant de configuration pour créer la
  configuration du serveur et le compte administrateur. Il n'y a pas
  d'administrateur pré-configuré — quiconque complète l'assistant en premier
  devient l'administrateur. Faites-le immédiatement et maintenez l'ingress
  restreint jusqu'à ce que vous l'ayez fait.
- **Ajout de bases de données à gérer.** Après vous être connecté en tant
  qu'administrateur, ajoutez des connexions dans l'interface utilisateur
  (Nouvelle connexion → choisissez le pilote → fournissez l'hôte/port/les
  informations d'identification). Pour atteindre les bases de données privées
  sur le VPC, assurez-vous que la sortie VPC est configurée (gérée par la
  fondation).
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/` (l'interface utilisateur web de CloudBeaver), qui renvoie HTTP
  200 une fois que la JVM a terminé son démarrage. La sonde de démarrage par
  défaut autorise un délai initial de 15 secondes plus une fenêtre de
  nouvelles tentatives de 10 échecs — le démarrage de la JVM de CloudBeaver est
  rapide mais pas instantané.
- **Mise à l'échelle à écrivain unique.** Gardez `max_instance_count = 1`. Le magasin de
  l'espace de travail ne peut pas être partagé en toute sécurité par des
  instances concurrentes.
- **Inspecter la configuration en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques à CloudBeaver ou
remarquables pour celui-ci sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cloudbeaver` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | _(défini)_ | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Balise d'image CloudBeaver (construite à partir de `dbeaver/cloudbeaver:<version>`) ; épingler pour la reproductibilité. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance. CloudBeaver s'exécute sur la JVM — ne pas réduire en dessous de 512 Mi. |
| `min_instance_count` | `1` | Garder 1 instance chaude pour éviter les démarrages à froid lents de la JVM. |
| `max_instance_count` | `1` | **Maintenir à 1.** L'espace de travail est un magasin à écrivain unique ; les instances concurrentes le corrompent. |
| `container_port` | `8978` | Port de l'interface utilisateur web de CloudBeaver. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Internet public par défaut. Définissez `internal` pour restreindre une console de base de données au VPC, ou placez-la derrière un équilibreur de charge HTTPS + IAP pour un accès externe contrôlé. |
| `vpc_egress_setting` | _(défini)_ | Contrôle le trafic de sortie qui passe par le VPC — requis pour atteindre les bases de données privées. |
| `enable_iap` | `false` | Exiger la connexion Google devant le service (nécessite un équilibreur de charge externe). |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires passés au conteneur. CloudBeaver n'en a pas besoin pour le premier démarrage. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. Aucun secret d'application n'est généré par défaut. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets GCS, y compris le bucket de l'espace de travail CloudBeaver. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket d'espace de travail auto-provisionné. |
| `enable_nfs` | `false` | NFS est désactivé — l'espace de travail de CloudBeaver est sur GCS, pas sur NFS. |
| `gcs_volumes` | `[]` | Montages de volume GCS FUSE supplémentaires (le montage de l'espace de travail est ajouté automatiquement). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Vide — CloudBeaver n'a pas besoin de job de démarrage (pas de base de données d'application). |
| `cron_jobs` | `[]` | Pas de tâches récurrentes planifiées par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s de délai, 10 échecs | Sonde de démarrage contre l'interface utilisateur de CloudBeaver. |
| `liveness_probe` | HTTP `/` 30s de délai | Sonde de vivacité contre l'interface utilisateur de CloudBeaver. |
| `uptime_check_config` | _(défini)_ | Vérification de disponibilité Cloud Monitoring — provisionnée uniquement lorsque le point de terminaison est publiquement accessible. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).
Notez que `enable_redis` est forcé à `false` et `database_type` est `NONE` par ce module et
ne sont pas destinés à être remplacés.

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `cloudbeaver_url` | URL du service pour l'interface utilisateur web de CloudBeaver (port 8978). URL publique `run.app` sous le `ingress_settings = "all"` par défaut ; URL VPC interne lorsqu'elle est définie sur `"internal"`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de l'espace de travail). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs d'initialisation (vide par défaut). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les
> valeurs *et les combinaisons* au moment du plan — un runtime `gen1` avec
> des montages GCS FUSE, IAP sans identités autorisées, une valeur de mémoire
> hors plage inférieure au seuil de 512 Mi de gen2. Une configuration invalide
> échoue au **plan** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si erreur |
|---|---|---|---|
| Bucket de l'espace de travail `storage` | Conserver lors des redéploiements | Critique | Le bucket contient tout l'état de CloudBeaver (base de données H2 intégrée, connexions, utilisateurs, configuration). Le supprimer ou le remplacer efface tous les paramètres. |
| `max_instance_count` | `1` | Critique | L'espace de travail est à écrivain unique ; deux instances écrivant simultanément dans le magasin H2 intégré le corrompent. |
| Assistant de configuration de première exécution | Compléter immédiatement | Élevé | Il n'y a pas d'administrateur pré-configuré — quiconque accède à l'interface utilisateur en premier peut revendiquer le compte administrateur. |
| `ingress_settings` | `internal` (ou LB+IAP) | Élevé | Par défaut à `all` — une console d'administration de base de données est accessible depuis l'internet public dès la sortie de la boîte, sauf si vous définissez `internal` ou la placez derrière IAP/Cloud Armor. |
| `memory_limit` | `1Gi` (≥ 512 Mi) | Élevé | CloudBeaver est basé sur la JVM ; trop peu de mémoire provoque des arrêts OOM. gen2 rejette en dessous de 512 Mi au moment du plan. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid lent de la JVM lors de la première requête après l'inactivité. |
| `application_version` | Épingler une balise en production | Moyen | `latest` peut modifier la version de CloudBeaver entre les reconstructions ; épingler pour la reproductibilité. |
| `enable_redis` / `database_type` | Laisser tel quel (désactivé / `NONE`) | Faible | CloudBeaver n'utilise ni l'un ni l'autre ; le remplacement n'a aucun avantage et n'est pas pris en charge ici. |

---

Pour le comportement de la fondation référencé tout au long — identité du
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à CloudBeaver partagée avec la variante GKE est
décrite dans **[CloudBeaver_Common](CloudBeaver_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : CloudBeaver sur Cloud Run](../labs/CloudBeaver_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [CloudBeaver sur GKE Autopilot](CloudBeaver_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [CloudBeaver Common — Configuration d'application partagée](CloudBeaver_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Django sur Cloud Run](Django_CloudRun.md), [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Custom Application Starter**.
