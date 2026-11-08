import type { StaffClinic, StaffDoctor } from './types';
type DoctorRow = {user_id:string;display_name:string;clinic_id:string|null;active:boolean};

export async function loadStaffDirectory(kind:'doctors'|'clinics',loaders:{clinics:()=>Promise<StaffClinic[]>;doctors:(includeEmail:boolean)=>Promise<StaffDoctor[]>}) {
  const [clinics,doctors]=await Promise.all([loaders.clinics(),loaders.doctors(kind==='doctors')]);
  return {clinics,doctors};
}

/** Keep email lookups out of operational lists and bound auth API concurrency. */
export async function doctorDirectoryRows(rows:DoctorRow[],includeEmail:boolean,resolveEmail:(id:string)=>Promise<string|null>):Promise<StaffDoctor[]> {
  const linked=rows.filter((r):r is DoctorRow & {clinic_id:string}=>!!r.clinic_id);
  const doctors:StaffDoctor[]=[];
  for(let start=0;start<linked.length;start+=8){
    const batch=await Promise.all(linked.slice(start,start+8).map(async row=>{
      const email=includeEmail?await resolveEmail(row.user_id):'';
      return email===null?null:{id:row.user_id,email,name:row.display_name,clinicId:row.clinic_id,active:row.active};
    }));
    doctors.push(...batch.filter((d):d is StaffDoctor=>d!==null));
  }
  return doctors;
}
