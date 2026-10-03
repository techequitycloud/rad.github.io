---
title: "Guide des projets client"
description: "Guide des projets client de la plateforme RAD — exécuter des applications pour vos propres clients en tant que service géré : financer le portefeuille de chaque projet, inviter votre client, déployer pour lui, mettre en pause et supprimer, et transférer."
---

<!-- translated-from: docs/guides/client-projects-guide.md @ 15fd4c7 sha256:6613d2c8959d -->

# Guide des projets client {#client-projects-guide}

Pour les partenaires et les utilisateurs ayant acheté des crédits qui exécutent des applications sur RAD **pour leurs propres clients**, en tant que service géré. Nouveau sur RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

- Créez un **projet client** pour chaque client. Chacun a son propre **portefeuille** que vous financez à partir de vos crédits achetés, et tout ce que le projet coûte est payé à partir de ce portefeuille.
- Invitez votre client par e-mail. Il accepte depuis son propre compte RAD.
- Déployez des modules et des solutions **pour** votre client, en utilisant les formulaires de déploiement ordinaires. Les déploiements appartiennent à votre client, et vous les exécutez.
- Rechargez le portefeuille, ou reprenez les crédits inutilisés.
- Lorsque l'engagement se termine, **transférez le projet** à votre client, ou laissez-le se terminer.

Votre client ne paie jamais RAD pour un projet client. La façon dont votre client vous paie est convenue entre vous deux, en dehors de RAD.

## Obtenir l'accès {#getting-access}

Le démarrage d'un projet client nécessite des **crédits achetés** (une recharge ou un abonnement ; l'inscription gratuite, les crédits mensuels et de parrainage ne comptent pas) — les partenaires ont toujours accès. Achetez des crédits depuis **Crédits → Acheter des crédits**. Une fois qu'un projet existe, vous pouvez continuer à le gérer quel que soit votre solde : le déploiement, la recharge, le retrait, le transfert et la fin restent tous ouverts. Les projets client se trouvent sur **Solutions → Environnements gérés**, après le **Catalogue de solutions** (tant que la fonctionnalité est activée pour la plateforme), à côté des sessions de lab, et tout le monde peut l'ouvrir. Vos clients l'utilisent pour accepter votre invitation et pour voir les projets que vous exécutez pour eux.

## Créer un projet client {#creating-a-client-project}

Sur **Solutions → Environnements gérés**, filtrez sur **Projets client** et choisissez **Nouveau projet client** :

- **Nom du projet** : jusqu'à 100 caractères.
- **E-mail de votre client** : l'adresse que votre client utilise, ou utilisera, pour RAD. Ce ne peut pas être la vôtre.
- **Région** : l'une des régions de RAD. Tout ce qui se trouve dans le projet s'exécute ici, et cela ne peut pas être modifié ultérieurement.
- **Financer le portefeuille avec** : crédits prélevés sur vos crédits **achetés**. Les crédits gratuits qui vous ont été offerts ne peuvent pas être utilisés. Vous pouvez commencer à 0 et recharger plus tard.

RAD envoie un e-mail d'invitation à votre client. Si l'envoi a échoué, **Renvoyer l'invitation** le renvoie. Vous pouvez renvoyer une fois toutes les dix minutes.

## Votre client accepte {#your-client-accepts}

Votre client se connecte avec l'**adresse exacte que vous avez invitée**, crée un compte s'il n'en a pas, et confirme son adresse e-mail si RAD le demande. Sur **Solutions → Environnements gérés**, dans la vue **Exécuté pour vous**, il voit votre invitation sous **Invitations pour vous** et choisit **Accepter**.

Rien ne peut être déployé tant qu'il n'a pas accepté.

S'il ne le souhaite pas, il choisit **Refuser** à la place. Le projet est fermé, l'intégralité du portefeuille revient à vos crédits de recharge, et RAD vous envoie un e-mail. Vous pouvez l'inviter à nouveau avec un nouveau projet.

## Déployer pour votre client {#deploying-for-your-client}

Choisissez **Ouvrir / Déployer** sur un projet en cours d'exécution. Sa propre page affiche le portefeuille, ce qui a été dépensé, approximativement combien de jours le portefeuille couvre au taux actuel, et tout ce qui est déployé pour le client. Déployez depuis le panneau **Déployer pour** sur la même page :

