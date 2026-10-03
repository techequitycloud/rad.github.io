---
title: "Headscale Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Headscale — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Headscale_Common.md @ 15fd4c7 sha256:42fdf0fefc77 -->

# Headscale Common — Configuration d'application partagée {#headscale-common--shared-application-configuration}

`Headscale_Common` est la **couche d'application partagée** pour Headscale. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration spécifique à Headscale
sur laquelle s'appuient [Headscale_GKE](Headscale_GKE.md) et
[Headscale_CloudRun](Headscale_CloudRun.md), de sorte que les deux variantes
de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a
pas d'entrées d'interface utilisateur de déploiement propres — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez
dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Headscale, consultez les
guides de la plateforme ([Headscale_GKE](Headscale_GKE.md),
[Headscale_CloudRun](Headscale_CloudRun.md)) et les guides de base
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Headscale_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsule `headscale/headscale:<version>-debug` (une base construite avec `ko`) avec une `config.yaml` et un point d'entrée intégrés ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Corrige `database_type = "NONE"` — Headscale est entièrement basé sur SQLite embarqué | §Base de données dans les guides de la plateforme |
| Stockage | Déclare le bucket GCS `storage` et le montage `/var/lib/headscale`, que chaque variante désactive lorsqu'elle fournit son propre stockage (NFS sur Cloud Run, un PVC de bloc sur GKE) | Sortie `storage_buckets` |
| Application d'instance unique | Code en dur `max_instance_count = 1` dans le `config` assemblé — la valeur de la variable de l'appelant n'est jamais lue | Exécution et mise à l'échelle dans les guides de la plateforme |
| Configuration de base | `config.yaml` intégrée : backend SQLite, DERP embarqué désactivé, MagicDNS désactivé, les champs `noise.private_key_path`/`dns` requis par Headscale 0.26.1 | Comportement de l'application dans les guides de la plateforme |
| Vérifications de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/health` | §Observabilité dans les guides de la plateforme |
| Secrets | Aucun — `secret_ids`/`secret_values` sont tous deux des cartes vides | n/a |

---

## 2. Pas de secrets au niveau de l'application {#2-no-application-level-secrets}

Contrairement à la plupart des modules Common de ce catalogue, `Headscale_Common` ne
génère **aucun secret**. Il n'y a pas de mot de passe administrateur, de
jeton API ou de clé de chiffrement à gérer — Headscale n'a pas de connexion
web intégrée ni de magasin de justificatifs d'identité au niveau de
l'application. `secret_ids` et `secret_values` sont tous deux des cartes
vides, transmises telles quelles par les deux modules d'application.

---

## 3. Moteur de base de données — SQLite embarqué uniquement {#3-database-engine--embedded-sqlite-only}

`database_type = "NONE"` est fixé par `Headscale_Common` ; aucun autre backend de base de
données n'est pris en charge par ce module. Headscale conserve tout son état
persistant dans un seul fichier SQLite :

```
/var/lib/headscale/db.sqlite              # + -wal / -shm sidecars when WAL mode is on
/var/lib/headscale/noise_private.key      # Noise protocol (Tailscale v2) key, auto-generated
```

Il n'y a pas de job d'initialisation de base de données séparé — Headscale
crée et migre son propre schéma automatiquement au premier démarrage, de la
même manière qu'il le ferait sur un déploiement bare-metal ou VM.

---

## 4. Image de conteneur — base personnalisée construite avec `ko` avec un wrapper léger {#4-container-image--custom-ko-built-base-with-a-thin-wrapper}

Contrairement aux applications qui déploient une image officielle directement,
`Headscale_Common` définit `image_source = "custom"` et livre un léger `Dockerfile` :

```dockerfile
ARG HEADSCALE_VERSION=0.26.1
FROM headscale/headscale:${HEADSCALE_VERSION}-debug

