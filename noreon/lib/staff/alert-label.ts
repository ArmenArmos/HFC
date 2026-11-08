import {alertReason as sourceReason,type CareAlert} from '@/lib/care-alerts/contracts';
import {staffDisplayText,staffRuleLabel} from './display-text';
import {alertReasons} from '@/lib/care-alerts/contracts';
import type {Locale} from '@/lib/locale';

/** Keep registry identifiers in stored evidence, show the clinical team's existing wording to staff. */
export function staffAlertReason(alert:Pick<CareAlert,'reason'|'redFlags'>,locale:Locale){
 return alertReasons.some(reason=>reason===alert.reason)?staffDisplayText(sourceReason(alert,locale),locale):staffRuleLabel(alert.reason,locale);
}
