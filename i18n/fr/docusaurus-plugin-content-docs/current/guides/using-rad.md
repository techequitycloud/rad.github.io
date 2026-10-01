---
title: "Utiliser RAD"
description: "Comment utiliser la plateforme RAD : connexion, navigation, rôles, déploiement de modules dans votre propre projet Google Cloud, crédits et facturation."
---
<!-- translated-from: docs/guides/using-rad.md @ 6b90c32 -->

# Utiliser RAD {#using-rad}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Using_RAD.png" alt="Utiliser RAD" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ceci est la présentation commune à toutes les personnes qui utilisent RAD. Elle couvre la connexion, l'orientation dans l'interface, les rôles et les concepts fondamentaux (modules, déploiements, crédits, facturation et assistance). Chaque guide de rôle renvoie ici pour les bases, puis se concentre sur ce que fait ce rôle.

---

## Qu'est-ce que RAD {#what-is-rad}

RAD (Rapid Application Deployment) est un portail web qui permet de déployer des modules Google Cloud prêts à l'emploi sans écrire de code d'infrastructure. Vous choisissez un module, remplissez un formulaire de configuration guidé, et la plateforme le provisionne pour vous sur Google Cloud.

L'utilisation est mesurée en **crédits** : la plupart des modules coûtent un nombre fixe de crédits à déployer, et votre solde est vérifié avant l'exécution d'un déploiement.

---

## Connexion {#signing-in}

1. Ouvrez la page de connexion de RAD et cliquez sur **Sign in with Google**. Google est le seul moyen de se connecter.
2. Choisissez votre compte Google.

Lors de votre première connexion, votre compte est créé automatiquement — il n'existe pas de page d'inscription distincte : l'inscription et la connexion se font avec le même bouton sur `/signin`, et toute page que vous ouvrez sans être connecté vous y renvoie. Les nouveaux comptes reçoivent le rôle **User** (utilisateur) et sont actifs immédiatement. Il vous est demandé d'accepter les conditions de la plateforme avant l'ouverture de la console ; cette acceptation est enregistrée sur votre compte, et elle vous est demandée de nouveau si les conditions sont mises à jour ultérieurement. Refuser vous laisse déconnecté plutôt que bloqué — **Sign out** reste disponible sur cet écran.

