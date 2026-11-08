import{BackofficeSignInPage}from'@/components/backoffice/sign-in-page';
export default function RealLoginPage(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}){return <BackofficeSignInPage {...props}/>;}
