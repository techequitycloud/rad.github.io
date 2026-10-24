---
title: "WriteFreely sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de WriteFreely sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/WriteFreely_GKE.md @ 1665a43e sha256:291dfbca5f37 -->

# WriteFreely sur GKE Autopilot {#writefreely-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/WriteFreely_GKE.png" alt="WriteFreely sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

WriteFreely est une plateforme de blog open-source, minimaliste et fédérée, écrite en Go
— une alternative légère à Medium pour publier des écrits clairs et sans distraction.
Ce module déploie WriteFreely sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud
et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par WriteFreely et sur la manière de les explorer et de les
opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à chaque application GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le
cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Coût de WriteFreely sur RAD et comparaison {#what-writefreely-costs-on-rad-and-how-that-compares}

**L'exécution de WriteFreely sur des pods GKE Autopilot dans votre propre projet Google Cloud coûte environ 96,70 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 175 crédits facturé une fois au moment du déploiement. WriteFreely a besoin d'une base de données MySQL derrière lui, ce qui, avec le pod lui-même, représente la majeure partie de ces 96,70 $. Dans un projet géré par RAD, les frais de module tombent à 157,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour l'avantage unique d'un projet géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](WriteFreely_CloudRun.md) pour l'option à moindre coût.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 175 crédits | 157,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 96,70 $/mois, facturé par Google au prix catalogue | ~93 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 GiB | 39,68 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **96,70 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comparaison {#how-it-compares}

