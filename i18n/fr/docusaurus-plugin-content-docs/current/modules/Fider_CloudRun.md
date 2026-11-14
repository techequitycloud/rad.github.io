---
title: "Fider sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Fider sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Fider_CloudRun.md @ 40c83c3f sha256:915d385b5e86 -->

# Fider sur Google Cloud Run {#fider-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Fider_CloudRun.png" alt="Fider sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Fider est un tableau de bord de feedback et de vote de fonctionnalités, open source et auto-hébergé — les clients
publient des idées, votent et commentent, et vous priorisez en fonction de la demande. Ce module déploie
Fider sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Fider et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
chaque application Cloud Run — identité de service, entrée et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Fider sur RAD, et comparaison {#what-fider-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module Cloud Run de Fider sur RAD coûte environ 89 $ US par mois, plus 11 $ US une fois par déploiement et aucune licence par utilisateur.** GKE Autopilot est l'alternative pour les charges de travail qui doivent rester actives en permanence ou fonctionner à côté d'autres applications Kubernetes ; voir le [guide GKE](Fider_GKE.md), environ 136 $ US par mois. Fider est un tableau de bord de feedback et de vote de fonctionnalités open source où les clients suggèrent, discutent et votent sur des idées. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours sans frais supplémentaires au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non les 183 $ US par mois que coûte son maintien en fonctionnement. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés au temps de build à la minute | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **89 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **61 crédits par jour**, environ 1 830 par mois (environ 183 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

Votre premier déploiement réussi sur RAD est exempt des frais de module, quel que soit le montant des frais : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 2 vCPU / 4 Gio, mise à l'échelle à zéro | 32 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Passerelle et adresse IP Cloud NAT | 5 $ US |
| Cloud Storage pour les sauvegardes | 1 $ US |
| **Total** | **environ 89 $ US** |

### Comparaison {#how-it-compares}

Fider a son propre plan hébergé officiel, **Fider Pro** : le plan Pro hébergé de Fider coûte 25 $/mois (éléments de feedback illimités plus modération de contenu, mois par mois) — lu le 8 octobre 2026.

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Fider Pro (plan hébergé officiel) | 25 $/mois | Fider |
| **RAD, Cloud Run, votre propre projet** | **89 $ US**, plus 11 $ US une fois | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **environ 780 crédits (78 $ US)** | RAD |
| RAD, GKE Autopilot | environ 136 $ US ; voir le [guide GKE Autopilot](Fider_GKE.md) | RAD |

Le prix de Fider Pro a été lu sur sa propre page de tarification le 8 octobre 2026 et a pu changer depuis — vérifiez la source avant de vous fier au chiffre.

- **Fider Pro est la comparaison fixe ; un serveur autogéré est la comparaison flexible.** Sur votre propre machine Hetzner ou DigitalOcean (2 vCPU/4 Go, environ 24 $/mois) ou une instance GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, environ 49 $/mois), vous paieriez moins en espèces que l'une ou l'autre option, mais vous géreriez vous-même le système d'exploitation, la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau — exactement ce que les services Cloud SQL gérés, Secret Manager et la surveillance de RAD font pour vous.
- **Un serveur bon marché est bon marché jusqu'à ce que quelque chose tombe en panne.** Sur RAD, les sauvegardes, la récupération à un point dans le temps, la rotation des mots de passe via Secret Manager, ainsi que la journalisation et la surveillance proviennent de Google Cloud par défaut. Sur votre propre serveur, ou sur un plan hébergé à prix fixe sans contrôle d'infrastructure, chacun de ces éléments est un travail que quelqu'un doit encore faire ou une limite que vous ne pouvez pas modifier.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Fider s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la mise à l'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, sera utilisable après sa restauration. Par conséquent, la restauration ne peut pas être considérée comme un moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne démantèle pas Cloud SQL, la VM ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non les 183 $ US par mois pour le maintenir en fonctionnement.** Déployez Fider, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois et les heures pendant lesquelles il a été réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et que RAD ne gère que pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run s'adapte déjà à zéro entre les requêtes, de sorte que la majeure partie de son propre coût de calcul s'arrête d'elle-même lorsque personne ne l'utilise. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds sont inclus) : 110 crédits (11,00 $ US). La suppression permet d'économiser de l'argent si Fider resterait autrement inutilisé pendant environ 4 jours ou plus dans votre propre projet (environ 2,95 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (61 crédits par jour).
- **Supprimez tout ce que Fider utilise.** La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient Fider dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration ; [Tarification Fider Pro](https://fider.io/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Fider s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go unique, 2 vCPU / 4 Gio par défaut, autoscaling sans serveur |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Fider ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié provisionné automatiquement |
| Stockage de fichiers | Aucun par défaut | Fider stocke les pièces jointes sous forme de blobs dans PostgreSQL ; le montage NFS optionnel (`enable_nfs`) est désactivé par défaut et inutilisé |
| Secrets | Secret Manager | `JWT_SECRET` auto-généré ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; LB HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée (`database_type = POSTGRES_15`) ; la sélection de tout autre moteur
  entraîne un échec au démarrage.
- **`JWT_SECRET` est généré automatiquement** et stocké dans Secret Manager. Il signe
  tous les jetons d'authentification et de session (y compris les liens de connexion magiques envoyés par e-mail) et
  **ne doit jamais être renouvelé après le premier démarrage** — cela invaliderait toutes les sessions actives
  et les liens de connexion en attente.
- **Fider est un binaire Go unique sans worker en arrière-plan.** Tout l'état réside dans
  PostgreSQL, il n'y a donc pas de processus de file d'attente à maintenir actif. Le module fournit
  `min_instance_count = 1` avec `cpu_always_allocated = true` pour un service constamment actif ;
  comme il n'y a pas de travail en arrière-plan, la définition de `min_instance_count = 0`
  (mise à l'échelle à zéro) est sûre pour les données si vous préférez échanger un démarrage à froid contre un coût inférieur.
- **Pas de Redis.** Fider utilise une file d'attente et un cache basés sur PostgreSQL (`VALKEY_URL` vide),
  donc `enable_redis` est par défaut `false`. Laissez-le désactivé
  sauf si vous externalisez délibérément vers Redis.
- **NFS est désactivé par défaut** (`enable_nfs = false`). Fider stocke les pièces jointes sous forme de
  blobs dans PostgreSQL (son comportement par défaut), et ce module ne le bascule jamais en
  mode système de fichiers, de sorte qu'un partage NFS ne recevrait rien.
- **Le conteneur écoute sur le port 3000.** Le point d'entrée exporte `PORT = 3000` ;
  Cloud Run injecte également automatiquement `PORT = <container_port>`.
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée personnalisé exécute `./fider migrate`
  avant de démarrer le serveur, de sorte que la mise à niveau de la version applique les modifications de schéma sans
  étape séparée.
- **L'e-mail est désactivé pour la démo.** Des valeurs SMTP de substitution permettent à l'application de démarrer ;
  les liens d'inscription/invitation sont imprimés dans le journal du conteneur jusqu'à ce qu'un véritable SMTP soit configuré via
  `environment_variables`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Fider {#a-cloud-run--the-fider-service}

Fider s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~fider"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution,
et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Fider stocke toutes les données d'application (publications, votes, commentaires, utilisateurs, paramètres) dans une
instance Cloud SQL pour PostgreSQL 15 gérée. Le service se connecte en privé via
le **proxy d'authentification Cloud SQL** sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier
déploiement, le job `db-init` crée le rôle et la base de données de l'application et accorde
les privilèges ; Fider exécute ensuite ses propres migrations au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné automatiquement.
Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Cloud Filestore (NFS) {#d-cloud-filestore-nfs}

NFS est **désactivé par défaut** (`enable_nfs = false`) : Fider conserve les pièces jointes sous forme de blobs
dans PostgreSQL, il n'a donc pas besoin de système de fichiers partagé. Si vous l'activez quand même, la VM du serveur NFS partagé
(gérée par `Services_GCP`) doit être `RUNNING` avant le déploiement de l'application,
et le partage reste vide à moins que vous ne basculiez également Fider en mode de stockage de blobs par système de fichiers.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the mount path injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Fider n'utilise **pas** Redis — ne vous attendez pas à un point de terminaison Memorystore ou Redis.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`JWT_SECRET` (signe les jetons d'authentification et de session). Le mot de passe de la base de données est
géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~fider"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent
être superposés ; les paramètres d'entrée et le contrôle de sortie VPC contrôlent la connectivité. Définissez un `BASE_URL` personnalisé
via `environment_variables` lors de la diffusion à partir d'un domaine personnalisé.

> **Utilisez l'URL numérique du projet, pas `status.url`.** Chaque service Cloud Run est
> accessible via deux noms d'hôte également valides : une forme numérique de projet
> (`https://<service>-<project-number>.<region>.run.app`) et une forme avec suffixe aléatoire
> (`https://<service>-<random8>-<regioncode>.a.run.app`, ce que `gcloud run services
> describe --format='value(status.url)'` rapporte). L'en-tête Content-Security-Policy
> de Fider est limité au nom d'hôte avec lequel il a été démarré — normalement la
> forme numérique du projet — donc un navigateur atterrissant sur le suffixe aléatoire `status.url` verra
> chaque requête d'actif (CSS, JS) bloquée par la CSP et affichera une page complètement vide.
> Partagez/visitez toujours la forme numérique du projet.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud
Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives. Notez que lorsque l'e-mail est
désactivé, les liens d'inscription/invitation apparaissent dans les journaux.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Fider {#3-fider-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le proxy d'authentification Cloud SQL et crée de manière idempotente
  le rôle et la base de données `fider`, accorde les privilèges et réaffecte la propriété du
  schéma `public` au rôle d'application. Le job peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Le point d'entrée personnalisé exécute `./fider migrate` avant
  de lancer le serveur (le `CMD` de l'image est remplacé par `./fider` uniquement). Les migrations
  sont idempotentes, de sorte que la mise à niveau de la version de l'application applique les modifications de schéma au
  prochain démarrage sans étape de migration distincte.
- **`JWT_SECRET` est immuable après le premier démarrage.** Il est généré une fois et écrit dans
  Secret Manager. Le modifier invalide toutes les sessions utilisateur actives et tous les liens de connexion
  envoyés par e-mail en attente. Ne le faites pivoter que pendant une fenêtre de maintenance planifiée.
- **Configuration initiale.** Il n'y a pas d'identifiants par défaut. La première visite à l'URL du service
  guide un opérateur à travers la création du site et de son propriétaire administrateur. Terminez
  cela immédiatement après le déploiement — utilisez l'URL **numérique du projet**, pas la
  forme à suffixe aléatoire `status.url` (voir l'avertissement CSP/page blanche sous
  [Réseau et entrée](#f-networking--ingress)) :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(metadata.annotations."run.googleapis.com/urls")'
  ```
- **L'e-mail est désactivé par défaut.** Des valeurs SMTP de substitution permettent à Fider de démarrer avec
  `EMAIL_NOEMAIL = true` ; les liens d'inscription et d'invitation sont imprimés dans le journal du conteneur.
  Pour envoyer de vrais e-mails, définissez les variables SMTP de Fider (`EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`,
  `EMAIL_SMTP_USERNAME`, `EMAIL_SMTP_PASSWORD`, `EMAIL_NOREPLY`) via
  `environment_variables` et supprimez `EMAIL_NOEMAIL`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/_health` — un point de terminaison non authentifié
  renvoyant `200`. Prévoyez environ 7 minutes au premier démarrage (la sonde de démarrage par défaut
  fournit un délai initial de 30 secondes plus une fenêtre de nouvelle tentative de 30 échecs à une période de 15 secondes).
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Fider sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `fider` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Fider` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Fider (`getfider/fider:<tag>`), mappé à l'ARG de build `FIDER_VERSION`. `latest` est épinglé à `stable` (il n'y a pas de tag `:latest`) ; épinglez à un tag SHA spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro. Fider n'a pas de worker en arrière-plan, donc l'inactivité à zéro est sûre pour les données ; définissez `1` si vous voulez une base de référence chaude et que vous acceptez le coût permanent. |
| `max_instance_count` | `5` | Plafond de coût ; doit être ≥ `min_instance_count`. |
| `cpu_always_allocated` | `false` | Facturation basée sur l'instance pour un service constamment actif ; il est sûr de définir `false` pour la facturation basée sur les requêtes puisque Fider n'effectue aucun travail en arrière-plan. |
| `container_port` | `3000` | Fider écoute sur le port 3000 ; Cloud Run injecte automatiquement `PORT`. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Proxy d'authentification Cloud SQL pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Fider dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public ; requis pour atteindre le site depuis les navigateurs. |
| `enable_iap` | `false` | Exiger la connexion Google devant Fider. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Configurez un vrai SMTP (`EMAIL_SMTP_*`, `EMAIL_NOREPLY`) ou un `BASE_URL` personnalisé ici. Ne définissez pas `DATABASE_URL`, `JWT_SECRET` ou `PORT`. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `enable_nfs` | `false` | Laisser désactivé — Fider stocke les pièces jointes dans PostgreSQL, pas sur un système de fichiers. |
| `nfs_mount_path` | `/opt/fider/storage` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Fider nécessite PostgreSQL. |
| `db_name` | `fider` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `fider` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/_health`, délai de 30s | Prévoir environ 7 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/_health`, période de 30s | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring facultative. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Fider est basé sur Postgres ; laisser désactivé sauf si externalisation vers Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinent uniquement si Redis est activé. |

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
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `JWT_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions actives et les liens de connexion par e-mail en attente. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Tout moteur non PostgreSQL entraîne un échec au démarrage — Fider est uniquement PostgreSQL. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans source de sauvegarde valide fait échouer le job d'importation. |
| `container_port` | `3000` | Élevé | Un port non concordant fait que les sondes atteignent un port mort et que la révision ne devient jamais prête. |
| `application_version` | épingler un tag SHA ; `latest` → `stable` | Élevé | `getfider/fider` n'a pas de tag `:latest` ; le module épingle `latest` à `stable`, mais épinglez explicitement pour des mises à niveau reproductibles. |
| `memory_limit` | `4Gi` (par défaut) | Moyen | Un sous-dimensionnement risque un OOM sous charge ; Fider lui-même est léger. |
| `enable_nfs` | `false` (par défaut) | Moyen | Fider stocke les pièces jointes dans PostgreSQL, donc l'activation de NFS ajoute une dépendance de démarrage à la VM NFS partagée (qui doit être `RUNNING`) et ne stocke rien. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` (par défaut) | Faible | Fider n'a pas de worker en arrière-plan — `0` / `false` est sûr pour les données et moins cher, au prix de démarrages à froid. |
| SMTP (`EMAIL_SMTP_*`) | Configurer pour un vrai courrier | Moyen | Laissés comme espaces réservés, les liens d'inscription / d'invitation n'apparaissent que dans les journaux — aucun e-mail n'est envoyé. |
| `enable_iap` | uniquement lorsque l'accès public n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris la navigation anonyme sur le tableau. |
| Quelle URL Cloud Run visiter | forme numérique du projet, pas `status.url` | Élevé | La CSP de Fider est limitée au nom d'hôte numérique du projet ; la visite de la forme à suffixe aléatoire `status.url` fait que chaque actif est bloqué par le navigateur, affichant une page blanche. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Fider partagée
avec la variante GKE est décrite dans **[Fider_Common](Fider_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Fider sur Cloud Run](../labs/Fider_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Fider sur GKE Autopilot](Fider_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Fider Common — Configuration d'application partagée](Fider_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [FreeScout sur Google Cloud Run](FreeScout_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Gotify sur Google Cloud Run](Gotify_CloudRun.md) dans la solution **Customer Support Desk**.
