---
title: "Préparation PDE, section 4 : observabilité et dépannage"
description: "Préparez la section 4 de l'examen PDE — mettre en œuvre les pratiques d'observabilité et résoudre les problèmes — avec des labs de déploiement RAD pratiques sur Google Cloud."
---
<!-- translated-from: docs/certification/PDE_Section_4_Exploration_Guide.md @ cb682e8 -->

# Guide de préparation à la certification PDE : Section 4 — Mettre en œuvre les pratiques d'observabilité et résoudre les problèmes (Implementing observability practices and troubleshooting issues) (~25 % de l'examen) {#pde-certification-preparation-guide-section-4--implementing-observability-practices-and-troubleshooting-issues-25-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pde_section4.png" alt="Guide de préparation à la certification PDE : section 4 — Mettre en œuvre les pratiques d'observabilité et résoudre les problèmes (~25 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Guide officiel de l'examen :** [Professional Cloud DevOps Engineer certification](https://cloud.google.com/learn/certification/cloud-devops-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

Ce guide couvre la section 4 de l'examen — à égalité avec la section 2 comme domaine le plus lourd — à l'aide des modules fondamentaux de RAD. La surface d'observabilité est construite à partir de la couche de surveillance (canaux de notification + règles d'alerte), de tableaux de bord par plateforme générés automatiquement, de la journalisation d'audit des accès aux données dans chaque module et de la configuration de journalisation/surveillance du cluster GKE. Déployez le profil **Observability baseline** (socle d'observabilité) de la [carte des labs](PDE_Certification_Guide.md) ; les parties GKE nécessitent aussi le profil **GKE release engineer** (ingénieur de release GKE).

Une précision de périmètre d'emblée : les moteurs d'application créent un véritable test de disponibilité synthétique à partir de `uptime_check_config` (par défaut `{ enabled = false, path = "/" }` — vous devez l'activer explicitement) — et alors **uniquement lorsque le point de terminaison est accessible publiquement**. Cloud Run sonde la première entrée de `application_domains`, à défaut l'hôte nip.io de l'équilibreur de charge, à défaut l'URL run.app lorsque `ingress_settings = "all"` ; GKE sonde le domaine personnalisé via la Gateway (HTTPS:443) ou l'IP d'entrée du Service LoadBalancer en HTTP sur `service_port`. Les déploiements uniquement internes n'ont aucun test, et la sortie `uptime_check_names` renvoie le nom du test créé (vide s'il a été omis).

---

## 4.1 Instrumenter et collecter la télémétrie (Instrumenting and collecting telemetry) {#41-instrumenting-and-collecting-telemetry}

