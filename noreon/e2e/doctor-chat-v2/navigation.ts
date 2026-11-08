export function useRouter(){return {push(url:string){const f=(window as unknown as {fixture:{navigations?:string[]}}).fixture;(f.navigations??=[]).push(url);},refresh(){throw Error('Chat attempted a route refresh');}};}

export function unstable_rethrow(error:unknown){void error;}
