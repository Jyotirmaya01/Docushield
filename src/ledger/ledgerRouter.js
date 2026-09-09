/**
 * DocuShield Ledger Router Module
 * Implements Step A2 (Ledger Lookup) of the System Architecture:
 * Routes incoming travelers based on their cryptographic crossing history.
 */

import { ledgerInstance } from './hashChain.js';

export class LedgerRouter {
  /**
   * Evaluates document ID against the cryptographic ledger history
   * @param {string} documentNumber - ID or passport number of the document
   * @returns {Promise<{
   *   pathway: 'FAST_LANE' | 'OFFICER_REVIEW' | 'FULL_PIPELINE',
   *   statusText: string,
   *   history: Object,
   *   badgeColor: string
   * }>}
   */
  static async evaluatePathway(documentNumber) {
    if (!documentNumber) {
      return {
        pathway: 'FULL_PIPELINE',
        statusText: 'First-time Document · Standard Detection Pipeline',
        history: { found: false, count: 0 },
        badgeColor: 'primary'
      };
    }

    const history = await ledgerInstance.lookupDocumentHistory(documentNumber);

    if (!history.found) {
      return {
        pathway: 'FULL_PIPELINE',
        statusText: 'First-time Traveler · Routing to Full 7-Stage Pipeline',
        history: history,
        badgeColor: 'primary'
      };
    }

    // Branch: Found and previously flagged
    if (history.hasFlags || history.lastDecision === 'ESCALATED_SECONDARY') {
      return {
        pathway: 'OFFICER_REVIEW',
        statusText: `Security Record Found · Mandatory Officer Escalation (${history.count} previous crossings)`,
        history: history,
        badgeColor: 'error'
      };
    }

    // Branch: Found, approved with no flags -> Frequent-Crosser Fast Lane
    return {
      pathway: 'FAST_LANE',
      statusText: `Verified Frequent Crosser · Routing to Fast Lane (${history.count} verified crossings)`,
      history: history,
      badgeColor: 'secondary'
    };
  }
}
