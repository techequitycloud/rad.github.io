---
title: "VictoriaMetrics Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module VictoriaMetrics — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/VictoriaMetrics_Common.md @ 3055034 sha256:23b1e7e607e5 -->

# VictoriaMetrics Common — Configuration applicative partagée {#victoriametrics-common--shared-application-configuration}

`VictoriaMetrics_Common` est la **couche applicative partagée** de
VictoriaMetrics. Elle n'est pas déployée seule ; elle fournit la configuration
propre à VictoriaMetrics sur laquelle s'appuie
[VictoriaMetrics_GKE](VictoriaMetrics_GKE.md). Contrairement à la plupart des
modules Common de ce catalogue, elle n'a qu'un seul consommateur — il n'existe
**aucune variante Cloud Run** (voir le §1 du [guide VictoriaMetrics_GKE](VictoriaMetrics_GKE.md)
pour en connaître la raison). Les utilisateurs finaux ne configurent jamais cette
couche directement — elle n'a aucune entrée propre dans l'interface de
déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut
que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement VictoriaMetrics,
consultez le guide de la plateforme ([VictoriaMetrics_GKE](VictoriaMetrics_GKE.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par VictoriaMetrics_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle l'image officielle `victoriametrics/victoria-metrics` via un build personnalisé (`image_source = "custom"`) | Sortie `container_image` du déploiement de la plateforme |
| Aucune base de données SQL | Fixe `database_type = "NONE"` — VictoriaMetrics est lui-même une base de données de séries temporelles | Aucune instance Cloud SQL ni aucun identifiant de base de données n'est créé |
| Aucun Redis | Aucune dépendance de cache | `enable_redis` est codé en dur à `false` dans le `main.tf` de `VictoriaMetrics_GKE` |
| Point d'entrée à flags CLI | Épingle `-storageDataPath=/victoria-metrics-data`, `-httpListenAddr=:8428`, `-retentionPeriod=12` dans l'`ENTRYPOINT` du Dockerfile personnalisé | Commande de démarrage du conteneur ; non exposée sous forme de variables d'environnement |
| Aucun bucket de stockage d'objets | La sortie `storage_buckets` vaut toujours `[]` — l'intégration GCS/S3 de VictoriaMetrics sert uniquement aux sauvegardes, jamais de stockage servant les requêtes en direct | Le stockage principal est exclusivement le PVC du StatefulSet GKE (entièrement défini dans `VictoriaMetrics_GKE`) |
| Aucun secret | La sortie `secret_ids` vaut toujours `{}` — VictoriaMetrics n'a aucune authentification intégrée | Aucun secret Secret Manager n'est créé pour ce module |
| Sondes de santé | Fournit la configuration par défaut des sondes de démarrage et d'activité, ciblant toutes deux l'unique point de terminaison `/health` | §Observabilité dans le guide de la plateforme |

---

## 2. Aucune authentification, aucun secret {#2-no-authentication-no-secrets}

VictoriaMetrics n'a aucun modèle d'authentification intégré par
utilisateur/mot de passe ou par clé d'API ; `VictoriaMetrics_Common` ne génère
donc rien à stocker dans Secret Manager — sa sortie `secret_ids` vaut
inconditionnellement `{}` :

```hcl
output "secret_ids" {
  description = "VictoriaMetrics has no built-in authentication and needs no generated secrets. Gate access at the network layer (ClusterIP + internal-only ingress, or IAP)."
  value       = {}
}
```

Le contrôle d'accès de ce module relève entièrement d'une décision au niveau
réseau prise dans `VictoriaMetrics_GKE` : `service_type = "ClusterIP"` par défaut
limite l'accès à la charge de travail à l'intérieur du cluster (par exemple par
Grafana ou un émetteur Prometheus `remote_write` s'exécutant à ses côtés). Si
vous devez l'exposer plus largement, ajoutez IAP ou Cloud Armor —
VictoriaMetrics accepte et traite toute requête qui lui parvient.

---

## 3. Stockage — PVC du StatefulSet uniquement, aucun bucket {#3-storage--statefulset-pvc-only-no-bucket}

VictoriaMetrics gère son propre moteur de stockage de séries temporelles
intégré. Il n'y a **aucune base de données Cloud SQL**, **aucun mode de stockage
GCS FUSE** et **aucune tâche d'amorçage de base de données**. Au premier
démarrage, VictoriaMetrics initialise automatiquement son répertoire de données
`/victoria-metrics-data`.

Contrairement aux modules Common d'applications qui prennent en charge à la fois
un bucket GCS FUSE et un PVC (par exemple Qdrant), `VictoriaMetrics_Common` ne
déclare **aucun bucket de stockage** — sa sortie `storage_buckets` est codée en
dur à `[]` :

```hcl
# No object-storage bucket is created — VictoriaMetrics's S3/GCS integration
# is backup-only (vmbackup/vmrestore snapshots), never live query-serving
# storage. Primary storage is exclusively the GKE StatefulSet PVC.
output "storage_buckets" {
  value = []
}
```

La variable `enable_gcs_storage_volume` existe uniquement par souci de parité
d'interface avec le schéma de bascule PVC/bucket des modules voisins.
`VictoriaMetrics_GKE` lui transmet toujours `false` (puisque
`stateful_pvc_enabled = true` est la valeur par défaut), et elle ne doit jamais
valoir `true` en pratique — les fichiers de données sur disque local de
VictoriaMetrics, mappés en mémoire (mmap), ne sont pas compatibles avec GCS FUSE,
même comme mode de repli (contrairement à certaines applications pour lesquelles
FUSE constitue une option dégradée plus lente mais exploitable).

Explorez les ressources de stockage :

```bash
# PVC status
kubectl get pvc -n "$NAMESPACE"
kubectl describe pvc -n "$NAMESPACE"

# Underlying Persistent Disk
gcloud compute disks list --project "$PROJECT" --filter="name~victoriametrics"

# Data files inside the pod
kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /victoria-metrics-data
```

---

## 4. Paramètres principaux de l'application — flags CLI, pas de variables d'environnement {#4-core-application-settings--cli-flags-not-environment-variables}

`VictoriaMetrics_Common` établit la configuration de base de VictoriaMetrics
entièrement au moyen d'un `ENTRYPOINT` personnalisé, car **VictoriaMetrics n'a
aucune configuration par variables d'environnement — uniquement des flags CLI** :

```dockerfile
ARG VM_VERSION=v1.148.0
FROM victoriametrics/victoria-metrics:${VM_VERSION}

ENTRYPOINT ["/victoria-metrics-prod", "-storageDataPath=/victoria-metrics-data", "-httpListenAddr=:8428", "-retentionPeriod=12"]
```

- **Chemin de stockage** — `-storageDataPath=/victoria-metrics-data` correspond
  au chemin de montage du PVC du StatefulSet configuré dans `VictoriaMetrics_GKE`
  (`stateful_pvc_mount_path`, même valeur par défaut). Sans cela, le `CMD` par
  défaut de l'image amont écrit dans un chemin *relatif* `./victoria-metrics-data`
  sans redéfinition de l'adresse d'écoute, ce qui explique pourquoi un
  `ENTRYPOINT` personnalisé minimal est nécessaire.
- **Adresse d'écoute** — `-httpListenAddr=:8428` écoute sur toutes les
  interfaces, sur le port par défaut documenté de VictoriaMetrics.
- **Rétention** — `-retentionPeriod=12` définit une fenêtre de rétention de
  12 mois (1 an). VictoriaMetrics interprète un entier nu comme un nombre de mois
  (un suffixe comme `d`/`w`/`y` sélectionne une autre unité). **Cette valeur est
  intégrée à l'image, ce n'est pas une variable Terraform** — la modifier
  implique d'éditer ce Dockerfile et de forcer un nouveau build (par exemple
  `tofu taint` sur la ressource de build du module).
- **Nommage de l'argument de build** — l'épinglage de version du Dockerfile
  utilise l'ARG de build propre à l'application `VM_VERSION`, et non l'ARG
  générique `APP_VERSION` que le module Foundation injecte dans `build_args` et
  qui l'emporterait sinon silencieusement lors de la fusion.
  `application_version = "latest"` est associé, au moment du build, à la version
  épinglée et éprouvée `v1.148.0` (l'image amont n'a pas de tag `latest` flottant
  qui lui soit propre).
- **`environment_variables` est tout de même transmis** à l'environnement du
  conteneur par souci de parité d'interface avec tous les autres modules de ce
  catalogue, mais les valeurs qui y sont définies n'ont aucun effet sur le
  comportement de VictoriaMetrics, sauf si le binaire amont lit justement ce nom
  de variable exact (ce qui n'est pas le cas par défaut).

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

VictoriaMetrics expose un unique point de terminaison de santé, non authentifié,
utilisé par les deux sondes :

| Point de terminaison | Rôle | Utilisé par |
|---|---|---|
| `/health` | Renvoie `OK` dès que le processus est démarré et sert les requêtes | Sonde de démarrage **et** sonde d'activité |

Contrairement aux applications dont la séquence de démarrage est plus lourde et
qui nécessitent des sémantiques distinctes de disponibilité et d'activité (par
exemple la séparation `/readyz` / `/livez` de Qdrant, où la disponibilité peut
légitimement osciller pendant le chargement des données), VictoriaMetrics n'a pas
de phase de chargement prolongée équivalente pour un jeu de données neuf ou de
taille modérée ; un seul point de terminaison suffit donc pour les deux types de
sonde.

---

## 6. Aucune tâche d'initialisation {#6-no-initialization-job}

VictoriaMetrics gère son propre moteur de stockage intégré et ne nécessite ni
schéma, ni migration, ni données d'amorçage — c'est un binaire autonome. Aucune
tâche d'initialisation n'est injectée par défaut. Si `var.initialization_jobs`
n'est pas vide dans l'encapsuleur (pour une tâche d'amorçage personnalisée que
vous ajoutez vous-même), ces tâches sont transmises au socle après normalisation
des types de champs ; sinon, aucune n'est créée.

---

Pour la configuration propre à VictoriaMetrics destinée aux utilisateurs
(variables par groupe, sorties et manière d'explorer chaque service depuis la
console et la CLI), consultez le guide de la plateforme :
**[VictoriaMetrics_GKE](VictoriaMetrics_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [VictoriaMetrics sur GKE Autopilot](VictoriaMetrics_GKE.md) — cette configuration déployée sur GKE.
