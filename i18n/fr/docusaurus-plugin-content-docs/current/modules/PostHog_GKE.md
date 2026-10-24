---
title: "PostHog sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de PostHog sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/PostHog_GKE.md @ 1665a43e sha256:b7a68d2e8e89 -->

# PostHog sur GKE Autopilot {#posthog-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PostHog_GKE.png" alt="PostHog sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

PostHog est une plateforme open source d'analyse de produits — analyse d'événements,
relecture de sessions, indicateurs de fonctionnalités, tests A/B et entonnoirs —
publiée sous une licence hybride MIT/PostHog-commerciale. Elle fonctionne comme une
application web Python/Django avec un worker Celery et un ordonnanceur beat
colocalisés, et son pipeline d'événements est construit autour de deux services
stateful supplémentaires : **Kafka** comme épine dorsale d'ingestion et
**ClickHouse** comme véritable magasin d'événements analytiques. Ce module déploie
PostHog sur **GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par PostHog et sur la manière
de les explorer et de les opérer depuis la Google Cloud Console et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

> **Pas de variante Cloud Run, par conception.** Le pipeline d'événements de
> PostHog exige Kafka et ClickHouse — deux services stateful et de longue durée
> incompatibles avec le modèle serverless et de mise à l'échelle à zéro de Cloud Run.
> Seuls `PostHog_GKE` et `PostHog_Common` existent.

> **Prérequis de déploiement (recommandé, non imposé) :** Déployer `ClickHouse_GKE`
> en premier et y faire pointer `clickhouse_host` est le chemin de production
> recommandé — correspondant au précédent de dépendance inter-modules
> `RAGFlow_GKE` → `Elasticsearch_GKE` de ce catalogue. Contrairement à
> `elasticsearch_hosts` obligatoire de RAGFlow, PostHog propose également une
> solution de repli ClickHouse à nœud unique intégrée au module (`enable_inline_clickhouse = true`)
> pour une utilisation en dev/test, de sorte que le plan n'est pas rejeté d'emblée
> sans instance externe — mais la validation au moment du plan exige toujours que
> l'un des deux chemins soit résolu.

---

## Ce que coûte PostHog sur RAD, et comment cela se compare {#what-posthog-costs-on-rad-and-how-that-compares}

**L'exécution de PostHog dans votre propre projet Google Cloud coûte environ 257,89 $ US/mois en infrastructure, plus des frais de module uniques de 300 crédits RAD** (dimensionnés à 4 vCPU / 16 GiB sur les pods GKE Autopilot). RAD facture les frais de module une seule fois, au moment du déploiement — jamais lors d'une mise à jour — plus le temps de build mesuré en crédits ; l'utilisation de Google Cloud elle-même est facturée à votre propre compte de facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les mêmes ressources sont mesurées toutes les heures en crédits au prix catalogue plus la marge de RAD — environ 160 crédits/jour — et les frais de module sont inférieurs de 10 %, à 270 crédits. Voir "Mettre en pause gratuitement" ci-dessous pour savoir comment un déploiement PostHog géré par RAD peut être arrêté, sans frais d'exécution, jusqu'à ce que vous en ayez à nouveau besoin.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Élément | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 300 crédits (une fois) | 270 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût d'exécution Google Cloud | ~257,89 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~160 crédits/jour, mesurés toutes les heures au prix catalogue + marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 4x vCPU / 16 GiB | 187,44 |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 |
| Frais de gestion de cluster GKE\* | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **257,89 $** |

\* Non inclus dans le total ci-dessus — il est partagé entre toutes les applications GKE exécutées dans le même projet, il est donc de 0 $ si c'est votre seul cluster GKE.

