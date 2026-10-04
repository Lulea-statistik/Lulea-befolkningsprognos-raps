(function(){
  "use strict";
  let data=window.MODEL_DATA;
  const smoothingDiagnostic=window.MIGRATION_SMOOTHING_DIAGNOSTIC||null;
  const validation=window.MODEL_VALIDATION||null;
  const maturity=window.MODEL_MATURITY||null;
  const backtest=window.MODEL_BACKTEST||null;
  const ageCellWeightDiagnostic=window.AGE_CELL_WEIGHT_DIAGNOSTIC||null;
  const scbComparison=window.SCB_BENCHMARK_COMPARISON||null;
  const labour=window.LABOUR_MARKET_DATA||null;
  const housing=window.HOUSING_HOUSEHOLD_DATA||null;
  let latest=[];
  let baseline=[];

  const $=id=>document.getElementById(id);
  const fmt=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:0});
  const fmt1=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:1});
  const pct=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:1});

  function niceNumericTicks(min,max,target=6){
    min=Number(min);max=Number(max);
    if(!Number.isFinite(min)||!Number.isFinite(max)) return [];
    if(max<min)[min,max]=[max,min];
    if(Math.abs(max-min)<1e-12) return [min];
    const raw=(max-min)/Math.max(1,target-1);
    const power=Math.pow(10,Math.floor(Math.log10(raw)));
    const norm=raw/power;
    const factor=norm<=1?1:norm<=2?2:norm<=2.5?2.5:norm<=5?5:10;
    const step=factor*power;
    const vals=[min];
    let v=Math.ceil((min+1e-10)/step)*step;
    for(let guard=0;v<max-1e-9 && guard<100;guard++,v+=step){
      vals.push(Math.abs(v-Math.round(v))<1e-9?Math.round(v):Number(v.toFixed(6)));
    }
    vals.push(max);
    return vals.filter((v,i,a)=>i===0||Math.abs(v-a[i-1])>1e-9);
  }

  function numericXAxisMarkup(min,max,x,y,target=6,formatter=v=>String(v)){
    return niceNumericTicks(min,max,target).map(v=>`
      <line x1="${x(v)}" y1="${y-5}" x2="${x(v)}" y2="${y}" class="gridline"/>
      <text x="${x(v)}" y="${y+16}" text-anchor="middle" class="axisText">${formatter(v)}</text>
    `).join("");
  }

  function niceAxisDomain(min,max,target=5){
    min=Number(min); max=Number(max);
    if(!Number.isFinite(min)||!Number.isFinite(max)) return {min:0,max:1,ticks:[0,1]};
    if(max<min)[min,max]=[max,min];
    if(Math.abs(max-min)<1e-12){
      const pad=Math.max(1,Math.abs(max)*0.1);
      min-=pad; max+=pad;
    }
    const raw=(max-min)/Math.max(1,target-1);
    const power=Math.pow(10,Math.floor(Math.log10(Math.max(raw,1e-12))));
    const norm=raw/power;
    const factor=norm<=1?1:norm<=2?2:norm<=5?5:10;
    const step=factor*power;
    let niceMin=Math.floor(min/step)*step;
    let niceMax=Math.ceil(max/step)*step;
    if(Math.abs(niceMin)<1e-12) niceMin=0;
    if(Math.abs(niceMax)<1e-12) niceMax=0;
    if(niceMax<=niceMin) niceMax=niceMin+step;
    const ticks=[];
    for(let v=niceMin,guard=0;v<=niceMax+step*1e-9 && guard<100;v+=step,guard++){
      const clean=Math.abs(v-Math.round(v))<1e-9?Math.round(v):Number(v.toFixed(6));
      ticks.push(clean);
    }
    return {min:niceMin,max:niceMax,ticks};
  }

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
    spinOffJobsPerDirectJob:1.5,
    internationalRecruitmentSharePct:0,
    hostResidencePct:60,internalSharePct:10,phaseYears:4
  }];

  function setup(){
    fillGeo();
    fillForecastEndYears();
    fillCalibrationWindows();
    fillFertilityScenario();
    fillLabourWorkplace();
    fillMigrationWeightGeo();
    bindTabs();
    renderScenarioTables();
    $("runBtn").addEventListener("click",run);
    $("dataFile").addEventListener("change",loadFile);
    $("exportBtn").addEventListener("click",exportCsv);
    $("addHousing").addEventListener("click",()=>{syncScenarioTables();defaultHousing.push(blankHousing());renderScenarioTables();});
    $("addWorkplace").addEventListener("click",()=>{syncScenarioTables();defaultWorkplaces.push(blankWorkplace());renderScenarioTables();});
    ["fertilityScenario","migrationWindow","fertMult","mortMult","migMult"].forEach(id=>{
      if($(id)) $(id).addEventListener("change",run);
    });
    ["geo","window","endYear"].forEach(id=>$(id).addEventListener("change",()=>{
      if(id==="geo" && $("geo").value!=="FA_LULEA" && $("labourWorkplace")){
        $("labourWorkplace").value=$("geo").value;
      }
      run();
    }));
    ["labourWorkplace","labourScenarioYear","labourAddedJobs","labourExternalMovePct","labourPersonsPerMover","labourInternationalSharePct"].forEach(id=>{
      if($(id)) $(id).addEventListener("change",renderLabourAnalysis);
    });
    if($("migrationWeightGeo")) $("migrationWeightGeo").addEventListener("change",renderMigrationLocalWeightCharts);
    if($("labourToScenario")) $("labourToScenario").addEventListener("click",addLabourScenarioToForecast);
    ["householdProjectionMode","householdManualSize","housingReservePct"].forEach(id=>{
      if($(id)) $(id).addEventListener("change",renderHousingAnalysis);
    });
    renderDataStatus();
    renderStatus();
    if(data?.meta?.dataReady) run();
  }

  function fillFertilityScenario(){
    const el=$("fertilityScenario");
    if(!el) return;
    const current=el.value||data?.parameters?.defaultFertilityScenario||"raps2024";
    const scenarios=(data?.fertilityScenarios?.length
      ? data.fertilityScenarios
      : [{id:"raps2024",label:"rAps/SCB 2024 (bas)",isBaseline:true}]);
    el.innerHTML=scenarios.map(s=>
      `<option value="${s.id}" ${s.id===current?"selected":""}>${s.label||s.id}</option>`
    ).join("");
    if(!scenarios.some(s=>s.id===el.value)) el.value=scenarios[0]?.id||"raps2024";
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
  function housingDefaultFor(s){
    if(!housing?.occupancyDefaults?.length) return null;
    const targetYear=Number(housing.meta?.occupancyDefaultYear||2024);
    const size=s.dwellingType==="småhus"?"alla":s.size;
    const rows=housing.occupancyDefaults.filter(r=>
      +r.year===targetYear &&
      r.dwellingType===s.dwellingType &&
      r.tenure===s.tenure &&
      (r.geo===s.municipality || r.geo==="00")
    );
    const ranked=rows
      .map(r=>({
        row:r,
        score:(r.geo===s.municipality?100:0) +
          (r.size===size?20:r.size==="alla"?10:0)
      }))
      .filter(x=>x.score>0)
      .sort((a,b)=>b.score-a.score);
    return ranked[0]?.row||null;
  }

  function applyAutoHousingDefaults(){
    defaultHousing.forEach(s=>{
      if(!s.personsMode) s.personsMode="auto";
      if(s.personsMode==="manual") return;
      const d=housingDefaultFor(s);
      if(d){
        s.personsPerDwelling=Number(d.personsPerDwelling);
        s.personsSource=`${d.geo==="00"?"Riket":s.municipality} · ${d.year} · ${d.source}`;
      }else{
        // Never keep a stale automatic persons-per-dwelling value when the
        // selected dwelling/tenure combination has no SCB default.
        s.personsMode="manual";
        s.personsSource="SCB-standard saknas – manuell nivå krävs";
      }
    });
  }

  function fillCalibrationWindows(){
    const main=$("window");
    const defaultWindow=Number(data?.calibration?.defaultYears||10);
    const options=(data?.calibration?.options||[defaultWindow]).map(Number).sort((a,b)=>a-b);
    const current=Number(main?.value||defaultWindow);
    if(main){
      main.innerHTML=options.map(v=>`<option value="${v}">${v} år${v===defaultWindow?" (standard)":""}</option>`).join("");
      main.value=String(options.includes(current)?current:(options.includes(defaultWindow)?defaultWindow:options.at(-1)));
    }
    const mig=$("migrationWindow");
    if(mig){
      const migCurrent=mig.value;
      const migOptions=(data?.diagnostics?.migrationCalibrationWindows||[10]).map(Number).sort((a,b)=>a-b);
      mig.innerHTML=`<option value="">Automatiskt (globalt ${options.join("/")})</option>`+
        migOptions.map(v=>`<option value="${v}">${v} år</option>`).join("");
      if(migOptions.includes(Number(migCurrent))) mig.value=migCurrent;
    }
  }

  function fillForecastEndYears(){
    const el=$("endYear");
    if(!el) return;
    const baseYear=Number(data?.meta?.baseYear);
    if(!Number.isFinite(baseYear)) return;
    const years=Array.from({length:10},(_,i)=>baseYear+i+1);
    el.innerHTML=years.map(year=>`<option value="${year}">${year}</option>`).join("");
    el.value=String(baseYear+10);
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

  function fillMigrationWeightGeo(){
    const el=$("migrationWeightGeo");
    if(!el) return;
    const geos=(data.geographies||[]).filter(g=>g.code!=="FA_LULEA");
    el.innerHTML=geos.map(g=>`<option value="${g.code}">${g.name}</option>`).join("");
    const globalGeo=$("geo")?.value;
    el.value=geos.some(g=>g.code===globalGeo)?globalGeo:(geos.some(g=>g.code==="2580")?"2580":geos[0]?.code||"");
  }
  function blankHousing(){
    return {active:true,year:2030,municipality:"2580",dwellingType:"flerbostadshus",tenure:"hyresrätt",size:"2 rum",dwellings:100,completionPct:100,occupancyPct:95,personsMode:"auto",personsPerDwelling:1.6,externalSharePct:50,internalSharePct:25,phaseYears:3};
  }
  function blankWorkplace(){
    return {
      active:true,year:2034,municipality:"2580",jobs:1000,
      allocationMode:"commuting",ageProfileMode:"worker_household",
      realizationPct:60,moveSharePct:25,personsPerJob:1.7,
      spinOffJobsPerDirectJob:1.5,
      internationalRecruitmentSharePct:0,
      hostResidencePct:60,internalSharePct:10,phaseYears:4
    };
  }

  function renderScenarioTables(){
    applyAutoHousingDefaults();
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
      <td><select data-k="personsMode">
        <option value="auto" ${s.personsMode!=="manual"?"selected":""}>SCB auto</option>
        <option value="manual" ${s.personsMode==="manual"?"selected":""}>Manuell</option>
      </select></td>
      <td title="${s.personsSource||""}"><input data-k="personsPerDwelling" type="number" value="${Number(s.personsPerDwelling||0).toFixed(2)}" min="0" step="0.01" ${s.personsMode!=="manual"?"readonly":""}></td>
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
      <td><input data-k="spinOffJobsPerDirectJob" type="number" value="${Number(s.spinOffJobsPerDirectJob??1.5)}" min="0" max="3" step="0.1"></td>
      <td><input data-k="internationalRecruitmentSharePct" type="number" value="${Number(s.internationalRecruitmentSharePct||0)}" min="0" max="100"></td>
      <td><input data-k="hostResidencePct" type="number" value="${s.hostResidencePct}" min="0" max="100"></td>
      <td><input data-k="internalSharePct" type="number" value="${s.internalSharePct}" min="0" max="100"></td>
      <td><input data-k="phaseYears" type="number" value="${s.phaseYears}" min="1" max="20"></td>
      <td><button class="secondary removeWorkplace compact" data-i="${i}">×</button></td>
    </tr>`).join("");

    document.querySelectorAll(".removeHousing").forEach(b=>b.addEventListener("click",()=>{syncScenarioTables();defaultHousing.splice(+b.dataset.i,1);renderScenarioTables();run();}));
    document.querySelectorAll(".removeWorkplace").forEach(b=>b.addEventListener("click",()=>{syncScenarioTables();defaultWorkplaces.splice(+b.dataset.i,1);renderScenarioTables();run();}));
    hBody.querySelectorAll("input,select").forEach(el=>el.addEventListener("change",()=>{
      const keyName=el.dataset.k;
      syncScenarioTables();
      if(["municipality","dwellingType","tenure","size","personsMode"].includes(keyName)){
        applyAutoHousingDefaults();
        renderScenarioTables();
      }
      renderHousingAnalysis();
    }));
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
      const internationalShare=Math.max(0,Math.min(100,Number(s.internationalRecruitmentSharePct||0)));
      const directRealizedJobs=Number(s.jobs||0)*Number(s.realizationPct||0)/100;
      const spinOffFactor=Math.max(0,Number(s.spinOffJobsPerDirectJob??0));
      const spinOffJobs=directRealizedJobs*spinOffFactor;
      const realizedJobs=directRealizedJobs+spinOffJobs;
      const movingJobs=realizedJobs*outside/100*Math.max(0,Math.min(100,Number(s.moveSharePct||0)))/100;
      const movingPersons=movingJobs*Math.max(0,Number(s.personsPerJob||0));
      const internationalPersons=movingPersons*internationalShare/100;
      const domesticPersons=movingPersons-internationalPersons;
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
        Direkta realiserade jobb: ca ${fmt.format(directRealizedJobs)}. Spridningseffekt ${Number(spinOffFactor).toLocaleString("sv-SE")} per direkt jobb ger ca ${fmt.format(spinOffJobs)} ytterligare jobb och ca ${fmt.format(realizedJobs)} jobb totalt i scenariots arbetskraftseffekt.
        Av jobben utanför FA antas ${pct.format(Number(s.moveSharePct||0))} % flytta till FA.
        Av denna externa jobbdrivna inflyttning anges ${pct.format(internationalShare)} % som internationell rekrytering
        (ca ${fmt.format(internationalPersons)} personer) och ca ${fmt.format(domesticPersons)} personer från övriga Sverige.
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
    renderModelMaturity();
    renderFadingPolicy();
  }

  function renderModelMaturity(){
    const el=$("modelMaturity");
    if(!el) return;
    if(!maturity?.components?.length){
      el.innerHTML="<p class=\"hint\">Mognadsrapport genereras i nästa modellkörning.</p>";
      return;
    }
    const levelLabel=l=>`Nivå ${l} · ${maturity.levels?.[String(l)]?.name||""}`;
    const stateLabel=s=>({
      production:"Produktion",
      production_support:"Produktionsstöd",
      production_ready_scenario:"Produktionsklart scenario",
      active_needs_final_gate:"Aktiv – sista grind saknas",
      validated_candidate:"Validerad kandidat",
      development:"Utveckling",
      development_scenario:"Scenarioutveckling",
      diagnostic:"Diagnostik",
      rejected:"Avslutad",
      rejected_superseded:"Avslutad – ersatt",
      rejected_current_architecture:"Avslutad – nuvarande arkitektur"
    }[s]||s);
    const rows=maturity.components.map(c=>{
      const gates=(c.gates||[]).map(g=>`${g.passed?"✓":"✗"} ${g.label}`).join("<br>");
      return `<tr>
        <td>${c.label}</td>
        <td>${levelLabel(c.maturityLevel)}</td>
        <td>${stateLabel(c.lifecycle)}</td>
        <td>${c.productionActive?"Ja":"Nej"}</td>
        <td>${gates}</td>
        <td>${c.nextAction||"–"}</td>
      </tr>`;
    }).join("");
    const l4=maturity.summary?.productionLevel4?.length||0;
    const rejected=maturity.summary?.rejected?.length||0;
    el.innerHTML=`
      <div class="policyGrid">
        <div><span>Komponenter</span><strong>${maturity.summary?.componentCount||0}</strong></div>
        <div><span>Nivå 4</span><strong>${l4}</strong></div>
        <div><span>Avslutade kandidater</span><strong>${rejected}</strong></div>
      </div>
      <div class="analysisTableWrap"><table class="miniTable">
        <thead><tr><th>Komponent</th><th>Mognad</th><th>Status</th><th>Aktiv</th><th>Grindar</th><th>Nästa steg</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function renderFadingPolicy(){
    const p=data.diagnostics?.relativeFactors?.fallbackFading;
    if(!p){$("fadingPolicy").innerHTML="<p>Ingen policy för informationsvägd utjämning hittades.</p>";return;}
    $("fadingPolicy").innerHTML=`
      <div class="policyGrid">
        <div><span>0 % lokal vikt t.o.m.</span><strong>${p.zeroLocalExposure??"–"}</strong></div>
        <div><span>100 % populationssignal från</span><strong>${p.fullLocalExposure??"–"}</strong></div>
        <div><span>100 % händelsesignal från</span><strong>${p.fullExpectedEvents??"–"}</strong></div>
        <div><span>Max lokal vikt</span><strong>${pct.format((p.maxLocalWeight||0)*100)} %</strong></div>
        <div><span>Utfallsberoende lokal vikt?</span><strong>${p.weightDependsOnOutcome===false?"Nej":"–"}</strong></div>
      </div>
      <p class="hint">${p.governance||""}</p>`;
  }

  async function loadFile(ev){
    const file=ev.target.files?.[0]; if(!file)return;
    try{
      const parsed=JSON.parse(await file.text());
      if(!parsed.meta||!parsed.geographies) throw new Error("Ogiltigt schema.");
      data=parsed; fillGeo(); fillForecastEndYears(); fillFertilityScenario(); renderScenarioTables(); renderDataStatus(); run();
    }catch(e){renderStatus("Kunde inte läsa datafil: "+e.message);}
  }

  function run(){
    try{
      const common={
        geo:$("geo").value,
        endYear:+$("endYear").value,
        fertilityScenario:$("fertilityScenario")?.value||"raps2024",
        migrationWindow:$("migrationWindow")?.value ? +$("migrationWindow").value : undefined,
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
      const renderErrors=renderAll();
      renderStatus(renderErrors.length
        ? `Beräkningen genomfördes, men UI-fel kvarstår: ${renderErrors.join("; ")}`
        : "Beräkningen genomfördes.");
      $("exportBtn").disabled=false;
    }catch(e){
      latest=[];baseline=[];$("exportBtn").disabled=true;renderStatus(e.message);
    }
  }

  function renderAll(){
    const errors=[];
    const renderers=[
      ["Resultat",renderResults],
      ["Befolkningsanalys",renderAnalysis],
      ["Åldersanalys",renderDetailedAgeAnalysis],
      ["Flyttningar",renderMigrationAnalysis],
      ["Lokala flyttvikter",renderMigrationLocalWeightCharts],
      ["Unga vuxna",renderYoungAdultMigrationDiagnostic],
      ["Flyttben",renderMigrationLegDiagnostic],
      ["Arbetsmarknad",renderLabourAnalysis],
      ["Hushåll och bostad",renderHousingAnalysis],
      ["Validering",renderValidation],
      ["Datastatus",renderDataStatus]
    ];
    renderers.forEach(([name,fn])=>{
      try{
        fn();
      }catch(e){
        console.error(`Renderingsfel i ${name}`,e);
        errors.push(`${name}: ${e?.message||e}`);
      }
    });
    return errors;
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
      $("benchmarkCards").innerHTML="<p class='hint'>Jämförelsedata genereras i nästa arbetsflödeskörning.</p>";return;
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
    if(!f){$("windowComparison").innerHTML="<p class='hint'>Valideringsdata genereras i nästa arbetsflödeskörning.</p>";return;}
    $("windowComparison").innerHTML=`<table class="miniTable"><thead><tr><th>Fönster</th><th>2050</th><th>Förändring</th></tr></thead><tbody>
      ${[3,6,10].map(w=>`<tr><td>${w} år</td><td>${fmt.format(f[w]?.endPopulation||0)}</td><td>${(f[w]?.changePct||0)>=0?"+":""}${pct.format(f[w]?.changePct||0)} %</td></tr>`).join("")}
      </tbody></table>`;
  }

  function renderRelativeFactors(geo){
    const rf=validation?.relativeFactors||data.diagnostics?.relativeFactors;
    const fert=rf?.fertility||[], mort=rf?.mortality||[];
    $("relativeFactors").innerHTML=`<table class="miniTable"><thead><tr><th>Fönster</th><th>Fruktsamhet</th><th>Dödlighet</th></tr></thead><tbody>
      ${[3,6,10].map(w=>{
        const a=fert.find(x=>x.geo===geo&&+x.window===w);
        const b=mort.find(x=>x.geo===geo&&+x.window===w);
        return `<tr><td>${w} år</td><td>${a?pct.format(a.raw*100)+" %":"–"}</td><td>${b?pct.format(b.raw*100)+" %":"–"}</td></tr>`;
      }).join("")}
      </tbody></table>
      <p class="hint">100 % = rikets åldersstandardiserade nivå. Informationsvägd utjämning sker därefter per ålderscell.</p>`;
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
      $("fadingExamples").innerHTML="<p class='hint'>Diagnostik för informationsvägd utjämning genereras i nästa arbetsflödeskörning.</p>";
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
    const jobDomestic=r.reduce((s,x)=>s+Number(x.scenarioDetail?.jobExternalDomestic||0),0);
    const jobInternational=r.reduce((s,x)=>s+Number(x.scenarioDetail?.jobExternalInternational||0),0);
    $("balanceSummary").innerHTML=`
      <div class="kv"><span>Födda, ack.</span><strong>+${fmt.format(births)}</strong></div>
      <div class="kv"><span>Döda, ack.</span><strong>−${fmt.format(deaths)}</strong></div>
      <div class="kv"><span>Nettoflyttning, ack.</span><strong>${mig>=0?"+":""}${fmt.format(mig)}</strong></div>
      <div class="kv"><span>Scenarioeffekt, ack.</span><strong>${scenario>=0?"+":""}${fmt.format(scenario)}</strong></div>
      ${jobDomestic||jobInternational?`<div class="kv"><span>Jobbscenario, extern från Sverige</span><strong>+${fmt.format(jobDomestic)}</strong></div>
      <div class="kv"><span>Jobbscenario, internationell</span><strong>+${fmt.format(jobInternational)}</strong></div>`:""}`;
  }

  function renderDetailedAgeAnalysis(){
    const geo=$("geo").value, w=+$("window").value;
    const geoLabel=data.geographies?.find(g=>g.code===geo)?.name||"Lokal";
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

      const national=fert.map(r=>Number(r.nationalRate||0)*1000);
      const local=fert.map(r=>{
        const nat=Number(r.nationalRate||0), ratio=Number(r.rawCellFactor);
        return Number.isFinite(ratio)?nat*ratio*1000:null;
      });
      drawAgeLineChart("fertilityRateChart",fert.map(r=>+r.age),[
        {name:`${geoLabel} observerad`,values:local,cls:"lineVariation"},
        {name:"Riket",values:national,cls:"lineSensitivity"}
      ],{includeZero:true,xLabel:"Ålder",hoverLabel:"Ålder",valueDigits:1});

      drawAgeLineChart("fertilityWeightChart",fert.map(r=>+r.age),[
        {name:"Lokal vikt",values:fert.map(r=>Number(r.cellLocalWeight||0)*100),cls:"lineLocalWeight",suffix:" %"}
      ],{yMin:0,yMax:100,xLabel:"Ålder",valueDigits:1});
    }else{
      $("fertilityAgeTable").querySelector("tbody").innerHTML="";
      $("fertilityRateChart").innerHTML="";
      $("fertilityWeightChart").innerHTML="";
    }

    const ages=[...new Set(mort.map(r=>+r.age))].sort((a,b)=>a-b);
    const women=ages.map(age=>mort.find(r=>+r.age===age&&r.sex==="K"));
    const men=ages.map(age=>mort.find(r=>+r.age===age&&r.sex==="M"));
    $("mortalityAgeTable").querySelector("tbody").innerHTML=ages.map((age,i)=>{
      const femaleRow=women[i], maleRow=men[i];
      return `<tr>
        <td>${age===100?"100+":age}</td>
        <td>${femaleRow?.cellLocalWeight==null?"–":pct.format(femaleRow.cellLocalWeight*100)+" %"}</td>
        <td>${maleRow?.cellLocalWeight==null?"–":pct.format(maleRow.cellLocalWeight*100)+" %"}</td>
        <td>${femaleRow?.cellExpectedEvents==null?"–":fmt1.format(femaleRow.cellExpectedEvents)}</td>
        <td>${maleRow?.cellExpectedEvents==null?"–":fmt1.format(maleRow.cellExpectedEvents)}</td>
        <td>${femaleRow?.rawCellFactor==null?"–":pct.format(femaleRow.rawCellFactor*100)+" %"}</td>
        <td>${maleRow?.rawCellFactor==null?"–":pct.format(maleRow.rawCellFactor*100)+" %"}</td>
      </tr>`;
    }).join("");

    if(ages.length){
      const riskPer1000=r=>{
        if(!r) return null;
        const hazard=Number(r.nationalHazard||0);
        return (1-Math.exp(-Math.max(0,hazard)))*1000;
      };
      const localRiskPer1000=r=>{
        if(!r) return null;
        const hazard=Number(r.nationalHazard||0);
        const ratio=Number(r.rawCellFactor);
        if(!Number.isFinite(ratio)) return null;
        return (1-Math.exp(-Math.max(0,hazard*ratio)))*1000;
      };
      const splitMortality=(fromAge,toAge)=>{
        const splitAges=ages.filter(age=>age>=fromAge && age<=toAge);
        const splitWomen=splitAges.map(age=>mort.find(r=>+r.age===age&&r.sex==="K"));
        const splitMen=splitAges.map(age=>mort.find(r=>+r.age===age&&r.sex==="M"));
        return {ages:splitAges,women:splitWomen,men:splitMen};
      };
      const younger=splitMortality(0,70);
      const older=splitMortality(71,100);

      drawAgeLineChart("mortalityRateYoungChart",younger.ages,[
        {name:`${geoLabel} kvinnor`,values:younger.women.map(localRiskPer1000),cls:"lineVariation"},
        {name:"Riket kvinnor",values:younger.women.map(riskPer1000),cls:"lineWomen"},
        {name:`${geoLabel} män`,values:younger.men.map(localRiskPer1000),cls:"lineSensitivity"},
        {name:"Riket män",values:younger.men.map(riskPer1000),cls:"lineMen"}
      ],{includeZero:true,xLabel:"Ålder",hoverLabel:"Ålder",valueDigits:1});

      drawAgeLineChart("mortalityRateOldChart",older.ages,[
        {name:`${geoLabel} kvinnor`,values:older.women.map(localRiskPer1000),cls:"lineVariation"},
        {name:"Riket kvinnor",values:older.women.map(riskPer1000),cls:"lineWomen"},
        {name:`${geoLabel} män`,values:older.men.map(localRiskPer1000),cls:"lineSensitivity"},
        {name:"Riket män",values:older.men.map(riskPer1000),cls:"lineMen"}
      ],{includeZero:true,xLabel:"Ålder",hoverLabel:"Ålder",valueDigits:1});

      drawAgeLineChart("mortalityWeightChart",ages,[
        {name:"Kvinnor lokal vikt",values:women.map(r=>Number(r?.cellLocalWeight||0)*100),cls:"lineWomen",suffix:" %"},
        {name:"Män lokal vikt",values:men.map(r=>Number(r?.cellLocalWeight||0)*100),cls:"lineMen",suffix:" %"}
      ],{yMin:0,yMax:100,xLabel:"Ålder",valueDigits:1});
    }else{
      $("mortalityRateYoungChart").innerHTML="";
      $("mortalityRateOldChart").innerHTML="";
      $("mortalityWeightChart").innerHTML="";
    }
  }

  function renderMigrationAnalysis(){
    const geo=$("geo").value;
    const globalWindow=+$("window").value;
    const w=$("migrationWindow")?.value
      ? +$("migrationWindow").value
      : ([2,3,4,6,10].includes(globalWindow) ? globalWindow : 10);
    const rows=(data.diagnostics?.migrationByAge||[])
      .filter(r=>r.geo===geo && +r.window===w)
      .sort((a,b)=>+a.age-+b.age);

    if(!rows.length){
      ["migrationInflowKpi","migrationOutflowKpi","migrationNetKpi","migrationImpactKpi"].forEach(id=>$(id).textContent="–");
      $("migrationImpactAge").textContent="genereras i nästa arbetsflödeskörning";
      $("migrationAgeTable").querySelector("tbody").innerHTML="";
      $("migrationPriority").innerHTML="<p class='hint'>Flyttdiagnostik genereras i nästa arbetsflödeskörning.</p>";
      $("migrationAgeChart").innerHTML="";
      $("migrationVariationChart").innerHTML="";
      if($("migrationSmoothingChart")) $("migrationSmoothingChart").innerHTML="";
      if($("migrationSmoothingDiagnostic")) $("migrationSmoothingDiagnostic").innerHTML="<p class='hint'>Adaptiv åldersmjukning genereras i nästa arbetsflödeskörning.</p>";
      if($("youngAdultMigrationDiagnostic")) $("youngAdultMigrationDiagnostic").innerHTML="<p class='hint'>Ungdoms-/unga-vuxna-diagnostik genereras i nästa arbetsflödeskörning.</p>";
      if($("migrationLegDiagnostic")) $("migrationLegDiagnostic").innerHTML="<p class='hint'>Flyttben genereras i nästa arbetsflödeskörning.</p>";
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
    renderMigrationSmoothingDiagnostic();
  }

  function renderMigrationSmoothingDiagnostic(){
    const chart=$("migrationSmoothingChart");
    const el=$("migrationSmoothingDiagnostic");
    if(!chart || !el) return;
    const geo="2580";
    const diag=data.diagnostics?.migrationAgeSmoothing;
    const embeddedCompact=data.diagnostics?.migrationAgeSmoothingCompact;
    const compact=(
      smoothingDiagnostic?.geo===geo &&
      Array.isArray(smoothingDiagnostic?.allAgeDirectionRows) &&
      smoothingDiagnostic.allAgeDirectionRows.length
    ) ? smoothingDiagnostic : embeddedCompact;
    const compactRows=(
      compact?.geo===geo && Array.isArray(compact?.allAgeDirectionRows)
    ) ? compact.allAgeDirectionRows : [];
    const rows=compactRows.length
      ? compactRows
      : (diag?.rows||[]).filter(r=>r.geo===geo && r.leg==="all");
    if(!rows.length){
      chart.innerHTML="";
      el.innerHTML="<p class='hint'>Adaptiv åldersmjukning genereras i nästa arbetsflödeskörning.</p>";
      return;
    }

    const ages=[...new Set(rows.map(r=>+r.age))].sort((a,b)=>a-b);
    const aggregate=(direction,field,age)=>rows
      .filter(r=>r.direction===direction && +r.age===age)
      .reduce((s,r)=>s+Number(r[field]||0),0);

    drawAgeLineChart("migrationSmoothingChart",ages,[
      {name:"Inflyttning rå",values:ages.map(a=>aggregate("in","rawMeanPersons",a)),cls:"lineInflow"},
      {name:"Inflyttning adaptiv",values:ages.map(a=>aggregate("in","smoothedMeanPersons",a)),cls:"lineSensitivity"},
      {name:"Utflyttning rå",values:ages.map(a=>aggregate("out","rawMeanPersons",a)),cls:"lineOutflow"},
      {name:"Utflyttning adaptiv",values:ages.map(a=>aggregate("out","smoothedMeanPersons",a)),cls:"lineVariation"}
    ],{includeZero:true,xLabel:"Ålder",valueDigits:1});

    const byAge=ages.map(age=>{
      const ageRows=rows.filter(r=>+r.age===age);
      const rawIn=aggregate("in","rawMeanPersons",age);
      const smoothIn=aggregate("in","smoothedMeanPersons",age);
      const rawOut=aggregate("out","rawMeanPersons",age);
      const smoothOut=aggregate("out","smoothedMeanPersons",age);
      const retention=ageRows.length
        ? ageRows.reduce((s,r)=>s+Number(r.localRetentionWeight ?? r.directLocalWeight ?? 0),0)/ageRows.length
        : 0;
      const smoothing=ageRows.length
        ? ageRows.reduce((s,r)=>s+Number(r.smoothingWeight ?? r.neighborLocalWeight ?? 0),0)/ageRows.length
        : 0;
      return {
        age,rawIn,smoothIn,rawOut,smoothOut,retention,smoothing,
        change:Math.abs(smoothIn-rawIn)+Math.abs(smoothOut-rawOut)
      };
    }).sort((a,b)=>b.change-a.change).slice(0,12);

    el.innerHTML=`
      <p class="hint">Metoden jämnar bara isolerad lokal taggighet utöver den ålderskurvatur som också syns i Riket. En cell behålls nära rå Luleåprofil om den har många årliga händelser eller återkommer stabilt över tid. Tydlig utjämning sker först när båda stöden är svaga.</p>
      <table class="miniTable">
        <thead><tr><th>Ålder</th><th>Rå in</th><th>Adaptiv in</th><th>Rå ut</th><th>Adaptiv ut</th><th>Lokal retention</th><th>Utjämningsvikt</th></tr></thead>
        <tbody>${byAge.map(r=>`<tr>
          <td>${r.age===100?"100+":r.age}</td>
          <td>${fmt1.format(r.rawIn)}</td>
          <td>${fmt1.format(r.smoothIn)}</td>
          <td>${fmt1.format(r.rawOut)}</td>
          <td>${fmt1.format(r.smoothOut)}</td>
          <td>${pct.format(r.retention*100)} %</td>
          <td>${pct.format(r.smoothing*100)} %</td>
        </tr>`).join("")}</tbody>
      </table>
      <p class="hint">Status: diagnostik. Ingen utjämnad åldersprofil används ännu av produktionsprognosen.</p>`;
  }

  function renderMigrationLocalWeightCharts(){
    const note=$("migrationLocalWeightNote");
    const windowLabel=$("migrationLocalWeightWindow");
    const ids=[
      "migrationWeightCountyIn","migrationWeightCountyOut",
      "migrationWeightRestIn","migrationWeightRestOut",
      "migrationWeightInternationalIn","migrationWeightInternationalOut"
    ];
    const clear=(msg)=>{
      ids.forEach(id=>{const el=$(id);if(el)el.innerHTML="";});
      if(note) note.innerHTML=`<p class="hint">${msg}</p>`;
    };

    const geo=$("migrationWeightGeo")?.value||"2580";
    const embeddedCompact=data.diagnostics?.migrationAgeSmoothingCompact;
    const compact=(
      Array.isArray(smoothingDiagnostic?.legSexLocalWeightRows) &&
      smoothingDiagnostic.legSexLocalWeightRows.length
    ) ? smoothingDiagnostic : embeddedCompact;
    const rows=(compact?.legSexLocalWeightRows||[]).filter(r=>r.geo===geo);
    if(!rows.length){
      if(windowLabel) windowLabel.textContent="–";
      clear("De sex lokala flyttvikterna genereras i nästa Update SCB data-körning.");
      return;
    }

    const diagnosticWindow=Number(compact?.window||rows[0]?.window||0);
    if(windowLabel){
      windowLabel.textContent=diagnosticWindow
        ? `Diagnostiskt profilfönster: ${diagnosticWindow} år`
        : "Diagnostisk profil";
    }

    const specs=[
      {id:"migrationWeightCountyIn",leg:"county",direction:"in"},
      {id:"migrationWeightCountyOut",leg:"county",direction:"out"},
      {id:"migrationWeightRestIn",leg:"rest_sweden",direction:"in"},
      {id:"migrationWeightRestOut",leg:"rest_sweden",direction:"out"},
      {id:"migrationWeightInternationalIn",leg:"international",direction:"in"},
      {id:"migrationWeightInternationalOut",leg:"international",direction:"out"}
    ];

    for(const spec of specs){
      const rr=rows.filter(r=>r.leg===spec.leg&&r.direction===spec.direction);
      const ages=[...new Set(rr.map(r=>+r.age))].sort((a,b)=>a-b);
      const women=ages.map(age=>rr.find(r=>+r.age===age&&r.sex==="K"));
      const men=ages.map(age=>rr.find(r=>+r.age===age&&r.sex==="M"));
      drawAgeLineChart(spec.id,ages,[
        {
          name:"Kvinnor lokal vikt",
          values:women.map(r=>Number(r?.localRetentionWeight||0)*100),
          cls:"lineWomen",
          suffix:" %"
        },
        {
          name:"Män lokal vikt",
          values:men.map(r=>Number(r?.localRetentionWeight||0)*100),
          cls:"lineMen",
          suffix:" %"
        }
      ],{yMin:0,yMax:100,xLabel:"Ålder",valueDigits:1});
    }

    const meanWeight=rows.length
      ? rows.reduce((sum,r)=>sum+Number(r.localRetentionWeight||0),0)/rows.length
      : 0;
    const meanInfo=rows.length
      ? rows.reduce((sum,r)=>sum+Number(r.informationWeight||0),0)/rows.length
      : 0;
    const meanPersistence=rows.length
      ? rows.reduce((sum,r)=>sum+Number(r.persistenceWeight||0),0)/rows.length
      : 0;
    if(note){
      note.innerHTML=`
        <div class="policyGrid">
          <div><span>Genomsnittlig lokal retention</span><strong>${pct.format(meanWeight*100)} %</strong></div>
          <div><span>Genomsnittlig informationsvikt</span><strong>${pct.format(meanInfo*100)} %</strong></div>
          <div><span>Genomsnittlig persistensvikt</span><strong>${pct.format(meanPersistence*100)} %</strong></div>
        </div>
        <p class="hint">Detta är diagnostik för den framtida flyttmodellen. Produktionsbaslinjen är fortfarande net10 och använder inte dessa sex ålder/kön-vikter ännu. Kommunprofilen väljs separat eftersom FA-nivån inte ännu har en egen korrekt aggregerad viktprofil.</p>`;
    }
  }

  function renderYoungAdultMigrationDiagnostic(){
    const el=$("youngAdultMigrationDiagnostic");
    if(!el) return;
    const geo=$("geo").value;
    const diag=data.diagnostics?.youngAdultMigration;
    if(geo!=="2580"){
      el.innerHTML="<p class='hint'>19–25-årsdiagnostiken visas för Luleå kommun och beskriver faktiska åldersflöden, inte studentstatus.</p>";
      return;
    }
    if(!diag?.summaries?.length){
      el.innerHTML="<p class='hint'>19–25-årsdiagnostik genereras i nästa arbetsflödeskörning.</p>";
      return;
    }
    const globalWindow=+$("window").value;
    const selectedWindow=$("migrationWindow")?.value
      ? +$("migrationWindow").value
      : ([2,3,4,6,10].includes(globalWindow) ? globalWindow : 10);
    const rows=diag.summaries.filter(r=>+r.window===selectedWindow);
    el.innerHTML=`
      <p class="hint">Åldersmönster i faktisk flyttstatistik. 19–20 år redovisas som tydlig inflyttningsålder, 24–25 år som tydlig utflyttningsålder och 19–25 år som bred kontrollgrupp.</p>
      <table class="miniTable">
        <thead><tr><th>Approximation</th><th>Fönster</th><th>Inflyttning/år</th><th>Utflyttning/år</th><th>Netto/år</th><th>SD netto</th><th>Netto 2024</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>
          <td>${r.label}</td>
          <td>${r.window} år</td>
          <td>${fmt1.format(r.meanInflow||0)}</td>
          <td>${fmt1.format(r.meanOutflow||0)}</td>
          <td>${(r.meanNetMigration||0)>=0?"+":""}${fmt1.format(r.meanNetMigration||0)}</td>
          <td>${fmt1.format(r.sdNetMigration||0)}</td>
          <td>${r.latestYearNetMigration==null?"–":((r.latestYearNetMigration>=0?"+":"")+fmt1.format(r.latestYearNetMigration))}</td>
        </tr>`).join("")}</tbody>
      </table>
      <p class="hint">${diag.interpretation||""}</p>`;
  }

  function renderMigrationLegDiagnostic(){
    const el=$("migrationLegDiagnostic");
    if(!el) return;
    const geo=$("geo").value;
    if(geo!=="2580"){
      el.innerHTML="<p class='hint'>Tre-bensdiagnostiken visas här för Luleå kommun. För FA kräver länsbrutto särskild hantering av interna FA-flyttar.</p>";
      return;
    }
    const d=data.diagnostics?.migrationLegs;
    if(!d?.summaries?.length){
      el.innerHTML="<p class='hint'>Tre-bensdiagnostik genereras i nästa arbetsflödeskörning.</p>";
      return;
    }
    const globalWindow=+$("window").value;
    const w=$("migrationWindow")?.value
      ? +$("migrationWindow").value
      : ([2,3,4,6,10].includes(globalWindow) ? globalWindow : 10);
    const rows=d.summaries.filter(r=>r.geo==="2580" && +r.window===w);
    const y2025=(d.observed2025||[]).filter(r=>r.geo==="2580");
    el.innerHTML=`
      <p class="hint">Tre geografiska flyttben. Varje ben kan senare få eget kalibreringsfönster om n+1/n+2-valideringen visar att det förbättrar prognosen.</p>
      <table class="miniTable">
        <thead><tr><th>Flyttben</th><th>Fönster</th><th>In/år</th><th>Ut/år</th><th>Netto/år</th><th>Netto 2025</th></tr></thead>
        <tbody>${rows.map(r=>{
          const actual=y2025.find(x=>x.leg===r.leg);
          return `<tr>
            <td>${r.label}</td><td>${r.window} år</td>
            <td>${fmt1.format(r.meanInflow||0)}</td>
            <td>${fmt1.format(r.meanOutflow||0)}</td>
            <td>${(r.meanNetMigration||0)>=0?"+":""}${fmt1.format(r.meanNetMigration||0)}</td>
            <td>${actual==null?"–":((actual.netMigration>=0?"+":"")+fmt1.format(actual.netMigration))}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
  }

  function drawAgeLineChart(svgId,xValues,series,options={}){
    const svg=$(svgId),W=900,H=options.height||330,p=48;
    if(!svg||!xValues.length){if(svg)svg.innerHTML="";return;}
    const all=series.flatMap(s=>s.values
      .map(v=>v==null?NaN:Number(v))
      .filter(Number.isFinite));
    let min=options.yMin!=null?options.yMin:Math.min(...all);
    let max=options.yMax!=null?options.yMax:Math.max(...all);
    if(options.includeZero){min=Math.min(0,min);max=Math.max(0,max);}
    if(!Number.isFinite(min))min=0;if(!Number.isFinite(max))max=1;
    const domain=niceAxisDomain(min,max,5);
    min=domain.min; max=domain.max;
    const span=Math.max(1e-9,max-min);
    const xmin=Math.min(...xValues),xmax=Math.max(...xValues),xspan=Math.max(1,xmax-xmin);
    const x=v=>p+(v-xmin)*(W-2*p)/xspan;
    const y=v=>H-p-(v-min)*(H-2*p)/span;

    const grid=domain.ticks.map(val=>{
      const yy=y(val);
      return `<line x1="${p}" y1="${yy}" x2="${W-p}" y2="${yy}" class="gridline"/><text x="8" y="${yy+4}" class="axisText">${fmt1.format(val)}</text>`;
    }).join("");
    const lines=series.map(s=>{
      const points=xValues.map((age,i)=>{
        const v=s.values[i];
        return v==null||!Number.isFinite(Number(v))?null:`${x(age)},${y(Number(v))}`;
      }).filter(Boolean).join(" ");
      return points?`<polyline points="${points}" class="${s.cls}"/>`:"";
    }).join("");
    const legends=series.map((s,i)=>`<text x="${p+i*155}" y="20" class="chartLegend">${s.name}</text>`).join("");
    const xTicks=numericXAxisMarkup(
      xmin,xmax,x,H-p,6,
      v=>xmax===100&&v===100?"100+":String(Math.round(v))
    );
    svg.innerHTML=`${grid}${lines}${legends}${xTicks}`;

    bindIndexedHover(svg,xValues,(i)=>{
      const age=xValues[i]===100?"100+":xValues[i];
      return `<strong>${options.hoverLabel||"Ålder"} ${age}</strong>`+series.map(s=>{
        const raw=s.values[i];
        const shown=raw==null||!Number.isFinite(Number(raw))?"–":fmt1.format(Number(raw))+(s.suffix||"");
        return `<div><span>${s.name}</span><b>${shown}</b></div>`;
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
    row.internationalRecruitmentSharePct=Math.max(0,Math.min(100,+$("labourInternationalSharePct").value||0));
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
      $("labourResidenceShares").innerHTML="<p class='hint'>Pendlingsdata genereras i nästa arbetsflödeskörning.</p>";
      $("labourScenarioAllocation").innerHTML="<p class='hint'>Pendlingsdata genereras i nästa arbetsflödeskörning.</p>";
      $("labourPopulationEffect").innerHTML="";
      $("labourWorkerAgeGroups").innerHTML="<p class='hint'>Arbetsmarknadens åldersprofil genereras i nästa arbetsflödeskörning.</p>";
      $("commutingMatrix").innerHTML="";
      $("labourJobsChart").innerHTML="";
      return;
    }

    const workplace=$("labourWorkplace").value;
    const summary=(labour.workplaceSummary||[]).find(r=>r.workplace===workplace);
    if(!summary){
      $("labourJobsKpi").textContent="–";
      $("labourLatestYear").textContent="–";
      $("labourLocalShareKpi").textContent="–";
      $("labourOtherFaShareKpi").textContent="–";
      $("labourOutsideShareKpi").textContent="–";
      $("labourResidenceShares").innerHTML="<p class='hint'>Ingen pendlingssammanfattning finns för vald arbetsplats.</p>";
      $("labourScenarioAllocation").innerHTML="<p class='hint'>Ingen scenariefördelning kan visas för vald arbetsplats.</p>";
      $("labourPopulationEffect").innerHTML="";
      $("labourWorkerAgeGroups").innerHTML="<p class='hint'>Åldersprofil saknas för vald arbetsplats.</p>";
      $("commutingMatrix").innerHTML="";
      $("labourJobsChart").innerHTML="";
      return;
    }
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
        name:"Medföljande hushåll – approximation",
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
        '<text x="30" y="40" class="axisText">Åldersprofil genereras i nästa arbetsflödeskörning.</text>';
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
      $("labourWorkerAgeGroups").innerHTML="<p class='hint'>Arbetsmarknadens åldersprofil genereras i nästa arbetsflödeskörning.</p>";
    }

    const outside=allocations.find(r=>r.residence===labour.outsideGroup.code);
    const movePct=Math.max(0,Math.min(100,+$("labourExternalMovePct").value||0))/100;
    const personsPerJob=Math.max(0,+$("labourPersonsPerMover").value||0);
    const internationalShare=Math.max(0,Math.min(100,+$("labourInternationalSharePct").value||0))/100;
    const outsideJobs=outside?.jobs||0;
    const movingJobs=outsideJobs*movePct;
    const populationEffect=movingJobs*personsPerJob;
    const internationalEffect=populationEffect*internationalShare;
    const domesticEffect=populationEffect-internationalEffect;
    $("labourPopulationEffect").innerHTML=`
      <div class="policyGrid">
        <div><span>Nya jobb till boende utanför FA</span><strong>${fmt1.format(outsideJobs)}</strong></div>
        <div><span>Antas flytta till FA</span><strong>${fmt1.format(movingJobs)}</strong></div>
        <div><span>Personer per inflyttat jobb</span><strong>${fmt1.format(personsPerJob)}</strong></div>
        <div><span>Potentiell extra befolkning</span><strong>+${fmt1.format(populationEffect)}</strong></div>
        <div><span>Varav från övriga Sverige</span><strong>+${fmt1.format(domesticEffect)}</strong></div>
        <div><span>Varav internationell rekrytering</span><strong>+${fmt1.format(internationalEffect)}</strong></div>
      </div>
      <p class="hint">${labour.meta.qualityNote||""}</p>`;
  }

  function housingMembers(geo){
    if(geo!=="FA_LULEA") return [geo];
    const g=(data.geographies||[]).find(x=>x.code==="FA_LULEA");
    return g?.members?.length?g.members:["2580","2582","2581","2560","2514"];
  }

  function householdTimelineForGeo(geo){
    if(!housing?.householdTotals?.length) return [];
    const members=housingMembers(geo);
    const grouped=new Map();
    for(const r of housing.householdTotals){
      if(!members.includes(r.geo)) continue;
      const year=+r.year;
      if(!grouped.has(year)) grouped.set(year,{year,households:0,persons:0});
      const g=grouped.get(year);
      const hh=Number(r.households||0);
      const pph=Number(r.personsPerHousehold||0);
      g.households+=hh;
      if(hh>0&&pph>0) g.persons+=hh*pph;
    }
    return [...grouped.values()].sort((a,b)=>a.year-b.year).map(r=>({
      year:r.year,
      households:r.households,
      personsPerHousehold:r.households>0?r.persons/r.households:null
    }));
  }

  function stockForGeo(geo){
    if(!housing?.housingStock?.length) return [];
    const members=housingMembers(geo);
    const latestYear=Number(housing.meta?.latestHousingStockYear||0);
    const grouped=new Map();
    for(const r of housing.housingStock){
      if(!members.includes(r.geo)||+r.year!==latestYear) continue;
      const key=`${r.dwellingType}|${r.tenure}`;
      if(!grouped.has(key)){
        grouped.set(key,{
          dwellingType:r.dwellingType,tenure:r.tenure,dwellings:0
        });
      }
      grouped.get(key).dwellings+=Number(r.dwellings||0);
    }
    return [...grouped.values()].sort((a,b)=>
      a.dwellingType.localeCompare(b.dwellingType,"sv")||
      a.tenure.localeCompare(b.tenure,"sv")
    );
  }

  function projectedHouseholdSize(year,history){
    const mode=$("householdProjectionMode")?.value||"trend";
    const valid=history.filter(r=>Number.isFinite(Number(r.personsPerHousehold)));
    const last=valid.at(-1);
    const base=Number(last?.personsPerHousehold||2.1);
    if(mode==="manual"){
      return Math.max(1,Math.min(5,+$("householdManualSize").value||base));
    }
    if(mode==="trend"&&valid.length>=2){
      const recent=valid.slice(-5);
      const first=recent[0], end=recent.at(-1);
      const span=Math.max(1,end.year-first.year);
      const slope=(Number(end.personsPerHousehold)-Number(first.personsPerHousehold))/span;
      return Math.max(1.2,Math.min(4,base+slope*(year-end.year)));
    }
    return base;
  }

  function plannedHousingCumulative(geo,year){
    const members=housingMembers(geo);
    return defaultHousing.reduce((sum,s)=>{
      if(!s.active||!members.includes(s.municipality)) return sum;
      const total=Number(s.dwellings||0)*Number(s.completionPct||0)/100;
      if(year<+s.year) return sum;
      const phase=Math.max(1,+s.phaseYears||1);
      const fraction=phase<=1?1:Math.min(1,(year-(+s.year)+1)/phase);
      return sum+total*Math.max(0,fraction);
    },0);
  }

  function renderHousingAnalysis(){
    if(!$("householdsKpi")) return;
    if(!housing?.householdTotals?.length){
      $("householdsKpi").textContent="–";
      $("householdSizeKpi").textContent="–";
      $("housingStockKpi").textContent="–";
      $("housingBalanceKpi").textContent="–";
      $("occupancyDefaultsTable").innerHTML="<p class='hint'>Hushålls- och bostadsdata genereras i nästa arbetsflödeskörning.</p>";
      $("householdComposition").innerHTML="";
      $("housingStockTable").innerHTML="";
      $("householdTrendChart").innerHTML="";
      $("housingDemandChart").innerHTML="";
      return;
    }

    $("boverketHousingMethod").innerHTML=`
      <table class="miniTable"><thead><tr><th>Del</th><th>Status i modellen</th><th>Kommentar</th></tr></thead><tbody>
        <tr><td>Befolkningsframskrivning</td><td><strong>Ja</strong></td><td>Kohortmodell per ålder/kön.</td></tr>
        <tr><td>Hushållsbildning</td><td><strong>Ja, approximation</strong></td><td>Produktionsstödet använder validerad femårstrend i personer/hushåll. Boverkets hushållskvoter per ålder/kön är fortfarande ett möjligt framtida metodlyft.</td></tr>
        <tr><td>Bostadsbestånd</td><td><strong>Ja</strong></td><td>SCB efter hustyp och upplåtelseform.</td></tr>
        <tr><td>Rivningar/avgångar</td><td>Ej ännu</td><td>Boverket använder historiskt genomsnitt som framtidsantagande.</td></tr>
        <tr><td>Outhyrda bostäder i startläge</td><td>Ej ännu</td><td>Relevant främst för hyresrätter.</td></tr>
        <tr><td>Ingående över-/underskott</td><td>Ej ännu</td><td>Bör läggas som separat jämförelse, inte blandas ihop med prognosens demografiska behov.</td></tr>
        <tr><td>Bostadsreserv</td><td><strong>Ja</strong></td><td>Justerbar; standard 1 % enligt Boverkets byggbehovsmodell.</td></tr>
        <tr><td>FA-region som bostadsmarknad</td><td><strong>Ja, med versionsnot</strong></td><td>Vår Luleå FA används som funktionell marknad; definitionen behöver versioneras mot Boverkets/FA25.</td></tr>
      </tbody></table>`;

    const measures=[
      ["Låg ekonomisk standard","Disponibel inkomst under 60 % av medianen."],
      ["Ansträngd boendeekonomi (KALP)","Inkomst räcker inte till schabloniserad boendeutgift och normal konsumtion."],
      ["Trångboddhet","Bostaden uppfyller inte Boverkets utrymmeskriterium."],
      ["Trångbodd + låg ekonomisk standard","Kombinationsmått."],
      ["Trångbodd + ansträngd boendeekonomi (KALP)","Kombinationsmått."],
      ["Flyttar ofta","Någon i hushållet har flyttat minst en gång per år under de senaste tre åren."],
      ["Hemmaboende vuxna barn","Barn 25+ bor kvar hos förälder/föräldrar."],
      ["Återkommande problem","Minst ett av utvalda problem återkommer två år i rad."]
    ];
    $("boverketNeedMeasures").innerHTML=`
      <table class="miniTable"><thead><tr><th>Mått</th><th>Tolkning</th><th>Modellstatus</th></tr></thead><tbody>
      ${measures.map(m=>`<tr><td>${m[0]}</td><td>${m[1]}</td><td>Extern Boverket-jämförelse</td></tr>`).join("")}
      </tbody></table>
      <p class="hint">Måtten ska analyseras var för sig och i lokal kontext; de är inte åtta vikter som ska summeras till ett byggbehov.</p>`;

    const geo=$("geo").value;
    const members=housingMembers(geo);
    const history=householdTimelineForGeo(geo);
    const observed=history.at(-1);
    const stockRows=stockForGeo(geo);
    const totalStock=stockRows.reduce((s,r)=>s+Number(r.dwellings||0),0);

    $("householdsKpi").textContent=fmt.format(observed?.households||0);
    $("householdsYear").textContent=observed?`år ${observed.year}`:"–";
    $("householdSizeKpi").textContent=observed?.personsPerHousehold==null?"–":fmt1.format(observed.personsPerHousehold);
    $("housingStockKpi").textContent=fmt.format(totalStock);
    $("housingStockYear").textContent=`år ${housing.meta?.latestHousingStockYear||"–"}`;

    const projection=latest.map(r=>{
      const pph=projectedHouseholdSize(+r.year,history);
      return {
        year:+r.year,
        households:pph>0?Number(r.population||0)/pph:0,
        personsPerHousehold:pph
      };
    });
    const baseProjected=projection[0]?.households||0;
    const reservePct=+$("housingReservePct").value||0;
    const basePlanned=projection.length?plannedHousingCumulative(geo,projection[0].year):0;
    const demandRows=projection.map(r=>{
      const newHouseholds=r.households-baseProjected;
      const required=RAPSModel.housingRequiredDwellings(newHouseholds,reservePct);
      const planned=plannedHousingCumulative(geo,r.year)-basePlanned;
      return {...r,newHouseholds,requiredNewDwellings:required,plannedAdditions:planned,balance:planned-required};
    });
    const lastDemand=demandRows.at(-1);
    $("housingBalanceKpi").textContent=lastDemand
      ?(lastDemand.balance>=0?"+":"")+fmt.format(lastDemand.balance)
      :"–";

    const allYears=[...new Set([
      ...history.map(r=>r.year),
      ...projection.map(r=>r.year)
    ])].sort((a,b)=>a-b);
    const histMap=new Map(history.map(r=>[r.year,r.households]));
    const projMap=new Map(projection.map(r=>[r.year,r.households]));
    drawAgeLineChart("householdTrendChart",allYears,[
      {name:"Observerade hushåll",values:allYears.map(y=>histMap.has(y)?histMap.get(y):null),cls:"lineVariation"},
      {name:"Implicit framskrivning",values:allYears.map(y=>projMap.has(y)?projMap.get(y):null),cls:"populationLine"}
    ],{hoverLabel:"År",valueDigits:0});

    drawAgeLineChart("housingDemandChart",demandRows.map(r=>r.year),[
      {name:"Ny bostadsefterfrågan",values:demandRows.map(r=>r.requiredNewDwellings),cls:"lineSensitivity"},
      {name:"Planerat tillskott",values:demandRows.map(r=>r.plannedAdditions),cls:"lineInflow"}
    ],{includeZero:true,hoverLabel:"År",valueDigits:0});

    const occYear=Number(housing.meta?.occupancyDefaultYear||2024);
    const occRows=(housing.occupancyDefaults||[])
      .filter(r=>members.includes(r.geo)&&+r.year===occYear)
      .sort((a,b)=>
        a.geo.localeCompare(b.geo)||
        a.dwellingType.localeCompare(b.dwellingType,"sv")||
        a.tenure.localeCompare(b.tenure,"sv")||
        a.size.localeCompare(b.size,"sv",{numeric:true})
      );
    const geoName=code=>housing.geographies?.find(g=>g.code===code)?.name||code;
    $("occupancyDefaultsTable").innerHTML=occRows.length?`
      <div class="tableWrap analysisTableWrap"><table class="miniTable"><thead><tr>
        <th>Kommun</th><th>Typ</th><th>Upplåtelse</th><th>Storlek</th><th>Personer/bostad</th>
      </tr></thead><tbody>${occRows.map(r=>`<tr>
        <td>${geoName(r.geo)}</td><td>${r.dwellingType}</td><td>${r.tenure}</td>
        <td>${r.size}</td><td>${fmt1.format(r.personsPerDwelling)}</td>
      </tr>`).join("")}</tbody></table></div>`
      :"<p class='hint'>Inga SCB-standardvärden för vald geografi.</p>";

    const compMap=new Map();
    for(const r of housing.householdComposition||[]){
      if(!members.includes(r.geo)) continue;
      const key=r.householdType;
      if(!compMap.has(key)) compMap.set(key,{type:key,households:0,persons:0});
      const g=compMap.get(key);
      g.households+=Number(r.households||0);
      g.persons+=Number(r.persons||0);
    }
    const comp=[...compMap.values()].sort((a,b)=>b.households-a.households);
    const compTotal=comp.reduce((s,r)=>s+r.households,0);
    $("householdComposition").innerHTML=comp.length?`
      <table class="miniTable"><thead><tr><th>Hushållstyp</th><th>Hushåll</th><th>Andel</th><th>Pers/hushåll</th></tr></thead><tbody>
      ${comp.map(r=>`<tr><td>${r.type}</td><td>${fmt.format(r.households)}</td>
        <td>${pct.format(compTotal?100*r.households/compTotal:0)} %</td>
        <td>${r.households?fmt1.format(r.persons/r.households):"–"}</td></tr>`).join("")}
      </tbody></table>`
      :"<p class='hint'>Hushållstyper genereras i nästa arbetsflödeskörning.</p>";

    $("housingStockTable").innerHTML=stockRows.length?`
      <table class="miniTable"><thead><tr><th>Typ</th><th>Upplåtelse</th><th>Bostäder</th></tr></thead><tbody>
      ${stockRows.map(r=>`<tr><td>${r.dwellingType}</td><td>${r.tenure}</td><td>${fmt.format(r.dwellings)}</td></tr>`).join("")}
      </tbody></table>`
      :"<p class='hint'>Bostadsbestånd saknas.</p>";
  }

  function renderAgeCellWeightValidation(geo,selected){
    const el=$("ageCellWeightValidation");
    if(!el) return;
    const d=ageCellWeightDiagnostic?.diagnostic;
    if(!d){
      el.innerHTML="<p class=\"hint\">Trevägsdiagnostiken genereras i nästa Update SCB data-körning.</p>";
      return;
    }
    const geoF=d.fertility?.summary?.[geo]||{};
    const geoM=d.mortality?.summary?.[geo]||{};
    const w=geoF[selected]&&geoM[selected]?selected:(geoF["10"]&&geoM["10"]?"10":null);
    const f=w?geoF[w]:null;
    const m=w?geoM[w]:null;
    if(!f||!m){
      el.innerHTML="<p class=\"hint\">Trevägsdiagnostik saknas för vald geografi och kalibreringsperiod.</p>";
      return;
    }
    const markBest=(values,i)=>{
      const nums=values.map(Number).filter(Number.isFinite);
      const min=nums.length?Math.min(...nums):NaN;
      const v=Number(values[i]);
      const txt=Number.isFinite(v)?fmt1.format(v):"–";
      return Number.isFinite(v)&&Math.abs(v-min)<1e-9?"<strong>"+txt+"</strong>":txt;
    };
    const fv=[f.zeroWeightBirthsMAE,f.currentWeightBirthsMAE,f.fullLocalBirthsMAE];
    const mv=[m.zeroWeightDeathsMAE,m.currentWeightDeathsMAE,m.fullLocalDeathsMAE];
    const horizonRows=[1,2,3].map(h=>{
      const fh=f.byHorizon?.[h], mh=m.byHorizon?.[h];
      if(!fh||!mh) return "";
      const fvals=[fh.zeroWeightBirthsMAE,fh.currentWeightBirthsMAE,fh.fullLocalBirthsMAE];
      const mvals=[mh.zeroWeightDeathsMAE,mh.currentWeightDeathsMAE,mh.fullLocalDeathsMAE];
      return "<tr><td>n+"+h+" fruktsamhet</td><td>"+markBest(fvals,0)+"</td><td>"+markBest(fvals,1)+"</td><td>"+markBest(fvals,2)+"</td></tr>"+
        "<tr><td>n+"+h+" dödlighet</td><td>"+markBest(mvals,0)+"</td><td>"+markBest(mvals,1)+"</td><td>"+markBest(mvals,2)+"</td></tr>";
    }).join("");
    const origins=[...new Set([
      ...Object.keys(f.byOrigin||{}),
      ...Object.keys(m.byOrigin||{})
    ])].sort();
    const originRows=origins.map(origin=>{
      const fo=f.byOrigin?.[origin], mo=m.byOrigin?.[origin];
      if(!fo||!mo) return "";
      const fvals=[fo.zeroWeightBirthsMAE,fo.currentWeightBirthsMAE,fo.fullLocalBirthsMAE];
      const mvals=[mo.zeroWeightDeathsMAE,mo.currentWeightDeathsMAE,mo.fullLocalDeathsMAE];
      return "<tr><td>Origin "+origin+" – fruktsamhet</td><td>"+markBest(fvals,0)+"</td><td>"+markBest(fvals,1)+"</td><td>"+markBest(fvals,2)+"</td></tr>"+
        "<tr><td>Origin "+origin+" – dödlighet</td><td>"+markBest(mvals,0)+"</td><td>"+markBest(mvals,1)+"</td><td>"+markBest(mvals,2)+"</td></tr>";
    }).join("");
    el.innerHTML=
      "<p class=\"hint\">Kalibreringsfönster: "+w+" år. Lägre MAE är bättre. Fetstil markerar lägst fel i denna trevägsjämförelse.</p>"+
      "<div class=\"analysisTableWrap\"><table class=\"miniTable\">"+
      "<thead><tr><th>Komponent</th><th>0 % lokal åldersvikt</th><th>Nuvarande informationsvikt</th><th>100 % lokal åldersvikt</th></tr></thead><tbody>"+
      "<tr><td>Fruktsamhet – födda MAE</td><td>"+markBest(fv,0)+"</td><td>"+markBest(fv,1)+"</td><td>"+markBest(fv,2)+"</td></tr>"+
      "<tr><td>Dödlighet – döda MAE</td><td>"+markBest(mv,0)+"</td><td>"+markBest(mv,1)+"</td><td>"+markBest(mv,2)+"</td></tr>"+
      "<tr><td>Fruktsamhetsvariant – befolkning MAPE</td><td>"+pct.format(f.zeroWeightPopulationMAPE)+" %</td><td>"+pct.format(f.currentWeightPopulationMAPE)+" %</td><td>"+pct.format(f.fullLocalPopulationMAPE)+" %</td></tr>"+
      "<tr><td>Dödlighetsvariant – befolkning MAPE</td><td>"+pct.format(m.zeroWeightPopulationMAPE)+" %</td><td>"+pct.format(m.currentWeightPopulationMAPE)+" %</td><td>"+pct.format(m.fullLocalPopulationMAPE)+" %</td></tr>"+
      horizonRows+originRows+
      "</tbody></table></div>";
  }
  function renderLocalizationMethodValidation(geo,selected){
    const el=$("localizationMethodValidation");
    if(!el) return;
    const d=ageCellWeightDiagnostic?.localizationMethodDiagnostic;
    if(!d){
      el.innerHTML="<p class=\"hint\">Alternativdiagnostiken genereras i nästa Update SCB data-körning.</p>";
      return;
    }
    const gf=d.fertility?.summary?.[geo]||{};
    const gm=d.mortality?.summary?.[geo]||{};
    const w=gf[selected]&&gm[selected]?selected:(gf["10"]&&gm["10"]?"10":null);
    const f=w?gf[w]:null, m=w?gm[w]:null;
    if(!f||!m){
      el.innerHTML="<p class=\"hint\">Alternativdiagnostik saknas för vald geografi och kalibreringsperiod.</p>";
      return;
    }
    const markBest=(values,i)=>{
      const nums=values.map(Number).filter(Number.isFinite);
      const min=nums.length?Math.min(...nums):NaN;
      const v=Number(values[i]);
      const txt=Number.isFinite(v)?fmt1.format(v):"–";
      return Number.isFinite(v)&&Math.abs(v-min)<1e-9?"<strong>"+txt+"</strong>":txt;
    };
    const fv=[f.currentBirthsMAE,f.empiricalBayesBirthsMAE,f.spline1BirthsMAE,f.spline10BirthsMAE,f.spline100BirthsMAE,f.cubicSpline1BirthsMAE,f.cubicSpline10BirthsMAE,f.cubicSpline100BirthsMAE];
    const mv=[m.currentDeathsMAE,m.empiricalBayesDeathsMAE];
    const horizons=[1,2,3].map(h=>{
      const fh=f.byHorizon?.[h], mh=m.byHorizon?.[h];
      if(!fh||!mh) return "";
      const fvh=[fh.currentBirthsMAE,fh.empiricalBayesBirthsMAE,fh.spline1BirthsMAE,fh.spline10BirthsMAE,fh.spline100BirthsMAE,fh.cubicSpline1BirthsMAE,fh.cubicSpline10BirthsMAE,fh.cubicSpline100BirthsMAE];
      const mvh=[mh.currentDeathsMAE,mh.empiricalBayesDeathsMAE];
      return "<tr><td>n+"+h+" fruktsamhet</td><td>"+markBest(fvh,0)+"</td><td>"+markBest(fvh,1)+"</td><td>"+markBest(fvh,2)+"</td><td>"+markBest(fvh,3)+"</td><td>"+markBest(fvh,4)+"</td><td>"+markBest(fvh,5)+"</td><td>"+markBest(fvh,6)+"</td><td>"+markBest(fvh,7)+"</td></tr>"+
        "<tr><td>n+"+h+" dödlighet</td><td>"+markBest(mvh,0)+"</td><td>"+markBest(mvh,1)+"</td><td colspan=\"6\">Ej testat – SCB använder annan WLS-metod för dödsrisker</td></tr>";
    }).join("");
    const componentByKey=key=>(maturity?.components||[]).find(x=>x.key===key);
    const fertStatus=componentByKey("fertility_spline_candidate");
    const mortStatus=componentByKey("mortality_eb_candidate");
    const wlsStatus=componentByKey("mortality_wls_candidate");
    const birthNet10Status=componentByKey("birth_status_net10_constrained_candidate");
    const qutbResearchStatus=componentByKey("qutb_education_transition_candidate");
    const migStatus=componentByKey("migration_spline_candidate");
    const candidateStatusMarkup=(fertStatus||mortStatus||wlsStatus||birthNet10Status||qutbResearchStatus||migStatus)
      ? "<div class=\"stackedMetrics\" style=\"margin-bottom:12px\">"+
        (fertStatus?"<div class=\"kv\"><span>Fruktsamhet – kubisk spline λ=10</span><strong>Nivå "+fertStatus.maturityLevel+" · "+fertStatus.maturityName+"</strong></div>":"")+
        (mortStatus?"<div class=\"kv\"><span>Dödlighet – Empirical Bayes</span><strong>Nivå "+mortStatus.maturityLevel+" · "+mortStatus.maturityName+"</strong></div>":"")+
        (wlsStatus?"<div class=\"kv\"><span>Dödlighet – viktad minsta kvadratmetod (WLS)</span><strong>Nivå "+wlsStatus.maturityLevel+" · "+wlsStatus.maturityName+"</strong></div>":"")+
        (birthNet10Status?"<div class=\"kv\"><span>Födelsestatus – net10-begränsad statusfördelning</span><strong>Nivå "+birthNet10Status.maturityLevel+" · "+birthNet10Status.maturityName+"</strong></div>":"")+
        (qutbResearchStatus?"<div class=\"kv\"><span>Forskningsspår – kohortbaserade utbildningsövergångar (qutb)</span><strong>Nivå "+qutbResearchStatus.maturityLevel+" · "+qutbResearchStatus.maturityName+" · endast forskning</strong></div>":"")+
        (migStatus?"<div class=\"kv\"><span>Migration – kubisk spline</span><strong>Nivå "+migStatus.maturityLevel+" · "+migStatus.lifecycle+"</strong></div>":"")+
        "</div>"+
        "<p class=\"hint\"><strong>Produktionsstatus:</strong> fruktsamhets-splinen, dödlighets-WLS och den net10-begränsade födelsestatusmodellen är validerade nivå-3-kandidater men ännu inte produktionsaktiva. qutb-utbildningsmodellen är också nivå 3 men är uttryckligen endast för forskning och påverkar inte den demografiska prognosen. Dödlighets-EB och migrations-splinen är stängda på nivå 2 efter låsta valideringsgrindar.</p>"
      : "";
    el.innerHTML=
      candidateStatusMarkup+
      "<p class=\"hint\">Kalibreringsfönster: "+w+" år. Lägre MAE är bättre. Spline 1/10/100 är en penaliserad åldersutjämningskänslighet, inte en exakt reproduktion av SCB:s interna utjämningsfaktor.</p>"+
      "<div class=\"analysisTableWrap\"><table class=\"miniTable\"><thead><tr><th>Komponent</th><th>Nuvarande</th><th>Empirical Bayes</th><th>Diskret penaliserad 1</th><th>Diskret penaliserad 10</th><th>Diskret penaliserad 100</th><th>Kubisk spline 1</th><th>Kubisk spline 10</th><th>Kubisk spline 100</th></tr></thead><tbody>"+
      "<tr><td>Fruktsamhet – födda MAE</td><td>"+markBest(fv,0)+"</td><td>"+markBest(fv,1)+"</td><td>"+markBest(fv,2)+"</td><td>"+markBest(fv,3)+"</td><td>"+markBest(fv,4)+"</td><td>"+markBest(fv,5)+"</td><td>"+markBest(fv,6)+"</td><td>"+markBest(fv,7)+"</td></tr>"+
      "<tr><td>Dödlighet – döda MAE</td><td>"+markBest(mv,0)+"</td><td>"+markBest(mv,1)+"</td><td colspan=\"6\">Ej testat i denna kandidat</td></tr>"+
      horizons+"</tbody></table></div>";
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
    renderBacktestAgeMultiYear(geo,bw);
    renderBacktestCohortTable(geo,bw);
    renderBacktestMigrationLegAgeTable(geo,bw);
    renderScbBenchmarkTable(geo,selected);
    renderAgeCellWeightValidation(geo,selected);
    renderLocalizationMethodValidation(geo,selected);
  }

  function renderBacktestTable(geo,w){
    const rows=w?backtest?.results?.[geo]?.[w]:null;
    if(!rows){$("backtestTable").innerHTML="<p class='hint'>Historiska testdata saknas för valt fönster.</p>";return;}
    $("backtestTable").innerHTML=`<table class="miniTable"><thead><tr><th>År</th><th>Prognos</th><th>Utfall</th><th>Fel</th><th>Födda fel</th><th>Döda fel</th><th>Flytt fel</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${r.year}</td><td>${fmt.format(r.predictedPopulation)}</td><td>${fmt.format(r.actualPopulation)}</td><td>${r.populationError>=0?"+":""}${fmt.format(r.populationError)}</td><td>${r.birthsError>=0?"+":""}${fmt.format(r.birthsError)}</td><td>${r.deathsError>=0?"+":""}${fmt.format(r.deathsError)}</td><td>${r.netMigrationError>=0?"+":""}${fmt.format(r.netMigrationError)}</td></tr>`).join("")}
      </tbody></table>`;
  }

  function renderBacktestAgeError(geo,w){
    const rows=w?(backtest?.ageErrors?.[geo]?.[w]||[]).filter(r=>+r.year===2024):[];
    if(!rows.length){
      $("backtestAgeErrorChart").innerHTML="";
      $("backtestAgeErrorTable").innerHTML="<p class='hint'>Åldersspecifikt historiskt test genereras i nästa arbetsflödeskörning.</p>";
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

  function renderBacktestAgeMultiYear(geo,w){
    const chart=$("backtestAgeMultiYearChart");
    const table=$("backtestAgeMultiYearTable");
    if(!chart || !table) return;

    const rows=w?(backtest?.ageErrors?.[geo]?.[w]||[]):[];
    if(!rows.length){
      chart.innerHTML="";
      table.innerHTML="<p class='hint'>Flerårsdiagnostik per ålder genereras i nästa arbetsflödeskörning.</p>";
      return;
    }

    const years=[...new Set(rows.map(r=>+r.year).filter(Number.isFinite))].sort((a,b)=>a-b);
    const ages=[...new Set(rows.map(r=>+r.age).filter(Number.isFinite))].sort((a,b)=>a-b);
    const classes=["lineVariation","lineSensitivity","lineError","lineInflow","lineOutflow"];

    const byKey=new Map(rows.map(r=>[`${+r.year}|${+r.age}`,r]));
    const series=years.map((year,i)=>({
      name:String(year),
      values:ages.map(age=>{
        const r=byKey.get(`${year}|${age}`);
        return r?.pctError==null?null:Number(r.pctError);
      }),
      cls:classes[i%classes.length],
      suffix:" %"
    }));

    drawAgeLineChart("backtestAgeMultiYearChart",ages,series,{
      includeZero:true,
      xLabel:"Ålder",
      hoverLabel:"Ålder",
      valueDigits:1
    });

    const focusAges=[22,25,26];
    const focusRows=focusAges.flatMap(age=>years.map(year=>{
      const r=byKey.get(`${year}|${age}`);
      return {age,year,row:r};
    }));

    const recurrence=focusAges.map(age=>{
      const vals=years.map(year=>byKey.get(`${year}|${age}`)).filter(Boolean);
      const over5=vals.filter(r=>r.pctError!=null && Math.abs(Number(r.pctError))>5);
      const sameSign=over5.length>=2 && over5.every(r=>Math.sign(Number(r.pctError))===Math.sign(Number(over5[0].pctError)));
      return {age,available:vals.length,over5:over5.length,sameSign};
    });

    const recurrent=recurrence.filter(r=>r.over5>=2);
    const interpretation=recurrent.length
      ? `Återkommande >5 % i minst två historiska testår: ${recurrent.map(r=>r.age+(r.sameSign?" (samma tecken)":" (olika tecken)")).join(", ")}.`
      : "Ingen av 22, 25 eller 26 år överstiger 5 % i minst två av de tillgängliga historiska teståren.";

    table.innerHTML=`
      <p class="hint"><strong>Kontroll 22, 25 och 26 år:</strong> ${interpretation} Ett enstaka år bör inte ensamt användas för att ändra åldersprofilen.</p>
      <div class="tableWrap analysisTableWrap"><table class="miniTable">
        <thead><tr><th>Ålder</th><th>År</th><th>Prognos</th><th>Utfall</th><th>Fel antal</th><th>Fel %</th><th>|Fel| &gt; 5 %</th></tr></thead>
        <tbody>${focusRows.map(({age,year,row})=>`<tr>
          <td>${age}</td>
          <td>${year}</td>
          <td>${row?fmt1.format(row.predictedPopulation||0):"–"}</td>
          <td>${row?fmt1.format(row.actualPopulation||0):"–"}</td>
          <td>${row?(Number(row.error)>=0?"+":"")+fmt1.format(Number(row.error||0)):"–"}</td>
          <td>${row?.pctError==null?"–":(Number(row.pctError)>=0?"+":"")+pct.format(Number(row.pctError))+" %"}</td>
          <td>${row?.pctError!=null && Math.abs(Number(row.pctError))>5?"Ja":"Nej"}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
  }

  function renderBacktestCohortTable(geo,w){
    const rows=w?(backtest?.cohortErrors?.[geo]?.[w]||[]):[];
    const el=$("backtestCohortTable");
    if(!el) return;
    if(!rows.length){
      el.innerHTML="<p class='hint'>Kohortdiagnostik genereras i nästa arbetsflödeskörning.</p>";
      return;
    }
    const grouped=new Map();
    for(const r of rows){
      const cohort=+r.cohort;
      if(!grouped.has(cohort)) grouped.set(cohort,[]);
      grouped.get(cohort).push(r);
    }
    const series=[...grouped.entries()].map(([cohort,vals])=>{
      const x=[...vals].sort((a,b)=>+a.year-+b.year);
      const first=x[0], last=x[x.length-1];
      const growth=Math.abs(Number(last?.error||0))-Math.abs(Number(first?.error||0));
      const maxAbs=Math.max(...x.map(r=>Math.abs(Number(r.error||0))));
      return {cohort,rows:x,growth,maxAbs};
    }).filter(x=>x.rows.length>=2)
      .sort((a,b)=>b.growth-a.growth || b.maxAbs-a.maxAbs)
      .slice(0,10);

    el.innerHTML=`<div class="tableWrap analysisTableWrap"><table class="miniTable">
      <thead><tr><th>Födelseår</th><th>Förlopp</th><th>Fel växer med</th><th>Största |fel|</th></tr></thead>
      <tbody>${series.map(x=>`<tr>
        <td>${x.cohort}</td>
        <td>${x.rows.map(r=>`${r.age} år ${r.year}: ${r.error>=0?"+":""}${fmt1.format(r.error)} (${r.pctError>=0?"+":""}${pct.format(r.pctError)} %)`).join(" → ")}</td>
        <td>${x.growth>=0?"+":""}${fmt1.format(x.growth)}</td>
        <td>${fmt1.format(x.maxAbs)}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  function renderBacktestMigrationLegAgeTable(geo,w){
    const el=$("backtestMigrationLegAgeTable");
    if(!el) return;
    if(geo!=="2580"){
      el.innerHTML="<p class='hint'>Den detaljerade tre-bensdiagnostiken visas för Luleå kommun.</p>";
      return;
    }
    const ageRows=w?(backtest?.ageErrors?.[geo]?.[w]||[]).filter(r=>+r.year===2024):[];
    const legRows=w?(backtest?.migrationLegAgeErrors?.[geo]?.[w]||[]):[];
    if(!ageRows.length || !legRows.length){
      el.innerHTML="<p class='hint'>Flyttdiagnostik per ben genereras i nästa arbetsflödeskörning.</p>";
      return;
    }
    const worst=[...ageRows].sort((a,b)=>Math.abs(Number(b.error||0))-Math.abs(Number(a.error||0)))[0];
    const age=+worst.age;
    const rows=legRows.filter(r=>+r.year===2024 && +r.age===age);
    el.innerHTML=`
      <p class="hint">Ålder <strong>${age}</strong> år har störst absolut befolkningsfel 2024: ${worst.error>=0?"+":""}${fmt1.format(worst.error)} personer.</p>
      <div class="tableWrap analysisTableWrap"><table class="miniTable">
        <thead><tr><th>Flyttben</th><th>In prognos</th><th>In utfall</th><th>In fel</th><th>Ut prognos</th><th>Ut utfall</th><th>Ut fel</th><th>Netto fel</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>
          <td>${r.label}</td>
          <td>${fmt1.format(r.predictedInflow)}</td>
          <td>${fmt1.format(r.actualInflow)}</td>
          <td>${r.inflowError>=0?"+":""}${fmt1.format(r.inflowError)}</td>
          <td>${fmt1.format(r.predictedOutflow)}</td>
          <td>${fmt1.format(r.actualOutflow)}</td>
          <td>${r.outflowError>=0?"+":""}${fmt1.format(r.outflowError)}</td>
          <td>${r.netMigrationError>=0?"+":""}${fmt1.format(r.netMigrationError)}</td>
        </tr>`).join("")}</tbody></table></div>`;
  }

  function renderScbBenchmarkTable(geo,w){
    const rows=scbComparison?.results?.[geo]?.[w];
    if(!rows){$("scbBenchmarkTable").innerHTML="<p class='hint'>SCB-jämförelse saknas ännu.</p>";return;}
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
    const firstYear=+rows[0].year,lastYear=+rows.at(-1).year;
    const xYear=year=>p+(year-firstYear)*(W-2*p)/Math.max(1,lastYear-firstYear);
    const xTicks=numericXAxisMarkup(firstYear,lastYear,xYear,H-p,6,v=>String(Math.round(v)));
    svg.innerHTML=`${grid}${baseLine}<polyline points="${scenarioPts}" class="populationLine"/>
      <text x="${p}" y="20" class="legendScenario">Vald prognos</text>
      <text x="${p+110}" y="20" class="legendBaseline">Bas utan bostads-/jobbscenario</text>
      ${xTicks}`;
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
    const yGrid=[0,.25,.5,.75,1].map(t=>{
      const yy=p+t*(H-2*p),val=max-t*span;
      return `<line x1="${p}" y1="${yy}" x2="${W-p}" y2="${yy}" class="gridline"/><text x="8" y="${yy+4}" class="axisText">${fmt1.format(val)}</text>`;
    }).join("");
    const firstYear=+rows[0].year,lastYear=+rows.at(-1).year;
    const xYear=year=>p+(year-firstYear)*(W-2*p)/Math.max(1,lastYear-firstYear);
    const xTicks=numericXAxisMarkup(firstYear,lastYear,xYear,H-p,6,v=>String(Math.round(v)));
    svg.innerHTML=`${yGrid}<line x1="${p}" y1="${zero}" x2="${W-p}" y2="${zero}" class="gridline"/>${lines}
      <text x="${p}" y="20" class="legendBirths">Födda</text><text x="${p+90}" y="20" class="legendDeaths">Döda</text><text x="${p+165}" y="20" class="legendMigration">Nettoflyttning</text>
      ${xTicks}`;
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

    const geo=$("geo").value;
    const geoLabel=data.geographies?.find(g=>g.code===geo)?.name||geo;
    const windowYears=$("window").value;
    const fertilityScenario=$("fertilityScenario")?.value||"raps2024";
    const migrationWindow=$("migrationWindow")?.value||windowYears;
    const delimiter=";";
    const csvNumber=v=>{
      const n=Number(v);
      if(!Number.isFinite(n)) return "";
      return String(n).replace(".",",");
    };
    const csvText=v=>{
      const s=String(v??"");
      return /[;"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
    };
    const header=[
      "geografi_kod","geografi","kalibreringsfonster_ar","migrationsfonster_ar","fruktsamhetsscenario",
      "ar","befolkning","baslinje_befolkning","fodda","doda","nettoflyttning",
      "scenarioeffekt","scenarioavvikelse_mot_baslinje","forandring"
    ];
    const rows=latest.map((r,i)=>{
      const base=baseline[i];
      const baselinePopulation=base?.population;
      const scenarioDelta=baselinePopulation==null?"":Number(r.population||0)-Number(baselinePopulation||0);
      return [
        geo,geoLabel,windowYears,migrationWindow,fertilityScenario,
        r.year,r.population,baselinePopulation,r.births,r.deaths,r.netMigration,
        r.scenarioEffect||0,scenarioDelta,r.change
      ].map((v,j)=>j<5?csvText(v):csvNumber(v)).join(delimiter);
    });
    const content="\uFEFF"+[header.join(delimiter),...rows].join("\r\n");
    const blob=new Blob([content],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`befolkningsprognos_${geo}_${latest[0].year}-${latest.at(-1).year}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  setup();
})();