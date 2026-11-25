const BASE='https://statistikdatabasen.scb.se/api/v2/tables/',$=id=>document.getElementById(id),fmt=v=>v==null?'–':v.toLocaleString('sv-SE',{maximumFractionDigits:1}),norm=s=>String(s).trim().toLowerCase();
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
 for(let start=0;start<years.length;start+=8){const p=new URLSearchParams({lang:'sv',outputFormat:'json-stat2'});for(const [k,v] of sel)p.set('valueCodes['+k+']',(k===time.id?v.slice(start,start+8):v).join(','));
 const j=await json(url+'/data?'+p),out=dims(j);
 for(let i=0;i<j.value.length;i++){const v=j.value[i];if(v==null||!Number.isFinite(Number(v)))continue;let n=i,rec={};for(let k=out.length-1;k>=0;k--){const d=out[k],ix=n%j.size[k];n=Math.floor(n/j.size[k]);rec[d.id]={key:d.keys[ix],label:d.labels[ix]}}const cat=kind==='housing'?norm(rec[house.id].label)+'|'+norm(rec[tenure.id].label):'population';const key=[rec[reg.id].key,rec[time.id].key,cat].join('|');const a=result.get(key)||[];a.push(Number(v));result.set(key,a)}
 }
 const count=sex?(sel.get(sex.id)?.length||1):1;return {names,values:new Map([...result].filter(([,a])=>a.length===count).map(([k,a])=>[k,a.reduce((s,v)=>s+v,0)])),years};
}
function rolling(year,fn){const v=Array.from({length:5},(_,i)=>fn(year-4+i));return v.every(Number.isFinite)?v.reduce((s,x)=>s+x,0)/5:null}
let housing,pop,areas=new Map(),fa=[],current=[],generation=0,cacheLoaded=false,cacheUpdated='';
const countyNames={'01':'Stockholms län','03':'Uppsala län','04':'Södermanlands län','05':'Östergötlands län','06':'Jönköpings län','07':'Kronobergs län','08':'Kalmar län','09':'Gotlands län','10':'Blekinge län','12':'Skåne län','13':'Hallands län','14':'Västra Götalands län','17':'Värmlands län','18':'Örebro län','19':'Västmanlands län','20':'Dalarnas län','21':'Gävleborgs län','22':'Västernorrlands län','23':'Jämtlands län','24':'Västerbottens län','25':'Norrbottens län'};
function options(){const type=$('type').value;const list=type==='fa'?fa:type==='county'?Object.entries(countyNames).map(([code,name])=>({code,name,members:[...areas.keys()].filter(k=>k.startsWith(code))})).filter(a=>a.members.length):[...areas].map(([code,name])=>({code,name,members:[code]}));$('area').replaceChildren(...list.sort((a,b)=>a.name.localeCompare(b.name,'sv')).map(a=>new Option(a.name,a.code)));const def=type==='municipality'?'2580':type==='county'?'25':'07';if(list.some(a=>a.code===def))$('area').value=def;$('area').disabled=!list.length;return list}
async function loadArea(){if(cacheLoaded){draw();drawCorrelation();drawScatter();drawRelationship();return}const token=++generation,a=current.find(a=>a.code===$('area').value);$('charts').replaceChildren();if(!a){$('status').textContent='Områdesunderlag saknas.';return}$('status').textContent='Hämtar statistik för '+a.name+' …';try{const [h,p1,p2]=await Promise.all([table('TAB4193','housing',a.members),table('TAB638','pop',a.members),table('TAB5557','pop',a.members)]);if(token!==generation)return;housing=h;pop={years:[...new Set([...p1.years,...p2.years])],values:new Map([...p1.values,...p2.values])};draw()}catch(e){if(token===generation)$('status').textContent='Data kunde inte hämtas för '+a.name+': '+e.message}}
function draw(){const a=current.find(a=>a.code===$('area').value);if(!a){$('charts').replaceChildren();$('status').textContent='Områdesunderlag saknas.';return}
 const get=(map,y,c)=>{const v=a.members.map(k=>map.get([k,y,c].join('|')));return v.every(Number.isFinite)?v.reduce((s,x)=>s+x,0):null};
 const years=housing.years.map(Number).filter(y=>y>=1995&&pop.years.includes(String(y))).sort((a,b)=>a-b);
 $('charts').replaceChildren();$('status').textContent=a.name+' · '+years[0]+'–'+years.at(-1)+' · fem års medelvärde'+(cacheLoaded?' · Förladdad statistik '+cacheUpdated.slice(0,10):' · Direkthämtad statistik');
 for(const c of categories){const rows=years.map(y=>({y,h:rolling(y,t=>get(housing.values,t,c)),p:rolling(y,t=>get(pop.values,t,'population'))}));const panel=document.createElement('article');panel.className='panel';const title=document.createElement('h2');title.textContent=c.replace('|',' – ');panel.append(title);const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 620 300');svg.setAttribute('role','img');svg.setAttribute('aria-label',title.textContent);const W=620,L=65,R=15,T=15,B=45,H=300,values=rows.flatMap(r=>[r.h,r.p]).filter(Number.isFinite);if(!values.length){panel.append('Inga fullständiga femårsperioder.');$('charts').append(panel);continue}
 const lo=Math.min(0,...values),hi=Math.max(1,...values),step=[1,2,5,10].map(n=>n*10**Math.floor(Math.log10(Math.max(1,(hi-lo)/5)))).find(n=>n>=(hi-lo)/5)||1,min=Math.floor(lo/step)*step,max=Math.ceil(hi/step)*step;
 const X=i=>L+i*(W-L-R)/Math.max(1,rows.length-1),Y=v=>T+(max-v)/(max-min)*(H-T-B);
 function node(tag,attrs,text){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!=null)e.textContent=text;svg.append(e);return e}
 for(let v=min;v<=max;v+=step){node('line',{x1:L,x2:W-R,y1:Y(v),y2:Y(v),stroke:v===0?'#667788':'#e3e7eb'});node('text',{x:L-7,y:Y(v)+4,'text-anchor':'end','font-size':11},fmt(v))}
 rows.forEach((r,i)=>{if(i%5===0||i===rows.length-1)node('text',{x:X(i),y:H-20,'font-size':11,'text-anchor':'middle'},r.y)});
 for(const [k,color,label] of [['h','#005aa7','Färdigställda bostäder'],['p','#b52c32','Folkökning']]){let seg=[];const flush=()=>{if(seg.length>1)node('polyline',{points:seg.join(' '),fill:'none',stroke:color,'stroke-width':2.5});seg=[]};rows.forEach((r,i)=>{if(!Number.isFinite(r[k])){flush();return}seg.push(X(i)+','+Y(r[k]))});flush();rows.forEach((r,i)=>{if(!Number.isFinite(r[k]))return;const pt=node('circle',{cx:X(i),cy:Y(r[k]),r:4,fill:color,tabindex:0});const tip=document.createElementNS(ns,'title');tip.textContent=(r.y-4)+'–'+r.y+' · '+label+': '+fmt(r[k]);pt.append(tip)})}
 panel.append(svg);const legend=document.createElement('p');legend.innerHTML='<span style="color:#005aa7">● Färdigställda bostäder</span> &nbsp; <span style="color:#b52c32">● Folkökning</span>';panel.append(legend);$('charts').append(panel)}
}
async function init(){try{try{const c=await json('data/bostadsbyggande.json');if(c.version!==1||c.areas.length!==290||c.fa.length!==71||!c.housing.values.length||!c.population.values.length)throw Error('Ogiltig cache');areas=new Map(c.areas);fa=c.fa;housing={years:c.housing.years,values:new Map(c.housing.values)};pop={years:c.population.years,values:new Map(c.population.values)};cacheUpdated=c.updated||'';analysisStock=c.stock?new Map(c.stock.values):null;analysisMigration=c.migration?{domestic:new Map(c.migration.domestic.values),total:new Map(c.migration.total.values)}:null;cacheLoaded=true;$('faOption').disabled=false;$('faNote').textContent='FA25: fast kommunindelning. Statistik för alla områden är förladdad.';current=options();draw();drawCorrelation();drawScatter();drawRelationship();return}catch(e){console.warn('Förladdad statistik saknas; använder SCB direkt',e)}const meta=dims(await json(BASE+'TAB4193/metadata?lang=sv')),reg=find(meta,/region/i);if(!reg)throw Error('Region saknas i bostadstabellen');const mapping=await json('data/fa25-housing.json').catch(()=>[]);const members=mapping.flatMap(a=>a.members);if(mapping.length===71&&members.length===290&&new Set(members).size===290)fa=mapping;const valid=fa.length?new Set(members):null;areas=new Map(reg.keys.map((k,i)=>[k,reg.labels[i]]).filter(([k])=>/^\d{4}$/.test(k)&&(!valid||valid.has(k))));if(!areas.size)throw Error('Inga kommunkoder i metadata');$('faOption').disabled=!fa.length;$('faNote').textContent=fa.length?'FA25: fast kommunindelning.':'FA25-underlag saknas eller är ofullständigt.';current=options();drawCorrelation();drawScatter();loadArea()}catch(e){$('status').textContent='Områdesmetadata kunde inte hämtas: '+e.message}}

