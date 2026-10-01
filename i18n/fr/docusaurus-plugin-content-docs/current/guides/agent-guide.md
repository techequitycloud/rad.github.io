---
title: "Guide de l'agent"
description: "Guide de l'agent de la plateforme RAD — partager votre lien de parrainage, percevoir une commission en argent sur les frais de module des utilisateurs parrainés, la suivre dans Credits → My Commission, et comprendre le fonctionnement des versements."
---
<!-- translated-from: docs/guides/agent-guide.md @ 6b90c32 sha256:4e747baa739e -->

# Guide de l'agent {#agent-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Agent_Guide.png" alt="Guide de l'agent" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide s'adresse aux apporteurs d'affaires qui perçoivent une commission en argent lorsque les personnes qu'ils ont parrainées paient des déploiements de modules sur RAD. Le rôle d'agent est un rôle commercial. Vous découvrez RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

En tant qu'**Agent**, votre rôle porte sur le parrainage et la commission :

- Partager votre lien de parrainage. Toute personne qui s'inscrit par ce lien vous est rattachée.
- Percevoir une **commission en argent** sur les frais de module que ces utilisateurs paient avec des crédits qu'ils ont achetés.
- Gagner des **crédits de bonus de parrainage** pour chaque inscription, sans limite mensuelle.
- Suivre chaque commission, et chaque versement qui vous est fait, dans **Credits → My Commission**.

Le compte d'un agent détient généralement aussi le rôle **User** (utilisateur), celui avec lequel toute inscription commence. Si c'est votre cas, vous conservez tout ce dont dispose un utilisateur : déployer des modules et des solutions, vos propres crédits et votre facturation, et vos déploiements. Voir [Utiliser RAD](using-rad.md).

## Obtenir le rôle d'agent {#getting-the-agent-role}

Un administrateur accorde ce rôle sur la page **Users**. Il ne peut être accordé que lorsque les paiements sont possibles sur la plateforme, c'est-à-dire lorsque le système de crédits est activé et qu'au moins un prestataire de paiement (Stripe ou Flutterwave) est activé. Lorsque les paiements sont désactivés, un agent n'a rien sur quoi gagner, et la case à cocher reste donc verrouillée. Un agent existant conserve son rôle si les paiements sont ensuite désactivés.

Si **Agent** est votre seul rôle, vous arrivez sur **Credits** (crédits), dans l'onglet **My Commission**, lorsque vous vous connectez. Si votre compte détient également le rôle **User** ou **Trainer** (formateur), vous arrivez sur **Solutions** comme tout utilisateur, et votre commission n'est qu'à un clic, dans **Credits → My Commission**. Votre barre de navigation supérieure comprend **Credits** et **Help** (aide), ainsi que les menus de tout autre rôle que vous détenez. (**Credits** est masqué lorsque le système de crédits de la plateforme est désactivé.)

## Votre lien de parrainage {#your-referral-link}

Votre lien et votre code se trouvent dans votre **Profile** (profil ; ouvrez le menu du profil, en haut à droite), dans la section **Refer and earn** (parrainer et gagner). Si votre compte détient également le rôle **User** ou **Partner**, l'onglet **Credit Transactions** de **Credits** comporte un bouton **Referral link** qui vous y mène. La carte **Invite Friends** qui s'y trouve affiche votre code, un QR code, ainsi que les boutons **Copy Link** et **Share**. La carte apparaît dès que le programme de parrainage est activé, y compris lorsque les parrainages sont illimités ; elle n'est masquée que lorsque la plateforme a désactivé le programme, et elle n'est jamais affichée aux comptes administrateur.

Toute personne qui s'inscrit avec votre lien est rattachée à votre compte. Les auto-parrainages ne comptent pas, pas plus qu'une paire de comptes qui se parrainent mutuellement.

**Crédits de bonus de parrainage.** Chaque inscription via votre lien ajoute des crédits de parrainage à votre solde. Les utilisateurs ordinaires ne les obtiennent que dans la limite d'un plafond mensuel. **Les agents n'ont pas de limite mensuelle** : la carte affiche donc le nombre de récompenses gagnées ce mois-ci, sans plafond ni barre de progression. Il s'agit de crédits *offerts* : vous pouvez les dépenser en déploiements, mais ils ne constituent pas une commission et ne sont jamais versés.

## Fonctionnement de la commission {#how-commission-works}

Vous percevez une part des **frais de module** que vos utilisateurs parrainés paient **avec des crédits qu'ils ont achetés** (via un abonnement ou une recharge).

