---
title: "Loki Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Loki — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Loki_Common.md @ 3055034 sha256:8c46d9917fc0 -->

# Loki Common — Configuration applicative partagée {#loki-common--shared-application-configuration}

`Loki_Common` est la **couche applicative partagée** de
[Grafana Loki](https://grafana.com/oss/loki/). Elle n'est pas déployée seule ;
elle fournit plutôt la configuration propre à Loki sur laquelle s'appuient à la fois
[Loki_GKE](Loki_GKE.md) et [Loki_CloudRun](Loki_CloudRun.md), de sorte que les deux
variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais
cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre
ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Loki, consultez les guides
des plateformes ([Loki_GKE](Loki_GKE.md), [Loki_CloudRun](Loki_CloudRun.md)) et les
guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Loki_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Enveloppe l'image officielle `grafana/loki` avec un point d'entrée personnalisé (gabarit de configuration) ; construite via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | **Aucun** — `database_type = "NONE"`. Loki n'a pas de base de données externe ; ses chunks et son index TSDB résident dans GCS | Section Base de données des guides de plateforme |
| Amorçage de la base de données | **Aucun** — aucun job `db-init` n'est injecté. `initialization_jobs` est transmis tel quel (vide par défaut) | Sortie `initialization_jobs` |
| Secrets cryptographiques | **Aucun** — `secret_ids` et `secret_values` sont tous deux vides. Loki n'a besoin d'aucun identifiant au moment du déploiement (`auth_enabled: false`, mono-locataire) | Sorties `secret_ids` / `secret_values` |
| Stockage d'objets | **Un bucket GCS** (`storage`), le backend de stockage d'objets propre à Loki pour les chunks et l'index TSDB expédié | Sortie `storage_buckets`, sortie `storage_sa_bucket_name` |
| IAM | Accorde à l'identité de calcul en cours d'exécution `roles/storage.objectAdmin` sur le bucket | Configuré directement dans le `loki.tf` de chaque variante, et non dans `Loki_Common` lui-même |
| Paramètres principaux | Fixe `container_port = 3100` ; injecte `LOKI_GCS_BUCKET` au moment du déploiement | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/ready` | Section Observabilité des guides de plateforme |
| Garde de mise à l'échelle | Impose `max_instance_count = 1` dans la configuration transmise au socle, quelle que soit la valeur de l'appelant | Section Comportement de l'application des guides de plateforme |

---

## 2. Pas de secrets, pas de base de données — un bucket GCS {#2-no-secrets-no-database--one-gcs-bucket}

Contrairement à la plupart des modules applicatifs, `Loki_Common` ne génère **rien** dans Secret
Manager et ne provisionne **aucune** instance Cloud SQL :

```hcl
output "secret_ids" {
  value = {}
}

output "secret_values" {
  sensitive = true
  value     = {}
}
```

- `database_type = "NONE"`, `db_name = ""`, `db_user = ""` — aucune instance Cloud SQL n'est
  créée. Toutes les variables liées à la base de données exposées par les guides de plateforme
  (`application_database_name`, `application_database_user`,
  `enable_cloudsql_volume`, `database_password_length`, …) sont inertes.
- Avec `auth_enabled: false` intégré à la configuration propre de Loki, il n'existe aucune couche
  d'authentification intégrée pour laquelle `Loki_Common` devrait amorcer un identifiant.

**Le stockage n'est pas facultatif, contrairement aux `storage_buckets` de la plupart des modules.** Loki
*exige* un backend de stockage d'objets pour ses chunks et son index. La sortie
`storage_buckets` de `Loki_Common` déclare toujours un bucket :

```hcl
output "storage_buckets" {
  value = [
    {
      name_suffix              = "storage"
      location                 = ""
      storage_class            = "STANDARD"
      force_destroy             = true
      versioning_enabled       = false
      lifecycle_rules          = []
      public_access_prevention = "enforced"
    }
  ]
}
```

Récupérez-le après le déploiement :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
gcloud storage du -s gs://<storage-bucket>/
```

---

## 3. IAM du stockage d'objets — configuré par variante, pas dans Common {#3-object-storage-iam--configured-per-variant-not-in-common}

`Loki_Common` expose `storage_sa_bucket_name` — le nom déterministe du bucket,
`gcs-${service_name}-storage` — précisément pour que le propre `loki.tf` de chaque variante de plateforme
(et non `Loki_Common` lui-même) puisse accorder directement à l'identité de calcul en cours d'exécution l'accès
à ce bucket :

```hcl
# Loki_CloudRun/loki.tf
resource "google_storage_bucket_iam_member" "loki_storage_admin" {
  bucket = module.app_cloudrun.storage_buckets["storage"]
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:cloudrun-sa-${local.resource_prefix}@${var.project_id}.iam.gserviceaccount.com"
}
```

La variante GKE fait exactement la même chose pour `gke-sa-${local.resource_prefix}`.
Toutes deux référencent la sortie de bucket propre au sous-module de stockage — et non `depends_on = [the
whole Foundation module]` — délibérément, car Loki a besoin de cette autorisation avant que son
premier pod ou sa première révision puisse même devenir sain ; dépendre du module socle entier
(qui attend lui-même une charge de travail saine) provoquerait un interblocage.

Le client GCS natif de Loki utilise les **Application Default Credentials** (l'identité propre du
service en cours d'exécution) — aucune clé HMAC ni aucun identifiant d'interopérabilité S3 n'est utilisé, contrairement aux applications
qui passent par le chemin de stockage alternatif d'interopérabilité S3 de Loki (délibérément évité
ici pour écarter le risque d'incompatibilité de sommes de contrôle entre GCS et le SDK AWS).

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée enveloppe l'image officielle `grafana/loki` — mais `grafana/loki` est
**réellement distroless** : l'inspection du système de fichiers de l'image ne montre que
`/usr/bin/loki` — ni `/bin/sh`, ni coreutils, ni aucun éditeur de liens dynamique.

```dockerfile
ARG LOKI_VERSION=3.6.12
FROM busybox:musl AS busybox

FROM grafana/loki:${LOKI_VERSION}
USER root
COPY --from=busybox /bin/busybox /bin/busybox
COPY loki-config.yaml /etc/loki/local-config.yaml.template
COPY entrypoint.sh /entrypoint.sh
USER 10001
EXPOSE 3100
ENTRYPOINT ["/bin/busybox", "sh", "/entrypoint.sh"]
```

- **ARG de build propre à l'application.** Le tag de base est piloté par `LOKI_VERSION`, **et non** par
  l'`APP_VERSION` générique qu'injecte le socle (qui le forcerait à `"latest"`
  — les tags propres à Loki n'ont pas de préfixe `v`, p. ex. `3.6.12`). `Loki_Common` calcule :
  `loki_image_version = var.application_version == "latest" ? "3.6.12" : var.application_version`.
- **Busybox lié statiquement, délibérément.** Greffer un binaire issu du tag par défaut
  `busybox:stable` échoue avec `exec /bin/busybox: no such file or directory`
  car il est lié dynamiquement et la cible distroless n'a aucun éditeur de liens dynamique.
  `busybox:musl` est réellement lié statiquement (vérifié avec `file` : static-PIE,
  aucun interpréteur nécessaire) et s'exécute de façon autonome dans la cible distroless — le même
  schéma de correction déjà établi dans ce catalogue pour d'autres images de base scratch/distroless
  (p. ex. Vikunja).
- **Aucun lien symbolique d'applet.** Seul l'unique binaire `busybox` est greffé ; le
  point d'entrée invoque donc busybox par chemin absolu et le script de point d'entrée lui-même appelle
  `/bin/busybox sed ...` plutôt qu'un simple `sed`.
- **Construite via Cloud Build et mise en miroir.** `image_source = "custom"` avec
  `enable_image_mirroring = true`.
- **Utilisateur d'exécution restauré.** `USER root` n'est actif que pour les étapes `COPY` ;
  `USER 10001` rétablit l'utilisateur d'exécution non root par défaut de Grafana avant le
  démarrage du conteneur.

---

## 5. Paramètres principaux de l'application : gabarit de fichier de configuration, pas de variables d'environnement {#5-core-application-settings-config-file-templating-not-env-vars}

Loki est **entièrement piloté par fichier de configuration** pour ses paramètres de stockage et de schéma. Il n'existe
aucune variable d'environnement de type `LOKI_STORAGE_BACKEND` que Loki lirait. `Loki_Common`
intègre à l'image un gabarit de configuration (`loki-config.yaml`) comportant un espace réservé pour
l'unique élément de configuration réellement propre à chaque déploiement :

```yaml
storage_config:
  gcs:
    bucket_name: __LOKI_GCS_BUCKET__
```

Le point d'entrée substitue le nom réel du bucket (injecté via la variable d'environnement
`LOKI_GCS_BUCKET` par `Loki_Common`) dans le gabarit au
démarrage du conteneur :

```sh
/bin/busybox sed "s#__LOKI_GCS_BUCKET__#${LOKI_GCS_BUCKET}#" \
  /etc/loki/local-config.yaml.template > /etc/loki/local-config.yaml
exec /usr/bin/loki -config.file=/etc/loki/local-config.yaml
```

Autres valeurs par défaut importantes intégrées à la configuration, héritées par les deux variantes de plateforme :

- **`auth_enabled: false`** — mono-locataire, sans multi-location.
- **`common.ring.kvstore.store: inmemory`**, `replication_factor: 1` — correct pour un
  déploiement monolithique à instance unique ; c'est aussi la raison pour laquelle `Loki_Common` épingle en dur
  `max_instance_count = 1` dans la configuration qu'il transmet au socle.
- **`schema_config`** utilise `store: tsdb`, `object_store: gcs`, `schema: v13`.
- **`compactor`** effectue la rétention/suppression (`retention_enabled: true`,
  `delete_request_store: gcs`) — une opération véritablement singleton.
- **`limits_config.retention_period: 720h`** (30 jours) est la fenêtre de rétention
  par défaut.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent **`/ready`** — le point de terminaison de disponibilité
intégré de Loki, qui renvoie HTTP 200 dès que le serveur écoute. Comme Loki
n'a aucune migration de base de données et que le gabarit de configuration est appliqué avant l'exécution du processus,
il devient prêt en quelques secondes après le démarrage.

---

Pour la configuration propre à Loki destinée aux utilisateurs (variables par groupe, sorties, et
manière d'explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[Loki_GKE](Loki_GKE.md)** et **[Loki_CloudRun](Loki_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Loki sur Google Cloud Run](Loki_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Loki sur GKE Autopilot](Loki_GKE.md) — cette configuration déployée sur GKE.
