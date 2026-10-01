---
title: "Guide du partenaire"
description: "Guide du partenaire de la plateforme RAD — connecter votre dépôt GitHub, publier et synchroniser vos propres modules, et percevoir une part des revenus lorsque d'autres les déploient."
---
<!-- translated-from: docs/guides/partner-guide.md @ 6b90c32 sha256:9e4219d66209 -->

# Guide du partenaire {#partner-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Partner_Guide.png" alt="Guide du partenaire" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide s'adresse aux auteurs de modules qui publient leurs propres modules sur RAD et perçoivent une part des revenus lorsque d'autres les déploient. Vous découvrez RAD ? Commencez par [Utiliser RAD](using-rad.md).

Un partenaire est toujours aussi un utilisateur : tout ce qui est décrit dans [Utiliser RAD](using-rad.md) — connexion, navigation, déploiement, gestion des déploiements et crédits — s'applique donc également à vous. Ce guide couvre les fonctionnalités supplémentaires réservées aux partenaires.

> Le rôle **Partner** (partenaire) est attribué manuellement par un administrateur. Souscrire un abonnement vous donne des crédits, mais ne fait **pas** de vous un partenaire. Si vous avez besoin d'un accès partenaire, demandez-le à un administrateur.

## Ce que vous pouvez faire {#what-you-can-do}

- Connecter votre propre dépôt GitHub afin que RAD puisse lire vos modules.
- **Synchroniser** vos modules dans le catalogue depuis votre dépôt.
- Déployer gratuitement vos propres modules, aux côtés des modules de la plateforme et des modules publics des autres partenaires.
- Percevoir une part des revenus partenaire lorsque d'autres déploient vos modules, et consulter chaque versement que l'équipe Finance enregistre pour vous.

Après votre connexion, vous arrivez sur **Solutions**, sur **Build Solution with AI**, quel que soit votre solde. Votre barre de navigation supérieure affiche : **Credits** (crédits), **Sync** (synchronisation), **Deployments** (déploiements), **Solutions**, **Help** (aide). Le catalogue de modules se trouve sous **Solutions → Solution Catalog → RAD modules** ; il n'a plus sa propre entrée de menu. **Sync** n'apparaît qu'une fois que vous avez sélectionné un dépôt de modules dans votre profil — jusque-là, il est masqué dans le menu.

## Connecter votre dépôt GitHub {#connecting-your-github-repository}

Avant de pouvoir synchroniser quoi que ce soit, connectez le dépôt qui contient vos modules. Ouvrez le menu déroulant du profil (en haut à droite) et allez dans **Profile** (profil). Il y a deux étapes, et la seconde passe facilement inaperçue :

1. Sous **RAD Module Sync App**, cliquez sur **Install App** et installez l'application GitHub **RAD Module Sync** sur le dépôt (ou l'organisation) qui contient vos modules. L'application accorde à RAD un accès en lecture — aucun jeton d'accès personnel n'est nécessaire.
2. Sous **Partner Settings**, choisissez ce dépôt dans la liste déroulante **GitHub Repository** et cliquez sur **Update Repo**.

Tant que la seconde étape n'est pas effectuée, RAD ne sait pas quel dépôt est le vôtre : **Sync** reste masqué dans votre navigation et **Solutions → Solution Catalog → RAD modules** n'affiche aucun onglet Partner. Notez que laisser la liste déroulante sur **Use platform default** puis enregistrer *efface* votre dépôt au lieu d'en définir un.

> **Le déploiement de vos modules nécessite une étape de la part d'un administrateur.** L'application GitHub permet à RAD de *lire* vos modules afin qu'ils puissent être synchronisés et listés. Construire un déploiement de l'un de vos modules — par vous ou par quelqu'un d'autre — nécessite en plus un accès de déploiement à votre dépôt, qu'un administrateur configure pour chaque partenaire. Tant que ce n'est pas fait, un déploiement de votre module s'arrête avant même de commencer avec le message *« Deployment repository credentials are not configured »*. Demandez à un administrateur d'activer les déploiements pour votre dépôt lorsque vous êtes prêt à ce que vos modules soient déployés.

