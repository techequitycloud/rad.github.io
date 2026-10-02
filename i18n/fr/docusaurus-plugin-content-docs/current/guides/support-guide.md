---
title: "Guide de support"
description: "Guide de support de la plateforme RAD — gestion de la file d'attente des tickets de support et consultation des déploiements des clients dont les tickets ouverts vous sont attribués."
---

<!-- translated-from: docs/guides/support-guide.md @ 7d02aa0b sha256:06032422574d -->

# Guide de support {#support-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Support_Guide.png" alt="Guide de support" style={{maxWidth: "100%", borderRadius: "8px"}} />

Pour le personnel du service d'assistance qui trie les demandes de support et aide les utilisateurs sur RAD. Nouveau sur RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

- Gérer les tickets de support dans l'onglet **Support Tickets** (Tickets de support) de la page **Help** (Aide) — consulter les tickets créés via le formulaire d'aide, mettre à jour leur statut, ajouter des notes et les prendre en charge.
- Consulter les déploiements des clients dont les tickets ouverts vous sont attribués, sur la page **Deployments** (Déploiements).
- Restaurer la configuration d'un déploiement que la politique de rétention a marqué pour suppression, lorsque son propriétaire vous le demande.
- Créer votre propre ticket dans l'onglet **Send Message** (Envoyer un message) de la page **Help** (Aide).

Si le support est votre seul rôle, vous arrivez sur la page **Help** (Aide) lorsque vous vous connectez ; si votre compte détient également le rôle Utilisateur, Formateur ou Partenaire, vous arrivez sur **Solutions** comme tout utilisateur, et la file d'attente du support est à un clic sur **Help** (Aide). Votre navigation supérieure affiche **Deployments** (Déploiements), **Pricing** (Tarification) et **Help** (Aide), ainsi que **Credits** (Crédits) et **Solutions** si votre compte détient également le rôle Utilisateur. (**Support Tickets** est un onglet de la page Help, à côté de **Send Message** et **My Tickets**.) L'onglet **Setup Requests** (Demandes de configuration) ne fait pas partie du rôle Support — il contient les chiffres de revenus des partenaires, il est donc limité aux administrateurs et à la Finance.

## Gestion des tickets de support {#handling-support-tickets}

L'onglet **Support Tickets** (Tickets de support) de la page **Help** (Aide) est votre espace de travail principal.

1. Cliquez sur **Help** (Aide) dans la barre de navigation supérieure, puis ouvrez l'onglet **Support Tickets** (Tickets de support).
2. La liste s'ouvre sur les 7 derniers jours et se charge immédiatement. Pour consulter une période plus ancienne, modifiez les dates **From** (Du) et **To** (Au) et cliquez sur **Load Tickets** (Charger les tickets) ; les deux dates sont obligatoires et la plage ne peut pas dépasser 366 jours. Vous obtenez les 100 tickets les plus récents de cette plage, alors réduisez les dates si vous pensez qu'il vous manque des tickets plus anciens. Vous pouvez également filtrer par statut et par responsable (**All assignees** (Tous les responsables), **Assigned to me** (Attribué à moi), **Unassigned** (Non attribué)), et télécharger ce que vous consultez avec **Export CSV**. Chaque ticket contient ce qu'un utilisateur a soumis via le formulaire d'aide.
3. Ouvrez un ticket pour voir ses détails.
4. Mettez à jour le **statut** du ticket au fur et à mesure que vous le traitez :
   - **New** (Nouveau) — juste reçu, pas encore pris en charge.
   - **In progress** (En cours) — vous y travaillez activement.
   - **Resolved** (Résolu) — le problème a été traité.
   - **Closed** (Fermé) — le ticket est complet et ne nécessite aucune autre action.
5. **Add notes** (Ajouter des notes) pour enregistrer ce que vous avez trouvé, ce que vous avez conseillé ou les étapes que vous avez suivies. Les notes maintiennent l'historique du ticket clair pour vous et vos coéquipiers.
6. **Claim** (Prendre en charge) un ticket non attribué pour en prendre possession, ou **Release** (Libérer) un ticket que vous détenez si vous l'avez pris par erreur. La prise en charge est également ce qui vous donne accès aux déploiements de ce client. Vous ne pouvez prendre en charge qu'un ticket encore ouvert, et rouvrir qu'un ticket que vous détenez. Vous ne pouvez pas retirer un ticket à un autre agent ou en donner un à un collègue — demandez à un administrateur ou à l'équipe financière de le réaffecter. Pour être informé par e-mail lorsqu'un ticket vous est attribué, activez **Support ticket assigned to me** (Ticket de support attribué à moi) dans les paramètres de notification de votre **Profile** (Profil).

