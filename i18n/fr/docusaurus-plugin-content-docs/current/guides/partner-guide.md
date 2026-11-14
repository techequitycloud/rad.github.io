---
title: "Guide du partenaire"
description: "Guide du partenaire de la plateforme RAD — connexion de votre dépôt GitHub, publication et synchronisation de vos propres modules, et partage des revenus lorsque d'autres les déploient."
---

<!-- translated-from: docs/guides/partner-guide.md @ f38ac9d2 sha256:095759074b0a -->

# Guide du partenaire {#partner-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Partner_Guide.png" alt="Guide du partenaire" style={{maxWidth: "100%", borderRadius: "8px"}} />

Pour les auteurs de modules qui publient leurs propres modules sur RAD et perçoivent une part des revenus lorsque d'autres les déploient. Nouveau sur RAD ? Commencez par [Utiliser RAD](using-rad.md).

Un partenaire est toujours aussi un utilisateur, donc tout ce qui se trouve dans [Utiliser RAD](using-rad.md) — connexion, navigation, déploiement, gestion des déploiements et crédits — s'applique également à vous. Ce guide couvre les éléments supplémentaires que seuls les partenaires peuvent faire.

> Le rôle de partenaire est attribué manuellement par un administrateur. L'abonnement à un plan accorde des crédits mais ne fait **pas** de vous un partenaire. Si vous avez besoin d'un accès partenaire, demandez à un administrateur.

## Ce que vous pouvez faire {#what-you-can-do}

- Connecter votre propre dépôt GitHub afin que RAD puisse lire vos modules.
- **Synchroniser** vos modules dans le catalogue à partir de votre dépôt.
- Déployer vos propres modules gratuitement, aux côtés des modules de la plateforme et des modules publics d'autres partenaires.
- Gagner une part des revenus partenaires lorsque d'autres déploient vos modules, et voir chaque paiement que Finance enregistre pour vous.

Après vous être connecté, vous arrivez sur **Solutions**, sur **Build Solution with AI**, quel que soit votre solde. Votre navigation supérieure affiche : **Credits**, **Sync**, **Deployments**, **Solutions**, **Pricing**, **Help**. Le catalogue de modules se trouve sur **Solutions → Solution Catalog → RAD modules** ; il n'a plus sa propre entrée de menu. **Sync** n'apparaît qu'une fois que vous avez sélectionné un dépôt de modules dans votre profil — jusque-là, il est masqué du menu.

## Connexion de votre dépôt GitHub {#connecting-your-github-repository}

Avant de pouvoir synchroniser quoi que ce soit, connectez le dépôt qui contient vos modules. Ouvrez le menu déroulant de profil (en haut à droite) et allez dans **Profile**. Il y a deux étapes, et la seconde est facile à manquer :

1. Sous **RAD Module Sync App**, cliquez sur **Install App** et installez l'application GitHub **RAD Module Sync** sur le dépôt (ou l'organisation) qui contient vos modules. L'application accorde à RAD un accès en lecture — aucun jeton d'accès personnel n'est nécessaire.
2. Sous **Partner Settings**, choisissez ce dépôt dans le menu déroulant **GitHub Repository** et cliquez sur **Update Repo**.

Tant que la deuxième étape n'est pas terminée, RAD ne sait pas quel dépôt est le vôtre : **Sync** reste masqué de votre navigation et **Solutions → Solution Catalog → RAD modules** n'affiche aucun onglet Partner. Notez que laisser le menu déroulant sur **Use platform default** et enregistrer *efface* votre dépôt plutôt que d'en définir un.

> **Le déploiement de vos modules nécessite une étape de la part d'un administrateur.** L'application GitHub permet à RAD de *lire* vos modules afin qu'ils puissent être synchronisés et listés. La création d'un déploiement de l'un de vos modules — par vous ou par toute autre personne — nécessite en outre un accès au déploiement de votre dépôt, qu'un administrateur configure pour chaque partenaire. Tant qu'ils ne l'ont pas fait, un déploiement de votre module s'arrête avant de commencer avec *"Deployment repository credentials are not configured"*. Demandez à un administrateur d'activer les déploiements pour votre dépôt lorsque vous êtes prêt à ce que vos modules soient déployés.

