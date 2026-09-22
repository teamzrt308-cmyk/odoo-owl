/**
 * model/rules_engine/rules/access_rules.js
 * ===========================================
 * Règle d'accès générique (model: "*") : visibilité par groupe
 * (attribut XML groups="...") -- déplacée depuis
 * core/py_js/py_utils.js::isNodeVisible().
 *
 * Ne dépend d'aucun modèle précis : l'algorithme est identique pour tous
 * les modèles -- seules les données (securityContext) varient.
 *
 * NB (purge) : l'ancienne règle "generic_crud_rights" (droits CRUD
 * ir.model.access + le wrapper canPerform de user_service) a été
 * supprimée : JAMAIS branchée depuis le 1er commit (aucun appelant) --
 * le contrôle d'accès effectif reste serveur, au rejeu des méthodes.
 * Si un jour les boutons doivent se griser selon les droits locaux,
 * recréer la règle ET la brancher (ex. form_controller::onObjectButtonClick).
 */

export const accessRules = [
  {
    model: "*",
    type: "access",
    subtype: "groups",
    name: "generic_groups_visibility",
    // groupsAttr: valeur brute de l'attribut XML groups="..."
    // securityContext: { is_admin, groups }
    evaluate(groupsAttr, securityContext) {
      if (!groupsAttr) return true;
      if (groupsAttr.startsWith("!")) return true; // "groups négatif" -- non géré, jamais bloquant (comportement d'origine)
      // Simplifié (voir audit) : pas de vraie résolution multi-groupes tant
      // que le backend n'expose pas les xml_id de groupes hors-ligne --
      // seul le statut admin est distingué pour l'instant.
      return !!(securityContext && securityContext.is_admin);
    },
  },
];
