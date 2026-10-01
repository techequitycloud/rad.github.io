---
title: "Guide du support"
description: "Guide du support de la plateforme RAD — traiter la file des tickets de support, et consulter les déploiements des clients dont les tickets ouverts vous sont attribués."
---
<!-- translated-from: docs/guides/support-guide.md @ 6b90c32 sha256:86fc42c22284 -->

# Guide du support {#support-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Support_Guide.png" alt="Guide du support" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide s'adresse au personnel du service d'assistance qui trie les demandes de support et accompagne les utilisateurs sur RAD. Vous découvrez RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

- Traiter les tickets de support dans l'onglet **Support Tickets** (tickets de support) de la page **Help** (aide) — consulter les tickets ouverts via le formulaire Help, mettre à jour leur statut, ajouter des notes et les prendre en charge.
- Consulter, sur la page **Deployments** (déploiements), les déploiements des clients dont les tickets ouverts vous sont attribués.
- Restaurer la configuration d'un déploiement que la politique de rétention a marquée pour suppression, lorsque son propriétaire vous le demande.
- Ouvrir votre propre ticket dans l'onglet **Send Message** de la page **Help**.

Après votre connexion, vous arrivez sur la page **Help**. Votre barre de navigation supérieure affiche **Deployments** et **Help**, ainsi que **Credits** et **Solutions** si votre compte détient également le rôle **User** (utilisateur). (**Support Tickets** est un onglet de la page Help, à côté de **Send Message** et **My Tickets**.) L'onglet **Setup Requests** ne fait pas partie du rôle **Support** — il contient des chiffres de revenus partenaire et est donc réservé aux administrateurs et à l'équipe Finance.

## Traiter les tickets de support {#handling-support-tickets}

L'onglet **Support Tickets** de la page **Help** est votre principal espace de travail.

1. Cliquez sur **Help** dans la barre de navigation supérieure, puis ouvrez l'onglet **Support Tickets**.
2. La liste s'ouvre sur les 7 derniers jours et se charge immédiatement. Pour remonter plus loin, modifiez les dates **From** et **To** et cliquez sur **Load Tickets** ; les deux dates sont obligatoires, et la plage ne peut pas dépasser 366 jours. Vous obtenez les 100 tickets les plus récents de cette plage : réduisez donc la plage de dates si vous pensez qu'il vous manque des tickets plus anciens. Vous pouvez également filtrer par statut et par personne assignée (**All assignees**, **Assigned to me**, **Unassigned**), et télécharger ce que vous consultez avec **Export CSV**. Chaque ticket reprend ce qu'un utilisateur a soumis via le formulaire Help.
3. Ouvrez un ticket pour en voir le détail.
4. Mettez à jour le **statut** du ticket au fil de votre traitement :
   - **New** — tout juste reçu, pas encore pris en charge.
   - **In progress** — vous êtes en train de le traiter.
   - **Resolved** — le problème a été réglé.
   - **Closed** — le ticket est terminé et ne nécessite aucune autre action.
5. **Ajoutez des notes** pour consigner ce que vous avez constaté, ce que vous avez conseillé ou les étapes que vous avez suivies. Les notes gardent l'historique du ticket clair pour vous et vos collègues.
6. Utilisez **Claim** sur un ticket non attribué pour le prendre en charge, ou **Release** sur un ticket que vous détenez si vous l'avez pris par erreur. C'est aussi la prise en charge qui vous donne accès aux déploiements de ce client. Vous ne pouvez prendre en charge qu'un ticket encore ouvert, et ne pouvez rouvrir qu'un ticket que vous détenez. Vous ne pouvez pas retirer un ticket à un autre agent ni en confier un à un collègue — demandez à un administrateur ou à l'équipe Finance de le réattribuer. Pour être averti par e-mail lorsqu'un ticket vous est attribué, activez **Support ticket assigned to me** dans les paramètres de notification de votre **Profile** (profil).

## D'où viennent les tickets {#where-tickets-come-from}

Les tickets sont créés depuis la page **Help**.

- Sur la page **Help**, l'onglet **Send Message** est un formulaire de contact. Lorsqu'un utilisateur le remplit et le soumet, RAD ouvre un ticket de support et envoie un e-mail à l'équipe de support.
- Le lien **Contact Us** en pied de page mène également à la page Help.

Lorsqu'un utilisateur vous demande comment vous joindre, orientez-le vers **Help → Send Message** (ou le lien **Contact Us** en pied de page). Tout ce qu'il y soumet apparaît pour vous dans l'onglet **Support Tickets**. Ouvrir un ticket nécessite des crédits achetés (un abonnement ou une recharge) uniquement lorsque des crédits sont en vente — un utilisateur qui n'en a aucun se voit proposer d'acheter des crédits à la place. Lorsque les achats sont désactivés, tout le monde peut ouvrir un ticket. Chaque utilisateur peut ouvrir jusqu'à 5 tickets sur 24 heures.

Les utilisateurs peuvent suivre leurs propres tickets : l'onglet **My Tickets** de la page Help affiche chaque ticket qu'ils ont ouvert, du plus récent au plus ancien, avec son statut (**New**, **In progress**, **Resolved** ou **Closed**). Le statut que vous définissez est donc ce que voit le client. Vos **notes** sont internes et ne sont jamais montrées au client, pas plus que la personne à qui le ticket est attribué.