## Synchroniser vos modules {#syncing-your-modules}

Allez sur la page **Sync** pour intégrer vos modules au catalogue. Cette page est une console de synchronisation en lecture seule :

- Elle liste les modules valides trouvés dans votre dépôt connecté.
- Cliquez sur **Sync Now** pour actualiser le catalogue à partir de votre dépôt. Les modules synchronisés apparaissent dans le catalogue et peuvent être déployés par les utilisateurs.
- Pour mettre à jour un module, modifiez-le dans votre dépôt et relancez **Sync Now** — les modules sont gérés dans GitHub, pas modifiés dans RAD.
- Supprimer un module de votre dépôt puis resynchroniser le retire du catalogue. Vous ne pouvez agir que sur vos propres modules — jamais sur ceux d'un autre partenaire ni sur un module de la plateforme.

Si un dépôt ne peut pas être lu — l'application GitHub n'y est pas installée, ou il contient plus de répertoires de modules que la plateforme ne l'autorise — la page Sync nomme le dépôt et explique pourquoi. Les problèmes au sein d'un module individuel sont plus discrets : un module dont le fichier `variables.tf` ne peut pas être analysé est ignoré et laissé exactement en l'état, et un répertoire qui ne déclare aucune variable `public_access` est traité comme un utilitaire et n'est jamais listé. Un module dont le nom appartient déjà à un autre partenaire ou à un module de la plateforme n'est pas synchronisé non plus, de sorte qu'il ne peut jamais prendre la place de l'entrée de catalogue de quelqu'un d'autre. Aucun de ces cas ne vous est signalé : si un module que vous attendiez n'apparaît pas après une synchronisation, vérifiez son `variables.tf` et son nom dans votre dépôt.

## Comment vos modules apparaissent aux utilisateurs {#how-your-modules-appear-to-users}

Sous **Solutions → Solution Catalog → RAD modules**, vous voyez deux sous-onglets :

- **Partner modules** — les modules que vous avez publiés depuis votre propre dépôt. C'est votre espace de travail pour tester et itérer.
- **Platform modules** — les modules publiés par RAD, ainsi que les modules publics des autres partenaires.

Tous les autres utilisateurs voient un catalogue unique et combiné de modules publics. Chaque carte de module affiche la description, un lien vers la documentation, une note moyenne en étoiles, le nombre de fois où il a été déployé, et son prix : les frais de module (ou **Free module** s'il n'y en a pas) plus une estimation du build.

Déployer votre propre module vous dispense des **frais de module** — le coût en crédits propre au module n'est pas facturé lorsque vous le déployez vous-même. Le coût du build reste toutefois mesuré après le build et déduit de votre solde exactement comme pour tout le monde ; un auto-déploiement n'est donc pas entièrement gratuit.

## Percevoir des revenus {#earning-revenue}

Vous percevez une part des revenus partenaire lorsque d'autres utilisateurs déploient vos modules. Cette part est calculée uniquement sur le coût en crédits propre au module — le coût du build est exclu — et uniquement sur la partie de ce coût qu'un utilisateur a réglée avec des crédits **achetés** ; un déploiement entièrement réglé avec des crédits offerts ne vous rapporte donc rien. Un déploiement qu'un abonné effectue pour son client via **Client Projects** est payé depuis un portefeuille alimenté par des crédits achetés : il vous rapporte donc l'intégralité de votre part.

Suivez vos revenus sur la page **Credits**, dans l'onglet **Module Revenue**. Il n'existe plus de page Revenue distincte, ni d'onglet de parrainage pour les partenaires — les partenaires gagnent sur leurs modules, pas sur le parrainage. Les dates s'ouvrent sur les 7 derniers jours et le tableau se charge de lui-même ; modifiez-les si nécessaire, et utilisez le bouton d'actualisation pour recharger. Vous ne voyez que vos propres modules — il n'y a pas de sélecteur de partenaire. **Export to CSV** télécharge l'ensemble filtré complet, pas seulement la page affichée à l'écran. L'équipe Finance dispose également d'une vue à l'échelle de l'organisation sous **Billing → Module Revenue**.

