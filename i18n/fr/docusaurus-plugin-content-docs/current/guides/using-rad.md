---
title: "Utiliser RAD"
description: "Comment utiliser la plateforme RAD : connexion, navigation, rôles, déploiement de modules sur votre propre projet Google Cloud, crédits et facturation."
---

<!-- translated-from: docs/guides/using-rad.md @ 2be24ed1 sha256:e9b12ecedc67 -->

# Utiliser RAD {#using-rad}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Using_RAD.png" alt="Utiliser RAD" style={{maxWidth: "100%", borderRadius: "8px"}} />

Voici la vue d'ensemble partagée destinée à tous les utilisateurs de RAD. Elle couvre la connexion, l'orientation dans l'interface, les rôles et les concepts fondamentaux (modules, déploiements, crédits, facturation et obtention d'aide). Le guide dédié à chaque rôle renvoie ici pour les notions de base, puis se concentre sur les missions spécifiques à ce rôle.

---

## Qu'est-ce que RAD {#what-is-rad}

RAD (Rapid Application Deployment) est un portail Web permettant de déployer des modules Google Cloud prêts à l'emploi sans écrire la moindre ligne de code d'infrastructure. Vous choisissez un module, remplissez un formulaire de configuration guidé, et la plateforme le provisionne pour vous sur Google Cloud.

L'utilisation est tarifée en **crédits** : la plupart des modules coûtent un nombre défini de crédits à déployer, le temps de build est inclus, et votre solde est vérifié avant l'exécution d'un déploiement.

---

## Connexion {#signing-in}

1. Ouvrez la page de connexion de RAD et cliquez sur **Sign in with Google**. Google est le seul moyen de se connecter.
2. Choisissez votre compte Google.

La première fois que vous vous connectez, votre compte est créé automatiquement — il n'y a pas de page d'inscription distincte : s'inscrire et se connecter s'effectuent via le même bouton sur `/signin`, et toute page ouverte alors que vous êtes déconnecté vous y redirige. Les nouveaux comptes commencent avec le rôle **User** et sont immédiatement actifs. Vous êtes invité à accepter les conditions de la plateforme avant l'ouverture de la console ; cette acceptation est enregistrée sur votre compte, et elle vous sera demandée à nouveau si les conditions sont ultérieurement mises à jour. Refuser vous laisse déconnecté plutôt que bloqué — l'option **Sign out** reste disponible sur cet écran.

Votre page d'arrivée dépend de votre rôle. Les administrateurs arrivent sur **Users** et l'équipe Finance sur **Billing**, car chacun se connecte pour effectuer une tâche spécifique ; il en va de même pour les comptes Support et Agent qui ne possèdent aucun autre rôle, respectivement dirigés vers **Help** et **Credits → My Commission**. Un opérateur de support ou un agent qui est également utilisateur, formateur ou partenaire arrive comme tel. Les utilisateurs et les formateurs arrivent sur **Solutions** : sur **Build Solution with AI** si vous y avez accès — crédits achetés, issus d'un abonnement ou d'une recharge —, sinon sur **Solution Catalog → RAD modules**. Un agent qui est aussi utilisateur ou formateur arrive de la même façon. Les partenaires y ont toujours accès, ils arrivent donc sur **Build Solution with AI**. Un utilisateur ou un formateur sans crédits achetés qui n'a pas encore connecté son propre projet Google Cloud se voit d'abord proposer **Connect your Google Cloud project** : RAD vérifie que vous contrôlez le projet, qu'il peut y déployer des ressources et que la facturation y est activée, afin que votre premier déploiement n'échoue pas en cours de route ; **Skip for now** permet d'accéder directement au catalogue. Si vous avez cliqué sur **Deploy** sur un module du catalogue public sur la page de connexion avant de vous connecter, vous arrivez directement sur ce module, prêt à être déployé. (Si la plateforme fonctionne en mode privé, seules les personnes disposant déjà d'un compte RAD peuvent se connecter — l'auto-inscription étant désactivée, demandez à un administrateur de créer votre compte si vous ne pouvez pas entrer.)

Pour vous déconnecter, ouvrez le **menu déroulant du profil** dans le coin supérieur droit et choisissez **Sign Out**.

### Langue {#language}

