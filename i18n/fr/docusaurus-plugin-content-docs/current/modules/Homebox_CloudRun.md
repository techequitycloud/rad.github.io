---
title: "Homebox sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Homebox sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Homebox_CloudRun.md @ 40c83c3f sha256:fc399632b72e -->

# Homebox sur Google Cloud Run {#homebox-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Homebox_CloudRun.png" alt="Homebox sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Homebox est un système open source d'inventaire et d'organisation domestique auto-hébergé, avec un backend API REST en Go (style Echo, ORM Ent) et un frontend Vue 3/Nuxt intégré dans le même binaire — suivez les articles, joignez des photos et organisez-les par emplacement. Ce module déploie Homebox sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Homebox et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Homebox sur RAD, et comment cela se compare {#what-homebox-costs-on-rad-and-how-that-compares}

**L'exécution de Homebox sur Cloud Run dans votre propre projet Google Cloud coûte environ 67,80 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 40 crédits facturé une fois au moment du déploiement. Homebox est une petite application d'inventaire domestique avec une base de données Postgres modeste derrière elle — il n'y a pas de SaaS hébergé commercial pour ce projet open source exact à nommer. Dans un projet géré par RAD, les frais de module tombent à 36 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide GKE](Homebox_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 40 crédits | 36 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés pour le temps de build à la minute | Idem |
| Coût d'exécution Google Cloud | 67,80 $/mois, facturé par Google au prix catalogue | ~61 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 0,5 Gio (scaleToZero) | 10,78 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **67,80 $** |

### Comment cela se compare {#how-it-compares}

- Une comparaison autogérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — plus que ce dont cette application 1 vCPU/0,5 Gio a besoin seule, mais le point de référence le plus petit et le plus cité ; une classe de vCPU partagée moins chère l'exécuterait également confortablement.
- La majeure partie du coût d'exécution ci-dessus est l'instance Postgres dédiée, qu'une machine autogérée devrait également exécuter (et sauvegarder) elle-même.
- Le compromis habituel s'applique : moins cher en termes de trésorerie sur un VPS, sauvegardes et correctifs gérés sur RAD.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ni la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont entièrement fonctionnels à nouveau dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Homebox et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener Homebox signifie redéployer à partir de
zéro. Cela coûte 40 crédits (les frais de module ; les builds sont inclus).