## Synchronisation de vos modules {#syncing-your-modules}

Allez à la page **Sync** pour importer vos modules dans le catalogue. La page est une console de synchronisation en lecture seule :

- Elle liste les modules valides trouvés dans votre dépôt connecté.
- Cliquez sur **Sync Now** pour rafraîchir le catalogue à partir de votre dépôt. Les modules synchronisés apparaissent dans le catalogue pour que les utilisateurs puissent les déployer.
- Pour mettre à jour un module, modifiez-le dans votre dépôt et exécutez à nouveau **Sync Now** — les modules sont gérés dans GitHub, non édités dans RAD.
- La suppression d'un module de votre dépôt et sa resynchronisation le supprime du catalogue. Vous ne pouvez affecter que vos propres modules — jamais ceux d'un autre partenaire ou un module de la plateforme.

Si un dépôt ne peut pas être lu — l'application GitHub n'y est pas installée, ou il contient plus de répertoires de modules que la plateforme ne l'autorise — la page Sync nomme le dépôt et explique pourquoi. Les problèmes à l'intérieur d'un module individuel sont plus silencieux : un module dont le `variables.tf` ne peut pas être analysé est ignoré et laissé exactement tel quel, et un répertoire qui ne déclare aucune variable `public_access` est traité comme une aide et n'est jamais listé. Un module dont le nom appartient déjà à un autre partenaire ou à un module de la plateforme n'est pas non plus synchronisé, de sorte qu'il ne peut jamais prendre le contrôle de l'entrée de catalogue de quelqu'un d'autre. Aucun de ces problèmes ne vous est signalé, donc si un module que vous attendiez n'apparaît pas après une synchronisation, vérifiez son `variables.tf` et son nom dans votre dépôt.

## Comment vos modules apparaissent aux utilisateurs {#how-your-modules-appear-to-users}

Sur **Solutions → Solution Catalog → RAD modules**, vous voyez deux sous-onglets :

- **Partner modules** — les modules que vous avez publiés à partir de votre propre dépôt. C'est votre espace de travail pour les tests et les itérations.
- **Platform modules** — les modules publiés par RAD, ainsi que les modules publics d'autres partenaires.

Tous les autres voient un catalogue combiné unique de modules publics. Chaque carte de module affiche la description, un lien vers la documentation, une note moyenne en étoiles, le nombre de fois où il a été déployé et son prix : les frais de module (ou **Free module** s'il n'y en a pas) plus une estimation du build.

Le déploiement de votre propre module dispense des **frais de module** — le coût en crédits du module n'est pas facturé lorsque vous le déployez vous-même. Le temps de build est inclus dans le prix pour vous comme pour tout le monde, donc un auto-déploiement de votre propre module est gratuit, à l'exception des mises à jour au-delà de l'allocation mensuelle.

## Gagner des revenus {#earning-revenue}

Vous gagnez une part des revenus partenaires lorsque d'autres utilisateurs déploient vos modules. La part est calculée uniquement sur le coût en crédits du module — le coût de build est exclu — et uniquement sur la partie de ce coût qu'un utilisateur a payée avec des crédits **achetés**, de sorte qu'un déploiement entièrement réglé à partir de crédits offerts ne vous rapporte rien. Lorsque le client est assujetti à la TVA, votre part est calculée sur les frais avant TVA. Un déploiement qu'un abonné effectue pour son client via **Client Projects** est payé à partir d'un portefeuille financé par des crédits achetés, il vous rapporte donc votre part en totalité.

