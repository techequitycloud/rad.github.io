---
title: "Guide de l'agent"
description: "Guide de l'agent de la plateforme RAD — partager votre lien de parrainage, gagner une commission en argent sur les frais de module des utilisateurs parrainés, la suivre sous Crédits → Ma commission, et comprendre le fonctionnement des règlements."
---

<!-- translated-from: docs/guides/agent-guide.md @ 2be24ed1 sha256:98acffef5929 -->

# Guide de l'agent {#agent-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Agent_Guide.png" alt="Guide de l'agent" style={{maxWidth: "100%", borderRadius: "8px"}} />

Destiné aux partenaires de parrainage qui perçoivent une commission en argent lorsque les personnes qu'ils ont parrainées paient pour des déploiements de modules sur RAD. L'agent est un rôle commercial. Vous découvrez RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

En tant qu'agent, votre rôle est axé sur le parrainage et les commissions :

- Partagez votre lien de parrainage. Toute personne qui s'inscrit par ce biais vous est rattachée.
- Percevez une **commission en argent** sur les frais de module que ces utilisateurs règlent avec des crédits qu'ils ont achetés.
- Obtenez des **crédits bonus de parrainage** pour chaque personne qui s'inscrit et qui, dans les 90 jours, réussit un build de création ou de mise à jour ou achète des crédits, sans aucune limite mensuelle.
- Suivez chaque commission, ainsi que chaque règlement qui vous est versé, sous **Credits → My Commission**.

Le compte d'un agent possède généralement aussi le rôle **User**, celui attribué par défaut à chaque inscription. Si c'est votre cas, vous conservez toutes les fonctionnalités d'un utilisateur : déployer des modules et des solutions, gérer vos propres crédits et votre facturation, ainsi que vos déploiements. Consultez [Utiliser RAD](using-rad.md).

## Obtenir le rôle d'agent {#getting-the-agent-role}

Un administrateur attribue ce rôle sur la page **Users**. Il ne peut être octroyé que tant que les utilisateurs ont la possibilité de payer sur la plateforme, c'est-à-dire lorsque le système de crédits est activé et qu'au moins un fournisseur de paiement (Stripe ou Flutterwave) est en service. Lorsque les paiements sont désactivés, un agent n'a aucun moyen de percevoir des gains, la case à cocher reste donc verrouillée. Un agent déjà en place conserve son rôle si les paiements sont ultérieurement désactivés.

Si Agent est votre unique rôle, vous arrivez sur **Credits**, dans l'onglet **My Commission**, dès votre connexion. Si votre compte dispose également du rôle User ou Trainer, vous arrivez sur **Solutions** comme n'importe quel utilisateur, et votre commission est accessible en un clic sous **Credits → My Commission**. Votre menu de navigation principal inclut **Credits**, **Pricing** et **Help**, ainsi que les menus de tout autre rôle qui vous est attribué. (**Credits** est masqué lorsque le système de crédits de la plateforme est désactivé.)

## Votre lien de parrainage {#your-referral-link}

Votre lien et votre code se trouvent sur votre **Profile** (ouvrez le menu de profil, en haut à droite), dans la section **Refer and earn**. Si votre compte détient également le rôle User ou Partner, l'onglet **Credit Transactions** sous **Credits** comporte un bouton **Referral link** qui vous y redirige. L'encart **Invite Friends** qui s'y trouve affiche votre code, un QR code ainsi que les boutons **Copy Link** et **Share**. Cet encart s'affiche chaque fois que le programme de parrainage est activé, y compris lorsque les parrainages sont illimités ; il n'est masqué que si la plateforme a désactivé le programme, et il n'est jamais présenté aux comptes administrateurs.

Toute personne qui s'inscrit à l'aide de votre lien est rattachée à votre compte. L'auto-parrainage n'est pas pris en compte, pas plus qu'une paire de comptes se parrainant mutuellement.

**Crédits bonus de parrainage.** Chaque personne inscrite via votre lien ajoute des crédits de parrainage à votre solde dès qu'un de ses builds réussit (création ou mise à jour) ou qu'elle achète des crédits, dans les 90 jours suivant son inscription. Les utilisateurs ordinaires ne reçoivent ces crédits que dans la limite d'un plafond mensuel. **Les agents ne sont soumis à aucune limite mensuelle** ; ainsi, l'encart affiche le nombre de récompenses gagnées ce mois-ci sans plafond ni barre de progression, et juste en dessous le total de vos **all-time rewarded referrals** (parrainages récompensés depuis le début). Il s'agit uniquement de nombres : RAD ne vous révèle jamais l'identité des personnes parrainées — ni leurs noms, ni leurs adresses e-mail. Ce sont des crédits *offerts* : vous pouvez les dépenser pour des déploiements, mais ils ne constituent pas une commission et ne sont jamais versés en argent.

## Fonctionnement des commissions {#how-commission-works}

Vous percevez une part des **frais de module** que les utilisateurs que vous avez parrainés règlent **avec des crédits achetés** (issus d'un abonnement ou d'une recharge).

