import { Database } from "bun:sqlite";
const db = new Database("/home/z/my-project/db/custom.db", { readonly: true });
const q = (sql, p=[]) => db.prepare(sql).all(...p);
console.log("=== live (not vetoed) matches w/ slips ===");
const rows = q(`SELECT eventKey, dateKey, tour, tournament, round, playerA, playerB, rankA, rankB, surface, favorite, marketProbA, marketOddsA, pFinalA, slipAText, slipAOdds, slipBText, slipBOdds, vetoed, crownTier, status, datetime(startTime,'unixepoch') startIso, datetime(createdAt,'unixepoch') createdIso FROM TennisMatch WHERE vetoed=0 ORDER BY createdAt DESC LIMIT 12`);
for (const r of rows) console.log(JSON.stringify(r));
console.log("=== dateKey spread ===");
console.log(q(`SELECT dateKey, COUNT(*) n, SUM(vetoed) vetoed FROM TennisMatch GROUP BY dateKey ORDER BY dateKey`));
console.log("=== settled result codes sample ===");
console.log(q(`SELECT resultCode, resultSetsA, resultSetsB, COUNT(*) n FROM TennisMatch WHERE settled=1 GROUP BY resultCode ORDER BY n DESC LIMIT 10`));
console.log("=== per leg-family settled ROI (all lines) ===");
console.log(q(`SELECT CASE
  WHEN leg LIKE 'A%' OR leg LIKE 'B%' THEN 'MATCH-WINNER-DUAL-WING'
  WHEN leg LIKE 'SB%' OR leg LIKE 'T%-SB%' THEN 'SET-BETTING'
  WHEN leg LIKE 'TG%' THEN 'TOTAL-GAMES'
  WHEN leg LIKE 'TS%' THEN 'TOTAL-SETS'
  WHEN leg LIKE 'GH%' THEN 'GAME-HANDICAP'
  WHEN leg LIKE 'RC%' THEN 'REG-COMBO'
  WHEN leg LIKE 'SNIPER%' THEN 'SNIPER'
  ELSE 'OTHER' END fam,
  COUNT(*) n, SUM(status='WON') won, SUM(status='LOST') lost, SUM(status='PENDING') pend,
  ROUND(SUM(stake),1) staked, ROUND(SUM(profit),2) profit,
  ROUND(100*SUM(profit)/NULLIF(SUM(CASE WHEN status!='PENDING' THEN stake END),0),2) roi
  FROM TennisPick GROUP BY fam ORDER BY staked DESC`));
db.close();