Suivez-le sur la page **Credits**, sur l'onglet **Module Revenue**. Il n'y a plus de page Revenue séparée, ni d'onglet de parrainage pour les partenaires — les partenaires gagnent sur leurs modules, pas sur les parrainages. Les dates s'ouvrent sur les 7 derniers jours et le tableau se charge seul ; modifiez-les si vous en avez besoin, et utilisez le bouton de rafraîchissement pour recharger. Vous ne voyez que vos propres modules — il n'y a pas de sélecteur de partenaire. **Export to CSV** télécharge l'ensemble filtré, pas seulement la page affichée. Finance a également une vue à l'échelle de l'organisation sur **Billing → Module Revenue**.

Les revenus affichés sont calculés au taux de partage des revenus actuel. Une fois que Finance vous a payé pour une période, ce paiement est enregistré avec le taux et le montant **tels qu'ils étaient au moment où vous avez été payé**, de sorte qu'un changement ultérieur du taux ne modifie jamais ce que vous avez déjà été payé.

### Paiements {#payouts}

Finance paie les partenaires en dehors de RAD, puis enregistre chaque paiement dans RAD. Sous le tableau des revenus sur **Module Revenue**, la section **Payouts** liste chaque paiement enregistré pour vous : la période qu'il couvre, les revenus du module et les gains de demande de configuration qu'il contient, le taux utilisé, la référence du paiement et la date à laquelle il a été payé. Si une période que vous attendiez est manquante, contactez Finance via **Help → Send Message**.

### Demandes de configuration {#setup-requests}

Si Finance vous désigne comme l'ingénieur sur une demande de configuration d'un client, vous gagnez une part des revenus de cette demande lorsqu'elle est terminée : **75 %** par défaut, la plateforme conservant 25 % (Finance peut définir une part de plateforme différente). Vos gains de configuration terminés apparaissent dans le tableau **Setup support earnings** sous **Payouts** et sont inclus lorsque Finance enregistre un paiement. Il n'y a pas d'écran partenaire pour traiter les demandes de configuration elles-mêmes — Finance et les administrateurs les gèrent et attribuent l'ingénieur.

### Crédits partenaires mensuels {#monthly-partner-credits}

Un administrateur ou Finance peut vous accorder une allocation mensuelle de crédits partenaires. Elle est ajoutée à vos crédits **offerts** le 1er de chaque mois, apparaît dans **Credit Transactions** sous l'étiquette **Partner award**, et — comme tous les crédits offerts — expire au prochain réinitialisation mensuelle.

## Coûts et factures {#costs-and-invoices}

Les coûts cloud et les factures de projet ne sont pas disponibles pour les partenaires dans la console — les onglets **Module Costs** et **Project Invoices** sur la page Credits, et toute la page Billing, sont réservés à Finance et aux administrateurs. Si vous avez besoin du coût cloud GCP ou d'une facture pour un projet que vous possédez ou avez déployé, demandez à l'équipe Finance.

## Tâches quotidiennes (identiques à celles de tout utilisateur) {#everyday-tasks-same-as-any-user}

Celles-ci fonctionnent exactement comme décrit dans [Utiliser RAD](using-rad.md) :

- **Solutions → Solution Catalog → RAD modules** — parcourez le catalogue, configurez avec l'**Assistant conversationnel** (votre défaut) ou le **Formulaire de configuration** guidé, et lancez.
- **Deployments** — suivez vos déploiements ; ouvrez-en un pour les **Outputs**, le **Build Status** et l'historique de build ; **Update**, **Delete** ou **Purge** ; et évaluez les modules.
- **Credits** — affichez votre solde et les **Credit Transactions** (avec **Export CSV**), **Buy Credits** et gérez les abonnements pendant que la plateforme vend des crédits.

## Obtenir de l'aide {#getting-help}

Ouvrez la page **Help** et utilisez l'onglet **Send Message** pour contacter l'équipe de support ; vos tickets se trouvent sur l'onglet **My Tickets** à côté. En tant que partenaire, vous occupez un rôle de personnel, vous pouvez donc ouvrir un ticket sans crédits achetés. Le calculateur de **ROI**, pour estimer vos économies, est un onglet sur la page **Credits**. Le lien **Contact Us** dans le pied de page renvoie également à Help.
