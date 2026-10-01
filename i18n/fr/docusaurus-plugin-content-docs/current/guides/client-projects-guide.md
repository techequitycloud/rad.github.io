---
title: "Guide des projets clients"
description: "Guide des projets clients de la plateforme RAD — exploiter des applications pour vos propres clients sous forme de service géré : alimenter le portefeuille de chaque projet, inviter votre client, déployer pour lui, mise en pause et suppression, et transfert."
---
<!-- translated-from: docs/guides/client-projects-guide.md @ 6b90c32 -->

# Guide des projets clients {#client-projects-guide}

Ce guide s'adresse aux partenaires et aux utilisateurs disposant de crédits achetés qui exploitent des applications sur RAD **pour leurs propres clients**, sous forme de service géré. Vous découvrez RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

- Créer un **projet client** pour chaque client. Chacun dispose de son propre **portefeuille**, que vous alimentez à partir de vos crédits achetés, et tout ce que coûte le projet est payé depuis ce portefeuille.
- Inviter votre client par e-mail. Il accepte depuis son propre compte RAD.
- Déployer des modules et des solutions **pour** votre client, à l'aide des formulaires de déploiement habituels. Les déploiements appartiennent à votre client, et c'est vous qui les exploitez.
- Recharger le portefeuille, ou récupérer les crédits inutilisés.
- À la fin de la mission, **transférer le projet** à votre client, ou y mettre fin.

Votre client ne paie jamais RAD pour un projet client. La manière dont votre client vous rémunère est convenue entre vous deux, en dehors de RAD.

## Obtenir l'accès {#getting-access}

