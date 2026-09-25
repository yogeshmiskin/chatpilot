function mins(v){const [h,m]=String(v).split(':').map(Number); return h*60+m;}
export function quiet(now, tz, start, end){
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);
  const h=Number(parts.find(p=>p.type==='hour')?.value||0), m=Number(parts.find(p=>p.type==='minute')?.value||0), cur=h*60+m;
  const s=mins(start), e=mins(end);
  return s<e ? cur>=s&&cur<e : cur>=s||cur<e;
}
