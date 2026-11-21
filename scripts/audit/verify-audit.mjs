import { Database } from "bun:sqlite";
import { createHash } from "crypto";
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const db = new Database("/home/z/my-project/db/custom.db", { readonly: true });
const q = (sql, p=[]) => db.prepare(sql).all(...p);

const ms = q(`SELECT eventKey,dateKey,tour,tournament,surface,round,playerA,playerB,slipAText,slipAOdds,slipBText,slipBOdds,hashPre,historyVersion,settled,vetoed,marketProbA,marketOddsA,datetime(createdAt,'unixepoch') createdIso,datetime(updatedAt,'unixepoch') updatedIso FROM TennisMatch`);
let pass=0, fail=0, nohash=0, mutated=0;
const failSample=[];
for (const m of ms) {
  if (!m.hashPre) { nohash++; continue; }
  const canon = [m.dateKey,m.tour,m.tournament,m.surface,m.round,m.playerA,m.playerB,m.slipAText??"-",m.slipAOdds!=null?Number(m.slipAOdds).toFixed(3):"-",m.slipBText??"-",m.slipBOdds!=null?Number(m.slipBOdds).toFixed(3):"-"].join("|");
  if (sha(canon) === m.hashPre) pass++; else { fail++; mutated++; if (failSample.length<8) failSample.push({eventKey:m.eventKey, players:`${m.playerA} v ${m.playerB}`, hist:m.historyVersion, slipA:m.slipAText, slipAOdds:m.slipAOdds, slipB:m.slipBText, slipBOdds:m.slipBOdds}); }
}
console.log(JSON.stringify({hashVerify:{pass, fail:mutated, nohash, passRate: ms.length? +(100*pass/(pass+mutated)).toFixed(1):0, failSample}}, null, 1));

console.log("=== settlement latency (settledAt - createdAt) ===");
console.log(q(`SELECT AVG(settledAt-createdAt) avgSec, MIN(settledAt-createdAt) mn, MAX(settledAt-createdAt) mx, COUNT(*) n FROM TennisPick WHERE settledAt IS NOT NULL AND createdAt IS NOT NULL`));
console.log("=== picks with settledAt < createdAt (impossible/time-travel) ===");
console.log(q(`SELECT COUNT(*) n FROM TennisPick WHERE settledAt IS NOT NULL AND settledAt < createdAt`));
console.log("=== settlement age: created vs settled day drift ===");
console.log(q(`SELECT CASE WHEN settledAt-createdAt > 86400 THEN '>24h' WHEN settledAt-createdAt > 7200 THEN '2-24h' WHEN settledAt-createdAt > 0 THEN '<2h' ELSE 'NEGATIVE' END bucket, COUNT(*) n FROM TennisPick WHERE settledAt IS NOT NULL GROUP BY bucket`));
console.log("=== marketProb null rate on non-vetoed ===");
console.log(q(`SELECT COUNT(*) total, SUM(marketProbA IS NULL) nullProb, SUM(marketOddsA IS NULL) nullOdds FROM TennisMatch WHERE vetoed=0`));
console.log("=== DUAL per-day bank ===");
console.log(q(`SELECT date(datetime(createdAt,'unixepoch','+3.5 hours')) dayTehran, line, COUNT(*) n, SUM(status='WON') won, SUM(status='LOST') lost, ROUND(SUM(stake),1) staked, ROUND(SUM(profit),2) profit FROM TennisPick WHERE status!='PENDING' GROUP BY dayTehran, line ORDER BY dayTehran`));
console.log("=== cumulative bank curve (DUAL only, settled, ordered) ===");
const curve = q(`SELECT datetime(createdAt,'unixepoch','+3.5 hours') t, profit, stake FROM TennisPick WHERE line='DUAL' AND status!='PENDING' ORDER BY createdAt`);
let bank=0; const pts=[]; for (const c of curve){ bank+=c.profit; pts.push({t:c.t, bank:+bank.toFixed(2)}); }
console.log(JSON.stringify(pts.slice(-30)));
console.log("=== how many DUAL picks belong to hash-failed (mutated) matches ===");
console.log(q(`SELECT p.line, COUNT(*) n FROM TennisPick p JOIN TennisMatch m ON p.matchId=m.id WHERE m.hashPre IS NOT NULL AND m.slipAOdds IS NOT NULL AND (SELECT COUNT(*) FROM TennisMatch x WHERE x.id=m.id AND 1=0)=0 AND p.line='DUAL' GROUP BY p.line`));
db.close();