- **Module**, **Solution de plateforme** ou **Solution personnalisée** : choisissez-en un et sélectionnez **Configurer**. Le formulaire de déploiement habituel s'ouvre.
- **Décrivez ce dont ils ont besoin à la place (Build Solution)** : répondez aux questions en langage clair. Il ne vous est pas demandé où il s'exécute ou où il se trouve, car un projet client décide déjà des deux.

Ce déploiement est pour votre client :

- le déploiement **appartient à votre client**, et vous le gérez ;
- il va dans le propre projet Google Cloud géré par RAD du projet, dans l'environnement de **production**, créé lors du premier déploiement ;
- il s'exécute dans la région du projet ;
- l'estimation des coûts et chaque vérification de solde utilisent le **portefeuille**, pas vos propres crédits.

La boîte de dialogue de confirmation nomme le portefeuille client qui paie, vérifiez-le avant de confirmer. **Déployer** couvre un déploiement : une fois qu'il est soumis, votre prochain déploiement est à nouveau le vôtre. Pour déployer autre chose pour le client, déployez à nouveau depuis la page de son projet. Revenir à **Environnements gérés** sans déployer annule également l'opération.

Le projet Google Cloud de votre client vous donne le même accès à la Console que votre client, afin que vous puissiez exploiter le service. Vous pouvez afficher, mettre à jour et supprimer les déploiements du projet, mais vous ne pouvez pas lire les valeurs secrètes qu'ils contiennent, telles que les mots de passe et les clés API. Celles-ci appartiennent à votre client.

Votre client peut voir ce que vous déployez pour lui, mais ne peut pas le modifier ou le supprimer tant que vous le gérez.

## Ce que le portefeuille paie {#what-the-wallet-pays-for}

Tout ce que le projet coûte est prélevé sur son portefeuille :

- **frais de module**. L'éditeur du module gagne sa part habituelle de ceux-ci ;
- **coûts de build** pour chaque déploiement, mise à jour et suppression ;
- les **coûts d'exécution de Google Cloud** du projet, mesurés à l'heure.

Si l'équipe financière de RAD a défini un taux de TVA pour vous, chaque prélèvement du portefeuille l'inclut, à **votre** taux, pas celui de votre client : vous financez le portefeuille, vous êtes donc le client.

Un premier build qui échoue n'est pas facturé. Google signale les coûts d'exécution un peu tard, de sorte que le portefeuille peut passer **en dessous de zéro** ; votre prochaine recharge couvrira cela en premier.

Le solde du portefeuille est affiché dans la vue **Projets client** et sur la page propre du projet. Dans votre historique de crédits, tout ce qui concerne un portefeuille est étiqueté **Portefeuille client** : les prélèvements payés à partir de celui-ci (sans solde propre à côté), et les crédits que vous y mettez ou en retirez, où le signe indique la direction.

### Recharger et retirer {#topping-up-and-withdrawing}

- **Recharger** : ajoute des crédits à partir de vos crédits achetés. Disponible tant que le projet n'est pas terminé.
- **Retirer** : renvoie les crédits inutilisés à vos crédits de recharge, qui n'expirent jamais. Disponible tant que le projet est en attente de votre client ou en cours d'exécution. Une fois que le projet a des coûts d'exécution, deux jours de ceux-ci restent dans le portefeuille : RAD met en pause un projet avec un jour ou moins restant, donc retirer plus désactiverait les services de votre client. Sans rien d'exécuté, vous pouvez tout retirer.

## Lorsque le portefeuille est faible {#when-the-wallet-runs-low}

Lorsqu'il reste environ **un jour** de coûts d'exécution, RAD **met en pause** le projet : la facturation est désactivée et tout est conservé. Vous et votre client recevez tous deux un e-mail.

Rechargez le portefeuille de manière à ce qu'il contienne au moins **deux jours** de coûts d'exécution, et le projet redémarrera de lui-même, généralement dans les 15 minutes.

Si un projet mis en pause n'est pas rechargé pendant la **période de pause** (définie par RAD, 7 jours sauf si votre administrateur l'a modifiée), il est **supprimé définitivement** :

