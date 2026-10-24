---
title: "Payload CMS sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Payload CMS sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Payload_GKE.md @ e69407af sha256:9658fbcbe6a3 -->

# Payload CMS sur GKE Autopilot {#payload-cms-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Payload_GKE.png" alt="Payload CMS sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Payload CMS est un CMS headless et un framework d'application code-first, natif TypeScript,
construit directement sur Next.js — ce n'est pas un produit SaaS hébergé, mais une bibliothèque
installée dans votre propre application Next.js. Le contenu est modélisé via des "Collections"
typées définies dans `payload.config.ts`, et Payload génère une interface
d'administration ainsi que des API REST, GraphQL et locales à partir de cette même configuration.
Ce module déploie une véritable application Payload sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud
et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par ce déploiement et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## Ce que coûte Payload sur RAD, et comment cela se compare {#what-payload-costs-on-rad-and-how-that-compares}

**Pour une petite équipe, le module GKE Autopilot de Payload sur RAD coûte environ 107 $ US par mois, sans licence par utilisateur.** GKE convient à une application Payload qui doit rester disponible, s'adapter à travers les pods ou fonctionner aux côtés d'autres charges de travail Kubernetes. Pour un coût minimal, le [module Cloud Run](Payload_CloudRun.md) exécute le même Payload pour environ 84 $ US par mois. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que les 107 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (un build moyen de RAD prend environ 19 minutes) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **92 crédits par jour**, soit environ 2 760 crédits par mois (environ 276 $ US au prix de la recharge, 221 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 Gio | 36,08 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 107 $ US**, ou environ 180 $ US sans le niveau gratuit |

- Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, il ne s'applique donc que si c'est votre seul cluster de ce type. Cloud SQL coûte le même prix en africa-south1 (Johannesburg) ; le pod et la VM coûtent environ 10 % de plus là-bas.
- **GKE Autopilot ne s'adapte pas à zéro.** Au moins un pod Payload est toujours en cours d'exécution, donc le coût ci-dessus est le même que quelqu'un l'utilise ou non ; des pods supplémentaires ne sont ajoutés que sous charge.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut une petite VM NFS/cache. La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 $ US par mois à elle seule.

### Comment cela se compare {#how-it-compares}

- Payload Cloud, l'offre hébergée du projet, ne publie pas de liste de prix publique actuelle, cette comparaison se fait donc par rapport à un serveur nu.
- Un VPS nu — Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, tous deux à environ 24 $/mois — est moins cher que le chiffre ci-dessus pour le projet propre à RAD. Payload n'a besoin que de 1 vCPU / 1-2 Gio, donc un niveau de VPS plus petit/moins cher ferait probablement l'affaire ; les chiffres ci-dessus sont la plus petite classe vérifiée indépendamment.
- La différence réside dans la base de données et la gestion des secrets : les sauvegardes Cloud SQL et la récupération à un point dans le temps, ainsi que Secret Manager, sont inclus sur RAD plutôt que d'être votre propre travail sur un VPS.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Payload s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option
qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'intégralité du projet et
restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation
occasionnelle — préparation à une certification, environnement de démonstration, activité
saisonnière — que l'exécution continue de Payload.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation,
  puis demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà
  déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression
  d'un seul module, cela ne détruit pas Cloud SQL, aucune VM ni le cluster GKE un par un —
  l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours,
  le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et
  de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur
  chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une
  vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de
  module à nouveau. Cela coûte une poignée de crédits (moins de 1 $ US) pour une chaîne de
  déploiement typique de 2 à 3 éléments, contre les 180 crédits (18 $ US) qu'un redéploiement
  complet coûte ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 107 $ US.**
  Déployez Payload, utilisez-le un certain temps, supprimez le projet. Restaurez-le la
  prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à
  nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les
  builds, et le temps pendant lequel Payload a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous
  apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les
  30 jours — après cela, Google le supprime définitivement. La restauration est admise comme
  la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le
  seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude
  et de démonstration conviennent). Google indique que la plupart des services
  fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes de Payload
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par
  la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès
  que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours.
  Si vous avez apporté des modifications à Payload que vous souhaitez conserver, copiez une
  sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme
  pour le flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans
  rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot ne se met pas à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180
  crédits (18 $ US), car RAD recrée le projet et les services partagés avant Payload. La
  suppression ne permet d'économiser de l'argent que si Payload devait rester inutilisé pendant
  environ 6 jours ou plus, à la fois dans votre propre projet (environ 3,55 $ US par jour) et
  dans un projet géré par RAD (92 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et la VM de
  fichier/cache partagée.** Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les
  utilise, donc la suppression de Payload alors que quelque chose d'autre partage le projet ne
  sauve que la partie calcul de Payload.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un bucket à l'intérieur
  du déploiement et sont supprimées avec celui-ci, donc copiez la dernière sauvegarde avant de
  supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à nouveau les
  paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque
  participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance
  toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la
  session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application
  pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec
  le client. Si le portefeuille est faible, la facturation est suspendue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire
  transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et
ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle.

---

## 1. Vue d'ensemble {#1-overview}

Payload s'exécute en tant que pod Node.js (Next.js) sur GKE Autopilot. Il n'y a **pas d'image
Docker officielle de Payload** — ce module construit une véritable application de démarrage
localement vérifiée à partir de la source (un modèle vierge `create-payload-app` utilisant l'adaptateur
PostgreSQL) via Cloud Build. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js (Next.js autonome), mise à l'échelle horizontale automatique |
| Build | Cloud Build | Construit l'application de démarrage Payload groupée à partir de `Payload_Common/scripts/Dockerfile` — il n'existe pas d'image pré-construite à extraire |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — l'adaptateur Postgres de Payload est utilisé ; MySQL/MongoDB ne sont pas câblés |
| Stockage d'objets | Aucun | Aucun bucket n'est provisionné ; les téléchargements de médias vont sur le disque local et éphémère du conteneur |
| Secrets | Secret Manager | `PAYLOAD_SECRET` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe par défaut, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire et le schéma n'est pas créé au démarrage.** Le démarrage du
  serveur construit sur une base de données vierge crée zéro table — le job d'initialisation
  `payload-migrate` applique le schéma via la CLI `payload migrate`, en utilisant un fichier de
  migration pré-généré intégré à l'image.
- **`container_image_source` est fixé à `"custom"`.** Il n'y a rien à déployer sans une exécution
  de Cloud Build — le module construit toujours `Payload_Common/scripts/` à partir de la source.
- **Les sondes de santé ciblent `/admin`, pas `/` ou une route API.** `/admin`
  sert le formulaire de connexion/création du premier utilisateur de Payload et renvoie un
  `200` non authentifié ; les routes REST/GraphQL de Payload nécessitent une
  authentification et ne sont pas des cibles de sonde appropriées.
- **Aucun bucket de stockage n'est provisionné.** Par défaut, les médias téléchargés sont écrits
  sur le disque local du conteneur et ne survivent pas à un redémarrage de pod ou à un
  redéploiement. Définissez `stateful_pvc_enabled = true` pour les conserver sur un PVC de bloc par pod
  monté à `/app/media` (où Payload écrit les téléchargements, avec `stateful_fs_group = 1001`).
- **`enable_redis` et les variables associées du groupe 21 sont déclarées mais inertes.** Elles ne
  sont pas transmises à `Payload_Common`, qui n'a pas de câblage Redis.
- **`service_type` est par défaut `LoadBalancer`.** La vérification en direct de ce
  déploiement a utilisé `ClusterIP` uniquement parce que le quota d'IP statiques
  `IN_USE_ADDRESSES` du projet cible était épuisé au moment du déploiement — un choix
  opérationnel fait pour ce déploiement spécifique, pas une valeur par défaut du module.
  Revenez à `LoadBalancer` (ou réservez une IP statique) une fois le quota disponible.
- **Le premier utilisateur administrateur est créé manuellement.** Payload n'a pas de CLI
  non-interactive pour cela — la visite de `/admin` sur une collection
  `users` vide affiche un formulaire d'inscription.
- **Minimum 1 réplica est maintenu par défaut** (`min_instance_count = 1`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Payload {#a-gke-autopilot--the-payload-workload}

Les pods Payload sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Payload
  pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress
  affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de
charge de travail (Déploiement vs StatefulSet).

### B. Cloud Build — construction de l'image Payload {#b-cloud-build--building-the-payload-image}

Comme il n'existe pas d'image Payload officielle, chaque déploiement (et chaque redéploiement
après une modification de Dockerfile ou de source) déclenche une exécution de Cloud Build
contre `Payload_Common/scripts/`.

- **Console :** Cloud Build → Historique.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit=10
  gcloud builds log <build-id> --project "$PROJECT"
  ```

### C. Cloud SQL pour PostgreSQL 15 {#c-cloud-sql-for-postgresql-15}

Payload stocke toutes les données de l'application (Collections, utilisateurs, métadonnées de
documents téléchargés) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods y accèdent
privatement via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est
exposée. Lors du premier déploiement, `db-init` crée la base de données et le rôle,
puis `payload-migrate` applique le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs
  et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatisées et la rotation des
mots de passe.

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager : `PAYLOAD_SECRET`
(utilisé pour signer les propres jetons de session/authentification de Payload). Le mot de passe
de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Si le déploiement a été défini sur `service_type = "ClusterIP"` (par exemple parce que le quota d'IP statiques
était épuisé au moment du déploiement), accédez à l'application depuis l'intérieur du cluster à la
place :

```bash
kubectl port-forward -n "$NAMESPACE" svc/<service-name> 18080:3000
curl -s http://localhost:18080/admin -o /dev/null -w '%{http_code}\n'
```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des adresses
IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE et
Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des
politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Payload {#3-payload-application-behaviour}

- **Configuration de la base de données au premier déploiement.** `db-init` (utilisant
  `postgres:15-alpine`) se connecte via le proxy d'authentification Cloud SQL et crée de
  manière idempotente le rôle et la base de données de l'application.
- **La migration de schéma est un job distinct et dépendant.** `payload-migrate` (`depends_on_jobs =
  ["db-init"]`)
  exécute `./node_modules/.bin/payload migrate` à partir d'une copie complète `/app/cli` de `node_modules` +
  source TypeScript intégrée à l'image — l'environnement d'exécution autonome Next.js allégé
  utilisé pour servir le trafic n'inclut pas la CLI Payload ni ses dépendances. Sur GKE, le
  proxy d'authentification Cloud SQL s'exécute en tant que sidecar natif ; le script de migration
  lui signale de s'arrêter via `http://localhost:9091/quitquitquit` une fois les migrations terminées.
- **`PAYLOAD_SECRET` doit être traité comme immuable après le premier démarrage.** Il signe les
  jetons de session/authentification de Payload ; sa rotation invalide toutes les sessions
  actives.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/admin` — la route
  d'interface d'administration de Payload, qui renvoie un `200` non authentifié une
  fois que le serveur Node.js et la connexion à la base de données sont prêts. Prévoyez plusieurs
  minutes au premier démarrage pour que le job `payload-migrate` se termine avant que le service
  ne soit censé servir du contenu réel.
- **Premier compte administrateur.** Payload n'a pas de commande CLI pour créer le premier
  utilisateur administrateur de manière non interactive. Visitez `$SERVICE_URL/admin` (ou
  `kubectl port-forward` si `ClusterIP`) — avec une collection `users` vide, Payload
  affiche un formulaire d'inscription pour créer le premier administrateur. Il s'agit d'une étape
  manuelle et unique de l'opérateur.
- **Les téléchargements de médias ne persistent pas par défaut.** Aucun bucket de stockage n'est
  provisionné ; les fichiers téléchargés sont écrits sur le disque local du conteneur et sont
  perdus à chaque redémarrage de pod ou redéploiement, sauf si `stateful_pvc_enabled = true` place
  `/app/media` sur un PVC de bloc.
- **`service_type` peut nécessiter un basculement manuel.** S'il est exposé en tant que
  `ClusterIP` en raison de contraintes de quota IP, l'application n'est accessible que
  via `kubectl port-forward`/`kubectl exec` jusqu'à ce qu'elle soit rebasculée vers
  `LoadBalancer` (ou qu'une IP statique soit réservée) et réappliquée.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Payload sont listés ; toutes les
autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement et leurs valeurs
par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `payload` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Payload CMS` | Nom lisible par l'homme affiché dans la console. Texte résiduel de la source de clonage du module — à remplacer par `Payload CMS` au moment du déploiement ; c'est purement cosmétique. |
| `application_version` | `latest` | Tag de suivi de déploiement intégré à l'image via l'argument de build `application_version` de Cloud Build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Fixe — il n'y a pas d'image Payload pré-construite à déployer. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Réplicas minimum maintenus chauds ; GKE ne se met pas à l'échelle à zéro. |
| `container_port` | `3000` | Valeur par défaut de Next.js. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | Payload (Next.js) a besoin de marge pour le serveur autonome plus l'empreinte TypeScript/CLI du job de migration ; envisagez d'augmenter la mémoire pour la production. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `PAYLOAD_SECRET` ou `DATABASE_URL` ici — les deux sont calculés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. Définissez sur `ClusterIP` si le quota d'IP statiques du projet est épuisé ; accédez via `kubectl port-forward` à la place. |
| `workload_type` | `null` (résout en `Deployment`) | Payload n'a pas besoin de PVC par pod par défaut. |
| `session_affinity` | `None` | Aucune exigence de session persistante pour cette application de démarrage minimale. |

### Groupe 11 — Cloud Storage et Artifact Registry {#group-11--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Déclaré dans `variables.tf` avec une description impliquant un adaptateur de stockage GCS compatible S3, mais **non transmis** à `Payload_Common` — n'a aucun effet. La sortie `storage_buckets` de `Payload_Common` est toujours `[]`. |
| `gcs_volumes` | `[]` | Véritablement transmis — montages de volume GCS Fuse, si vous souhaitez câbler vous-même le stockage persistant. |

### Groupe 13 — Système de fichiers (NFS) et jobs {#group-13--filesystem-nfs--jobs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne intégrée `db-init` → `payload-migrate`. |
| `enable_nfs` | `false` | Non requis — les propres données de Payload résident dans Postgres, pas dans NFS. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/admin`, délai de 120 s, période de 15 s, 40 tentatives | Fenêtre totale d'environ 12 minutes pour que les migrations au premier démarrage se terminent. |
| `health_check_config` | HTTP `/admin`, délai de 30 s | Sonde de vivacité. |

### Groupe 15 — Backend de base de données {#group-15--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe ; Payload nécessite PostgreSQL. |
| `application_database_name` / `application_database_user` | `payload` / `payload` | Nom de la base de données PostgreSQL et utilisateur de l'application. Immuable après le premier déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements — utile une fois que `service_type = LoadBalancer` est restauré après toute solution de repli temporaire `ClusterIP`. |

### Groupe 21 — Cloud Armor et cache Redis {#group-21--cloud-armor--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | `true` / `""` / `6379` / `""` | **Inerte.** Déclaré dans `variables.tf` (avec une description affirmant que Payload v0.4+ nécessite Redis) mais jamais transmis à `Payload_Common`, qui n'a aucun câblage Redis. La définition de ces valeurs n'a aucun effet. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée ou `service_type = LoadBalancer`). |
| `service_url` | URL pour atteindre Payload. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Toujours vide — aucun bucket n'est provisionné. |
| `container_image` / `container_registry` | Image construite et dépôt Artifact Registry. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `PAYLOAD_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Sa rotation invalide toutes les sessions actives, obligeant tous les utilisateurs à se reconnecter. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `startup_probe_config` / `payload-migrate` | Prévoir la fenêtre complète d'environ 12 minutes | Élevé | Si la fenêtre de la sonde est raccourcie en dessous du temps nécessaire à `payload-migrate`, le pod peut être marqué comme non sain avant la fin de la migration de schéma, car les deux s'exécutent concurremment plutôt que la sonde n'attende le job. |
| Persistance des médias/téléchargements | Ajouter un véritable adaptateur de stockage avant l'utilisation en production | Élevé | Sans bucket de stockage câblé, tous les médias téléchargés résident sur le disque local du conteneur et sont perdus à chaque redémarrage de pod ou redéploiement. |
| `service_type` | `LoadBalancer` (par défaut) | Élevé | S'il est laissé à `ClusterIP` (par exemple après un repli dû à un quota), l'application n'a aucune accessibilité externe tant qu'elle n'est pas rebasculée. |
| `enable_gcs_storage` | Ne pas se fier à ce commutateur | Moyen | Déclaré mais non transmis à `Payload_Common` — son activation ne provisionne ni ne câble aucun stockage. |
| `enable_redis` / `redis_*` | Ne pas se fier à ces commutateurs | Moyen | Déclaré mais non transmis à `Payload_Common`, qui n'a aucun câblage Redis — leur définition n'a aucun effet. |
| Création du premier administrateur | Terminer rapidement après le déploiement | Moyen | Tant que le premier administrateur n'est pas créé via le formulaire d'inscription `/admin`, l'instance n'a aucun utilisateur authentifié. |
| `container_image_source` | Laisser à `custom` | Faible | Il n'y a pas d'image Payload pré-construite ; la définition de `prebuilt` sans un `container_image` valide interrompt le déploiement. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à Payload partagée avec la variante Cloud Run est décrite dans
**[Payload_Common](Payload_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Payload CMS sur GKE Autopilot](../labs/Payload_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Payload CMS sur Google Cloud Run](Payload_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Payload Common — Configuration d'application partagée](Payload_Common.md) — la configuration partagée par les deux cibles de déploiement.
