---
title: "Supabase sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Supabase sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Supabase_GKE.md @ e69407af sha256:edfacd5c33e3 -->

# Supabase sur GKE Autopilot {#supabase-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Supabase_GKE.png" alt="Supabase sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Supabase est une alternative open-source à Firebase — un backend-as-a-service complet
basé sur PostgreSQL. Il fournit une base de données PostgreSQL 15 avec l'extension pgvector,
des abonnements en temps réel, l'authentification GoTrue, des API REST PostgREST, un service
de stockage compatible S3 et un tableau de bord d'administration Studio, le tout derrière
une **passerelle API Kong**. Ce module déploie Supabase sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

> **GKE uniquement.** Supabase est disponible uniquement dans la variante GKE. Son architecture
> multi-services (passerelle Kong, GoTrue, PostgREST, Realtime, Storage, Studio)
> nécessite des connexions persistantes et des primitives Kubernetes que Cloud Run ne prend pas en charge.

Ce guide se concentre sur les services cloud utilisés par Supabase et sur la manière de les explorer
et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie
du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Supabase sur RAD, et comment cela se compare {#what-supabase-costs-on-rad-and-how-that-compares}

**Le module Supabase sur GKE Autopilot de RAD coûte environ 96,70 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 110 crédits (11 $ US, ou 99 crédits dans un projet géré par RAD, soit 10 % de moins).** Il n'existe pas de variante Cloud Run — l'architecture multi-services de Supabase (passerelle Kong, GoTrue, PostgREST, Realtime, Storage, Studio) nécessite des connexions persistantes et des primitives Kubernetes que Cloud Run ne fournit pas — GKE Autopilot est donc la seule façon dont RAD le déploie. Si vous n'avez besoin de Supabase qu'occasionnellement — un backend de prototype, une évaluation avant de vous engager — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **96,70 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **87 crédits par jour**, soit environ 2 610 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ceux-ci.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 2 Gio | 39,68 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **96,70 $ US** |

### Comment cela se compare {#how-it-compares}

- Le cloud hébergé de Supabase est la comparaison évidente, car c'est le même projet open-source géré par son propre mainteneur. **Gratuit** est 0 $/mois (2 projets actifs, base de données de 500 Mo, les projets sont mis en pause après une semaine d'inactivité) ; **Pro** commence à **25 $/mois** (comprend un crédit de calcul de 10 $) ; **Team** commence à **599 $/mois** pour la conformité SOC2/ISO et les SLA (source : [supabase.com/pricing](https://supabase.com/pricing)). Le chiffre de RAD pour un projet propre est bien supérieur au prix de départ du plan Pro, mais vous obtenez une instance dédiée dans votre propre projet GCP plutôt qu'une instance partagée et mesurée à l'usage.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — moins cher, mais exécuter l'ensemble de la pile Supabase (passerelle, authentification, temps réel, stockage, Postgres) vous-même sur l'un de ces systèmes signifie tout opérer à la main.
- Les six services de Supabase représentent ensemble une empreinte plus lourde que la plupart des applications sur RAD, ce qui se reflète dans le chiffre de crédit quotidien du projet géré — le coût d'exécution ici, et non les frais de module, est ce qui génère réellement la facture.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Supabase s'exécute dans un projet géré par RAD, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne supprime pas Cloud SQL ou la ressource de calcul un par un : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google affirme que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez des tables ou des objets de stockage que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois la fenêtre de restauration de 30 jours passée, l'alternative est de supprimer Supabase purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 115 crédits (environ 11,50 $ US) dans votre propre projet, ou 104 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Supabase devait rester inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet propre ci-dessus (environ 3,22 $ US par jour), cela représente environ 4 jours ou plus, ou environ 2 jours ou plus dans un projet géré par RAD (87 crédits par jour). La majeure partie du coût d'exécution ici est la base de données ; elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de Supabase alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [supabase.com/pricing](https://supabase.com/pricing) pour les plans de cloud hébergés de Supabase.

## 1. Vue d'ensemble {#1-overview}

Le déploiement Supabase exécute une passerelle API Kong comme charge de travail GKE principale,
devant un ensemble de microservices Supabase. Il relie les services Google Cloud suivants :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Passerelle API (calcul) | GKE Autopilot | Pods de passerelle Kong, 1 vCPU / 2 Gio par défaut, auto-scalés horizontalement |
| Microservices | GKE Autopilot (services additionnels) | Authentification GoTrue, PostgREST, Realtime, API de stockage, Studio — chacun un déploiement séparé |
| Base de données | GKE Autopilot (dans l'espace de noms `supabase/postgres`) | Requis — Supabase est nativement PostgreSQL. Pas Cloud SQL : `main.tf` définit `database_type = "NONE"` sur la fondation et exécute `supabase/postgres` comme service additionnel |
| Stockage d'objets | Cloud Storage | Un bucket dédié suffixé par `storage` pour les téléchargements de fichiers |
| Secrets | Secret Manager | Secret de signature JWT (auto-généré), clé anonyme, clé de rôle de service, clé publiable, clé secrète et secret_key_base |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe ; l'utilisation de tout autre moteur
  empêche le démarrage.
- **Kong s'exécute en mode déclaratif (sans base de données).** Le routage est défini dans
  `/home/kong/kong.yml` intégré à l'image du conteneur — aucune base de données Kong n'est nécessaire.
- **Les identifiants JWT sont auto-générés ou des espaces réservés.** Le secret de signature JWT est
  auto-généré (32 caractères aléatoires). La clé anonyme et la clé de rôle de service sont stockées
  comme espaces réservés et **doivent être remplacées par des JWT signés valides** avant
  l'utilisation en production.
- **Le mot de passe superutilisateur Postgres dans l'espace de noms est auto-généré.** Comme le
  Realtime `SECRET_KEY_BASE`/`DB_ENC_KEY`, c'est un `random_password` sans
  variable d'entrée correspondante — non fourni par l'utilisateur, et interne uniquement (ClusterIP,
  jamais exposé).
- **pgvector est livré avec l'image de la base de données.** `pgcrypto`, `uuid-ossp` et `pgvector`
  sont livrés avec `supabase/postgres`, de sorte que les fonctionnalités d'IA/d'intégration de Supabase
  fonctionnent dès la sortie de la boîte ; les propres jobs d'extension de la fondation sont désactivés (`enable_postgres_extensions`
  est remplacé par `false` dans `main.tf`) car ils ciblent Cloud SQL.
- **La mise en miroir des images est toujours activée.** Les images Kong et sidecar sont mises en miroir dans
  Artifact Registry à chaque apply pour éviter les limites de débit de Docker Hub.
- **L'affinité de session est `None`.** Kong est sans état ; le routage persistant n'est pas requis
  au niveau de la passerelle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — passerelle Kong et microservices Supabase {#a-gke-autopilot--kong-gateway-and-supabase-microservices}

La charge de travail GKE principale exécute la passerelle API Kong sur le port 8000. Kong achemine toutes
les requêtes entrantes vers les microservices Supabase par préfixe de chemin :

| Préfixe de chemin | Service cible | Port |
|---|---|---|
| `/auth/v1/*` | GoTrue (authentification) | 9999 |
| `/rest/v1/*` | PostgREST (API REST) | 3000 |
| `/realtime/v1/*` | Realtime (WebSocket) | 4000 |
| `/storage/v1/*` | API de stockage | 5000 |

Des services Supabase supplémentaires (GoTrue, PostgREST, Realtime, Storage, Studio) sont
déployés en tant que déploiements Kubernetes séparés dans le même espace de noms via
`additional_services`.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez une charge de travail pour voir les pods, les événements,
  et les métriques. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du type de charge de travail
(Deployment vs StatefulSet).

### B. PostgreSQL 15 — `supabase/postgres` dans l'espace de noms {#b-postgresql-15--in-namespace-supabasepostgres}

Supabase stocke toutes les données d'application dans un déploiement `supabase/postgres` exécuté dans
le même espace de noms (un service ClusterIP, jamais exposé en externe) — **pas** Cloud
SQL, et sans aucun proxy d'authentification. Lors du premier déploiement, le job `db-init` s'y connecte
en tant que `supabase_admin` et définit les mots de passe des rôles de service, crée les schémas Supabase
et applique les autorisations de schéma `public`.

> **Les données sont éphémères.** Le pod postgres écrit sur le disque local du pod
> (`ephemeral_storage_limit = "4Gi"`), de sorte que les données sont réinitialisées lorsque le pod redémarre —
> acceptable pour un déploiement de lab/test ; un déploiement de production nécessite un PVC de bloc par pod.

- **Console :** Kubernetes Engine → Charges de travail → le déploiement `postgres`.
- **CLI :**
  ```bash
  kubectl get deploy,svc -n "$NAMESPACE" | grep postgres
  kubectl exec -n "$NAMESPACE" deploy/<postgres-workload> -- \
    psql -U supabase_admin -d postgres -c '\dn'
  ```

Pour le modèle de connexion Cloud SQL de la fondation (inutilisé ici), les sauvegardes et
la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (déclaré avec `name_suffix = "storage"`) est
provisionné pour les téléchargements de fichiers Supabase. Le compte de service de la charge de travail se voit accorder l'accès automatiquement.
La prévention de l'accès public est définie sur `inherited` afin que les ACL au niveau du bucket puissent être utilisées pour
servir des objets.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager — identifiants et clés JWT {#d-secret-manager--jwt-credentials-and-keys}

L'authentification Supabase est basée sur les JWT. Six secrets sont stockés dans Secret Manager :

| Suffixe du secret | Contenu | Notes |
|---|---|---|
| `-jwt-secret` | Secret de signature JWT de 32 caractères | Auto-généré si `jwt_secret` est vide |
| `-anon-key` | JWT anonyme public | **Espace réservé par défaut — doit être remplacé** |
| `-service-role-key` | JWT de rôle de service | **Espace réservé par défaut — doit être remplacé** |
| `-publishable-key` | Clé API opaque publiable (anonyme) | Espace réservé si non fourni |
| `-secret-key` | Clé API opaque côté serveur | Espace réservé si non fourni |
| `-key-base` | `secret_key_base` de 64 caractères pour Realtime/Supavisor | Auto-généré si `secret_key_base` est vide |

Le mot de passe de la base de données est généré et géré séparément par la fondation ; son
nom de secret est rapporté dans les Sorties (`database_password_secret`).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the JWT signing secret:
  gcloud secrets versions access latest --secret=<prefix>-jwt-secret --project "$PROJECT"
  # Update the anon key after generating a signed JWT:
  echo -n "<signed-anon-jwt>" | gcloud secrets versions add <prefix>-anon-key \
    --data-file=- --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la passerelle Kong est exposée via une adresse IP externe de Cloud Load Balancing.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut
être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés et les adresses IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Supabase {#3-supabase-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` se connecte au service
  `supabase/postgres` dans l'espace de noms en tant que `supabase_admin` et définit de manière idempotente les mots de passe LOGIN
  sur les rôles de service que l'image laisse sans mot de passe (`authenticator`,
  `supabase_auth_admin`, `supabase_storage_admin`), crée les schémas `auth`, `storage`,
  `_realtime` et `realtime` avec leurs autorisations, et définit les GUC de base de données
  `app.settings.jwt_secret`/`jwt_exp`. Il s'exécute sans blocage
  (`execute_on_apply = false`) avec sa propre boucle d'attente `pg_isready`, car la
  fondation crée des jobs d'initialisation avant les services supplémentaires. Il peut être réexécuté en toute sécurité.
- **Remplacement de l'espace réservé JWT.** Après le premier déploiement, les secrets de clé anonyme et de rôle de service
  contiennent des chaînes d'espace réservé. Ceux-ci **doivent être remplacés** par des JWT valides
  signés par le `jwt_secret` auto-généré avant que les clients Supabase puissent
  s'authentifier :
  1. Récupérez le secret JWT : `gcloud secrets versions access latest --secret=<prefix>-jwt-secret`
  2. Générez un JWT anonyme (`role: anon`) et un JWT de rôle de service (`role: service_role`)
     en utilisant [jwt.io](https://jwt.io) ou le
     [générateur JWT Supabase](https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys).
  3. Téléchargez chaque JWT : `echo -n "<jwt>" | gcloud secrets versions add <secret-name> --data-file=-`
  4. Redémarrez le pod Kong pour prendre en compte les secrets mis à jour :
     `kubectl rollout restart deploy/<kong-workload> -n "$NAMESPACE"`
- **Les identifiants JWT sont immuables en tant qu'ensemble.** Les `jwt_secret`, `anon_key` et
  `service_role_key` doivent toujours être régénérés ensemble. Modifier le secret JWT
  tout en laissant les clés dérivées inchangées invalide immédiatement tous les jetons émis.
- **Kong est sans état.** La passerelle lit le routage à partir du `kong.yml` déclaratif
  intégré à l'image. Aucune base de données Kong n'est utilisée.
- **Les sondes de santé sont TCP, pas HTTP `/health`.** Les variables `startup_probe`/`liveness_probe`
  (et `startup_probe_config`/`health_check_config`) déclarent toutes une valeur par défaut HTTP
  `GET /health`, mais la configuration déclarative sans base de données de `kong.yml` ne définit pas de
  route `/health` (seulement `/rest/v1`, `/auth/v1`, `/realtime/v1`, `/storage/v1`,
  `/pg` et `/` pour Studio) — une sonde HTTP contre elle renverrait 404. `main.tf`
  remplace inconditionnellement les sondes de démarrage et de vivacité du conteneur Kong déployé par **TCP**
  sur le port du conteneur, quelle que soit la valeur de ces variables. La sonde de démarrage permet toujours
  environ 5 minutes (`15 s initial delay × 30
  failures × 10 s period`) pour que la configuration de la base de données au premier démarrage soit terminée.
- **Realtime utilise PostgreSQL LISTEN/NOTIFY.** Aucun Redis n'est requis pour la pile Supabase
  principale ; `enable_redis` est par défaut `false`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Supabase sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `supabase` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Supabase` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `2.8.1` | Tag de version de l'image de la passerelle Kong. Épinglez à une version testée ; évitez `latest` en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `1000m` / `2Gi` | Limite de CPU et limite de mémoire pour le conteneur de la passerelle Kong. Augmentez le CPU à `2000m` pour le trafic de production. |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pods Kong. Gardez ≥ 1 — les démarrages à froid perturbent les flux de redirection OAuth. |
| `max_instance_count` | `3` | Nombre maximal de réplicas de pods Kong (plafond de l'autoscaler). |
| `container_port` | `8000` | Port proxy HTTP de Kong. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. Non utilisé par Supabase — chaque service se connecte directement à `supabase/postgres` dans l'espace de noms. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les requêtes de ressources. |
| `container_image_source` | `custom` | Mode source d'image. `custom` construit via Cloud Build à partir de `Supabase_Common/scripts/Dockerfile`. |
| `enable_image_mirroring` | `true` | Toujours activé — Kong est mis en miroir de Docker Hub vers Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs principales de Kong/Supabase sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires injectées en tant que variables d'environnement. |
| `jwt_secret` | `""` | Secret de signature JWT. Laissez vide pour générer automatiquement 32 caractères aléatoires. **Traitez comme immuable après le premier déploiement.** |
| `anon_key` | `""` | JWT anonyme public. Laissez vide ; un espace réservé est stocké — remplacez après le déploiement. |
| `service_role_key` | `""` | JWT de rôle de service (accès complet à la base de données). Laissez vide ; remplacez après le déploiement. **Ne jamais exposer dans le code client.** |
| `publishable_key` | `""` | Clé API opaque publiable (anonyme) pour les clients Supabase plus récents. Espace réservé si vide. |
| `supabase_secret_key` | `""` | Clé API opaque côté serveur pour les clients Supabase plus récents. Espace réservé si vide. |
| `secret_key_base` | `""` | Secret de chiffrement interne de 64 caractères pour Realtime/Supavisor. Auto-généré si vide. |
| `site_url` | `http://localhost:3000` | URL de base pour les redirections d'authentification GoTrue. Définissez sur votre domaine public. |
| `api_external_url` | `http://localhost:8000` | URL API Supabase externe pour la construction de la redirection OAuth. |
| `supabase_public_url` | `http://localhost:8000` | URL de base publique pour le tableau de bord et l'API REST. |
| `jwt_expiry` | `3600` | Expiration JWT en secondes pour les jetons émis par GoTrue. |
| `pgrst_db_schemas` | `public,storage,graphql_public` | Schémas PostgreSQL exposés par PostgREST. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kong est exposé en externe. |
| `session_affinity` | `None` | Kong est sans état ; le routage persistant n'est pas requis. |
| `workload_type` | `null` | Par défaut à `Deployment`. |
| `gke_cluster_name` | `""` | Nom du cluster GKE. Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Laissez vide pour générer automatiquement. |
| `termination_grace_period_seconds` | `60` | Secondes avant SIGKILL après SIGTERM. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles PVC dans le StatefulSet. Laissez non défini — l'état de Supabase réside dans Cloud SQL et GCS, pas dans le stockage local du pod. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod (si les PVC StatefulSet sont activés). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent toute planification de pod. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, délai initial de 30 s, 18 échecs | **Ignoré.** `main.tf` code en dur la sonde de démarrage Kong déployée en TCP ; voir §3. |
| `health_check_config` | HTTP `/health`, délai initial de 60 s, 3 échecs | **Ignoré.** `main.tf` code en dur la sonde de vivacité Kong déployée en TCP ; voir §3. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Tâches de cluster planifiées (par exemple, routines de nettoyage de base de données). |
| `additional_services` | `[]` | **Microservices Supabase** (GoTrue, PostgREST, Realtime, Storage API, Studio) déployés en tant que déploiements Kubernetes supplémentaires dans le même espace de noms. Chaque entrée spécifie `name`, `image`, `port`, les limites de ressources, les variables d'environnement et la configuration de la sonde. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas nécessaire pour Supabase ; le stockage est géré par GCS. L'activer ajoute des coûts inutiles. |
| `nfs_mount_path` | `/var/lib/storage` | Chemin de montage si NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket suffixé par `storage`. |
| `storage_buckets` / `gcs_volumes` | _(défini par Common)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Inerte — `main.tf` remplace la valeur que la fondation reçoit réellement par `"NONE"`, car PostgreSQL s'exécute dans l'espace de noms plutôt que sur Cloud SQL. |
| `application_database_name` | `postgres` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `supabase_admin` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `enable_postgres_extensions` | `true` | Installer `pgcrypto`, `uuid-ossp` et `pgvector`. Requis. |
| `postgres_extensions` | `["pgcrypto","uuid-ossp","pgvector"]` | Liste des extensions. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `network_tags` | `[]` | Tags réseau appliqués aux nœuds et pods GKE. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant la passerelle Kong. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes (passerelle Kong). |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre l'API Supabase via la passerelle Kong. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application (`postgres`). |
| `database_user` | Utilisateur de la base de données de l'application (`supabase_admin`). |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image Kong déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Pipeline de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt(e). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `jwt_secret` | auto-généré ou fixé au premier déploiement | Critique | Le modifier après le déploiement invalide tous les JWT émis ; toutes les connexions client sont rompues. `anon_key` et `service_role_key` doivent être régénérés ensemble. |
| `anon_key` / `service_role_key` | JWT signés (remplacer les espaces réservés) | Critique | Les valeurs d'espace réservé entraînent un retour 401 pour chaque appel d'API Supabase. Les trois identifiants JWT doivent être régénérés comme un ensemble atomique. |
| `enable_cloudsql_volume` | `true` | Faible | Inerte pour Supabase — GoTrue, PostgREST, Realtime et Storage se connectent tous au `supabase/postgres` dans l'espace de noms via leurs propres URL `postgres://`, et non via le proxy d'authentification. |
| `database_type` | `POSTGRES_15` | Faible | Inerte — `main.tf` transmet `"NONE"` à la fondation quoi qu'il arrive, car PostgreSQL 15 s'exécute comme un service `supabase/postgres` dans l'espace de noms. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod. |
| `enable_postgres_extensions` | `true` | Faible | Remplacé par `false` dans `main.tf` (les jobs d'extension de la fondation ciblent Cloud SQL, que ce module n'utilise pas) ; les extensions sont livrées dans l'image `supabase/postgres`. |
| `min_instance_count` | `1` | Élevé | Le réglage à `0` permet une mise à l'échelle à zéro ; les démarrages à froid de Kong prennent 15 à 30 s et perturbent les flux de redirection OAuth. |
| `container_resources` CPU | `2000m` pour la production | Élevé | Un CPU insuffisant entraîne une latence élevée et des timeouts 504 sous charge. |
| `container_resources` mémoire | `2Gi` minimum | Élevé | Trop peu de mémoire provoque des OOM kills sous charge concurrente. |
| `startup_probe_config` / `startup_probe` | inerte — `main.tf` code en dur la sonde déployée en TCP (`failure_threshold=30`, `period_seconds=10`, ~5 min) | Élevé | La définition de ces variables n'a aucun effet sur le conteneur Kong déployé ; ne vous fiez pas à elles pour prolonger la tolérance au premier démarrage — voir §3. |
| `site_url` / `api_external_url` / `supabase_public_url` | URL publiques réelles | Élevé | Les valeurs par défaut de localhost empêchent les flux OAuth et la construction de redirections de fonctionner en dehors du cluster. |
| `application_version` | épinglé (pas `latest`) | Moyen | Tirer `latest` risque des versions de Kong incompatibles avec la configuration déclarative fournie. |
| `enable_nfs` | `false` | Faible | NFS est inutile pour Supabase ; l'activer ajoute des coûts Filestore et une dépendance qui peut retarder le provisionnement. |
| `enable_redis` | `false` | Moyen | Redis est facultatif. Si défini sur `true`, `redis_host` doit pointer vers un point de terminaison accessible ; un hôte inaccessible provoque des timeouts de démarrage de Kong. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Supabase
partagée entre les secrets, le build de l'image Kong et le job d'initialisation
de la base de données est décrite dans **[Supabase_Common](Supabase_Common.md)**.

## Guides associés {#related-guides}

- [Labo pratique : Supabase sur GKE Autopilot](../labs/Supabase_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Supabase Common — Configuration d'application partagée](Supabase_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Hasura sur Google Cloud Run](Hasura_CloudRun.md), [Directus sur Cloud Run](Directus_CloudRun.md), [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md) dans la solution **Services de backend d'application**.