La page sur laquelle vous arrivez dépend de votre rôle. Les administrateurs arrivent sur **Users**, Finance sur **Billing** et Support sur **Help**, car chacun se connecte pour accomplir une tâche précise ; il en va de même pour un agent qui ne détient aucun autre rôle, sur **Credits → My Commission**. Les utilisateurs et les formateurs arrivent sur **Solutions** : sur **Solution Catalog** (sa vue **All**) si vous disposez de crédits achetés, sinon sur **Solution Catalog → RAD modules**. Un agent qui est aussi utilisateur ou formateur arrive au même endroit. Les partenaires arrivent sur **Build Solution with AI**. Si vous avez cliqué sur **Deploy** sur un module du catalogue public de la page de connexion avant de vous connecter, vous arrivez plutôt sur ce module, prêt à le déployer. (Si la plateforme fonctionne en mode privé, seules les personnes qui disposent déjà d'un compte RAD peuvent se connecter — la nouvelle inscription libre est désactivée ; demandez donc à un administrateur de créer votre compte si vous ne parvenez pas à entrer.)

Pour vous déconnecter, ouvrez le **menu déroulant du profil** en haut à droite et choisissez **Sign Out**.

---

## S'orienter dans l'interface {#finding-your-way-around}

La barre de navigation supérieure n'affiche que les éléments pertinents pour votre rôle (ou vos rôles). Où que vous soyez, vous trouverez :

- Un **menu déroulant du profil** (en haut à droite) avec **Your Profile** et **Sign Out**.
- Un lien **Contact Us** dans le pied de page, qui mène à la page **Help**, et un lien **Pricing** vers la page publique des tarifs.

Il n'existe pas de tableau de bord combiné distinct — chaque élément de la navigation supérieure est une page à part entière.

Après votre connexion, RAD vous amène sur la page adaptée à votre rôle :

- **User**, **Trainer** → **Solutions**, sur **Solution Catalog → All** si vous avez des crédits achetés, sinon sur **Solution Catalog → RAD modules**
- **Partner** → **Solutions**, sur **Build Solution with AI**
- **Admin** → **Users**
- **Finance** → **Billing**
- **Agent** → **Credits**, sur l'onglet **My Commission** — sauf si vous êtes aussi utilisateur ou formateur, auquel cas vous arrivez au même endroit qu'eux
- **Support** → **Help**
- Aucun rôle encore attribué → **Help**

---

## Les rôles en un coup d'œil {#roles-at-a-glance}

Vous pouvez détenir plusieurs rôles à la fois (par exemple Agent et Partner), et un **Partner est toujours aussi un User**. Les rôles sont attribués par un administrateur.

| Rôle | Ce qu'il fait | Page de départ |
| :--- | :--- | :--- |
| **User** (utilisateur) | Parcourt le catalogue, déploie et gère ses propres modules, gère ses crédits | Solutions |
| **Admin** (administrateur) | Tout ce que peut faire un utilisateur, plus l'administration complète de la plateforme : utilisateurs, paramètres, modules et supervision | Users |
| **Partner** (partenaire) | Un utilisateur qui publie aussi ses propres modules et en tire des revenus | Solutions |
| **Agent** | Un rôle commercial : perçoit une commission en argent sur les frais de module payés par les utilisateurs qu'il a parrainés | Credits → My Commission (Solutions s'il est aussi User ou Trainer) |
| **Finance** | Rapports financiers et versements : paliers d'abonnement, paramètres et attributions de crédits, codes d'événement, revenus, factures ; supervision des labs en lecture seule | Billing |
| **Support** | Trie les tickets de support ; voit les déploiements des clients dont les tickets ouverts lui sont attribués | Help |
| **Trainer** (formateur) | Anime des sessions de lab depuis **Solutions → Managed Environments** — un environnement de lab par participant — et gère les environnements qu'il a provisionnés ; dispose aussi de tout ce dont dispose un User | Solutions |

Consultez les guides de rôle à la fin pour la liste complète des tâches.

---

## Concepts fondamentaux {#core-concepts}

### Le catalogue de modules (Solutions → Solution Catalog → RAD modules) {#the-module-catalog-solutions--solution-catalog--rad-modules}

**RAD modules**, dans l'onglet **Solution Catalog** de **Solutions**, est le catalogue de modules. Chaque module apparaît sous forme de **carte** indiquant sa description, un lien vers la documentation, une note moyenne en étoiles, le nombre de fois où il a été déployé, et son prix : les **frais** uniques plus une estimation du **build**, présentés de la même manière sur chaque carte du catalogue.

Il existe deux types de modules :

- **Platform modules** (modules de plateforme) — publiés par RAD.
- **Partner modules** (modules partenaires) — publiés par des partenaires.

Si vous êtes partenaire, vous verrez deux onglets (vos propres **Partner modules** et **Platform modules**, qui inclut aussi les modules publics des autres partenaires). Tous les autres voient un catalogue unique et combiné des modules publics.

Vous pouvez **épingler** les modules que vous utilisez le plus pour qu'ils restent en haut, **rechercher** par nom, filtrer par **catégorie** à partir de la liste à côté de la grille, et parcourir le catalogue page par page. Une bande de statistiques en haut indique le nombre total de déploiements, votre solde de crédits (lorsque les crédits sont activés) et la durée de conservation de l'historique des déploiements.

### Déployer un module {#deploying-a-module}

