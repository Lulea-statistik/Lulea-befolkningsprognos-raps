const fs=require('fs'), vm=require('vm');
global.window={};
vm.runInThisContext(fs.readFileSync(__dirname+'/../js/model.js','utf8'));
const M=window.RAPSModel;
function assert(cond,msg){if(!cond)throw new Error(msg)}
assert(Math.abs(M.riskFromEvents(10,100)-(1-Math.exp(-0.1)))<1e-12,'risk formula');
const b=M.ckmRiskBounds(10,100,3); assert(b.low<=b.base&&b.base<=b.high,'ckm bounds');
const I=M.identityTransition(3); assert(I[0][0]===1&&I[0][1]===0&&I[2][2]===1,'identity qutb');
console.log('OK: model core tests passed');
