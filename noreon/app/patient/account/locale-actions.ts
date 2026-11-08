'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import { revalidatePath } from 'next/cache';
import { patientIdentity } from '@/lib/patient/auth';
import { patientStore } from '@/lib/patient/repository';
import { createLocaleService } from '@/lib/patient/locale-service';
import { persistLocale } from '@/lib/patient/locale-store';
export const saveLanguagePreference=loggedAction("saveLanguagePreference",async function saveLanguagePreference(input: unknown) {
  const result = await createLocaleService({user:patientIdentity,read:id=>patientStore().read(id),save:persistLocale}).saveLocale(input);
  if (result.ok) revalidatePath('/patient', 'layout');
  return result;
});
