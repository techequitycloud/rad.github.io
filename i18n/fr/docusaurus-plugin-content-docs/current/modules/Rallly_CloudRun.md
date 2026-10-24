---
title: "Rallly sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Rallly sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Rallly_CloudRun.md @ 1665a43e sha256:74932fa4a364 -->

# Rallly sur Google Cloud Run {#rallly-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Rallly_CloudRun.png" alt="Rallly sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Rallly est une application open-source et auto-hébergée de planification de réunions et de sondages de groupe —
une alternative respectueuse de la vie privée à Doodle — construite avec Next.js et Prisma. Ce module
déploie Rallly sur **Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Rallly et sur la manière de les explorer et de les
opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Rallly sur RAD, et comment cela se compare {#what-rallly-costs-on-rad-and-how-that-compares}

**L'exécution de Rallly dans votre propre projet GCP coûte environ 70,19 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~70,19 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~26 crédits/jour, facturé à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **70,19 $** |

### Comment cela se compare {#how-it-compares}

- Le plan Pro hébergé de Rallly coûte **6 $/siège/mois, facturé annuellement** (source : https://rallly.co/pricing) — un prix SaaS par siège plutôt que des frais d'hébergement fixes, donc il ne se compare directement qu'une fois que vous connaissez votre propre nombre de sièges.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces — un Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un DigitalOcean 2 vCPU/4 Go Droplet coûte également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Un outil de planification et de sondage de groupe est utilisé par intermittence autour de la planification d'une réunion, pas en continu, donc ce coût d'exécution est ce qui génère la facture bien plus que les frais de module.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD délie d'abord
sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression
logique récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne
détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de
récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter
Update sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une
vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau.
Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement
typique de 2-3.

Ce qu'il faut pour cela : vous devez être propriétaire du projet (pas un projet dont RAD ne gère
que la facturation), vous devez le restaurer vous-même dans les 30 jours — après quoi Google le
supprime définitivement — et la restauration est admise comme la création d'un nouveau projet,
donc votre solde de crédits achetés doit toujours atteindre le seuil du niveau (100 crédits pour
le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la
plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une
restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du
projet, et ce bucket a la suppression logique de Cloud Storage explicitement désactivée, il est
donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même
est récupérable pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet)
avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Rallly purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 75 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Rallly restait inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 3 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données ; elle ne s'arrête que lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation :** un formateur anime une session pour une classe. Chaque participant
  obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la
  limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places,
  soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits
  non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un
  client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client.
  Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de
  sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et
  les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
  par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://rallly.co/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Rallly s'exécute comme un conteneur Next.js unique sur Cloud Run v2. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Next.js, 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; prise en charge de la mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Rallly ne prend pas en charge MySQL ou d'autres moteurs |
| E-mail | Relais SMTP (externe) | Connexion par e-mail sans mot de passe ; fournissez votre propre hôte/informations d'identification SMTP |
| Secrets | Secret Manager | `SECRET_PASSWORD` et `NEXTAUTH_SECRET` auto-générés ; `SMTP_PWD` facultatif ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée ; la sélection de tout autre moteur interrompt le démarrage. Tout l'état de
  Rallly (sondages, votes, commentaires, utilisateurs) réside dans cette base de données.
- **`SECRET_PASSWORD` et `NEXTAUTH_SECRET` sont générés automatiquement** et stockés
  dans Secret Manager. Ces clés ne doivent pas être renouvelées après le premier démarrage sans
  fenêtre de maintenance — le renouvellement de `SECRET_PASSWORD` invalide les données
  précédemment chiffrées, et le renouvellement de `NEXTAUTH_SECRET` invalide toutes les
  sessions actives et les liens de connexion en cours.
- **La connexion Rallly est sans mot de passe et basée sur l'e-mail.** Les utilisateurs
  s'inscrivent et se connectent en recevant un lien/code de vérification, de sorte qu'une
  configuration SMTP fonctionnelle est effectivement requise avant que quiconque puisse se
  connecter. Cette variante définit `smtp_host` par défaut sur `smtp.gmail.com` ;
  vous devez toujours fournir `smtp_user` / `smtp_password` (ou effacer
  `smtp_host`) pour que le courrier soit réellement envoyé.
- **L'URL de base publique est définie automatiquement.** `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL`
  par défaut à l'URL Cloud Run déterministe de ce service et sont corrigés à l'exécution
  à partir de `CLOUDRUN_SERVICE_URL` par le point d'entrée. Définissez `base_url` sur votre
  domaine personnalisé avant de passer en production afin que les liens d'invitation et de
  connexion se résolvent correctement.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`, `max = 1`). Les
  démarrages à froid ajoutent quelques secondes de latence à la première requête après l'inactivité ;
  définissez `min_instance_count = 1` pour maintenir le service actif.
- **NFS et Redis sont désactivés.** Rallly stocke tout l'état dans PostgreSQL et n'a pas besoin
  de système de fichiers partagé ou de cache ; les deux sont désactivés par défaut (Redis est
  désactivé en dur).
- **Les migrations s'exécutent au démarrage.** Le propre `./docker-start.sh` du conteneur exécute
  `prisma migrate deploy` à chaque démarrage, de sorte que les mises à niveau de version
  appliquent les modifications de schéma sans étape de migration distincte. Le job
  `db-init` ne provisionne que la base de données et le rôle vides.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Rallly {#a-cloud-run--the-rallly-service}

Rallly s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre le
nombre minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et
la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Rallly stocke toutes les données de l'application (sondages, options, participants, votes, commentaires et
comptes d'utilisateurs) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte
privément via le **proxy d'authentification Cloud SQL** sur un socket Unix
(`enable_cloudsql_volume = true`) ; aucune IP publique n'est exposée. Lors du premier déploiement, le
job `db-init` crée la base de données et le rôle de l'application ; Rallly applique ensuite son propre
schéma Prisma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`rallly`), l'utilisateur (`rallly`) et le secret du mot de passe se trouvent dans
les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la
rotation des mots de passe.

### C. E-mail (SMTP) {#c-email-smtp}

Rallly envoie des e-mails de connexion/vérification et d'invitation via un relais SMTP externe.
Lorsque `smtp_host` est défini, le conteneur reçoit `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_SECURE` et le secret `SMTP_PWD`. Il n'y a pas de service de messagerie Google géré —
fournissez le vôtre (Gmail SMTP, SendGrid, Mailgun, etc.).

- **CLI (vérifier les paramètres injectés sur la révision en cours d'exécution) :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager :
`SECRET_PASSWORD` (secret de chiffrement des données/session de Rallly) et `NEXTAUTH_SECRET`
(signe les jetons de session NextAuth et les liens de connexion par e-mail). Un troisième, `SMTP_PWD`, est créé
uniquement lorsque SMTP est configuré. Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~rallly"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un
domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les paramètres d'ingress et le contrôle
d'egress VPC contrôlent la connectivité. Définissez `base_url` sur le nom d'hôte public afin que
les liens d'invitation et de connexion de Rallly correspondent à l'adresse que les utilisateurs visitent réellement.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud
Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Rallly {#3-rallly-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le proxy d'authentification Cloud SQL et crée de manière idempotente
  la base de données et le rôle de l'application, accorde les privilèges, puis signale au proxy de s'arrêter.
  Il est configuré avec `max_retries = 3` et peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Le propre `./docker-start.sh` de Rallly exécute
  `prisma migrate deploy` à chaque démarrage, de sorte que le schéma est créé au premier démarrage
  après `db-init` et la mise à niveau de la version de l'application applique les modifications de schéma sans
  étape de migration distincte.
- **`SECRET_PASSWORD` et `NEXTAUTH_SECRET` sont immuables après le premier démarrage.** Ils sont
  générés une fois et écrits dans Secret Manager. La modification de `SECRET_PASSWORD` invalide
  les données précédemment chiffrées ; la modification de `NEXTAUTH_SECRET` invalide toutes les sessions
  actives et les liens de connexion par e-mail en cours. Ne les faites pivoter que pendant une fenêtre de
  maintenance planifiée.
- **Connexion par e-mail sans mot de passe.** Rallly authentifie les utilisateurs via des liens/codes de
  vérification envoyés par e-mail. Sans un relais SMTP fonctionnel, les utilisateurs ne peuvent pas recevoir
  d'e-mails de connexion et ne peuvent pas se connecter. Confirmez les paramètres SMTP sur la révision en
  cours d'exécution après le déploiement.
- **URL de base publique.** `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL` sont définis à partir de l'URL
  Cloud Run prédite au moment de la planification et corrigés à l'exécution à partir de
  `CLOUDRUN_SERVICE_URL`. Si vous placez le service derrière un domaine personnalisé, définissez `base_url`
  sur celui-ci afin que les liens se résolvent à l'adresse que les utilisateurs visitent :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** La sonde de démarrage est **TCP** (pas HTTP), pas `/api/status` — le point de terminaison
  `/api/status` de Rallly ne renvoie 2xx qu'une fois que l'application signale une *pleine* disponibilité (DB + Redis
  + dépendances), de sorte qu'une sonde HTTP sur ce chemin n'a jamais réussi même si Next.js écoutait déjà
  sur :3000 ; une vérification TCP réussit dès que le port est lié, ce qui est la bonne porte pour acheminer
  le trafic. Par défaut : délai initial de 30 secondes, période de 20 secondes, 10 tentatives (~230 secondes de budget)
  pour couvrir la migration Prisma au premier démarrage. La sonde de vivacité est **désactivée par défaut** pour la
  même raison — la vivacité de Cloud Run ne peut pas utiliser un socket TCP, et une vérification HTTP sur `/api/status`
  redémarrerait en boucle un conteneur sain mais pas encore entièrement prêt ; la sonde de démarrage TCP gère déjà
  l'acheminement.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Rallly sont listés ; toute autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 2 — Identité de l'application {#group-2--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `rallly` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Rallly (`lukevella/rallly`) ; épingler à une version spécifique en production. |

### Groupe 3 — Exécution et mise à l'échelle {#group-3--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU est suffisant pour une utilisation typique. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définir `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Rallly est sans état dans Postgres et peut s'adapter horizontalement ; augmenter si nécessaire. |
| `container_port` | `3000` | Rallly écoute sur le port 3000. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes. Le pipeline de réponse de Rallly (e-mails de notification) ne s'exécute qu'après une requête, donc le CPU inactif n'est pas nécessaire. |
| `enable_cloudsql_volume` | `true` | Socket Unix du proxy d'authentification Cloud SQL pour PostgreSQL. |
| `base_url` | `""` | URL publique pour les liens `NEXT_PUBLIC_BASE_URL` / NextAuth. Vide → l'URL Cloud Run déterministe. Définir sur votre domaine personnalisé avant de passer en production. |

### Groupe 5 — Accès, Ingress et E-mail {#group-5--access-ingress--email}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Sources de trafic autorisées à atteindre le service. |
| `enable_iap` | `false` | Exiger la connexion Google devant Rallly (IAP natif de Cloud Run). |
| `smtp_host` | `smtp.gmail.com` | Nom d'hôte du relais SMTP. Une valeur non vide provisionne `SMTP_PWD` et injecte les variables d'environnement `SMTP_*`. Effacer pour désactiver l'e-mail. |
| `smtp_port` | `587` | Port SMTP (587 STARTTLS, 465 SSL). |
| `smtp_user` | `""` | Nom d'utilisateur SMTP — **définissez ceci** (avec `smtp_password`) ou la connexion par e-mail ne fonctionnera pas. |
| `smtp_password` | `""` (sensible) | Mot de passe SMTP. Vide → un secret auto-généré est stocké. |
| `smtp_secure_enabled` | `false` | Activer TLS/SSL implicite (vrai pour le port 465). |
| `mail_from` | `""` | Adresse de l'expéditeur pour `NOREPLY_EMAIL` / `SUPPORT_EMAIL`. Vide → `noreply@rallly.local`. |

### Groupe 11 — Backend de base de données {#group-11--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `rallly` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `rallly` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_type` | `POSTGRES_15` | Fixe — Rallly nécessite PostgreSQL 15. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé — Rallly stocke tout l'état dans PostgreSQL. |
| `gcs_volumes` | `[]` | Aucun volume GCS Fuse n'est requis. |

### Groupe 13 — Observabilité et santé {#group-13--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s / période de 20s / 10 tentatives | Délibérément TCP, pas HTTP `/api/status` — ce point de terminaison ne renvoie 2xx qu'à pleine disponibilité (DB + Redis + dépendances), ce qui ne permettrait jamais à un conteneur sain de commencer le routage. Prévoir la migration Prisma au premier démarrage. |
| `liveness_probe` | Désactivé (`enabled = false`) | HTTP `/api/status`, délai de 15s, mais désactivé par défaut — une vérification HTTP précoce sur ce chemin redémarrerait en boucle un conteneur sain avant la pleine disponibilité ; la sonde de démarrage TCP gère déjà le routage. |

### Groupe 20 — Cache Redis {#group-20--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Rallly n'utilise pas Redis ; laisser désactivé. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

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
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut pour Rallly). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, `enable_cloudsql_volume = true` avec `database_type = NONE`, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide échoue à la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_PASSWORD` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide les données précédemment chiffrées et les sessions actives. |
| `NEXTAUTH_SECRET` (auto-généré) | Ne faire pivoter que pendant une fenêtre de maintenance | Critique | Le faire pivoter invalide toutes les sessions actives et les liens de connexion par e-mail en cours. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Rallly ne prend en charge que PostgreSQL 15 ; tout autre moteur interrompt le démarrage. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue au job d'importation. |
| `smtp_user` / `smtp_password` | Définir lorsque `smtp_host` est défini | Élevé | Avec `smtp_host` défini (par défaut `smtp.gmail.com`) mais des identifiants vides, les e-mails de connexion ne sont jamais envoyés et les utilisateurs ne peuvent pas se connecter. |
| `base_url` | Votre domaine personnalisé | Élevé | S'il est laissé vide derrière un domaine personnalisé, les liens d'invitation et de connexion pointent vers l'URL `run.app` brute au lieu de l'adresse que les utilisateurs visitent. |
| `enable_iap` | Uniquement pour les déploiements internes | Élevé | IAP place une porte d'authentification Google devant Rallly ; les participants anonymes au sondage ne peuvent pas l'atteindre. |
| `enable_cloudsql_volume` | `true` | Élevé | Le socket du proxy d'authentification est requis pour la connectivité PostgreSQL ; une garde au moment de la planification le bloque avec `database_type = NONE`. |
| `min_instance_count` | `1` pour une utilisation sensible à la latence | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après l'inactivité. |
| `startup_probe` timing | Conserver la valeur par défaut généreuse | Moyen | Une fenêtre trop courte peut faire échouer la sonde pendant la migration Prisma au premier démarrage. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Rallly partagée
avec la variante GKE est décrite dans **[Rallly_Common](Rallly_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Rallly sur Cloud Run](../labs/Rallly_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Rallly sur GKE Autopilot](Rallly_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Rallly Common — Configuration d'application partagée](Rallly_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Flarum sur Google Cloud Run](Flarum_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md), [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md), [LimeSurvey sur Google Cloud Run](LimeSurvey_CloudRun.md) dans la solution **Communauté et Voix du client**.
