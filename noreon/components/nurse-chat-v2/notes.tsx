import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {careNoteKindLabel} from '@/lib/staff/care-note-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import type {NotesPage,NoteEntry,NoteKind} from './use-nurse-notes';

export function NurseNotes({page,locale:l,disabled,onAdd}:{page:NotesPage;locale:StaffLocale;disabled:boolean;onAdd?:()=>void}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 return <section data-care-notes><p><strong>{t('Care team notes','Բուժող թիմի նշումներ','Заметки медицинской команды')}</strong></p>
  {page.notes.length?<ol className="ncv2-list">{[...page.notes].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)).map(note=><li key={note.id} data-care-note={note.id}><p>{careNoteKindLabel(l,note.kind)}</p><p className="ncv2-body">{note.note}</p><p className="cv2-time">{note.actor_name} · {yerevanStamp(note.created_at,l)}</p></li>)}</ol>:<p>{t('No notes recorded.','Նշումներ գրանցված չեն։','Заметок пока нет.')}</p>}
  {onAdd&&<button type="button" className="ncv2-choice" disabled={disabled} onClick={onAdd} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('Add a note','Ավելացնել նշում','Добавить заметку')}</button>}
 </section>;
}
export function NurseNoteTurns({entry,locale:l,active,frozen,onKind,onRetry}:{entry:NoteEntry;locale:StaffLocale;active:boolean;frozen:boolean;onKind:(kind:NoteKind)=>void;onRetry:()=>void}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 return <>
  {active&&entry.note===undefined&&<article className="cv2-msg cv2-zoe"><div className="cv2-say ncv2-card" data-note-job>
   <p>{t('Add only what you observed. Edit the phrase before saving. The doctor can read your note.','Ավելացրեք միայն ձեր դիտարկածը։ Պահպանելուց առաջ խմբագրեք արտահայտությունը։ Բժիշկը կարող է կարդալ ձեր նշումը։','Добавляйте только то, что наблюдали. Отредактируйте фразу перед сохранением. Врач может прочитать заметку.')}</p>
   <p>{t('Recording contact does not send a message or clinically approve a result.','Կապի գրանցումը հաղորդագրություն չի ուղարկում և արդյունքը կլինիկորեն չի հաստատում։','Регистрация контакта не отправляет сообщение и не означает клинического утверждения результата.')}</p>
   {(['evidence','contact-attempted','reached','unreachable','refer-doctor'] as const).map(kind=><button key={kind} type="button" className="ncv2-choice" disabled={frozen} aria-pressed={entry.kind===kind} onClick={()=>onKind(kind)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{careNoteKindLabel(l,kind)}</button>)}
  </div></article>}
  {entry.note!==undefined&&<article className="cv2-msg cv2-me" data-note-turn><div className="cv2-say"><p className="cv2-time">{careNoteKindLabel(l,entry.kind)} · {entry.member.name}</p><p className="ncv2-body">{entry.note}</p>{entry.state==='saving'&&<p role="status">{t('Saving note…','Նշումը պահպանվում է…','Сохранение…')}</p>}</div></article>}
  {(entry.state==='uncertain'||entry.error)&&<article className="cv2-msg cv2-zoe"><div className="cv2-say ncv2-card"><p role="status">{entry.state==='uncertain'?t('The note result could not be confirmed. Retry the same note before closing.','Նշման արդյունքը չհաստատվեց։ Փակելուց առաջ կրկին փորձեք նույն նշումը։','Не удалось подтвердить результат заметки. Повторите ту же заметку перед закрытием.'):t('Could not save. Check the current care notes before trying again.','Չհաջողվեց պահպանել։ Կրկին փորձելուց առաջ ստուգեք ընթացիկ նշումները։','Не удалось сохранить. Проверьте текущие заметки перед повторной попыткой.')}</p>{entry.blocked&&<p>{t('Review the notes, then close this note before recording another one. The previous save remains unconfirmed.','Ստուգեք նշումները, ապա փակեք այս նշումը՝ նոր նշում գրանցելուց առաջ։ Նախորդ պահպանումը դեռ չհաստատված է։','Проверьте заметки, затем закройте эту заметку перед записью следующей. Предыдущее сохранение не подтверждено.')}</p>}{entry.error&&active&&<NurseNotes page={entry.page} locale={l} disabled/>}{entry.state==='uncertain'&&<button type="button" className="ncv2-choice" onClick={onRetry} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('Retry this note','Կրկին փորձել այս նշումը','Повторить эту заметку')}</button>}</div></article>}
 </>;
}
