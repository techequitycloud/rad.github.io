---
title: "SearXNG sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de SearXNG sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/SearXNG_CloudRun.md @ 1665a43e sha256:5f56f6acd835 -->

# SearXNG sur Google Cloud Run {#searxng-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SearXNG_CloudRun.png" alt="SearXNG sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

SearXNG est un métamoteur de recherche auto-hébergé respectueux de la vie privée
qui agrège les résultats de plus de 70 services de recherche sans suivre les
utilisateurs ni diffuser de publicités. Ce module déploie SearXNG sur
**Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par SearXNG et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte SearXNG sur RAD, et comment cela se compare {#what-searxng-costs-on-rad-and-how-that-compares}

**L'exécution de SearXNG dans votre propre projet GCP coûte environ 16,78 $/mois en frais Google Cloud ; les frais de module de RAD sont de 40 crédits uniques (ou 36 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 40 crédits, une fois | 36 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~16,78 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~3 crédits/jour, mesuré à l'heure par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **16,78 $** |

### Comment cela se compare {#how-it-compares}

- L'empreinte propre de SearXNG ici (1x vCPU / 0,5 GiB) est plus petite que cette classe de référence, donc un niveau de VPS encore moins cher ferait tout aussi bien, mais dimensionné à la plus petite classe couramment citée pour comparaison : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- SearXNG est un proxy de recherche léger interrogé à la demande — son propre coût d'exécution est le plus faible de ce lot, et sans base de données à maintenir en vie, sa suppression récupère presque la totalité du chiffre ci-dessus.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer le projet
purement et simplement — la suppression logique récupérable de 30 jours de Google.
Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL,
aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Parce que rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet pour
lequel RAD gère uniquement la facturation), vous devez le restaurer vous-même
dans les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, donc votre solde
de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour
le niveau sandbox qui convient à la plupart des utilisations d'étude/démo).
Google indique que la plupart des services fonctionnent à nouveau pleinement
dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
jours. Si vous avez personnalisé l'application et que vous souhaitez conserver
ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du
projet) avant de la supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de
restauration de 30 jours ci-dessus), l'alternative est de supprimer SearXNG
purement et simplement et de le redéployer plus tard. Un redéploiement coûte à
nouveau les frais de module, plus les builds — environ 40 + 3-6 crédits de
temps de build.

La suppression ne permet d'économiser de l'argent que si SearXNG restait
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût d'exécution quotidien — par rapport au total du
projet ci-dessus, cela représente environ 8 jours ou plus. Il n'y a pas de base
de données à maintenir en fonctionnement après sa suppression, donc la
suppression de cette application récupère presque la totalité du chiffre de coût
d'exécution ci-dessus.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, donc
copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, afin que personne
  ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et
  les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les
estimations de crédits quotidiens ;
https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les
mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

SearXNG s'exécute comme un conteneur Python/Flask léger sur Cloud Run v2. Le
déploiement relie un ensemble minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python/Flask, 1 vCPU / 512 Mio par défaut, autoscaling basé sur les requêtes |
| Cache / limitation de débit | Redis | Optionnel — désactivé par défaut ; soutient les compteurs du limiteur. La limitation de débit nécessite également `enable_limiter = true` |
| Secrets | Secret Manager | `SEARXNG_SECRET` (clé de session) auto-généré injecté à l'exécution |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** SearXNG est entièrement
  stateless — il agrège les résultats de recherche au moment de la requête et ne
  stocke rien.
- **Aucun NFS ou Cloud Storage n'est provisionné.** SearXNG n'a pas de
  téléchargements ou de fichiers partagés.
