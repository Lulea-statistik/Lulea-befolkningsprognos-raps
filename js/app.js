(function(){
  "use strict";
  let data=window.MODEL_DATA;
  const validation=window.MODEL_VALIDATION||null;
  const backtest=window.MODEL_BACKTEST||null;
  const scbComparison=window.SCB_BENCHMARK_COMPARISON||null;
  const labour=window.LABOUR_MARKET_DATA||null;
  const housing=window.HOUSING_HOUSEHOLD_DATA||null;
  let latest=[];
  let baseline=[];

  const $=id=>document.getElementById(id);
  const fmt=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:0});
  const fmt1=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:1});
  const pct=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:1});

  const defaultHousing=[{
    active:false,year:2030,municipality:"2580",dwellingType:"småhus",
    tenure:"äganderätt",size:"5+",dwellings:1000,completionPct:100,
    occupancyPct:95,personsMode:"auto",personsPerDwelling:2.0,externalSharePct:50,
    internalSharePct:25,phaseYears:3
  }];
  const defaultWorkplaces=[{
    active:false,year:2034,municipality:"2580",jobs:1000,
    allocationMode:"commuting",ageProfileMode:"worker_household",
    realizationPct:60,moveSharePct:25,personsPerJob:1.7,
    hostResidencePct:60,internalSharePct:10,phaseYears:4
  }];

  function setup(){
    fillGeo();
    fillLabourWorkplace();
    bindTabs();
    renderScenarioTables();
    $("runBtn").addEventListener("click",run);
    $("dataFile").addEventListener("change",loadFile);
    $("exportBtn").addEventListener("click",exportCsv);
    $("addHousing").addEventListener("click",()=>{syncScenarioTables();defaultHousing.push(blankHousing());renderScenarioTables();});
    $("addWorkplace").addEventListener("click",()=>{syncScenarioTables();defaultWorkplaces.push(blankWorkplace());renderScenarioTables();});
    ["geo","window","endYear"].forEach(id=>$(id).addEventListener("change",()=>{
      if(id==="geo" && $("geo").value!=="FA_LULEA" && $("labourWorkplace")){
        $("labourWorkplace").value=$("geo").value;
      }
      run();
    }));
    ["labourWorkplace","labourScenarioYear","labourAddedJobs","labourExternalMovePct","labourPersonsPerMover"].forEach(id=>{
      if($(id)) $(id).addEventListener("change",renderLabourAnalysis);
    });
    if($("labourToScenario")) $("labourToScenario").addEventListener("click",addLabourScenarioToForecast);
    ["householdProjectionMode","householdManualSize","housingReservePct"].forEach(id=>{
      if($(id)) $(id).addEventListener("change",renderHousingAnalysis);
    });
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
  function fillLabourWorkplace(){
    if(!$("labourWorkplace")) return;
    const geos=(labour?.geographies||data.geographies.filter(g=>g.code!=="FA_LULEA"));
    $("labourWorkplace").innerHTML=geos.map(g=>`<option value="${g.code}">${g.name}</option>`).join("");
    if(geos.some(g=>g.code==="2580")) $("labourWorkplace").value="2580";
  }
  function blankHousing(){
    return {active:true,year:2030,municipality:"2580",dwellingType:"flerbostadshus",tenure:"hyresrätt",size:"2 rum",dwellings:100,completionPct:100,occupancyPct:95,personsMode:"auto",personsPerDwelling:1.6,externalSharePct:50,internalSharePct:25,phaseYears:3};
  }
  function blankWorkplace(){
    return {
      active:true,year:2034,municipality:"2580",jobs:1000,
      allocationMode:"commuting",ageProfileMode:"worker_household",
      realizationPct:60,moveSharePct:25,personsPerJob:1.7,
      hostResidencePct:60,internalSharePct:10,phaseYears:4
    };
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
      <td><select data-k="allocationMode">
        <option value="commuting" ${s.allocationMode!=="manual"?"selected":""}>Observerad pendling</option>
        <option value="manual" ${s.allocationMode==="manual"?"selected":""}>Manuell</option>
      </select></td>
      <td><select data-k="ageProfileMode">
        <option value="worker_household" ${s.ageProfileMode!=="job_family"&&s.ageProfileMode!=="observed_inflow"&&s.ageProfileMode!=="population"?"selected":""}>Arbetstagare + hushåll</option>
        <option value="job_family" ${s.ageProfileMode==="job_family"?"selected":""}>Inflyttning 0–64</option>
        <option value="observed_inflow" ${s.ageProfileMode==="observed_inflow"?"selected":""}>Observerad inflyttning alla åldrar</option>
        <option value="population" ${s.ageProfileMode==="population"?"selected":""}>Befolkningsproportionell</option>
      </select></td>
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
    wBody.querySelectorAll("input,select").forEach(el=>el.addEventListener("change",()=>{
      syncScenarioTables();
      renderWorkplaceScenarioPreview();
    }));
    renderWorkplaceScenarioPreview();
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
  function commutingSharesFor(workplace){
    if(!labour) return null;
    const latest=labour.meta?.latestYear;
    const rows=(labour.residenceShares||[])
      .filter(r=>r.workplace===workplace && +r.year===+latest);
    if(!rows.length) return null;
    return {
      year:latest,
      shares:Object.fromEntries(rows.map(r=>[r.residence,Number(r.sharePct||0)]))
    };
  }

  function enrichWorkplaceScenario(x){
    const out={...x};
    const cs=commutingSharesFor(x.municipality);
    if(x.allocationMode!=="manual" && cs){
      out.useObservedCommuting=true;
      out.commutingYear=cs.year;
      out.commutingShares=cs.shares;
    }else{
      out.useObservedCommuting=false;
    }
    return out;
  }

  function currentScenarios(){
    syncScenarioTables();
    return {
      housing:defaultHousing.map(x=>({...x})),
      workplaces:defaultWorkplaces.map(enrichWorkplaceScenario),
      overlapPct:+$("overlapPct").value
    };
  }

  function renderWorkplaceScenarioPreview(){
    const el=$("workplaceScenarioPreview");
    if(!el) return;
    const names=Object.fromEntries((labour?.geographies||[]).map(g=>[g.code,g.name.replace(" kommun","")]));
    el.innerHTML=defaultWorkplaces.map((s,i)=>{
      if(!s.active) return "";
      if(s.allocationMode==="manual"){
        return `<div class="scenarioPreview"><strong>Rad ${i+1}: manuell fördelning.</strong> Extern inflyttning beräknas från vald jobb→inflyttning-andel och bosättningsandel.</div>`;
      }
      const cs=commutingSharesFor(s.municipality);
      if(!cs){
        return `<div class="scenarioPreview warn"><strong>Rad ${i+1}:</strong> pendlingsdata saknas; modellen faller tillbaka till manuell fördelning.</div>`;
      }
      const shares=cs.shares;
      const faCodes=(labour?.geographies||[]).map(g=>g.code);
      const host=Number(shares[s.municipality]||0);
      const other=faCodes.filter(code=>code!==s.municipality).reduce((sum,code)=>sum+Number(shares[code]||0),0);
      const outside=Number(shares.OUTSIDE_FA||0);
      const profileLabel=s.ageProfileMode==="worker_household"
        ?"arbetstagare enligt arbetsmarknadsprofil + medföljande hushåll"
        :s.ageProfileMode==="observed_inflow"
          ?"observerad inflyttning, alla åldrar"
          :s.ageProfileMode==="population"
            ?"befolkningsproportionell"
            :"observerad inflyttning 0–64";
      return `<div class="scenarioPreview">
        <strong>Rad ${i+1}: observerad pendling ${cs.year} för ${names[s.municipality]||s.municipality}.</strong>
        Samma kommun ${pct.format(host)} %, övriga FA ${pct.format(other)} %, utanför FA ${pct.format(outside)} %.
        Av jobben utanför FA antas ${pct.format(Number(s.moveSharePct||0))} % flytta till FA.
        Åldersprofil: ${profileLabel}.
      </div>`;
    }).join("") || "<p class='hint'>Ingen aktiv arbetsplatsrad.</p>";
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
    renderDetailedAgeAnalysis();
    renderMigrationAnalysis();
    renderLabourAnalysis();
    renderHousingAnalysis();
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
      const women=rr.filter(r=>r.sex==="K").reduce((s,r)=>s+Number(r.value||0),0);
      const men=rr.filter(r=>r.sex==="M").reduce((s,r)=>s+Number(r.value||0),0);
      return {name:b.name,women,men,total:women+men};
    });
    const max=Math.max(1,...totals.map(x=>x.total));
    $("ageStructure").innerHTML=`
      <table class="miniTable ageStructureTable">
        <thead><tr><th>Ålder</th><th>Struktur</th><th>Totalt</th><th>Kvinnor</th><th>Män</th></tr></thead>
        <tbody>${totals.map(x=>`<tr>
          <td>${x.name}</td>
          <td><div class="barTrack"><div class="barFill" style="width:${x.total/max*100}%"></div></div></td>
          <td><strong>${fmt.format(x.total)}</strong></td>
          <td>${fmt.format(x.women)}</td>
          <td>${fmt.format(x.men)}</td>
        </tr>`).join("")}</tbody>
      </table>`;
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

  function renderDetailedAgeAnalysis(){
    const geo=$("geo").value, w=+$("window").value;
    const fert=(data.fertilityRates||[])
      .filter(r=>r.geo===geo && +r.window===w && r.year==null)
      .sort((a,b)=>+a.age-+b.age);
    const mort=(data.mortalityRisks||[])
      .filter(r=>r.geo===geo && +r.window===w && r.year==null)
      .sort((a,b)=>(+a.age-+b.age)||String(a.sex).localeCompare(String(b.sex)));

    if(fert.length){
      $("fertilityAgeTable").querySelector("tbody").innerHTML=fert.map(r=>`<tr>
        <td>${r.age}</td>
        <td>${r.cellAverageAnnualExposure==null?"–":fmt1.format(r.cellAverageAnnualExposure)}</td>
        <td>${r.cellExpectedEvents==null?"–":fmt1.format(r.cellExpectedEvents)}</td>
        <td>${r.cellLocalWeight==null?"–":pct.format(r.cellLocalWeight*100)+" %"}</td>
        <td>${r.rawCellFactor==null?"–":pct.format(r.rawCellFactor*100)+" %"}</td>
        <td>${fmt1.format(Number(r.value||0)*1000)}</td>
      </tr>`).join("");
      drawAgeLineChart("fertilityWeightChart",fert.map(r=>+r.age),[
        {name:"Lokal vikt",values:fert.map(r=>Number(r.cellLocalWeight||0)*100),cls:"lineLocalWeight",suffix:" %"}
      ],{yMin:0,yMax:100,xLabel:"Ålder",valueDigits:1});
    }else{
      $("fertilityAgeTable").querySelector("tbody").innerHTML="";
      $("fertilityWeightChart").innerHTML="";
    }

    const ages=[...new Set(mort.map(r=>+r.age))].sort((a,b)=>a-b);
    const women=ages.map(age=>mort.find(r=>+r.age===age&&r.sex==="K"));
    const men=ages.map(age=>mort.find(r=>+r.age===age&&r.sex==="M"));
    $("mortalityAgeTable").querySelector("tbody").innerHTML=ages.map((age,i)=>{
      const k=women[i],m=men[i];
      return `<tr>
        <td>${age===100?"100+":age}</td>
        <td>${k?.cellLocalWeight==null?"–":pct.format(k.cellLocalWeight*100)+" %"}</td>
        <td>${m?.cellLocalWeight==null?"–":pct.format(m.cellLocalWeight*100)+" %"}</td>
        <td>${k?.cellExpectedEvents==null?"–":fmt1.format(k.cellExpectedEvents)}</td>
        <td>${m?.cellExpectedEvents==null?"–":fmt1.format(m.cellExpectedEvents)}</td>
        <td>${k?.rawCellFactor==null?"–":pct.format(k.rawCellFactor*100)+" %"}</td>
        <td>${m?.rawCellFactor==null?"–":pct.format(m.rawCellFactor*100)+" %"}</td>
      </tr>`;
    }).join("");
    if(ages.length){
      drawAgeLineChart("mortalityWeightChart",ages,[
        {name:"Kvinnor lokal vikt",values:women.map(r=>Number(r?.cellLocalWeight||0)*100),cls:"lineWomen",suffix:" %"},
        {name:"Män lokal vikt",values:men.map(r=>Number(r?.cellLocalWeight||0)*100),cls:"lineMen",suffix:" %"}
      ],{yMin:0,yMax:100,xLabel:"Ålder",valueDigits:1});
    }
  }

  function renderMigrationAnalysis(){
    const geo=$("geo").value, w=+$("window").value;
    const rows=(data.diagnostics?.migrationByAge||[])
      .filter(r=>r.geo===geo && +r.window===w)
      .sort((a,b)=>+a.age-+b.age);

    if(!rows.length){
      ["migrationInflowKpi","migrationOutflowKpi","migrationNetKpi","migrationImpactKpi"].forEach(id=>$(id).textContent="–");
      $("migrationImpactAge").textContent="genereras i nästa workflow-körning";
      $("migrationAgeTable").querySelector("tbody").innerHTML="";
      $("migrationPriority").innerHTML="<p class='hint'>Flyttdiagnostik genereras i nästa workflow-körning.</p>";
      $("migrationAgeChart").innerHTML="";
      $("migrationVariationChart").innerHTML="";
      return;
    }

    const grossAvailable=rows.some(r=>r.grossFlowsAvailable!==false);
    const inflow=grossAvailable?rows.reduce((s,r)=>s+Number(r.meanInflow||0),0):null;
    const outflow=grossAvailable?rows.reduce((s,r)=>s+Number(r.meanOutflow||0),0):null;
    const net=rows.reduce((s,r)=>s+Number(r.meanNetMigration||0),0);
    const impact=[...rows].sort((a,b)=>{
      const av=grossAvailable?Number(a.sensitivity5PctInflowPersons||0):Number(a.sensitivity5PctNetPersons||0);
      const bv=grossAvailable?Number(b.sensitivity5PctInflowPersons||0):Number(b.sensitivity5PctNetPersons||0);
      return bv-av;
    })[0];
    const impactValue=grossAvailable?impact?.sensitivity5PctInflowPersons:impact?.sensitivity5PctNetPersons;

    $("migrationInflowKpi").textContent=grossAvailable?fmt.format(inflow):"–";
    $("migrationOutflowKpi").textContent=grossAvailable?fmt.format(outflow):"–";
    $("migrationNetKpi").textContent=(net>=0?"+":"")+fmt.format(net);
    $("migrationImpactKpi").textContent=fmt1.format(impactValue||0)+" pers.";
    $("migrationImpactAge").textContent=grossAvailable
      ?`ålder ${impact?.age===100?"100+":impact?.age}, ±5 % av inflyttning`
      :`ålder ${impact?.age===100?"100+":impact?.age}, ±5 % av flyttnetto · brutto saknas för FA`;

    const practical=[...rows]
      .filter(r=>grossAvailable?r.sensitivity5PctInflowPersons!=null:r.sensitivity5PctNetPersons!=null)
      .sort((a,b)=>{
        const av=grossAvailable?Number(a.sensitivity5PctInflowPersons||0):Number(a.sensitivity5PctNetPersons||0);
        const bv=grossAvailable?Number(b.sensitivity5PctInflowPersons||0):Number(b.sensitivity5PctNetPersons||0);
        return bv-av;
      }).slice(0,10);
    const relative=grossAvailable?[...rows]
      .filter(r=>r.cvInflowPct!=null)
      .sort((a,b)=>Number(b.cvInflowPct||0)-Number(a.cvInflowPct||0)).slice(0,10):[...rows]
      .filter(r=>r.cvNetMigrationPct!=null)
      .sort((a,b)=>Number(b.cvNetMigrationPct||0)-Number(a.cvNetMigrationPct||0)).slice(0,10);
    $("migrationPriority").innerHTML=`
      <div class="grid2">
        <div><h3>Störst praktisk 5 %-effekt</h3>
          <table class="miniTable"><thead><tr><th>Ålder</th><th>Flöde</th><th>5 %-effekt</th></tr></thead><tbody>
          ${practical.map(r=>{
            const flow=grossAvailable?r.meanInflow:r.meanNetMigration;
            const effect=grossAvailable?r.sensitivity5PctInflowPersons:r.sensitivity5PctNetPersons;
            return `<tr><td>${r.age===100?"100+":r.age}</td><td>${fmt1.format(flow||0)}</td><td>${fmt1.format(effect||0)} pers.</td></tr>`;
          }).join("")}</tbody></table>
        </div>
        <div><h3>Högst relativ historisk variation</h3>
          <table class="miniTable"><thead><tr><th>Ålder</th><th>CV</th><th>Flöde</th><th>5 %-effekt</th></tr></thead><tbody>
          ${relative.map(r=>{
            const cv=grossAvailable?r.cvInflowPct:r.cvNetMigrationPct;
            const flow=grossAvailable?r.meanInflow:r.meanNetMigration;
            const effect=grossAvailable?r.sensitivity5PctInflowPersons:r.sensitivity5PctNetPersons;
            return `<tr><td>${r.age===100?"100+":r.age}</td><td>${pct.format(cv||0)} %</td><td>${fmt1.format(flow||0)}</td><td>${fmt1.format(effect||0)} pers.</td></tr>`;
          }).join("")}</tbody></table>
        </div>
      </div>
      <p class="hint">Hög relativ variation betyder inte automatiskt stor prognosbetydelse. Jämför CV med flödets storlek och 5 %-effekten i personer.</p>`;

    $("migrationAgeTable").querySelector("tbody").innerHTML=rows.map(r=>{
      const fivePct=grossAvailable?r.sensitivity5PctInflowPersons:r.sensitivity5PctNetPersons;
      return `<tr>
        <td>${r.age===100?"100+":r.age}</td>
        <td>${r.meanInflow==null?"–":fmt1.format(r.meanInflow)}</td>
        <td>${r.meanOutflow==null?"–":fmt1.format(r.meanOutflow)}</td>
        <td>${(r.meanNetMigration||0)>=0?"+":""}${fmt1.format(r.meanNetMigration||0)}</td>
        <td>${r.sdInflow==null?"–":fmt1.format(r.sdInflow)}</td>
        <td>${fmt1.format(r.sdNetMigration||0)}</td>
        <td>${r.cvInflowPct==null?"–":pct.format(r.cvInflowPct)+" %"}</td>
        <td>${r.shareOfInflowPct==null?"–":pct.format(r.shareOfInflowPct)+" %"}</td>
        <td>${fmt1.format(fivePct||0)} pers.</td>
        <td>100 % (netto)</td>
      </tr>`;
    }).join("");

    const ages=rows.map(r=>+r.age);
    const flowSeries=grossAvailable?[
      {name:"Inflyttning",values:rows.map(r=>Number(r.meanInflow||0)),cls:"lineInflow"},
      {name:"Utflyttning",values:rows.map(r=>Number(r.meanOutflow||0)),cls:"lineOutflow"},
      {name:"Netto",values:rows.map(r=>Number(r.meanNetMigration||0)),cls:"lineMigration"}
    ]:[
      {name:"Flyttnetto",values:rows.map(r=>Number(r.meanNetMigration||0)),cls:"lineMigration"}
    ];
    drawAgeLineChart("migrationAgeChart",ages,flowSeries,{includeZero:true,xLabel:"Ålder",valueDigits:1});

    const variationSeries=grossAvailable?[
      {name:"SD inflyttning",values:rows.map(r=>Number(r.sdInflow||0)),cls:"lineVariation"},
      {name:"5 %-effekt",values:rows.map(r=>Number(r.sensitivity5PctInflowPersons||0)),cls:"lineSensitivity"}
    ]:[
      {name:"SD flyttnetto",values:rows.map(r=>Number(r.sdNetMigration||0)),cls:"lineVariation"},
      {name:"5 %-effekt netto",values:rows.map(r=>Number(r.sensitivity5PctNetPersons||0)),cls:"lineSensitivity"}
    ];
    drawAgeLineChart("migrationVariationChart",ages,variationSeries,{yMin:0,xLabel:"Ålder",valueDigits:1});
  }

  function drawAgeLineChart(svgId,xValues,series,options={}){
    const svg=$(svgId),W=900,H=options.height||330,p=48;
    if(!svg||!xValues.length){if(svg)svg.innerHTML="";return;}
    const all=series.flatMap(s=>s.values.map(Number).filter(Number.isFinite));
    let min=options.yMin!=null?options.yMin:Math.min(...all);
    let max=options.yMax!=null?options.yMax:Math.max(...all);
    if(options.includeZero){min=Math.min(0,min);max=Math.max(0,max);}
    if(!Number.isFinite(min))min=0;if(!Number.isFinite(max))max=1;
    const span=Math.max(1e-9,max-min);
    const xmin=Math.min(...xValues),xmax=Math.max(...xValues),xspan=Math.max(1,xmax-xmin);
    const x=v=>p+(v-xmin)*(W-2*p)/xspan;
    const y=v=>H-p-(v-min)*(H-2*p)/span;

    const grid=[0,.25,.5,.75,1].map(t=>{
      const yy=p+t*(H-2*p),val=max-t*span;
      return `<line x1="${p}" y1="${yy}" x2="${W-p}" y2="${yy}" class="gridline"/><text x="8" y="${yy+4}" class="axisText">${fmt1.format(val)}</text>`;
    }).join("");
    const lines=series.map(s=>`<polyline points="${xValues.map((age,i)=>`${x(age)},${y(Number(s.values[i]||0))}`).join(" ")}" class="${s.cls}"/>`).join("");
    const legends=series.map((s,i)=>`<text x="${p+i*155}" y="20" class="chartLegend">${s.name}</text>`).join("");
    svg.innerHTML=`${grid}${lines}${legends}
      <text x="${p}" y="${H-10}" class="axisText">${xmin}</text>
      <text x="${W-p-30}" y="${H-10}" class="axisText">${xmax===100?"100+":xmax}</text>`;

    bindIndexedHover(svg,xValues,(i)=>{
      const age=xValues[i]===100?"100+":xValues[i];
      return `<strong>${options.hoverLabel||"Ålder"} ${age}</strong>`+series.map(s=>{
        const value=Number(s.values[i]||0);
        return `<div><span>${s.name}</span><b>${fmt1.format(value)}${s.suffix||""}</b></div>`;
      }).join("");
    },i=>x(xValues[i]));
  }

  function bindIndexedHover(svg,xValues,htmlForIndex,xForIndex){
    const tip=$("chartTooltip");
    if(!tip||!svg)return;
    svg.onmousemove=e=>{
      const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;
      const loc=pt.matrixTransform(svg.getScreenCTM().inverse());
      let best=0,bestD=Infinity;
      for(let i=0;i<xValues.length;i++){
        const d=Math.abs(loc.x-xForIndex(i));
        if(d<bestD){bestD=d;best=i;}
      }
      tip.innerHTML=htmlForIndex(best);
      tip.classList.add("show");
      tip.style.left=(e.clientX+14)+"px";
      tip.style.top=(e.clientY+14)+"px";
    };
    svg.onmouseleave=()=>tip.classList.remove("show");
  }

  function addLabourScenarioToForecast(){
    const workplace=$("labourWorkplace")?.value;
    if(!workplace) return;
    const row=blankWorkplace();
    row.active=true;
    row.year=Math.max(2026,+$("labourScenarioYear").value||2030);
    row.municipality=workplace;
    row.jobs=Math.max(0,+$("labourAddedJobs").value||0);
    row.allocationMode="commuting";
    row.realizationPct=100;
    row.moveSharePct=Math.max(0,Math.min(100,+$("labourExternalMovePct").value||0));
    row.personsPerJob=Math.max(0,+$("labourPersonsPerMover").value||0);
    row.internalSharePct=10;
    defaultWorkplaces.push(row);
    renderScenarioTables();

    document.querySelectorAll(".tab").forEach(btn=>
      btn.classList.toggle("active",btn.dataset.page==="scenario")
    );
    document.querySelectorAll(".page").forEach(p=>
      p.classList.toggle("active",p.id==="page-scenario")
    );
    run();
  }

  function renderLabourAnalysis(){
    if(!$("labourWorkplace")) return;
    if(!labour){
      $("labourJobsKpi").textContent="–";
      $("labourLocalShareKpi").textContent="–";
      $("labourOtherFaShareKpi").textContent="–";
      $("labourOutsideShareKpi").textContent="–";
      $("labourResidenceShares").innerHTML="<p class='hint'>Pendlingsdata genereras i nästa workflow-körning.</p>";
      $("labourScenarioAllocation").innerHTML="<p class='hint'>Pendlingsdata genereras i nästa workflow-körning.</p>";
      $("labourPopulationEffect").innerHTML="";
      $("labourWorkerAgeGroups").innerHTML="<p class='hint'>Arbetsmarknadens åldersprofil genereras i nästa workflow-körning.</p>";
      $("commutingMatrix").innerHTML="";
      $("labourJobsChart").innerHTML="";
      return;
    }

    const workplace=$("labourWorkplace").value;
    const summary=(labour.workplaceSummary||[]).find(r=>r.workplace===workplace);
    if(!summary) return;
    const latest=labour.meta.latestYear;
    $("labourJobsKpi").textContent=fmt.format(summary.jobs||0);
    $("labourLatestYear").textContent=`år ${latest}`;
    $("labourLocalShareKpi").textContent=pct.format(summary.sameMunicipalitySharePct||0)+" %";
    $("labourOtherFaShareKpi").textContent=pct.format(summary.otherFASharePct||0)+" %";
    $("labourOutsideShareKpi").textContent=pct.format(summary.outsideFASharePct||0)+" %";

    const series=(labour.workplaceSeries||[]).filter(r=>r.workplace===workplace).sort((a,b)=>a.year-b.year);
    drawAgeLineChart("labourJobsChart",series.map(r=>r.year),[
      {name:"Jobb",values:series.map(r=>Number(r.jobs||0)),cls:"populationLine"}
    ],{xLabel:"År",hoverLabel:"År",valueDigits:0});

    const shares=(labour.residenceShares||[])
      .filter(r=>r.workplace===workplace && +r.year===+latest)
      .sort((a,b)=>Number(b.value||0)-Number(a.value||0));
    const nameFor=code=>{
      if(code===labour.outsideGroup?.code) return labour.outsideGroup.name;
      return labour.geographies.find(g=>g.code===code)?.name||code;
    };
    $("labourResidenceShares").innerHTML=shares.map(r=>`<div class="shareRow">
      <span>${nameFor(r.residence)}</span>
      <div class="barTrack"><div class="barFill" style="width:${Math.max(0,Math.min(100,r.sharePct||0))}%"></div></div>
      <strong>${pct.format(r.sharePct||0)} %</strong>
      <small>${fmt.format(r.value||0)}</small>
    </div>`).join("");

    const workGeos=labour.geographies||[];
    const residenceRows=[...workGeos,{code:labour.outsideGroup.code,name:labour.outsideGroup.name}];
    const matrixHeader=`<thead><tr><th>Bostad</th>${workGeos.map(g=>`<th>${g.name.replace(" kommun","")}</th>`).join("")}</tr></thead>`;
    const matrixBody=`<tbody>${residenceRows.map(res=>`<tr><td>${res.name.replace(" kommun","")}</td>${workGeos.map(work=>{
      const r=(labour.matrixLatest||[]).find(x=>x.residence===res.code&&x.workplace===work.code);
      return `<td>${fmt.format(r?.value||0)}</td>`;
    }).join("")}</tr>`).join("")}</tbody>`;
    $("commutingMatrix").innerHTML=matrixHeader+matrixBody;

    const added=Math.max(0,+$("labourAddedJobs").value||0);
    const allocations=shares.map(r=>({
      residence:r.residence,
      name:nameFor(r.residence),
      jobs:added*(Number(r.sharePct||0)/100),
      share:Number(r.sharePct||0)
    }));
    $("labourScenarioAllocation").innerHTML=`<table class="miniTable"><thead><tr><th>Bostadsområde</th><th>Dagens andel</th><th>Av ${fmt.format(added)} nya jobb</th></tr></thead><tbody>
      ${allocations.map(r=>`<tr><td>${r.name}</td><td>${pct.format(r.share)} %</td><td>${fmt1.format(r.jobs)}</td></tr>`).join("")}
    </tbody></table>`;

    const profileWindow=+$("window").value;
    const scenarioProfiles=(data.scenarioMigrationProfiles||[])
      .filter(r=>r.geo===workplace && +r.window===profileWindow);
    const workerProfile=scenarioProfiles.filter(r=>r.profile==="worker_hybrid");
    const companionProfile=scenarioProfiles.filter(r=>r.profile==="family_companion");
    const jobProfile=scenarioProfiles.filter(r=>r.profile==="job_family");
    const allProfile=scenarioProfiles.filter(r=>r.profile==="observed_inflow");
    if(workerProfile.length || companionProfile.length || jobProfile.length || allProfile.length){
      const ages=[...new Set(
        scenarioProfiles.map(r=>+r.age)
      )].sort((a,b)=>a-b);
      const valuesFor=rows=>ages.map(age=>
        rows.filter(r=>+r.age===age)
          .reduce((s,r)=>s+Number(r.share||0),0)*100
      );
      const series=[];
      if(workerProfile.length) series.push({
        name:"Arbetstagare – hybrid",
        values:valuesFor(workerProfile),
        cls:"lineInflow",
        suffix:" %"
      });
      if(companionProfile.length) series.push({
        name:"Medföljande hushåll – proxy",
        values:valuesFor(companionProfile),
        cls:"lineSensitivity",
        suffix:" %"
      });
      if(jobProfile.length) series.push({
        name:"Inflyttning 0–64",
        values:valuesFor(jobProfile),
        cls:"lineMen",
        suffix:" %"
      });
      if(allProfile.length) series.push({
        name:"Alla observerade inflyttare",
        values:valuesFor(allProfile),
        cls:"lineVariation",
        suffix:" %"
      });
      drawAgeLineChart(
        "labourAgeProfileChart",
        ages,
        series,
        {yMin:0,xLabel:"Ålder",hoverLabel:"Ålder",valueDigits:2}
      );
    }else{
      $("labourAgeProfileChart").innerHTML=
        '<text x="30" y="40" class="axisText">Åldersprofil genereras i nästa workflow-körning.</text>';
    }

    const workerGroups=(labour.workerAgeGroups||[])
      .filter(r=>r.workplace===workplace)
      .sort((a,b)=>(+a.ageMin-+b.ageMin)||String(a.sex).localeCompare(String(b.sex)));
    if(workerGroups.length){
      const bands=[...new Map(workerGroups.map(r=>[
        `${r.ageMin}-${r.ageMax}`,
        {label:`${r.ageMin}–${r.ageMax}`,ageMin:r.ageMin,ageMax:r.ageMax}
      ])).values()];
      $("labourWorkerAgeGroups").innerHTML=`
        <h3>Sysselsatta efter arbetsställets åldersgrupp</h3>
        <p class="hint">SCB TAB3205, genomsnitt 2022–2024. Detta är en arbetsmarknadsreferens för själva jobbinnehavaren, inte en flyttprofil.</p>
        <table class="miniTable"><thead><tr><th>Ålder</th><th>Totalt</th><th>Kvinnor</th><th>Män</th></tr></thead><tbody>
        ${bands.map(b=>{
          const rows=workerGroups.filter(r=>+r.ageMin===+b.ageMin&&+r.ageMax===+b.ageMax);
          const k=rows.find(r=>r.sex==="K");
          const m=rows.find(r=>r.sex==="M");
          const total=rows.reduce((s,r)=>s+Number(r.sharePct||0),0);
          return `<tr><td>${b.label}</td><td>${pct.format(total)} %</td><td>${pct.format(k?.sharePct||0)} %</td><td>${pct.format(m?.sharePct||0)} %</td></tr>`;
        }).join("")}
        </tbody></table>`;
    }else{
      $("labourWorkerAgeGroups").innerHTML="<p class='hint'>Arbetsmarknadens åldersprofil genereras i nästa workflow-körning.</p>";
    }

    const outside=allocations.find(r=>r.residence===labour.outsideGroup.code);
    const movePct=Math.max(0,Math.min(100,+$("labourExternalMovePct").value||0))/100;
    const personsPerJob=Math.max(0,+$("labourPersonsPerMover").value||0);
    const outsideJobs=outside?.jobs||0;
    const movingJobs=outsideJobs*movePct;
    const populationEffect=movingJobs*personsPerJob;
    $("labourPopulationEffect").innerHTML=`
      <div class="policyGrid">
        <div><span>Nya jobb till boende utanför FA</span><strong>${fmt1.format(outsideJobs)}</strong></div>
        <div><span>Antas flytta till FA</span><strong>${fmt1.format(movingJobs)}</strong></div>
        <div><span>Personer per inflyttat jobb</span><strong>${fmt1.format(personsPerJob)}</strong></div>
        <div><span>Potentiell extra befolkning</span><strong>+${fmt1.format(populationEffect)}</strong></div>
      </div>
      <p class="hint">${labour.meta.qualityNote||""}</p>`;
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
    renderBacktestAgeError(geo,bw);
    renderScbBenchmarkTable(geo,selected);
  }

  function renderBacktestTable(geo,w){
    const rows=w?backtest?.results?.[geo]?.[w]:null;
    if(!rows){$("backtestTable").innerHTML="<p class='hint'>Backtestdata saknas för valt fönster.</p>";return;}
    $("backtestTable").innerHTML=`<table class="miniTable"><thead><tr><th>År</th><th>Prognos</th><th>Utfall</th><th>Fel</th><th>Födda fel</th><th>Döda fel</th><th>Flytt fel</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${r.year}</td><td>${fmt.format(r.predictedPopulation)}</td><td>${fmt.format(r.actualPopulation)}</td><td>${r.populationError>=0?"+":""}${fmt.format(r.populationError)}</td><td>${r.birthsError>=0?"+":""}${fmt.format(r.birthsError)}</td><td>${r.deathsError>=0?"+":""}${fmt.format(r.deathsError)}</td><td>${r.netMigrationError>=0?"+":""}${fmt.format(r.netMigrationError)}</td></tr>`).join("")}
      </tbody></table>`;
  }

  function renderBacktestAgeError(geo,w){
    const rows=w?(backtest?.ageErrors?.[geo]?.[w]||[]).filter(r=>+r.year===2024):[];
    if(!rows.length){
      $("backtestAgeErrorChart").innerHTML="";
      $("backtestAgeErrorTable").innerHTML="<p class='hint'>Åldersspecifikt backtest genereras i nästa workflow-körning.</p>";
      return;
    }
    const sorted=[...rows].sort((a,b)=>+a.age-+b.age);
    drawAgeLineChart("backtestAgeErrorChart",sorted.map(r=>+r.age),[
      {name:"Prognos − utfall",values:sorted.map(r=>Number(r.error||0)),cls:"lineError"}
    ],{includeZero:true,xLabel:"Ålder",hoverLabel:"Ålder",valueDigits:1});

    $("backtestAgeErrorTable").innerHTML=`
      <div class="tableWrap analysisTableWrap"><table class="miniTable"><thead><tr>
        <th>Ålder</th><th>Prognos</th><th>Utfall</th><th>Fel antal</th><th>Fel %</th>
      </tr></thead><tbody>
      ${sorted.map(r=>`<tr>
        <td>${r.age===100?"100+":r.age}</td>
        <td>${fmt1.format(r.predictedPopulation||0)}</td>
        <td>${fmt1.format(r.actualPopulation||0)}</td>
        <td>${r.error>=0?"+":""}${fmt1.format(r.error||0)}</td>
        <td>${r.pctError==null?"–":(r.pctError>=0?"+":"")+pct.format(r.pctError)+" %"}</td>
      </tr>`).join("")}
      </tbody></table></div>`;
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
    bindIndexedHover(svg,rows.map(r=>r.year),(i)=>{
      const r=rows[i],b=baseRows[i];
      return `<strong>År ${r.year}</strong>
        <div><span>Vald prognos</span><b>${fmt.format(r.population)}</b></div>
        ${b?`<div><span>Bas utan scenario</span><b>${fmt.format(b.population)}</b></div>`:""}
        <div><span>Förändring</span><b>${r.change>=0?"+":""}${fmt.format(r.change)}</b></div>`;
    },x);
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
    bindIndexedHover(svg,rows.map(r=>r.year),(i)=>{
      const r=rows[i];
      return `<strong>År ${r.year}</strong>
        <div><span>Födda</span><b>${fmt1.format(r.births)}</b></div>
        <div><span>Döda</span><b>${fmt1.format(r.deaths)}</b></div>
        <div><span>Nettoflyttning</span><b>${r.netMigration>=0?"+":""}${fmt1.format(r.netMigration)}</b></div>`;
    },x);
  }

  function exportCsv(){
    if(!latest.length)return;
    const lines=["year,population,births,deaths,net_migration,scenario_effect,change",...latest.map(r=>[r.year,r.population,r.births,r.deaths,r.netMigration,r.scenarioEffect||0,r.change].join(","))];
    const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="lulea_population_forecast.csv";a.click();URL.revokeObjectURL(a.href);
  }

  setup();
})();