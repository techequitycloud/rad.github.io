---
title: "Docuseal sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Docuseal sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Docuseal_CloudRun.md @ 1665a43e sha256:13be8fd970f5 -->

# Docuseal sur Google Cloud Run {#docuseal-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Docuseal_CloudRun.png" alt="Docuseal sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

DocuSeal est une plateforme open source de signature de documents — une
alternative auto-hébergée à DocuSign pour créer, remplir et signer des documents
PDF avec un constructeur de formulaires visuel, des modèles réutilisables et des
pistes d'audit. Ce module déploie DocuSeal sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par DocuSeal et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Ce que coûte Docuseal sur RAD, et comment cela se compare {#what-docuseal-costs-on-rad-and-how-that-compares}

**Docuseal sur le module Cloud Run de RAD coûte environ 180,87 $ US par mois, sans licence par utilisateur.** Cela se compare à 20 $ US par utilisateur et par mois pour le plan Pro hébergé de Docuseal. Un serveur auto-géré est moins cher en espèces, mais vous devez alors gérer vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. Fait inhabituel pour ce catalogue, GKE Autopilot est en fait l'option la moins chère pour Docuseal — environ 149,81 $ US par mois — car la configuration par défaut de Cloud Run de ce module maintient la puissance de calcul allouée en continu plutôt que de la réduire à zéro ; voir le [guide GKE](Docuseal_GKE.md). Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 180,87 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet que RAD gère pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **180,87 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **83 crédits par jour**, soit environ 2 490 par mois (environ 249 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (alwaysOn) | 110,42 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 180,87 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Docuseal, plan Pro (par utilisateur) | 20 $ US par mois | Docuseal |
| **RAD, Cloud Run, votre propre projet** | **Environ 180,87 $ US** | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 249 $ US** | RAD |

- Le plan Pro de Docuseal est tarifé par signataire ; même avec cinq utilisateurs (100 $ US/mois), il coûte plus cher que le coût d'exécution du projet propre à RAD, et le coût de RAD ne change pas lorsque vous ajoutez un autre signataire.
- Le plan Basic de Docuseal est gratuit mais plafonné à 10 e-mails de demande de signature par mois ; le module de RAD exécute le même logiciel open source sans une telle limite.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Docuseal s'exécute dans **un projet que RAD gère pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Docuseal dont vous n'avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un seul module, cela ne supprime pas Cloud SQL, la VM NFS ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de Docuseal, contre les 162 crédits (16,20 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 180,87 $ US.** Déployez Docuseal, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures pendant lesquelles Docuseal était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude et de démo). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé les données et que vous souhaitez les conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