COPY config.yaml /etc/headscale/config.yaml
COPY entrypoint.sh /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/busybox/busybox", "sh", "/entrypoint.sh"]
```

`HEADSCALE_VERSION` se résout en `0.26.1` épinglé lorsque
`application_version = "latest"` — l'ARG de construction propre au Dockerfile, distinct du
générique `APP_VERSION` que la Fondation injecte (ce qui forcerait
sinon le tag à l'inexistant `headscale:latest-debug`).

**Deux pièges réels, confirmés en direct, trouvés lors de la construction de
cette image — détectés via des tests Docker locaux avant même de toucher le
cloud, ce qui est en soi une méthodologie validée qui mérite d'être répétée
pour les futurs modules de construction personnalisée :**

1.  **Le tag `-debug` a été choisi pour son busybox intégré, mais ce
    busybox n'est toujours pas sur `PATH` comme `/bin/sh`.**
    Confirmé en direct : `docker run --entrypoint /bin/sh <image>` échoue avec "no such file or
    directory". Une étape de construction `RUN chmod +x` et un point
    d'entrée shebang `#!/bin/sh` échouent tous deux pour la même
    raison. La solution : invoquer directement le binaire `/busybox/busybox`
    de l'image — confirmé via `file` comme étant réellement lié
    statiquement (contrairement à d'autres images de base minimales ailleurs
    dans ce catalogue qui nécessitent un busybox greffé
    extérieurement) — via `ENTRYPOINT ["/busybox/busybox", "sh", "/entrypoint.sh"]`. Aucun `chmod` n'est
    nécessaire, car busybox interprète le chemin du script comme un argument
    plutôt que de l'exécuter comme un fichier.
2.  **Le vrai binaire Headscale se trouve à `/ko-app/headscale`, et non à
    `/usr/bin/headscale`.** L'image amont est construite avec l'outil `ko`
    de Google, qui utilise sa propre convention de placement de binaire
    plutôt qu'un `COPY` Dockerfile conventionnel. `entrypoint.sh`
    exécute `/ko-app/headscale serve` directement.

---

## 5. Configuration intégrée — deux champs requis par la version 0.26.1 que la documentation amont ne rend pas évidents {#5-baked-configuration--two-fields-0261-requires-that-upstream-docs-dont-make-obvious}

`scripts/config.yaml` est intégré à l'image au moment de la construction. Seuls
`server_url`/`listen_addr` varient réellement par déploiement, et les deux
sont remplacés à l'exécution via les variables d'environnement
`HEADSCALE_SERVER_URL`/`HEADSCALE_LISTEN_ADDR` (Headscale est construit sur Viper, qui lie
automatiquement les variables d'environnement en majuscules/soulignées aux
clés de configuration équivalentes). Deux champs ont dû être ajoutés au-delà
d'une lecture naïve de la documentation de Headscale, tous deux trouvés via
des tests locaux :