RAD est disponible en **anglais** et en **français**. Choisissez votre langue depuis le sélecteur de langue dans la barre supérieure — il est également présent sur les pages de connexion et de tarification. RAD recharge la page sur laquelle vous vous trouvez dans cette langue et mémorise votre choix, de sorte que rafraîchir une page ou suivre un lien le conserve. Les descriptions des modules, des solutions et des formules, l'Assistant conversationnel ainsi que les e-mails que RAD vous envoie respectent ce choix : les e-mails sont rédigés dans la dernière langue utilisée dans la console.

---

## Se repérer {#finding-your-way-around}

La barre de navigation supérieure n'affiche que les éléments pertinents pour votre rôle (ou vos rôles). Où que vous soyez, vous trouverez :

- Un **menu déroulant du profil** (en haut à droite) avec **Your Profile** et **Sign Out**.
- Un **sélecteur de langue** dans la barre supérieure, à côté du bouton de bascule de thème clair/sombre.
- **Ask AI** dans la barre supérieure (dans le menu sur mobile) : interrogez l'assistant IA de RAD sur les modules, la tarification ou les déploiements en langage naturel. Il se trouve aussi sur les pages de connexion, de tarification et les guides. Au sein de la console, il répond à partir de ces guides et insère un lien vers la section utilisée. Ses réponses pouvant comporter des erreurs, vérifiez tout élément important ; chaque fois que vous l'ouvrez, la conversation repart de zéro. Dans la console, son utilisation requiert des crédits achetés ou un rôle de gestion interne (staff).
- **Pricing**, juste avant **Help** dans la navigation supérieure — les tarifs de RAD, affichés au sein de la console.
- Dans le pied de page : **Contact Us** (vers la page **Help**), **Feedback** (le tableau public de retours de RAD, sur fider.radmodules.dev, où vous pouvez suggérer et voter pour des améliorations), les conditions d'utilisation et la politique de confidentialité, **Cookie settings**, **Pricing** à nouveau, le **Deployment Guide** et le **Blog**.

Il n'y a pas de tableau de bord consolidé distinct — chaque élément de la navigation supérieure constitue sa propre page.

Après votre connexion, RAD vous oriente vers la page correspondant à votre rôle :

- **User**, **Trainer** → **Solutions**, sur **Build Solution with AI** avec des crédits achetés, sinon sur **Solution Catalog → RAD modules**
- **Partner** → **Solutions**, sur **Build Solution with AI**
- **Admin** → **Users**
- **Finance** → **Billing**
- **Agent** → **Credits**, sur l'onglet **My Commission** — sauf si vous êtes aussi utilisateur ou formateur, auquel cas vous arrivez sur leur page respective
- **Support** → **Help** — sauf si vous êtes aussi utilisateur, formateur ou partenaire, auquel cas vous arrivez sur leur page respective
- Aucun rôle attribué pour le moment → **Help**

---

## Aperçu des rôles {#roles-at-a-glance}

Vous pouvez cumuler plusieurs rôles à la fois (par exemple Agent et Partenaire), et un **Partenaire est toujours également un Utilisateur**. Les rôles sont attribués par un administrateur.

| Rôle | Mission | Page de départ |
| :--- | :--- | :--- |
| **User** | Parcourir le catalogue, déployer et gérer ses propres modules, gérer ses crédits | Solutions |
| **Admin** | Tout ce qu'un utilisateur peut faire, plus l'administration complète de la plateforme : utilisateurs, paramètres, modules et supervision | Users |
| **Partner** | Un utilisateur qui publie également ses propres modules et perçoit des revenus grâce à eux | Solutions |
| **Agent** | Un rôle commercial : perçoit une commission en argent sur les frais de module que les utilisateurs parrainés règlent avec des crédits achetés | Credits → My Commission (Solutions si également User ou Trainer) |
| **Finance** | Rapports financiers et versements : paliers d'abonnement, paramètres et attributions de crédits, codes d'événement, revenus, factures ; supervision des labs (consulter chaque session et en terminer une) | Billing |
| **Support** | Trie les tickets de support ; consulte les déploiements des clients dont les tickets ouverts lui sont attribués | Help |
| **Trainer** | Anime des sessions de lab depuis **Solutions → Managed Environments** — un environnement de lab par participant — et gère les environnements provisionnés ; dispose également de tous les accès d'un User | Solutions |

Consultez les guides spécifiques aux rôles à la fin du document pour le détail complet des tâches.

---

## Concepts fondamentaux {#core-concepts}