> ⏱ ~60 min · 💰 faible à modéré (ingestion des journaux si la journalisation d'audit est activée) · ⚙️ Prérequis : profil socle d'observabilité ; profil ingénieur de release GKE pour la télémétrie du cluster

**Pourquoi l'examen s'y intéresse** — Les questions de télémétrie testent ce qui est collecté automatiquement par opposition à ce qui doit être activé : Cloud Run et GKE émettent nativement des journaux et des métriques de plateforme ; les métriques de charge de travail, les journaux d'audit d'accès aux données, les métriques Prometheus, les traces et les sondes synthétiques nécessitent tous une activation délibérée. Vous devez savoir quel agent ou quelle configuration produit quel signal.

**Comment RAD le met en œuvre**

| Signal | Comment il est produit |
|---|---|
| Journaux applicatifs | automatique — les révisions Cloud Run et les conteneurs GKE écrivent stdout/stderr dans Cloud Logging ; le cluster GKE active explicitement la journalisation des composants système et des charges de travail |
| Métriques de plateforme | automatique (`run.googleapis.com/*`, `kubernetes.io/*`) ; le cluster active la surveillance des composants système |
| Métriques Prometheus | Managed Service for Prometheus est activé sur chaque cluster Services_GCP — il collecte les métriques des charges de travail, interrogeables en PromQL dans Metrics Explorer |
| Canaux de notification | `support_users` (modules applicatifs) → un canal e-mail chacun (créé avec la suppression forcée activée) ; `notification_alert_emails` + `configure_email_notification = true` dans Services_GCP pour les alertes de plateforme |
| Télémétrie d'audit | `enable_audit_logging` (par défaut `false`) → `ADMIN_READ`/`DATA_READ`/`DATA_WRITE` sur `allServices` + configurations explicites pour Secret Manager et KMS |
| Métriques au niveau des VM | l'alerte mémoire de la VM NFS autogérée de Services_GCP utilise la métrique de l'agent Ops `agent.googleapis.com/memory/percent_used` — la mémoire est invisible pour l'hyperviseur sans l'agent |
| Télémétrie de build/déploiement | journaux Cloud Build forcés vers `CLOUD_LOGGING_ONLY` |
| Tests de disponibilité | `<service>-uptime-check` (HTTP GET, période issue de `check_interval`, par défaut `"60s"`, délai d'expiration par défaut `"10s"`) plus `<service>-uptime-check-alert` sur `monitoring.googleapis.com/uptime_check/check_passed`, créés uniquement pour les points de terminaison accessibles publiquement (voir la remarque ci-dessus) |

Notez la logique d'activation dans `App_CloudRun` : la surveillance est configurée lorsque `support_users` n'est pas vide, ou que `alert_policies` n'est pas vide, ou que `uptime_check_config.enabled` vaut true — mais les canaux e-mail et les alertes CPU/mémoire intégrées ne sont créés que si `support_users` contient au moins une entrée.

**À vous de jouer**
1. Appliquez le profil socle d'observabilité, puis vérifiez que les canaux existent :

```bash
gcloud beta monitoring channels list \
  --format="table(displayName,type,labels.email_address)"
```

2. Interrogez la télémétrie des charges de travail en PromQL : **Console > Monitoring > Metrics Explorer > PromQL**, et exécutez `rate(container_cpu_usage_seconds_total[5m])` sur le namespace GKE (cela fonctionne car Prometheus géré est activé sur l'ensemble du cluster).
3. Vérifiez le pipeline d'audit : lisez un secret, puis retrouvez votre propre entrée `AccessSecretVersion` :

```bash
gcloud logging read \
  'protoPayload.serviceName="secretmanager.googleapis.com"' --limit=3 \
  --format="table(timestamp,protoPayload.methodName,protoPayload.authenticationInfo.principalEmail)"
```

4. Inspectez le test synthétique créé par le module (déploiements accessibles publiquement uniquement) : `gcloud monitoring uptime list-configs` affiche `<service>-uptime-check` ; ouvrez-le dans **Console > Monitoring > Uptime checks** et remontez de la règle `<service>-uptime-check-alert` qui y est rattachée jusqu'à votre canal e-mail.
5. Vous savez que cela a fonctionné lorsque les canaux listent votre e-mail, que PromQL renvoie des séries pour votre namespace, que l'entrée d'audit vous nomme et que le test de disponibilité passe au vert depuis plusieurs régions.

**Testez-vous**
<details>
<summary>Q1 : Les métriques de mémoire de votre pod GKE apparaissent dans Cloud Monitoring, mais pas votre métrique applicative personnalisée (`orders_processed_total`). L'application l'expose sur `/metrics`. Que manque-t-il ?</summary>

R : Les métriques de plateforme sont automatiques, mais les métriques applicatives au format Prometheus doivent être collectées (scraping). Même avec Prometheus géré activé (comme le fait Services_GCP), vous devez encore ajouter une ressource personnalisée `PodMonitoring` ciblant le port de métriques du pod — que l'infrastructure de collecte soit activée ne signifie pas que votre point de terminaison est collecté.
</details>

<details>
<summary>Q2 : Pourquoi l'alerte mémoire de la VM NFS nécessite-t-elle l'agent Ops alors que l'alerte CPU n'en a pas besoin ?</summary>

R : L'utilisation du CPU (`compute.googleapis.com/instance/cpu/utilization`) est mesurée par l'hyperviseur ; l'utilisation de la mémoire invitée n'est pas visible depuis l'extérieur du système d'exploitation, elle nécessite donc l'agent Ops installé dans l'invité, qui remonte `agent.googleapis.com/memory/percent_used`. Une distinction classique à l'examen entre métriques de l'hyperviseur et métriques de l'agent.
</details>

**Au-delà des modules** — Les moniteurs synthétiques scriptés (des tests synthétiques fondés sur Cloud Functions qui sondent un parcours en plusieurs étapes, au-delà des simples tests de disponibilité), les tests de disponibilité privés sur des points de terminaison internes, les métriques basées sur les journaux et autres métriques personnalisées, les journaux de flux VPC, l'OpenTelemetry Collector et l'agent Ops comme voies de collecte (y compris pour les charges de travail hybrides et multicloud), la télémétrie de Cloud Service Mesh et Cloud Profiler (profilage continu du CPU et du tas) ne sont pas abordés par les modules. Il en va de même de l'*optimisation* des journaux : aucun filtre d'exclusion, échantillonnage ni contrôle des coûts n'est configuré (voir 4.2). Dans un projet de test : `gcloud monitoring uptime create` sur un point de terminaison privé et `gcloud logging metrics create` sont rapides à essayer et fréquemment évalués. Le traçage est traité au point 4.4.

**⚠️ Piège d'examen** — « La surveillance est activée » recouvre de nombreuses couches : une variable qui *accepte* une configuration de surveillance n'est pas en soi la preuve que le signal est collecté (des versions antérieures de la plateforme acceptaient `uptime_check_config` sans créer aucun test ; vérifiez dans la console — aujourd'hui, elle en provisionne un, mais uniquement pour les points de terminaison publics). À l'examen, associez chaque signal à son producteur : agent, plateforme, configuration de collecte ou configuration d'audit.

---

## 4.2 Gérer et analyser les journaux (Managing and analyzing logs) {#42-managing-and-analyzing-logs}

> ⏱ ~45 min · 💰 faible (ingestion des journaux ; les récepteurs sont facturés à la destination) · ⚙️ Prérequis : n'importe quelle application déployée ; `enable_audit_logging = true` pour les requêtes d'audit

**Pourquoi l'examen s'y intéresse** — Les journaux ne sont utiles que si vous pouvez trouver les bonnes entrées, les conserver aussi longtemps que nécessaire et en tenir les données sensibles à l'écart. L'examen teste le langage de requête de Logging dans Logs Explorer, le routage avec des récepteurs (vers BigQuery pour l'analyse, Pub/Sub pour le streaming, Cloud Storage pour une conservation bon marché), la conservation des buckets de journaux, le masquage des données personnelles (PII) et des données de santé (PHI) avant ou pendant le stockage des journaux, ainsi que l'utilisation de Gemini Cloud Assist pour résumer et expliquer des entrées de journal.

**Comment RAD le met en œuvre** — Partiellement. Les modules produisent des journaux faciles à interroger, mais ne configurent ni routage, ni conservation, ni masquage :

- **Structure interrogeable** : chaque ressource porte les libellés `application`, `deployment`, `tenant` et `managed-by`, les services Cloud Run et les namespaces GKE ont des noms déterministes, et les journaux Cloud Build vont uniquement dans Cloud Logging (`CLOUD_LOGGING_ONLY`), de sorte que les entrées de build et d'exécution peuvent être lues côte à côte.
- **Journaux d'audit** : `enable_audit_logging` (par défaut `false`) ajoute les journaux d'accès aux données pour tous les services, avec des entrées explicites pour Secret Manager et Cloud KMS.
- **Non configuré** : aucun récepteur de journaux, filtre d'exclusion, bucket de journaux personnalisé ni paramètre de conservation n'est créé ; tout arrive donc dans le bucket `_Default` du projet avec sa conservation par défaut. Le masquage des PII et des PHI est laissé à l'application.

**À vous de jouer**
1. Dans **Console > Logging > Logs Explorer**, exécutez une requête combinant ressource, gravité et borne temporelle :

```
resource.type="cloud_run_revision"
resource.labels.service_name="<service>"
severity>=WARNING
timestamp>="2026-01-01T00:00:00Z"
```

2. Épinglez un champ d'une entrée de journal (**Show matching entries** / **Add to summary line**) et activez l'histogramme pour voir quand les entrées se sont concentrées.
3. Dans un projet de test, routez le même filtre vers BigQuery et vérifiez que l'ensemble de données se remplit :

```bash
gcloud logging sinks create run-errors-to-bq \
  bigquery.googleapis.com/projects/$GOOGLE_PROJECT_ID/datasets/run_errors \
  --log-filter='resource.type="cloud_run_revision" AND severity>=ERROR'
```

   Accordez ensuite à l'identité d'écriture du récepteur (affichée par la commande) le rôle `roles/bigquery.dataEditor` sur l'ensemble de données.
4. Vous savez que cela a fonctionné lorsque votre requête ne renvoie que les avertissements du service dans la fenêtre que vous avez définie, et que de nouvelles entrées d'erreur apparaissent dans l'ensemble de données BigQuery.

**Testez-vous**
<details>
<summary>Q1 : La conformité exige de conserver les journaux applicatifs pendant sept ans à un coût minimal, tandis que les ingénieurs ont besoin de 30 jours de recherche rapide. Que configurez-vous ?</summary>

R : Conservez le bucket `_Default` (ou un bucket de journaux personnalisé) à 30 jours pour la recherche, et ajoutez un récepteur routant les mêmes journaux vers Cloud Storage, avec une règle de cycle de vie qui déplace les objets vers la classe de stockage Archive et une règle de conservation (éventuellement verrouillée) de sept ans. BigQuery est le bon choix lorsque les données à long terme doivent être interrogées en SQL, pas lorsque l'objectif est la conservation la moins chère.
</details>

<details>
<summary>Q2 : Une application journalise parfois des adresses e-mail de clients. Quelle est la méthode recommandée pour empêcher leur stockage dans Cloud Logging ?</summary>

R : Les supprimer avant l'ingestion : corriger la journalisation de l'application, ou faire passer les journaux par un processeur qui les masque (par exemple la désidentification de Sensitive Data Protection dans un pipeline, ou un processeur de l'OpenTelemetry Collector ou de l'agent Ops). Les filtres d'exclusion suppriment des entrées entières, ce qui fait aussi perdre la partie utile du journal.
</details>

**Au-delà des modules** — Les récepteurs de journaux (récepteurs de projet, de dossier et récepteurs agrégés d'organisation), les buckets de journaux avec conservation personnalisée et Log Analytics (SQL sur les journaux), les filtres d'exclusion, Sensitive Data Protection pour les PII et les PHI, ainsi que l'explication et la synthèse des journaux par Gemini Cloud Assist dans Logs Explorer. Aucun n'est configuré par les modules RAD.

**⚠️ Piège d'examen** — Les filtres d'exclusion empêchent le *stockage* des journaux dans un bucket, ce qui réduit le coût d'ingestion ; ils n'empêchent pas le routage des journaux par d'autres récepteurs, et les entrées exclues ne peuvent pas être récupérées ultérieurement. Vérifiez qu'aucun récepteur ni aucune exigence d'audit ne dépend de ces journaux avant de les exclure.

---

## 4.3 Gérer les métriques, les tableaux de bord et les alertes (Managing metrics, dashboards, and alerts) {#43-managing-metrics-dashboards-and-alerts}

> ⏱ ~60 min · 💰 faible · ⚙️ Prérequis : profil socle d'observabilité

**Pourquoi l'examen s'y intéresse** — L'examen teste la mécanique des règles d'alerte — filtres, aligneurs, réducteurs, fenêtres de durée, routage des notifications, nouvelle notification — et une conception des tableaux de bord qui met en évidence les quatre signaux clés (latence, trafic, erreurs, saturation). Vous devez être capable de lire la définition d'une règle d'alerte et de prédire exactement quand elle se déclenche.

**Comment RAD le met en œuvre**

- **Alertes fixes** (la couche de surveillance, créées lorsque `support_users` n'est pas vide) : utilisation du CPU et de la mémoire, seuil `0.9`, comparaison « supérieur à », durée `60s`, nouvelle notification toutes les `1800s`. L'agrégation diffère délibérément selon la plateforme — Cloud Run aligne par delta et réduit avec le 99e centile sur `run.googleapis.com/container/cpu/utilizations` ; GKE aligne et réduit par la moyenne, regroupée par nom de pod, sur `kubernetes.io/container/cpu/limit_utilization`.
- **Alertes personnalisées** : la variable `alert_policies` (liste de `{name, metric_type, comparison, threshold_value, duration_seconds, aggregation_period}`) devient une règle par entrée, filtrée automatiquement sur ce service/namespace, alignée par la moyenne et routée vers les mêmes canaux e-mail.
- **Tableaux de bord** : Cloud Run reçoit Request Count, Request Latency (p95), Container Instance Count et Container CPU Utilization, préfiltrés sur le service ; GKE reçoit CPU Usage (Cores), Memory Usage (Bytes), Pod Restart Count et Network Egress (Bytes), préfiltrés sur le namespace.
- **Alertes de la couche plateforme** (Services_GCP, conditionnées par `configure_email_notification`, par défaut `false`) : règles CPU/mémoire/disque Cloud SQL pilotées par `alert_cpu_threshold`/`alert_memory_threshold`/`alert_disk_threshold` (tous à `80` par défaut, divisés par 100 pour obtenir des ratios), plus le CPU et la mémoire du serveur NFS (métrique de l'agent Ops) et une règle d'instance arrêtée fondée sur l'*absence de métrique* d'utilisation du CPU.

**À vous de jouer**
1. Ajoutez une alerte de latence via le portail :

```hcl
alert_policies = [{
  name             = "p99-latency-high"
  metric_type      = "run.googleapis.com/request_latencies"
  comparison       = "COMPARISON_GT"
  threshold_value  = 1000
  duration_seconds = 300
}]
```

2. Appliquez, puis relisez exactement ce qui a été créé :

```bash
gcloud alpha monitoring policies list \
  --format="table(displayName,conditions[0].conditionThreshold.thresholdValue,conditions[0].conditionThreshold.duration)"
```

3. Ouvrez **Console > Monitoring > Dashboards**, trouvez le tableau de bord du module (nommé `<display name> - Cloud Run Dashboard (<deployment-id>)` ou sa variante GKE) et parcourez chaque widget ; notez les `dashboardFilters` qui l'épinglent à votre service/namespace.
4. Forcez une notification : définissez temporairement une alerte personnalisée avec `threshold_value = 1` sur `run.googleapis.com/request_count`, générez du trafic et vérifiez que l'e-mail arrive ; consultez **Monitoring > Alerting > Incidents** pour voir l'incident ouvert, puis supprimez la règle de test.
5. Vous savez que cela a fonctionné lorsque la règle apparaît avec votre seuil et votre durée, que l'incident s'ouvre et se ferme à mesure que le trafic démarre/s'arrête, et que l'e-mail arrive à l'adresse de `support_users`.

**Testez-vous**
<details>
<summary>Q1 : L'alerte CPU de Cloud Run réduit avec le 99e centile sur l'ensemble des séries, tandis que celle de GKE réduit par la moyenne regroupée par pod. Pourquoi une même intention « CPU > 90 % » peut-elle être agrégée différemment ?</summary>

R : Les instances Cloud Run sont interchangeables et éphémères — alerter sur le p99 de l'ensemble des instances détecte les pires instances sans déclencher d'astreinte sur le décalage de la moyenne dû à une seule valeur aberrante. Les pods GKE vivent plus longtemps, sont moins nombreux et significatifs individuellement ; une moyenne par pod (regroupée par nom de pod) identifie donc *quel* pod est en surchauffe. La stratégie d'agrégation doit correspondre à l'unité de défaillance sur laquelle vous agiriez.
</details>

<details>
<summary>Q2 : Une alerte a une durée de 300s. Le CPU monte à 95 % pendant 90 secondes, quatre fois par heure. Se déclenche-t-elle ?</summary>

R : Non — la condition doit être remplie sans interruption pendant toute la fenêtre de durée. Les pics de 90 secondes remettent le compteur à zéro à chaque fois. C'est la protection contre les faux positifs qu'apporte la durée, et c'est aussi pourquoi les problèmes réellement intermittents peuvent nécessiter une durée plus courte ou un aligneur par centile.
</details>

<details>
<summary>Q3 : Comment l'alerte « NFS instance down » de Services_GCP détecte-t-elle une panne alors qu'une VM arrêtée n'émet plus aucune métrique ?</summary>

R : Il s'agit d'une condition d'*absence* de métrique sur `compute.googleapis.com/instance/cpu/utilization` : l'absence de données sur la fenêtre signifie que l'instance a cessé de remonter des données, ce qui constitue le signal de défaillance. Les conditions à seuil ne peuvent pas détecter « aucune donnée » — les conditions d'absence existent précisément pour détecter les émetteurs muets.
</details>

**Alertes de maîtrise des coûts** — `create_billing_budget` (par défaut `false`) dans `Services_GCP` crée un budget Cloud Billing de `budget_amount` (par défaut `100`, dans la devise du compte de facturation) qui envoie un e-mail à `budget_alert_emails` et `support_users` aux fractions `budget_alert_thresholds` (par défaut `[0.5, 0.9, 1.0]`). Il est omis lorsque l'identité qui déploie ne peut pas lire le compte de facturation du projet. Une alerte de budget notifie ; elle n'arrête pas les dépenses.

**Au-delà des modules** — Les alertes fondées sur les SLO (taux de consommation), les conditions d'alerte par correspondance de journaux, les règles à conditions multiples avec combinateurs AND/OR, les canaux de notification webhook, PagerDuty et Slack, et les outils de gestion d'incidents comme Rootly qui reçoivent les alertes par leur intermédiaire (seul `email` est créé ici), les requêtes d'alerte MQL/PromQL, les widgets de tableau de bord en PromQL, le partage de tableaux de bord et les playbooks associés (documentation des alertes), ainsi que les usages de `Compare to past` dans les tableaux de bord. Chacun représente un exercice de 10 minutes dans la console, en plus du lab déployé. Essayez aussi Gemini Cloud Assist sur un graphique d'un tableau de bord du module pour lui faire interpréter le comportement d'une métrique.

**⚠️ Piège d'examen** — La nouvelle notification (toutes les 1800s ici) gère les rappels pour un incident *encore ouvert* ; elle ne réévalue pas et ne redéclenche pas la condition. Confondre nouvelle notification et nouvelle alerte conduit à de mauvaises réponses sur le réglage du bruit des alertes.

---

## 4.4 Capturer et analyser des traces distribuées (Capturing and analyzing distributed traces) {#44-capturing-and-analyzing-distributed-traces}

> ⏱ ~45 min (étude plus un exercice dans un projet de test) · 💰 faible · ⚙️ Prérequis : un projet de test pour l'exercice de traçage

**Pourquoi l'examen s'y intéresse** — Lorsqu'une requête traverse plusieurs services, les journaux et les métriques montrent *qu'elle* a été lente, mais pas *où*. L'examen teste l'instrumentation avec OpenTelemetry, la lecture d'une cascade de trace (une trace est un arbre de spans, chacun doté d'un début, d'une durée et d'attributs), l'identification du span qui concentre la latence, la corrélation d'une trace avec ses entrées de journal via l'ID de trace, et le recours à Gemini Cloud Assist pour analyser une trace.

**Comment RAD le met en œuvre** — Non implémenté : aucun module n'instrumente une application pour le traçage ni ne configure Cloud Trace. Deux faits connexes sont utiles. Cloud Run ajoute un contexte de trace aux requêtes entrantes (l'en-tête `traceparent`, et l'ancien `X-Cloud-Trace-Context`) et écrit des journaux de requêtes qui portent l'ID de trace ; une application instrumentée déployée via RAD n'a donc besoin d'aucune modification d'infrastructure pour envoyer des traces. Et Cloud Service Mesh, facultatif dans `Services_GCP` (`configure_cloud_service_mesh`, disponible uniquement dans un projet que vous apportez vous-même), est l'option de plateforme qui ajoute une télémétrie de service à service sans code applicatif.

**À vous de jouer**
1. Dans un projet de test, déployez un petit service instrumenté avec le SDK OpenTelemetry et l'exportateur de traces Google Cloud (ou l'OpenTelemetry Collector), et envoyez-lui quelques requêtes.
2. Ouvrez **Console > Trace > Trace explorer**, sélectionnez une requête lente et lisez la cascade : identifiez le span racine et le span enfant qui représente l'essentiel de sa durée.
3. Depuis la trace, ouvrez les journaux associés. Pour que cela fonctionne, l'application doit écrire des journaux structurés incluant `logging.googleapis.com/trace` (et `logging.googleapis.com/spanId`) avec l'ID de trace courant.
4. Vous savez que cela a fonctionné lorsque vous pouvez nommer le span le plus lent d'une requête et passer de celui-ci aux entrées de journal écrites pendant ce span.

**Testez-vous**
<details>
<summary>Q1 : Des traces apparaissent dans Cloud Trace, mais le lien « View logs » d'un span ne trouve rien, alors que l'application journalise chaque requête. Pourquoi ?</summary>

R : Les entrées de journal ne sont pas corrélées à la trace. L'application doit écrire l'ID de trace (et idéalement l'ID de span) dans ses entrées de journal structurées, dans le champ `logging.googleapis.com/trace`, sous la forme `projects/PROJECT_ID/traces/TRACE_ID`. Sans cela, journaux et traces forment deux ensembles de données sans lien.
</details>

<details>
<summary>Q2 : Une requête de paiement prend 3 secondes. La trace montre un span de 2.8 secondes pour un appel à la base de données, exécuté après un span de 50 ms pour le service de tarification. Par où commencez-vous ?</summary>

R : Par le span de la base de données : il concentre l'essentiel de la latence sur le chemin critique. Vérifiez s'il s'agit d'une seule requête lente ou de nombreux appels séquentiels (de nombreux spans courts côte à côte suggèrent un schéma N+1), puis utilisez les outils d'analyse des requêtes propres à la base de données pour l'expliquer.
</details>

**Au-delà des modules** — Les concepts d'OpenTelemetry (traces, spans, propagation du contexte, échantillonnage), l'explorateur Cloud Trace et sa carte de chaleur de latence, les taux d'échantillonnage des traces et leur coût, et l'analyse de traces par Gemini Cloud Assist. Tous relèvent de l'étude et d'exercices dans un projet de test.

**⚠️ Piège d'examen** — Le contexte de trace doit être *propagé* à chaque appel sortant. Si un service de la chaîne abandonne l'en-tête `traceparent`, la trace se fragmente en traces distinctes et plus courtes, et la cascade donne l'impression que le travail en aval n'a jamais eu lieu.

---

## 4.5 Résoudre les problèmes (Troubleshooting issues) {#45-troubleshooting-issues}

> ⏱ ~75 min · 💰 aucun coût supplémentaire · ⚙️ Prérequis : n'importe quelle application déployée ; profil GKE pour les chemins Kubernetes

**Pourquoi l'examen s'y intéresse** — Les questions de dépannage reposent sur des scénarios et couvrent cinq types de problèmes : infrastructure (quotas, IAM, réseau), pipeline CI/CD (un build ou un déploiement en échec), application (une révision qui ne démarre pas, des pods en boucle de plantage), observabilité (une métrique ou un journal attendu est absent), et performances et latence. La compétence évaluée consiste à choisir la bonne surface de diagnostic — filtres de Logs Explorer, événements Kubernetes, conditions d'état des révisions, journaux de build, détails des déploiements Cloud Deploy, traces — et à les lire dans le bon ordre.

**Comment RAD le met en œuvre** — Les modules n'ajoutent pas d'outils de dépannage à proprement parler ; ils produisent des charges de travail prévisibles et richement libellées à dépanner. Structure utile garantie par les modules : chaque ressource porte les libellés `application`, `deployment`, `tenant` et `managed-by` ; les révisions Cloud Run sont conditionnées par une sonde de démarrage (`/healthz` par défaut), de sorte que les applications mal configurées échouent *visiblement* au moment du déploiement ; les charges de travail GKE s'exécutent dans un namespace dédié au nom déterministe ; les jobs d'initialisation (configuration de la base de données, configuration NFS) s'exécutent sous forme de jobs Cloud Run / Jobs Kubernetes dont les journaux expliquent la plupart des échecs de premier déploiement ; et les journaux Cloud Build se trouvent dans Cloud Logging (`CLOUD_LOGGING_ONLY`).

**À vous de jouer**
1. Mettez en scène une défaillance : dans le portail, faites pointer `container_image` vers un tag inexistant (ou définissez `startup_probe_config.path` sur un chemin factice) et appliquez.
2. Chemin de diagnostic Cloud Run — d'abord les conditions de la révision, ensuite les journaux :

```bash
gcloud run revisions list --service=<service> --region=us-central1
gcloud run revisions describe <bad-revision> --region=us-central1 \
  --format="yaml(status.conditions)"
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="<service>"
   AND severity>=ERROR' --limit=10
```

3. Chemin de diagnostic GKE — d'abord les événements, puis l'état des pods, puis les journaux :

```bash
kubectl get events -n <namespace> --sort-by=.lastTimestamp | tail -20
kubectl get pods -n <namespace>          # look for ImagePullBackOff / CrashLoopBackOff
kubectl describe pod <pod> -n <namespace>
kubectl logs <pod> -n <namespace> --previous   # logs from the crashed container
```

4. Dans **Console > Logging > Logs Explorer**, reproduisez la requête de l'étape 2 avec les filtres de l'interface, activez l'**Histogram** (histogramme) et mettez en corrélation le pic d'erreurs avec l'horodatage du déploiement.
5. Corrigez la variable, réappliquez et vérifiez le rétablissement : la nouvelle révision indique `Ready: True` / les pods atteignent `Running`.
6. Vous savez que cela a fonctionné lorsque vous pouvez énoncer la cause de la défaillance à partir de `status.conditions` ou du flux d'événements *avant* d'ouvrir les journaux applicatifs.

**Testez-vous**
<details>
<summary>Q1 : Une nouvelle révision Cloud Run est déployée mais reçoit 0 % du trafic, et la révision précédente continue de servir. La commande de déploiement a signalé un échec. Que s'est-il passé, et pourquoi est-ce une bonne chose ?</summary>

R : La sonde de démarrage (ou le démarrage du conteneur) a échoué ; Cloud Run n'a donc jamais marqué la révision comme Ready et n'a jamais basculé le trafic — la révision précédente continue de servir. C'est un déploiement à sécurité intégrée (fail-safe) : une image défectueuse ne peut pas provoquer d'interruption. Diagnostic : `status.conditions` de la révision, puis ses journaux de démarrage.
</details>

<details>
<summary>Q2 : `kubectl logs` ne renvoie rien pour un pod bloqué en `CrashLoopBackOff` dont le nombre de redémarrages augmente. Quelles sont les deux commandes qui vous fourniront les éléments de preuve ?</summary>

R : `kubectl logs <pod> --previous` (la sortie du conteneur *qui a planté* — le conteneur actuel n'a peut-être encore rien journalisé) et `kubectl describe pod <pod>` (code de sortie, état OOMKilled, échecs de sondes, événements). Les événements et le dernier état apportent souvent la réponse sans le moindre journal applicatif.
</details>

<details>
<summary>Q3 : Un job planifié a fonctionné pendant des mois, puis a cessé sans bruit de produire des résultats. Les journaux ne montrent rien à l'heure prévue. Où regardez-vous sur cette plateforme ?</summary>

R : L'absence de journaux à l'heure prévue signifie que le job ne s'est jamais exécuté — vérifiez la couche de déclenchement, pas l'application : l'état et l'indicateur `suspend` du CronJob ainsi que ses événements sur GKE (`kubectl get cronjob -n <ns>`), ou l'historique d'exécution du job Cloud Run. Consultez ensuite les journaux d'audit pour savoir qui l'a modifié.
</details>

**Au-delà des modules** — Error Reporting (regroupement automatique des exceptions), Log Analytics (SQL sur les journaux), les vues de journaux corrélées aux traces (voir 4.4) et `gcloud builds log <id> --stream` pour déboguer un build en direct. Pour les autres types de problèmes : les déploiements Cloud Deploy en échec (`gcloud deploy rollouts describe`), les erreurs de quota sur la page Quotas, les refus IAM dans les journaux d'audit et Policy Troubleshooter, l'accessibilité réseau avec Connectivity Tests, la télémétrie manquante (vérifiez l'agent, la configuration de collecte ou le filtre d'exclusion avant l'application), et la latence avec les traces et Cloud Profiler. Le guide de l'examen cite aussi Gemini Cloud Assist pour l'investigation assistée par IA des journaux, des métriques et des traces. Entraînez-vous sérieusement au langage de requête de Logs Explorer — `resource.type`, `severity>=`, `jsonPayload.field=` et les bornes d'horodatage apparaissent mot pour mot dans les réponses de l'examen.

**⚠️ Piège d'examen** — `kubectl logs` sans `--previous` affiche l'instance *actuelle* du conteneur. Dans une boucle de plantage, l'instance actuelle n'a souvent que quelques secondes et est vide ; les éléments de preuve se trouvent dans les journaux de l'instance précédente.
