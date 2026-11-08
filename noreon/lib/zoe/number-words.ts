import {normaliseText} from './normalise';

// Recognition only, never a duration parser: an unconsumed number keeps the safety path.
const NUMBER_WORDS=new Set(normaliseText('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million half quarter once twice thrice '
 +'ноль один одна одно одну два две три четыре пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать четырнадцать пятнадцать шестнадцать семнадцать восемнадцать девятнадцать двадцать тридцать сорок пятьдесят шестьдесят семьдесят восемьдесят девяносто сто тысяча половина половину четверть '
 +'զրո մեկ մի երկու երեք չորս հինգ վեց յոթ ութ ինը տասը տաս տասնմեկ տասներկու տասներեք տասնչորս տասնհինգ տասնվեց տասնյոթ տասնութ տասնինը քսան երեսուն քառասուն հիսուն վաթսուն յոթանասուն ութսուն իննսուն հարյուր հազար կես քառորդ '
 +'mek mi erku ereq chors hing vec yot ut iny tas tasnmek tasnerku tasnereq tasnchors tasnhing tasnvec tasnyot tasnut tasniny qsan haryur kes qarrord').split(/\s+/u));
export const isNumberWord=(word:string)=>NUMBER_WORDS.has(word);
