---
title: "Mautic Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Mautic — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Mautic_Common.md @ 15fd4c7 sha256:8e9139f352e5 -->

# Mautic Common — Configuration d'application partagée {#mautic-common--shared-application-configuration}

`Mautic_Common` est la **couche d'application partagée** pour Mautic. Elle n'est pas déployée
seule ; elle fournit plutôt la configuration spécifique à Mautic sur laquelle
[Mautic_GKE](Mautic_GKE.md) et [Mautic_CloudRun](Mautic_CloudRun.md) s'appuient,
afin que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a pas d'entrées d'interface utilisateur de déploiement
propres — mais comprendre ce qu'elle fournit explique les valeurs par défaut que
vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Mautic, consultez les guides de
plateforme ([Mautic_GKE](Mautic_GKE.md), [Mautic_CloudRun](Mautic_CloudRun.md)) et
les guides de socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Mautic_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère le mot de passe administrateur Mautic et le stocke dans **Secret Manager** | Récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle l'image officielle de Mautic (PHP/Apache) et la build qui l'étend | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement qui crée la base de données, l'utilisateur et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket média **Cloud Storage** (provisionné mais inutilisé ; les téléchargements résident sur NFS) | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Mautic de base (identité administrateur, identité de l'expéditeur, migrations au démarrage, proxys de confiance) | Comportement de l'application dans les guides de plateforme |
| Sondes de santé | Fournit le comportement par défaut des sondes de démarrage/vivacité, y compris l'ajustement de la sonde TCP de Cloud Run | §Observabilité dans les guides de plateforme |

---

## 2. Identifiant administrateur dans Secret Manager {#2-admin-credential-in-secret-manager}

Le mot de passe administrateur Mautic est généré automatiquement et stocké comme
un secret Secret Manager — il n'est jamais défini en texte clair. Récupérez-le
après le déploiement :

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~admin"
gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le
socle ; son nom de secret est indiqué dans les sorties de déploiement de la
plateforme (`database_password_secret`). Voir [App_Common](App_Common.md) pour le secret
partagé et le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Mautic nécessite **MySQL 8.0** ; le moteur est fixe et PostgreSQL n'est pas
pris en charge. Lors du premier déploiement, un job unique se connecte à Cloud
SQL via le proxy d'authentification et de manière idempotente :

1. crée la base de données Mautic (si absente),
2. crée l'utilisateur de l'application avec le mot de passe généré,
3. accorde à l'utilisateur tous les privilèges sur cette base de données.

Le job peut être relancé en toute sécurité. Inspectez la base de données
directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les
sorties de déploiement de la plateforme.

---

## 4. Paramètres d'application de base {#4-core-application-settings}

`Mautic_Common` établit l'environnement Mautic de base afin que l'application
démarre correctement au premier lancement :

- **Identité administrateur** — le login et l'e-mail administrateur initiaux
  (configurable dans le groupe 23 du module de plateforme).
- **Identité de l'expéditeur** — le nom et l'adresse de l'expéditeur sortant
  (Groupe 23). Utilisez un domaine avec SPF/DKIM valide, sinon les e-mails de
  campagne seront rejetés ou marqués comme spam.
- **Migrations au démarrage** — Mautic exécute ses migrations de base de
  données à chaque démarrage d'instance, de sorte que les mises à niveau de
  version appliquent automatiquement les changements de schéma.
- **Proxys de confiance** — Mautic est informé qu'il se trouve derrière un
  proxy afin que les adresses IP des clients et le schéma HTTPS soient
  respectés.

Ajustements spécifiques à la plateforme gérés ici :

- **Cloud Run** épingle en outre l'URL du service public et définit `HTTPS=on`
  afin que Mautic génère des liens absolus corrects et évite les boucles de
  redirection HTTP→HTTPS derrière le frontal Cloud Run.

---

## 5. Comportement de la sonde de santé {#5-health-probe-behaviour}

La configuration de sonde de base de `Mautic_Common` cible la page de connexion de
Mautic, mais **les deux** modules variantes `Mautic_CloudRun` et `Mautic_GKE` la
remplacent par un autre chemin — pour deux raisons différentes :

- **Cloud Run** remplace la sonde de démarrage par **TCP** et la sonde de
  vivacité par HTTP `/healthz`, car le trafic de santé de Cloud Run arrive
  via HTTP simple et Apache répond avec une redirection 301 vers HTTPS une fois
  que `HTTPS=on`/`MAUTIC_SITE_URL` sont définis, de sorte qu'une sonde HTTP
  contre `/index.php/s/login` n'observerait jamais un 200. Une sonde TCP vérifie
  seulement que le port est ouvert et n'est pas affectée par la redirection ;
  `/healthz` est un fichier statique servi sans redirection.
- **GKE** remplace également les sondes de démarrage et de vivacité par HTTP
  `/healthz`, pour une raison différente : le trafic kube-probe
  intra-cluster atteint directement le conteneur (pas de redirection), mais
  `/index.php/s/login` lui-même renvoie **HTTP 500** (la redirection de
  l'installateur) tant que la base de données n'est pas configurée, de sorte
  qu'une sonde de page de connexion échoue lors de la configuration initiale de
  la base de données, indépendamment des redirections. `/healthz` renvoie
  200 indépendamment de l'état de l'application.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket `media` **Cloud Storage** est déclaré ici et provisionné par le
socle, mais rien dans le module ne le monte ou n'y écrit : les téléchargements
résident sur le volume Filestore (NFS) partagé à `/var/www/html/docroot/media/files`. Le bucket
est conservé uniquement parce que le supprimer d'un déploiement existant
déclenche un cycle de dépendance Terraform. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration spécifique à Mautic, orientée utilisateur (variables par
groupe, sorties et comment explorer chaque service depuis la Console et la CLI),
consultez les guides de plateforme : **[Mautic_GKE](Mautic_GKE.md)** et
**[Mautic_CloudRun](Mautic_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Mautic sur Google Cloud Run](Mautic_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Mautic sur GKE Autopilot](Mautic_GKE.md) — cette configuration déployée sur GKE.
