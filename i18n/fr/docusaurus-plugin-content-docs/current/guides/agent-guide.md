---
title: "Guide de l'agent"
description: "Guide de l'agent de la plateforme RAD — partage de votre lien de parrainage, obtention de commissions en espèces sur les frais de module des utilisateurs parrainés, suivi sur Crédits → Ma commission, et fonctionnement des paiements."
---

<!-- translated-from: docs/guides/agent-guide.md @ 7d02aa0b sha256:ee601d09288b -->

# Guide de l'agent {#agent-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Agent_Guide.png" alt="Guide de l'agent" style={{maxWidth: "100%", borderRadius: "8px"}} />

Pour les partenaires de parrainage qui gagnent une commission en espèces lorsque les personnes qu'ils parrainent paient pour des déploiements de modules sur RAD. Agent est un rôle de vente. Nouveau sur RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

En tant qu'agent, votre rôle est axé sur le parrainage et la commission :

- Partagez votre lien de parrainage. Toute personne qui s'inscrit par son intermédiaire vous est liée.
- Gagnez une **commission en espèces** sur les frais de module que ces utilisateurs paient avec les crédits qu'ils ont achetés.
- Gagnez des **crédits bonus de parrainage** pour chaque inscription, sans limite mensuelle.
- Suivez chaque commission et chaque paiement qui vous est versé sur **Crédits → Ma commission**.

Un compte d'agent détient généralement aussi le rôle d'**Utilisateur**, celui avec lequel chaque inscription commence. Si le vôtre le fait, vous conservez tout ce qu'un utilisateur a : le déploiement de modules et de solutions, vos propres crédits et facturation, et vos déploiements. Voir [Utiliser RAD](using-rad.md).

## Obtenir le rôle d'agent {#getting-the-agent-role}

Un administrateur accorde le rôle sur la page **Utilisateurs**. Il ne peut être accordé que tant que les personnes peuvent payer sur la plateforme, ce qui signifie que le système de crédits est activé et qu'au moins un fournisseur de paiement (Stripe ou Flutterwave) est activé. Si les paiements sont désactivés, un agent n'a rien à gagner, donc la case à cocher reste verrouillée. Un agent existant conserve le rôle si les paiements sont désactivés ultérieurement.

Si Agent est votre seul rôle, vous atterrissez sur **Crédits**, sur l'onglet **Ma commission**, lorsque vous vous connectez. Si votre compte détient également le rôle d'Utilisateur ou de Formateur, vous atterrissez sur **Solutions** comme tout utilisateur, et votre commission est à un clic sur **Crédits → Ma commission**. Votre navigation supérieure comprend **Crédits**, **Tarification** et **Aide**, ainsi que les menus de tout autre rôle que vous détenez. (**Crédits** est masqué lorsque le système de crédits de la plateforme est désactivé.)

## Votre lien de parrainage {#your-referral-link}

Votre lien et votre code se trouvent sur votre **Profil** (ouvrez le menu de profil, en haut à droite), dans la section **Parrainer et gagner**. Si votre compte détient également le rôle d'Utilisateur ou de Partenaire, l'onglet **Transactions de crédits** sur **Crédits** a un bouton **Lien de parrainage** qui vous y mène. La carte **Inviter des amis** affiche votre code, un code QR, et les boutons **Copier le lien** et **Partager**. La carte apparaît chaque fois que le programme de parrainage est activé, y compris lorsque les parrainages sont illimités ; elle n'est masquée que lorsque la plateforme a désactivé le programme, et elle n'est jamais affichée aux comptes administrateurs.

Toute personne qui s'inscrit avec votre lien est liée à votre compte. Les auto-parrainages ne comptent pas, pas plus qu'une paire de comptes se parrainant mutuellement.

**Crédits bonus de parrainage.** Chaque inscription via votre lien ajoute des crédits de parrainage à votre solde. Les utilisateurs ordinaires ne les obtiennent que jusqu'à une limite mensuelle. **Les agents n'ont pas de limite mensuelle**, donc la carte indique le nombre de récompenses que vous avez gagnées ce mois-ci sans plafond ni barre de progression, et en dessous vos **parrainages récompensés de tous les temps**. Ce ne sont que des décomptes : RAD ne vous montre jamais qui sont les personnes que vous avez parrainées — ni leurs noms, ni leurs adresses e-mail. Ce sont des crédits *offerts* : vous pouvez les dépenser pour des déploiements, mais ce ne sont pas des commissions et ils ne sont jamais payés.

## Comment fonctionne la commission {#how-commission-works}

Vous gagnez une part des **frais de module** que vos utilisateurs parrainés paient **avec les crédits qu'ils ont achetés** (à partir d'un abonnement ou d'une recharge).