## D'où viennent les tickets {#where-tickets-come-from}

Les tickets sont créés à partir de la page **Help** (Aide).

- Sur la page **Help** (Aide), l'onglet **Send Message** (Envoyer un message) est un formulaire de contact. Lorsqu'un utilisateur le remplit et le soumet, RAD crée un ticket de support et envoie un e-mail à l'équipe de support.
- Le lien **Contact Us** (Nous contacter) dans le pied de page renvoie également à la page Help.

Lorsqu'un utilisateur demande comment vous joindre, dirigez-le vers **Help → Send Message** (Aide → Envoyer un message) (ou le lien de pied de page **Contact Us**). Tout ce qu'il soumet là apparaît pour vous dans l'onglet **Support Tickets** (Tickets de support). La création d'un ticket nécessite des crédits achetés (un abonnement ou une recharge) uniquement lorsque les crédits sont en vente — un utilisateur sans crédits se voit proposer d'acheter des crédits à la place. Lorsque les achats sont désactivés, n'importe qui peut créer un ticket. Chaque utilisateur peut créer jusqu'à 5 tickets en 24 heures.

Les utilisateurs peuvent suivre leurs propres tickets : l'onglet **My Tickets** (Mes tickets) de la page Help affiche chaque ticket qu'ils ont créé, du plus récent au plus ancien, avec son statut (**New**, **In progress**, **Resolved** ou **Closed**). Le statut que vous définissez est donc ce que le client voit. Vos **notes** sont internes et ne sont jamais montrées au client, pas plus que la personne à qui le ticket est attribué.

Un utilisateur peut également **withdraw** (retirer) un ticket qui n'est pas fermé, pour indiquer qu'aucun travail supplémentaire n'est nécessaire. Il se ferme immédiatement, et dans **Support Tickets**, le ticket étendu affiche **Withdrawn by the customer** (Retiré par le client) et la date. La fermeture met fin à l'accès de l'agent attribué aux déploiements de ce client, comme toute fermeture.

## Consultation des déploiements {#viewing-deployments}

La page **Deployments** (Déploiements) vous permet de consulter les déploiements lorsque vous aidez un utilisateur. Vous ne pouvez pas accéder à la console **Sync** du module — la gestion des modules est réservée aux administrateurs et aux partenaires.

1. Cliquez sur **Deployments** (Déploiements) dans la barre de navigation supérieure.
2. La vue est **limitée à vos propres tickets** : elle liste les déploiements des clients dont les tickets vous sont attribués et sont toujours **New** (Nouveau) ou **In progress** (En cours). La prise en charge d'un ticket est ce qui vous donne accès aux déploiements de ce client ; la résolution ou la fermeture de celui-ci supprime cet accès, et la réouverture du ticket le restaure. Si vous avez besoin d'un déploiement qui appartient au ticket de quelqu'un d'autre, demandez à l'agent qui le détient ou à un administrateur. Votre portée couvre au maximum 29 clients à la fois ; si vous détenez des tickets ouverts pour plus, résolvez ou libérez-en quelques-uns pour voir le reste. Si rien n'est dans votre portée et que le support est votre seul rôle, la page affiche **No deployments** (Aucun déploiement) et explique que les déploiements des clients apparaissent tant que leurs tickets ouverts vous sont attribués.
3. Chaque ligne affiche le module, l'ID du déploiement, l'évaluation par étoiles, qui l'a déployé, quand il a été créé, le temps qu'il a fallu, le statut et l'action. Il n'y a pas de colonne projet ou crédits — ouvrez le déploiement pour son projet, et son onglet **Builds** (Builds) pour ce que chaque build a consommé.
4. Ouvrez un déploiement pour voir son aperçu (avec les valeurs secrètes supprimées), le **Build Status** (Statut du build) (journaux en direct, avec les secrets masqués), les **Builds** (historique des builds) et, pour un déploiement de lab, son panneau de lab. L'onglet **Outputs** (Sorties) ne vous est pas accessible : les sorties peuvent contenir des chaînes de connexion et des identifiants générés, donc seuls le propriétaire du déploiement et les administrateurs peuvent les lire — comme pour les variables de configuration du déploiement et tous les identifiants générés par le module. Demandez à l'utilisateur toute valeur dont vous avez besoin.

