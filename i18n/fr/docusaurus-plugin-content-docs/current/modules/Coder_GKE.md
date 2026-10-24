---
title: "Coder sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Coder sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Coder_GKE.md @ e69407af sha256:b40dcad8d4d3 -->

# Coder sur GKE Autopilot {#coder-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Coder_GKE.png" alt="Coder sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Coder est une plateforme open-source auto-hébergée pour le provisionnement
d'environnements de développement à distance ("espaces de travail") définis
comme du code avec Terraform. Elle est livrée sous la forme d'un seul binaire
Go (`coder server`) qui sert l'interface utilisateur/API web du plan de
contrôle et proxyfie les connexions WebSocket pour les IDE de navigateur et
les sessions de terminal vers les espaces de travail en cours d'exécution. Ce
module déploie le **plan de contrôle** Coder sur **GKE Autopilot** au-dessus
de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes. Le provisionnement des
espaces de travail réels nécessite en outre un provisionneur configuré et une
cible de calcul (par exemple un cluster Kubernetes ou un modèle de VM cloud)
configurés après le déploiement — ce module ne fait que mettre en place le
plan de contrôle.

Ce guide se concentre sur les services cloud que Coder utilise et sur la
façon de les explorer et de les exploiter depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Coder sur RAD, et comment cela se compare {#what-coder-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Coder sur RAD coûte environ 136,37 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 175 crédits (17,50 $ US).** Coder est le plan de contrôle open-source pour le provisionnement d'espaces de travail de développement à distance définis par Terraform. Pour le coût le plus bas, le [guide Cloud Run](Coder_CloudRun.md) exécute le même Coder pour environ 167,44 $ US par mois ; choisissez GKE ici uniquement si Coder doit rester actif en permanence, s'adapter à travers les pods, ou fonctionner à côté d'autres charges de travail Kubernetes.

Si Coder n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 136,37 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6) | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **136,37 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **105 crédits par jour**, environ 3150 par mois (environ 315 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 136,37 $ US** |

### Comment cela se compare {#how-it-compares}

- Si vous l'exécutez vous-même, un VPS exécutant le plan de contrôle Coder et PostgreSQL vous coûtera moins cher en espèces : dimensionné à environ 2 vCPU/4 GiB, un VPS comparable (Hetzner ou DigitalOcean) coûte environ 24 à 48 $ par mois, ou une VM GCP de classe `e2-standard-2` environ 49 $ — plus votre propre temps pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes monétaires — ce n'est généralement pas le cas. La différence est ce que RAD gère pour vous : les correctifs, les sauvegardes, les secrets et la surveillance, plus la possibilité de mettre Coder en pause gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).
- La majeure partie du coût de fonctionnement ci-dessus est la base de données PostgreSQL gérée (et, le cas échéant, le serveur de fichiers partagé) — la partie qu'une comparaison avec un VPS nu doit exécuter et sauvegarder à la main.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Coder s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Coder dont vous n'avez besoin qu'occasionnellement que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un seul module, cela ne supprime pas les ressources Cloud SQL ou GKE Autopilot une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela représente une poignée de crédits (moins de 1 $ US) au total pour une chaîne Coder typique, contre les 180 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 136,37 $ US.** Déployez Coder, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures où il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Coder et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, le moyen d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (18 $ US) dans votre propre projet. La suppression ne permet d'économiser de l'argent que si Coder devait rester inutilisé pendant environ 4 jours ou plus dans votre propre projet (4,55 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (105 crédits par jour).
- **La majeure partie du coût de fonctionnement est généralement la base de données.** Elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de Coder alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez les paramètres à nouveau lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Le plan de contrôle de Coder est sans état — tout l'état, y compris ses clés de
signature auto-générées, réside dans PostgreSQL — le déploiement relie donc un
ensemble restreint et ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go sur le port 3000, 2 vCPU / 4 GiB par défaut, un réplica (`max_instance_count = 1`) |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — MySQL est rejeté au moment de la planification |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement par `Coder_Common` |
| Secrets | Secret Manager | Seul le mot de passe de la base de données géré par la Fondation — Coder n'a pas de secret d'application propre |
| Ingress | Cloud Load Balancing | Ingress Kubernetes avec une IP statique globale réservée ; domaine personnalisé facultatif |
| Build de conteneur | Cloud Build + Artifact Registry | Enveloppe l'image amont `ghcr.io/coder/coder` avec un point d'entrée cloud |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est requis.** `database_type` par défaut à `POSTGRES_15` ; une
  validation au moment de la planification dans `validation.tf` rejette tout ce qui
  n'est pas `POSTGRES_13`/`14`/`15`/`NONE` — MySQL n'est pas
  pris en charge.