- write.as, géré par la même équipe que WriteFreely, est la version hébergée officielle de ce logiciel : sa [page de tarification](https://write.as/pricing) (vérifiée le 8 octobre 2026) liste un niveau gratuit, Pro à 6 $/mois (annuel) ou 9 $/mois (mensuel) pour un maximum de trois blogs avec des thèmes personnalisés, et Team à 25 $/mois (annuel) ou 30 $/mois (mensuel) pour des publications partagées et collaboratives.
- Pro est moins cher que le coût d'exécution de 96,70 $/mois de RAD pour un projet propre, car il s'agit d'un service multi-locataire partagé ; le module de RAD, en revanche, donne à WriteFreely son propre service Cloud Run dédié et sa base de données Cloud SQL, ce qui est important lorsque vous souhaitez un contrôle total des données, de la disponibilité et de l'identité de fédération plutôt qu'un hébergement partagé.
- Une alternative VPS nu fonctionne également : une machine Hetzner ou DigitalOcean 2 vCPU/4 Go à environ 24 $/mois, ou un GCP Compute Engine e2-standard-2 à environ 49 $/mois, est suffisante pour auto-héberger WriteFreely et MySQL ensemble — moins cher en termes monétaires que RAD, sans les sauvegardes gérées, les correctifs ou la surveillance fournis par RAD.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le
projet purement et simplement — la suppression logique récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne **détruit pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble du
projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logique de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé WriteFreely et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener WriteFreely signifie redéployer
à partir de zéro. Cela coûte environ 178-181 crédits (les frais de module de 175 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si WriteFreely restait inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour WriteFreely, cela représente environ 6 jours ou plus.
La majeure partie de ce coût d'exécution est généralement la base de données — elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'
application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est interrompue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration. Prix des plans write.as sur [write.as/pricing](https://write.as/pricing), vérifiés le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

WriteFreely s'exécute comme une seule charge de travail web Go sur GKE Autopilot. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Go, 1 vCPU / 2 GiB par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — accessible via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` |
| Stockage d'objets | Cloud Storage | Un bucket de données `writefreely-uploads` dédié provisionné automatiquement |
| Secrets | Secret Manager | Trois secrets de clé AES-256 auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est le moteur fixe.** La couche d'application partagée se standardise sur
  Cloud SQL pour MySQL ; la variante GKE laisse `database_type` non défini et l'hérite.
- **Cloud SQL est accessible via le sidecar Auth Proxy.** Sur GKE `enable_cloudsql_volume
  = true` et la variante remplace `DB_HOST = 127.0.0.1` — WriteFreely compose
  l'adresse de bouclage où le sidecar `cloud-sql-proxy` écoute sur le port 3306.
- **Les trois clés AES-256 sont générées automatiquement** et stockées dans Secret Manager
  (`cookies-auth`, `cookies-enc`, `email-key`). Elles ne doivent **jamais** être renouvelées après
  le premier démarrage — les renouveler déconnecte chaque utilisateur et rend les données de courrier électronique précédemment cryptées indéchiffrables.
- **Une image personnalisée est construite, non tirée pré-construite.** `container_image_source = custom` :
  le wrapper fin de génération de configuration (rend `config.ini`, initialise les clés, exécute
  `writefreely db init`) est construit par Cloud Build et poussé vers Artifact Registry.
- **Un minimum de 1 réplica est maintenu** (`min_instance_count = 1`, `max_instance_count =
  1` ; GKE ne prend pas en charge la mise à l'échelle à zéro) pour que le blog soit toujours accessible.
- **`service_type = LoadBalancer` avec `session_affinity = ClientIP`.** WriteFreely est
  exposé sur une adresse IP de LoadBalancer externe et les requêtes du même client restent
  sur le même pod.
- **`reserve_static_ip = true` est porteur de charge — ne le basculez pas sur `false`.** Le
  point d'entrée intègre son hôte public résolu dans `config.ini` à chaque démarrage, en
  revertant vers `GKE_SERVICE_URL` injecté par la fondation lorsque `WF_PUBLIC_URL` est non défini.
  `GKE_SERVICE_URL` est uniquement calculé à partir de l'IP statique *réservée* ; avec
  `reserve_static_ip = false`, il peut revenir à un hôte interne inaccessible
  `*.svc.cluster.local` si l'IP éphémère du LoadBalancer n'est pas encore connue au
  moment de l'apply — confirmé sur WriteFreely (voir §6).
- **NFS et Redis sont désactivés par défaut** (`enable_nfs = false`, `enable_redis = false`).
  WriteFreely n'a pas besoin de système de fichiers partagé : le contenu réside dans MySQL et ses clés de chiffrement sont initialisées à partir de Secret Manager à chaque démarrage.
- **Aucun compte administrateur n'est créé automatiquement.** L'inscription est fermée ; créez le
  premier compte comme étape post-déploiement (voir §3).
- **WriteFreely est en Go — les paramètres Redis et PHP sont inertes.** Activer `enable_redis` ne fait qu'
  injecter un `REDIS_HOST` que WriteFreely ignore, et les variables `php_*` proviennent de
  l'échafaudage du module et ne sont pas consommées par WriteFreely.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail WriteFreely {#a-gke-autopilot--the-writefreely-workload}

Les pods WriteFreely sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre
minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail WriteFreely pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'
  adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

WriteFreely stocke toutes les données d'application (blogs, posts, utilisateurs, sessions) dans une instance
Cloud SQL pour MySQL 8.0 gérée. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth
Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du premier déploiement, un
Job d'initialisation (`db-init`) crée la base de données et l'utilisateur de l'application ; le point d'entrée du conteneur
exécute ensuite `writefreely db init` pour construire les tables.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe
sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées
et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié (`writefreely-uploads`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder l'accès. Des buckets supplémentaires
peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager —
les clés AES-256 que WriteFreely utilise pour signer les cookies de session (`cookies-auth`), chiffrer
les charges utiles des cookies (`cookies-enc`) et chiffrer les adresses e-mail stockées (`email-key`).
Ils sont livrés au pod via le pilote CSI du magasin de secrets et injectés comme
`WF_KEY_COOKIES_AUTH`, `WF_KEY_COOKIES_ENC` et `WF_KEY_EMAIL`. Le mot de passe de la base de données
est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" \
    --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI, et
[WriteFreely_Common](WriteFreely_Common.md) pour savoir pourquoi ces clés doivent rester stables.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **`reserve_static_ip` est par défaut `true` — ne le changez pas en `false`.** WriteFreely
  intègre un hôte public auto-référentiel dans `config.ini` à chaque démarrage de conteneur (la
  chaîne de secours `PUBLIC_URL` du point d'entrée : `WF_PUBLIC_URL` → `CLOUDRUN_SERVICE_URL` →
  `GKE_SERVICE_URL`). `App_GKE` calcule `GKE_SERVICE_URL` à partir de l'IP statique *réservée*
  lorsque `reserve_static_ip = true` ; avec `false`, l'IP éphémère du LoadBalancer n'est souvent
  pas encore connue au moment où Terraform rend les variables d'environnement du déploiement, donc
  `GKE_SERVICE_URL` revient à l'hôte interne du cluster `*.svc.cluster.local` —
  une véritable course reproductible, pas seulement un cas limite théorique (confirmé sur WriteFreely
  et corrigé en définissant `reserve_static_ip = true`, selon la valeur par défaut `deploy.tfvars` du module).
  Un hôte interne inaccessible intégré aux liens de fédération/générés ressemble à
  « l'application fonctionne mais tous les liens absolus sont rompus ».
- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles. Le point d'entrée
enregistre sa progression (`WriteFreely: rendered config.ini …`, `… seeded stable encryption
keys …`, `… starting server …`), ce qui est utile pour diagnostiquer le premier démarrage.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application WriteFreely {#3-writefreely-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il crée la base de données et l'utilisateur de l'application, accorde `ALL
  PRIVILEGES` sur la base de données, vérifie que l'utilisateur de l'application peut se connecter et arrête le
  sidecar Cloud SQL Proxy. Le job est idempotent (`CREATE ... IF NOT EXISTS`,
  `max_retries = 3`) et peut être réexécuté en toute sécurité.
- **Schéma créé au démarrage.** Le point d'entrée du conteneur rend `config.ini` (avec
  `DB_HOST = 127.0.0.1`) puis exécute `writefreely db init` à chaque démarrage pour créer
  les tables (tolérant si elles existent déjà), de sorte que le schéma est amorcé sans
  étape de migration séparée.
- **Les trois clés AES-256 sont immuables après le premier démarrage.** Elles sont générées une fois
  et écrites dans Secret Manager. La modification de l'une d'entre elles déconnecte tous les utilisateurs (les signatures de cookies
  ne sont plus valides) et rend les adresses e-mail précédemment chiffrées indéchiffrables. Ne les faites pivoter
  que pendant une fenêtre de maintenance planifiée.
- **Créez le premier compte après le déploiement.** L'inscription est fermée par défaut
  (`open_registration = false`) et aucun administrateur n'est initialisé. Pour créer le premier compte,
  soit définissez temporairement `WF_OPEN_REGISTRATION = "true"` via `environment_variables`,
  inscrivez-vous via l'interface utilisateur, puis remettez-le à `"false"` ; soit exécutez
  `--create-admin` de WriteFreely à l'intérieur d'un pod en cours d'exécution :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    /usr/local/bin/writefreely --create-admin <user>:<password>
  ```
- **Correction de l'URL publique.** Le point d'entrée revient à l'hôte public injecté par la fondation
  `GKE_SERVICE_URL`. Une fois l'adresse IP du LoadBalancer attribuée, définissez
  `WF_PUBLIC_URL` (via `environment_variables`) sur l'URL externe ou le domaine personnalisé afin
  que les liens générés et la fédération utilisent l'hôte accessible.
- **Chemin de santé.** La sonde de démarrage est **TCP** (prête dès que le port 8080 est lié)
  et la sonde de vivacité est **HTTP `GET /`** — WriteFreely sert sa page d'accueil avec un
  `200` lorsqu'elle est saine ; il n'y a pas de point de terminaison `/health` dédié.
- **Confirmez l'hôte de la base de données injecté dans le pod en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|WF_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour WriteFreely sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `writefreely` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `writeas/writefreely` ; `latest` résout l'image de base vers l'ARG de build `0.12.0` épinglé. Épinglez une version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Laisser comme `custom` — le wrapper de génération de configuration doit être construit. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE ne prend pas en charge la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Réplicas maximum. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Ressources par pod. |
| `container_port` | `8080` | Le serveur web de WriteFreely se lie au port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy ; `DB_HOST` est remplacé par `127.0.0.1`. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Exposition IP externe pour le blog. |
| `session_affinity` | `ClientIP` | Routage persistant vers le même pod. |
| `workload_type` | `null` | Par défaut, un déploiement sans état. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires. À utiliser pour `WF_SITE_NAME`, `WF_SITE_DESCRIPTION`, `WF_PUBLIC_URL`, `WF_OPEN_REGISTRATION`. Ne pas définir `WF_KEY_*` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut : WriteFreely n'a pas besoin de système de fichiers partagé. Le contenu réside dans MySQL et les clés de chiffrement sont initialisées à partir de Secret Manager à chaque démarrage. |
| `nfs_mount_path` | `/var/lib/writefreely` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `writefreely` | Nom de la base de données → injecté comme `DB_NAME`. Immuable après le premier déploiement. |
| `application_database_user` | `writefreely` | Utilisateur de l'application → injecté comme `DB_USER`. Immuable après le premier déploiement. |
| `database_type` | `"MYSQL_8_0"` | Défini explicitement, correspondant au moteur attendu par la couche d'application partagée. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s | Prêt dès que le port 8080 est lié. |
| `liveness_probe` | HTTP `/`, délai de 30s | Pilote également la disponibilité et la vérification de santé de l'équilibreur de charge, de sorte qu'un long délai maintient le pod hors service ; la sonde de démarrage TCP couvre déjà les démarrages lents. |

### Groupe 15 — Redis (inerte pour WriteFreely) {#group-15--redis-inert-for-writefreely}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Laisser désactivé** — WriteFreely ne peut pas utiliser Redis ; l'activer n'injecte qu'un `REDIS_HOST` ignoré. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre WriteFreely. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'importation. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au
> moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au
> moment de la planification — IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS,
> un `database_type` qui ne correspond pas à une extension activée, des valeurs de quota de mémoire
> sans suffixes d'unité binaire, un `backup_retention_days` hors de portée. Une configuration invalide
> échoue la **planification** avec une erreur claire et nommée avant que toute ressource ne soit
> créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Clés AES-256 (`WF_KEY_*`, auto-générées) | Ne jamais faire pivoter après le premier démarrage | Critique | La rotation déconnecte tous les utilisateurs et rend les données de courrier électronique chiffrées indéchiffrables. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `true` | Critique | Sur GKE, le sidecar Auth Proxy est requis ; le désactiver supprime l'écouteur `127.0.0.1:3306` et interrompt la connectivité MySQL. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans fichier de sauvegarde valide échoue le job d'importation. |
| `container_image_source` | `custom` | Élevé | Définir `prebuilt` sans une image qui intègre le point d'entrée de génération de configuration produit un pod qui ne peut pas rendre `config.ini` et ne démarre pas. |
| `WF_PUBLIC_URL` | URL / domaine de l'équilibreur de charge externe | Élevé | Un hôte public incorrect rompt les liens générés, la fédération et les redirections. |
| `reserve_static_ip` | `true` | Élevé | Avec `false`, `GKE_SERVICE_URL` peut revenir à un hôte interne `*.svc.cluster.local` inaccessible au moment de l'application (une course d'IP LB éphémère), que le point d'entrée intègre dans `config.ini` comme hôte public — confirmé sur WriteFreely. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; le garde de validation rejette les valeurs invalides. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions peuvent rebondir entre les pods ; des clés de cookie stables rendent cela tolérable mais l'affinité est préférée. |
| `application_version` | Épingler une version | Moyen | `latest` peut modifier l'image de base lors des redéploiements ; l'épinglage maintient les builds reproductibles. |
| `WF_OPEN_REGISTRATION` | `false` après le premier administrateur | Moyen | Laisser l'inscription ouverte permet à quiconque ayant l'URL de créer un compte. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à WriteFreely
partagée avec la variante Cloud Run est décrite dans
**[WriteFreely_Common](WriteFreely_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : WriteFreely sur GKE Autopilot](../labs/WriteFreely_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [WriteFreely Common — Configuration d'application partagée](WriteFreely_Common.md) — la configuration partagée par les deux cibles de déploiement.