### Comment cela se compare {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel, directement comparable, pour ce projet open source exact, donc la comparaison honnête est un simple serveur auto-géré : Hetzner CPX22 (2 vCPU/4 Go, ~24 $/mois), un Droplet DigitalOcean 2 vCPU/4 Go (~24 $/mois), ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, ~49 $/mois). L'empreinte de cette application (4+ vCPU, des dizaines de GiB de mémoire) est plus grande que n'importe laquelle de ces classes — une machine auto-gérée dimensionnée pour correspondre coûterait bien plus que les chiffres ci-dessous, avant de compter l'effort distinct de faire fonctionner sa propre base de données/couche de cache à la main.
- RAD ne prétend **pas** battre un simple VPS sur le prix affiché — ce n'est généralement pas le cas. Ce que RAD ajoute pour le même montant ou un montant similaire est une base de données gérée, des identifiants conservés dans Secret Manager, la surveillance et une mise à jour en un clic, ce qu'un simple VPS ne vous offre pas gratuitement.
- Sur un simple VPS, c'est vous qui appliquez les correctifs de sécurité du système d'exploitation/de la base de données, qui effectuez et testez les sauvegardes, et qui renouvelez les certificats ; Cloud SQL géré par RAD, Secret Manager et la surveillance gèrent les trois pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option phare sur un projet **géré par RAD**, et elle est gratuite pendant la pause. La suppression
d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet lui-même —
la suppression logique récupérable de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne
détruit pas la base de données, aucune VM, ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration — dans les 30 jours, et uniquement par le propriétaire du projet — demande à Google de
réactiver le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur
chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à
jour trouve les mêmes ressources déjà présentes : c'est une vérification, pas une reconstruction, et une mise à
jour ne facture jamais les frais de module à nouveau. L'ensemble de la restauration ne coûte qu'une poignée de
crédits (moins de 1 $ US) en temps de build pour une chaîne de déploiements typique. Ce qu'il faut : vous devez
être propriétaire du projet (pas seulement faire gérer sa facturation par RAD), vous devez le restaurer vous-même
dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la
création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du palier (100
crédits pour le palier sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google
indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une
restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce
bucket a la suppression logique de Cloud Storage explicitement désactivée, de sorte que le bucket de sauvegarde
est très probablement supprimé dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez
une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation
par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **projet propre** (ou un projet géré par RAD au-delà de sa fenêtre de restauration de 30 jours),
est de supprimer PostHog purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module
plus les builds — environ **303-306 crédits** au total pour ce module.

La suppression ne permet d'économiser de l'argent que si PostHog reste inutilisé suffisamment longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour ce module, cela représente environ 4 jours ou plus
d'inactivité, basé sur son propre coût d'exécution de 257,89 $ US/mois ci-dessus. La majeure partie de ce coût d'exécution
est généralement la base de données et toute VM de fichier/cache partagée, et ils ne s'arrêtent que si rien d'autre dans le
projet ne les utilise, donc la suppression de cette application seule n'économise que sa propre part de calcul si quelque
chose d'autre partage le projet.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont
supprimées avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant
  obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite
  fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client
  à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit
  de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété
  du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres de RAD et les estimations de crédits quotidiens ; [Resource Manager : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

PostHog fonctionne comme une charge de travail Python/Django conteneurisée unique avec un
worker Celery et un ordonnanceur beat colocalisés (correspondant au point d'entrée tout-en-un
par défaut de l'image amont — la même forme que le modèle de worker colocalisé Saleor/Woodpecker
de ce catalogue). Le déploiement relie quatre magasins de données indépendants, chacun ayant
une tâche distincte, et aucun d'entre eux n'est facultatif :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod PostHog personnalisé, 4 vCPU / 8 GiB par défaut |
| Métadonnées d'application | Cloud SQL pour PostgreSQL 15 | Tables d'application Django uniquement — utilisateurs, équipes, indicateurs de fonctionnalités, tableaux de bord. Aucune donnée analytique. |
| Magasin d'événements analytiques | ClickHouse | **Obligatoire.** `ClickHouse_GKE` externe recommandé (production) ; solution de repli à nœud unique intégrée au module pour le dev/test |
| Épine dorsale d'ingestion | Kafka | **Obligatoire.** Broker Redpanda à nœud unique inclus par défaut (pas encore de module Kafka autonome dans ce catalogue) |
| Cache / broker | Redis | **Obligatoire.** Broker Celery, pub/sub du serveur de plugins, cache Django — la plateforme injecte l'IP Redis co-hébergée par le serveur NFS par défaut |
| Stockage d'objets | Cloud Storage (interopérabilité S3) | Enregistrements de relecture de session et exportations de données, via le client S3-compatible natif de PostHog — pas un montage GCS FUSE |
| Secrets | Secret Manager | `SECRET_KEY` Django, paire de clés HMAC d'interopérabilité S3, mot de passe de la base de données, `CLICKHOUSE_PASSWORD` (externe, ou généré pour la solution de repli intégrée) |
| Ingress | Cloud Load Balancing | Service External LoadBalancer ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est fixe, et ce n'est PAS là que résident vos données analytiques.** Postgres
  ne contient que les métadonnées de l'application Django. Chaque événement, personne, index
  d'enregistrement de session et requête d'analyse s'exécute sur ClickHouse à la place — une
  forme structurellement différente de la plupart des applications basées sur des bases de
  données de ce catalogue.
- **Redis est obligatoire et ne peut pas être désactivé.** Une validation au moment du plan
  rejette `enable_redis = false` purement et simplement. Sans `redis_host`, la plateforme
  injecte l'IP Redis co-hébergée par le serveur NFS — c'est pourquoi `enable_nfs`
  par défaut à `true` même si PostHog lui-même n'a aucune dépendance
  média de système de fichiers.
- **ClickHouse est obligatoire, externe par défaut.** `clickhouse_host` est vide et
  `enable_inline_clickhouse = false` prêt à l'emploi — définissez `clickhouse_host` sur une
  instance `ClickHouse_GKE` déployée séparément pour la production, ou activez
  `enable_inline_clickhouse = true` pour une solution de repli dev/test à nœud unique et sans
  persistance.
- **Kafka est obligatoire, inclus par défaut.** `enable_inline_kafka = true` déploie un
  broker Redpanda à nœud unique (compatible API Kafka, sans Zookeeper) comme
  entrée `additional_services` — pas de volume persistant, acceptable pour un pipeline
  d'ingestion puisque les événements sont renvoyés/recapturés en cas de perte.
- **La mise à l'échelle horizontale est désactivée.** `max_instance_count` est plafonné à
  `1` — validé au moment du plan. Le conteneur principal colocalise
  le worker Celery avec son ordonnanceur beat (`--with-scheduler`) ; N réplicas
  exécuteraient N ordonnanceurs beat en double, déclenchant chaque tâche périodique N fois.
- **Une image personnalisée est toujours construite.** Cloud Build étend `posthog/posthog`
  avec un point d'entrée cloud et une surcharge `docker-boot.sh` (voir §3) —
  contrairement à la plupart des applications `latest`-tag de ce catalogue,
  `posthog/posthog` publie un tag `latest` réellement frais suivant le master,
  donc aucune substitution de tag roulant n'est nécessaire, seulement la solution de contournement
  standard de nommage build-ARG.
- **Le stockage d'objets est S3-interop, pas GCS FUSE.** Le stockage de relecture de session/exportation
  passe par le client S3-compatible natif de PostHog vers l'API XML S3-interop de GCS via un compte
  de service dédié + paire de clés HMAC.
- **`enable_custom_domain` par défaut à `true`.** Combiné avec le
  `reserve_static_ip = true` par défaut, cela provisionne un certificat géré et HTTPS
  prêt à l'emploi via un nom d'hôte `<ip>.nip.io` même lorsque `application_domains`
  est laissé vide.
- **Le CPU/la mémoire sont pré-dimensionnés au-dessus des valeurs par défaut génériques.**
  `cpu_limit = "4000m"` / `memory_limit = "8Gi"` — tous deux augmentés après vérification en
  direct du premier démarrage réellement lourd de PostHog (Django enregistre ~80 sous-applications
  `products`, plus le worker Celery et le beat colocalisés).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail PostHog {#a-gke-autopilot--the-posthog-workload}

Le pod PostHog exécute le serveur web Django/gunicorn et l'ordonnanceur Celery
worker+beat colocalisé dans un seul conteneur, correspondant à la séquence de
démarrage `bin/docker` par défaut de PostHog.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail PostHog pour voir
  les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  # First lines of a healthy boot show the resolved config the cloud entrypoint composed:
  kubectl logs -n "$NAMESPACE" deploy/<service-name> | grep -A6 'cloud-entrypoint'
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment vs StatefulSet). Notez que `max_instance_count` est
strictement plafonné à `1` pour ce module — voir §4.

### B. Cloud SQL pour PostgreSQL 15 — métadonnées d'application Django uniquement {#b-cloud-sql-for-postgresql-15--django-app-metadata-only}

PostHog stocke ses propres métadonnées d'application Django (comptes d'utilisateurs, équipes/projets,
définitions d'indicateurs de fonctionnalités, tableaux de bord) dans une instance Cloud SQL pour PostgreSQL 15
gérée, accessible en privé via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1`. **Ce n'est
PAS là que résident les données analytiques** — voir §C. Lors du premier déploiement, un Job
d'initialisation (`db-init`) crée la base de données et l'utilisateur de l'application ; les propres
migrations Django de PostHog s'exécutent automatiquement à chaque démarrage de conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. ClickHouse — le véritable magasin d'événements analytiques {#c-clickhouse--the-actual-analytics-event-store}

Chaque événement, enregistrement de personne, index de relecture de session et requête d'analyse/entonnoir
s'exécute sur ClickHouse, et non sur Postgres — c'est la conception fondamentale de PostHog, pas un
détail d'implémentation. Ce module ne gère **pas** directement une instance ClickHouse durable :

- **Recommandé (production) :** déployez `ClickHouse_GKE` séparément et définissez
  `clickhouse_host` sur son DNS/IP de service interne. `clickhouse_password_secret` accepte
  un ID de secret Secret Manager (par exemple, la sortie de ce déploiement) et est injecté comme
  `CLICKHOUSE_PASSWORD`.
- **Solution de repli dev/test :** `enable_inline_clickhouse = true` déploie une instance ClickHouse
  à nœud unique en tant que `additional_service` GKE à côté de PostHog — un seul nœud,
  avec son répertoire de données sur un volume persistant (`clickhouse_disk_size`, par défaut
  `20Gi`). Le mot de passe de son utilisateur `default` est généré par
  déploiement et fourni par Secret Manager.

```bash
# Confirm PostHog can reach ClickHouse (native protocol, port 9000):
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
  sh -c 'echo "SELECT 1" | curl -s "http://$CLICKHOUSE_HOST:8123/" --data-binary @-'

# If using the in-module fallback, inspect it directly:
kubectl get pods -n "$NAMESPACE" -l app=<service-name>-clickhouse
kubectl logs -n "$NAMESPACE" deploy/<service-name>-clickhouse
```

La solution de repli intégrée au module a nécessité un bootstrap réellement étendu pour que les migrations de schéma de PostHog réussissent sur un nœud unique — un ClickHouse Keeper intégré (les tables de suivi des migrations de PostHog utilisent `ReplicatedMergeTree`, qui nécessite un coordinateur compatible ZooKeeper même pour un seul nœud), des macros de cluster/shard/réplica, dix clusters nommés (tous pointant vers le même nœud), des collections nommées pour les tables Kafka Engine, et un mot de passe — généré par déploiement et lu par l'application, le job de migration et le pod ClickHouse (**un mot de passe vide désactive entièrement l'accès réseau pour l'utilisateur `default` — cela ne signifie pas "ouvert, non authentifié",** confirmé par rapport au point d'entrée officiel `clickhouse/clickhouse-server`). La propre migration ClickHouse de PostHog nécessite également l'interface HTTP (port 8123) en plus du protocole natif (port 9000) — l'utilisation par ce module d'un deuxième port sur une entrée `additional_services` est ce qui a motivé l'ajout d'un nouveau champ `extra_ports` à `App_GKE` lui-même (voir §3). Étant donné que les dictionnaires de PostHog stockent le mot de passe ClickHouse dans leur DDL sur le volume persistant, le script de démarrage du pod réécrit ces mots de passe stockés avec le mot de passe actuel avant le démarrage du serveur, de sorte qu'un changement de mot de passe ne rompt pas `dictGet`.

### D. Kafka — l'épine dorsale d'ingestion {#d-kafka--the-ingestion-backbone}

Kafka se situe entre la capture d'événements et ClickHouse. Sans lui, le pipeline
d'ingestion de PostHog (confirmé par rapport au `docker-compose.hobby.yml` actuel : web/worker/plugin-server
en dépendent tous) n'a nulle part où mettre en file d'attente les événements entrants.

- **Par défaut :** `enable_inline_kafka = true` déploie un broker Redpanda à nœud unique
  (compatible API Kafka, sans Zookeeper — prend officiellement en charge un mode
  "dev-container" à processus unique) en tant que `additional_service` GKE. Pas de volume
  persistant — un redéploiement de pod perd les événements non consommés, acceptable pour
  un pipeline d'ingestion où les événements sont renvoyés/recapturés.
- **Alternative de production :** définissez `kafka_hosts` pour pointer vers un
  broker exploité en externe.

```bash
kubectl get pods -n "$NAMESPACE" -l app=<service-name>-kafka
kubectl logs -n "$NAMESPACE" deploy/<service-name>-kafka --tail=50
```

### E. Redis — broker Celery, pub/sub du serveur de plugins, cache Django {#e-redis--celery-broker-plugin-server-pubsub-django-cache}

Redis est obligatoire et ne peut pas être désactivé — `enable_redis = false` est rejeté au moment du plan.
Si `redis_host` n'est pas défini, la plateforme injecte l'IP Redis co-hébergée par le serveur NFS
(c'est pourquoi `enable_nfs` est par défaut `true`, même si PostHog n'a pas de dépendance
média de système de fichiers propre).

- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info clients
  ```

### F. Cloud Storage — stockage d'objets S3-interop {#f-cloud-storage--s3-interop-object-storage}

PostHog n'a pas de bibliothèque de médias de système de fichiers. Les enregistrements de relecture de session et les exportations de données passent par le **client S3-compatible natif** de PostHog, pointant vers l'API XML S3-interop de GCS via un compte de service dédié et une paire de clés HMAC — et non un montage GCS FUSE.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/     # bucket name is in the Outputs
  ```

### G. Secret Manager {#g-secret-manager}

Le `SECRET_KEY` de Django (signature de session — généré une fois, jamais régénéré lors d'un redéploiement ;
sa rotation invalide chaque session active), la paire de clés d'accès/secrète HMAC S3-interop, et le mot de passe
de la base de données sont tous stockés en tant que secrets Secret Manager et injectés dans les pods au moment de
l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~posthog"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### H. Réseau et ingress {#h-networking--ingress}

`enable_custom_domain` par défaut à `true`, qui achemine la charge de travail via
l'équilibreur de charge de l'API Gateway avec un certificat géré par Google — servant
automatiquement HTTPS sur un nom d'hôte `<ip>.nip.io` lorsque `application_domains` est vide.
`site_url` (injecté comme `SITE_URL`, utilisé par PostHog pour construire des liens
absolus — tableaux de bord, analyses partagées, charges utiles de webhook) doit être défini une fois
qu'un nom d'hôte réel ou une IP statique est configuré ; il utilise par défaut l'URL intra-cluster
prédite sinon.

```bash
kubectl get ingress,svc -n "$NAMESPACE"
gcloud compute addresses list --project "$PROJECT"
```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les IP statiques.

### I. Cloud Logging et Monitoring {#i-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

---

## 3. Comportement de l'application PostHog {#3-posthog-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation (`db-init`, `postgres:15-alpine`)
  crée la base de données PostgreSQL et l'utilisateur avant le démarrage de l'application. Aucune extension
  n'est installée — contrairement à de nombreuses applications de ce catalogue, PostHog n'en a pas besoin ;
  tout le stockage spécifique à l'analyse est dans ClickHouse.
- **Un deuxième job d'initialisation `clickhouse-migrate` dédié s'exécute jusqu'à la fin avant le démarrage de l'application.**
  Le propre `bin/migrate` de PostHog (exécuté à chaque démarrage de conteneur) lance la migration de schéma ClickHouse
  dans un sous-shell en arrière-plan qui s'exécute concurremment avec la migration Postgres au premier plan — et
  atteint sa vérification de migration asynchrone (`run_async_migrations`, qui interroge ClickHouse pour les tables que le job
  en arrière-plan peut encore être en train de créer) *avant* d'attendre ce job en arrière-plan. Sur une base de
  données fraîche, cela plante avec `IndexError: list index out of range` à chaque démarrage, pour toujours — le redémarrage ne permet pas à
  ClickHouse de "rattraper son retard" car `bin/migrate` refait toujours la même course à partir d'un démarrage à froid.
  Le job `clickhouse-migrate` de ce module pré-exécute `bin/migrate --scope=clickhouse` jusqu'à la fin sans que rien d'autre ne concurrence le même
  budget de temps, évitant ainsi complètement la course.
- **Les migrations Django s'exécutent automatiquement à chaque démarrage de conteneur**, via `./bin/migrate`
  (faisant partie de la séquence de démarrage par défaut intégrée à l'image personnalisée).
- **Le composant plugin-server Node.js est manquant dans l'image amont actuelle.**
  Vérifié en direct : `/code/nodejs` est absent de `posthog/posthog` (à la fois `:latest` et une
  build vieille de 6 jours), mais le script de démarrage amont réessaie toujours de s'y connecter toutes les 2
  secondes, bloquant le CPU à 100 % et affamant le processus qui doit répondre à la sonde de démarrage. Le
  `docker-boot.sh` de ce module ignore ce composant — l'ingestion d'événements et l'analyse de base fonctionnent
  correctement ; les fonctionnalités dépendantes des plugins peuvent ne pas fonctionner tant que l'amont ne les
  restaure pas. Voir [PostHog_Common](PostHog_Common.md) pour le diagnostic complet.
- **Secrets immuables générés au premier démarrage.** `SECRET_KEY` et la paire de clés HMAC S3-interop
  sont générés une fois et jamais régénérés lors d'un redéploiement — la rotation de `SECRET_KEY`
  après le premier démarrage invalide chaque session active.
- **Points de terminaison de santé.** `GET /_readyz` (démarrage) effectue des vérifications approfondies des
  dépendances (état de la migration Postgres, ClickHouse, Kafka, broker Celery, cache — vérifié à la source
  par rapport à `posthog/health.py`) avec un `failure_threshold = 145` délibérément grand (~25 minutes)
  pour s'adapter aux migrations Django au premier démarrage. `GET /_livez` (vivacité) est
  la vérification légère qui ne vérifie pas les dépendances en aval.
- **La première exécution est interactive.** Visitez l'interface utilisateur web après le déploiement et créez le
  compte administrateur sur l'écran d'inscription — aucune information d'identification d'administrateur pré-remplie
  n'existe dans Secret Manager.
- **Réplica unique par conception.** `max_instance_count` est plafonné à `1` — le conteneur
  principal colocalise le worker Celery avec son ordonnanceur beat ; l'exécution de N réplicas déclencherait
  chaque tâche périodique N fois.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour PostHog sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |
| `clickhouse_host` | `""` | Point de terminaison ClickHouse (nom d'hôte/IP nu, sans schéma). Recommandé : le DNS/IP de service interne d'un `ClickHouse_GKE` déployé séparément. |
| `clickhouse_port` | `9000` | Port TCP du protocole natif ClickHouse (utilisé uniquement lorsque `clickhouse_host` est défini). |
| `kafka_hosts` | `""` | Adresse(s) du broker Kafka, `host:port`. Laissez vide pour le broker Redpanda inclus. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `posthog` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `PostHog Product Analytics` | Nom convivial affiché dans la Console. |
| `application_version` | `latest` | Tag d'image `posthog/posthog`. PostHog publie un tag `latest` réellement frais suivant le master — utilisé tel quel, pas de substitution de tag roulant. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `4000m` | Augmenté par rapport à une valeur par défaut générique de 2000m après des délais d'expiration de sonde de démarrage vérifiés en direct (~95 % de saturation du CPU lors du premier démarrage). |
| `memory_limit` | `"16Gi"` | Augmenté après des arrêts OOM vérifiés en direct à 4Gi, 6Gi et 8Gi lors du premier démarrage — l'image enregistre plus de 90 sous-applications Django au démarrage. |
| `container_port` | `8000` | Le port natif du serveur Django/gunicorn. |
| `min_instance_count` | `1` | Réplicas minimum. |
| `max_instance_count` | `1` | **Plafonné à 1, validé au moment du plan** — ordonnanceur Celery beat colocalisé. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne pas écraser `CLICKHOUSE_*`, `KAFKA_HOSTS`, `OBJECT_STORAGE_*` — ceux-ci sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le Service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS (voir la note `enable_nfs` dans le Groupe 13). |

### Groupe 7 — Configuration StatefulSet {#group-7--statefulset-configuration}

S'applique uniquement lorsque `workload_type = "StatefulSet"` ou `stateful_pvc_enabled = true` ;
PostHog lui-même n'a pas d'exigence de stockage persistant par pod (les données analytiques sont
résidentes dans ClickHouse, pas locales).

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | HTTP `/_readyz`, vérifications approfondies des dépendances | `failure_threshold` délibérément grand (~25 min) pour couvrir les migrations Django au premier démarrage. |
| `health_check_config` / `liveness_probe` | HTTP `/_livez` | Vérification de vivacité légère — ne vérifie pas les dépendances en aval. |
| `uptime_check_config` | `{ enabled=false, path="/_livez" }` | Vérification de disponibilité Cloud Monitoring facultative ; désactivée par défaut. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs `db-init` + `clickhouse-migrate` intégrés. |
| `additional_services` | `[]` | Services supplémentaires fournis par l'opérateur uniquement — le broker Redpanda inclus et la solution de repli ClickHouse intégrée au module sont injectés automatiquement et ne font PAS partie de cette liste. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Maintenu `true` uniquement parce que c'est le mécanisme qui rend l'IP Redis co-hébergée disponible — PostHog n'a pas de dépendance média de système de fichiers propre. |
| `nfs_mount_path` | `/mnt/nfs` | Inerte pour PostHog. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket GCS utilisé par le client S3-compatible natif de PostHog (relecture de session, exportations). |
| `storage_buckets` | `[{ name_suffix="storage" }]` | Le seul bucket dans lequel le client S3-interop de PostHog écrit. |
| `gcs_volumes` | `[]` | Non utilisé — PostHog n'a pas de bibliothèque de médias de système de fichiers. |

### Groupe 15 — ClickHouse et Kafka {#group-15--clickhouse--kafka}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `clickhouse_database` | `posthog` | Nom de la base de données ClickHouse où les événements sont lus/écrits. |
| `clickhouse_user` | `default` | Nom d'utilisateur ClickHouse. |
| `clickhouse_password_secret` | `""` | ID du secret Secret Manager contenant le mot de passe ClickHouse (par exemple, d'un `ClickHouse_GKE` déployé séparément). Laissez vide pour la solution de repli intégrée au module, qui obtient un mot de passe généré par déploiement dans Secret Manager. |
| `enable_inline_clickhouse` | `false` | ClickHouse à nœud unique en tant que `additional_service` GKE. **Dev/test uniquement** — un nœud, données sur un volume persistant (`clickhouse_disk_size`). |
| `clickhouse_image_tag` | `26.6.1.1193` | Épinglé à la version exacte utilisée par le propre `docker-compose.base.yml` de PostHog — un tag récent générique (par exemple `24.12-alpine`) échoue à une vérification d'expression TTL dans l'une des propres migrations de PostHog. |
| `enable_inline_kafka` | `true` | Broker Redpanda à nœud unique en tant que `additional_service` GKE — la valeur par défaut. |
| `kafka_image_tag` | `v25.1.9` | Tag d'image Redpanda. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` (fixé à `POSTGRES_15` par `PostHog_Common`) | Métadonnées d'application uniquement — les données analytiques résident dans ClickHouse. |
| `db_name` | `posthog_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `posthog_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner l'Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `site_url` | `""` | Injecté comme `SITE_URL` — utilisé pour construire des liens absolus (tableaux de bord, analyses partagées, charges utiles de webhook). Par défaut, l'URL intra-cluster prédite ; à définir une fois qu'un domaine personnalisé ou une IP statique est configuré. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire, validé — ne peut pas être désactivé.** Broker Celery, pub/sub du serveur de plugins, cache Django. |
| `redis_host` | `""` | Hôte Redis. Si vide et que NFS est activé, l'IP du serveur NFS est utilisée. |
| `redis_port` | `6379` | Port Redis. |

Pour tous les autres groupes (CI/CD, Sauvegarde et maintenance, SQL personnalisé, IAP, Cloud Armor, VPC
Service Controls), PostHog hérite du comportement standard de [App_GKE](App_GKE.md) sans
surcharges spécifiques à l'application.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `web_url` | URL de l'interface utilisateur web de PostHog — servie par le service primaire lui-même (le conteneur Django/gunicorn co-localisé), et non par un frontal séparé. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application (métadonnées de l'application uniquement). |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (stockage d'objets interopérable S3). |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs `db-init` et `clickhouse-migrate`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt(e). `false` lors du premier apply d'un nouveau cluster inline — réexécutez l'apply pour terminer le déploiement. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_redis` | `true` (ne peut pas être désactivé) | Critique | Le broker Celery de PostHog, le pub/sub du plugin-server et le cache Django nécessitent tous Redis ; le serveur refuse de démarrer sans lui. |
| `clickhouse_host` / `enable_inline_clickhouse` | l'un doit être résolu | Critique | Sans un point de terminaison ClickHouse accessible, l'ensemble du pipeline d'événements analytiques de PostHog ne peut pas fonctionner — pas d'événements, pas d'insights, pas de relecture de session. |
| `kafka_hosts` / `enable_inline_kafka` | l'un doit être résolu (par défaut : inline) | Critique | Sans Kafka, les événements ingérés n'ont nulle part où être mis en file d'attente — le pipeline stagne. |
| `max_instance_count` | `1` (validé, ne peut pas être dépassé) | Critique | Le planificateur Celery beat co-localisé déclenche chaque tâche périodique une fois par réplica ; N réplicas signifie une exécution N fois en double des jobs planifiés. |
| `enable_inline_clickhouse` | `false` pour la production | Critique | Le fallback intra-module est un nœud unique sans réplication — son volume persistant survit à un redémarrage de pod, mais il n'y a pas de redondance ou de sauvegarde gérée pour les données analytiques (événements, relectures de session, insights). |
| `enable_inline_kafka` | `true` acceptable pour la plupart, `false` + broker externe pour une mise en file d'attente durable | Élevé | Le Redpanda fourni n'a pas de volume persistant — un redéploiement de pod entraîne la perte des événements non consommés (acceptable pour une ingestion renvoyée, pas pour une file d'attente durable). |
| `redis_host` | hôte explicite, ou laisser `""` avec `enable_nfs=true` | Critique | Si aucun n'est défini, `REDIS_HOST` est vide et PostHog échoue rapidement au démarrage avec une erreur claire. |
| `db_name` / `db_user` | défini une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur. Notez que cela n'affecte que les métadonnées de l'application, pas les données analytiques (résidentes dans ClickHouse). |
| `cpu_limit` / `memory_limit` | `4000m` / `8Gi` minimum | Élevé | En dessous de ces valeurs, le premier démarrage réellement lourd de PostHog (Django enregistrant environ 80 sous-applications, plus le worker Celery+beat co-localisé) a été vérifié en direct pour déclencher des délais d'attente de sonde de démarrage (CPU) ou des arrêts OOM (mémoire, confirmés à 4Gi et 6Gi). |
| `clickhouse_image_tag` (fallback inline) | `26.6.1.1193` — ne pas utiliser une balise générique récente | Élevé | Une version générique récente (par exemple `24.12-alpine`) échoue à une vérification de validation d'expression TTL utilisée par l'une des propres migrations ClickHouse de PostHog, sans solution de contournement de configuration. |
| `SECRET_KEY` rotation | ne jamais faire pivoter après le premier démarrage | Critique | La rotation de la clé de signature de Django invalide chaque session active. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur web de PostHog (et l'écran d'inscription initial de l'administrateur) est autrement accessible publiquement. |
| `site_url` | définir une fois qu'un domaine personnalisé/une IP statique existe | Moyen | Laissé à la valeur par défaut intra-cluster prédite, les liens du tableau de bord / les insights partagés / les charges utiles de webhook pointent vers une URL interne inaccessible une fois l'accès externe configuré. |
| `application_version` | `latest` (véritablement frais, contrairement à plusieurs applications de ce catalogue) | Moyen | L'incrémentation déclenche une reconstruction d'image et un redémarrage progressif ; vérifier la compatibilité du schéma Postgres + ClickHouse pour les sauts de version majeurs. |

---

Pour le comportement de base référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à PostHog est décrite dans
**[PostHog_Common](PostHog_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : PostHog sur GKE Autopilot](../labs/PostHog_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [PostHog Common — Configuration d'application partagée](PostHog_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [ClickHouse sur GKE Autopilot](ClickHouse_GKE.md), [Plausible Analytics sur GKE Autopilot](Plausible_GKE.md), [Metabase sur GKE Autopilot](Metabase_GKE.md) dans la solution **Product Analytics**.