- **`container_image_source = "custom"` est requis, pas facultatif.** L'image
  amont `ghcr.io/coder/coder` ne peut pas analyser le câblage de la base de données de la
  Fondation seule ; Cloud Build l'enveloppe avec un point d'entrée cloud qui
  assemble `CODER_PG_CONNECTION_URL` et `CODER_ACCESS_URL` au démarrage du conteneur.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur le bouclage.** GKE
  injecte `DB_HOST = 127.0.0.1` ; le point d'entrée construit un DSN `postgres://`
  avec `sslmode=disable` (le proxy termine déjà la connexion TLS) et encode le mot de
  passe en URL.
- **Pas de NFS, pas de Redis, et pas de secret d'application.** Tout l'état de
  Coder — espaces de travail, modèles, utilisateurs, sessions, file d'attente de
  build, et clés de signature auto-générées — réside dans PostgreSQL.
  `enable_nfs` et `enable_redis` sont tous deux par défaut
  `false` et ne sont pas nécessaires pour un fonctionnement normal.
- **Pas de job de migration séparé.** Coder exécute ses propres migrations de
  schéma au démarrage ; le seul job d'initialisation est `db-init`, qui
  crée la base de données et le rôle vides.
- **Un réplica par défaut.** `min_instance_count = 1`, `max_instance_count = 1`. Le mode
  multi-réplicas de Coder est sa fonctionnalité de haute disponibilité, qui
  nécessite une licence premium : sans elle, les réplicas supplémentaires
  servent l'API et l'interface utilisateur mais ne rejoignent jamais le maillage
  de relais de Coder, de sorte que les sessions de terminal et SSH de l'espace
  de travail dépendraient du réplica choisi par l'équilibreur de charge.
- **`session_affinity = ClientIP`** maintient le trafic de terminal/IDE lourd en WebSocket
  d'un navigateur épinglé au même pod pendant toute la session.