Les revenus qui y sont affichés sont calculés au taux de partage des revenus en vigueur. Une fois que l'équipe Finance vous a payé pour une période, ce paiement est enregistré avec le taux et le montant **tels qu'ils étaient au moment du paiement** ; une modification ultérieure du taux ne change donc jamais ce qui vous a déjà été versé.

### Versements {#payouts}

L'équipe Finance paie les partenaires en dehors de RAD, puis enregistre chaque paiement dans RAD. Sous le tableau des revenus de **Module Revenue**, la section **Payouts** liste chaque paiement enregistré pour vous : la période couverte, les revenus de modules et les éventuels gains liés à des demandes de configuration qu'il comprend, le taux appliqué, la référence du paiement et la date à laquelle il a été effectué. S'il manque une période que vous attendiez, contactez l'équipe Finance via **Help → Send Message**.

### Demandes de configuration {#setup-requests}

Si l'équipe Finance vous désigne comme ingénieur sur la demande de configuration d'un client, vous percevez une part des revenus de cette demande une fois celle-ci terminée : **75 %** par défaut, la plateforme conservant 25 % (l'équipe Finance peut définir une part différente pour la plateforme). Vos gains de configuration terminée apparaissent dans le tableau **Setup support earnings** sous **Payouts** et sont inclus lorsque l'équipe Finance enregistre un versement. Il n'existe pas d'écran partenaire pour traiter les demandes de configuration elles-mêmes — c'est l'équipe Finance et les administrateurs qui les gèrent et désignent l'ingénieur.

### Crédits partenaire mensuels {#monthly-partner-credits}

Un administrateur ou l'équipe Finance peut vous attribuer une allocation mensuelle de crédits partenaire. Elle est ajoutée à vos crédits **offerts** le 1er de chaque mois, apparaît dans **Credit Transactions** sous le libellé **Partner award** et — comme tous les crédits offerts — expire à la réinitialisation mensuelle suivante.

## Coûts et factures {#costs-and-invoices}

Les coûts cloud et les factures de projet ne sont pas accessibles aux partenaires dans la console — les onglets **Module Costs** et **Project Invoices** de la page Credits, ainsi que toute la page Billing, sont réservés à l'équipe Finance et aux administrateurs. Si vous avez besoin du coût cloud GCP ou d'une facture pour un projet que vous possédez ou avez déployé, demandez-les à l'équipe Finance.

## Tâches courantes (comme tout utilisateur) {#everyday-tasks-same-as-any-user}

Elles fonctionnent exactement comme décrit dans [Utiliser RAD](using-rad.md) :

- **Solutions → Solution Catalog → RAD modules** — parcourez le catalogue, configurez avec le **Conversational Assistant** (votre mode par défaut) ou le **Configuration Form** guidé, puis lancez le déploiement.
- **Deployments** — suivez vos déploiements ; ouvrez-en un pour consulter **Outputs**, **Build Status** et l'historique des builds ; utilisez **Update**, **Delete** ou **Purge** ; et notez les modules.
- **Credits** — consultez votre solde et **Credit Transactions** (avec **Export CSV**), utilisez **Buy Credits** et gérez vos abonnements tant que la plateforme vend des crédits.

## Obtenir de l'aide {#getting-help}

Ouvrez la page **Help** et utilisez l'onglet **Send Message** pour contacter l'équipe de support ; vos tickets se trouvent dans l'onglet **My Tickets** juste à côté. Le calculateur **ROI**, qui permet d'estimer vos économies, est un onglet de la page **Credits**. Le lien **Contact Us** en pied de page mène également à Help.