| Pris en compte pour la commission | Jamais pris en compte |
|---|---|
| Les frais propres d'un module, y compris les frais fixes d'un projet Google Cloud ou d'un module de services partagés déployé seul (configurés sous une application, ils sont inclus dans son prix et n'entraînent aucuns frais supplémentaires) | Les débits liés aux builds (au temps passé) et l'utilisation du projet Google Cloud |
| La part des frais payée avec des crédits achetés | La part payée avec des crédits gratuits ou offerts (inscription, mensuels, parrainage, codes événementiels), ou avec des crédits octroyés par l'équipe financière de RAD |
| | Les frais dont RAD fait grâce, comme le premier déploiement gratuit d'un utilisateur |
| | La surcharge liée au projet en libre-service (self-serve project surcharge) |
| | Tout montant dépensé dans le cadre d'une session de **lab** (formation) |
| | Tout montant dépensé dans un **projet client** (un service géré par un abonné pour son client) |
| | Les abonnements et les achats de crédits en eux-mêmes (vous gagnez une commission lorsque les crédits sont *dépensés* pour des frais de module) |

- **Taux.** Fixé par l'équipe financière sous le nom de *Agent Revenue Share* (15 % au moment de la rédaction de ce document), déterminé sur chaque frais au moment où il est débité. Une modification ultérieure du taux ne modifie jamais ce que vous avez déjà gagné.
- **Devise.** La commission est calculée en dollars américains d'après le tarif de base des crédits. Par exemple, des frais de 100 crédits réglés avec des crédits achetés, à raison de 10 crédits par dollar et d'un taux de 15 %, rapportent **1,50 $**.
- **TVA.** Lorsqu'un utilisateur est soumis à la TVA, la commission est calculée sur les frais **hors** TVA.
- **Période de validité.** Seuls les frais facturés **après** le parrainage de la personne, et **pendant que vous déteniez le rôle d'agent**, sont pris en compte. Si votre rôle vous est retiré, vous conservez ce que vous avez gagné pendant que vous le possédiez.
- **Les comptes désactivés ne perçoivent rien.** Si votre compte est désactivé, plus aucune commission n'est enregistrée pour vous, et les commissions déjà enregistrées sont **bloquées et exclues des règlements**. Elles restent inscrites sur votre relevé et ne seront payées que si le compte est réactivé.

## Suivre vos commissions : Credits → My Commission {#tracking-your-commission-credits--my-commission}

L'onglet **My Commission** constitue votre relevé.

- **Totaux** en haut de page : **Earned**, **Reversed**, **On hold**, **Payable**, **In payout** et **Paid**.
- **Une ligne par commission** : date, module, frais de module, part payée avec des crédits achetés, votre taux, montant de la commission et son statut.
- Le **Statut** vous indique la situation de chacune :
  - **On hold until** (en attente jusqu'au) avec une date : chaque commission est retenue pendant **30 jours** avant de pouvoir être versée, afin qu'un frais remboursé ou contesté puisse d'abord être annulé.
  - **Payable** : le délai d'attente est écoulé, en attente du prochain règlement.
  - **In payout** : intégrée dans un lot de règlement en cours d'exécution par l'équipe financière.
  - **Paid** : intégrée dans un lot de règlement marqué comme payé par l'équipe financière.
  - **Reversed — not paid** / **Deducted from next payout** : annulée, avec le motif indiqué sur la ligne — par l'équipe financière (par exemple, les frais ont été remboursés), ou automatiquement lorsqu'un remboursement ou un rejet de débit (chargeback) du paiement de l'utilisateur laisse son solde acheté négatif pendant que la commission est encore en attente. Une commission déjà payée n'est jamais annulée automatiquement.
- **Your payouts** dresse la liste de chaque lot de règlement qui vous a été versé, avec la mention *paid* accompagnée d'une date ou *being paid*.

## Modalités de versement {#how-you-get-paid}

Les règlements sont effectués par l'équipe financière sous la forme de **lots**, en argent, **en dehors de RAD** (par virement bancaire ou équivalent) :

1. L'équipe financière définit une date limite et génère un lot. Elle rassemble tout ce qui est payable jusqu'à cette date et compense les éventuelles annulations.
2. Vous êtes inclus dès que votre total payable atteint le **minimum de 50 $** et que RAD a reçu votre facture correspondante. Tout montant inférieur est reporté au lot suivant ; rien n'est perdu.
3. L'équipe financière procède à votre règlement et marque le lot comme payé en indiquant une référence de paiement. Votre relevé affiche alors ces commissions avec le statut **Paid**.

Vous n'avez pas à demander de règlements vous-même. Si vous pensez qu'un règlement est manquant, ouvrez un ticket depuis l'onglet **Send Message** de la page **Help**.

## Ce que vous ne pouvez pas faire {#what-you-cant-do}

Le rôle d'agent est délibérément restreint. En tant qu'agent, vous ne pouvez pas :

- Voir qui sont les utilisateurs que vous avez parrainés, ni consulter leur activité, leurs déploiements, leurs soldes ou leurs paramètres. Vous visualisez uniquement le nombre de personnes parrainées ; votre relevé mentionne les frais et le module, jamais leur compte.
- Exécuter ou approuver des règlements, annuler des commissions, ni consulter les chiffres des autres agents.
- Publier ou gérer des modules, administrer les comptes d'utilisateurs ou modifier les paramètres de la plateforme.
- Agir au nom d'un autre utilisateur. L'emprunt d'identité n'existe nulle part dans RAD.

## Obtenir de l'aide {#getting-help}

Rendez-vous sur la page **Help** et utilisez l'onglet **Send Message** pour ouvrir un ticket de support ; l'onglet **My Tickets** regroupe les tickets que vous avez ouverts ainsi que leur statut. En tant qu'agent, vous disposez d'un rôle d'équipe (staff), ce qui vous permet d'ouvrir un ticket que vous ayez ou non acheté des crédits. Vous pouvez ouvrir jusqu'à 5 tickets par tranche de 24 heures. Vous pouvez également accéder à l'aide via le lien **Contact Us** situé dans le pied de page.