- **Ingress et une IP statique sont provisionnés prêts à l'emploi**
  (`enable_custom_domain = true`, `reserve_static_ip = true`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail du plan de contrôle Coder {#a-gke-autopilot--the-coder-control-plane-workload}

Les pods Coder s'exécutent sur Autopilot, facturés pour le CPU/la mémoire que
les pods demandent réellement. Comme le plan de contrôle est sans état, la
charge de travail s'exécute comme un `Deployment` standard avec une stratégie
`RollingUpdate` (pas de contrainte `Recreate` basée sur NFS). L'exécution de
plus d'un réplica nécessite le mode haute disponibilité sous licence de Coder
(voir ci-dessus).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Coder pour les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get hpa -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, la mise à l'échelle
HPA et le type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Coder stocke tout — espaces de travail, modèles, utilisateurs, journaux d'audit,
sessions et ses propres clés de signature — dans une instance Cloud SQL pour
PostgreSQL 15 gérée. Les pods l'atteignent via le sidecar **Cloud SQL Auth
Proxy** sur `127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du premier
déploiement, le job `db-init` crée la base de données et le rôle de
l'application ; le moteur de migration de Coder crée ensuite le schéma au
démarrage du serveur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement par `Coder_Common` et le compte de service de la charge de travail
se voit accorder l'accès. Il n'est pas actuellement monté dans le conteneur
Coder par défaut — Coder ne nécessite pas de système de fichiers partagé, car
l'état réside dans PostgreSQL.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse
(`gcs_volumes`) si vous avez besoin d'en attacher un pour un workflow
personnalisé.

### D. Secret Manager {#d-secret-manager}

Coder est inhabituel parmi les applications avec état en ce qu'il ne crée
**aucun secret d'application propre** — il auto-génère ses clés de signature
et les persiste dans la base de données PostgreSQL `coder` au premier
démarrage. La seule information d'identification que Secret Manager détient est
le mot de passe de la base de données géré par la Fondation. Sur GKE, les
secrets sont projetés dans les pods via le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~coder"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via un Ingress Kubernetes soutenu
par une IP statique globale (`reserve_static_ip = true` afin que l'adresse survive aux
redéploiements). Un domaine personnalisé avec un certificat géré par Google
peut être activé via `application_domains`. Étant donné que Coder proxyfie les
connexions WebSocket de longue durée pour le terminal web et le trafic
d'applications d'espace de travail, conservez `session_affinity = ClientIP` afin que les
requêtes d'un client atterrissent sur le même pod pendant la durée d'une
session.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des vérifications de disponibilité et des règles
d'alerte facultatives sont disponibles (`uptime_check_config` est désactivé par
défaut).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Coder {#3-coder-application-behaviour}

- **Configuration de la base de données au premier déploiement, pas de job de
  migration séparé.** Le job `db-init` exécute `db-init.sh` en
  utilisant `postgres:15-alpine`. Il attend le sidecar Cloud SQL Auth Proxy, crée de
  manière idempotente le rôle et la base de données `coder`, accorde les
  privilèges et réaffecte le propriétaire du schéma `public`, puis signale
  au sidecar proxy de s'arrêter (`--quitquitquit`) afin que le pod du job se
  termine. Coder exécute ensuite ses propres migrations de schéma au démarrage
  du serveur — il n'y a pas de job de migration dédié, contrairement aux
  applications avec une étape `db-migrate` séparée.
- **Aucun compte administrateur n'est pré-provisionné.** Le premier
  utilisateur à atteindre l'interface utilisateur web après un démarrage réussi
  termine la configuration interactive de Coder (création du compte
  administrateur initial). Il n'y a pas de secret de mot de passe
  administrateur auto-généré à récupérer.
- **Assemblage DSN au démarrage du conteneur, non intégré à l'image.**
  `entrypoint.sh` (dans `Coder_Common/scripts/`) construit `CODER_PG_CONNECTION_URL` à partir des
  valeurs `DB_*` injectées par la Fondation, car le pilote Go de Coder
  attend une URL `postgres://` et ne peut pas analyser la forme de mot-clé
  libpq. Sur GKE, `DB_HOST=127.0.0.1` (le sidecar Auth Proxy) se résout en
  `sslmode=disable` ; le mot de passe est encodé en pourcentage RFC-3986 afin que
  les caractères spéciaux ne cassent pas l'URL. `CODER_ACCESS_URL` par défaut à
  `GKE_SERVICE_URL` injecté par la Fondation.
- **Le trafic lourd en WebSocket nécessite un routage persistant.** Le
  terminal web, le proxy d'application d'espace de travail et le
  `coder ssh`/port-forward de la CLI utilisent tous des connexions WebSocket
  de longue durée via le plan de contrôle. Conservez `session_affinity = ClientIP` (la valeur
  par défaut) afin que la connexion d'un client persiste sur un seul pod ;
  `max_instance_count` reste à 1 sauf si vous détenez une licence Coder avec haute
  disponibilité.
- **Chemins des sondes de santé.** Les sondes de démarrage et de vivacité
  ciblent toutes deux **HTTP `GET /health`** avec un délai initial de 60
  secondes ; la sonde de démarrage autorise jusqu'à 30 échecs avec une période
  de 15 secondes pour absorber la migration de schéma au premier démarrage de
  Coder. La sonde de disponibilité fournie par Common (utilisée par le câblage
  `additional_services`/readiness de la Fondation) cible `GET /healthz`
  séparément.
- **La télémétrie est désactivée par défaut** (`CODER_TELEMETRY_ENABLE = "false"`), et
  `CODER_VERBOSE = "false"`.
- **Plan de contrôle uniquement — les espaces de travail nécessitent un
  provisionneur + une cible.** Ce module déploie `coder server` ;
  l'exécution d'espaces de travail réels nécessite en outre la
  configuration d'un provisionneur et d'une cible de calcul (par exemple un
  autre cluster/espace de noms Kubernetes, ou des modèles de VM cloud) via le
  système de modèles de Coder après la première connexion.
- **Vérifier le déploiement :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CODER_
  curl -s https://<service-url>/healthz
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Coder sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `coder` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de Coder ; `latest` correspond à un tag épinglé (`v2.24.1`) via l'ARG de build `CODER_VERSION` spécifique à l'application afin qu'il ne se résolve jamais contre un `ghcr.io/coder/coder:latest` non existant. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Requis — l'image amont ne peut pas être déployée pré-construite ; Cloud Build l'enveloppe avec le point d'entrée d'assemblage DSN. |
| `container_port` | `3000` | Port de liaison `CODER_HTTP_ADDRESS` de Coder. |
| `container_resources` | `cpu_limit=2000m`, `memory_limit=4Gi` | 2 vCPU / 4 GiB par défaut pour le plan de contrôle. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Limites des réplicas. Plus d'un réplica nécessite le mode haute disponibilité sous licence de Coder. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (bouclage) — requis sur GKE ; une garde au moment de la planification le rejette lorsque `database_type = "NONE"`. |
| `enable_image_mirroring` | `true` | Toujours activé pour Coder — l'image de base provenant de GHCR est mise en miroir dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur/API Coder. |
| `workload_type` | `null` → `Deployment` | Déploiement (sans état, `RollingUpdate` standard). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'une session WebSocket d'un client atteigne le même pod. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non requis — tout l'état est dans PostgreSQL. Si activé, `nfs_mount_path` doit être un répertoire réel, jamais un sous-chemin de `/opt/coder` (le binaire `coder`, un fichier). |
| `nfs_mount_path` | `/home/coder/data` | Utilisé uniquement lorsque `enable_nfs = true`. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — les sessions et la file d'attente de build résident dans PostgreSQL, contrairement aux applications qui nécessitent un cache/une file d'attente externe. |
| `redis_host` | `""` | Pertinent uniquement si `enable_redis = true` ; une garde au moment de la planification exige soit `redis_host`, soit `enable_nfs = true`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Coder nécessite PostgreSQL 13+ ; MySQL est rejeté au moment de la planification (`validation.tf`). |
| `application_database_name` | `coder` | Nom de la base de données. Immuable après le premier déploiement — le renommage recrée la base de données et orpheline tout l'état de Coder. |
| `application_database_user` | `coder` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Un Ingress Kubernetes est provisionné prêt à l'emploi. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md). Note : `elasticsearch_url`, `elasticsearch_username` et `elasticsearch_password_secret` sont déclarés dans `variables.tf` pour la parité du catalogue mais ne sont **pas transmis** à l'appel de la Fondation dans `main.tf` — Coder n'a pas d'intégration Elasticsearch dans ce module, donc les définir n'a aucun effet.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Coder. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
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
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un nombre
> d'instances hors plage, IAP activé sans identifiants OAuth, `quota_memory_*`
> donné comme des entiers bruts. Coder_GKE ajoute en outre ses propres gardes
> dans `validation.tf` (`database_type` PostgreSQL uniquement, la précondition
> hôte Redis/NFS, le conflit volume Cloud SQL vs `database_type = "NONE"`). Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou
> de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou 13/14) | Critique | Tout moteur non-PostgreSQL est rejeté au moment de la planification ; en forcer un contournant la garde rompt toutes les requêtes émises par Coder. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les espaces de travail, modèles, utilisateurs et clés de signature auto-générées. |
| `container_image_source` | `custom` | Critique | Le passage à `prebuilt` pointe GKE vers l'image `ghcr.io/coder/coder` brute, qui ne peut pas assembler `CODER_PG_CONNECTION_URL` à partir des variables de base de données de la Fondation et échoue au démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | Requis pour la connectivité de la base de données sur GKE ; une garde au moment de la planification le bloque également lorsque `database_type = "NONE"` pour éviter un sidecar proxy sans rien à connecter. |
| `nfs_mount_path` (si `enable_nfs=true`) | Un répertoire réel, par exemple `/home/coder/data` | Critique | Le montage sur `/opt/coder` — le binaire `coder` lui-même — masque l'exécutable et le conteneur ne démarre pas. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, une session de terminal/IDE WebSocket en cours de vol peut être acheminée vers un pod différent en milieu de session et se déconnecter. |
| `enable_redis` | `false` | Moyen | Non nécessaire — l'activer sans `redis_host` défini ou `enable_nfs=true` échoue à la validation au moment de la planification ; même correctement configuré, cela ajoute une dépendance inutilisée puisque Coder conserve tout l'état dans PostgreSQL. |
| `max_instance_count` | `1` | Élevé | Coder multi-réplicas est une fonctionnalité de haute disponibilité, une fonctionnalité de licence premium ; les réplicas supplémentaires sans licence ne rejoignent jamais le maillage de relais, de sorte que les connexions d'espace de travail se rompent en fonction du réplica qui les sert. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS, `CODER_ACCESS_URL` et toute redirection OAuth/OIDC enregistrée. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité de l'historique des espaces de travail/modèles. |
| `elasticsearch_url` / `elasticsearch_username` / `elasticsearch_password_secret` | Laisser non défini | Faible | Inerte dans ce module (non transmis à l'appel de la Fondation) — les définir n'a aucun effet et n'active pas l'intégration de la recherche. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Coder
partagée avec la variante Cloud Run est décrite dans
**[Coder_Common](Coder_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Coder sur GKE Autopilot](../labs/Coder_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Coder sur Google Cloud Run](Coder_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Coder Common — Configuration d'application partagée](Coder_Common.md) — la configuration partagée par les deux cibles de déploiement.
