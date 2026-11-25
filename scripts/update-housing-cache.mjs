import {readFile,writeFile,rename} from 'node:fs/promises';
const BASE='https://statistikdatabasen.scb.se/api/v2/tables/',fmt=v=>v==null?'–':v.toLocaleString('sv-SE',{maximumFractionDigits:1}),norm=s=>String(s).trim().toLowerCase();
const categories=['småhus|äganderätt','småhus|bostadsrätt','småhus|hyresrätt','flerbostadshus|äganderätt','flerbostadshus|bostadsrätt','flerbostadshus|hyresrätt'];
async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('HTTP '+r.status+' '+url);return r.json()}
function dims(j){return j.id.map(id=>{const d=j.dimension[id],c=d.category,ix=c.index,keys=Array.isArray(ix)?ix:Object.keys(ix).sort((a,b)=>ix[a]-ix[b]);return {id,name:d.label||id,elimination:!!d.extension?.elimination,keys,labels:keys.map(k=>c.label?.[k]||k)}})}
const find=(ds,re)=>ds.find(d=>re.test(d.id+' '+d.name));
function total(d){const i=d.labels.findIndex(l=>/^(totalt|total|samtliga)(,|$)|^alla åldrar$|^båda könen$/i.test(l));if(i>=0)return [d.keys[i]];const k=d.keys.find(k=>/^(tot(sa)?|sum|samt|totalt)$/i.test(k));if(k)return [k];return []}
async function table(id,kind,members){
 const url=BASE+id,ds=dims(await json(url+'/metadata?lang=sv')),reg=find(ds,/region/i),time=find(ds,/tid|^år\b|time/i),house=find(ds,/hustyp/i),tenure=find(ds,/upplåtelseform|upplatelseform/i),sex=find(ds,/kön|kon\b/i),measure=find(ds,/contentscode|tabellinnehåll/i);
 if(!reg||!time||kind==='housing'&&(!house||!tenure)||kind==='pop'&&!measure)throw Error('Okända dimensioner '+id);
 const regions=reg.keys.filter(k=>/^\d{4}$/.test(k)&&members.includes(k)),years=time.keys.filter(k=>/^\d{4}$/.test(k)&&+k>=1991&&+k<new Date().getFullYear()),sel=new Map([[reg.id,regions],[time.id,years]]);
 for(const d of ds){if(sel.has(d.id))continue;let keys;if(d===house||d===tenure)keys=d.keys;else if(d===measure&&kind==='pop')keys=d.keys.filter((k,i)=>norm(d.labels[i])==='folkökning');else if(d===sex)keys=total(d).length?total(d):d.keys.filter((k,i)=>/^(män|kvinnor)$/.test(norm(d.labels[i])));else keys=d.keys.length===1?d.keys:total(d);if(!keys.length&&d.elimination)continue;if(!keys.length)throw Error('Kan inte välja total för '+id+' '+d.id+': '+d.labels.slice(0,8).join(', '));sel.set(d.id,keys)}
 const result=new Map(),names=new Map(regions.map(k=>[k,reg.labels[reg.keys.indexOf(k)]]));
 for(let regionStart=0;regionStart<regions.length;regionStart+=40)for(let start=0;start<years.length;start+=8){const p=new URLSearchParams({lang:'sv',outputFormat:'json-stat2'});for(const [k,v] of sel)p.set('valueCodes['+k+']',(k===time.id?v.slice(start,start+8):k===reg.id?v.slice(regionStart,regionStart+40):v).join(','));
 const j=await json(url+'/data?'+p),out=dims(j);
 for(let i=0;i<j.value.length;i++){const v=j.value[i];if(v==null||!Number.isFinite(Number(v)))continue;let n=i,rec={};for(let k=out.length-1;k>=0;k--){const d=out[k],ix=n%j.size[k];n=Math.floor(n/j.size[k]);rec[d.id]={key:d.keys[ix],label:d.labels[ix]}}const cat=kind==='housing'?norm(rec[house.id].label)+'|'+norm(rec[tenure.id].label):'population';const key=[rec[reg.id].key,rec[time.id].key,cat].join('|');const a=result.get(key)||[];a.push(Number(v));result.set(key,a)}
 }
 if(!result.size)throw Error('No data for '+id);const count=sex?(sel.get(sex.id)?.length||1):1;return {names,values:new Map([...result].filter(([,a])=>a.length===count).map(([k,a])=>[k,a.reduce((s,v)=>s+v,0)])),years};
}

const fa=JSON.parse(await readFile('data/fa25-housing.json','utf8'));
const members=fa.flatMap(a=>a.members);
if(fa.length!==71||members.length!==290||new Set(members).size!==290)throw Error('Invalid FA25 geography');
const h=await table('TAB4193','housing',members);
const p1=await table('TAB638','pop',members);
const p2=await table('TAB5557','pop',members);
if(h.names.size!==290)throw Error('Missing municipalities in housing metadata: '+h.names.size);
const pack=t=>({years:[...new Set(t.years)].sort(),values:[...t.values]});
const p={years:[...p1.years,...p2.years],values:new Map([...p1.values,...p2.values])};
for(const code of members){if(![...h.values.keys()].some(k=>k.startsWith(code+'|'))||![...p.values.keys()].some(k=>k.startsWith(code+'|')))throw Error('No data for municipality '+code)}
for(const cat of categories)if(![...h.values.keys()].some(k=>k.endsWith('|'+cat)))throw Error('Missing category '+cat);
const payload={version:1,areas:[...h.names],fa,housing:pack(h),population:pack(p)};
let old;try{old=JSON.parse(await readFile('data/bostadsbyggande.json','utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
if(old){delete old.updated;if(JSON.stringify(old)===JSON.stringify(payload)){console.log('No changed housing data');process.exit(0)}}
payload.updated=new Date().toISOString();await writeFile('data/bostadsbyggande.json.tmp',JSON.stringify(payload));await rename('data/bostadsbyggande.json.tmp','data/bostadsbyggande.json');
console.log('Housing rows',h.values.size,'population rows',p.values.size,'municipalities',h.names.size,'FA regions',fa.length);