-   **`noise.private_key_path: /var/lib/headscale/noise_private.key`** — requis par le protocole Tailscale v2 Noise. Une clé
    manquante est normalement auto-générée, mais Headscale 0.26+ échoue
    directement à la validation de la configuration ("headscale now requires
    a new `noise.private_key_path` field") si le champ lui-même est absent du
    fichier, et pas seulement non défini.
-   **Un bloc `dns:` complet**, avec `magic_dns: false`, `override_local_dns:
  false` et
    `nameservers.global: [1.1.1.1, 1.0.0.1]` explicites. La documentation amont indique que
    `override_local_dns` est par défaut `false`, mais la version 0.26.1
    échoue à la validation ("`dns.nameservers.global` must be set when
    `dns.override_local_dns` is true") à moins que le bloc ne soit rendu explicite —
    la valeur par défaut implicite de zéro ne s'est pas comportée comme
    documenté en pratique.

**MagicDNS est délibérément désactivé.** L'activer nécessite que
`dns.base_domain` soit défini et réellement différent du domaine de
`server_url`. Puisque `server_url` est injecté par déploiement à
l'exécution, un seul `base_domain` intégré ne peut pas satisfaire de
manière fiable cette contrainte pour chaque déploiement. Les clients
obtiennent toujours l'adressage IP Tailscale sans MagicDNS ; les opérateurs
qui souhaitent des noms d'hôte basés sur DNS peuvent définir à la fois
`base_domain` et `magic_dns=true` via `environment_variables` après le
déploiement.

Le relais DERP embarqué est également désactivé (`derp.server.enabled: false`, la
valeur par défaut amont) — les clients s'appuient sur l'infrastructure de
relais DERP publique de Tailscale pour le relais de données réel lorsqu'une
connexion directe de pair à pair n'est pas possible, ce qui maintient ce
plan de contrôle uniquement HTTP(S) sans exigence UDP.

---

## 6. Stockage — dépendant de la plateforme, et une distinction réelle d'intégrité des données {#6-storage--platform-dependent-and-a-genuine-data-integrity-distinction}

La base de données SQLite de Headscale a besoin d'un véritable verrouillage
de fichier POSIX pour ses fichiers WAL/journal :

-   **Cloud Run :** `Headscale_CloudRun` monte le volume **NFS** partagé à
    `/var/lib/headscale` (`enable_nfs = true` par défaut) et passe
    `enable_gcs_storage_volume = !var.enable_nfs`, de sorte que le montage GCS Fuse n'est utilisé que si
    NFS est désactivé. GCS Fuse ne peut pas héberger SQLite du tout — il ne
    fournit ni verrouillage POSIX ni verrouillage de mémoire partagée, et
    une base de données écrite là-bas est corrompue à l'arrivée
    tandis que `/health` passe toujours. NFS fournit le verrouillage
    POSIX mais pas le mappage de mémoire partagée dont WAL a besoin, donc la
    variante Cloud Run définit également `sqlite_write_ahead_log = false` (exporté
    comme `HEADSCALE_DATABASE_SQLITE_WRITE_AHEAD_LOG`).
-   **GKE :** `Headscale_GKE` par défaut `stateful_pvc_enabled = true`, montant un
    véritable PVC de stockage de bloc au même chemin à la place.
    `Headscale_GKE`'s `main.tf` définit `enable_gcs_storage_volume = !coalesce(var.stateful_pvc_enabled, false)` lors de
    l'appel de ce module, de sorte que le PVC et le montage GCS Fuse sont
    mutuellement exclusifs — jamais doublement montés. WAL reste activé
    (`sqlite_write_ahead_log = stateful_pvc_enabled`), car un périphérique de bloc le prend en charge.

---

## 7. Instance unique uniquement — codée en dur, pas seulement par défaut {#7-single-instance-only--hardcoded-not-merely-defaulted}

Le `locals.headscale_module.max_instance_count` de `Headscale_Common` est un **littéral `1`**,
indépendant de la valeur que la variable `max_instance_count` de l'un ou l'autre
module d'application contient — cette variable est déclarée à des fins de
convention et d'interface utilisateur, mais sa valeur n'est jamais lue ici.
La propre documentation amont de Headscale confirme qu'il n'y a pas de
support HA/actif-actif intégré ("si l'un tombe en panne, l'ensemble du
tailnet est inaccessible"), et deux rédacteurs sur le même fichier SQLite le
corrompraient quel que soit le backend de stockage. `min_instance_count`, en
revanche, **est** transmis par l'appelant et est par défaut
`0` sur les deux plateformes — contrairement aux applications
avec une base de données ou un index de recherche à préchauffer au démarrage,
le fichier SQLite et la clé WireGuard de Headscale accélèrent les démarrages
à froid.

---

## 8. Comportement de la sonde de santé {#8-health-probe-behaviour}

Les sondes par défaut ciblent `/health` — un véritable point de
terminaison non authentifié que Headscale expose précisément à cette fin
(confirmé en direct renvoyant HTTP 200 avec "listening and serving HTTP" dans
les journaux de l'application).

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/health` | 15s | 10s | 10 |
| Vivacité | HTTP | `/health` | 30s | 30s | 3 |

---

## 9. La configuration initiale est une étape manuelle de l'opérateur après le déploiement {#9-first-run-setup-is-a-manual-post-deploy-operator-step}

Headscale n'est livré avec aucun flux d'inscription basé sur le web ni aucun
compte administrateur par défaut. La création du premier "utilisateur"
(espace de noms) et l'émission d'une clé de pré-authentification pour
l'enregistrement des nœuds clients se font via la CLI `headscale`,
exécutée avec le même binaire `/ko-app/headscale` que le service en cours
d'exécution utilise — `headscale users
create <name>` suivi de `headscale preauthkeys create --user <name>`. Voir les
sections Comportement de l'application des guides de la plateforme et les
labs pratiques pour les mécanismes concrets de Cloud Run Job / `kubectl exec`
sur chaque plateforme.

---

Pour la configuration spécifique à Headscale et destinée aux utilisateurs
(variables par groupe, sorties et comment explorer chaque service depuis la
Console et la CLI), consultez les guides de la plateforme :
**[Headscale_GKE](Headscale_GKE.md)** et
**[Headscale_CloudRun](Headscale_CloudRun.md)**.

## Guides associés {#related-guides}

-   [Headscale sur Google Cloud Run](Headscale_CloudRun.md) — cette
    configuration déployée sur Cloud Run.
-   [Headscale sur GKE Autopilot](Headscale_GKE.md) — cette configuration
    déployée sur GKE.