| Compte pour la commission | Ne compte jamais |
|---|---|
| Les frais propres à un module, y compris les frais du projet Google Cloud et des modules de services partagés que RAD configure en parallèle | Les frais de build (basés sur le temps) et l'utilisation du projet Google Cloud |
| La partie des frais payée avec des crédits achetés | La partie payée avec des crédits gratuits ou offerts (inscription, mensuels, parrainage, codes d'événement) |
| | La surtaxe pour les projets en libre-service |
| | Tout ce qui est dépensé dans une session de **lab** (formation) |
| | Tout ce qui est dépensé dans un **projet client** (un service géré par un abonné pour son client) |
| | Les abonnements et les achats de crédits eux-mêmes (vous gagnez lorsque les crédits sont *dépensés* pour les frais de module) |

- **Taux.** Fixé par la Finance en tant que *Part de revenu de l'agent* (15 % au moment de la rédaction), fixe sur chaque frais lorsqu'il est facturé. Un changement ultérieur du taux ne modifie jamais ce que vous avez déjà gagné.
- **Devise.** La commission est calculée en dollars américains à partir du prix catalogue des crédits. Par exemple, des frais de 100 crédits payés avec des crédits achetés, à 10 crédits par dollar et 15 %, rapportent **1,50 $**.
- **TVA.** Lorsqu'un utilisateur est facturé de la TVA, la commission est calculée sur les frais **avant** la TVA.
- **Moment.** Seuls les frais facturés **après** que la personne a été parrainée, et **pendant que vous déteniez le rôle d'agent**, comptent. Si votre rôle est supprimé, vous conservez ce que vous avez gagné pendant que vous l'aviez.
- **Les comptes désactivés ne gagnent rien.** Si votre compte est désactivé, aucune commission supplémentaire n'est enregistrée pour vous, et la commission déjà enregistrée est **retenue des paiements**. Elle reste sur votre relevé et n'est payée que si le compte est réactivé.

## Suivi de votre commission : Crédits → Ma commission {#tracking-your-commission-credits--my-commission}

L'onglet **Ma commission** est votre relevé.

- **Totaux** en haut : **Gagné**, **Annulé**, **En attente**, **Payable**, **En cours de paiement** et **Payé**.
- **Une ligne par commission** : date, module, frais de module, partie payée avec des crédits achetés, votre taux, la commission et son statut.
- Le **statut** vous indique où en est chaque commission :
  - **En attente jusqu'à** une date : chaque commission est retenue pendant **30 jours** avant de pouvoir être payée, afin qu'un frais remboursé ou contesté puisse être annulé en premier.
  - **Payable** : après la période de retenue, en attente du prochain paiement.
  - **En cours de paiement** : inclus dans un paiement que la Finance est en train d'effectuer.
  - **Payé** : inclus dans un paiement que la Finance a marqué comme payé.
  - **Annulé — non payé** / **Déduit du prochain paiement** : la Finance l'a annulé (par exemple, les frais ont été remboursés), avec la raison indiquée sur la ligne.
- **Vos paiements** liste chaque lot de paiement qui vous a été versé, marqué *payé* avec une date ou *en cours de paiement*.

## Comment vous êtes payé {#how-you-get-paid}

Les paiements sont effectués par la Finance par **lots**, en espèces, **en dehors de RAD** (par virement bancaire ou similaire) :

1. La Finance choisit une date limite et crée un lot. Elle prend tout ce qui est payable jusqu'à cette date et déduit les annulations.
2. Vous êtes inclus une fois que votre total payable atteint le **minimum de 50 $** et que RAD a reçu votre facture pour cela. Tout montant inférieur est reporté au lot suivant ; rien n'est perdu.
3. La Finance vous paie et marque le lot comme payé avec une référence de paiement. Votre relevé affiche alors ces commissions comme **Payées**.

Vous ne demandez pas les paiements vous-même. Si vous pensez qu'un paiement est manquant, ouvrez un ticket depuis l'onglet **Envoyer un message** sur **Aide**.

## Ce que vous ne pouvez pas faire {#what-you-cant-do}

Le rôle d'agent est délibérément restreint. En tant qu'agent, vous ne pouvez pas :

- Voir qui sont les utilisateurs que vous avez parrainés, ni leur activité, leurs déploiements, leurs soldes ou leurs paramètres. Vous voyez combien vous en avez parrainés ; votre relevé indique les frais et le module, jamais leur compte.
- Exécuter ou approuver des paiements, annuler des commissions, ou voir les chiffres d'autres agents.
- Publier ou gérer des modules, gérer des comptes d'utilisateurs, ou modifier les paramètres de la plateforme.
- Agir au nom d'un autre utilisateur. Il n'y a pas d'emprunt d'identité nulle part dans RAD.

## Obtenir de l'aide {#getting-help}

Visitez la page **Aide** et utilisez l'onglet **Envoyer un message** pour ouvrir un ticket de support ; l'onglet **Mes tickets** liste les tickets que vous avez ouverts et leur statut. Bien que les crédits puissent être achetés sur la plateforme, l'ouverture d'un ticket nécessite des crédits achetés sur votre compte ; lorsque les achats sont désactivés, n'importe qui peut en ouvrir un. Vous pouvez ouvrir jusqu'à 5 tickets toutes les 24 heures. Vous pouvez également accéder à l'aide via le lien **Contactez-nous** dans le pied de page.