function pearson(xs,ys){
 if(xs.length!==ys.length||xs.length<3||!xs.every(Number.isFinite)||!ys.every(Number.isFinite))return null;
 const n=xs.length,mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;
 let xy=0,xx=0,yy=0;for(let i=0;i<n;i++){const a=xs[i]-mx,b=ys[i]-my;xy+=a*b;xx+=a*a;yy+=b*b}
 return xx>0&&yy>0?Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))):null;
}
function correlationAt(year,n,fx,fy,smooth=false){
 const mean=(f,t)=>{const a=Array.from({length:n},(_,i)=>f(t-n+1+i));return a.every(Number.isFinite)?a.reduce((s,x)=>s+x,0)/n:null};
 const ys=Array.from({length:n},(_,i)=>year-n+1+i);
 return pearson(ys.map(t=>smooth?mean(fx,t):fx(t)),ys.map(t=>smooth?mean(fy,t):fy(t)));
}
const corrColors=['#005aa7','#c62828','#32866a','#a66e22','#6c5291','#455a64','#d05b9b','#00838f','#667000','#703b24','#335fba','#b24300'];
let corrExtra=new Set(),corrType='';
function corrAreas(){const type=$('type').value;if(type!==corrType){corrExtra.clear();corrType=type}const selected=$('area').value;corrExtra.delete(selected);return [current.find(a=>a.code===selected),...Array.from(corrExtra,c=>current.find(a=>a.code===c))].filter(Boolean)}
function corrMenu(){
 const picked=corrAreas(),q=$('corrSearch').value.trim().toLocaleLowerCase('sv-SE'),used=new Set(picked.map(a=>a.code));
 const options=current.filter(a=>!used.has(a.code)&&a.name.toLocaleLowerCase('sv-SE').includes(q));
 $('corrAdd').replaceChildren(...options.map(a=>new Option(a.name,a.code)));$('corrAddBtn').disabled=!options.length||!cacheLoaded;
 $('corrSelected').replaceChildren(...picked.map((a,i)=>{const btn=document.createElement('button');btn.type='button';btn.textContent=a.name+(i?' ×':' (huvudområde)');btn.style.borderLeft='5px solid '+corrColors[i%corrColors.length];btn.disabled=i===0;btn.onclick=()=>{corrExtra.delete(a.code);drawCorrelation()};return btn}));
 return picked;
}
function drawCorrelation(){
 const chosen=corrMenu(),root=$('corrChart');root.replaceChildren();
 if(!cacheLoaded){$('corrStatus').textContent='Jämförelsediagrammet kräver den förladdade kommunstatistiken.';return}
 if(!housing||!pop||!chosen.length)return;
 const n=+$('corrWindow').value,cat=$('corrCategory').value,smooth=$('corrMethod').value==='smooth';
 const years=housing.years.map(Number).filter(y=>pop.years.includes(String(y))).sort((a,b)=>a-b);
 const get=(map,a,y,c)=>{const vals=a.members.map(k=>map.get([k,y,c].join('|')));return vals.every(Number.isFinite)?vals.reduce((s,v)=>s+v,0):null};
 const series=chosen.map((a,i)=>{const fy=y=>get(pop.values,a,y,'population'),fx=y=>{if(cat!=='all')return get(housing.values,a,y,cat);const v=categories.map(c=>get(housing.values,a,y,c));return v.every(Number.isFinite)?v.reduce((s,x)=>s+x,0):null};return {name:a.name,color:corrColors[i%corrColors.length],rows:years.map(y=>({y,r:correlationAt(y,n,fx,fy,smooth)}))}});
 const valid=series.flatMap(s=>s.rows.filter(r=>Number.isFinite(r.r)).map(r=>r.y));
 if(!valid.length){$('corrStatus').textContent='Inga fullständiga fönster med varierande värden.';return}
 const first=Math.min(...valid),last=Math.max(...valid),W=1100,H=390,L=70,R=28,T=25,B=50;
 const X=y=>L+(y-first)*(W-L-R)/Math.max(1,last-first),Y=r=>T+(1-r)/2*(H-T-B),ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('role','img');svg.setAttribute('aria-label','Rullande Pearsonkorrelation per år');svg.style.width='100%';
 const node=(tag,attrs,txt)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(txt!=null)e.textContent=txt;svg.append(e);return e};
 for(let v=-1;v<=1;v+=.25){node('line',{x1:L,x2:W-R,y1:Y(v),y2:Y(v),stroke:v===0?'#667788':'#e3e7eb','stroke-width':v===0?1.5:1});node('text',{x:L-8,y:Y(v)+4,'text-anchor':'end','font-size':12},v.toLocaleString('sv-SE',{maximumFractionDigits:2}))}
 for(let y=first;y<=last;y++)if(y===first||y===last||y%5===0)node('text',{x:X(y),y:H-19,'text-anchor':'middle','font-size':12},y);
 for(const s of series){let seg=[];const flush=()=>{if(seg.length>1)node('polyline',{points:seg.join(' '),fill:'none',stroke:s.color,'stroke-width':2.6});seg=[]};let prev=null;for(const p of s.rows){if(!Number.isFinite(p.r)){flush();prev=null;continue}if(prev!==null&&p.y!==prev+1)flush();seg.push(X(p.y)+','+Y(p.r));prev=p.y}flush();for(const p of s.rows){if(!Number.isFinite(p.r))continue;const point=node('circle',{cx:X(p.y),cy:Y(p.r),r:4,fill:s.color,tabindex:0});const title=document.createElementNS(ns,'title');title.textContent=s.name+' · '+p.y+' · r = '+p.r.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})+' · '+(p.y-n+1)+'–'+p.y+(smooth?' (medelvärdespar)':'');point.append(title)}}
 root.append(svg);const legend=document.createElement('div');legend.style.display='flex';legend.style.flexWrap='wrap';legend.style.gap='16px';for(const s of series){const span=document.createElement('span');span.textContent='● '+s.name;span.style.color=s.color;legend.append(span)}root.append(legend);
 $('corrStatus').textContent=n+' år · '+(smooth?'korrelation mellan släpande medelvärden':'korrelation mellan årsvärden')+' · '+first+'–'+last+' · '+chosen.length+' områden';
}
$('corrCategory').replaceChildren(new Option('Samtliga sex kategorier','all'),...categories.map(c=>new Option(c.replace('|',' – '),c)));
for(const id of ['corrWindow','corrCategory','corrMethod'])$(id).onchange=drawCorrelation;
$('corrSearch').oninput=corrMenu;
$('corrAddBtn').onclick=()=>{if($('corrAdd').value)corrExtra.add($('corrAdd').value);drawCorrelation()};