Démarrer un projet client nécessite des **crédits achetés** (une recharge ou un abonnement ; les crédits gratuits d'inscription, mensuels et de parrainage ne comptent pas) — les partenaires y ont toujours accès. Achetez des crédits depuis **Credits → Buy Credits** (crédits → acheter des crédits). Une fois un projet créé, vous pouvez continuer à le gérer quel que soit votre solde : déployer, recharger, retirer, transférer et mettre fin restent possibles. Les projets clients se trouvent dans **Solutions → Managed Environments** (environnements gérés), après **Solution Catalog** (tant que la fonctionnalité est activée sur la plateforme), à côté des sessions de lab, et tout le monde peut l'ouvrir. Vos clients l'utilisent pour accepter votre invitation et voir les projets que vous exploitez pour eux.

## Créer un projet client {#creating-a-client-project}

Dans **Solutions → Managed Environments**, filtrez sur **Client projects** (projets clients) et choisissez **New client project** :

- **Project name** : jusqu'à 100 caractères.
- **Your client's email** : l'adresse que votre client utilise, ou utilisera, pour RAD. Il ne peut pas s'agir de la vôtre.
- **Region** : l'une des régions de RAD. Tout ce que contient le projet s'exécute dans cette région, et elle ne peut pas être modifiée ultérieurement.
- **Fund the wallet with** : des crédits prélevés sur vos crédits **achetés**. Les crédits gratuits qui vous ont été attribués ne peuvent pas être utilisés. Vous pouvez commencer à 0 et recharger plus tard.

RAD envoie une invitation par e-mail à votre client. Si elle n'a pas pu être envoyée, **Resend invitation** l'envoie de nouveau. Vous pouvez la renvoyer une fois toutes les dix minutes.

## Votre client accepte {#your-client-accepts}

Votre client se connecte avec **l'adresse exacte que vous avez invitée**, en créant un compte s'il n'en a pas, et confirme son adresse e-mail si RAD le lui demande. Dans **Solutions → Managed Environments**, dans la vue **Run for you**, il voit votre invitation sous **Invitations for you** et choisit **Accept**.

Rien ne peut être déployé tant qu'il n'a pas accepté.

S'il n'en veut pas, il choisit **Decline** à la place. Le projet est fermé, la totalité du portefeuille revient à vos crédits de recharge, et RAD vous envoie un e-mail. Vous pouvez l'inviter de nouveau avec un nouveau projet.

## Déployer pour votre client {#deploying-for-your-client}

Choisissez **Open / Deploy** sur un projet en cours d'exécution. Sa propre page affiche le portefeuille, ce qui a été dépensé, approximativement le nombre de jours que couvre le portefeuille au rythme actuel, et tout ce qui a été déployé pour le client. Déployez depuis le panneau **Deploy for** de cette même page :

- **Module**, **Platform solution** ou **Custom solution** : choisissez-en un et sélectionnez **Configure**. Le formulaire de déploiement habituel s'ouvre.
- **Describe what they need instead (Build Solution)** : répondez aux questions en langage courant. On ne vous demande ni où l'application s'exécute ni où elle réside, car un projet client décide déjà des deux.

Ce déploiement unique est destiné à votre client :

- le déploiement **appartient à votre client**, et c'est vous qui le gérez ;
- il est placé dans le projet Google Cloud géré par RAD propre au projet, dans l'environnement **production**, créé lors de votre premier déploiement ;
- il s'exécute dans la région du projet ;
- l'estimation des coûts et chaque vérification de solde utilisent le **portefeuille**, et non vos propres crédits.

La boîte de dialogue de confirmation indique le portefeuille client qui paie : vérifiez-le avant de confirmer. **Deploy** couvre un seul déploiement : une fois celui-ci soumis, votre déploiement suivant est de nouveau le vôtre. Pour déployer autre chose pour le client, déployez de nouveau depuis la page de son projet. Revenir à **Managed Environments** sans déployer l'annule également.

Le projet Google Cloud de votre client vous donne le même accès à la Console que celui de votre client, afin que vous puissiez exploiter le service. Vous pouvez consulter, mettre à jour et supprimer les déploiements du projet, mais vous ne pouvez pas lire les valeurs secrètes qu'ils contiennent, comme les mots de passe et les clés d'API. Celles-ci appartiennent à votre client.

Votre client peut voir ce que vous déployez pour lui, mais ne peut ni le modifier ni le supprimer tant que vous le gérez.

## Ce que paie le portefeuille {#what-the-wallet-pays-for}

Tout ce que coûte le projet est prélevé sur son portefeuille :

- les **frais de module**. L'éditeur du module perçoit sa part habituelle sur ces frais ;
- les **coûts de build** de chaque déploiement, mise à jour et suppression ;
- les **coûts d'exécution Google Cloud** du projet, mesurés toutes les heures.

Un premier build qui échoue n'est pas facturé. Google communique les coûts d'exécution avec un léger retard ; le portefeuille peut donc passer **sous zéro** ; votre prochaine recharge couvre d'abord ce découvert.

Le solde du portefeuille est affiché dans la vue **Client projects** et sur la page du projet. Dans votre historique de crédits, tout ce qui concerne un portefeuille est libellé **Client wallet** : les prélèvements effectués sur celui-ci (sans aucun solde personnel à côté), ainsi que les crédits que vous y versez ou en retirez, le signe indiquant le sens du mouvement.

### Recharger et retirer {#topping-up-and-withdrawing}

- **Top up** : ajoute des crédits prélevés sur vos crédits achetés. Disponible tant que le projet n'est pas terminé.
- **Withdraw** : restitue les crédits inutilisés à vos crédits de recharge, qui n'expirent jamais. Disponible tant que le projet attend votre client ou est en cours d'exécution. Dès que le projet engendre des coûts d'exécution, deux jours de ces coûts restent dans le portefeuille : RAD met en pause un projet auquel il reste un jour ou moins, si bien que retirer davantage éteindrait les services de votre client. Si rien ne s'exécute encore, vous pouvez tout retirer.

## Lorsque le portefeuille s'épuise {#when-the-wallet-runs-low}

Lorsqu'il reste environ **un jour** de coûts d'exécution, RAD **met en pause** le projet : la facturation est désactivée, et tout est conservé. Vous et votre client recevez tous deux un e-mail.

Rechargez de sorte que le portefeuille contienne au moins **deux jours** de coûts d'exécution, et le projet redémarre de lui-même, généralement en moins de 15 minutes.

Si un projet en pause n'est pas rechargé dans la **période de pause** (fixée par RAD, 7 jours sauf si votre administrateur l'a modifiée), il est **définitivement supprimé** :

