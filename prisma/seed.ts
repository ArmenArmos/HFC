import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const specialties = [
  { nameEn: 'Cardiology', nameHy: 'Սրտաբանություն', nameRu: 'Кардиология' },
  { nameEn: 'Oncology', nameHy: 'Ուռուցքաբանություն', nameRu: 'Онкология' },
  { nameEn: 'Neurology', nameHy: 'Նյարդաբանություն', nameRu: 'Неврология' },
  { nameEn: 'Orthopedics', nameHy: 'Օրթոպեդիա', nameRu: 'Ортопедия' },
  { nameEn: 'Gastroenterology', nameHy: 'Գաստրոէնտերոլոգիա', nameRu: 'Гастроэнтерология' },
  { nameEn: 'Pulmonology', nameHy: 'Թոքաբանություն', nameRu: 'Пульмонология' },
  { nameEn: 'Endocrinology', nameHy: 'Էնդոկրինոլոգիա', nameRu: 'Эндокринология' },
  { nameEn: 'Rheumatology', nameHy: 'Ռևմատոլոգիա', nameRu: 'Ревматология' },
  { nameEn: 'Dermatology', nameHy: 'Մաշկաբանություն', nameRu: 'Дерматология' },
  { nameEn: 'Ophthalmology', nameHy: 'Ակնաբուժություն', nameRu: 'Офтальмология' },
  { nameEn: 'Urology', nameHy: 'Ուրոլոգիա', nameRu: 'Урология' },
  { nameEn: 'Gynecology', nameHy: 'Գինեկոլոգիա', nameRu: 'Гинекология' },
  { nameEn: 'Nephrology', nameHy: 'Նեֆրոլոգիա', nameRu: 'Нефрология' },
  { nameEn: 'Hematology', nameHy: 'Հեմատոլոգիա', nameRu: 'Гематология' },
  { nameEn: 'Infectious Disease', nameHy: 'Վարակաբանություն', nameRu: 'Инфекционные болезни' },
  { nameEn: 'Psychiatry', nameHy: 'Հոգեբուժություն', nameRu: 'Психиатрия' },
  { nameEn: 'General Surgery', nameHy: 'Ընդհանուր Վիրաբուժություն', nameRu: 'Общая хирургия' },
  { nameEn: 'Pediatrics', nameHy: 'Մանկաբուժություն', nameRu: 'Педиатрия' },
  { nameEn: 'Radiology', nameHy: 'Ռադիոլոգիա', nameRu: 'Радиология' },
  { nameEn: 'General Medicine', nameHy: 'Ընդհանուր Բժշկություն', nameRu: 'Общая медицина' },
]

async function main() {
  console.log('Seeding specialties…')
  for (const s of specialties) {
    await db.specialty.upsert({
      where: { name: s.nameEn },
      create: { name: s.nameEn, nameEn: s.nameEn, nameHy: s.nameHy, nameRu: s.nameRu },
      update: { nameHy: s.nameHy, nameRu: s.nameRu },
    })
  }
  console.log(`✓ Seeded ${specialties.length} specialties`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