let scatterMemo=null,benchmarkMemo=null;
function correlationSummary(values){
 const a=values.filter(Number.isFinite).sort((x,y)=>x-y),n=a.length;
 return {count:n,mean:n?a.reduce((x,y)=>x+y,0)/n:null,median:n?(a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2:null};
}
function areaCorrelation(a,years,n,cat,smooth){
 const get=(map,y,c)=>{const v=a.members.map(k=>map.get([k,y,c].join('|')));return v.length&&v.every(Number.isFinite)?v.reduce((s,x)=>s+x,0):null};
 const hx=new Map(),py=new Map();
 for(const y of years){const vals=cat==='all'?categories.map(c=>get(housing.values,y,c)):[get(housing.values,y,cat)];hx.set(y,vals.every(Number.isFinite)?vals.reduce((s,x)=>s+x,0):null);py.set(y,get(pop.values,y,'population'))}
 return years.map(y=>({code:a.code,name:a.name,y,r:correlationAt(y,n,t=>hx.get(t),t=>py.get(t),smooth)}));
}
function municipalBenchmarks(years,n,cat,smooth){
 const key=[n,cat,smooth].join('|');if(benchmarkMemo?.key===key)return benchmarkMemo.rows;
 const members=[...areas.keys()],byYear=new Map(years.map(y=>[y,[]]));
 for(const code of members)for(const p of areaCorrelation({code,name:areas.get(code),members:[code]},years,n,cat,smooth))if(Number.isFinite(p.r))byYear.get(p.y).push(p.r);
 const national=areaCorrelation({code:'SE',name:'Riket',members},years,n,cat,smooth);
 const rows=national.map(p=>({y:p.y,national:p.r,...correlationSummary(byYear.get(p.y))}));
 benchmarkMemo={key,rows};return rows;
}
function drawScatter(){
 const root=$('scatterChart'),status=$('scatterStatus');
 if(!cacheLoaded){root.replaceChildren();status.textContent='Punktdiagrammet kräver den förladdade kommunstatistiken.';return}
 const n=+$('scatterWindow').value,cat=$('scatterCategory').value,smooth=$('scatterMethod').value==='smooth',main=$('area').value,type=$('type').value;
 const key=[type,n,cat,smooth].join('|');
 if(scatterMemo?.key!==key){
  const years=housing.years.map(Number).filter(y=>pop.years.includes(String(y))).sort((a,b)=>a-b);
  const points=current.flatMap(a=>areaCorrelation(a,years,n,cat,smooth)).filter(p=>Number.isFinite(p.r));
  scatterMemo={key,points};
 }
 const points=scatterMemo.points;root.replaceChildren();
 const years=housing.years.map(Number).filter(y=>pop.years.includes(String(y))).sort((a,b)=>a-b);
 const benchmarks=municipalBenchmarks(years,n,cat,smooth);
 const lines=[{key:'mean',name:'Kommunmedel',color:'#b45309',dash:''},{key:'median',name:'Kommunmedian',color:'#16803c',dash:'7 4'},{key:'national',name:'Riket som ett område',color:'#b42318',dash:''}].filter(l=>$( 'scatterBench'+l.key).checked);
 const validYears=[...points.map(p=>p.y),...benchmarks.filter(p=>lines.some(l=>Number.isFinite(p[l.key]))).map(p=>p.y)];
 if(!validYears.length){status.textContent='Inga fullständiga fönster med varierande värden.';return}
 const first=Math.min(...validYears),last=Math.max(...validYears),W=1100,H=390,L=70,R=28,T=25,B=50;
 const X=y=>L+(y-first)*(W-L-R)/Math.max(1,last-first),Y=r=>T+(1-r)/2*(H-T-B),ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('role','img');svg.setAttribute('aria-label','Rullande korrelation för samtliga områden');
 const node=(tag,attrs,txt)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(txt!=null)e.textContent=txt;svg.append(e);return e};
 for(let v=-1;v<=1;v+=.25){node('line',{x1:L,x2:W-R,y1:Y(v),y2:Y(v),stroke:v===0?'#667788':'#e3e7eb','stroke-width':v===0?1.5:1});node('text',{x:L-8,y:Y(v)+4,'text-anchor':'end','font-size':12},v.toLocaleString('sv-SE',{maximumFractionDigits:2}))}
 for(let y=first;y<=last;y++)if(y===first||y===last||y%5===0)node('text',{x:X(y),y:H-19,'text-anchor':'middle','font-size':12},y);
 const radius=current.length>100?2.3:current.length>30?3:4;
 for(const p of [...points.filter(p=>p.code!==main),...points.filter(p=>p.code===main)]){
  const selected=p.code===main,point=node('circle',{cx:X(p.y),cy:Y(p.r),r:selected?4.5:radius,fill:selected?'#005aa7':'#667085','fill-opacity':selected?1:.32,stroke:selected?'#fff':'none','stroke-width':selected?.7:0});
  const title=document.createElementNS(ns,'title');title.textContent=p.name+' · '+p.y+' · r = '+p.r.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})+' · '+(p.y-n+1)+'–'+p.y+(smooth?' (medelvärdespar)':'');point.append(title);
 }
 for(const l of lines){
  let seg=[];const flush=()=>{if(seg.length>1)node('polyline',{points:seg.join(' '),fill:'none',stroke:l.color,'stroke-width':2.8,'stroke-dasharray':l.dash,'pointer-events':'none'});seg=[]};let previous=null;
  for(const p of benchmarks){if(!Number.isFinite(p[l.key])){flush();previous=null;continue}if(previous!==null&&p.y!==previous+1)flush();seg.push(X(p.y)+','+Y(p[l.key]));previous=p.y}flush();
  for(const p of benchmarks){if(!Number.isFinite(p[l.key]))continue;const point=node('circle',{cx:X(p.y),cy:Y(p[l.key]),r:3.5,fill:l.color,stroke:'#fff','stroke-width':.7,tabindex:0});const title=document.createElementNS(ns,'title');title.textContent=l.name+' · '+p.y+' · r = '+p[l.key].toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})+(l.key==='national'?' · '+areas.size+' kommuner summerade':' · '+p.count+' av '+areas.size+' kommuner');point.append(title)}
 }
 root.append(svg);
 const legend=document.createElement('div');legend.style.display='flex';legend.style.flexWrap='wrap';legend.style.gap='16px';const mainLabel=document.createElement('span');mainLabel.textContent='● '+(current.find(a=>a.code===main)?.name||'Huvudområde')+' (blå) · Övriga områden (grå)';legend.append(mainLabel);for(const l of lines){const label=document.createElement('span');label.style.color=l.color;label.textContent=(l.dash?'╌ ':'━ ')+l.name;legend.append(label)}root.append(legend);
 status.textContent=n+' år · '+(smooth?'korrelation mellan släpande medelvärden':'korrelation mellan årsvärden')+' · '+first+'–'+last+' · '+new Set(points.map(p=>p.code)).size+' av '+current.length+' områden med giltiga värden · '+points.length.toLocaleString('sv-SE')+' punkter';
}
$('scatterCategory').replaceChildren(new Option('Samtliga sex kategorier','all'),...categories.map(c=>new Option(c.replace('|',' – '),c)));
for(const id of ['scatterWindow','scatterCategory','scatterMethod','scatterBenchmean','scatterBenchmedian','scatterBenchnational'])$(id).onchange=drawScatter;
const housingNav=document.querySelector('.tabs');
function syncHousingNav(){document.documentElement.style.setProperty('--housing-nav-height',housingNav.getBoundingClientRect().height+'px')}
syncHousingNav();if(typeof ResizeObserver!=='undefined')new ResizeObserver(syncHousingNav).observe(housingNav);else window.addEventListener('resize',syncHousingNav);


