'use client';
import{useState,type FormEvent}from'react';
import{useRouter}from'next/navigation';
import{clinicTests,type ScheduleSettings,type SettingsInput,type SettingsResult}from'@/lib/clinic-scheduling/schema';
import {SelectField} from '@/components/ui/select-field';
import{clinicalLocale,pick,type Locale}from'@/lib/locale';
const tr=(locale:Locale,en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
const field='min-h-12 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-body2 disabled:opacity-60';
const DAYS:[number,string,string,string][]=[[1,'Monday','Երկուշաբթի','Понедельник'],[2,'Tuesday','Երեքշաբթի','Вторник'],[3,'Wednesday','Չորեքշաբթի','Среда'],[4,'Thursday','Հինգշաբթի','Четверг'],[5,'Friday','Ուրբաթ','Пятница'],[6,'Saturday','Շաբաթ','Суббота'],[7,'Sunday','Կիրակի','Воскресенье']];
type Day={open:boolean;opens:string;closes:string};
export function ScheduleSettingsForm({settings,locale,save}:{settings:ScheduleSettings;locale:Locale;save:(input:SettingsInput)=>Promise<SettingsResult>}){
 const router=useRouter(),s=settings.schedule,edit=settings.canEdit;
 const [active,setActive]=useState(s?.active??false),[slotMinutes,setSlotMinutes]=useState(String(s?.slotMinutes??30)),[capacity,setCapacity]=useState(String(s?.capacity??1));
 const [covered,setCovered]=useState<string[]>(s?.coveredTestIds??[]),[preparation,setPreparation]=useState(s?.preparation??'');
 const [days,setDays]=useState<Record<number,Day>>(()=>Object.fromEntries(DAYS.map(([d])=>{const h=s?.hours.find(x=>x.weekday===d);return[d,{open:!!h,opens:h?.opens??'09:00',closes:h?.closes??'17:00'}];})));
 const [busy,setBusy]=useState(false),[note,setNote]=useState<{alert:boolean;text:string}|null>(null);
 async function submit(event:FormEvent){
  event.preventDefault();if(busy||!edit)return;
  if(!preparation.trim()){setNote({alert:true,text:tr(locale,'Enter the preparation shown to members before saving.','Մուտքագրեք անդամներին ցուցադրվող նախապատրաստումը՝ պահպանելուց առաջ։','Укажите подготовку, которую видят участники, перед сохранением.')});return;}
  const hours=DAYS.filter(([d])=>days[d].open).map(([d])=>({weekday:d,opens:days[d].opens,closes:days[d].closes}));
  if(hours.some(h=>h.closes<=h.opens)){setNote({alert:true,text:tr(locale,'Each closing time must be after the opening time.','Փակման ժամը պետք է լինի բացման ժամից հետո։','Время закрытия должно быть позже времени открытия.')});return;}
  if(!covered.length){setNote({alert:true,text:tr(locale,'Choose at least one test you do.','Ընտրեք առնվազն մեկ հետազոտություն, որը դուք կատարում եք։','Выберите хотя бы один анализ, который вы проводите.')});return;}
  setBusy(true);setNote(null);
  let result:SettingsResult;
  try{result=await save({expectedRevision:s?.revision??0,active,slotMinutes:Number(slotMinutes),capacity:Number(capacity),coveredTestIds:covered,preparation:preparation.trim(),hours});}catch{result={status:'unknown'};}
  setBusy(false);
  const texts:Record<SettingsResult['status'],[string,string,string]>={saved:['Your hours and capacity are saved.','Ձեր ժամերն ու տարողությունը պահպանված են։','Ваши часы работы и вместимость сохранены.'],
   invalid:['Check the hours, capacity and preparation text.','Ստուգեք ժամերը, տարողությունը և նախապատրաստման տեքստը։','Проверьте часы работы, количество мест и текст подготовки.'],stale:['Someone else saved changes. Reload to see them.','Ուրիշը փոփոխություններ է պահպանել։ Վերբեռնեք՝ դրանք տեսնելու համար։','Кто-то другой сохранил изменения. Обновите страницу, чтобы увидеть их.'],
   'address-required':['Your clinic needs an address before members can book. Ask Noreon to add it.','Անդամների գրանցման համար կլինիկան պետք է հասցե ունենա։ Խնդրեք Noreon-ին ավելացնել այն։','Чтобы участники могли записаться, у клиники должен быть адрес. Попросите Noreon добавить его.'],
   disabled:['Scheduling is switched off.','Այցերի կառավարումն անջատված է։','Запись отключена.'],unavailable:['Couldn’t save right now. Try again.','Այժմ չհաջողվեց պահպանել։ Նորից փորձեք։','Сейчас не удалось сохранить. Попробуйте снова.'],
   access:['Only a clinic admin can change hours.','Ժամերը կարող է փոխել միայն կլինիկայի ադմինիստրատորը։','Только администратор клиники может менять часы работы.'],unknown:['We couldn’t confirm the result. Reload to check.','Չհաջողվեց հաստատել արդյունքը։ Վերբեռնեք՝ ստուգելու համար։','Не удалось подтвердить результат. Обновите страницу, чтобы проверить.']};
  setNote({alert:result.status!=='saved',text:tr(locale,...texts[result.status])});
  if(result.status==='saved')router.refresh();
 }
 return <form onSubmit={submit} className="space-y-6">
  <fieldset disabled={!edit||busy} className="space-y-6">
   <label className="flex min-h-12 items-start gap-3 rounded-lg border bg-background p-4 text-body2"><input type="checkbox" checked={active} onChange={event=>setActive(event.target.checked)} className="mt-1 size-4 accent-primary"/><span><span className="block font-medium">{tr(locale,'Take bookings from Noreon members','Ընդունել Noreon-ի անդամների գրանցումներ','Принимать записи участников Noreon')}</span><span className="block text-caption text-muted-foreground">{tr(locale,'When this is off, no new times are offered. Visits already booked stay.','Երբ սա անջատված է, նոր ժամեր չեն առաջարկվում։ Արդեն գրանցված այցերը մնում են։','Когда эта функция отключена, новое время не предлагается. Уже записанные визиты сохраняются.')}</span></span></label>
   <fieldset className="space-y-3 rounded-lg border bg-background p-4"><legend className="px-1 text-h3">{tr(locale,'Opening hours','Աշխատանքային ժամեր','Часы работы')}</legend><p className="text-body2 text-muted-foreground">{tr(locale,'Choose the days you open, then set the times. Days stay closed until you choose them and save. All times are in Yerevan (UTC+4).','Ընտրեք աշխատանքային օրերը, ապա սահմանեք ժամերը։ Օրերը փակ են մնում, մինչև ընտրեք և պահպանեք դրանք։ Բոլոր ժամերը Երևանի ժամային գոտում են (UTC+4)։','Выберите рабочие дни и укажите время. Дни остаются закрытыми, пока вы их не выберете и не сохраните. Время указано по Еревану (UTC+4).')}</p>
    {DAYS.map(([d,en,hy,ru])=><div key={d} className="grid gap-2 border-t pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[12rem_1fr_1fr] sm:items-center">
     <label className="flex min-h-12 items-center gap-3 text-body2"><input type="checkbox" checked={days[d].open} onChange={event=>setDays({...days,[d]:{...days[d],open:event.target.checked}})} className="size-4 accent-primary"/>{tr(locale,en,hy,ru)}</label>
     {days[d].open?<><label className="block text-caption">{tr(locale,'Opens','Բացվում է','Открытие')}<input type="time" value={days[d].opens} onChange={event=>setDays({...days,[d]:{...days[d],opens:event.target.value}})} className={field} required/></label>
      <label className="block text-caption">{tr(locale,'Closes','Փակվում է','Закрытие')}<input type="time" value={days[d].closes} onChange={event=>setDays({...days,[d]:{...days[d],closes:event.target.value}})} className={field} required/></label></>
     :<p className="text-body2 text-muted-foreground sm:col-span-2">{tr(locale,'Closed','Փակ է','Закрыто')}</p>}
    </div>)}
   </fieldset>
   <div className="grid gap-4 sm:grid-cols-2">
    <label className="block space-y-2 text-body2"><span className="font-medium">{tr(locale,'Visit length','Այցի տևողություն','Длительность визита')}</span><SelectField value={String(slotMinutes)} onValueChange={setSlotMinutes} options={[10,15,20,30,45,60,90,120].map(m=>({value:String(m),label:`${m} ${tr(locale,'minutes','րոպե','минут')}`}))}/></label>
    <label className="block space-y-2 text-body2"><span className="font-medium">{tr(locale,'Members per visit time','Անդամներ մեկ ժամի համար','Участников на одно время визита')}</span><input type="number" min={1} max={50} value={capacity} onChange={event=>setCapacity(event.target.value)} className={field} required/></label>
   </div>
   <fieldset className="space-y-2 rounded-lg border bg-background p-4"><legend className="px-1 text-h3">{tr(locale,'Tests you do','Ձեր կատարած հետազոտությունները','Анализы, которые вы проводите')}</legend><p className="text-caption text-muted-foreground">{tr(locale,'Noreon arranges the other tests separately.','Մյուս հետազոտությունները Noreon-ը կազմակերպում է առանձին։','Остальные анализы Noreon организует отдельно.')}</p>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{clinicTests.map(test=><label key={test.id} className="flex min-h-12 items-center gap-3 rounded-md border px-3 text-body2"><input type="checkbox" checked={covered.includes(test.id)} onChange={event=>setCovered(event.target.checked?[...covered,test.id]:covered.filter(x=>x!==test.id))} className="size-4 accent-primary"/><span className="break-words">{test[clinicalLocale(locale)]}</span></label>)}</div>
   </fieldset>
   <label className="block space-y-2 text-body2"><span className="font-medium">{tr(locale,'Preparation shown to members','Անդամներին ցուցադրվող նախապատրաստում','Подготовка, которую видят участники')}</span><textarea value={preparation} onChange={event=>setPreparation(event.target.value)} maxLength={2000} rows={4} aria-required="true" className={field}/></label>
  </fieldset>
  <div className="sticky bottom-0 space-y-3 border-t bg-background py-3">
  {note&&<p role={note.alert?'alert':'status'} className="text-body2">{note.text}</p>}
  {edit&&<button className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-4 text-body2 font-medium text-primary-foreground disabled:opacity-60 sm:w-auto" disabled={busy}>{busy?tr(locale,'Saving…','Պահպանվում է…','Сохраняется…'):tr(locale,'Save hours','Պահպանել ժամերը','Сохранить часы работы')}</button>}
  </div>
 </form>;
}
