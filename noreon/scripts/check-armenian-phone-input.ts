import assert from 'node:assert/strict';
import {armenianNationalDigits as digits,armenianPhoneFromNational as e164,foreignInternationalNumber as foreign,normalizePhone} from '@/lib/patient/validation';
// The member phone field shows a fixed "+374"; only the 8-digit national number is typed.
const cases:Array<[string,string]>=[
 ['99123456','99123456'],
 ['099123456','99123456'],          // leading trunk 0 dropped
 ['0',''],
 ['+37499123456','99123456'],       // pasted international form
 ['+374 99 12 34 56','99123456'],
 ['+374 (99) 123-456','99123456'],
 ['37499123456','99123456'],        // pasted without the plus
 ['0037499123456','99123456'],      // 00 international prefix
 ['+3740991234567','99123456'],     // +374 followed by a domestic 0
 ['99 123 456','99123456'],
 ['991234567890','99123456'],       // capped at 8 digits
 ['abc','' ],
 ['3','3'],['37','37'],['374','374'], // typing digit by digit is not mistaken for a country code
 ['37412345','37412345'],
];
for(const [input,want] of cases)assert.equal(digits(input),want,`digits(${JSON.stringify(input)})`);
assert.equal(e164('99123456'),'+37499123456');
assert.equal(e164('9912345'),null,'7 digits are not enough');
assert.equal(e164(''),null);
assert.equal(e164('09912345'),null,'a national number never starts with 0');
// Whatever the field holds is exactly what the server's normalizePhone accepts today.
for(const [input] of cases){const n=e164(digits(input));if(n)assert.equal(normalizePhone(n),n);}
assert.equal(e164(digits('099000000')),'+37499000000','demo number still reaches DEMO_PHONE');
// A pasted number from another country is refused, never turned into 8 plausible Armenian digits.
for(const f of ['+1 555 123 4567','+44 20 7946 0958','0044 20 7946 0958','+7 999 123 45 67','+3'+'5 1 234'])assert.equal(foreign(f),true,f);
for(const a of ['+','+3','+37','+374','+374 99 123 456','0037499123456','00','099123456','99123456','37499123456'])assert.equal(foreign(a),false,a);
console.log('Armenian phone input (foreign numbers refused): paste, leading 0, 00/374 prefixes, 8-digit cap and E.164 output PASS.');