| Compte pour la commission | Ne compte jamais |
|---|---|
| Les frais propres à un module, y compris les frais des modules de projet Google Cloud et de services partagés que RAD met en place à côté | Les frais de build (basés sur la durée), et l'utilisation du projet Google Cloud |
| La partie des frais payée avec des crédits achetés | La partie payée avec des crédits gratuits ou offerts (inscription, mensuels, parrainage, codes d'événement) |
| | Le supplément pour projet en libre-service |
| | Tout ce qui est dépensé au sein d'une session de **lab** (formation) |
| | Tout ce qui est dépensé dans un **projet client** (le service géré d'un abonné pour son client) |
| | Les abonnements et les achats de crédits eux-mêmes (vous gagnez lorsque les crédits sont *dépensés* en frais de module) |

- **Taux.** Défini par l'équipe Finance sous le nom *Agent Revenue Share* (15 % au moment de la rédaction), et figé sur chaque frais au moment où il est facturé. Une modification ultérieure du taux ne change jamais ce que vous avez déjà gagné.
- **Devise.** La commission est calculée en dollars américains à partir du prix catalogue des crédits. Par exemple, des frais de 100 crédits payés avec des crédits achetés, à 10 crédits par dollar et 15 %, rapportent **$1.50**.
- **Calendrier.** Seuls comptent les frais facturés **après** le parrainage de la personne, et **pendant que vous déteniez le rôle d'agent**. Si votre rôle vous est retiré, vous conservez ce que vous avez gagné tant que vous le déteniez.
- **Les comptes désactivés ne gagnent rien.** Si votre compte est désactivé, aucune nouvelle commission n'est enregistrée pour vous, et la commission déjà enregistrée est **retenue sur les versements**. Elle reste sur votre relevé et n'est versée que si le compte est réactivé.

## Suivre votre commission : Credits → My Commission {#tracking-your-commission-credits--my-commission}

L'onglet **My Commission** est votre relevé.

- **Totaux** en haut : **Earned**, **Reversed**, **On hold**, **Payable**, **In payout** et **Paid**.
- **Une ligne par commission** : date, module, frais de module, partie payée avec des crédits achetés, votre taux, la commission et son statut.
- Le **statut** vous indique où en est chacune :
  - **On hold until** une date : chaque commission est retenue pendant **30 jours** avant de pouvoir être versée, afin que des frais remboursés ou contestés puissent d'abord être annulés.
  - **Payable** : la période de retenue est passée, en attente du prochain versement.
  - **In payout** : incluse dans un versement que l'équipe Finance est en train d'effectuer.
  - **Paid** : incluse dans un versement que l'équipe Finance a marqué comme payé.
  - **Reversed — not paid** / **Deducted from next payout** : l'équipe Finance l'a annulée (par exemple, les frais ont été remboursés), avec le motif affiché sur la ligne.
- **Your payouts** liste chaque lot de versement qui vous a payé, marqué *paid* avec une date, ou *being paid*.

## Comment vous êtes payé {#how-you-get-paid}

Les versements sont effectués par l'équipe Finance par **lots**, en argent, **en dehors de RAD** (par virement bancaire ou moyen similaire) :

1. L'équipe Finance choisit une date limite et crée un lot. Celui-ci reprend tout ce qui est payable jusqu'à cette date et déduit les éventuelles annulations.
2. Vous êtes inclus dès que votre total payable atteint le **minimum de $50** et que RAD a reçu votre facture correspondante. Tout montant inférieur est reporté au lot suivant ; rien n'est perdu.
3. L'équipe Finance vous paie et marque le lot comme payé avec une référence de paiement. Votre relevé affiche alors ces commissions comme **Paid**.

Vous ne demandez pas vous-même les versements. Si vous pensez qu'un versement manque, ouvrez un ticket depuis l'onglet **Send Message** de **Help**.

## Ce que vous ne pouvez pas faire {#what-you-cant-do}

Le rôle d'agent est volontairement restreint. En tant qu'agent, vous ne pouvez pas :

- Voir l'activité individuelle, les déploiements, les soldes ou les paramètres des utilisateurs que vous avez parrainés. Votre relevé affiche les frais et le module, jamais leur compte.
- Exécuter ou approuver des versements, annuler des commissions, ni voir les chiffres des autres agents.
- Publier ou gérer des modules, gérer des comptes utilisateur, ni modifier les paramètres de la plateforme.
- Agir au nom d'un autre utilisateur. Il n'existe nulle part dans RAD de fonction d'emprunt d'identité.

## Obtenir de l'aide {#getting-help}

Rendez-vous sur la page **Help** et utilisez l'onglet **Send Message** pour ouvrir un ticket de support ; l'onglet **My Tickets** liste les tickets que vous avez ouverts et leur statut. Tant que des crédits peuvent être achetés sur la plateforme, ouvrir un ticket nécessite des crédits achetés sur votre compte ; lorsque les achats sont désactivés, tout le monde peut en ouvrir un. Vous pouvez ouvrir jusqu'à 5 tickets sur toute période de 24 heures. Vous pouvez également accéder à Help depuis le lien **Contact Us** en pied de page.