### Le catalogue de modules (Solutions → Solution Catalog → RAD modules) {#the-module-catalog-solutions--solution-catalog--rad-modules}

**RAD modules**, situé sur l'onglet **Solution Catalog** de **Solutions**, constitue le catalogue de modules. Chaque module se présente sous forme de **fiche** affichant sa description, un lien vers la documentation, une note moyenne en étoiles, son nombre de déploiements et son tarif : les **frais** uniques, prélevés lors du premier succès du déploiement, présentés de la même façon sur chaque fiche du catalogue. Le temps de build est inclus dans le prix.

Il existe deux catégories de modules :

- **Platform modules** — publiés par RAD.
- **Partner modules** — publiés par des partenaires.

Si vous êtes un partenaire disposant de votre propre dépôt de modules connecté, vous verrez deux onglets (vos propres **Partner Modules** et les **Platform Modules**, qui incluent également les modules publics des autres partenaires). Tous les autres utilisateurs voient un catalogue unique et combiné des modules publics.

Vous pouvez **épingler** les modules que vous utilisez le plus pour qu'ils restent en haut, effectuer une **recherche** par nom, filtrer par **catégorie** depuis la liste située à côté de la grille, et naviguer entre les pages du catalogue. Un bandeau de statistiques en haut indique le total des déploiements, votre solde de crédits (lorsque les crédits sont activés) et la durée de conservation de l'historique des déploiements.

### Déployer un module {#deploying-a-module}

