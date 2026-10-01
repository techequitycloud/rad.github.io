---
title: "NodeRED Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module NodeRED — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/NodeRED_Common.md @ 3055034 sha256:91d1be758320 -->

# NodeRED Common — Configuration applicative partagée {#nodered-common--shared-application-configuration}

`NodeRED_Common` est la **couche applicative partagée** de Node-RED. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Node-RED sur laquelle
s'appuient à la fois [NodeRED_GKE](NodeRED_GKE.md) et [NodeRED_CloudRun](NodeRED_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais directement cette
couche — elle n'a aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans
la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Node-RED, consultez les
guides des plateformes ([NodeRED_GKE](NodeRED_GKE.md),
[NodeRED_CloudRun](NodeRED_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par NodeRED_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle l'image officielle `nodered/node-red` provenant de Docker Hub | Sortie `container_image` du déploiement de la plateforme |
| Liaison de port | Définit `container_port = 1880` — le port HTTP natif de Node-RED | Configuration du service/de la révision |
| Garde du mode sans échec | Injecte toujours `NODE_RED_ENABLE_SAFE_MODE = "false"` | Variables d'environnement du déploiement de la plateforme |
| Paramètre de base de données | Code en dur `database_type = "NONE"` — aucune instance Cloud SQL | §Base de données dans les guides des plateformes |
| Pas de proxy Cloud SQL | Définit `enable_cloudsql_volume = false` | Configuration du sidecar |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `storage`) | Sortie `storage_buckets` |
| Contrôles de santé | Fournit les valeurs par défaut des sondes de démarrage et d'activité HTTP GET `/` | §Observabilité dans les guides des plateformes |
| Aucune tâche d'initialisation | `initialization_jobs` vide par défaut — aucun schéma ni amorçage de données requis | Sortie `initialization_jobs` |

**Différence essentielle avec les modules Common adossés à une base de données.**
Contrairement à des modules comme Mautic ou WordPress, `NodeRED_Common` ne crée
aucune ressource GCP ni aucun secret Secret Manager. Le seul identifiant utilisé
par cette application — `NODE_RED_CREDENTIAL_SECRET` — est généré et géré
entièrement par le socle (`App_CloudRun` ou `App_GKE`) via la variable
`database_password_length`, et non par cette couche.

---

## 2. Chiffrement des identifiants des flux {#2-flow-credential-encryption}

`NODE_RED_CREDENTIAL_SECRET` est un secret généré aléatoirement que Node-RED
utilise pour chiffrer tous les identifiants stockés dans son fichier
`flows_cred.json` (clés d'API, mots de passe, jetons contenus dans les flux). Le
socle génère automatiquement ce secret à l'aide de `database_password_length`
(32 caractères par défaut) et l'injecte à l'exécution depuis Secret Manager.

Récupérez-le après le déploiement :

```bash
# The secret name follows the deployment's resource prefix:
gcloud secrets list --project "$PROJECT" --filter="name~credential"
gcloud secrets versions access latest --secret=<credential-secret> --project "$PROJECT"
```

**Important :** modifier ce secret ou effectuer sa rotation après le déploiement
des flux rend définitivement illisibles tous les identifiants de flux stockés.
N'activez pas `enable_auto_password_rotation`, sauf si vous disposez d'une
procédure de rechiffrement des identifiants après chaque rotation.

---

## 3. Image de conteneur et port {#3-container-image-and-port}

Node-RED utilise l'image officielle `nodered/node-red` publiée sur Docker Hub.
Aucun Dockerfile personnalisé n'est fourni avec ce module. Le tag de l'image est
contrôlé par `application_version` dans le module enveloppe (par défaut
`"latest"` ; épinglez une version précise comme `"4.0.9"` pour des déploiements
reproductibles) :

```
nodered/node-red:<application_version>
```

La mise en miroir de l'image dans Artifact Registry est activée par défaut
(`enable_image_mirroring = true` dans le module enveloppe) : l'image est copiée
depuis Docker Hub vers le dépôt Artifact Registry du projet afin d'éviter les
limites de débit. Node-RED écoute sur le port `1880`.

---

## 4. Stockage persistant des flux {#4-persistent-flow-storage}

Tout l'état de Node-RED — la définition des flux (`flows.json`), le fichier
d'identifiants chiffrés (`flows_cred.json`), les nœuds de palette installés et le
fichier de paramètres — se trouve dans le répertoire `/data`. `NodeRED_Common`
lui-même ne déclare aucune variable NFS ; ce sont les variantes de plateforme —
[NodeRED_CloudRun](NodeRED_CloudRun.md) et [NodeRED_GKE](NodeRED_GKE.md) — qui
définissent par défaut `enable_nfs = true` et `nfs_mount_path = "/data"`, de sorte
que le partage NFS Filestore est monté exactement à cet emplacement dès
l'installation.

Sans NFS (ou un PVC de StatefulSet), chaque redémarrage du conteneur ou
redéploiement lance Node-RED avec un répertoire `/data` vide, et tous les flux,
identifiants et nœuds installés sont perdus.

Explorez le montage NFS après le déploiement :

```bash
# GKE:
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep nfs

# Cloud Run (NFS details in service spec):
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.volumes)'
```

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`NodeRED_Common` établit l'environnement de base de Node-RED :

- **Garde du mode sans échec.** `NODE_RED_ENABLE_SAFE_MODE = "false"` est
  toujours injecté et fusionné avec les `environment_variables` fournies par
  l'appelant (les valeurs de l'appelant sont prioritaires). Cela garantit que les
  flux s'exécutent à chaque démarrage. Définissez-le sur `"true"` via
  `environment_variables` pour démarrer Node-RED avec les flux désactivés afin de
  déboguer un flux défaillant.
- **Pas de base de données.** `database_type = "NONE"` est codé en dur ; aucune
  instance Cloud SQL n'est provisionnée et aucun sidecar Cloud SQL Auth Proxy n'est
  injecté.
- **Aucune tâche d'initialisation.** Contrairement aux applications adossées à une
  base de données, Node-RED ne nécessite ni initialisation de schéma, ni création
  d'utilisateur, ni amorçage de données. La liste `initialization_jobs` est vide par
  défaut ; ne transmettez des tâches personnalisées que pour des opérations
  précises, comme l'import d'une archive de flux ou la préinstallation de nœuds de
  palette.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et d'activité utilisent toutes deux HTTP GET sur le chemin
racine `/`, qui renvoie l'interface de l'éditeur Node-RED une fois l'application
entièrement démarrée. Un délai initial de 30 secondes suffit, car Node-RED démarre
rapidement, sans migration de base de données ni longue étape d'amorçage.

- **Sonde de démarrage :** HTTP GET `/`, délai initial de 30s, période de 10s, seuil d'échec de 3.
- **Sonde d'activité :** HTTP GET `/`, délai initial de 30s, période de 30s, seuil d'échec de 3.

Ces valeurs par défaut s'appliquent de manière identique aux variantes GKE et Cloud
Run. Contrairement à des applications comme Mautic (où le trafic de contrôle de
santé de Cloud Run déclenche des redirections), Node-RED renvoie une réponse 200 sur
`/` en HTTP simple ; aucun contournement par sonde TCP n'est donc nécessaire.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est déclaré ici et
provisionné par le socle, qui accorde également l'accès au compte de service de la
charge de travail. Ce bucket est destiné aux exports de flux, aux archives de
sauvegarde et aux autres données applicatives de Node-RED. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~nodered"
```

---

Pour la configuration propre à Node-RED destinée aux utilisateurs (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[NodeRED_GKE](NodeRED_GKE.md)** et
**[NodeRED_CloudRun](NodeRED_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Node-RED sur Google Cloud Run](NodeRED_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Node-RED sur GKE Autopilot](NodeRED_GKE.md) — cette configuration déployée sur GKE.
