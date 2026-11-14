---
title: "SearXNG sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de SearXNG sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/SearXNG_GKE.md @ 40c83c3f sha256:0a684e22468b -->

# SearXNG sur GKE Autopilot {#searxng-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SearXNG_GKE.png" alt="SearXNG sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

SearXNG est un métamoteur de recherche auto-hébergé respectueux de la vie privée qui
agrège les résultats de plus de 70 services de recherche sans suivre les utilisateurs
ni diffuser de publicités. Ce module déploie SearXNG sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que SearXNG utilise et sur la façon de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à chaque application GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte SearXNG sur RAD, et comment cela se compare {#what-searxng-costs-on-rad-and-how-that-compares}

**L'exécution de SearXNG dans votre propre projet GCP coûte environ 24,04 $/mois en frais Google Cloud ; les frais de module de RAD sont de 40 crédits uniques (ou 36 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option à moindre coût ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 40 crédits, une fois | 36 crédits, une fois (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés pour le temps de build à la minute | Idem |
| Coût d'exécution Google Cloud | ~24,04 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~62 crédits/jour, mesurés à l'heure par RAD au prix catalogue plus marge |

**Pourquoi les deux colonnes diffèrent.** Le chiffre pour les projets gérés par RAD inclut les frais de gestion du cluster GKE (environ 73 $ US par mois) et la fondation partagée du projet. Dans votre propre projet, le niveau gratuit de Google couvre les frais de gestion d'un cluster par compte de facturation, ce que le chiffre du projet propre suppose. Il est estimé à partir des prix catalogue de Google, car il n'y a pas encore suffisamment d'historique GKE géré par RAD pour le mesurer, de sorte que la confirmation de déploiement ne le cite pas. Une deuxième application GKE dans le même projet géré par RAD partage le cluster et n'ajoute que ses propres pods.

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 0,5x vCPU / 0,5 GiB | 18,04 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion du cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **24,04 $** |

### Comment cela se compare {#how-it-compares}

- L'empreinte propre de SearXNG ici (0,5x vCPU / 0,5 GiB) est plus petite que cette classe de référence, donc un niveau VPS encore moins cher ferait tout aussi bien, mais dimensionné à la plus petite classe couramment citée pour comparaison : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL, Secret Manager et la surveillance gérés par RAD couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- SearXNG est un proxy de recherche léger interrogé à la demande — son propre coût d'exécution est le plus faible de ce lot, et sans base de données à maintenir en vie, sa suppression récupère presque la totalité du chiffre ci-dessus.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et
simplement — la suppression logique récupérable de 30 jours de Google. Contrairement à la
suppression d'un module, cela ne détruit pas Cloud SQL, aucune VM ou la ressource de
calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé
pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être invoquée comme moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de restaurer le projet et de rattacher son compte de facturation, puis vous
demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est
revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise
à jour ne facture jamais les frais de module à nouveau. Les mises à jour sont incluses
dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte
normalement aucun crédit.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après
cela, Google le supprime définitivement — et la restauration est admise comme la
création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours
dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la
plupart des utilisations d'étude/démo). Google affirme que la plupart des services
fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

**Une véritable lacune :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
vous avez personnalisé l'application et que vous souhaitez conserver ce travail, copiez
une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer.
Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer SearXNG purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module (les builds sont inclus) — 40 crédits.

La suppression ne permet d'économiser de l'argent que si SearXNG reste inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet propre ci-dessus, cela représente environ 6 jours ou plus. Il n'y a pas de base de données à maintenir en fonctionnement après sa suppression — la majeure partie du coût d'exécution est le pod GKE lui-même, plus une part des frais de gestion du cluster si d'autres applications GKE s'exécutent dans le même projet, donc la suppression de cette application récupère presque la totalité du chiffre ci-dessus.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe.
  Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  suspendue et les données sont conservées, de sorte que personne ne reçoit de frais
  inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent
  ceux du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
  KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

SearXNG fonctionne comme une charge de travail web Python/Flask légère. Le déploiement
connecte un ensemble minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python/Flask, 500m CPU / 512 Mio par défaut, mise à l'échelle horizontale automatique |
| Cache / limitation de débit | Redis | Optionnel — désactivé par défaut ; sauvegarde les compteurs du limiteur. La limitation de débit nécessite également `enable_limiter = true` |
| Secrets | Secret Manager | `SEARXNG_SECRET` (clé de session) auto-généré injecté via le pilote CSI |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** SearXNG est entièrement sans état — il
  agrège les résultats de recherche au moment de la requête et ne stocke rien.
- **Aucun NFS ou Cloud Storage n'est provisionné.** SearXNG n'a pas de téléchargements
  ou de fichiers partagés.
- **`min_instance_count` est fixé à 1.** GKE ne prend pas en charge la mise à l'échelle à zéro ; le
  module maintient toujours au moins un pod en cours d'exécution.
- **Le limiteur est désactivé par défaut, et Redis seul ne l'active pas.** L'image RAD
  épingle `server.limiter: false` afin que l'API JSON reste utilisable par les appelants
  internes de serveur à serveur. Pour un déploiement invocable publiquement, définissez
  À LA FOIS `enable_redis = true` et `enable_limiter = true`, et exemptez les appelants de confiance via
  `limiter_pass_ips`, pour obtenir une limitation de débit et une détection de bots contre
  l'abus de moteur en amont.
- **`SEARXNG_SECRET` est généré automatiquement** et stocké dans Secret Manager. Toutes les
  répliques de pod partagent la même valeur via le pilote CSI — ne la remplacez pas par
  une valeur aléatoire par pod.
- **Les sondes de santé ciblent `/healthz`.** Le point de terminaison de santé intégré
  de SearXNG renvoie 200 lorsque l'application est prête.
- **`session_affinity = "None"`.** SearXNG est sans état, donc les requêtes sont distribuées
  uniformément entre les pods.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail SearXNG {#a-gke-autopilot--the-searxng-workload}

Les pods SearXNG sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods met à l'échelle le déploiement
entre le minimum (fixé à 1) et le maximum configuré.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  SearXNG pour voir les pods, les révisions et les événements. Kubernetes Engine → Services
  et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type
de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Cache Redis (optionnel) {#b-redis-cache-optional}

`enable_redis = true` provisionne le backend Redis dans lequel le limiteur conserve ses
compteurs par IP ; `enable_limiter = true` est ce qui active réellement la détection de bots (le
plan échoue si vous l'activez sans Redis), et `limiter_pass_ips` exempte les appelants
internes de confiance. Note historique : Redis seul était autrefois décrit comme
suffisant — il ne l'a jamais été, car l'image RAD épinglait `server.limiter: false`.

Lorsque `enable_redis = true`, SearXNG utilise Redis pour la limitation de débit par IP et la
détection de bots. Ceci est fortement recommandé pour les déploiements publics afin
d'éviter l'épuisement des quotas d'API des moteurs de recherche en amont. Lorsque
`redis_host` est laissé vide et que Redis est activé, le module utilise par défaut
`127.0.0.1` (un pod Redis sidecar).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### C. Secret Manager — SEARXNG_SECRET {#c-secret-manager--searxng_secret}

`SearXNG_Common` génère automatiquement la clé de session `SEARXNG_SECRET` et la
stocke dans Secret Manager. Cette clé signe les cookies de session et les paramètres de
requête HMAC de SearXNG ; toutes les répliques de pod doivent partager la même valeur.
Elle est injectée dans les pods au moment de l'exécution via le pilote CSI du magasin de
secrets Kubernetes.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé,
et une adresse IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et
les adresses IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE
sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des stratégies
d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application SearXNG {#3-searxng-application-behaviour}

- **Entièrement sans état.** SearXNG récupère les résultats des moteurs de recherche
  externes au moment de la requête et ne stocke rien localement. Aucune migration de
  base de données ou job d'initialisation ne s'exécute.
- **Pas de job de configuration au premier déploiement.** Comme il n'y a pas de base de
  données, le déploiement se termine sans étape d'initialisation de la base de données
  — le pod est prêt dès que le conteneur démarre.
- **`SEARXNG_SECRET` est stable.** La clé de session est générée une fois et persiste dans
  Secret Manager à travers les redémarrages et les mises à jour progressives. La faire
  tourner invalide toutes les sessions utilisateur actives ; évitez la rotation en
  production sauf si nécessaire pour la sécurité.
- **`SEARXNG_BIND_ADDRESS` est injecté automatiquement** en tant que `0.0.0.0:8080` afin que
  SearXNG écoute sur toutes les interfaces à son port natif.
- **`ENABLE_REDIS` est injecté automatiquement** ; **`REDIS_URL` uniquement lorsque
  `enable_redis = true`** (il est omis entièrement sinon, de sorte qu'un client ne peut pas
  confondre une valeur vide avec un véritable point de terminaison). L'URL est dérivée
  de `redis_host`, `redis_port` et, lorsqu'il est défini, `redis_auth` — une
  instance Memorystore avec AUTH activé rejette une URL sans mot de passe.
- **`SEARXNG_LIMITER` et `SEARXNG_LIMITER_PASS_IPS` sont injectés automatiquement** à partir de
  `enable_limiter` et `limiter_pass_ips` ; le point d'entrée les substitue dans
  `server.limiter` et écrit `/etc/searxng/limiter.toml`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `/healthz` (HTTP GET), auquel SearXNG répond une fois l'application
  entièrement initialisée.
- **Démarrages rapides.** SearXNG démarre en moins de 5 secondes — pas de connexions à
  la base de données ou de migrations de schéma. La sonde de démarrage utilise un court
  délai initial de 10 secondes.
- **L'affinité de session est `None`.** Étant donné que l'état de la session est
  stocké dans le cookie signé par `SEARXNG_SECRET` (et éventuellement dans Redis),
  aucun routage persistant n'est requis.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour SearXNG sont listés ;
toute autre entrée est héritée de [App_GKE](App_GKE.md) avec son comportement et ses
valeurs par défaut standard.

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `searxng` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `SearXNG Search` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag d'image SearXNG ; épingler à une version spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit="500m", memory_limit="512Mi" }` | Limites de CPU et de mémoire par pod. SearXNG est léger ; 500m / 512 Mio sont suffisants pour un trafic modéré. |
| `min_instance_count` | `1` _(fixé en interne)_ | Réplicas minimum. Fixé à 1 — GKE ne prend pas en charge la mise à l'échelle à zéro. |
| `max_instance_count` | `3` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `8080` | Port HTTP natif de SearXNG. |
| `container_image_source` | `custom` | Utiliser l'image officielle de SearXNG (`prebuilt`) ou construire à partir des sources (`custom`). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |
| `enable_cloudsql_volume` | `false` | **Laisser false** — SearXNG n'utilise pas de base de données. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ INSTANCE_NAME="SearXNG", AUTOCOMPLETE="" }` | Paramètres supplémentaires. `SEARXNG_BIND_ADDRESS`, `ENABLE_REDIS` et `REDIS_URL` sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager pour des secrets supplémentaires (par exemple, clés API de moteur en amont). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `None` | SearXNG est sans état ; une distribution égale est préférée. |
| `workload_type` | `null` | Se résout automatiquement en `Deployment` (SearXNG est sans état — laisser null). |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod pour les règles de pare-feu. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

SearXNG est sans état — laissez toutes les variables `stateful_pvc_*` à leurs valeurs par
défaut (`null`). Voir [App_GKE](App_GKE.md) pour savoir quand ce groupe
s'applique.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones pour les déploiements de production. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthz` | Point de terminaison de santé intégré de SearXNG ; le démarrage autorise un délai initial de 10s. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | SearXNG ne nécessite aucun job d'initialisation — laisser vide. |
| `cron_jobs` | `[]` | Tâches planifiées optionnelles (par exemple, préchauffage du cache). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | SearXNG est sans état — NFS n'est pas requis. Laisser false. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | SearXNG est sans état — aucun bucket GCS n'est requis. Laisser false. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Provisionner le backend Redis dont le limiteur a besoin. N'active PAS la limitation de débit à lui seul. |
| `enable_limiter` | `false` | Activer le limiteur de détection de bots. Nécessite `enable_redis`. Définir à true sur toute instance invocable publiquement. |
| `limiter_pass_ips` | `[]` | CIDR sources exemptés de la détection de bots, pour les appelants internes de confiance tels que n8n. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser par défaut `127.0.0.1` lorsque Redis est activé ; définir sur l'IP Memorystore pour une instance gérée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — SearXNG n'utilise pas de base de données. Ne pas modifier. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

SearXNG est sans état — il n'y a pas de données d'application à sauvegarder. Les
variables de sauvegarde sont héritées de l'interface de la fondation mais n'ont aucune
utilité pratique. Voir [App_GKE](App_GKE.md).

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Non applicable à SearXNG (pas de base de données). Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant SearXNG (déploiements internes). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. Recommandé pour les déploiements publics. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre SearXNG. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour SearXNG). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails de la connexion GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `SEARXNG_SECRET` (auto-généré) | auto-généré | Critique | Si un secret personnalisé par pod est injecté à la place, chaque pod signe les cookies avec une clé différente, invalidant les sessions entre les réplicas. Utilisez toujours la valeur auto-générée de Secret Manager. |
| `database_type` | `NONE` | Critique | Changer pour un type de base de données réel provisionne une instance Cloud SQL inutilisée et interrompt le démarrage. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont lus comme des octets par Kubernetes et bloquent toute planification de pod. |
| `enable_redis` | `true` pour les déploiements publics | Élevé | Sauvegarde les compteurs du limiteur. Nécessaire mais PAS suffisant — associez-le à `enable_limiter = true`. |
| `enable_limiter` | `true` pour les déploiements publics | Élevé | Sans cela, le limiteur reste désactivé quelle que soit la configuration de Redis, et une instance invocable publiquement est ouverte au scraping qui épuise les quotas des moteurs en amont. |
| `redis_host` | IP Memorystore ou valeur explicite | Élevé | Lorsque `enable_redis = true` et `redis_host = ""`, le module utilise par défaut `127.0.0.1` — il n'y a pas de Redis sidecar dans la configuration GKE par défaut, donc la limitation de débit est silencieusement désactivée. |
| `vpc_egress_setting` (via la fondation) | assurer l'accès Internet sortant | Élevé | SearXNG récupère les résultats des moteurs externes ; l'accès Internet sortant ne doit pas être bloqué. |
| `application_version` | épinglé (pas `latest`) | Moyen | L'utilisation de `latest` rend les déploiements non reproductibles ; une nouvelle version de SearXNG peut modifier le schéma de configuration. |
| `enable_cloud_armor` | `true` pour les déploiements publics | Moyen | Sans Cloud Armor, il n'y a pas de protection WAF/DDoS sur le point de terminaison public. |
| `enable_iap` | `true` pour les déploiements internes uniquement | Moyen | Pour les déploiements de recherche internes, IAP restreint l'accès aux comptes Google authentifiés. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |
| `stateful_pvc_enabled` | `null` | Faible | SearXNG est sans état — le provisionnement d'un PVC gaspille des coûts et est inutilisé. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à SearXNG partagée
avec la variante Cloud Run est décrite dans **[SearXNG_Common](SearXNG_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SearXNG sur GKE Autopilot](../labs/SearXNG_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [SearXNG sur Google Cloud Run](SearXNG_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [SearXNG Common — Configuration d'application partagée](SearXNG_Common.md) — la configuration partagée par les deux cibles de déploiement.