1. Cliquez sur la fiche d'un module, puis choisissez comment le configurer. L'**Assistant conversationnel** est sélectionné par défaut pour toute personne disposant de crédits achetés (systématiquement pour les partenaires) ; sans ceux-ci, le **Formulaire de configuration** est sélectionné par défaut et l'assistant est affiché mais verrouillé jusqu'à ce que vous achetiez des crédits. Le **Formulaire de configuration** est un formulaire guidé en plusieurs étapes — remplissez les champs en utilisant **Next** pour passer aux étapes suivantes. L'**Assistant conversationnel** décrit chaque paramètre en un seul message et propose des modifications au fur et à mesure que vous décrivez ce que vous souhaitez ; vous appliquez vous-même chaque modification proposée, de sorte que rien n'est configuré sans votre accord explicite. Vous pouvez basculer de l'un à l'autre à tout moment, les deux enregistrant exactement la même configuration.

   L'assistant s'abstient délibérément de faire deux choses. Il ne voit ni ne définit jamais de **secret** (clé d'API, jeton ou mot de passe) : il vous signale que le champ existe et vous saisissez la valeur dans le champ mis en surbrillance sur la page — jamais dans le chat, où elle serait envoyée au modèle et conservée dans l'historique de conversation. De plus, il n'acceptera pas une valeur qui enfreint la règle propre à un champ ; il vous explique la règle et vous demande une valeur corrigée plutôt que de modifier silencieusement votre saisie. Il en va de même pour une région qu'un projet géré par RAD ne peut pas utiliser : il vous en informe et liste les régions autorisées.
2. Le formulaire s'ouvre avec un panneau **What will be deployed** listant tout ce que le déploiement va construire — dans un projet géré par RAD, le projet Google Cloud et les services partagés ainsi que l'application — et indique si chaque élément est créé, mis à jour au préalable, ou existe déjà et est réutilisé gratuitement. Une boîte de dialogue de confirmation apparaît si le module coûte des crédits, s'il possède des dépendances ou s'il nécessite des autorisations particulières.
3. Cliquez sur **Deploy Module**. Le déploiement est placé en file d'attente puis provisionné, et RAD ouvre la page dédiée au nouveau déploiement sur son onglet **Build Status** afin que vous puissiez suivre son exécution. Si vous n'avez pas assez de crédits, RAD affiche le coût du module en regard de votre solde et vous invite à effectuer une recharge.

Les modes basique et avancé déterminent les paramètres auxquels vous avez accès, et non le tarif payé. Un nouveau déploiement est toujours créé avec les paramètres essentiels uniquement, et les frais de module lui sont appliqués comme décrit dans la section [Crédits](#credits). L'ensemble complet des paramètres — le **mode avancé** — n'est proposé que lorsque vous effectuez une **mise à jour** d'un déploiement, et une mise à jour ne facture jamais de frais de module.

Sur la page **Deployments**, chaque ligne affiche le module, l'identifiant du déploiement, une **évaluation par étoiles** modifiable, sa date de création, sa durée, son statut et l'action disponible. Il n'y a pas de colonne pour le projet ou les crédits — ouvrez un déploiement pour voir son projet, et consultez son onglet **Builds** pour connaître la consommation de chaque build. Les administrateurs et le support voient une colonne supplémentaire indiquant qui a réalisé le déploiement. Les administrateurs peuvent basculer entre **All Deployments** et **My Deployments** ; le support ne dispose pas de ce bouton et ne voit que les déploiements des clients dont les tickets ouverts lui sont assignés, et non ceux de toute la plateforme ; tous les autres utilisateurs voient leurs propres déploiements. Un déploiement avec le statut **Deleted** ne reste visible que pour une personne ayant encore la possibilité de le purger (ou, pour le support, de le restaurer) — par exemple, un participant de lab ne voit pas les environnements que son formateur a détruits.

Cliquez sur un déploiement pour ouvrir ses détails, qui comportent trois onglets :

- **Outputs** (Sorties) — les résultats non sensibles (tels que les URL et les points de terminaison), affichés dès que le déploiement a réussi et dispose de sorties à présenter.
- **Build Status** — les journaux en direct pendant l'exécution du déploiement. Une fois le déploiement réussi, **Explain this** ouvre un récapitulatif en langage clair de ce qui a été créé dans votre projet Google Cloud ; sur une étape qui a échoué, RAD explique la cause lorsqu'il la reconnaît, **Suggest fixes** propose des causes et démarches suggérées par l'IA lorsqu'il ne la reconnaît pas (et, lorsqu'une simple modification de paramètre suffit, **Apply suggested fix** ouvre le formulaire de mise à jour prérempli pour vérification), tandis que **Search for a fix** et **Ask for help** s'appuient tous deux sur l'erreur affichée par cette étape. Voir [En cas d'échec d'un déploiement](user-guide.md#when-a-deployment-fails). **Download** enregistre l'intégralité du journal dans un fichier texte, avec les secrets masqués.
- **Builds** — l'historique des builds pour ce déploiement.

Depuis la vue détaillée, vous pouvez :

- **Update** — rouvrir le formulaire de configuration (prérempli) et appliquer à nouveau (re-apply) les modifications. Disponible une fois qu'un déploiement est terminé.
- **Delete** — choisissez **Delete** pour démanteler les ressources cloud, ou **Purge** pour retirer le déploiement de RAD *sans* détruire les ressources cloud (utile lorsqu'un déploiement est bloqué ou a été modifié en dehors de RAD). Un déploiement appartenant à une solution ne peut être supprimé ou purgé que depuis la page de cette solution. Un projet GCP géré par RAD (« GCP Project on RAD ») est détruit de la même manière, mais comme cette action supprime l'intégralité du projet, RAD la refuse tant qu'un autre déploiement s'exécute encore dans ce projet et liste ceux à supprimer au préalable. Google conserve un projet supprimé récupérable pendant environ 30 jours. Les conditions de Google Cloud ne garantissent pas qu'un projet restauré sera exploitable ; on ne peut donc pas se fier à une restauration pour récupérer un projet supprimé : effectuez des sauvegardes appropriées de vos données et de votre configuration avant toute suppression, et en cas d'échec de restauration, redéployez l'application et restaurez sa configuration à partir de ces sauvegardes.
- **Cancel** — libère un déploiement encore à l'état Queued ou Waiting qui n'a pas commencé son build, ou une purge qui est restée bloquée.
- **Check status** — proposé lorsqu'un déploiement affiche l'état Queued, Pending, Working ou Deleting depuis une heure sans aucun changement. RAD demande à Cloud Build si un build est toujours en cours d'exécution ; si ce n'est pas le cas, le statut est corrigé afin que vous puissiez le supprimer ou le mettre à jour, et si un build tourne toujours, il vous indique quand il se terminera. Voir [Quand un déploiement semble bloqué](user-guide.md#when-a-deployment-seems-stuck).

Les statuts de déploiement que vous pouvez rencontrer sont notamment : Queued, Pending, Working, Waiting (en attente de la fin d'un déploiement prérequis), Success, Failure, Internal Error, Deleting, Deleted, Cancelled, Timeout et Expire.

### Solutions {#solutions}

L'onglet **Solutions** regroupe tout ce que vous pouvez déployer, réparti sur deux onglets — et c'est la page d'arrivée des utilisateurs, partenaires et formateurs après leur connexion (voir [Connexion](#signing-in)). Après ces deux onglets vient **Managed Environments** : les projets clients tant que la plateforme les propose (voir le [Guide des projets clients](client-projects-guide.md)) et, pour les formateurs, la finance et les administrateurs, les sessions de lab lorsqu'elles sont activées. Sa vue **All** liste les deux ; les vues **Lab sessions** et **Client projects** disposent chacune de leur propre bouton de création (**New lab session**, **New client project**) pour les utilisateurs autorisés à en créer. Si quelqu'un d'autre gère un environnement pour vous — une place dans le lab d'un formateur ou un projet client qu'un partenaire administre pour votre compte —, l'onglet s'affiche également pour vous avec une vue **Run for you** les répertoriant.

- **Build Solution with AI** — répondez à quatre questions simples et RAD détermine quelles applications répondent à votre besoin, calcule le coût global et estime la durée requise. **Build this** l'enregistre dans vos solutions et l'ouvre, prête à être déployée. Commencez ici si vous savez ce que vous voulez accomplir sans savoir comment cela s'appelle. Cet écran est également accessible directement sur **/build**. Il nécessite des crédits achetés (les partenaires y ont toujours accès) ; sans eux, l'onglet présente ses fonctionnalités de manière verrouillée, avec un bouton **Buy credits** tant que la plateforme vend des crédits.
- **Solution Catalog** — tout ce qui est prêt à être déployé, avec un filtre par type au sommet (**All** · **My solutions** · **RAD solutions** · **RAD modules**). **All** affiche chaque catégorie sur une seule page, sous son propre titre, en omettant les catégories sans contenu ; la liste des catégories à côté de la grille n'apparaît que lorsqu'un seul type (**RAD solutions** ou **RAD modules**) est sélectionné, car les solutions et les modules n'utilisent pas les mêmes catégories. Le champ de recherche au-dessus des onglets parcourt l'ensemble du Solution Catalog, et votre requête est conservée lorsque vous changez de type.
  - **My solutions** — des ensembles composés par vous-même. Décrivez ce que vous souhaitez construire, et RAD vous suggère des modules du catalogue accompagnés d'une brève justification pour chacun. Ajoutez ceux de votre choix, donnez un nom à l'ensemble et enregistrez-le. Vos solutions personnalisées restent privées, affichent le statut **Draft** jusqu'à leur déploiement puis **Deployed** par la suite, et se déploient via exactement le même pipeline qu'une solution RAD. Lorsque deux éléments n'ont aucun lien connu entre eux, RAD le mentionne sur la fiche au lieu d'extrapoler.
  - **RAD solutions** — des ensembles de modules prêts à l'emploi préparés par RAD, classés par catégories. Chaque fiche indique un coût combiné en crédits et une note moyenne calculée à partir des modules inclus.
  - **RAD modules** — le catalogue de modules décrit plus haut.

Les modules d'une solution sont organisés en **vagues** (waves), qui constituent un ordre de déploiement indicatif — mais ce qui conditionne réellement le démarrage d'un composant est sa dépendance effective de configuration envers un autre composant : il attend uniquement que ce producteur spécifique ait terminé, et non la fin de l'ensemble de sa vague nominale, ce qui permet à de nombreux composants de se provisionner simultanément au sein d'une même vague ou à travers plusieurs. Le provisionnement d'une solution vous guide à travers un unique formulaire de configuration couvrant tous ses composants. Le **déploiement de solution** qui en résulte dispose de sa propre page de détails où, comme pour un déploiement de module, vous pouvez le mettre à jour, le supprimer ou le purger.

### Crédits {#credits}

L'utilisation est mesurée en crédits, répartis sur quatre soldes distincts :

- **Offerts (Awards)** — crédits gratuits (inscription, mensuels, parrainage), réinitialisés chaque mois ; les crédits d'inscription sont conservés pendant au moins 30 jours. À compter du 1er décembre 2026, l'attribution mensuelle ne bénéficiera par défaut qu'aux comptes actifs (un build réussi ou un achat) au cours des 30 jours précédents.
- **Crédits d'événement** — crédits gratuits obtenus à l'aide d'un code lors d'un événement partenaire RAD. Ils expirent à leur propre date.
- **Abonnement** — crédits issus d'une formule d'abonnement. Lorsque la plateforme est configurée pour les réinitialiser, un renouvellement remplace le quota au lieu de s'y ajouter.
- **Recharge** — crédits achetés ponctuellement à l'unité. Ils n'expirent jamais.

Les dépenses débitent d'abord les crédits offerts, puis les crédits d'événement, puis l'abonnement, et enfin les recharges, de sorte que les crédits qui expirent le plus tôt soient consommés en premier. Votre **solde** réunit l'ensemble de ces crédits et fait l'objet d'une vérification avant chaque déploiement.

Le déploiement d'un module coûte les frais de ce module, et **le temps de build est inclus dans le prix**. Les frais sont réservés dès votre confirmation et prélevés dès le premier succès du déploiement. Votre premier déploiement réussi est gratuit, quels que soient les frais du module : cette offre s'applique une seule fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, cela couvre les frais d'une seule application : la première qui réussit ; jamais une session de lab ni un projet client). Chaque déploiement bénéficie de 5 mises à jour gratuites par mois calendaire (UTC), puis chaque mise à jour coûte 2 crédits ; les mises à jour effectuées directement par RAD sont gratuites, tout comme les destructions, les purges et les builds ayant échoué. Les builds en échec sont gratuits dans la limite de 10 par jour (UTC) : au-delà, les déploiements et mises à jour qui échouent sont facturés au temps de build à la minute si vous possédez des crédits achetés ; si vous n'en avez pas, vous pourrez relancer des builds le jour suivant. Les échecs imputables à RAD ou Google, ainsi que les destructions ayant échoué, ne sont jamais pris en compte dans ce décompte. Sans crédits achetés, vos builds partagent un total de 120 minutes de build gratuites par jour (UTC) ; une fois celles-ci écoulées, vous pourrez relancer des builds le lendemain ou dès que vous achèterez des crédits. Quel que soit votre solde, vous ne pouvez pas lancer un nouveau déploiement ou une mise à jour tant que 3 de vos builds sont en cours d'exécution (les applications d'une même solution ne se bloquent pas entre elles). Les destructions et les purges ne sont jamais restreintes par ces quotas. Les sessions de lab et les projets clients constituent l'exception : leur temps de build reste facturé à la minute. Le projet et les services partagés que RAD configure sous une application sont inclus (pris séparément, Project_GCP coûte 10 crédits et Services_GCP 20 crédits, et le premier déploiement gratuit ne les prend pas en charge). L'équipe Finance définit ces montants et peut rétablir la facturation du temps de build à la minute ; la boîte de dialogue de confirmation indique systématiquement les conditions applicables. Cette boîte de dialogue détaille l'INTÉGRALITÉ de la chaîne — déployer dans un projet géré par RAD crée également votre projet privé Google Cloud et les services partagés que vos applications utilisent — et fournit, pour un projet géré par RAD, une estimation de son coût de fonctionnement mensuel. Un partenaire déployant son propre module n'est pas facturé des frais de module. Si l'équipe Finance de RAD a défini un taux de TVA pour votre compte, celle-ci est ajoutée à chaque frais de module, débit de crédits et frais d'utilisation de projet ; la boîte de dialogue de confirmation l'affiche sur sa propre ligne **VAT**, et elle doit être réglée à l'aide de crédits achetés. Une solution de trois modules ou plus bénéficie d'une remise groupée sur ses frais de module — par défaut de 15 % pour trois ou quatre modules, 20 % pour cinq ou six, et 25 % pour sept modules ou plus.

Vous choisissez les e-mails que RAD vous envoie sur votre page **Profile**. Désactiver les e-mails **Deployments** coupe tous les e-mails liés aux déploiements, y compris l'avertissement préalable à une suppression définitive — ainsi, tant qu'ils sont désactivés, ces suppressions sont suspendues plutôt qu'exécutées sans préavis. Consultez le [Guide de l'utilisateur](user-guide.md#email-notifications).

Dans la limite du quota quotidien mentionné ci-dessus, un déploiement ou une mise à jour qui a **échoué** ne vous coûte rien ; au-delà, les nouveaux échecs de déploiements et de mises à jour sont facturés à la minute si vous possédez des crédits achetés. Une destruction ayant échoué est toujours gratuite. (La Finance peut décider de facturer les frais de module lorsqu'un nouveau déploiement échoue ; la boîte de dialogue de confirmation le précise lorsque cette règle est appliquée.)

La page **Credits** comprend :

- Un onglet **Credit Transactions** — votre historique complet d'attributions, d'achats et de dépenses, filtrable par déploiement et par date, avec l'option **Export CSV**.
- Un onglet **Project Transactions** — visible dès lors que les crédits de projet sont activés (voir [Coûts et factures](#costs-and-invoices)).
- Un onglet **Subscriptions** et un onglet **Buy Credits** — affichés uniquement lorsque la plateforme vend des crédits (voir ci-dessous).
- Un onglet **Linked Projects** — pour que RAD paie Google pour un projet Google Cloud que vous possédez déjà (voir [Coûts et factures](#costs-and-invoices)).
- Selon votre rôle, des onglets de revenus — **My Commission** (agents), **Module Revenue** (partenaires, administrateurs et finance), **My Referral Revenue** (administrateurs et finance) — se trouvent également ici. Il n'existe pas de page distincte dédiée aux revenus.
- Un onglet **Calculate ROI**, toujours en dernière position — le simulateur décrit ci-dessous.

Pour acheter des crédits, choisissez une devise et un montant, sélectionnez un prestataire de paiement, puis finalisez la transaction sur la page sécurisée de ce prestataire. Vos crédits sont crédités automatiquement dès que le paiement est confirmé.

Certaines plateformes exigent des crédits *achetés* (et pas seulement offerts) pour certains déploiements — la boîte de dialogue de confirmation vous indiquera si cette condition s'applique.

### Fonctionnalités d'IA et leur limite quotidienne {#ai-features-and-their-daily-limit}

Les fonctionnalités d'IA de RAD — **Ask AI**, l'**Assistant conversationnel**, **Build Solution with AI**, **Suggest fixes** et la réponse par IA sur le formulaire de support — ne coûtent jamais de crédits. Elles partagent un quota unique par compte, défini par l'équipe Finance de RAD : par défaut **100 requêtes par jour** si vous avez acheté des crédits (recharge ou paiement d'un abonnement) au cours des 90 derniers jours ou si vous disposez d'un rôle d'administration (staff), sinon **20 requêtes par jour**. Lorsque le plus petit quota est épuisé, RAD vous en avertit et vous indique qu'acheter des crédits ou souscrire un abonnement permet de l'augmenter. Consultez le [Guide de l'utilisateur](user-guide.md#ai-requests-each-day).

### Facturation et abonnements {#billing-and-subscriptions}

Les paiements sont gérés via **Stripe** et **Flutterwave**. Vous choisissez le prestataire lors du règlement ; les prestataires proposés dépendent de votre devise et de ce qui a été activé sur la plateforme. La tarification s'affiche dans la devise choisie.

Les abonnements sont des formules récurrentes optionnelles (« paliers ») qui octroient un nombre déterminé de crédits à chaque cycle de facturation. Vous pouvez vous abonner, résilier ou réactiver votre abonnement à tout moment, mais vous ne pouvez détenir qu'un seul abonnement à la fois — pour changer de palier ou de prestataire de paiement, résiliez d'abord l'abonnement en cours. Les abonnements n'attribuent que des crédits — ils n'octroient pas le rôle de Partenaire, qui doit être assigné manuellement par un administrateur.

La possibilité d'effectuer des achats dépend d'un interrupteur général de la plateforme, **Enable Subscription**. Lorsqu'il est désactivé, il n'est plus possible de souscrire de nouveaux abonnements ni d'acheter des recharges ponctuelles auprès de l'un ou l'autre des prestataires : les onglets **Subscriptions** et **Buy Credits** ne sont plus affichés et la page publique des tarifs ne présente aucune formule. Si vous possédez déjà un abonnement, un avis sur **Credit Transactions** vous permet néanmoins de le résilier.

### ROI {#roi}

L'onglet **Calculate ROI** de la page **Credits** est un estimateur interactif. Prérempli avec vos activités récentes, il vous permet d'ajuster des hypothèses (comme le nombre de déploiements mensuels, le temps de déploiement manuel, le coût horaire d'un ingénieur et le pourcentage de gain de temps) afin d'estimer votre coût de main-d'œuvre, le coût de la plateforme, vos économies nettes et votre retour sur investissement (ROI). Il s'agit uniquement d'un outil d'estimation — il ne déploie rien et ne facture rien.

### Coûts et factures {#costs-and-invoices}

Vous pouvez consulter vos dépenses sur la page **Credits** de deux façons. **Credit Transactions** liste chaque attribution, achat et prélèvement sur votre compte. **Project Transactions** — affiché dès que les crédits de projet sont activés — ventile le volet projet par projet Google Cloud, avec les crédits débités et le coût cloud sous-jacent pour chacun, sur la période de votre choix. Cet onglet existe car un débit de projet arrive sur le grand livre sous forme d'une ligne globale unique regroupant tous vos projets en même temps.

L'onglet **Linked Projects**, également situé sur la page Credits, permet à RAD de régler Google pour un projet Google Cloud que vous possédez déjà et administrez vous-même. Vous justifiez de votre propriété sur le projet, attribuez à l'identité de facturation de RAD deux rôles lui permettant d'associer ou de dissocier un compte de facturation (et rien de plus — RAD n'a aucun accès à vos données), plafonnez les quotas de GPU et de l'API Gemini du projet, puis soumettez une demande. Dès que l'équipe Finance de RAD valide la demande, RAD paie Google et débite vos crédits achetés toutes les heures pour la consommation du projet, au prix catalogue de Google majoré de la marge de RAD et de votre taux de TVA. Vous devez conserver un solde minimal de crédits achetés ; en dessous de ce seuil, RAD suspend le projet en dissociant la facturation (vos données sont conservées) et le réactive dès que vous effectuez une recharge, en vous avertissant par e-mail avant la suspension. Vous pouvez interrompre ce fonctionnement à tout moment avec le bouton **Stop**, ou en rattachant votre propre compte de facturation au projet. Consultez le [Guide de l'utilisateur](user-guide.md#linked-projects).

Les rapports à l'échelle de la plateforme restent réservés aux administrateurs et à la finance : les onglets **Module Costs** et **Project Invoices** de la page Credits, ainsi que l'ensemble de la page **Billing**, sont restreints à ces deux rôles. Si vous avez besoin d'une facture formelle, formulez votre demande via le formulaire de Support.

---

## Obtenir de l'aide {#getting-help}

L'onglet **Send Message** de la page **Help** est un formulaire de contact permettant de créer un ticket de support et d'envoyer un e-mail à l'équipe d'assistance. Créer un ticket nécessite des crédits achetés (un abonnement ou une recharge) lorsque la vente de crédits est active, sauf si vous possédez un rôle interne (staff), et vous pouvez en soumettre jusqu'à 5 par période de 24 heures. L'onglet **My Tickets** situé à côté liste les tickets que vous avez ouverts, du plus récent au plus ancien, en indiquant l'état de chacun (**New**, **In progress**, **Resolved** ou **Closed**) — l'envoi d'un ticket vous y redirige directement pour que vous puissiez voir celui que vous venez de créer. Selon votre rôle, vous pouvez avoir accès à d'autres onglets : **Setup Requests** (administrateur et finance) et **Support Tickets** (administrateur, support et finance). (Les administrateurs disposent d'un formulaire de message direct sur Send Message au lieu du formulaire de contact, et n'ont pas d'onglet My Tickets.)

Votre **lien de parrainage** figure sur votre profil, dans la section **Refer and earn** — ouvrez le menu du profil en haut à droite. Il est visible dès lors que le programme de parrainage est actif, y compris lorsque les parrainages sont illimités (il n'est jamais présenté aux administrateurs), et la page **Credits** comporte un bouton **Referral link** qui vous y emmène. Chaque utilisateur qui s'inscrit via votre lien est rattaché à votre compte, et la prime de parrainage est versée dès que l'un de ses builds aboutit pour la première fois (création ou mise à jour) ou qu'il achète des crédits, dans les 90 jours suivant son inscription.

Vous pouvez également accéder à l'Assistance via le lien **Contact Us** dans le pied de page. Pour suggérer une amélioration plutôt que signaler un dysfonctionnement, utilisez le lien **Feedback** situé à côté.

---

## Guides par rôle {#role-guides}

Pour l'ensemble complet des tâches de chaque rôle :

- [Admin](admin-guide.md)
- [Partner](partner-guide.md)
- [User](user-guide.md)
- [Agent](agent-guide.md)
- [Finance](finance-guide.md)
- [Support](support-guide.md)
- [Trainer](trainer-guide.md)
