---
title: "Temporal sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Temporal sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Temporal_GKE.md @ 40c83c3f sha256:2765b99a98a8 -->

# Temporal sur GKE Autopilot {#temporal-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Temporal_GKE.png" alt="Temporal sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Temporal est un moteur d'orchestration de workflows open source utilisé par des
organisations comme Stripe, Netflix, Coinbase et HashiCorp pour construire des
applications distribuées fiables. Ce module déploie Temporal sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Temporal et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## Ce que coûte Temporal sur RAD, et comparaison {#what-temporal-costs-on-rad-and-how-that-compares}

**Le module Temporal sur GKE Autopilot de RAD coûte environ 136,37 $ US par mois
dans un projet Google Cloud que vous possédez, plus des frais de module uniques
de 110 crédits (11 $ US, ou 99 crédits dans un projet géré par RAD, soit 10 % de
moins).** Il n'existe pas de variante Cloud Run — les processus serveur et
worker de Temporal nécessitent des connexions gRPC de longue durée et des
primitives Kubernetes que Cloud Run ne fournit pas — GKE Autopilot est donc la
seule façon dont RAD le déploie. Si vous n'avez besoin de Temporal qu'occasionnellement
— un prototype de workflow, une évaluation avant d'y engager des charges de
travail de production — un projet géré par RAD peut être supprimé et restauré
dans les 30 jours sans frais supplémentaires au lieu de payer pour qu'il reste
inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont
ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **136,37 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **123 crédits par jour**, environ 3 690 par mois (environ 369 $ US au prix de la recharge ; estimé à partir des prix catalogue Google, et incluant les frais de cluster) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