- la veille, vous recevez un dernier avertissement par e-mail ;
- une fois supprimé, vous et votre client êtes tous deux informés ;
- quelques jours plus tard, lorsque les coûts finaux de Google sont connus, le portefeuille est réglé avec vous. Les crédits inutilisés retournent à vos crédits de recharge, et tout déficit est facturé sur vos crédits achetés.

Si vous avez désactivé les notifications de déploiement, RAD retient la suppression plutôt que de supprimer sans vous avertir.

## Transférer à votre client {#handing-over-to-your-client}

À la fin d'un engagement, vous pouvez transférer le projet. Il devient alors la propriété de votre client, et votre rôle prend fin. Seul un projet **en cours d'exécution** peut être transféré.

1. Choisissez **Transférer**, puis **Demander le transfert**. À partir de ce moment, rien de nouveau ne peut être déployé, tandis que le projet continue de fonctionner sur son portefeuille. Vous pouvez annuler la demande.
2. RAD attend que tous les coûts antérieurs à votre demande soient pris en compte : tout build en cours d'exécution est terminé et l'utilisation de Google pour la période a été signalée. Cela prend généralement moins d'une journée.
3. Choisissez **Terminer le transfert**. Si RAD est toujours en attente, il indique pourquoi ; réessayez plus tard.

Lorsque le transfert est terminé :

- les crédits de portefeuille inutilisés retournent à vos crédits de recharge, et tout déficit est facturé sur vos crédits achetés. Tout remboursement que vous accordez à votre client est convenu entre vous, en dehors de RAD ;
- les déploiements deviennent les déploiements ordinaires de votre client, payés à partir de **ses** crédits à partir de ce moment ;
- votre accès à ceux-ci, et votre accès à la Console à leur projet, prend fin.

Votre client a besoin de suffisamment de crédits **achetés** pour maintenir un projet de production en cours d'exécution. S'il n'en a pas, le transfert est refusé et RAD vous indique combien il en a besoin, alors demandez-lui d'acheter des crédits au préalable.

## Mettre fin à un projet {#ending-a-project}

Pour arrêter d'exécuter un projet sans le donner à votre client, choisissez **Terminer le projet** sur un projet invité, en cours d'exécution ou en pause, et confirmez. Cela fonctionne comme la fonction **Terminer maintenant** d'un lab :

1. Le projet passe à l'état **Terminaison**. Rien de nouveau ne peut être déployé, et RAD commence à supprimer ses déploiements : les applications d'abord, puis les services partagés et le projet Google Cloud lui-même. Rien n'est conservé.
2. Choisissez **Terminer la terminaison** pour accélérer le processus. Chaque fois, RAD supprime la partie suivante ou indique ce qu'il attend : une suppression toujours en cours, ou l'utilisation finale de Google pour le projet, qui arrive généralement dans la journée. Les builds de suppression sont payés par le portefeuille, comme tout autre build.
3. Quand il ne reste plus rien et que tous les coûts sont pris en compte, le projet se ferme. Les crédits de portefeuille inutilisés retournent à vos crédits de recharge, et tout déficit est facturé sur vos crédits achetés.

Un projet qui n'a jamais été déployé, comme celui que votre client n'a pas encore accepté, se ferme immédiatement. Un transfert en attente doit être annulé avant de pouvoir terminer le projet.

## Si votre solde est épuisé ou si votre abonnement prend fin {#if-your-balance-runs-out-or-your-subscription-ends}

Rien ne change pour les projets que vous exécutez déjà. Leur gestion ne dépend pas d'un abonnement ou de votre propre solde : chacun fonctionne sur son propre portefeuille, et vous pouvez déployer, recharger, retirer, transférer et le terminer comme avant. Vous n'avez besoin de crédits achetés que pour **démarrer** un nouveau projet client.

## Supervision {#oversight}

Les services financiers et les administrateurs voient tous les projets client sur la plateforme, en lecture seule, sous **Tous les projets client** sur le même onglet : qui l'exécute, pour quel client, son statut et son portefeuille. Ils ne peuvent pas modifier ou terminer un projet à partir de là.

## Obtenir de l'aide {#getting-help}

Utilisez **Aide → Envoyer un message** dans RAD pour ouvrir un ticket, et suivez-le sur l'onglet **Mes tickets** à côté.