- **`min_instance_count` est fixé à 0 (mise à l'échelle à zéro).** Les démarrages à froid
  de SearXNG sont rapides (moins de 5 secondes) car aucune connexion ou
  migration de base de données n'est effectuée au démarrage.
- **Le limiteur est désactivé par défaut, et Redis seul ne l'active pas.**
  L'image RAD épingle `server.limiter: false` afin que l'API JSON reste utilisable par les
  appelants internes de serveur à serveur. Pour un déploiement invocable
  publiquement, définissez À LA FOIS `enable_redis = true` et `enable_limiter = true`, et exemptez les
  appelants de confiance via `limiter_pass_ips`, pour obtenir une limitation de débit et
  une détection de bot contre l'abus du moteur en amont.
- **`SEARXNG_SECRET` est généré automatiquement** et stocké dans Secret Manager. La
  même clé est partagée entre toutes les instances en cours d'exécution — ne la
  remplacez pas par une valeur aléatoire par instance.
- **Les sondes de santé ciblent `/healthz`.** Le point de terminaison de santé
  intégré de SearXNG renvoie 200 lorsque l'application est prête.
- **`vpc_egress_setting` par défaut à `PRIVATE_RANGES_ONLY`.** SearXNG doit atteindre les moteurs de
  recherche externes ; assurez-vous qu'une passerelle Cloud NAT est configurée
  ou passez à `ALL_TRAFFIC`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service SearXNG {#a-cloud-run--the-searxng-service}

SearXNG s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge des requêtes, se réduisant à zéro
lorsqu'il est inactif. Chaque déploiement crée une révision immuable ; le
trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### Limitation connue : le limiteur ne peut pas identifier les clients sur Cloud Run {#known-limitation-the-limiter-cannot-identify-clients-on-cloud-run}

`enable_limiter = true` active réellement le limiteur (`/config` rapporte `limiter.enabled: true`), mais sur
Cloud Run, il bloque actuellement **tous** les appelants, y compris ceux qui
sont autorisés. SearXNG enregistre :

```
ERROR:searx.botdetection: X-Forwarded-For nor X-Real-IP header is set!
```

`botdetection.ProxyFix` résout le client dans l'ordre X-Forwarded-For → X-Real-IP → `REMOTE_ADDR`,
revertant à l'adresse du trou noir `100::` lorsqu'il n'en trouve aucune. Aucun
en-tête de proxy n'atteint le conteneur sur Cloud Run, de sorte que chaque
requête se résout à ce même fallback : une identité partagée, un seau de jetons
partagé, et `limiter_pass_ips` ne peut jamais correspondre car l'adresse à laquelle il se
compare n'est pas celle de l'appelant.

L'échec dépend de la direction et est facile à mal interpréter :

- Avec `limiter_trusted_proxies` **vide**, `REMOTE_ADDR` (une adresse link-local) n'est pas fiable,
  les en-têtes sont ignorés, et le client link-local résultant n'est pas limité
  par défaut — donc le limiteur est activé et **admet tout le monde**.
- Avec les plages privées/link-local **fiables**, les en-têtes sont consultés,
  trouvés absents, et tout s'effondre à `100::` — donc le limiteur **rejette
  tout le monde**.

Vérifié en direct : 25/25 requêtes non authentifiées ont renvoyé 429, tout comme
l'appelant autorisé. Les en-têtes forgés `X-Real-IP` et `X-Forwarded-For` ont également été
rejetés, de sorte que la liste blanche n'est au moins pas falsifiable.

Tant que les en-têtes de proxy n'atteignent pas le conteneur, une instance Cloud
Run invocable publiquement ne peut pas être protégée par le limiteur. Restreignez
plutôt l'accès — un équilibreur de charge HTTP interne avec un NEG sans serveur
et `ingress_settings =
"internal-and-cloud-load-balancing"`, ou IAP — et laissez `enable_limiter = false`. La variante GKE n'est pas affectée
lorsqu'un contrôleur d'entrée définit X-Forwarded-For normalement ; définissez
`limiter_trusted_proxies` sur la plage de ce contrôleur.

### B. Cache Redis (optionnel) {#b-redis-cache-optional}

`enable_redis = true` provisionne le backend Redis dans lequel le limiteur conserve ses
compteurs par IP. Il n'active **pas** à lui seul la limitation de débit :
l'image RAD embarque `server.limiter: false` afin que l'API JSON reste utilisable par les
appelants internes de serveur à serveur. Définissez également `enable_limiter = true` pour
activer réellement la détection de bot — le plan échoue si vous l'activez sans
Redis. Lorsque `redis_host` est laissé vide et que Redis est activé, le module
utilise par défaut `127.0.0.1`.

Le limiteur traite les appels d'API sans en-tête comme des bots, alors listez
les plages source des appelants internes de confiance dans `limiter_pass_ips`, sinon ils
seront limités comme tous les autres. Activez les deux sur toute instance
accessible depuis l'internet public : sinon, quiconque trouve l'URL peut
consommer les quotas du moteur en amont dont elle dépend.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### C. Secret Manager — SEARXNG_SECRET {#c-secret-manager--searxng_secret}

`SearXNG_Common` génère automatiquement la clé de session `SEARXNG_SECRET` et la stocke dans
Secret Manager. Cette clé signe les cookies de session et les paramètres de
requête HMAC de SearXNG ; toutes les instances doivent partager la même valeur.
Elle est injectée dans le service au moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
superposé ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la
connectivité aux moteurs de recherche externes.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run sont acheminées vers Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application SearXNG {#3-searxng-application-behaviour}

- **Entièrement stateless.** SearXNG récupère les résultats des moteurs de
  recherche externes au moment de la requête et ne stocke rien localement.
  Aucune migration de base de données ou tâche d'initialisation n'est exécutée.
- **Pas de tâche de configuration au premier déploiement.** Comme il n'y a pas
  de base de données, le déploiement se termine sans étape d'initialisation de
  la base de données — le service est prêt dès que le conteneur démarre.
- **`SEARXNG_SECRET` est stable.** La clé de session est générée une seule fois et
  persiste dans Secret Manager à travers les révisions de service. La faire
  tourner invalide toutes les sessions utilisateur actives ; évitez la rotation
  en production sauf si nécessaire pour la sécurité.
- **`SEARXNG_BIND_ADDRESS` est injecté automatiquement** comme `0.0.0.0:8080` afin que SearXNG
  écoute sur toutes les interfaces à son port natif.
- **`ENABLE_REDIS` est injecté automatiquement** ; **`REDIS_URL` uniquement lorsque
  `enable_redis = true`** (il est entièrement omis sinon, de sorte qu'un client ne peut pas
  confondre une valeur vide avec un véritable point de terminaison). L'URL est
  dérivée de `redis_host`, `redis_port` et, si défini, `redis_auth` — une instance Memorystore
  avec AUTH activé rejette une URL sans mot de passe.
- **`SEARXNG_LIMITER` et `SEARXNG_LIMITER_PASS_IPS` sont injectés automatiquement** à partir de `enable_limiter` et
  `limiter_pass_ips` ; le point d'entrée les substitue dans `server.limiter` et écrit `/etc/searxng/limiter.toml`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/healthz`
  (HTTP GET), auquel SearXNG répond une fois l'application entièrement
  initialisée.
- **Démarrages à froid rapides.** SearXNG démarre en moins de 5 secondes —
  aucune connexion de base de données ou migration de schéma. La sonde de
  démarrage utilise un délai initial de 10 secondes.
- **Sortie VPC pour les moteurs externes.** SearXNG récupère les résultats des
  services de recherche en amont via Internet. Assurez-vous que la sortie du
  connecteur VPC n'est pas limitée aux plages privées uniquement, ou configurez
  Cloud NAT pour l'accès à Internet.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
SearXNG sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `searxng` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `SearXNG Search` | Nom convivial affiché dans la Console. |
| `description` | `SearXNG — privacy-respecting metasearch engine on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de l'image SearXNG ; épingler à une version spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. 1 vCPU gère un trafic SearXNG modéré. |
| `memory_limit` | `512Mi` | Mémoire par instance. Mettre à l'échelle à `1Gi` pour les instances publiques à fort trafic. |
| `max_instance_count` | `3` | Nombre maximal d'instances (plafond de coût). |
| `container_port` | `8080` | Port HTTP natif de SearXNG. |
| `execution_environment` | `gen2` | Gen2 recommandé pour un démarrage plus rapide et un réseau amélioré. |
| `timeout_seconds` | `60` | Durée maximale de la requête. Les moteurs en amont lents peuvent nécessiter une augmentation à 120-300. |
| `container_image_source` | `custom` | Utiliser l'image officielle SearXNG (`prebuilt`) ou construire à partir de la source (`custom`). |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — SearXNG est un proxy de recherche stateless sans travail de fond en cours, donc le CPU n'est nécessaire que lors du traitement d'une requête. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry avant le déploiement. |
| `enable_cloudsql_volume` | `false` | **Laisser false** — SearXNG n'utilise pas de base de données. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. Utilisez `internal` pour les déploiements privés. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. Définissez `ALL_TRAFFIC` si Cloud NAT n'est pas configuré. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy (déploiements internes). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ INSTANCE_NAME="SearXNG", AUTOCOMPLETE="", SEARXNG_BIND_ADDRESS="0.0.0.0:8080" }` | Paramètres supplémentaires. `ENABLE_REDIS` et `REDIS_URL` sont également injectés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager pour des secrets supplémentaires (par exemple, clés API de moteur en amont). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

SearXNG est stateless — il n'y a pas de données d'application à sauvegarder. Les
variables de sauvegarde sont héritées de l'interface de la fondation mais n'ont
aucune utilité pratique. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

Non applicable à SearXNG (pas de base de données). Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. Recommandé pour les déploiements publics. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS (SSL géré par Google). |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | SearXNG est stateless — aucun bucket GCS n'est requis. Laisser false. |
| `enable_nfs` | `false` | SearXNG est stateless — NFS n'est pas requis. Laisser false. |
| `gcs_volumes` | `[]` | Montages GCS Fuse (non utilisés par SearXNG). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — SearXNG n'utilise pas de base de données. Ne pas modifier. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | SearXNG ne nécessite pas de jobs d'initialisation — laisser vide. |
| `cron_jobs` | `[]` | Tâches planifiées optionnelles (par exemple, préchauffage du cache). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthz` | Point de terminaison de santé intégré de SearXNG ; le démarrage permet un délai initial de 10 s. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Provisionner le backend Redis dont le limiteur a besoin. N'active PAS la limitation de débit à lui seul. |
| `enable_limiter` | `false` | Activer le limiteur de détection de bot. Nécessite `enable_redis`. Définir à true sur toute instance invocable publiquement. |
| `limiter_pass_ips` | `[]` | CIDR source exemptés de la détection de bot, pour les appelants internes de confiance tels que n8n. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser par défaut `127.0.0.1` lorsque Redis est activé ; définir sur l'IP Memorystore pour une instance gérée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour SearXNG). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails de connexion GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `SEARXNG_SECRET` (auto-généré) | auto-généré | Critique | Si remplacé par une valeur aléatoire par instance, chaque démarrage à froid produit une clé différente, invalidant tous les cookies de session existants. Utilisez toujours la valeur auto-générée de Secret Manager. |
| `database_type` | `NONE` | Critique | Changer pour un type de base de données réel provisionne une instance Cloud SQL inutilisée et interrompt le démarrage. |
| `vpc_egress_setting` | `ALL_TRAFFIC` ou Cloud NAT configuré | Élevé | `PRIVATE_RANGES_ONLY` bloque les requêtes sortantes de SearXNG vers les moteurs de recherche externes (Google, Bing, DuckDuckGo, etc.), renvoyant des résultats vides. |
| `enable_redis` | `true` pour les déploiements publics | Élevé | Sans Redis, SearXNG n'a pas de limitation de débit ; les instances publiques sont vulnérables au scraping qui épuise les quotas des moteurs en amont. |
| `redis_host` | IP Memorystore ou valeur explicite | Élevé | Lorsque `enable_redis = true` et `redis_host = ""`, le module utilise par défaut `127.0.0.1` — il n'y a pas de Redis sidecar dans Cloud Run, donc la limitation de débit est silencieusement désactivée. |
| `timeout_seconds` | `60`–`300` | Moyen | SearXNG attend tous les moteurs de recherche activés ; les moteurs en amont lents peuvent nécessiter jusqu'à 30 secondes par requête. Une valeur trop faible provoque des erreurs 504 avant que les résultats ne soient agrégés. |
| `application_version` | épinglé (pas `latest`) | Moyen | L'utilisation de `latest` rend les déploiements non reproductibles ; une nouvelle version de SearXNG peut modifier le schéma de configuration. |
| `enable_cloud_armor` | `true` pour les déploiements publics | Moyen | Sans Cloud Armor, il n'y a pas de protection WAF/DDoS sur le point de terminaison public. |
| `enable_iap` | `true` pour usage interne uniquement | Moyen | Pour les déploiements de recherche internes, IAP restreint l'accès aux comptes Google authentifiés. |
| `ingress_settings` | `all` pour public ; `internal` pour privé | Moyen | `all` est intentionnel pour un métamoteur de recherche public ; combiner avec la limitation de débit Redis et Cloud Armor pour la production. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à SearXNG partagée avec la variante GKE est décrite
dans **[SearXNG_Common](SearXNG_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SearXNG sur Cloud Run](../labs/SearXNG_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [SearXNG sur GKE Autopilot](SearXNG_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [SearXNG Common — Configuration d'application partagée](SearXNG_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md) dans la solution **Assistant IA privé**.
