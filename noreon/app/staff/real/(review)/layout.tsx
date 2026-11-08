import {ChatMemberIdentityProvider} from '@/components/staff/chat-member-identity';
import {DoctorChatShell} from '@/components/staff/doctor-workspace/chat-shell';
import {doctorChatHomeEnabled,doctorChatV2Enabled,doctorHomePath} from '@/lib/staff-zoe/workspace-config';
import {AppShell, ShellSignOut} from '@/components/app-shell/app-shell';
import {StaffNavigation} from '@/components/staff/navigation';
import {homeRequestsOnly} from '@/lib/real-booking/legacy-mode';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {realStaffSignOut} from '@/lib/patient-care/clinical-actions';
import {telegramEnabled} from '@/lib/telegram-runtime/config';
import {bpDevicesEnabled} from '@/lib/bp-device/config';
import {traceViewEnabled} from '@/lib/conversation-trace/contracts';
import {careAlertsEnabled} from '@/lib/care-alerts/contracts';
import {gmDashboardEnabled, pilotCatalogEnabled, pilotPaymentsEnabled} from '@/lib/pilot-commerce/config';
import {doctorCompletionEnabled} from '@/lib/doctor-completion/config';
import {zoeAiSettingsEnabled} from '@/lib/zoe/policy';
import {messageOperationsPageEnabled} from '@/lib/messaging/operations-page';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {StaffLocaleSwitch} from '@/components/staff/staff-locale-switch';
import {adminChatEnabled} from '@/lib/admin-chat/config';
import {nurseChatEnabled,nurseChatV2Enabled} from '@/lib/nurse-chat/config';
import {AdminChatShell} from '@/components/staff/admin-chat-shell';
import {NurseChatShell} from '@/components/staff/nurse-chat-shell';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';

export default async function RealReviewLayout({children}: {children: React.ReactNode}) {
  const {identity, client} = await requireRealStaffForRender();
  const identityChildren=<ChatMemberIdentityProvider key={`${identity.id}:${identity.role}`}>{children}</ChatMemberIdentityProvider>;
  // Nurse visits navigation shows only while its database switch is on (review F6); a failed read hides it.
  const nurseVisits = (identity.role === 'nurse' || identity.role === 'admin') && client
    ? await Promise.resolve().then(() => client.rpc('nurse_visit_navigation')).then(r => r.data === true, () => false)
    : false;
  const admin = identity.role === 'admin';
  // Admin conversation reading follows its database switch; an unreadable switch hides the link.
  const adminConversations = admin && (await client.rpc('admin_conversation_read_enabled').then(r => r.data === true, () => false));
  const nurse = identity.role === 'nurse';
  // Doctor Zoe (dark): its database switch; a failed read hides the link.
  const staffZoe = !admin && (await Promise.resolve().then(() => client.rpc('staff_zoe_status' as never)).then(r => r.data === true, () => false));
  const locale = await staffLocale(identity.role);
  const t = (en: string, hy: string, ru: string) => st(locale, en, hy, ru);
  const nav=<StaffNavigation admin={admin} nurse={nurse} real telegram={telegramEnabled()} bpDevices={bpDevicesEnabled()} trace={traceViewEnabled()} alerts={careAlertsEnabled()} catalog={pilotCatalogEnabled()} payments={pilotPaymentsEnabled()} cohort={gmDashboardEnabled()} consultations={doctorCompletionEnabled()} visitSlots={!homeRequestsOnly()} aiSettings={zoeAiSettingsEnabled()} messageOperations={messageOperationsPageEnabled()} adminConversations={adminConversations} nurseVisits={nurseVisits} nurseChat={nurseChatEnabled()} adminChat={adminChatEnabled()} staffZoe={staffZoe} careQueue={zoeAppV3Enabled()} locale={locale}/>;
  const actions=<>
      {!admin && <StaffLocaleSwitch locale={locale}/>}
      <span className="text-caption text-muted-foreground">{identity.name}</span>
      <ShellSignOut action={realStaffSignOut} label={t('Sign out', 'Դուրս գալ','Выйти')}/>
    </>;
  const shell=<AppShell
    lang={locale}
    contentId="staff-content"
    skipLabel={t('Skip to content', 'Անցնել բովանդակությանը','Перейти к содержимому')}
    menuLabel={t('Menu', 'Ընտրացանկ','Меню')}
    brandHref={doctorHomePath(identity.role)}
    badge={admin ? t('Operations', 'Գործերի կառավարում', 'Операционная работа') : t('Clinical', 'Կլինիկական','Медицинская работа')}
    sidebarHeader={<p>{admin ? t('Backoffice', 'Վարչական վահանակ', 'Административная панель') : nurse ? t('Nurse workspace', 'Բուժքրոջ աշխատատարածք','Рабочее пространство медсестры') : t('Doctor workspace', 'Բժշկի աշխատատարածք','Рабочее пространство врача')}</p>}
    nav={nav}
    title={admin ? t('Noreon operations', 'Նորեոն Հելթի գործերի կառավարում', 'Операционная работа Нореон Хелс') : t('Clinical workspace', 'Կլինիկական աշխատատարածք','Медицинское рабочее пространство')}
    actions={actions}
  >{identityChildren}</AppShell>;
  if(admin&&adminChatEnabled())return <AdminChatShell fallback={shell} nav={nav} actions={actions} locale={locale}>{identityChildren}</AdminChatShell>;
  if(identity.role==='doctor'&&doctorChatHomeEnabled())return <DoctorChatShell fallback={shell} nav={nav} actions={actions} locale={locale} chatV2={doctorChatV2Enabled()}>{identityChildren}</DoctorChatShell>;
  return nurse&&nurseChatEnabled()?<NurseChatShell fallback={shell} nav={nav} actions={actions} locale={locale} newChat={nurseChatV2Enabled()}>{identityChildren}</NurseChatShell>:shell;
}
