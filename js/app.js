(function(){
  "use strict";
  let data=window.MODEL_DATA;
  let latest=[];
  const $=id=>document.getElementById(id);
  const fmt=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:0});
  const pct=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:2});

  const defaultHousing=[{
    active:false,year:2030,municipality:"2580",dwellings:1000,
    completionPct:100,occupancyPct:95,personsPerDwelling:2.0,
    externalSharePct:50,internalSharePct:25,phaseYears:3
  }];
  const defaultWorkplaces=[{
    active:false,year:2034,municipality:"2580",jobs:1000,
    realizationPct:60,moveSharePct:35,personsPerJob:1.7,
    hostResidencePct:60,internalSharePct:20,phaseYears:4
  }];

  function setup(){
    fillGeo();
    renderScenarioTables();
    $("runBtn").addEventListener("click",run);
    $("dataFile").addEventListener("change",loadFile);
    $("exportBtn").addEventListener("click",exportCsv);
    $("addHousing").addEventListener("click",()=>{defaultHousing.push(blankHousing());renderScenarioTables();});
    $("addWorkplace").addEventListener("click",()=>{defaultWorkplaces.push(blankWorkplace());renderScenarioTables();});
    renderDataStatus();
    renderStatus();
  }

  function municipalityOptions(selected){
    return data.geographies.filter(g=>g.code!=="FA_LULEA")
      .map(g=>`<option value="${g.code}" ${g.code===selected?"selected":""}>${g.name}</option>`).join("");
  }

  function fillGeo(){
    $("geo").innerHTML=data.geographies.map(g=>`<option value="${g.code}">${g.name}</option>`).join("");
  }

  function blankHousing(){
    return {active:true,year:2030,municipality:"2580",dwellings:1000,completionPct:100,occupancyPct:95,personsPerDwelling:2,externalSharePct:50,internalSharePct:25,phaseYears:3};
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
      <td><input data-k="dwellings" type="number" value="${s.dwellings}" min="0"></td>
      <td><input data-k="completionPct" type="number" value="${s.completionPct}" min="0" max="100"></td>
      <td><input data-k="occupancyPct" type="number" value="${s.occupancyPct}" min="0" max="100"></td>
      <td><input data-k="personsPerDwelling" type="number" value="${s.personsPerDwelling}" min="0" step="0.1"></td>
      <td><input data-k="externalSharePct" type="number" value="${s.externalSharePct}" min="0" max="100"></td>
      <td><input data-k="internalSharePct" type="number" value="${s.internalSharePct}" min="0" max="100"></td>
      <td><input data-k="phaseYears" type="number" value="${s.phaseYears}" min="1" max="20"></td>
      <td><button class="secondary removeHousing" data-i="${i}">×</button></td>
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
      <td><button class="secondary removeWorkplace" data-i="${i}">×</button></td>
    </tr>`).join("");

    document.querySelectorAll(".removeHousing").forEach(b=>b.addEventListener("click",()=>{syncScenarioTables();defaultHousing.splice(+b.dataset.i,1);renderScenarioTables();}));
    document.querySelectorAll(".removeWorkplace").forEach(b=>b.addEventListener("click",()=>{syncScenarioTables();defaultWorkplaces.splice(+b.dataset.i,1);renderScenarioTables();}));
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
    const el=$("status");
    const ready=!!data.meta.dataReady && data.populationBase.length>0;
    el.className="status"+(ready?" ok":"");
    el.textContent=msg || (ready?"Data är inläst. Modellen kan köras.":"Modellmotorn och scenariomodulen är klara, men officiella SCB-data behöver fortfarande byggas in.");
  }

  function renderDataStatus(){
    const ckmCount=(data.diagnostics?.ckm||[]).length;
    $("dataStatus").innerHTML=`<p><strong>Data ready:</strong> ${data.meta.dataReady?"Ja":"Nej"}</p><p><strong>Basår:</strong> ${data.meta.baseYear}</p><p><strong>Metodbrott:</strong> ${data.meta.methodBreakYear} (${data.meta.methodBreak})</p><p><strong>CKM-diagnostikposter:</strong> ${ckmCount}</p>`;
  }

  async function loadFile(ev){
    const file=ev.target.files?.[0]; if(!file)return;
    try{
      const parsed=JSON.parse(await file.text());
      if(!parsed.meta||!parsed.geographies) throw new Error("Ogiltigt schema.");
      data=parsed; fillGeo(); renderScenarioTables(); renderDataStatus(); renderStatus("Ny modell-data JSON inläst.");
    }catch(e){renderStatus("Kunde inte läsa datafil: "+e.message);}
  }

  function run(){
    try{
      latest=RAPSModel.simulate(data,{
        geo:$("geo").value,
        endYear:+$("endYear").value,
        fertMult:+$("fertMult").value,
        mortMult:+$("mortMult").value,
        migMult:+$("migMult").value,
        window:+$("window").value,
        scenarios:currentScenarios()
      });
      renderResults(); renderStatus("Beräkningen genomfördes."); $("exportBtn").disabled=false;
    }catch(e){latest=[]; $("exportBtn").disabled=true; renderStatus(e.message);}
  }

  function renderResults(){
    const first=latest[0], last=latest[latest.length-1];
    $("startPop").textContent=fmt.format(first.population);
    $("endPop").textContent=fmt.format(last.population);
    $("changePop").textContent=(last.population-first.population>=0?"+":"")+fmt.format(last.population-first.population);
    const ckm=(data.diagnostics?.ckm||[]).map(x=>x.maxRelativePct).filter(Number.isFinite);
    $("ckmPct").textContent=ckm.length?pct.format(Math.max(...ckm))+" %":"–";
    $("chartCaption").textContent=`${first.year}–${last.year}`;
    const tbody=$("resultsTable").querySelector("tbody");
    tbody.innerHTML=latest.map(r=>`<tr><td>${r.year}</td><td>${fmt.format(r.population)}</td><td>${fmt.format(r.births)}</td><td>${fmt.format(r.deaths)}</td><td>${fmt.format(r.netMigration)}</td><td>${r.scenarioEffect>=0?"+":""}${fmt.format(r.scenarioEffect||0)}</td><td>${r.change>=0?"+":""}${fmt.format(r.change)}</td></tr>`).join("");
    drawChart(latest);
  }

  function drawChart(rows){
    const svg=$("chart"), W=900,H=380,p=48;
    const vals=rows.map(r=>r.population), min=Math.min(...vals), max=Math.max(...vals), span=Math.max(1,max-min);
    const x=i=>p+i*(W-2*p)/Math.max(1,rows.length-1);
    const y=v=>H-p-(v-min)*(H-2*p)/span;
    const pts=rows.map((r,i)=>`${x(i)},${y(r.population)}`).join(" ");
    const grid=[0,.25,.5,.75,1].map(t=>{const yy=p+t*(H-2*p);const val=max-t*span;return `<line x1="${p}" y1="${yy}" x2="${W-p}" y2="${yy}" stroke="#e7ebf0"/><text x="8" y="${yy+4}" font-size="11" fill="#667085">${fmt.format(val)}</text>`}).join("");
    svg.innerHTML=`${grid}<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="3"/><text x="${p}" y="${H-12}" font-size="11" fill="#667085">${rows[0].year}</text><text x="${W-p-30}" y="${H-12}" font-size="11" fill="#667085">${rows.at(-1).year}</text>`;
  }

  function exportCsv(){
    if(!latest.length)return;
    const lines=["year,population,births,deaths,net_migration,scenario_effect,change",...latest.map(r=>[r.year,r.population,r.births,r.deaths,r.netMigration,r.scenarioEffect||0,r.change].join(","))];
    const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="lulea_population_forecast.csv";a.click();URL.revokeObjectURL(a.href);
  }

  setup();
})();
