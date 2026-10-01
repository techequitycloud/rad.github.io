---
title: "Headscale Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Headscale — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Headscale_Common.md @ 3055034 sha256:c9ad1decc6e2 -->

# Headscale Common — Configuration applicative partagée {#headscale-common--shared-application-configuration}

`Headscale_Common` est la **couche applicative partagée** de Headscale. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Headscale sur laquelle
s'appuient à la fois [Headscale_GKE](Headscale_GKE.md) et
[Headscale_CloudRun](Headscale_CloudRun.md), de sorte que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais directement cette couche — elle n'a aucune entrée
propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Headscale, consultez
les guides des plateformes ([Headscale_GKE](Headscale_GKE.md),
[Headscale_CloudRun](Headscale_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Headscale_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsule `headscale/headscale:<version>-debug` (une base construite avec `ko`) avec un `config.yaml` et un point d'entrée intégrés ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe `database_type = "NONE"` — Headscale repose entièrement sur un SQLite intégré | §Base de données dans les guides des plateformes |
| Stockage | Déclare le bucket GCS `storage` et le montage `/var/lib/headscale` (GCS Fuse sur Cloud Run ; de manière conditionnelle sur GKE) | Sortie `storage_buckets` |
| Application d'une instance unique | Code en dur `max_instance_count = 1` dans la `config` assemblée — la valeur de la variable de l'appelant n'est jamais lue | Exécution et mise à l'échelle dans les guides des plateformes |
| Configuration de base | `config.yaml` intégré : backend SQLite, DERP intégré désactivé, MagicDNS désactivé, les champs `noise.private_key_path`/`dns` qu'exige Headscale 0.26.1 | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/health` | §Observabilité dans les guides des plateformes |
| Secrets | Aucun — `secret_ids`/`secret_values` sont tous deux des maps vides | s.o. |

---

## 2. Aucun secret applicatif {#2-no-application-level-secrets}

Contrairement à la plupart des modules Common de ce catalogue, `Headscale_Common`
ne génère **aucun secret**. Il n'y a ni mot de passe administrateur, ni jeton
d'API, ni clé de chiffrement à gérer — Headscale n'a pas de connexion web
intégrée ni de magasin d'identifiants applicatif propre. `secret_ids` et
`secret_values` sont tous deux des maps vides, transmises telles quelles par les
deux Application Modules.

---

## 3. Moteur de base de données — SQLite intégré uniquement {#3-database-engine--embedded-sqlite-only}

`database_type = "NONE"` est fixé par `Headscale_Common` ; aucun autre backend de
base de données n'est pris en charge par ce module. Headscale conserve l'intégralité
de son état persistant dans un unique fichier SQLite :

```
/var/lib/headscale/db.sqlite              # + -wal / -shm sidecars (WAL mode)
/var/lib/headscale/noise_private.key      # Noise protocol (Tailscale v2) key, auto-generated
```

Il n'existe pas de job distinct d'initialisation de la base de données —
Headscale crée et migre automatiquement son propre schéma au premier démarrage,
de la même manière que sur un déploiement bare-metal ou sur VM.

---

## 4. Image de conteneur — base personnalisée construite avec `ko` et fine surcouche {#4-container-image--custom-ko-built-base-with-a-thin-wrapper}

Contrairement aux applications qui déploient directement une image officielle,
`Headscale_Common` définit `image_source = "custom"` et livre un `Dockerfile`
minimal :

```dockerfile
ARG HEADSCALE_VERSION=0.26.1
FROM headscale/headscale:${HEADSCALE_VERSION}-debug

COPY config.yaml /etc/headscale/config.yaml
COPY entrypoint.sh /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/busybox/busybox", "sh", "/entrypoint.sh"]
```

`HEADSCALE_VERSION` se résout vers la version épinglée `0.26.1` lorsque
`application_version = "latest"` — il s'agit de l'ARG de build propre au
Dockerfile, distinct de l'`APP_VERSION` générique qu'injecte le socle (qui
forcerait sinon le tag vers `headscale:latest-debug`, qui n'existe pas).

**Deux pièges réels, confirmés en conditions réelles lors de la construction de
cette image — détectés grâce à des tests Docker locaux avant même de toucher au
cloud, ce qui constitue en soi une méthodologie validée à reproduire pour les
futurs modules à build personnalisé :**

1. **Le tag `-debug` a été choisi pour le busybox qu'il embarque, mais ce busybox
   n'est toujours pas dans le `PATH` en tant que `/bin/sh`.** Confirmé en
   conditions réelles : `docker run --entrypoint /bin/sh <image>` échoue avec
   « no such file or directory ». Une étape de build `RUN chmod +x` et un point
   d'entrée avec shebang `#!/bin/sh` échouent tous deux pour la même raison. La
   correction : invoquer directement le binaire `/busybox/busybox` propre à
   l'image — dont `file` confirme qu'il est réellement lié statiquement
   (contrairement à certaines autres images de base minimales de ce catalogue qui
   nécessitent un busybox greffé de l'extérieur) — via
   `ENTRYPOINT ["/busybox/busybox", "sh", "/entrypoint.sh"]`. Aucun `chmod` n'est
   nécessaire, puisque busybox interprète le chemin du script comme un argument
   au lieu de l'exécuter comme un fichier.
2. **Le véritable binaire Headscale se trouve dans `/ko-app/headscale`, et non
   dans `/usr/bin/headscale`.** L'image amont est construite avec l'outil `ko` de
   Google, qui applique sa propre convention de placement des binaires plutôt
   qu'un `COPY` classique de Dockerfile. `entrypoint.sh` exécute directement
   `/ko-app/headscale serve`.

---

## 5. Configuration intégrée — deux champs qu'exige la 0.26.1 et que la documentation amont ne rend pas évidents {#5-baked-configuration--two-fields-0261-requires-that-upstream-docs-dont-make-obvious}

`scripts/config.yaml` est intégré à l'image au moment du build. Seuls
`server_url`/`listen_addr` varient réellement d'un déploiement à l'autre, et tous
deux sont remplacés à l'exécution via les variables d'environnement
`HEADSCALE_SERVER_URL`/`HEADSCALE_LISTEN_ADDR` (Headscale repose sur Viper, qui
associe automatiquement les variables d'environnement en majuscules avec
underscores aux clés de configuration équivalentes). Deux champs ont dû être
ajoutés au-delà d'une lecture naïve de la documentation de Headscale, tous deux
découverts grâce à des tests locaux :

- **`noise.private_key_path: /var/lib/headscale/noise_private.key`** —
  requis par le protocole Noise de Tailscale v2. Une clé manquante est
  normalement générée automatiquement, mais Headscale 0.26+ échoue purement et
  simplement à la validation de la configuration (« headscale now requires a new
  `noise.private_key_path` field ») si le champ lui-même est absent du fichier,
  et pas seulement non défini.
- **Un bloc `dns:` complet**, avec `magic_dns: false`, `override_local_dns:
  false` et `nameservers.global: [1.1.1.1, 1.0.0.1]` explicites. La
  documentation amont indique que `override_local_dns` vaut `false` par défaut,
  mais la 0.26.1 échoue à la validation (« `dns.nameservers.global` must be set when
  `dns.override_local_dns` is true ») à moins que le bloc ne soit rendu explicite —
  la valeur nulle implicite par défaut ne s'est pas comportée comme documenté en
  pratique.

**MagicDNS est volontairement laissé désactivé.** L'activer exige que
`dns.base_domain` soit défini et réellement différent du domaine de `server_url`.
Comme `server_url` est injectée à l'exécution pour chaque déploiement, un unique
`base_domain` intégré ne peut pas satisfaire de manière fiable cette contrainte
pour tous les déploiements. Les clients obtiennent tout de même un adressage IP
Tailscale sans MagicDNS ; les opérateurs qui souhaitent des noms d'hôte basés sur
le DNS peuvent définir à la fois `base_domain` et `magic_dns=true` via
`environment_variables` après le déploiement.

Le relais DERP intégré est également laissé désactivé (`derp.server.enabled: false`,
la valeur par défaut amont) — les clients s'appuient sur l'infrastructure publique
de relais DERP de Tailscale pour le relais effectif des données lorsqu'une
connexion directe de pair à pair est impossible, ce qui maintient ce plan de
contrôle en HTTP(S) uniquement, sans besoin d'UDP.

---

## 6. Stockage — dépendant de la plateforme, et une vraie distinction en matière d'intégrité des données {#6-storage--platform-dependent-and-a-genuine-data-integrity-distinction}

La base SQLite de Headscale exige un véritable verrouillage de fichiers POSIX pour
ses fichiers WAL/journal :

- **Cloud Run :** `enable_gcs_storage_volume = true` systématiquement —
  `/var/lib/headscale` est monté via GCS Fuse. Il s'agit d'un compromis réel,
  confirmé en conditions réelles : gcsfuse ne prend pas en charge de manière
  fiable le verrouillage de fichiers dont a besoin le mode WAL de SQLite (confirmé
  par des entrées de journal `BufferedWriteHandler.OutOfOrderError` répétées pour
  `db.sqlite`/`db.sqlite-wal`/`db.sqlite-shm`, avec repli sur un chemin d'écriture
  hérité plus lent). Ce n'est acceptable ici que parce que `max_instance_count`
  est épinglé de manière stricte à `1` — aucune correction n'est possible sur
  Cloud Run lui-même (il n'y existe pas d'alternative de volume en mode bloc).
- **GKE :** `Headscale_GKE` définit par défaut `stateful_pvc_enabled = true`, et
  monte à la place un véritable PVC de stockage en mode bloc sur le même chemin.
  Le `main.tf` de `Headscale_GKE` définit
  `enable_gcs_storage_volume = !coalesce(var.stateful_pvc_enabled, false)`
  lorsqu'il appelle ce module, de sorte que le PVC et le montage GCS Fuse
  s'excluent mutuellement — ils ne sont jamais montés en double. Confirmé en
  conditions réelles : les journaux GKE sont totalement exempts des erreurs
  d'écriture gcsfuse observées sur Cloud Run.

---

## 7. Instance unique uniquement — codée en dur, et non simplement par défaut {#7-single-instance-only--hardcoded-not-merely-defaulted}

Le `locals.headscale_module.max_instance_count` de `Headscale_Common` est un
**`1` littéral**, indépendant de la valeur que contient la variable
`max_instance_count` de l'un ou l'autre Application Module — cette variable est
déclarée par cohérence avec les conventions et pour l'interface, mais sa valeur
n'est jamais lue ici. La documentation amont de Headscale confirme qu'il n'existe
aucune prise en charge intégrée de la haute disponibilité ni du mode actif-actif
(« if one goes down, the whole tailnet is unreachable »), et deux écrivains sur le
même fichier SQLite le corrompraient quel que soit le backend de stockage.
`min_instance_count`, en revanche, **est** transmis par l'appelant et vaut `0`
par défaut sur les deux plateformes — contrairement aux applications dotées d'une
base de données ou d'un index de recherche à préchauffer au démarrage, le fichier
SQLite et la clé WireGuard de Headscale rendent les démarrages à froid rapides.

---

## 8. Comportement des sondes de santé {#8-health-probe-behaviour}

Les sondes par défaut ciblent `/health` — un véritable endpoint non authentifié
que Headscale expose précisément à cette fin (confirmé en conditions réelles,
renvoyant HTTP 200 en même temps que « listening and serving HTTP » dans les
journaux de l'application).

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/health` | 15s | 10s | 10 |
| Vivacité | HTTP | `/health` | 30s | 30s | 3 |

---

## 9. La configuration initiale est une étape manuelle de l'opérateur, après le déploiement {#9-first-run-setup-is-a-manual-post-deploy-operator-step}

Headscale n'est livré avec aucun parcours d'inscription web ni aucun compte
administrateur par défaut. La création du premier « user » (espace de noms) et
l'émission d'une clé de pré-authentification pour enregistrer les nœuds clients
se font toutes deux via la CLI `headscale`, exécutée sur le même binaire
`/ko-app/headscale` que celui qu'utilise le service en cours d'exécution —
`headscale users
create <name>` suivi de `headscale preauthkeys create --user <name>`. Consultez
les sections Comportement de l'application des guides des plateformes et les labs
pratiques pour les mécanismes concrets de Cloud Run Job / `kubectl exec` sur
chaque plateforme.

---

Pour la configuration propre à Headscale et destinée aux utilisateurs (variables
par groupe, outputs et manière d'explorer chaque service depuis la console et la
CLI), consultez les guides des plateformes : **[Headscale_GKE](Headscale_GKE.md)**
et **[Headscale_CloudRun](Headscale_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Headscale sur Google Cloud Run](Headscale_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Headscale sur GKE Autopilot](Headscale_GKE.md) — cette configuration déployée sur GKE.