Un utilisateur peut également **retirer** un ticket qui n'est pas clôturé, pour indiquer qu'aucun autre travail n'est nécessaire. Le ticket est clôturé immédiatement, et dans **Support Tickets**, le ticket déplié affiche **Withdrawn by the customer** ainsi que la date. Sa clôture met fin à l'accès de l'agent assigné aux déploiements de ce client, comme toute clôture.

## Consulter les déploiements {#viewing-deployments}

La page **Deployments** vous permet de rechercher des déploiements lorsque vous aidez un utilisateur. Vous ne pouvez pas accéder à la console **Sync** des modules — la gestion des modules est réservée aux administrateurs et aux partenaires.

1. Cliquez sur **Deployments** dans la barre de navigation supérieure.
2. La vue est **limitée à vos propres tickets** : elle liste les déploiements des clients dont les tickets vous sont attribués et sont encore **New** ou **In progress**. C'est la prise en charge d'un ticket qui vous donne accès aux déploiements de ce client ; le résoudre ou le clôturer vous retire cet accès, et rouvrir le ticket le rétablit. Si vous avez besoin d'un déploiement qui relève du ticket de quelqu'un d'autre, demandez à l'agent qui le détient ou à un administrateur. Votre périmètre couvre au maximum 29 clients à la fois ; si vous détenez des tickets ouverts pour davantage de clients, résolvez-en ou libérez-en certains pour voir les autres.
3. Chaque ligne affiche le module, l'ID du déploiement, la note en étoiles, qui l'a déployé, sa date de création, sa durée, son statut et l'action. Il n'y a pas de colonne projet ni crédits — ouvrez le déploiement pour voir son projet, et son onglet **Builds** pour ce que chaque build a consommé.
4. Ouvrez un déploiement pour voir sa vue d'ensemble (sans les valeurs secrètes), **Build Status** (journaux en direct, secrets masqués), **Builds** (historique des builds) et, pour un déploiement de lab, son panneau de lab. L'onglet **Outputs** ne vous est pas accessible : les sorties peuvent contenir des chaînes de connexion et des identifiants générés, de sorte que seuls le propriétaire du déploiement et les administrateurs peuvent les lire — de même que les variables de configuration du déploiement et tout identifiant généré par le module. Demandez à l'utilisateur toute valeur dont vous avez besoin à cet endroit.

Utilisez l'ID de déploiement que vous communique un utilisateur pour retrouver son déploiement et examiner son statut et ses journaux. Consulter le statut d'un déploiement, les journaux de build ou l'historique de crédits d'un autre utilisateur est enregistré dans la piste d'audit de la plateforme au nom de votre compte. C'est normal lorsque vous traitez son ticket — c'est précisément pourquoi il vaut la peine de limiter ces consultations aux tickets que vous détenez.

## Restaurer une configuration marquée pour suppression {#restoring-a-configuration-marked-for-removal}

Lorsqu'un déploiement est resté inactif plus longtemps que la période de rétention, RAD marque sa **configuration** (ses paramètres enregistrés et son état Terraform) pour suppression et envoie un e-mail au propriétaire. Cet e-mail lui indique de contacter le support s'il souhaite la conserver. Ses ressources cloud ne sont pas affectées dans un cas comme dans l'autre.

Pour la restaurer :

1. Prenez en charge le ticket du client, afin que ses déploiements apparaissent dans votre vue.
2. Ouvrez le déploiement mentionné dans le ticket. Une bannière indique **This deployment's configuration is scheduled for removal**.
3. Sélectionnez **Restore**, avant la date indiquée dans l'e-mail du client.

La configuration revient à son état antérieur et reste dans RAD pendant une nouvelle période de rétention complète. Si les ressources du déploiement avaient déjà été supprimées avant qu'il ne soit marqué, il reste un déploiement supprimé : la restauration conserve ses paramètres, elle ne recrée rien. Chaque restauration est enregistrée dans le journal d'audit au nom de votre compte. Une fois la date passée, la configuration a disparu et ne peut plus être restaurée.

## Ce que le support ne peut pas faire {#what-support-cant-do}

Pour clarifier les attentes, le rôle **Support** ne comprend **pas** :

- La consultation ou la modification des comptes utilisateur.
- La modification des crédits ou des rôles de qui que ce soit.
- La connexion d'un dépôt GitHub ou la synchronisation de modules.
- La mise à jour, la suppression, la purge, l'annulation ou le redéploiement du déploiement de quelqu'un d'autre, ni la lecture de ses variables de configuration, de ses sorties ou de ses identifiants générés — ceux-ci restent réservés au propriétaire du déploiement et aux administrateurs. La restauration se limite aux configurations que la politique de rétention a marquées pour suppression (voir ci-dessus) ; un déploiement **purgé** ne peut être restauré que par un administrateur.
- La consultation des déploiements à l'échelle de la plateforme — uniquement ceux des clients dont les tickets ouverts vous sont attribués.
- Les **Setup Requests** — ce sont les administrateurs et l'équipe Finance qui les traitent.
- Le fait d'agir au nom d'un autre utilisateur — il n'existe nulle part dans RAD de fonction d'emprunt d'identité.

Si une demande nécessite l'une de ces actions, transmettez-la à un administrateur (ou à l'équipe Finance pour les ajustements de crédits).

## Obtenir de l'aide {#getting-help}

- Pour les bases de la plateforme — connexion, navigation, crédits et fonctionnement des déploiements — consultez [Utiliser RAD](using-rad.md).
- Pour vos propres questions, utilisez la page **Help** : l'onglet **Send Message** ouvre un ticket, qui arrive dans la même file Support Tickets que celle que vous traitez. Vos propres tickets se trouvent dans l'onglet **My Tickets** juste à côté.