Un déploiement **Deleted** (Supprimé) ne vous est listé que si sa configuration est l'une de celles que la politique de rétention a marqué pour suppression — le type que vous pouvez restaurer (voir ci-dessous) ; les autres enregistrements supprimés sont omis, car ils le sont pour toute personne qui ne peut pas agir dessus.

Utilisez l'ID de déploiement qu'un utilisateur vous donne pour trouver son déploiement spécifique et examiner son statut et ses journaux. L'ouverture du statut de déploiement, des journaux de build ou de l'historique des crédits d'un autre utilisateur est enregistrée dans le journal d'audit de la plateforme sous votre compte. C'est normal lorsque vous travaillez sur leur ticket — c'est pourquoi il est important de limiter les lectures aux tickets que vous détenez.

## Restauration d'une configuration marquée pour suppression {#restoring-a-configuration-marked-for-removal}

Lorsqu'un déploiement est inactif plus longtemps que la période de rétention, RAD marque sa **configuration** (ses paramètres enregistrés et son état Terraform) pour suppression et envoie un e-mail au propriétaire. L'e-mail leur indique de contacter le support s'ils veulent le conserver. Leurs ressources cloud ne sont pas affectées dans les deux cas.

Pour le restaurer :

1. Prenez en charge le ticket du client, afin que ses déploiements apparaissent dans votre vue.
2. Ouvrez le déploiement nommé dans le ticket. Une bannière indique **This deployment's configuration is scheduled for removal** (La configuration de ce déploiement est prévue pour suppression).
3. Sélectionnez **Restore** (Restaurer), avant la date indiquée dans l'e-mail du client.

La configuration revient à son état antérieur et reste dans RAD pour une autre période de rétention complète. Si les ressources du déploiement avaient déjà été supprimées avant d'être marquées, il reste un déploiement supprimé : la restauration conserve ses paramètres, elle ne recrée rien. Chaque restauration est enregistrée dans le journal d'audit sous votre compte. Une fois la date passée, la configuration est perdue et ne peut pas être restaurée.

## Ce que le support ne peut pas faire {#what-support-cant-do}

Pour définir clairement les attentes, le rôle Support **n'inclut pas** :

- La consultation ou la modification des comptes utilisateurs.
- La modification des crédits ou des rôles de quiconque.
- La connexion d'un dépôt GitHub ou la synchronisation de modules.
- La mise à jour, la suppression, la purge, l'annulation ou le redéploiement du déploiement de quelqu'un d'autre, ou la lecture de ses variables de configuration, de ses sorties ou de ses identifiants générés — ceux-ci restent avec le propriétaire du déploiement et les administrateurs. La restauration est limitée aux configurations que la politique de rétention a marquées pour suppression (voir ci-dessus) ; un déploiement **purged** (purgé) ne peut être restauré que par un administrateur.
- La consultation des déploiements à l'échelle de la plateforme — uniquement ceux des clients dont les tickets ouverts vous sont attribués.
- Les **Setup Requests** (Demandes de configuration) — les administrateurs et la Finance s'en occupent.
- Agir au nom d'un autre utilisateur — il n'y a pas d'emprunt d'identité dans RAD.

Si une demande nécessite l'une de ces actions, transmettez-la à un administrateur (ou à la Finance pour les ajustements de crédits).

## Obtenir de l'aide {#getting-help}

- Pour les bases de la plateforme — connexion, navigation, crédits et fonctionnement des déploiements — consultez [Utiliser RAD](using-rad.md).
- Pour vos propres questions, utilisez la page **Help** (Aide) : l'onglet **Send Message** (Envoyer un message) crée un ticket, qui arrive dans la même file d'attente de tickets de support que vous traitez. Vos propres tickets se trouvent dans l'onglet **My Tickets** (Mes tickets) à côté.