- la veille, vous recevez un dernier avertissement par e-mail ;
- une fois la suppression effectuée, vous et votre client en êtes tous deux informés ;
- quelques jours plus tard, lorsque les coûts définitifs de Google sont connus, le portefeuille est soldé avec vous. Les crédits inutilisés reviennent à vos crédits de recharge, et tout manque est prélevé sur vos crédits achetés.

Si vous avez désactivé les notifications de déploiement, RAD suspend la suppression plutôt que de supprimer sans vous avertir.

## Transférer à votre client {#handing-over-to-your-client}

À la fin d'une mission, vous pouvez transférer le projet. Il devient alors la propriété de votre client, et votre rôle prend fin. Seul un projet **en cours d'exécution** peut être transféré.

1. Choisissez **Hand over**, puis **Request handover**. À partir de ce moment, plus rien de nouveau ne peut être déployé, tandis que le projet continue de fonctionner sur son portefeuille. Vous pouvez annuler la demande.
2. RAD attend que tous les coûts antérieurs à votre demande soient connus : tout build encore en cours est terminé et l'utilisation Google de la période a été communiquée. Cela prend généralement moins d'un jour.
3. Choisissez **Complete handover**. Si RAD attend encore, il indique ce qu'il attend ; réessayez plus tard.

Lorsque le transfert est terminé :

- les crédits inutilisés du portefeuille reviennent à vos crédits de recharge, et tout manque est prélevé sur vos crédits achetés. Tout remboursement que vous accordez à votre client est convenu entre vous, en dehors de RAD ;
- les déploiements deviennent des déploiements ordinaires de votre client, payés à partir de **ses** crédits dès lors ;
- votre accès à ceux-ci, ainsi que votre accès à la Console pour son projet, prend fin.

Votre client a besoin de suffisamment de crédits **achetés** pour maintenir un projet de production en fonctionnement. S'il n'en dispose pas, le transfert est refusé et RAD vous indique combien il lui en faut ; demandez-lui donc d'abord d'acheter des crédits.

## Mettre fin à un projet {#ending-a-project}

Pour cesser d'exploiter un projet sans le confier à votre client, choisissez **End project** sur un projet invité, en cours d'exécution ou en pause, puis confirmez. Cela fonctionne comme le **End now** d'un lab :

1. Le projet passe à l'état **Ending**. Plus rien de nouveau ne peut être déployé, et RAD commence à supprimer ses déploiements : d'abord les applications, puis les services partagés et le projet Google Cloud lui-même. Rien n'est conservé.
2. Choisissez **Finish ending** pour faire avancer le processus. À chaque fois, RAD supprime l'élément suivant ou indique ce qu'il attend : une suppression encore en cours, ou l'utilisation Google finale du projet, qui arrive généralement en moins d'un jour. Les builds de suppression sont payés depuis le portefeuille, comme tout autre build.
3. Lorsqu'il ne reste plus rien et que tous les coûts sont connus, le projet est fermé. Les crédits inutilisés du portefeuille reviennent à vos crédits de recharge, et tout manque est prélevé sur vos crédits achetés.

Un projet qui n'a jamais été déployé, comme un projet que votre client n'a pas encore accepté, est fermé immédiatement. Un transfert en attente doit être annulé avant de pouvoir mettre fin au projet.

## Si votre solde s'épuise ou si votre abonnement prend fin {#if-your-balance-runs-out-or-your-subscription-ends}

Rien ne change pour les projets que vous exploitez déjà. Leur gestion ne dépend ni d'un abonnement ni de votre propre solde : chacun fonctionne sur son propre portefeuille, et vous pouvez déployer, recharger, retirer, transférer et y mettre fin comme auparavant. Vous n'avez besoin de crédits achetés que pour **démarrer** un nouveau projet client.

## Supervision {#oversight}

L'équipe Finance et les administrateurs voient tous les projets clients de la plateforme, en lecture seule, sous **All client projects** dans le même onglet : qui l'exploite, pour quel client, son statut et son portefeuille. Ils ne peuvent ni modifier ni mettre fin à un projet depuis cet endroit.

## Obtenir de l'aide {#getting-help}

Utilisez **Help → Send Message** dans RAD pour ouvrir un ticket, et suivez-le dans l'onglet **My Tickets** situé à côté.
