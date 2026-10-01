---
title: "Préparation PDE, section 5 : optimisation des performances et des coûts"
description: "Préparez la section 5 de l'examen Professional Cloud DevOps Engineer (PDE) — optimiser les performances et les coûts — avec des labs RAD pratiques sur Google Cloud."
---
<!-- translated-from: docs/certification/PDE_Section_5_Exploration_Guide.md @ cb682e8 -->

# Guide de préparation à la certification PDE : Section 5 — Optimiser les performances et les coûts (Optimizing performance and cost) (~12 % de l'examen) {#pde-certification-preparation-guide-section-5--optimizing-performance-and-cost-12-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pde_section5.png" alt="Guide de préparation à la certification PDE : section 5 — Optimiser les performances et les coûts (~12 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Guide officiel de l'examen :** [Professional Cloud DevOps Engineer certification](https://cloud.google.com/learn/certification/cloud-devops-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

Ce guide couvre la section 5 de l'examen à l'aide des modules fondamentaux de RAD. Les leviers de performance se trouvent dans `App_CloudRun` (environnement d'exécution, allocation du CPU, sondes, ressources) et `App_GKE` (demandes de ressources, VPA, quotas) ; les leviers de coût couvrent les deux moteurs, ainsi que le nettoyage d'Artifact Registry et la configuration de répartition des coûts du cluster GKE. Déployez le profil **Cost-lean serverless** (serverless économe) de la [carte des labs](PDE_Certification_Guide.md) ; les exercices GKE réutilisent le profil **GKE release engineer** (ingénieur de release GKE).

---

## 5.1 Collecter des informations de performance dans Google Cloud (Collecting performance information in Google Cloud) {#51-collecting-performance-information-in-google-cloud}

> ⏱ ~60 min · 💰 faible · ⚙️ Prérequis : profil serverless économe ; profil ingénieur de release GKE pour les métriques Kubernetes

**Pourquoi l'examen s'y intéresse** — Les questions de performance testent l'isolement des causes : la latence vient-elle des démarrages à froid, de la limitation du CPU, du plafond de ressources du conteneur ou d'une dépendance en aval ? Vous devez savoir quel paramètre de plateforme produit quelle signature de performance et quelle métrique le prouve.

**Comment RAD le met en œuvre**

| Levier | Paramètre du module | Effet sur les performances |
|---|---|---|
| Environnement d'exécution | `execution_environment` (par défaut `gen2`) | gen2 offre une compatibilité Linux complète (requise par les montages NFS et GCS Fuse du module — validée au moment du plan) et des caractéristiques de démarrage et de CPU différentes de gen1 |
| Boost du CPU au démarrage | le boost du CPU au démarrage est toujours activé pour le service Cloud Run | le CPU supplémentaire pendant le démarrage d'une instance réduit la latence de démarrage à froid |
| Allocation du CPU | `cpu_always_allocated` (par défaut `false`) détermine si le CPU reste alloué en période d'inactivité | un CPU toujours alloué maintient l'exécution des tâches d'arrière-plan entre les requêtes ; un CPU alloué uniquement pendant les requêtes est limité à presque zéro en période d'inactivité |
| Plancher d'instances chaudes | `min_instance_count` (par défaut `0`) | ≥1 élimine les démarrages à froid pour un coût constant |
| Plafond de ressources | `container_resources` (`cpu_limit` `1000m`, `memory_limit` `512Mi`) | des limites sous-dimensionnées se traduisent par de la limitation (throttling) ou des arrêts OOM |
| Réglage des sondes | `startup_probe_config` / `health_check_config` | un `/healthz` lent ou un `failure_threshold` trop serré se fait passer pour une instabilité du déploiement |
| Source des métriques GKE | Prometheus géré + surveillance `SYSTEM_COMPONENTS` sur chaque cluster Services_GCP | données de performance des charges de travail interrogeables en PromQL |

Les éléments de preuve de performance se trouvent dans Metrics Explorer : `run.googleapis.com/request_latencies`, `run.googleapis.com/container/startup_latencies`, `run.googleapis.com/container/cpu/utilizations` et `kubernetes.io/container/cpu/limit_utilization` — les mêmes métriques que celles sur lesquelles reposent les tableaux de bord et les alertes du module (voir le [guide de la section 4](PDE_Section_4_Exploration_Guide.md#43-managing-metrics-dashboards-and-alerts)).

**À vous de jouer**
1. Mesurez les démarrages à froid : avec `min_instance_count = 0`, laissez le service inactif environ 15 minutes, puis :

```bash
for i in 1 2 3; do curl -s -o /dev/null -w "request $i: %{time_total}s\n" <service-url>; done
```

   La première requête subit le démarrage à froid ; comparez avec **Metrics Explorer >** `run.googleapis.com/container/startup_latencies`.
2. Définissez `min_instance_count = 1` dans le portail, appliquez, puis répétez la mesure après une nouvelle période d'inactivité — la pénalité de démarrage à froid disparaît.
3. Passez `cpu_always_allocated = false`, appliquez, et vérifiez que **Console > Cloud Run > (service) > Revisions > (latest)** affiche « CPU is only allocated during request processing » ; avec des charges de travail utilisant des threads d'arrière-plan, vous observeriez désormais une limitation pendant les périodes d'inactivité.
4. Sur GKE, comparez les ressources demandées et réelles : `kubectl top pods -n <namespace>` par rapport aux valeurs de `container_resources` dans la spécification du pod (`kubectl get pod <pod> -n <ns> -o jsonpath='{.spec.containers[0].resources}'`).
5. Vous savez que cela a fonctionné lorsque vous pouvez attribuer l'écart de latence de la première requête au démarrage (et non au traitement de la requête) à l'aide de la métrique de latence de démarrage, et que vous pouvez énoncer le rapport utilisation/demande de chaque pod.

**Testez-vous**
<details>
<summary>Q1 : Un service Cloud Run affiche un p50 rapide mais une latence p99 catastrophique, concentrée juste après les périodes d'inactivité. Quels sont les deux paramètres qui corrigent cela, et que coûtent-ils ?</summary>

R : `min_instance_count = 1` (instance chaude — élimine les démarrages à froid, coût de base constant) et le boost du CPU au démarrage (déjà activé pour ce service — des démarrages plus rapides lorsqu'ils ont lieu, facturés uniquement pendant le démarrage). La signature « p99 après inactivité » est l'empreinte classique des démarrages à froid.
</details>

<details>
<summary>Q2 : Après avoir défini `cpu_always_allocated = false`, les webhooks de réponse d'un service ne se déclenchent plus alors que les requêtes réussissent. Pourquoi ?</summary>

R : Avec un CPU alloué uniquement pendant les requêtes, les threads d'arrière-plan (le travail qui se poursuit après l'envoi de la réponse) sont limités à presque zéro entre les requêtes. Tout traitement asynchrone doit soit se terminer avant la réponse, soit être déplacé vers un job ou une file Cloud Run, soit le service doit disposer d'un CPU toujours alloué.
</details>

**Au-delà des modules** — Cloud Trace (où la latence s'accumule le long du chemin de la requête), Cloud Profiler (quelle fonction consomme le CPU — ajoutez l'agent du langage et lisez les flame graphs) et la méthodologie des tests de charge ne sont pas provisionnés. Dans un projet de test, instrumentez un service Cloud Run avec OpenTelemetry et examinez une cascade de trace — les questions d'examen citent explicitement ces outils (voir le [guide de la section 4](PDE_Section_4_Exploration_Guide.md#44-capturing-and-analyzing-distributed-traces)). Étudiez aussi Active Assist : le Recommendation Hub ainsi que les insights et recommandations qu'il fait remonter pour les ressources inactives, les VM surprovisionnées et les charges de travail GKE, et les services Cloud Run.

**⚠️ Piège d'examen** — « CPU toujours alloué » et `min_instance_count` sont des axes indépendants : un service avec min-instances=1 et un CPU alloué uniquement pendant les requêtes est toujours limité entre les requêtes, et un service à scale-to-zero avec un CPU toujours alloué ne paie toujours rien lorsqu'aucune instance n'existe. Ne confondez pas instances chaudes et CPU actif.

---

## 5.2 Mettre en œuvre les pratiques FinOps pour optimiser l'utilisation des ressources et les coûts (Implementing FinOps practices for optimizing resource utilization and costs) {#52-implementing-finops-practices-for-optimizing-resource-utilization-and-costs}

> ⏱ ~60 min · 💰 réduit les coûts · ⚙️ Prérequis : profil serverless économe ; profil ingénieur de release GKE

**Pourquoi l'examen s'y intéresse** — Les questions FinOps testent l'adéquation entre le mécanisme d'économie et le type de gaspillage : capacité inactive → scale-to-zero ou redimensionnement ; ressources surdemandées → VPA/Recommender ; artefacts obsolètes → règles de cycle de vie/de nettoyage ; charge stable et prévisible → remises sur engagement d'utilisation ; lacunes d'attribution → libellés et export de facturation.

**Comment RAD le met en œuvre**

- **Inactivité qui ne coûte rien** : `min_instance_count = 0` (valeur par défaut de Cloud Run) plus `cpu_always_allocated = false` offre un véritable scale-to-zero avec une facturation à la granularité de la requête.
- **Plafonds de dépenses** : `max_instance_count` (par défaut `1` pour Cloud Run, `3` pour GKE) plafonne la facture dans le pire des cas.
- **Redimensionnement** : GKE Autopilot facture selon les *demandes* (requests) des pods ; `container_resources` est donc directement une donnée d'entrée de la facturation ; `enable_vertical_pod_autoscaling` (par défaut `false`) permet au VPA d'ajuster en continu les demandes à l'utilisation observée (`updateMode: Auto`, plancher `10m` de CPU / `32Mi`).
- **Garde-fous de consommation** : `enable_resource_quota` (par défaut `false`) plafonne un namespace à `quota_cpu_requests`/`quota_cpu_limits` (par défaut `"4"`), `quota_memory_requests` (par défaut `"4Gi"`) / `quota_memory_limits` (par défaut `"8Gi"`) — les suffixes d'unités binaires sont obligatoires et validés (un `"4"` nu serait lu par Kubernetes comme 4 *octets* et bloquerait toute planification) — ainsi que `quota_max_pods` (`"20"`), `quota_max_services` (`"10"`), `quota_max_pvcs` (`"5"`).
- **Hygiène du stockage des artefacts** : le trio de nettoyage d'Artifact Registry — `max_images_to_retain` (par défaut `7`, KEEP), `delete_untagged_images` (par défaut `true`), `image_retention_days` (par défaut `30`) — et l'élagage des révisions Cloud Run via `max_revisions_to_retain` (par défaut `7`).
- **Coûts de l'observabilité** : le principal facteur facultatif de ce lab est `enable_audit_logging`, qui active les journaux d'accès aux données pour tous les services et est facturé au volume ingéré ; la collecte Prometheus gérée sur le cluster GKE est facturée par échantillon ingéré.
- **Alertes de budget** : `create_billing_budget` (par défaut `false`) dans `Services_GCP` crée un budget Cloud Billing pour le projet, qui alerte par e-mail aux seuils `budget_alert_thresholds` de `budget_amount` (voir le [guide de la section 4](PDE_Section_4_Exploration_Guide.md#43-managing-metrics-dashboards-and-alerts)).
- **Points d'ancrage de la visibilité des coûts** : chaque ressource porte des libellés d'attribution des coûts (`tenant`, `application`, `deployment`) ; le cluster GKE active la répartition des coûts, de sorte que les coûts par namespace/charge de travail apparaissent dans les rapports de facturation. Notez que l'ancien export de l'utilisation des ressources vers BigQuery n'est *pas* pris en charge sur Autopilot et a été supprimé — l'export de facturation combiné à la répartition des coûts est la voie prise en charge.

**À vous de jouer**
1. Quantifiez le scale-to-zero : avec le profil serverless économe, observez le nombre d'instances retomber à zéro après l'arrêt du trafic — **Metrics Explorer >** `run.googleapis.com/container/instance_count` — puis comparez avec une journée en `min_instance_count = 1` dans **Billing > Reports**, en filtrant sur le groupe de SKU Cloud Run et en regroupant par libellé de service.
2. Redimensionnez sur la base de preuves sur GKE : générez de la charge, lisez `kubectl top pods -n <ns>` et, si l'utilisation reste très inférieure aux demandes, abaissez `container_resources` ou définissez `enable_vertical_pod_autoscaling = true` et appliquez ; vérifiez la cible du VPA avec :

```bash
kubectl get vpa <service>-vpa -n <namespace> \
  -o jsonpath='{.status.recommendation.containerRecommendations[0].target}'
```

3. Appliquez un budget de namespace : définissez `enable_resource_quota = true` (valeurs par défaut ci-dessus) et vérifiez son application :

```bash
kubectl describe resourcequota -n <namespace>
```

   Essayez ensuite de relever `max_instance_count` au-delà de ce que permet le quota et observez les pods rester en Pending avec un événement de quota.
4. Auditez les dépenses liées aux artefacts : `gcloud artifacts repositories describe <repo> --location=us-central1 --format="yaml(cleanupPolicies)"` et la taille de **Artifact Registry > (repo)** dans le temps.
5. Vous savez que cela a fonctionné lorsque le nombre d'instances tombe à zéro entre les pics, que la cible du VPA est inférieure à votre demande initiale et que le ResourceQuota affiche l'utilisation par rapport aux limites strictes.

**Testez-vous**
<details>
<summary>Q1 : Une facture GKE Autopilot semble élevée alors que `kubectl top` montre des pods qui utilisent ~20 % de leurs demandes de CPU. Quelle est la correction structurelle la moins chère ?</summary>

R : Abaisser les demandes — Autopilot facture les ressources demandées, pas celles qui sont utilisées. Définissez `container_resources` à partir de l'utilisation observée ou activez le VPA pour le faire en continu. Souscrire des CUD avant de redimensionner reviendrait à figer le gaspillage.
</details>

<details>
<summary>Q2 : Pourquoi le module vérifie-t-il que `quota_memory_requests` porte un suffixe binaire comme `"4Gi"` ?</summary>

R : Kubernetes interprète un `"4"` nu comme 4 octets. Un quota de mémoire de namespace de 4 octets fait que la demande de chaque pod dépasse le quota, si bien que rien n'est planifié — une panne causée par une faute de frappe sur l'unité. La validation au moment du plan transforme un mystère d'exécution en un échec immédiat et explicable.
</details>

<details>
<summary>Q3 : La Finance veut des rapports de coûts par équipe pour des charges de travail partageant un même cluster GKE Autopilot. Quelles sont les deux fonctionnalités de la plateforme qui le permettent ici ?</summary>

R : La répartition des coûts GKE (activée sur les clusters Services_GCP), qui attribue les coûts du cluster aux namespaces/libellés dans les données de facturation, combinée aux libellés de ressources cohérents des modules (`tenant`, `application`). Exportez la facturation vers BigQuery et regroupez par ces libellés pour le rapport.
</details>

**Au-delà des modules** — L'export de facturation vers BigQuery (le socle de toute pratique FinOps — à configurer dans **Billing > Billing export**), les alertes de budget programmatiques via Pub/Sub (le budget du module se contente d'envoyer des e-mails), les outils de recommandation Google Cloud dans toutes leurs catégories (coût, sécurité, performances, facilité de gestion, fiabilité), y compris les recommandations de redimensionnement et de ressources inactives, les remises sur engagement d'utilisation (les CUD GKE Autopilot portent sur des quantités de vCPU/GB, pas sur des types de machines) et les remises proportionnelles à l'utilisation (automatiques, pour l'utilisation éligible de Compute Engine), les niveaux de réseau Standard vs Premium, les VM Spot et les Pods Spot pour les traitements par lots tolérants aux pannes, ainsi que les exclusions et la conservation des journaux comme leviers de maîtrise des coûts de l'observabilité. Aucun n'est provisionné par les modules ; tous sont des exercices peu coûteux à réaliser dans la console sur le projet de lab.

**⚠️ Piège d'examen** — Supprimer les anciennes *images* de conteneur et les anciennes *révisions* Cloud Run sont deux problèmes distincts : une révision fige son image par condensé, de sorte qu'un nettoyage agressif du registre peut casser le retour arrière vers une révision conservée dont l'image a été supprimée. La valeur par défaut de la règle KEEP du module (`max_images_to_retain = 7`) correspond à `max_revisions_to_retain` (7) — gardez ce couplage à l'esprit lorsque vous ajustez l'un ou l'autre.