**Pourquoi les deux colonnes diffèrent.** Le chiffre géré par RAD inclut les
frais de gestion du cluster GKE (environ 73 $ US par mois) et la fondation
partagée du projet. Dans votre propre projet, le niveau gratuit de Google couvre
les frais de gestion d'un cluster par compte de facturation, ce que le chiffre
du projet propre suppose. Il est estimé à partir des prix catalogue de Google,
car il n'y a pas encore assez d'historique GKE géré par RAD pour le mesurer,
donc la confirmation de déploiement ne le cite pas. Une deuxième application GKE
dans le même projet géré par RAD partage le cluster et n'ajoute que ses propres
pods.

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que
soit le montant des frais : une fois par compte, pour un module que vous
déployez et payez vous-même (dans une solution, les frais d'une application : la
première à réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan
mensuel. Dans un projet géré par RAD, la base de données et le réseau sont
partagés par chaque application du projet, de sorte qu'une deuxième application
n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion du cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **136,37 $ US** |

### Comment cela se compare {#how-it-compares}

- **Temporal Cloud**, le service hébergé officiel, a une tarification différente
  d'un forfait mensuel : c'est du paiement à l'usage, à partir de **50 $ par
  million d'actions** (avec des remises sur volume jusqu'à 25 $ par million)
  plus le stockage à 0,042 $/Go-heure actif et 0,00105 $/Go-heure conservé, et
  aucun frais mensuel de base. Les nouveaux comptes reçoivent 150 $ de crédits
  pendant 90 jours (source : [temporal.io/pricing](https://temporal.io/pricing)).
  Ce modèle basé sur l'utilisation peut être moins cher que le coût d'exécution
  fixe de RAD pour un très faible volume de workflows, et plus cher à grande
  échelle — les deux ne sont pas directement comparables sans connaître votre
  propre nombre d'actions.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24
  $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois,
  et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois
  — moins cher, mais vous devrez alors exécuter le serveur Temporal, sa base de
  données, et la charge opérationnelle de maintenir un moteur de workflow
  disponible vous-même.
- La propre licence de Temporal est gratuite dans les deux cas — le vrai choix
  est un coût d'infrastructure fixe sur RAD contre la tarification mesurée par
  action de Temporal Cloud, ou faire le travail d'opérations vous-même sur un
  VPS.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Temporal s'exécute dans un projet géré par RAD pour vous, la suppression de
l'ensemble du projet délie d'abord sa facturation, puis demande à Google de
supprimer purement et simplement le projet — la propre suppression logicielle
récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit pas Cloud SQL ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car
la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.**
> Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou
> les ressources qu'il contient, seront utilisables après sa restauration, de
> sorte que la restauration ne peut pas être invoquée comme moyen de récupérer
> un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des
> sauvegardes appropriées des données et de la configuration de l'application et
> de les avoir stockées en dehors du projet. Si une restauration échoue, ou si
> le projet restauré ne fonctionne pas, la solution de repli consiste à
> redéployer l'application (voir la section suivante) et à restaurer sa
> configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Les mises à jour sont incluses dans le
prix (5 par mois pour chaque déploiement), donc une restauration ne coûte
normalement aucun crédit.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier
sandbox qui convient à la plupart des utilisations d'étude/démo). Google affirme
que la plupart des services sont de nouveau pleinement fonctionnels dans les 36
heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
jours. Si l'historique de votre workflow est important pour vous, copiez une
sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de
supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a
pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois la fenêtre de restauration de 30 jours
passée, l'alternative est de supprimer Temporal purement et simplement et de le
redéployer plus tard. Un redéploiement coûte à nouveau les frais de module (les
builds sont inclus) — 110 crédits (11,00 $ US) dans votre propre projet, ou 99
crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Temporal reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son propre
coût d'exécution quotidien — par rapport au total du projet propre ci-dessus
(environ 4,55 $ US par jour), cela représente environ 3 jours ou plus, ou environ
1 jour ou plus dans un projet géré par RAD (123 crédits par jour). La majeure
partie du coût d'exécution ici est la base de données et le pod GKE ; ils ne
s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression
de Temporal alors que quelque chose d'autre partage le projet n'économise que la
part de calcul propre à cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière
sauvegarde avant de supprimer si vous voulez la conserver.

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
propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration ; [temporal.io/pricing](https://temporal.io/pricing)
pour la tarification basée sur l'utilisation de Temporal Cloud.

## 1. Vue d'ensemble {#1-overview}

Temporal s'exécute comme une application Go utilisant l'image tout-en-un
officielle `temporalio/auto-setup`, qui démarre les quatre services Temporal — Frontend,
History, Matching et Worker — dans un seul pod et gère l'initialisation du
schéma PostgreSQL automatiquement au premier démarrage. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod tout-en-un, 2 vCPU / 4 Gio par défaut |
| Base de données | Cloud SQL pour PostgreSQL | Deux bases de données : persistance primaire + visibilité ; accès via IP privée, pas de sidecar Auth Proxy |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré |
| Ingress | Cloud Load Balancing | ClusterIP (interne) par défaut ; LoadBalancer pour les workers SDK externes |
| Visibilité avancée | Elasticsearch (optionnel) | Recherche de workflow en texte intégral et attributs de recherche personnalisés |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est la seule base de données prise en charge.** L'architecture de
  Temporal nécessite PostgreSQL ; MySQL n'est pas utilisé. L'image `auto-setup`
  se connecte directement via l'IP privée de Cloud SQL — aucun sidecar Auth
  Proxy n'est déployé.
- **Les quatre services Temporal s'exécutent dans un seul pod.** Frontend (gRPC
  sur le port 7233), History, Matching et Worker partagent la même allocation de
  CPU et de mémoire.
- **L'initialisation du schéma est automatique.** `temporalio/auto-setup` crée les deux
  bases de données et exécute les migrations de schéma au premier démarrage.
  Aucun job d'initialisation séparé n'est requis. Une sonde de démarrage TCP
  généreuse (délai initial de 30 s, seuil d'échec de 10 avec une période de 30 s
  — une fenêtre de 5 minutes) prend en compte le provisionnement des nœuds
  Autopilot et le temps de configuration du schéma.
- **`num_history_shards` est immuable en permanence.** Cette valeur est écrite dans le
  schéma de la base de données lors du premier déploiement et ne peut être
  modifiée sans effacer et réinitialiser toutes les données de workflow. La
  valeur par défaut est `4` (dev/démo) ; utilisez `512` ou
  plus pour la production.
- **`service_type` est par défaut `ClusterIP`.** Les workers SDK se
  connectent via le réseau du cluster. Ne passez à `LoadBalancer` que si les
  workers SDK s'exécutent en dehors du cluster.
- **Elasticsearch est optionnel.** Sans lui, la recherche de workflow standard
  est alimentée par la base de données de visibilité PostgreSQL. L'activation
  d'Elasticsearch ajoute la recherche en texte intégral et les attributs de
  recherche personnalisés, mais nécessite un cluster Elasticsearch 7.x ou 8.x
  accessible.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis.
L'espace de noms et les autres identifiants sont rapportés dans les
[Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Temporal {#a-gke-autopilot--the-temporal-workload}

Les pods Temporal sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Le déploiement exécute l'image `temporalio/auto-setup`,
qui lance les quatre services Temporal dans un seul conteneur.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Temporal pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche le Service.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail.

### B. Cloud SQL pour PostgreSQL {#b-cloud-sql-for-postgresql}

Temporal stocke tout l'état d'exécution du workflow dans une instance Cloud SQL
pour PostgreSQL gérée. Deux bases de données sont créées :

- **Base de données de persistance primaire** — état du workflow, files d'attente
  de tâches, métadonnées d'espace de noms, minuteurs et enregistrements
  d'activité.
- **Base de données de visibilité** — enregistrements d'exécution de workflow en
  cours utilisés pour la recherche et le filtrage dans l'interface utilisateur
  Web de Temporal et via `tctl`.

Le serveur Temporal se connecte à Cloud SQL directement via l'**IP privée** (pas
de sidecar Auth Proxy). TLS est requis par Cloud SQL et est activé
automatiquement dans la configuration de Temporal.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive session to inspect schemas and data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, les noms des bases de données, l'utilisateur et le secret
Secret Manager pour le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Secret Manager {#c-secret-manager}

Le mot de passe de la base de données Temporal est généré automatiquement et
stocké en tant que secret Secret Manager injecté dans le pod au moment de
l'exécution ; il n'est jamais exposé en texte clair.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret est dans les [Sorties](#5-outputs) sous `temporal_db_password_secret_id`.
Voir [App_GKE](App_GKE.md) pour l'intégration de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, le service gRPC Frontend de Temporal est un `ClusterIP` et n'est
accessible que depuis l'intérieur du cluster sur le port **7233**. Les workers
SDK déployés sur le même cluster GKE se connectent directement en utilisant la
sortie `temporal_frontend_address`.

Pour exposer Temporal en externe, définissez `service_type = "LoadBalancer"` et
éventuellement `reserve_static_ip = true` pour une adresse stable. Un domaine
personnalisé avec un certificat géré par Google peut également être activé.

- **Console :** Kubernetes Engine → Services et Ingress ; Services réseau →
  Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines
personnalisés, le CDN et l'IP statique.

### E. Elasticsearch (optionnel — visibilité avancée) {#e-elasticsearch-optional--advanced-visibility}

Lorsque `enable_elasticsearch = true`, Temporal remplace la base de données de visibilité
PostgreSQL par Elasticsearch comme magasin de visibilité avancée, permettant la
recherche de workflow en texte intégral et les attributs de recherche
personnalisés. L'image `temporalio/auto-setup` crée automatiquement l'index de
visibilité (`temporal_visibility_v1` par défaut) au premier démarrage.

- **Console :** Si vous utilisez Elasticsearch_GKE, Kubernetes Engine → Charges
  de travail.
- **CLI :**
  ```bash
  # Check Elasticsearch cluster health (from within the cluster):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s http://<es-host>:9200/_cluster/health | python3 -m json.tool
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des stratégies d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Temporal {#3-temporal-application-behaviour}

- **Configuration de la base de données au premier déploiement.** `Temporal_GKE`
  code en dur `initialization_jobs = []` — aucun job Kubernetes ne s'exécute avant le
  démarrage du pod serveur. Le rôle PostgreSQL de Temporal et les deux bases de
  données sont créés directement par les ressources Terraform
  `Temporal_Common` de `google_sql_user`/`google_sql_database` via l'API Cloud SQL Admin.
  L'image `temporalio/auto-setup` exécute ensuite toutes les migrations de schéma lors
  de son premier démarrage (voir [Temporal_Common](Temporal_Common.md) §6 pour
  la description complète, y compris les scripts de bootstrapping
  `temporal-db-init.sh` et `schema-init.sh` qui sont livrés avec les modules mais ne
  sont actuellement connectés à aucun job).
- **Initialisation du schéma à chaque démarrage.** `auto-setup` détecte la
  version actuelle du schéma au démarrage. Si le schéma est déjà à jour, le
  démarrage se poursuit immédiatement. Si des migrations en attente existent,
  elles sont appliquées avant que les services Temporal ne commencent à accepter
  les connexions.
- **Mise à niveau de Temporal.** Mettez à jour `application_version` vers la balise
  cible. L'image `auto-setup` applique automatiquement les migrations de
  schéma en attente au prochain démarrage. Pour les grands déploiements,
  consultez les [notes de publication de Temporal](https://github.com/temporalio/temporal/releases)
  pour les changements de schéma cassants avant la mise à jour.
- **Interface utilisateur Web de Temporal.** Déployée automatiquement par
  défaut. `deploy_temporal_ui` est par défaut `true`, et
  `temporal.tf` construit automatiquement un service `temporalio/ui` pointant
  vers le service Frontend sur le port 7233, exposé via un LoadBalancer externe,
  et fusionné avant toute `additional_services` fournie par l'appelant. Définissez
  `deploy_temporal_ui = false` pour le désactiver ; utilisez `additional_services` pour tout
  autre service compagnon.
- **Espaces de noms Temporal.** Temporal utilise son propre concept d'espace de
  noms interne (distinct des espaces de noms Kubernetes). L'espace de noms
  Temporal `default` est créé automatiquement par `auto-setup`. Des
  espaces de noms supplémentaires peuvent être créés avec :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    temporal operator namespace create my-namespace
  ```
- **Connexion des workers SDK.** Les workers SDK se connectent à l'adresse gRPC
  Frontend de Temporal. Utilisez la sortie `temporal_frontend_address` directement pour les
  workers à l'intérieur du cluster. Pour les workers en dehors du cluster,
  définissez `service_type = "LoadBalancer"` et utilisez `service_external_ip:7233`.
- **Sondes de santé.** Les sondes TCP sont utilisées pour les vérifications de
  démarrage et de vivacité car Temporal Frontend expose gRPC (pas HTTP/1.1) sur
  le port 7233. La sonde de démarrage permet jusqu'à 5 minutes (10 tentatives ×
  période de 30 secondes) pour que l'initialisation du schéma se termine.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Temporal sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `temporal` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Temporal` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `1.25.0` | Balise d'image du serveur Temporal. Épinglez à une version spécifique ; les migrations de schéma doivent être terminées avant la mise à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner les bases de données et les secrets sans déployer de pods. |
| `cpu_limit` | `2000m` | CPU par pod ; les quatre services Temporal partagent cette allocation. |
| `memory_limit` | `4Gi` | Mémoire par pod ; les quatre services partagent cette allocation. |
| `min_instance_count` | `1` | Réplicas minimum. Doit être ≥ 1 — Temporal nécessite au moins un pod en cours d'exécution pour traiter les minuteurs et les tentatives. |
| `max_instance_count` | `1` | Réplicas maximum. |
| `container_port` | `7233` | Port gRPC Frontend de Temporal (informatif — le port de service est codé en dur à 7233). |
| `container_protocol` | `h2c` | Texte clair HTTP/2 — requis pour gRPC. Ne pas modifier. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Temporal de Docker Hub dans Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés avec la configuration du serveur Temporal. Remplacez les valeurs par défaut intégrées avec prudence. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Utilisez `ClusterIP` pour les workers SDK internes au cluster (recommandé). Utilisez `LoadBalancer` uniquement si les workers SDK s'exécutent en dehors du cluster. |
| `workload_type` | `null` (Déploiement) | Temporal est sans état — `Deployment` est approprié. |
| `session_affinity` | `None` | Pas de routage persistant requis pour gRPC. |
| `gke_cluster_name` | `""` | Nom du cluster cible. Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Laissez vide pour générer automatiquement. |
| `enable_network_segmentation` | `false` | Créer des ressources NetworkPolicy pour restreindre le trafic. |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend le déploiement. La valeur par défaut couvre le provisionnement des nœuds Autopilot plus l'initialisation du schéma lors du premier déploiement. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Non requis pour Temporal. Tout l'état durable réside dans Cloud SQL PostgreSQL.
La définition de `stateful_pvc_enabled = true` n'est pas recommandée — voir
[App_GKE](App_GKE.md) pour les options de PVC.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent toute planification. |
| `quota_max_pods` | `20` | Nombre maximal de pods dans l'espace de noms. |
| `quota_max_services` | `10` | Nombre maximal de services dans l'espace de noms. |
| `quota_max_pvcs` | `5` | Nombre maximal de PVC dans l'espace de noms. |

### Groupe 9 — Stratégies de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds (recommandé pour la production). |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP sur le port 7233 | Fenêtre de 10 tentatives (5 minutes à une période de 30 s) pour l'initialisation du schéma au premier démarrage. |
| `health_check_config` | TCP sur le port 7233 | Sonde de vivacité ; délai initial de 60 s. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Stratégies d'alerte métrique optionnelles. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jobs supplémentaires à exécuter avant le pod serveur. Codé en dur à `[]` par `Temporal_GKE` — aucun job intégré ne s'exécute ; le rôle DB et les bases de données sont créés directement par les ressources Terraform de `Temporal_Common`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `deploy_temporal_ui` | `true` | Déployer automatiquement l'interface utilisateur Web de Temporal (`temporalio/ui`), connectée au service Frontend et exposée via un LoadBalancer externe. |
| `temporal_ui_version` | `2.34.0` | Balise d'image pour l'interface utilisateur Web de Temporal. |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires. Fusionnés avec l'interface utilisateur Web de Temporal auto-déployée (contrôlée par `deploy_temporal_ui`). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

NFS n'est pas requis pour Temporal. Voir [App_GKE](App_GKE.md) pour les
options NFS si nécessaire pour les charges de travail compagnons.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

Temporal ne nécessite aucun bucket Cloud Storage. Artifact Registry est utilisé
pour l'image Temporal mise en miroir. Voir [App_GKE](App_GKE.md).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Désactivé par défaut — Temporal n'utilise pas GCS. |
| `max_images_to_retain` | `7` | Nombre de rétentions d'images Artifact Registry. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Base de données et paramètres spécifiques à Temporal {#group-15--database--temporal-specific-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom de l'instance Cloud SQL PostgreSQL existante. Laissez vide pour la découverte automatique à partir de Services_GCP. |
| `temporal_database_name` | `""` | Nom de la base de données de persistance primaire. Laissez vide pour générer automatiquement à partir du préfixe de ressource de déploiement (recommandé). |
| `temporal_visibility_database_name` | `""` | Nom de la base de données de visibilité. Laissez vide pour générer automatiquement comme `<prefix>_visibility`. |
| `temporal_db_user` | `""` | Nom d'utilisateur PostgreSQL. Laissez vide pour générer automatiquement à partir du préfixe de ressource de déploiement. |
| `num_history_shards` | `4` | **Immuable après le premier déploiement.** Nombre de shards d'historique (puissance de deux). Utilisez `4` pour le développement/démo, `512` ou plus pour la production. |
| `enable_elasticsearch` | `false` | Activer Elasticsearch pour la visibilité avancée (recherche en texte intégral, attributs de recherche personnalisés). |
| `elasticsearch_url` | `""` | Point de terminaison Elasticsearch. Requis lorsque `enable_elasticsearch = true`. Format : `host:9200` ou `http://host:9200`. |
| `elasticsearch_version` | `v7` | Doit correspondre à la version réelle du cluster : `v7` pour Elasticsearch 7.x, `v8` pour 8.x. |
| `elasticsearch_index_visibility` | `temporal_visibility_v1` | Nom de l'index Elasticsearch. Créé automatiquement par `auto-setup` au premier démarrage. |

### Groupe 16 — Rotation des secrets {#group-16--secret-rotation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Faire pivoter le mot de passe de la base de données selon un calendrier. Le pod doit être redémarré après la rotation pour prendre en compte le nouveau secret. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Non applicable pour Temporal. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements (utile uniquement avec `LoadBalancer`). |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | IAP n'est pas recommandé pour Temporal gRPC — utilisez `enable_network_segmentation` à la place. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une stratégie Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | _(défini)_ | Nom de la stratégie. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes pour le serveur Temporal. |
| `namespace` | Espace de noms Kubernetes où Temporal est déployé. |
| `service_url` | URL du service interne au cluster (ClusterIP par défaut). |
| `service_external_ip` | IP externe du LoadBalancer (non nulle seulement quand `service_type = "LoadBalancer"`). |
| `temporal_frontend_address` | Adresse gRPC pour les workers SDK — `<service-url>:7233`. |
| `temporal_db_user` | Nom d'utilisateur PostgreSQL pour les connexions au serveur Temporal. |
| `temporal_db_name` | Nom de la base de données de persistance primaire. |
| `temporal_visibility_db_name` | Nom de la base de données de visibilité. |
| `temporal_db_password_secret_id` | ID du secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vides — Temporal n'utilise pas GCS). |
| `container_image` | Image de conteneur utilisée pour le déploiement du serveur Temporal. |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si les charges de travail sont déployées. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_registry` | Nom du dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `num_history_shards` | `4` (dev/démo), `512`+ (prod) | Critique | Immuable de façon permanente après le premier déploiement. Le modifier nécessite d'effacer toutes les données de workflow et de réinitialiser à partir de zéro. |
| `container_protocol` | `h2c` | Critique | Temporal utilise gRPC ; le changer en `http1` rompt toutes les connexions des workers SDK et l'interface utilisateur Web. |
| `temporal_database_name` / `temporal_visibility_database_name` | défini une fois | Critique | Immuable après le premier déploiement. Le modifier après le déploiement orpheline le schéma, ce qui fait que Temporal démarre avec une base de données non initialisée. |
| `enable_elasticsearch` avec `elasticsearch_url` | définis ensemble | Critique | Un point de terminaison Elasticsearch inaccessible lorsque `enable_elasticsearch = true` provoque le crash de Temporal au démarrage — il ne revient pas à la visibilité PostgreSQL. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro (`0`) entraîne des temporisateurs manqués, des tentatives d'activité bloquées et une progression de workflow abandonnée. |
| `cpu_limit` | `2000m` | Élevé | Les quatre services Temporal partagent cette allocation. En dessous de 1000m, la latence de planification augmente fortement et les déclenchements de temporisateurs sont retardés, ce qui a un impact direct sur les SLA de workflow. |
| `memory_limit` | `4Gi` | Élevé | Temporal conserve l'état des shards en mémoire ; une mémoire insuffisante provoque des OOM kills pendant le traitement du workflow. |
| `temporal_db_user` | auto-généré | Élevé | Le modifier après le déploiement sans mettre à jour les autorisations Cloud SQL et Secret Manager entraîne l'échec de toutes les connexions au serveur. |
| `elasticsearch_version` | correspondre au cluster réel | Élevé | Une non-concordance entraîne des mappages d'index incompatibles, des entrées de workflow manquantes et des échecs d'écriture de visibilité. |
| `elasticsearch_url` | `host:port` ou `http://host:port` | Élevé | Requis lorsque `enable_elasticsearch = true` ; une valeur vide provoque un crash immédiat au démarrage. |
| `service_type` | `ClusterIP` (interne) | Moyen | Exposer Temporal Frontend comme `LoadBalancer` sans politique réseau permet à tout hôte externe de soumettre des workflows. |
| `enable_pod_disruption_budget` | `true` | Moyen | Sans PDB, les mises à niveau de nœuds GKE peuvent expulser tous les pods Temporal simultanément, interrompant toutes les exécutions de workflow en cours. |
| `backup_schedule` | `0 2 * * *` | Moyen | Un calendrier vide ou désactivé ne laisse aucune voie de récupération en cas de défaillance de Cloud SQL. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être expulsé). |
| `stateful_pvc_enabled` | `false` | Moyen | Temporal stocke tout l'état dans Cloud SQL ; les PVC n'apportent aucun avantage et peuvent provoquer des échecs de planification Autopilot. |

---

Pour le comportement de base référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. Le
provisionnement de bases de données et de secrets spécifiques à Temporal partagé
entre les déploiements est décrit dans **[Temporal_Common](Temporal_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Temporal sur GKE Autopilot](../labs/Temporal_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Temporal Common — Configuration d'application partagée](Temporal_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Kestra sur Google Cloud Run](Kestra_CloudRun.md), [Windmill sur Google Cloud Run](Windmill_CloudRun.md), [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md) dans la solution **Orchestration de données et de workflows**.
