(function(){
  "use strict";
  let data=window.MODEL_DATA;
  const validation=window.MODEL_VALIDATION||null;
  const backtest=window.MODEL_BACKTEST||null;
  const scbComparison=window.SCB_BENCHMARK_COMPARISON||null;
  let latest=[];
  let baseline=[];

  const $=id=>document.getElementById(id);
  const fmt=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:0});
  const fmt1=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:1});
  const pct=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:1});

  const defaultHousing=[{
    active:false,year:2030,municipality:"2580",dwellingType:"småhus",
    tenure:"äganderätt",size:"5+",dwellings:1000,completionPct:100,
    occupancyPct:95,personsPerDwelling:2.0,externalSharePct:50,
    internalSharePct:25,phaseYears:3
  }];
  const defaultWorkplaces=[{
    active:false,year:2034,municipality:"2580",jobs:1000,
    realizationPct:60,moveSharePct:35,personsPerJob:1.7,
    hostResidencePct:60,internalSharePct:20,phaseYears:4
  }];

  function setup(){
    fillGeo();
    bindTabs();
    renderScenarioTables();
    $("runBtn").addEventListener("click",run);
    $("dataFile").addEventListener("change",loadFile);
    $("exportBtn").addEventListener("click",exportCsv);
    $("addHousing").addEventListener("click",()=>{syncScenarioTables();defaultHousing.push(blankHousing());renderScenarioTables();});
    $("addWorkplace").addEventListener("click",()=>{syncScenarioTables();defaultWorkplaces.push(blankWorkplace());renderScenarioTables();});
    ["geo","window","endYear"].forEach(id=>$(id).addEventListener("change",run));
    renderDataStatus();
    renderStatus();
    if(data?.meta?.dataReady) run();
  }

  function bindTabs(){
    document.querySelectorAll(".tab").forEach(btn=>{
      btn.addEventListener("click",()=>{
        document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===btn));
        document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${btn.dataset.page}`));
      });
    });
  }

  function municipalityOptions(selected){
    return data.geographies.filter(g=>g.code!=="FA_LULEA")
      .map(g=>`<option value="${g.code}" ${g.code===selected?"selected":""}>${g.name}</option>`).join("");
  }
  function simpleOptions(values,selected){
    return values.map(v=>`<option value="${v}" ${v===selected?"selected":""}>${v}</option>`).join("");
  }
  function fillGeo(){
    $("geo").innerHTML=data.geographies.map(g=>`<option value="${g.code}">${g.name}</option>`).join("");
  }
  function blankHousing(){
    return {active:true,year:2030,municipality:"2580",dwellingType:"flerbostadshus",tenure:"hyresrätt",size:"2 rum",dwellings:100,completionPct:100,occupancyPct:95,personsPerDwelling:1.6,externalSharePct:50,internalSharePct:25,phaseYears:3};
  }
  function blankWorkplace(){
    return {active:true,year:2034,municipality:"2580",jobs:1000,realizationPct:60,moveSharePct:35,personsPerJob:1.7,hostResidencePct:60,internalSharePct:20,phaseYears:4};
  }

  function renderScenarioTables(){
    const hBody=$("housingTable").querySelector("tbody");
    hBody.innerHTML=defaultHousing.map((s,i)=>`<tr data-i="${i}">
      <td><input data-k="active" type="checkbox" ${s.active?"checked":""}></td>
      <td><input data-k="year" type="number" value="${s.year}" min="2025" max="2070"></td>
      <td><select data-k="municipality">${municipalityOptions(s.municipality)}</select></td>
      <td><select data-k="dwellingType">${simpleOptions(["småhus","flerbostadshus"],s.dwellingType)}</select></td>
      <td><select data-k="tenure">${simpleOptions(["äganderätt","hyresrätt","bostadsrätt"],s.tenure)}</select></td>
      <td><select data-k="size">${simpleOptions(["1 rum","2 rum","3 rum","4 rum","5+"],s.size)}</select></td>
      <td><input data-k="dwellings" type="number" value="${s.dwellings}" min="0"></td>
      <td><input data-k="completionPct" type="number" value="${s.completionPct}" min="0" max="100"></td>
      <td><input data-k="occupancyPct" type="number" value="${s.occupancyPct}" min="0" max="100"></td>
      <td><input data-k="personsPerDwelling" type="number" value="${s.personsPerDwelling}" min="0" step="0.1"></td>
      <td><input data-k="externalSharePct" type="number" value="${s.externalSharePct}" min="0" max="100"></td>
      <td><input data-k="internalSharePct" type="number" value="${s.internalSharePct}" min="0" max="100"></td>
      <td><input data-k="phaseYears" type="number" value="${s.phaseYears}" min="1" max="20"></td>
      <td><button class="secondary removeHousing compact" data-i="${i}">×</button></td>
    </tr>`).join("");

    const wBody=$("workplaceTable").querySelector("tbody");
    wBody.innerHTML=defaultWorkplaces.map((s,i)=>`<tr data-i="${i}">
      <td><input data-k="active" type="checkbox" ${s.active?"checked":""}></td>
      <td><input data-k="year" type="number" value="${s.year}" min="2025" max="2070"></td>
      <td><select data-k="municipality">${municipalityOptions(s.municipality)}</select></td>
      <td><input data-k="jobs" type="number" value="${s.jobs}" min="0"></td>
      <td><input data-k="realizationPct" type="number" value="${s.realizationPct}" min="0" max="100"></td>
      <td><input data-k="moveSharePct" type="number" value="${s.moveSharePct}" min="0" max="100"></td>
      <td><input data-k="personsPerJob" type="number" value="${s.personsPerJob}" min="0" step="0.1"></td>
      <td><input data-k="hostResidencePct" type="number" value="${s.hostResidencePct}" min="0" max="100"></td>
      <td><input data-k="internalSharePct" type="number" value="${s.internalSharePct}" min="0" max="100"></td>
      <td><input data-k="phaseYears" type="number" value="${s.phaseYears}" min="1" max="20"></td>
      <td><button class="secondary removeWorkplace compact" data-i="${i}">×</button></td>
    </tr>`).join("");

    document.querySelectorAll(".removeHousing").forEach(b=>b.addEventListener("click",()=>{syncScenarioTables();defaultHousing.splice(+b.dataset.i,1);renderScenarioTables();run();}));
    document.querySelectorAll(".removeWorkplace").forEach(b=>b.addEventListener("click",()=>{syncScenarioTables();defaultWorkplaces.splice(+b.dataset.i,1);renderScenarioTables();run();}));
  }

  function readRows(tableId){
    return [...$(tableId).querySelectorAll("tbody tr")].map(tr=>{
      const obj={};
      tr.querySelectorAll("[data-k]").forEach(el=>{
        const k=el.dataset.k;
        obj[k]=el.type==="checkbox"?el.checked:(el.tagName==="SELECT"?el.value:Number(el.value));
      });
      return obj;
    });
  }
  function syncScenarioTables(){
    defaultHousing.splice(0,defaultHousing.length,...readRows("housingTable"));
    defaultWorkplaces.splice(0,defaultWorkplaces.length,...readRows("workplaceTable"));
  }
  function currentScenarios(){
    syncScenarioTables();
    return {
      housing:defaultHousing.map(x=>({...x})),
      workplaces:defaultWorkplaces.map(x=>({...x})),
      overlapPct:+$("overlapPct").value
    };
  }

  function renderStatus(msg){
    const ready=!!data?.meta?.dataReady && data.populationBase?.length>0;
    $("status").className="status"+(ready?" ok":"");
    $("status").textContent=msg || (ready?"Modell, SCB-data och prognosprofiler är inlästa.":"Modell-data saknas.");
  }

  function renderDataStatus(){
    const ckmCount=(data.diagnostics?.ckm||[]).length;
    $("dataStatus").innerHTML=`
      <div class="kv"><span>Data ready</span><strong>${data.meta.dataReady?"Ja":"Nej"}</strong></div>
      <div class="kv"><span>Basår</span><strong>${data.meta.baseYear}</strong></div>
      <div class="kv"><span>Modellschema</span><strong>${data.meta.schemaVersion||"–"}</strong></div>
      <div class="kv"><span>Framtidsprofil</span><strong>${data.parameters?.futureNationalProfileMode||"–"}</strong></div>
      <div class="kv"><span>Metodbrott</span><strong>${data.meta.methodBreakYear} · CKM</strong></div>
      <div class="kv"><span>CKM-diagnostik</span><strong>${ckmCount} poster</strong></div>`;
    renderFadingPolicy();
  }

  function renderFadingPolicy(){
    const p=data.diagnostics?.relativeFactors?.fallbackFading;
    if(!p){$("fadingPolicy").innerHTML="<p>Ingen fading-policy hittades.</p>";return;}
    $("fadingPolicy").innerHTML=`
      <div class="policyGrid">
        <div><span>0 % lokal vikt t.o.m.</span><strong>${p.zeroLocalExposure??"–"}</strong></div>
        <div><span>100 % populationssignal från</span><strong>${p.fullLocalExposure??"–"}</strong></div>
        <div><span>100 % händelsesignal från</span><strong>${p.fullExpectedEvents??"–"}</strong></div>
        <div><span>Max lokal vikt</span><strong>${pct.format((p.maxLocalWeight||0)*100)} %</strong></div>
        <div><span>Resultatstyrd?</span><strong>${p.weightDependsOnOutcome===false?"Nej":"–"}</strong></div>
      </div>
      <p class="hint">${p.governance||""}</p>`;
  }

  async function loadFile(ev){
    const file=ev.target.files?.[0]; if(!file)return;
    try{
      const parsed=JSON.parse(await file.text());
      if(!parsed.meta||!parsed.geographies) throw new Error("Ogiltigt schema.");
      data=parsed; fillGeo(); renderScenarioTables(); renderDataStatus(); run();
    }catch(e){renderStatus("Kunde inte läsa datafil: "+e.message);}
  }

  function run(){
    try{
      const common={
        geo:$("geo").value,
        endYear:+$("endYear").value,
        fertMult:+$("fertMult").value,
        mortMult:+$("mortMult").value,
        migMult:+$("migMult").value,
        window:+$("window").value
      };
      baseline=RAPSModel.simulate(data,{
        ...common,
        scenarios:{housing:[],workplaces:[],overlapPct:0}
      });
      latest=RAPSModel.simulate(data,{
        ...common,
        scenarios:currentScenarios()
      });
      renderAll();
      renderStatus("Beräkningen genomfördes.");
      $("exportBtn").disabled=false;
    }catch(e){
      latest=[];baseline=[];$("exportBtn").disabled=true;renderStatus(e.message);
    }
  }

  function renderAll(){
    renderResults();
    renderAnalysis();
    renderValidation();
    renderDataStatus();
  }

  function renderResults(){
    if(!latest.length)return;
    const first=latest[0], last=latest.at(-1);
    $("startPop").textContent=fmt.format(first.population);
    $("endPop").textContent=fmt.format(last.population);
    $("changePop").textContent=(last.population-first.population>=0?"+":"")+fmt.format(last.population-first.population);
    $("changePct").textContent=(last.population>=first.population?"+":"")+pct.format((last.population-first.population)/first.population*100)+" %";
    $("startYearLabel").textContent=first.year;
    $("endYearLabel").textContent=last.year;
    const baselineEnd=baseline.length?baseline.at(-1).population:last.population;
    const scenarioTotal=last.population-baselineEnd;
    $("scenarioKpi").textContent=(scenarioTotal>=0?"+":"")+fmt.format(scenarioTotal);
    $("chartCaption").textContent=`${first.year}–${last.year}`;

    $("resultsTable").querySelector("tbody").innerHTML=latest.map(r=>`<tr>
      <td>${r.year}</td><td>${fmt.format(r.population)}</td><td>${fmt.format(r.births)}</td>
      <td>${fmt.format(r.deaths)}</td><td>${fmt.format(r.netMigration)}</td>
      <td>${r.scenarioEffect>=0?"+":""}${fmt.format(r.scenarioEffect||0)}</td>
      <td>${r.change>=0?"+":""}${fmt.format(r.change)}</td></tr>`).join("");
    drawPopulationChart(latest,baseline);
    drawComponentsChart(latest.slice(1));
    renderBenchmarkCards();
  }

  function renderBenchmarkCards(){
    const geo=$("geo").value, w=String($("window").value);
    const rows=scbComparison?.results?.[geo]?.[w]||[];
    const targetYear=+$("endYear").value;
    const r=rows.find(x=>+x.year===targetYear)||rows.at(-1);
    if(!r){
      $("benchmarkCards").innerHTML="<p class='hint'>Benchmarkdata genereras i nästa workflow-körning.</p>";return;
    }
    $("benchmarkCards").innerHTML=`
      <div class="kv"><span>Modell ${r.year}</span><strong>${fmt.format(r.modelPopulation)}</strong></div>
      <div class="kv"><span>SCB ${r.year}</span><strong>${fmt.format(r.scbPopulation)}</strong></div>
      <div class="kv"><span>SCB omankrad till faktisk 2025</span><strong>${fmt.format(r.scbRebasedToActual2025)}</strong></div>
      <div class="kv"><span>Skillnad mot omankrad SCB</span><strong>${r.differenceVsRebasedScb>=0?"+":""}${fmt.format(r.differenceVsRebasedScb)} (${r.differenceVsRebasedScbPct>=0?"+":""}${pct.format(r.differenceVsRebasedScbPct)} %)</strong></div>`;
  }

  function renderAnalysis(){
    const geo=$("geo").value;
    renderWindowComparison(geo);
    renderRelativeFactors(geo);
    renderAgeStructure(geo);
    renderBalanceSummary();
    renderFadingExamples(geo);
  }

  function renderWindowComparison(geo){
    const f=validation?.forecasts?.[geo];
    if(!f){$("windowComparison").innerHTML="<p class='hint'>Valideringsdata genereras i nästa workflow-körning.</p>";return;}
    $("windowComparison").innerHTML=`<table class="miniTable"><thead><tr><th>Fönster</th><th>2050</th><th>Förändring</th></tr></thead><tbody>
      ${[6,10,19].map(w=>`<tr><td>${w} år</td><td>${fmt.format(f[w]?.endPopulation||0)}</td><td>${(f[w]?.changePct||0)>=0?"+":""}${pct.format(f[w]?.changePct||0)} %</td></tr>`).join("")}
      </tbody></table>`;
  }

  function renderRelativeFactors(geo){
    const rf=validation?.relativeFactors||data.diagnostics?.relativeFactors;
    const fert=rf?.fertility||[], mort=rf?.mortality||[];
    $("relativeFactors").innerHTML=`<table class="miniTable"><thead><tr><th>Fönster</th><th>Fruktsamhet</th><th>Dödlighet</th></tr></thead><tbody>
      ${[6,10,19].map(w=>{
        const a=fert.find(x=>x.geo===geo&&+x.window===w);
        const b=mort.find(x=>x.geo===geo&&+x.window===w);
        return `<tr><td>${w} år</td><td>${a?pct.format(a.raw*100)+" %":"–"}</td><td>${b?pct.format(b.raw*100)+" %":"–"}</td></tr>`;
      }).join("")}
      </tbody></table>
      <p class="hint">100 % = rikets åldersstandardiserade nivå. Fading sker därefter per ålderscell.</p>`;
  }

  function renderAgeStructure(geo){
    const bands=[
      {name:"0–14",min:0,max:14},{name:"15–24",min:15,max:24},{name:"25–44",min:25,max:44},
      {name:"45–64",min:45,max:64},{name:"65–79",min:65,max:79},{name:"80+",min:80,max:100}
    ];
    const rows=data.populationBase.filter(r=>r.geo===geo&&+r.year===+data.meta.baseYear);
    const totals=bands.map(b=>{
      const rr=rows.filter(r=>+r.age>=b.min&&+r.age<=b.max);
      return {name:b.name,k:rr.filter(r=>r.sex==="K").reduce((s,r)=>s+Number(r.value||0),0),m:rr.filter(r=>r.sex==="M").reduce((s,r)=>s+Number(r.value||0),0)};
    });
    const max=Math.max(1,...totals.map(x=>x.k+x.m));
    $("ageStructure").innerHTML=totals.map(x=>`<div class="ageRow">
      <span>${x.name}</span><div class="barTrack"><div class="barFill" style="width:${(x.k+x.m)/max*100}%"></div></div>
      <strong>${fmt.format(x.k+x.m)}</strong><small>K ${fmt.format(x.k)} · M ${fmt.format(x.m)}</small>
      </div>`).join("");
  }

  function renderFadingExamples(geo){
    const w=String($("window").value);
    const ex=validation?.fadingExamples?.[geo]?.[w];
    if(!ex){
      $("fadingExamples").innerHTML="<p class='hint'>Fadingdiagnostik genereras i nästa workflow-körning.</p>";
      return;
    }
    const fertRows=(ex.fertility||[]).map(r=>`<tr><td>${r.age}</td><td>${r.averageAnnualExposure==null?"–":fmt1.format(r.averageAnnualExposure)}</td><td>${r.expectedEvents==null?"–":fmt1.format(r.expectedEvents)}</td><td>${r.localWeight==null?"–":pct.format(r.localWeight)+" %"}</td><td>${r.rawCellFactor==null?"–":pct.format(r.rawCellFactor*100)+" %"}</td></tr>`).join("");
    const mortRows=(ex.mortality||[]).map(r=>`<tr><td>${r.age}</td><td>${r.sex}</td><td>${r.averageAnnualExposure==null?"–":fmt1.format(r.averageAnnualExposure)}</td><td>${r.expectedEvents==null?"–":fmt1.format(r.expectedEvents)}</td><td>${r.localWeight==null?"–":pct.format(r.localWeight)+" %"}</td><td>${r.rawCellFactor==null?"–":pct.format(r.rawCellFactor*100)+" %"}</td></tr>`).join("");
    $("fadingExamples").innerHTML=`
      <div class="grid2">
        <div><h3>Fruktsamhet</h3><table class="miniTable"><thead><tr><th>Moderns ålder</th><th>Årlig population</th><th>Förv. händelser</th><th>Lokal vikt</th><th>Lokal/rike-cell</th></tr></thead><tbody>${fertRows}</tbody></table></div>
        <div><h3>Dödlighet</h3><table class="miniTable"><thead><tr><th>Ålder</th><th>Kön</th><th>Årlig population</th><th>Förv. händelser</th><th>Lokal vikt</th><th>Lokal/rike-cell</th></tr></thead><tbody>${mortRows}</tbody></table></div>
      </div>`;
  }

  function renderBalanceSummary(){
    if(!latest.length)return;
    const r=latest.slice(1);
    const births=r.reduce((s,x)=>s+Number(x.births||0),0);
    const deaths=r.reduce((s,x)=>s+Number(x.deaths||0),0);
    const mig=r.reduce((s,x)=>s+Number(x.netMigration||0),0);
    const scenario=r.reduce((s,x)=>s+Number(x.scenarioEffect||0),0);
    $("balanceSummary").innerHTML=`
      <div class="kv"><span>Födda, ack.</span><strong>+${fmt.format(births)}</strong></div>
      <div class="kv"><span>Döda, ack.</span><strong>−${fmt.format(deaths)}</strong></div>
      <div class="kv"><span>Nettoflyttning, ack.</span><strong>${mig>=0?"+":""}${fmt.format(mig)}</strong></div>
      <div class="kv"><span>Scenarioeffekt, ack.</span><strong>${scenario>=0?"+":""}${fmt.format(scenario)}</strong></div>`;
  }

  function renderValidation(){
    const geo=$("geo").value, selected=String($("window").value);
    const bw=backtest?.summary?.[geo]?.[selected]?selected:(backtest?.summary?.[geo]?.["10"]?"10":null);
    const bs=bw?backtest.summary[geo][bw]:null;
    $("backtestMape").textContent=bs?pct.format(bs.populationMAPE)+" %":"–";
    $("backtest2024").textContent=bs?`${bs.populationError2024>=0?"+":""}${fmt.format(bs.populationError2024)} (${pct.format(bs.populationAbsPctError2024)} %)`:"–";

    const sr=(scbComparison?.results?.[geo]?.[selected]||[]).find(x=>+x.year===2050);
    $("scbDiff2050").textContent=sr?`${sr.differenceVsRebasedScbPct>=0?"+":""}${pct.format(sr.differenceVsRebasedScbPct)} %`:"–";
    $("faConsistency").textContent=validation?.faConsistency?.ok?"OK":"–";

    renderBacktestTable(geo,bw);
    renderScbBenchmarkTable(geo,selected);
  }

  function renderBacktestTable(geo,w){
    const rows=w?backtest?.results?.[geo]?.[w]:null;
    if(!rows){$("backtestTable").innerHTML="<p class='hint'>Backtestdata saknas för valt fönster.</p>";return;}
    $("backtestTable").innerHTML=`<table class="miniTable"><thead><tr><th>År</th><th>Prognos</th><th>Utfall</th><th>Fel</th><th>Födda fel</th><th>Döda fel</th><th>Flytt fel</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${r.year}</td><td>${fmt.format(r.predictedPopulation)}</td><td>${fmt.format(r.actualPopulation)}</td><td>${r.populationError>=0?"+":""}${fmt.format(r.populationError)}</td><td>${r.birthsError>=0?"+":""}${fmt.format(r.birthsError)}</td><td>${r.deathsError>=0?"+":""}${fmt.format(r.deathsError)}</td><td>${r.netMigrationError>=0?"+":""}${fmt.format(r.netMigrationError)}</td></tr>`).join("")}
      </tbody></table>`;
  }

  function renderScbBenchmarkTable(geo,w){
    const rows=scbComparison?.results?.[geo]?.[w];
    if(!rows){$("scbBenchmarkTable").innerHTML="<p class='hint'>SCB-benchmark saknas ännu.</p>";return;}
    $("scbBenchmarkTable").innerHTML=`<table class="miniTable"><thead><tr><th>År</th><th>Modell</th><th>SCB</th><th>SCB omankrad</th><th>Skillnad %</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${r.year}</td><td>${fmt.format(r.modelPopulation)}</td><td>${fmt.format(r.scbPopulation)}</td><td>${fmt.format(r.scbRebasedToActual2025)}</td><td>${r.differenceVsRebasedScbPct>=0?"+":""}${pct.format(r.differenceVsRebasedScbPct)} %</td></tr>`).join("")}
      </tbody></table>`;
  }

  function drawPopulationChart(rows,baseRows=[]){
    const svg=$("chart"), W=900,H=380,p=48;
    const vals=[...rows.map(r=>r.population),...baseRows.map(r=>r.population)];
    const min=Math.min(...vals), max=Math.max(...vals), span=Math.max(1,max-min);
    const x=i=>p+i*(W-2*p)/Math.max(1,rows.length-1), y=v=>H-p-(v-min)*(H-2*p)/span;
    const scenarioPts=rows.map((r,i)=>`${x(i)},${y(r.population)}`).join(" ");
    const basePts=baseRows.map((r,i)=>`${x(i)},${y(r.population)}`).join(" ");
    const grid=[0,.25,.5,.75,1].map(t=>{
      const yy=p+t*(H-2*p),val=max-t*span;
      return `<line x1="${p}" y1="${yy}" x2="${W-p}" y2="${yy}" class="gridline"/><text x="8" y="${yy+4}" class="axisText">${fmt.format(val)}</text>`;
    }).join("");
    const baseLine=baseRows.length?`<polyline points="${basePts}" class="baselineLine"/>`:"";
    svg.innerHTML=`${grid}${baseLine}<polyline points="${scenarioPts}" class="populationLine"/>
      <text x="${p}" y="20" class="legendScenario">Vald prognos</text>
      <text x="${p+110}" y="20" class="legendBaseline">Bas utan bostads-/jobbscenario</text>
      <text x="${p}" y="${H-12}" class="axisText">${rows[0].year}</text>
      <text x="${W-p-30}" y="${H-12}" class="axisText">${rows.at(-1).year}</text>`;
  }

  function drawComponentsChart(rows){
    const svg=$("componentsChart"),W=900,H=300,p=48;
    if(!rows.length){svg.innerHTML="";return;}
    const series=[
      {key:"births",name:"Födda",cls:"lineBirths"},
      {key:"deaths",name:"Döda",cls:"lineDeaths"},
      {key:"netMigration",name:"Nettoflyttning",cls:"lineMigration"}
    ];
    const vals=series.flatMap(s=>rows.map(r=>Number(r[s.key]||0)));
    const min=Math.min(0,...vals),max=Math.max(1,...vals),span=Math.max(1,max-min);
    const x=i=>p+i*(W-2*p)/Math.max(1,rows.length-1),y=v=>H-p-(v-min)*(H-2*p)/span;
    const zero=y(0);
    const lines=series.map(s=>`<polyline points="${rows.map((r,i)=>`${x(i)},${y(Number(r[s.key]||0))}`).join(" ")}" class="${s.cls}"/>`).join("");
    svg.innerHTML=`<line x1="${p}" y1="${zero}" x2="${W-p}" y2="${zero}" class="gridline"/>${lines}
      <text x="${p}" y="20" class="legendBirths">Födda</text><text x="${p+90}" y="20" class="legendDeaths">Döda</text><text x="${p+165}" y="20" class="legendMigration">Nettoflyttning</text>
      <text x="${p}" y="${H-10}" class="axisText">${rows[0].year}</text><text x="${W-p-30}" y="${H-10}" class="axisText">${rows.at(-1).year}</text>`;
  }

  function exportCsv(){
    if(!latest.length)return;
    const lines=["year,population,births,deaths,net_migration,scenario_effect,change",...latest.map(r=>[r.year,r.population,r.births,r.deaths,r.netMigration,r.scenarioEffect||0,r.change].join(","))];
    const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="lulea_population_forecast.csv";a.click();URL.revokeObjectURL(a.href);
  }

  setup();
})();