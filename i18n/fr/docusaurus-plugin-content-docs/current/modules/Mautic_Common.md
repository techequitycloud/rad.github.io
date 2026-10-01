---
title: "Mautic Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Mautic — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Mautic_Common.md @ 3055034 sha256:2ab4add9c866 -->

# Mautic Common — Configuration applicative partagée {#mautic-common--shared-application-configuration}

`Mautic_Common` est la **couche applicative partagée** de Mautic. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Mautic sur laquelle
s'appuient à la fois [Mautic_GKE](Mautic_GKE.md) et [Mautic_CloudRun](Mautic_CloudRun.md),
afin que les deux variantes de plateforme se comportent de façon identique là où cela
compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Mautic, consultez les
guides de plateforme ([Mautic_GKE](Mautic_GKE.md), [Mautic_CloudRun](Mautic_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Mautic_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère le mot de passe administrateur de Mautic et le stocke dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Fixe l'image officielle de Mautic (PHP/Apache) et le build qui l'étend | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Impose **Cloud SQL for MySQL 8.0** comme seul moteur pris en charge | §Database dans les guides de plateforme |
| Initialisation de la base de données | Définit le job du premier déploiement qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage objet | Déclare le bucket **Cloud Storage** des médias | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement Mautic de base (identité de l'administrateur, identité de l'expéditeur, migrations au démarrage, proxys de confiance) | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit le comportement par défaut des sondes de démarrage et de vivacité, y compris l'ajustement vers une sonde TCP sur Cloud Run | §Observability dans les guides de plateforme |

---

## 2. Identifiant administrateur dans Secret Manager {#2-admin-credential-in-secret-manager}

Le mot de passe de l'administrateur Mautic est généré automatiquement et stocké sous
forme de secret Secret Manager — il n'est jamais défini en clair. Récupérez-le après
le déploiement :

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~admin"
gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de plateforme
(`database_password_secret`). Voir [App_Common](App_Common.md) pour le modèle partagé
des secrets et de Workload Identity.

---

## 3. Moteur de base de données et initialisation {#3-database-engine-and-bootstrap}

Mautic nécessite **MySQL 8.0** ; le moteur est fixe et PostgreSQL n'est pas pris en
charge. Lors du premier déploiement, un job ponctuel se connecte à Cloud SQL via
l'Auth Proxy et, de façon idempotente :

1. crée la base de données Mautic (si elle n'existe pas),
2. crée l'utilisateur applicatif avec le mot de passe généré,
3. accorde à l'utilisateur tous les privilèges sur cette base de données.

Le job peut être relancé sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Mautic_Common` met en place l'environnement Mautic de base afin que l'application
démarre correctement dès le premier lancement :

- **Identité de l'administrateur** — l'identifiant et l'adresse e-mail de
  l'administrateur initial (configurables dans le groupe 23 du module de plateforme).
- **Identité de l'expéditeur** — le nom et l'adresse d'expédition des e-mails sortants
  (groupe 23). Utilisez un domaine doté d'enregistrements SPF/DKIM valides, sinon les
  e-mails de campagne seront rejetés ou marqués comme spam.
- **Migrations au démarrage** — Mautic exécute ses migrations de base de données à
  chaque démarrage d'instance, de sorte que les montées de version appliquent
  automatiquement les modifications de schéma.
- **Proxys de confiance** — Mautic est informé qu'il se trouve derrière un proxy, afin
  que les IP des clients et le schéma HTTPS soient respectés.

Ajustements propres à chaque plateforme gérés ici :

- **Cloud Run** fixe en outre l'URL publique du service et définit `HTTPS=on` afin que
  Mautic génère des liens absolus corrects et évite les boucles de redirection
  HTTP→HTTPS derrière le frontal de Cloud Run.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

La configuration de sonde de base de `Mautic_Common` cible la page de connexion de
Mautic, mais les **deux** modules de variante, `Mautic_CloudRun` et `Mautic_GKE`, la
détournent de ce chemin — pour deux raisons différentes :

- **Cloud Run** remplace la sonde de démarrage par une sonde **TCP** et la sonde de
  vivacité par une sonde HTTP `/healthz`, car le trafic de contrôle de santé de Cloud
  Run arrive en HTTP simple et Apache répond par une redirection 301 vers HTTPS dès que
  `HTTPS=on`/`MAUTIC_SITE_URL` sont définis ; une sonde HTTP ciblant
  `/index.php/s/login` n'obtiendrait donc jamais de 200. Une sonde TCP vérifie
  seulement que le port est ouvert et n'est pas affectée par la redirection ;
  `/healthz` est un fichier statique servi sans redirection.
- **GKE** remplace lui aussi les sondes de démarrage et de vivacité par HTTP
  `/healthz`, pour une autre raison : le trafic kube-probe interne au cluster atteint
  directement le conteneur (sans redirection), mais `/index.php/s/login` renvoie
  lui-même **HTTP 500** (la redirection vers l'installateur) tant que la base de
  données n'est pas configurée, si bien qu'une sonde sur la page de connexion échoue
  pendant la configuration de la base au premier démarrage, indépendamment des
  redirections. `/healthz` renvoie 200 quel que soit l'état de l'application.

---

## 6. Stockage objet {#6-object-storage}

Un bucket **Cloud Storage** dédié aux médias est déclaré ici et provisionné par le
socle, qui accorde également l'accès au compte de service de la charge de travail.
Associé au volume Filestore (NFS) partagé, il offre à Mautic un stockage durable des
médias, cohérent entre toutes les instances. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration de Mautic destinée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez les
guides de plateforme : **[Mautic_GKE](Mautic_GKE.md)** et **[Mautic_CloudRun](Mautic_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Mautic sur Google Cloud Run](Mautic_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Mautic sur GKE Autopilot](Mautic_GKE.md) — cette configuration déployée sur GKE.