La suppression ne permet d'économiser de l'argent que si Homebox reste inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Homebox, c'est environ 2 jours ou
plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise une, la VM de serveur de fichiers partagé ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Homebox s'exécute comme un seul binaire Go (API + frontend intégré) sur Cloud Run v2.
Le déploiement relie un ensemble restreint et ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go/Echo, 1 vCPU / 512 Mio par défaut, mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Homebox lit des variables d'environnement discrètes `HBOX_DATABASE_*`, pas un DSN construit |
| Stockage d'objets | Cloud Storage | Un bucket `data` est créé pour les photos/pièces jointes des articles et monté automatiquement à `/data` |
| Cache et file d'attente | aucun | Homebox n'a pas de dépendance Redis ou de file d'attente |
| Secrets | Secret Manager | Mot de passe de la base de données plus `HBOX_AUTH_API_KEY_PEPPER` (un vrai secret consommé par l'application) |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur standardisé.** `Homebox_Common` corrige
  `database_type = "POSTGRES_15"` et définit `HBOX_DATABASE_DRIVER=postgres`
  explicitement — Homebox utilise SQLite intégré par défaut, dont le DSN par défaut
  force `journal_mode=WAL`, ce qui est dangereux sur NFS/gcsfuse.
- **Pas de build de conteneur personnalisé.** Les variables d'environnement Postgres discrètes de Homebox n'ont pas besoin de
  construction de DSN, donc l'image pré-construite officielle
  (`ghcr.io/sysadminsmedia/homebox`) est utilisée directement.
- **Auto-inscription ouverte, pas de compte administrateur par défaut.** Contrairement à certaines applications
  de ce catalogue, Homebox ne fournit pas de credential codé en dur : la première
  personne à soumettre le formulaire "Register" sur une nouvelle instance devient l'utilisateur
  administrateur initial. Il n'y a pas de risque de sécurité lié aux credentials par défaut, mais
  les opérateurs doivent définir `HBOX_OPTIONS_ALLOW_REGISTRATION=false` par la suite pour
  fermer les inscriptions publiques — voir le [guide commun](Homebox_Common.md) pour plus de détails.
- **Les photos des articles sont persistantes par défaut.** `Homebox_Common` déclare une
  entrée `gcs_volumes` montant le bucket GCS `data` au chemin `/data`
  de Homebox, de sorte que les photos et pièces jointes des articles téléchargés survivent à un redémarrage de révision.
  Les *métadonnées* des articles ne sont pas affectées (stockées dans PostgreSQL).
- **Facturation basée sur les requêtes par défaut.** `cpu_always_allocated = false`,
  `min_instance_count = 0` — Homebox est une application simple de requête/réponse sans
  planificateur d'arrière-plan ni travailleur de file d'attente.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources
sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Homebox {#a-cloud-run--the-homebox-service}

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence et la
répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Homebox stocke toutes les données d'articles, d'emplacements et d'utilisateurs dans une instance gérée de Cloud SQL pour PostgreSQL 15, connectée en privé via le **Cloud SQL Auth Proxy** sur un socket Unix. Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs,
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

Un bucket `data` est provisionné automatiquement pour les photos et pièces jointes des articles,
et est monté dans le conteneur à `/data` par défaut.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~homebox"
  ```

### D. Secret Manager {#d-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~homebox"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Homebox {#3-homebox-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute
  `create-db-and-user.sh` en utilisant `postgres:15-alpine`, créant de manière idempotente le
  rôle et la base de données de l'application.
- **Migrations de schéma au démarrage.** L'ORM Ent de Homebox applique ses propres migrations internes
  automatiquement à chaque démarrage — aucun job de migration séparé ne s'exécute
  au niveau de la plateforme.
- **Auto-inscription ouverte — pas de credential admin par défaut.** Le premier
  visiteur à compléter le formulaire "Register" devient l'administrateur. Il n'y a pas de
  credential à récupérer, réinitialiser ou faire pivoter — définissez
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` une fois que le compte admin existe pour
  fermer les inscriptions publiques.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/v1/status` —
  le véritable endpoint de statut non authentifié de Homebox, confirmé par l'instruction
  `HEALTHCHECK` du Dockerfile officiel.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Homebox sont listés ; toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `homebox` | Nom de base des ressources. |
| `application_version` | `latest` | Homebox publie une véritable balise `latest` — aucun remappage n'est nécessaire. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Aucune build personnalisée nécessaire — les variables d'environnement Postgres discrètes ne nécessitent pas de construction de DSN. |
| `container_port` | `7745` | Port natif par défaut de Homebox. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Valeur par défaut de mise à l'échelle à zéro. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `data` | Créé et monté automatiquement à `/data` pour les photos d'articles. |
| `gcs_volumes` | `[]` | Vide signifie "utiliser le montage `Homebox_Common` de `/data`" ; une liste non vide le remplace. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Homebox_Common`. |
| `db_host_env_var_name` | `HBOX_DATABASE_HOST` | Aliasse la plateforme `DB_HOST` sur le nom attendu par Homebox. |
| `db_user_env_var_name` | `HBOX_DATABASE_USERNAME` | Aliasse `DB_USER`. |
| `db_password_env_var_name` | `HBOX_DATABASE_PASSWORD` | Aliasse `DB_PASSWORD`. |
| `db_name_env_var_name` | `HBOX_DATABASE_DATABASE` | Aliasse `DB_NAME`. |
| `db_port_env_var_name` | `HBOX_DATABASE_PORT` | Aliasse `DB_PORT`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/v1/status` délai de 30s | Les sondes ciblent le véritable endpoint de statut de Homebox. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` | Nom du service Cloud Run et URL `run.app` par défaut. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `data` pour les photos et pièces jointes des articles. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (par défaut) | Élevé | `"custom"` déclenche un Cloud Build inutile sans Dockerfile dans ce module — le build échoue. |
| Première inscription | Compléter rapidement après le déploiement | **Moyen** | La première personne à s'inscrire sur une instance fraîche et publiquement accessible devient l'administrateur — tant que vous ne vous inscrivez pas et ne définissez pas `HBOX_OPTIONS_ALLOW_REGISTRATION=false`, toute personne qui découvre l'URL peut revendiquer le compte administrateur. |
| `gcs_volumes` pour les photos d'articles | Laisser vide (utiliser le montage `/data` du module) | **Élevé** | `Homebox_Common` monte déjà le bucket `data` à `/data`. Fournir une liste `gcs_volumes` non vide remplace entièrement ce montage — si le remplacement ne couvre pas également `/data`, les photos et pièces jointes des articles téléchargés retombent sur le système de fichiers éphémère de Cloud Run et ne survivent pas à un redémarrage de révision. Les métadonnées des articles ne sont pas affectées. |
| Variables `db_*_env_var_name` | Laisser leurs valeurs par défaut spécifiques à Homebox | Critique | Modifier/effacer ces variables rompt entièrement la connexion Postgres de Homebox — il lit `HBOX_DATABASE_*`, pas `DB_*`. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle
et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Homebox
partagée avec la variante GKE est décrite dans
**[Homebox_Common](Homebox_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Homebox sur Cloud Run](../labs/Homebox_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Homebox sur GKE Autopilot](Homebox_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Homebox Common — Configuration d'application partagée](Homebox_Common.md) — la configuration partagée par les deux cibles de déploiement.