La configuration par défaut de Docuseal sur Cloud Run maintient 2 vCPU et 4 GiB alloués en continu (cpu_always_allocated), donc, contrairement à la plupart des modules Cloud Run de ce catalogue, il ne se réduit **pas** à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (17,95 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Docuseal. La suppression permet d'économiser de l'argent une fois que Docuseal resterait inutilisé pendant environ **3 jours ou plus** dans votre propre projet (environ 6,03 $ US par jour), ou environ **2 jours ou plus** dans un projet géré par RAD (83 crédits par jour).
- **Supprimez tout ce que Docuseal utilise.** La majeure partie du coût d'exécution est la base de données et la VM NFS/cache. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc les supprimer pendant que quelque chose d'autre partage le projet n'économise que la partie calcul propre à Docuseal.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou dans un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Docuseal dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Docuseal pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes et la fenêtre de pause/restauration. [Tarification DocuSeal](https://www.docuseal.com/pricing) pour le chiffre du plan Pro ;

## 1. Vue d'ensemble {#1-overview}

DocuSeal s'exécute comme un conteneur Ruby on Rails (Puma) unique sur Cloud Run
v2. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Rails/Puma sur le port 3000, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — DocuSeal ne prend pas en charge MySQL ou d'autres moteurs |
| Documents persistants | Filestore / NFS | `enable_nfs = true` ; les documents téléchargés se trouvent à `/data/docuseal` |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement (pas le magasin de documents par défaut) |
| Secrets | Secret Manager | `SECRET_KEY_BASE` auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur interrompt le
  démarrage.
- **DocuSeal se connecte via TCP IP privé, pas le socket Cloud SQL.** L'analyseur
  URI de Ruby ne peut pas analyser le DSN du socket Unix de Cloud SQL, donc
  `enable_cloudsql_volume` par défaut à `false` et le point d'entrée compose un
  `DATABASE_URL` contre l'IP privée de l'instance avec `sslmode=require`.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Il
  ne doit jamais être renouvelé après le premier démarrage — cela invaliderait
  tous les cookies de session signés, déconnectant chaque utilisateur.
- **Les documents téléchargés résident sur NFS, pas dans le conteneur.**
  `enable_nfs = true` monte le volume NFS partagé à `/data/docuseal` ; sans cela,
  chaque document téléchargé est perdu lors de la prochaine révision ou du
  démarrage à froid.
- **Une instance est maintenue chaude par défaut** (`min_instance_count = 1`,
  `cpu_always_allocated = true`). DocuSeal est une application de requête/réponse dont les
  documents résident sur un NFS durable, elle peut donc se réduire à zéro en toute
  sécurité — définissez `min_instance_count = 0` pour échanger la latence de la première
  requête contre le coût.
- **Pas de Redis.** DocuSeal utilise une file d'attente/cache basée sur
  PostgreSQL, donc aucun Redis n'est requis ou câblé (`enable_redis = false`).
- **Ingress public par défaut.** `ingress_settings = "all"` pour que l'interface utilisateur de
  signature et tous les liens de signataire/API soient accessibles. L'activation
  d'IAP place une passerelle de connexion Google devant ces liens.
- **Les migrations s'exécutent au démarrage.** DocuSeal applique ses propres
  migrations ActiveRecord à chaque démarrage ; le seul job d'initialisation crée
  le rôle et la base de données PostgreSQL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de service et de ressource sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service DocuSeal {#a-cloud-run--the-docuseal-service}

DocuSeal s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en
fonction de la charge des requêtes entre le nombre minimal et maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~docuseal"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

DocuSeal stocke toutes les données de l'application (modèles, soumissions,
soumissionnaires, utilisateurs, piste d'audit) dans une instance gérée de Cloud
SQL pour PostgreSQL 15. Comme Ruby ne peut pas analyser le DSN du socket Cloud
SQL, le service se connecte via l'**IP privée** de l'instance avec `sslmode=require` (le
`DB_IP` que la fondation injecte), accessible via l'egress VPC ; aucune IP
publique n'est exposée. Lors du premier déploiement, un job d'initialisation
crée la base de données et le rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=docuseal --database=docuseal --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Filestore / NFS — documents persistants {#c-filestore--nfs--persistent-documents}

DocuSeal écrit les documents et pièces jointes téléchargés dans le système de
fichiers local à `/data/docuseal`. `enable_nfs = true` monte le volume NFS (classe
Filestore) partagé à cet endroit afin que les documents survivent aux révisions
et aux démarrages à froid.

- **Console :** Filestore → Instances (ou Compute Engine pour la VM NFS
  auto-gérée, selon la configuration de la plateforme).
- **CLI :**
  ```bash
  # Confirm the NFS mount and WORKDIR on the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='yaml(spec.template.spec.volumes, spec.template.spec.containers[0].volumeMounts)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour savoir comment le serveur NFS partagé
est découvert et monté.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** (suffixe de nom `storage`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder
l'accès. Le magasin de documents de DocuSeal utilise par défaut le volume NFS
ci-dessus, ce bucket est donc disponible pour une utilisation auxiliaire plutôt
que comme magasin de documents principal.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (utilisé par Rails pour signer les cookies de session et
autres valeurs signées). Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docuseal"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut, ce qui permet
l'accès public nécessaire aux liens de signataire et à l'interface utilisateur
de signature. Un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres
d'ingress et l'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs (Rails logue vers stdout) sont envoyés à Cloud Logging ;
les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des
tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application DocuSeal {#3-docuseal-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il crée de
  manière idempotente le rôle et la base de données `docuseal`, accorde tous les
  privilèges et réaffecte la propriété du schéma `public` au rôle de
  l'application (PostgreSQL 15 n'accorde plus `CREATE` sur `public` par
  défaut). Le job peut être réexécuté en toute sécurité.
- **Migrations au démarrage.** DocuSeal exécute ses propres migrations
  ActiveRecord automatiquement à chaque démarrage en tant que rôle de
  l'application, de sorte que la mise à niveau de la version de l'application
  applique les modifications de schéma sans étape de migration distincte.
- **`SECRET_KEY_BASE` est immuable après le premier démarrage.** Il est généré une
  fois et écrit dans Secret Manager. Le renouveler invalide tous les cookies de
  session signés, forçant chaque utilisateur à se reconnecter. Ne le renouvelez
  que pendant une fenêtre de maintenance planifiée.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent `/up` — le point de terminaison de santé intégré de Rails, qui
  renvoie un `200` non authentifié une fois l'application démarrée. La
  sonde de démarrage par défaut autorise un délai initial de 60 secondes plus
  une large fenêtre de nouvelle tentative pour les migrations au premier
  démarrage.
- **Configuration initiale.** DocuSeal n'a pas d'identifiants par défaut. Lors du
  premier accès, ouvrez l'URL du service et complétez l'écran de configuration
  pour créer le compte administrateur initial (e-mail + mot de passe) avant
  d'inviter d'autres utilisateurs ou de créer des modèles.
- **Documents persistants.** Les documents téléchargés résident à `/data/docuseal`
  sur le volume NFS. Vérifiez la connexion injectée et le répertoire de travail
  sur la révision en cours :
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
DocuSeal sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `docuseal` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image DocuSeal (`FROM docuseal/docuseal:<tag>`) ; épingler à une version spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance (2 vCPU). |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Instances maintenues chaudes. DocuSeal tolère `0` (mise à l'échelle à zéro) puisque les documents résident sur NFS. |
| `max_instance_count` | `5` | Nombre maximal d'instances. |
| `container_port` | `3000` | Puma écoute sur le port 3000. Ne pas modifier. |
| `cpu_always_allocated` | `true` | **Incohérence valeur par défaut/description :** la description de la variable elle-même indique qu'elle est "par défaut FALSE pour DocuSeal : c'est une application Rails de type requête/réponse sans planificateur d'arrière-plan ni worker de file d'attente... donc la facturation basée sur les requêtes... est moins chère sans perte fonctionnelle", mais la valeur par défaut codée est `true` (facturation basée sur l'instance). DocuSeal n'a réellement aucun worker/beat/planificateur intégré (voir [§3](#3-docuseal-application-behaviour)), donc les opérateurs qui souhaitent le comportement décrit, moins cher, devraient explicitement définir `cpu_always_allocated = false`. |
| `container_resources` | `null` | Surcharge structurée CPU/mémoire ; si définie, elle remplace `cpu_limit`/`memory_limit`. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS (et impose un plancher de mémoire de 512 MiB). |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image DocuSeal dans Artifact Registry. |
| `container_image_source` | `custom` | Wrapper léger construit à partir de `docuseal/docuseal`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés dans le conteneur. Les valeurs principales (`RAILS_LOG_TO_STDOUT`, `WORKDIR`) sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. `SECRET_KEY_BASE` est injecté automatiquement. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Monte le volume NFS partagé à `/data/docuseal` pour les documents persistants. **Gardez activé** ou les téléchargements seront perdus lors du redéploiement. |
| `nfs_mount_path` | `/data/docuseal` | Chemin de montage — doit correspondre à `WORKDIR` de DocuSeal. |
| `create_cloud_storage` | `true` | Crée les buckets GCS déclarés. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse facultatifs (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `docuseal` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `docuseal` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `enable_cloudsql_volume` | `false` | **Gardez `false`** — Ruby ne peut pas analyser le DSN du socket Cloud SQL ; DocuSeal utilise TCP IP privé avec `sslmode=require`. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (crée le rôle + la base de données). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/up`, délai de 60s | Sonde de démarrage. Laisser le temps pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/up`, délai de 60s | Sonde de vivacité contre le point de terminaison de santé de Rails. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring (points de terminaison publics uniquement) ; définir `enabled = true` pour le provisionner. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | DocuSeal utilise une file d'attente/cache basée sur PostgreSQL ; laisser désactivé. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> réplica en lecture sans son primaire, IAP sans identités autorisées, un
> runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne
> correspond pas à une extension activée, un `backup_retention_days` hors de portée. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouvellement invalide tous les cookies de session signés — chaque utilisateur est déconnecté. |
| `enable_nfs` | `true` | Critique | Le désactiver stocke les documents sur le disque éphémère du conteneur ; chaque document téléchargé est perdu lors de la prochaine révision ou du démarrage à froid. |
| `nfs_mount_path` | `/data/docuseal` | Critique | Doit correspondre à `WORKDIR` de DocuSeal ; un chemin non concordant signifie que les documents sont écrits sur un stockage non persistant. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `false` | Élevé | Ruby ne peut pas analyser le DSN du socket Cloud SQL ; l'activation du sidecar de socket interrompt le `DATABASE_URL` et le démarrage échoue. |
| `container_port` | `3000` | Élevé | Puma écoute sur le port 3000 ; un port non concordant fait que les sondes atteignent un port mort et la révision ne devient jamais prête. |
| `execution_environment` | `gen2` | Élevé | Gen1 ne peut pas monter NFS ; l'application perd le stockage de documents persistant. |
| `enable_iap` | uniquement pour usage interne | Élevé | IAP protège chaque requête derrière la connexion Google, bloquant les liens de signataire publics. |
| `memory_limit` | `4Gi` | Moyen | Le rendu/la signature PDF consomme beaucoup de mémoire ; une réduction excessive risque un OOM sous charge. |
| `min_instance_count` | `1` (ou `0` pour le coût) | Moyen | La mise à l'échelle à zéro ajoute un délai de démarrage à froid à la première requête après l'inactivité ; les documents sur NFS sont sûrs dans les deux cas. |
| `application_version` | Épingler en production | Moyen | `latest` peut tirer une nouvelle version majeure lors du redéploiement, appliquant des migrations que vous n'avez pas examinées. |
| `cpu_always_allocated` | `false` (basé sur les requêtes) | Moyen | La valeur par défaut codée est `true` (facturation basée sur l'instance), ce que la description de la variable elle-même indique comme inutile pour la charge de travail requête/réponse de DocuSeal — la laisser par défaut paie pour le CPU inactif sans avantage fonctionnel. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à DocuSeal partagée avec la variante GKE est décrite
dans **[Docuseal_Common](Docuseal_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Docuseal sur Cloud Run](../labs/Docuseal_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Docuseal sur GKE Autopilot](Docuseal_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Docuseal Common — Configuration d'application partagée](Docuseal_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md), [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) dans la solution **Small Business Suite**.