1. Cliquez sur une carte de module, puis choisissez comment le configurer. Le **Conversational Assistant** (assistant conversationnel) est proposé par défaut à toute personne disposant de crédits achetés (toujours pour les partenaires) ; sans crédits achetés, le **Configuration Form** (formulaire de configuration) est proposé par défaut et l'assistant est affiché mais verrouillé jusqu'à ce que vous achetiez des crédits. Le **Configuration Form** est le formulaire guidé en plusieurs étapes — remplissez les champs, en utilisant **Next** pour passer d'une étape à l'autre. Le **Conversational Assistant** décrit chaque paramètre en un seul message et propose des modifications à mesure que vous décrivez ce que vous voulez ; vous appliquez vous-même chaque modification proposée, de sorte que rien n'est défini sans votre accord. Vous pouvez passer de l'un à l'autre à tout moment, et les deux produisent la même configuration.

   Il y a deux choses que l'assistant refuse délibérément de faire. Il ne voit ni ne définit jamais un **secret** (une clé d'API, un jeton ou un mot de passe) : il vous indique que le champ existe et vous saisissez la valeur dans la zone mise en évidence sur la page — jamais dans le chat, où elle serait envoyée au modèle et conservée dans la conversation. Et il n'accepte pas une valeur qui enfreint la règle propre à un champ ; il vous indique quelle est la règle et vous demande une valeur corrigée plutôt que de modifier discrètement ce que vous avez saisi. Il en va de même pour une région qu'un projet géré par RAD ne peut pas utiliser : il le signale et liste les régions autorisées.
2. Le formulaire s'ouvre avec un panneau **What will be deployed** (ce qui sera déployé) qui liste tout ce que le déploiement construit — dans un projet géré par RAD, le projet Google Cloud et les services partagés en plus de l'application — et indique pour chaque élément s'il est créé, mis à jour au préalable, ou s'il existe déjà et est réutilisé gratuitement. Une boîte de dialogue de confirmation apparaît si le module coûte des crédits, a des dépendances ou nécessite des autorisations particulières.
3. Cliquez sur **Deploy Module**. Le déploiement est mis en file d'attente puis provisionné, et RAD ouvre la page propre au nouveau déploiement sur son onglet **Build Status** afin que vous puissiez suivre son exécution. Si vous n'avez pas assez de crédits, RAD affiche le coût du module par rapport à votre solde et vous invite à recharger.

Sur la page **Deployments**, chaque ligne indique le module, l'identifiant du déploiement, une **note en étoiles** modifiable, sa date de création, sa durée, son statut et l'action disponible. Il n'y a pas de colonne projet ni de colonne crédits — ouvrez un déploiement pour voir son projet, et son onglet **Builds** pour voir ce que chaque build a consommé. Les administrateurs et le support voient une colonne supplémentaire indiquant qui l'a déployé. Les administrateurs peuvent basculer entre **All deployments** et **My deployments** ; le support n'a pas de bascule et ne voit que les déploiements des clients dont les tickets ouverts lui sont attribués, et non toute la plateforme ; tous les autres voient leurs propres déploiements.

Cliquez sur un déploiement pour ouvrir ses détails, qui comportent trois onglets :

- **Outputs** — les résultats non sensibles (comme les URL et les points de terminaison), affichés une fois que le déploiement a réussi et qu'il a des résultats à afficher.
- **Build Status** — les journaux en direct pendant l'exécution du déploiement. Une fois le déploiement réussi, **Explain this** ouvre un résumé en langage courant de ce qui a été créé dans votre projet Google Cloud ; sur une étape qui a échoué, **Search for a fix** et **Ask for help** s'appuient tous deux sur l'erreur affichée par cette étape. **Download** enregistre l'intégralité du journal dans un fichier texte, avec les secrets masqués.
- **Builds** — l'historique des builds de ce déploiement.

Depuis la vue détaillée, vous pouvez :

