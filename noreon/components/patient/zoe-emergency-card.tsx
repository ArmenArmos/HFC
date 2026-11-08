"use client";
import { Component, type ReactNode } from "react";
import type { PatientLocale } from "@/lib/patient/copy";
import { ZoeUrgentContent } from "@/app/patient/zoe/urgent/content";
import type { CareAlertZoeStatus } from "@/lib/care-alerts/member";

/** If this presentation fails, the direct urgent page still has the same guidance and server status lookup. */
export class ZoeEmergencyFallback extends Component<{request:string|null;children:ReactNode;contained?:boolean},{failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  componentDidCatch() {
    // A broken card must reach a fresh server render even if the client router is unhealthy.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/patient/zoe/urgent${this.props.request ? `?request=${encodeURIComponent(this.props.request)}` : ""}`);
  }
  render() { return this.state.failed && this.props.contained ? <button type="button" onClick={() => { window.location.href = "tel:103"; }} className="emergency-call flex min-h-16 items-center justify-center rounded-md p-4">103</button> : this.state.failed ? <a href="tel:103" className="emergency-call flex min-h-16 items-center justify-center rounded-md p-4">103</a> : this.props.children; }
}

export function ZoeEmergencyCard({locale,request,contained=false,initial=null}:{locale:PatientLocale;request:string|null;contained?:boolean;initial?:CareAlertZoeStatus|null}) {
  return (
    <ZoeEmergencyFallback request={request} contained={contained}>
      <div role="alert" lang={locale} data-zoe-emergency-card className="w-full min-w-0 max-w-[85%] [overflow-wrap:anywhere]">
        <ZoeUrgentContent key={request ?? "unsaved"} locale={locale} request={request} initial={initial} inline contained={contained} />
      </div>
    </ZoeEmergencyFallback>
  );
}
