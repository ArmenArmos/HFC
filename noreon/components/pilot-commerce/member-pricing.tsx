import{amd}from'@/lib/pilot-commerce/format';
import {testTitle} from '@/lib/patient/catalogue-label';
import {type Locale} from '@/lib/locale';
import type{MemberCatalog,MemberPayment,PaymentStatus}from'@/lib/pilot-commerce/schema';

/** What the member booking screens need for prices and payment state. Absent when the flags are off. */
export type MemberPricing={catalog:MemberCatalog['tests'];payments:MemberPayment[]|null};
const c=(locale:Locale,en:string,hy:string,ru:string)=>locale==='hy'?hy:locale==='ru'?ru:en;

/** Line prices and the total for a set of booked tests, priced from today's catalogue.
 * A test without an active price is named, never counted as free. */
export function TestPrices({items,pricing,locale,heading}:{items:{id:string;title:string}[];pricing?:MemberPricing;locale:Locale;heading?:string}){
 if(!items.length)return null;
 const rows=items.map(item=>({item,entry:pricing?.catalog.find(test=>test.testKey===item.id)}));
 const unpriced=rows.filter(row=>!row.entry||row.entry.priceAmd===null);
 const total=rows.reduce((sum,row)=>sum+(row.entry&&!row.entry.includedInPackage?row.entry.priceAmd??0:0),0);
 const sample=rows.some(row=>row.entry?.priceSource==='staging-placeholder');
 return <section data-pilot-prices aria-label={heading??c(locale,'Prices','Գներ','Цены')} className="space-y-2 rounded-lg border p-3">
  <h3 className="text-body2 font-semibold">{heading??c(locale,'Prices','Գներ','Цены')}</h3>
  <ul className="divide-y text-body2">{rows.map(({item,entry})=><li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
   <span className="min-w-0 break-words">{testTitle(item,locale)}</span>
   <span className="shrink-0 font-medium">{!entry||entry.priceAmd===null?c(locale,'Price not available yet','Գինը դեռ հասանելի չէ','Цена пока недоступна'):entry.includedInPackage?c(locale,'Included in your package','Ներառված է ձեր փաթեթում','Включено в ваш пакет'):amd(entry.priceAmd,locale)}</span>
  </li>)}</ul>
  {unpriced.length===0&&<p data-test-total className="flex flex-wrap justify-between gap-2 border-t pt-2 text-body2 font-semibold"><span>{c(locale,'Total','Ընդհանուր','Итого')}</span><span>{amd(total,locale)}</span></p>}
  {sample&&<p className="text-caption text-muted-foreground">{c(locale,'These are sample prices for testing. The clinic’s final prices will replace them.','Սրանք փորձնական գներ են։ Դրանք կփոխարինվեն կլինիկայի վերջնական գներով։','Это примерные цены для тестирования. Их заменят окончательные цены клиники.')}</p>}
 </section>;
}

const label:Record<PaymentStatus,[string,string,string]>={pending:['Awaiting payment','Սպասում է վճարման','Ожидается оплата'],paid:['Paid','Վճարված է','Оплачено'],failed:['Payment did not go through','Վճարումը չի կատարվել','Оплата не прошла'],refunded:['Refunded','Գումարը վերադարձված է','Деньги возвращены'],waived:['No payment needed','Վճարում չի պահանջվում','Оплата не требуется']};
const help:Partial<Record<PaymentStatus,[string,string,string]>>={
 pending:['Payment is not confirmed yet. We will send you how to pay.','Վճարումը դեռ հաստատված չէ։ Մենք կուղարկենք վճարման տեղեկությունները։','Оплата пока не подтверждена. Мы отправим вам инструкции по оплате.'],
 failed:['Nothing was charged as far as we know. We will contact you to try again.','Մեր տվյալներով գումար չի գանձվել։ Մենք կկապվենք ձեզ հետ՝ նորից փորձելու համար։','По нашим данным, деньги не списаны. Мы свяжемся с вами, чтобы повторить попытку.'],
};
/** The member's payment state for one booking, with the amount fixed when the record was made. */
export function MemberPaymentStatus({payment,locale}:{payment:MemberPayment|undefined;locale:Locale}){
 if(!payment)return null;
 const [en,hy,ru]=label[payment.status];const note=help[payment.status];
 return <div data-pilot-payment className="space-y-1 rounded-lg border p-3">
  <p className="flex flex-wrap items-center justify-between gap-2 text-body2"><span className="font-semibold">{c(locale,'Payment','Վճարում','Оплата')}: {c(locale,en,hy,ru)}</span><span className="font-medium">{amd(payment.amountAmd,locale)}</span></p>
  {note&&<p className="text-caption text-muted-foreground">{c(locale,note[0],note[1],note[2])}</p>}
  {payment.priceBasis==='staging-placeholder'&&<p className="text-caption text-muted-foreground">{c(locale,'Sample amount for testing.','Փորձնական գումար։','Примерная сумма для тестирования.')}</p>}
 </div>;
}
export const paymentFor=(pricing:MemberPricing|undefined,kind:'test-request'|'appointment',id:string)=>pricing?.payments?.find(p=>p.bookingKind===kind&&p.bookingId===id);