- **Update** — rouvrir le formulaire de configuration (prérempli) et réappliquer des modifications. Disponible une fois qu'un déploiement est terminé.
- **Delete** — choisissez **Delete** pour supprimer les ressources cloud, ou **Purge** pour retirer le déploiement de RAD *sans* détruire les ressources cloud (utile lorsqu'un déploiement est bloqué ou a été modifié en dehors de RAD). Un déploiement qui fait partie d'une solution ne peut être supprimé ou purgé que depuis la page de la solution. Un projet GCP géré par RAD (« GCP Project on RAD ») est supprimé de la même manière, mais comme cela emporte tout le projet, RAD refuse tant qu'un autre déploiement est encore en cours d'exécution dans ce projet et liste ceux à supprimer d'abord. Google conserve un projet supprimé récupérable pendant environ 30 jours.
- **Cancel** — libère un déploiement qui est encore à l'état Queued ou Waiting et dont le build n'a pas commencé, ou une purge qui est restée bloquée.

Les statuts de déploiement que vous pouvez rencontrer sont notamment Queued, Pending, Working, Waiting (en attente de la fin d'un déploiement prérequis), Success, Failure, Internal Error, Deleting, Deleted, Cancelled, Timeout et Expire.

### Solutions {#solutions}

**Solutions** regroupe tout ce que vous pouvez déployer, sur deux onglets — et c'est là qu'arrivent les utilisateurs, les partenaires et les formateurs après leur connexion (voir [Connexion](#signing-in)). Après ces deux onglets vient **Managed Environments** (environnements gérés) : les projets clients tant que la plateforme les propose (voir le [Guide des projets clients](client-projects-guide.md)) et, pour les formateurs, Finance et les administrateurs, les sessions de lab tant qu'elles sont activées. Sa vue **All** liste les deux ; les vues **Lab sessions** et **Client projects** ont chacune leur propre bouton de création (**New lab session**, **New client project**) pour les personnes autorisées à en créer.

- **Build Solution with AI** — répondez à quatre questions simples et RAD détermine quelles applications réalisent ce que vous avez décrit, chiffre l'ensemble et estime le temps nécessaire. **Build this** l'enregistre parmi vos solutions et l'ouvre, prête à être déployée. Commencez ici si vous savez ce que vous voulez accomplir sans savoir comment cela s'appelle. Elle est aussi accessible directement à l'adresse **/build**. Elle nécessite des crédits achetés (les partenaires y ont toujours accès) ; sans crédits achetés, l'onglet présente ce qu'elle fait, verrouillé, avec un bouton **Buy credits** tant que la plateforme vend des crédits.
- **Solution Catalog** — tout ce qui est prêt à être déployé, avec un filtre par type en haut (**All** · **My solutions** · **RAD solutions** · **RAD modules**) et un bouton **New solution** à côté, qui ouvre **Build Solution with AI**. **All** affiche tous les types sur une seule page, chacun sous son propre titre, en omettant tout type qui n'a rien à afficher ; la liste des catégories à côté de la grille n'apparaît que lorsqu'un seul type (**RAD solutions** ou **RAD modules**) est sélectionné, car les solutions et les modules utilisent des catégories différentes. La zone de recherche au-dessus des onglets recherche dans tout le Solution Catalog, et votre requête est conservée lorsque vous changez de type.
  - **My solutions** — les ensembles que vous avez composés vous-même. Décrivez ce que vous voulez construire, et RAD suggère des modules du catalogue avec une brève justification pour chacun. Ajoutez ceux que vous voulez, nommez l'ensemble et enregistrez-le. Vos solutions personnalisées sont privées, affichent **Draft** jusqu'à leur déploiement puis **Deployed**, et se déploient exactement par le même pipeline qu'une solution RAD. Lorsque deux membres n'ont aucune connexion connue entre eux, RAD l'indique sur la carte plutôt que de faire une supposition.
  - **RAD solutions** — des ensembles de modules prêts à l'emploi sélectionnés par RAD, regroupés par catégories. Chaque carte indique un coût combiné en crédits et une note moyenne calculée à partir des modules qu'elle contient.
  - **RAD modules** — le catalogue de modules décrit ci-dessus.

Les modules d'une solution sont regroupés en **vagues**, un ordre de déploiement approximatif — mais ce qui conditionne réellement le démarrage d'un membre, c'est sa véritable dépendance de configuration envers un autre membre : il attend uniquement que ce producteur précis ait terminé, et non toute sa vague nominale, de sorte que les membres sont fréquemment provisionnés simultanément, au sein d'une même vague comme d'une vague à l'autre. Le provisionnement d'une solution vous guide à travers un formulaire de configuration unique couvrant ses membres. Le **déploiement de solution** obtenu dispose de sa propre page de détails, où — comme pour un déploiement de module — vous pouvez le mettre à jour, le supprimer ou le purger.

### Crédits {#credits}

L'utilisation est mesurée en crédits, répartis en quatre soldes distincts :

- **Awards** (crédits offerts) — des crédits gratuits (inscription, mensuels, parrainage), réinitialisés chaque mois.
- **Event credits** (crédits d'événement) — des crédits gratuits obtenus avec un code lors d'un événement d'un partenaire RAD. Ils expirent à leur propre date.
- **Subscription** (abonnement) — des crédits issus d'une formule d'abonnement. Lorsque la plateforme est configurée pour les réinitialiser, un renouvellement remplace l'allocation au lieu de s'y ajouter.
- **Top-up** (recharge) — des crédits achetés directement, en une seule fois. Ils n'expirent jamais.

Les dépenses puisent d'abord dans les crédits offerts, puis dans les crédits d'événement, puis dans l'abonnement, puis dans la recharge, de sorte que les crédits qui expirent le plus tôt sont utilisés en premier. Votre **solde** correspond à l'ensemble de ces crédits et est vérifié avant chaque déploiement.

Déployer un module coûte les frais de ce module plus un coût de build. Les frais sont réservés lorsque vous confirmez et facturés lorsque le déploiement réussit pour la première fois ; le coût de build est mesuré selon la durée réelle d'exécution de chaque build et facturé une fois celui-ci terminé — le montant final peut donc légèrement différer de l'estimation affichée dans la boîte de dialogue de confirmation. Cette boîte de dialogue chiffre la chaîne ENTIÈRE — un déploiement dans un projet géré par RAD crée aussi votre projet Google Cloud privé et les services partagés qu'utilisent vos applications, et tous deux sont listés avec le total. Si le coût de build dépasse votre solde, le reliquat est reporté et réglé lors de votre prochain achat. Un partenaire qui déploie son propre module ne paie pas le coût du module, mais paie le coût de build. Une mise à jour ne facture que le coût de build. Une solution de trois modules ou plus bénéficie d'une remise groupée sur ses frais de module — par défaut 15 % pour trois ou quatre modules, 20 % pour cinq ou six, 25 % pour sept ou plus.

Vous choisissez les e-mails que RAD vous envoie sur votre page **Profile**. Désactiver les e-mails **Deployments** arrête tous les e-mails de déploiement, y compris l'avertissement que RAD envoie avant de supprimer définitivement quelque chose — ainsi, tant qu'ils sont désactivés, ces suppressions sont suspendues plutôt qu'effectuées sans avertissement. Voir le [Guide de l'utilisateur](user-guide.md#email-notifications).

Ce que coûte un déploiement **en échec** relève d'un paramètre de la plateforme, et non d'une règle fixe : Finance peut choisir, séparément pour le coût de build et pour les frais de module, si l'un ou l'autre est facturé lorsqu'un nouveau déploiement échoue ou est annulé. **Dans la version actuelle, aucun des deux n'est facturé : un déploiement en échec ne vous coûte donc rien.** Les mises à jour et suppressions en échec ne sont pas facturées non plus.

La page **Credits** comporte :

- Un onglet **Credit Transactions** — l'historique complet de vos crédits offerts, achats et dépenses, filtrable par déploiement et par date, avec **Export CSV**.
- Un onglet **Subscriptions** et un onglet **Buy Credits** — affichés uniquement tant que la plateforme vend des crédits (voir ci-dessous).
- Selon votre rôle, des onglets de revenus — **My Commission** (agents), **Module Revenue** (partenaires) — se trouvent également ici. Il n'existe pas de page Revenue distincte.
- Un onglet **Calculate ROI**, toujours en dernier — le calculateur décrit ci-dessous.

Pour acheter des crédits, choisissez une devise et un montant, sélectionnez un prestataire de paiement et finalisez le paiement sur la page sécurisée du prestataire. Vos crédits sont ajoutés automatiquement dès que le paiement est confirmé.

Certaines plateformes exigent des crédits *achetés* (et pas seulement des crédits offerts) pour certains déploiements — la boîte de dialogue de confirmation vous l'indiquera le cas échéant.

### Facturation et abonnements {#billing-and-subscriptions}

Les paiements sont traités par **Stripe** et **Flutterwave**. Vous choisissez le prestataire au moment du paiement ; ceux qui sont disponibles dépendent de votre devise et de ce que la plateforme a activé. Les prix sont affichés dans la devise que vous avez sélectionnée.

Les abonnements sont des formules récurrentes facultatives (« paliers ») qui accordent un nombre fixe de crédits à chaque cycle de facturation. Vous pouvez vous abonner, puis résilier ou réactiver à tout moment, mais vous ne pouvez détenir qu'un seul abonnement à la fois — pour passer à un autre palier, ou à un autre prestataire de paiement, résiliez d'abord l'abonnement en cours. Les abonnements accordent uniquement des crédits — ils n'accordent pas le rôle Partner, qu'un administrateur attribue manuellement.

La possibilité d'acheter quoi que ce soit dépend d'un seul commutateur de la plateforme, **Enable Subscription**. Tant qu'il est désactivé, il n'y a ni nouvel abonnement ni recharge ponctuelle, quel que soit le prestataire : les onglets **Subscriptions** et **Buy Credits** ne sont pas affichés et la page publique des tarifs ne liste aucune formule. Si vous détenez déjà un abonnement, un avis sur **Credit Transactions** vous permet toujours de le résilier.

### ROI {#roi}

L'onglet **Calculate ROI** de la page **Credits** est un outil d'estimation interactif. Il est prérempli avec votre activité récente et vous permet d'ajuster des hypothèses (comme le nombre de déploiements mensuels, le temps de déploiement manuel, le coût horaire d'un ingénieur et le pourcentage de temps gagné) afin d'estimer votre coût de main-d'œuvre, le coût de la plateforme, vos économies nettes et votre ROI. Ce n'est qu'un outil d'estimation — il ne déploie rien et ne facture rien.

### Coûts et factures {#costs-and-invoices}

Vous pouvez consulter vos propres dépenses sur la page **Credits**, de deux manières. **Credit Transactions** liste chaque crédit offert, achat et débit sur votre compte. **Project Transactions** — affiché dès que les crédits de projet sont activés — détaille la partie projet par projet Google Cloud, avec les crédits débités et le coût cloud sous-jacent pour chacun, sur une période que vous choisissez. Cet onglet existe parce qu'une facturation de projet arrive dans le registre sous la forme d'une seule ligne combinée couvrant tous vos projets à la fois.

Les rapports à l'échelle de la plateforme restent réservés aux administrateurs et à Finance : les onglets **Module Costs** et **Project Invoices** de la page Credits, ainsi que toute la page **Billing**, sont limités à ces deux rôles. Si vous avez besoin d'une facture officielle, faites-en la demande via le formulaire de support.

---

## Obtenir de l'aide {#getting-help}

L'onglet **Send Message** de la page **Help** est un formulaire de contact qui ouvre un ticket de support et envoie un e-mail à l'équipe de support. Ouvrir un ticket nécessite des crédits achetés (un abonnement ou une recharge) tant que des crédits sont en vente, et vous pouvez en ouvrir jusqu'à 5 sur 24 heures. L'onglet **My Tickets** à côté liste les tickets que vous avez ouverts, du plus récent au plus ancien, avec l'état de chacun (**New**, **In progress**, **Resolved** ou **Closed**) — l'envoi d'un ticket vous y amène, afin que vous voyiez celui que vous venez d'ouvrir. Selon votre rôle, vous pouvez voir d'autres onglets : **Setup Requests** (administrateurs et Finance) et **Support Tickets** (administrateurs, support et Finance). (Les administrateurs voient un formulaire de message sur Send Message à la place du formulaire de contact, et n'ont pas d'onglet My Tickets.)

Votre **lien de parrainage** se trouve sur votre **Profile**, dans la section **Refer and earn** (parrainer et gagner) — ouvrez le menu du profil en haut à droite. Il est affiché dès que le programme de parrainage est actif, y compris lorsque les parrainages sont illimités (il n'est jamais affiché aux administrateurs), et la page **Credits** comporte un bouton **Referral link** qui vous y mène. Toute personne qui s'inscrit via votre lien est rattachée à votre compte.

Vous pouvez aussi accéder à Help depuis le lien **Contact Us** du pied de page.

---

## Guides par rôle {#role-guides}

Pour l'ensemble des tâches de chaque rôle :

- [Admin](admin-guide.md)
- [Partner](partner-guide.md)
- [User](user-guide.md)
- [Agent](agent-guide.md)
- [Finance](finance-guide.md)
- [Support](support-guide.md)
- [Trainer](trainer-guide.md)
