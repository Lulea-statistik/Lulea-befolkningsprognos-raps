(function(){
  "use strict";
  let data=window.MODEL_DATA;
  let latest=[];
  const $=id=>document.getElementById(id);
  const fmt=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:0});
  const pct=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:2});

  function setup(){
    fillGeo();
    $("runBtn").addEventListener("click",run);
    $("dataFile").addEventListener("change",loadFile);
    $("exportBtn").addEventListener("click",exportCsv);
    renderDataStatus();
    renderStatus();
  }
  function fillGeo(){
    $("geo").innerHTML=data.geographies.map(g=>`<option value="${g.code}">${g.name}</option>`).join("");
  }
  function renderStatus(msg){
    const el=$("status");
    const ready=!!data.meta.dataReady && data.populationBase.length>0;
    el.className="status"+(ready?" ok":"");
    el.textContent=msg || (ready?"Data är inläst. Modellen kan köras.":"Modellmotorn är klar, men officiella SCB-data har ännu inte byggts in i denna paketversion. Läs in en genererad modell-data JSON när hämtningen är klar.");
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
      data=parsed; fillGeo(); renderDataStatus(); renderStatus("Ny modell-data JSON inläst.");
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
        window:+$("window").value
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
    tbody.innerHTML=latest.map(r=>`<tr><td>${r.year}</td><td>${fmt.format(r.population)}</td><td>${fmt.format(r.births)}</td><td>${fmt.format(r.deaths)}</td><td>${fmt.format(r.netMigration)}</td><td>${r.change>=0?"+":""}${fmt.format(r.change)}</td></tr>`).join("");
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
    const lines=["year,population,births,deaths,net_migration,change",...latest.map(r=>[r.year,r.population,r.births,r.deaths,r.netMigration,r.change].join(","))];
    const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="lulea_population_forecast.csv";a.click();URL.revokeObjectURL(a.href);
  }
  setup();
})();