let analysisStock=null,analysisMigration=null;
const symLog=(v,k)=>Math.sign(v)*Math.log10(1+Math.abs(v)/k);
const invSymLog=(v,k)=>Math.sign(v)*k*(10**Math.abs(v)-1);
function symlogTicks(lo,hi,k){const v=[0];for(let power=0;power<=Math.ceil(Math.log10(1+Math.max(Math.abs(lo),Math.abs(hi))/k));power++)for(const sign of [-1,1]){const x=sign*k*10**power;if(x>=lo&&x<=hi)v.push(x)}return v.filter(x=>x>=lo&&x<=hi).sort((a,b)=>a-b)}
function fitOLS(rows){
 if(rows.length<3)return null;const n=rows.length,mx=rows.reduce((s,p)=>s+p.x,0)/n,my=rows.reduce((s,p)=>s+p.y,0)/n;
 let xx=0,xy=0,yy=0;for(const p of rows){xx+=(p.x-mx)**2;xy+=(p.x-mx)*(p.y-my);yy+=(p.y-my)**2}
 if(!xx||!yy)return null;const slope=xy/xx;return {slope,intercept:my-slope*mx,r2:Math.min(1,xy*xy/(xx*yy))};
}
function analysisSeries(a,years,cat,relative,metric='population'){
 const get=(map,y,c)=>{const v=a.members.map(k=>map.get([k,y,c].join('|')));return v.length&&v.every(Number.isFinite)?v.reduce((s,x)=>s+x,0):null};
 return new Map(years.map(y=>{const vals=cat==='all'?categories.map(c=>get(housing.values,y,c)):[get(housing.values,y,cat)];let h=vals.every(Number.isFinite)?vals.reduce((s,x)=>s+x,0):null,p=get(metric==='population'?pop.values:analysisMigration[metric],y,'population');
 if(relative){const stock=analysisStock?get(analysisStock,y,'population'):null;if(!(stock>0)){h=p=null}else{h=h==null?null:1000*h/stock;p=p==null?null:1000*p/stock}}
 return [y,{h,p}]}));
}
function analysisMean(series,end,n,k){const v=Array.from({length:n},(_,i)=>series.get(end-n+1+i)?.[k]);return v.every(Number.isFinite)?v.reduce((s,x)=>s+x,0)/n:null}
function lagR(series,end,n,lag){const ys=Array.from({length:n},(_,i)=>end-n+1+i);return pearson(ys.map(y=>series.get(y+lag)?.h),ys.map(y=>series.get(y)?.p))}
function analysisSvg(id,xmin,xmax,ymin,ymax,xlabel,ylabel,scale=null){
 const root=$(id);root.replaceChildren();const ns='http://www.w3.org/2000/svg',W=900,H=350,L=80,R=24,T=22,B=62;
 if(xmin===xmax){xmin-=1;xmax+=1}if(ymin===ymax){ymin-=1;ymax+=1}
 const tx=x=>scale?symLog(x,scale):x,ty=y=>scale?symLog(y,scale):y;
 const X=x=>L+(tx(x)-tx(xmin))/(tx(xmax)-tx(xmin))*(W-L-R),Y=y=>T+(ty(ymax)-ty(y))/(ty(ymax)-ty(ymin))*(H-T-B),svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('role','img');svg.setAttribute('aria-label',xlabel+' mot '+ylabel);root.append(svg);
 const node=(tag,attrs,txt,parent=svg)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(txt!=null)e.textContent=txt;parent.append(e);return e};
 const tip=(e,t)=>node('title',{},t,e);
 const line=(x1,y1,x2,y2,stroke='#dfe5ec',width=1,dash='')=>node('line',{x1:X(x1),y1:Y(y1),x2:X(x2),y2:Y(y2),stroke,'stroke-width':width,'stroke-dasharray':dash});
 for(const v of scale?symlogTicks(ymin,ymax,scale):Array.from({length:6},(_,i)=>ymin+(ymax-ymin)*i/5)){line(xmin,v,xmax,v);node('text',{x:L-8,y:Y(v)+4,'text-anchor':'end','font-size':12},fmt(v))}
 for(const v of scale?symlogTicks(xmin,xmax,scale):Array.from({length:6},(_,i)=>xmin+(xmax-xmin)*i/5)){node('text',{x:X(v),y:H-B+20,'text-anchor':'middle','font-size':12},/År$/.test(xlabel)?String(Math.round(v)):fmt(v))}
 if(ymin<=0&&ymax>=0)line(xmin,0,xmax,0,'#667085',1.4);
 if(xmin<=0&&xmax>=0)line(0,ymin,0,ymax,'#667085',1.4);
 node('text',{x:(L+W-R)/2,y:H-12,'text-anchor':'middle','font-size':13},xlabel);node('text',{transform:'translate(16 '+(T+H-B)/2+') rotate(-90)','text-anchor':'middle','font-size':13},ylabel);
 return {root,svg,node,tip,line,X,Y,xmin,xmax,ymin,ymax};
}
function analysisBounds(v){return [Math.min(0,...v),Math.max(1,...v)]}
function analysisNote(id,t){$(id).textContent=t}
function analysisPoints(id,rows,relative,quadrant=false,metricLabel='Folkökning'){
 const unit=relative?' per 1 000 inv.':' per år',valid=rows.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));if(!valid.length){$(id).textContent='Inga fullständiga värden.';return}
 const [xmin,xmax]=analysisBounds(valid.map(p=>p.x)),[ymin,ymax]=analysisBounds(valid.map(p=>p.y)),scale=$('analysisScale').value==='symlog'?(relative?1:10):null,g=analysisSvg(id,xmin,xmax,ymin,ymax,metricLabel+unit,'Färdigställda bostäder'+unit,scale);
 if(quadrant){const m=correlationSummary(valid.map(p=>p.y)).median;g.line(xmin,m,xmax,m,'#b45309',2,'6 4');analysisNote('analysisQuadNote','Gränser: noll i '+metricLabel.toLowerCase()+' och medianen för bostadsbyggande ('+fmt(m)+unit+'). Relativa obalanser är inte ett mått på bostadsbrist.')}
 else{const fit=fitOLS(valid);if(fit){const ends=[xmin,xmax].map(x=>[x,fit.intercept+fit.slope*x]);const [a,b]=ends;const candidates=[a,b].filter(p=>p[1]>=ymin&&p[1]<=ymax);if(fit.slope!==0)for(const y of [ymin,ymax]){const x=(y-fit.intercept)/fit.slope;if(x>=xmin&&x<=xmax)candidates.push([x,y])}candidates.sort((a,b)=>a[0]-b[0]);if(candidates.length>=2){const a=candidates[0],b=candidates.at(-1);if(scale){const lo=symLog(a[0],scale),hi=symLog(b[0],scale);g.node('polyline',{points:Array.from({length:161},(_,i)=>{const x=invSymLog(lo+(hi-lo)*i/160,scale);return g.X(x)+','+g.Y(fit.intercept+fit.slope*x)}).join(' '),fill:'none',stroke:'#b42318','stroke-width':2.4})}else g.line(a[0],a[1],b[0],b[1],'#b42318',2.4)}analysisNote('analysisRegNote','Oviktad OLS: y = '+fit.slope.toLocaleString('sv-SE',{maximumFractionDigits:3})+' × x '+(fit.intercept<0?'−':'+')+' '+fmt(Math.abs(fit.intercept))+' · R² = '+fit.r2.toLocaleString('sv-SE',{maximumFractionDigits:3})+' · '+valid.length+' områden. Regressionen är skattad i originalenheter, inte logaritmerade värden. Sambandet kan påverkas av områdesstorlek.')}else analysisNote('analysisRegNote','Regression kan inte beräknas: otillräcklig variation.')}
 for(const p of [...valid.filter(p=>!p.selected),...valid.filter(p=>p.selected)])g.tip(g.node('circle',{cx:g.X(p.x),cy:g.Y(p.y),r:p.selected?5:3.3,fill:p.selected?'#005aa7':'#667085','fill-opacity':p.selected?1:.55}),p.name+' · '+metricLabel.toLowerCase()+' '+fmt(p.x)+' · bostäder '+fmt(p.y));
}
function drawRelationship(){
 if(!cacheLoaded||!housing||!pop){analysisNote('analysisStatus','Analysen kräver förladdad statistik.');return}
 const years=housing.years.map(Number).filter(y=>pop.years.includes(String(y))).sort((a,b)=>a-b),last=years.at(-1);
 if(!$('analysisYear').options.length){for(const y of years)$('analysisYear').add(new Option(y,y));$('analysisYear').value=last;for(const y of years)$('analysisStart').add(new Option(y,y));$('analysisStart').value=Math.max(years[0],last-10)}
 $('analysisRelative').disabled=!analysisStock;if(!analysisStock)$('analysisRelative').checked=false;
 const end=+$('analysisYear').value,n=+$('analysisWindow').value,cat=$('analysisCategory').value,relative=$('analysisRelative').checked,main=$('area').value,a=current.find(a=>a.code===main);if(!a)return;
 $('analysisMetric').querySelectorAll('option').forEach(o=>{o.disabled=o.value!=='population'&&!analysisMigration});if(!analysisMigration)$('analysisMetric').value='population';
 const metric=$('analysisMetric').value,metricLabel=$('analysisMetric').selectedOptions[0].text;
 const selected=analysisSeries(a,years,cat,relative,metric);
 analysisNote('analysisStatus',a.name+' · '+(end-n+1)+'–'+end+(analysisStock?'':' · Folkmängd för relativa mått ännu inte förladdad.'));
 const rows=current.map(a=>{const s=analysisSeries(a,years,cat,relative,metric);return {name:a.name,selected:a.code===main,x:analysisMean(s,end,n,'p'),y:analysisMean(s,end,n,'h')}});
 analysisPoints('analysisRegression',rows,relative,false,metricLabel);analysisPoints('analysisQuadrant',rows,relative,true,metricLabel);
 // Common support for all lags; end year always means the last population observation.
 const lagEnd=Math.min(end,last-5),lags=Array.from({length:11},(_,i)=>i-5),lagRows=lags.map(l=>({l,r:lagR(selected,lagEnd,n,l)}));
 const g=analysisSvg('analysisLag',-5.5,5.5,-1,1,'Bostädernas tidsförskjutning (år)','Pearsons r');
 for(const p of lagRows){if(!Number.isFinite(p.r))continue;const x=g.X(p.l),y=g.Y(p.r),zero=g.Y(0);g.tip(g.node('rect',{x:x-13,y:Math.min(y,zero),width:26,height:Math.abs(y-zero),fill:p.l===0?'#b42318':'#005aa7'}),p.l+' år · r = '+p.r.toFixed(3).replace('.',','))}
 analysisNote('analysisLagNote','Gemensam period för '+metricLabel.toLowerCase()+' '+(lagEnd-n+1)+'–'+lagEnd+' för jämförbara förskjutningar. Negativ förskjutning = bostäder före valt befolkningsmått, positiv = bostäder efter. Saknade år ger luckor.');
 const absolute=analysisSeries(a,years,cat,false),start=+$('analysisStart').value,hh=+$('analysisHousehold').value;let h=0,p=0,complete=true;const cum=[{y:start-1,h:0,p:0,need:0}];
 for(let y=start;y<=end;y++){const v=absolute.get(y);if(!v||!Number.isFinite(v.h)||!Number.isFinite(v.p))complete=false;if(!complete)break;h+=v.h;p+=v.p;cum.push({y,h,p,need:p/hh})}
 if(start>end){$('analysisCumulative').textContent='Startåret måste vara före eller lika med slutåret.'}else{const [lo,hi]=analysisBounds(cum.flatMap(p=>[p.h,p.p,p.need])),g=analysisSvg('analysisCumulative',start-1,end,lo,hi,'År','Kumulativ förändring');for(const [key,color,name] of [['h','#005aa7','Färdigställda bostäder'],['p','#b42318','Folkökning'],['need','#16803c','Teoretiskt bostadsbehov']]){if(cum.length>1)g.node('polyline',{points:cum.map(p=>g.X(p.y)+','+g.Y(p[key])).join(' '),fill:'none',stroke:color,'stroke-width':2.5});for(const p of cum)g.tip(g.node('circle',{cx:g.X(p.y),cy:g.Y(p[key]),r:3,fill:color}),p.y+' · '+name+' '+fmt(p[key]))}}
 analysisNote('analysisCumNote','Blå: bostäder · Röd: personer · Grön: folkökning / '+fmt(hh)+' personer per hushåll. Alltid absoluta tal. Teoretiskt behov är ett scenario, inte ett konstaterat behov.'+(!complete?' Serien avbryts vid första saknade år.':''));
 const heatYears=years.filter(y=>y<=end),root=$('analysisHeat');root.replaceChildren();const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 900 310');svg.setAttribute('role','img');svg.setAttribute('aria-label','Rullande tidsförskjuten korrelation');root.append(svg);const w=810/heatYears.length;
 function node(tag,attrs,txt,parent=svg){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(txt!=null)e.textContent=txt;parent.append(e);return e}
 for(const [i,l] of lags.entries()){node('text',{x:48,y:30+i*22,'text-anchor':'end','font-size':12},l);for(const [j,y] of heatYears.entries()){const r=lagR(selected,y,n,l),fill=!Number.isFinite(r)?'#e5e7eb':r>=0?'#16803c':'#b42318';const rect=node('rect',{x:55+j*w,y:15+i*22,width:Math.max(1,w-1),height:21,fill,'fill-opacity':Number.isFinite(r)?Math.max(.08,Math.abs(r)):1});node('title',{},y+' · '+l+' år · '+(Number.isFinite(r)?r.toFixed(3).replace('.',','):'saknas'),rect)}}
 for(const [j,y] of heatYears.entries())if(j===0||j===heatYears.length-1||y%5===0)node('text',{x:55+(j+.5)*w,y:277,'text-anchor':'middle','font-size':11},y);
 node('text',{x:460,y:302,'text-anchor':'middle','font-size':13},'Slutår för '+metricLabel.toLowerCase()+'');
 analysisNote('analysisHeatNote','Grön = positiv, röd = negativ, grå = saknas. Färgstyrkan visar |r|. Förskjutna bostadsår kan ligga efter valt slutår men aldrig efter senaste publicerade data; detta är retrospektiv analys.');
}
$('analysisCategory').replaceChildren(new Option('Samtliga sex kategorier','all'),...categories.map(c=>new Option(c.replace('|',' – '),c)));
for(const id of ['analysisYear','analysisStart','analysisWindow','analysisCategory','analysisRelative','analysisHousehold','analysisScale','analysisMetric'])$(id).onchange=drawRelationship;

$('type').onchange=()=>{current=options();loadArea();if(!cacheLoaded){drawCorrelation();drawScatter()}};$('area').onchange=()=>{loadArea();if(!cacheLoaded)drawCorrelation()};init();
