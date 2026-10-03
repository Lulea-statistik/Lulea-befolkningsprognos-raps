#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const ROOT=path.resolve(__dirname,'..');
global.window={};
vm.runInThisContext(fs.readFileSync(path.join(ROOT,'js','model.js'),'utf8'));
const M=window.RAPSModel;
const data=JSON.parse(fs.readFileSync(path.join(ROOT,'data','model_data.json'),'utf8'));
const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'data','fa_additivity_config.json'),'utf8'));

const members=cfg.members;
const baseYear=Number(data.meta?.baseYear||2025);
const tol=1e-7;
const scenarios=[
  {name:'baseline',value:{housing:[],workplaces:[],overlapPct:0}},
  {name:'housing',value:{housing:[{
    active:true,year:baseYear+1,municipality:'2580',
    dwellings:100,completionPct:100,occupancyPct:100,
    personsMode:'manual',personsPerDwelling:2,
    externalSharePct:50,internalSharePct:25,phaseYears:2
  }],workplaces:[],overlapPct:0}}
];

const checks={};
const detail={};
for(const sc of scenarios){
  const common={
    endYear:baseYear+3,window:10,migrationWindow:10,
    fertMult:1,mortMult:1,migMult:1,
    cohortTimingMode:'event_age_aligned',
    scenarios:sc.value,includeDetail:true
  };
  const fa=M.simulate(data,{...common,geo:'FA_LULEA'});
  const municipal=Object.fromEntries(
    members.map(g=>[g,M.simulate(data,{...common,geo:g})])
  );
  let pop=true,births=true,deaths=true,mig=true,scenario=true,ageSex=true,gross=true;
  for(let i=0;i<fa.length;i++){
    const sum=field=>members.reduce((a,g)=>a+Number(municipal[g][i][field]||0),0);
    pop=pop&&Math.abs(fa[i].population-sum('population'))<tol;
    births=births&&Math.abs(fa[i].births-sum('births'))<tol;
    deaths=deaths&&Math.abs(fa[i].deaths-sum('deaths'))<tol;
    mig=mig&&Math.abs(fa[i].netMigration-sum('netMigration'))<tol;
    scenario=scenario&&Math.abs(fa[i].scenarioEffect-sum('scenarioEffect'))<tol;
    gross=gross&&fa[i].grossInMigration==null&&fa[i].grossOutMigration==null;

    const map=new Map();
    for(const g of members){
      for(const c of municipal[g][i].populationByAgeSex||[]){
        const k=c.sex+'|'+c.age;
        map.set(k,(map.get(k)||0)+Number(c.value||0));
      }
    }
    for(const c of fa[i].populationByAgeSex||[]){
      ageSex=ageSex&&Math.abs(Number(c.value||0)-Number(map.get(c.sex+'|'+c.age)||0))<tol;
    }
  }
  checks[sc.name+'_populationAdditive']=pop;
  checks[sc.name+'_birthsAdditive']=births;
  checks[sc.name+'_deathsAdditive']=deaths;
  checks[sc.name+'_netMigrationAdditive']=mig;
  checks[sc.name+'_scenarioEffectAdditive']=scenario;
  checks[sc.name+'_ageSexAdditive']=ageSex;
  checks[sc.name+'_faGrossFlowsSuppressed']=gross;
  detail[sc.name]={years:fa.map(r=>r.year)};
}
checks.membershipMatchesConfig=(()=>{
  const fa=(data.geographies||[]).find(g=>g.code==='FA_LULEA');
  return JSON.stringify([...(fa?.members||[])].sort())===JSON.stringify([...members].sort());
})();

const allPassed=Object.values(checks).every(Boolean);
const out={
  schemaVersion:'0.1.0',
  status:allPassed?'production_rule_validated':'validation_failed',
  allPassed,checks,detail,
  note:'Structural regression that published FA results are additive sums of the five municipal simulations.'
};
const outPath=path.join(ROOT,'data','backtests','fa_additivity_validation.json');
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n','utf8');
console.log(JSON.stringify(out,null,2));
if(!allPassed) process.exit(1);
