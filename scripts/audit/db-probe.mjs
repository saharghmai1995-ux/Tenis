import { Database } from "bun:sqlite";
const db = new Database("/home/z/my-project/db/custom.db", { readonly: true });
const q = (sql, p=[]) => db.prepare(sql).all(...p);

console.log("=== TennisPick line/status ===");
console.log(q(`SELECT line, status, COUNT(*) n, ROUND(SUM(stake),1) staked, ROUND(SUM(profit),2) profit FROM TennisPick GROUP BY line, status ORDER BY line, status`));

console.log("=== TennisPick leg distribution ===");
console.log(q(`SELECT line, leg, COUNT(*) n, SUM(status='WON') won, SUM(status='LOST') lost, SUM(status='PENDING') pend, ROUND(AVG(odds),3) avg_odds, ROUND(AVG(prob),3) avg_prob, ROUND(SUM(stake),1) staked, ROUND(SUM(profit),2) profit FROM TennisPick GROUP BY line, leg ORDER BY line, leg`));

console.log("=== Tip A (leg='A') ROI ===");
console.log(q(`SELECT leg, COUNT(*) n, SUM(status='WON') won, ROUND(SUM(stake),1) staked, ROUND(SUM(profit),2) profit, ROUND(100*SUM(profit)/NULLIF(SUM(stake),0),2) roi_pct FROM TennisPick WHERE status!='PENDING' GROUP BY leg`));

console.log("=== pairCode families (meta) ===");
console.log(q(`SELECT json_extract(meta,'$.pairCode') pc, line, COUNT(*) n, SUM(status='WON') won, SUM(status='LOST') lost, ROUND(SUM(stake),1) staked, ROUND(SUM(profit),2) profit FROM TennisPick GROUP BY pc, line ORDER BY n DESC`));

console.log("=== daily P&L ===");
console.log(q(`SELECT substr(createdAt,1,10) day, COUNT(*) n, SUM(status='WON') won, ROUND(SUM(stake),1) staked, ROUND(SUM(profit),2) profit FROM TennisPick WHERE status!='PENDING' GROUP BY day ORDER BY day`));

console.log("=== sample meta ===");
console.log(JSON.stringify(q(`SELECT meta FROM TennisPick LIMIT 3`), null, 1).slice(0, 1500));

console.log("=== matches settled/historyVersion ===");
console.log(q(`SELECT historyVersion, COUNT(*) n FROM TennisMatch GROUP BY historyVersion`));
console.log(q(`SELECT crownTier, COUNT(*) n, SUM(vetoed) vetoes FROM TennisMatch GROUP BY crownTier`));

console.log("=== picks per match (dual structure) ===");
console.log(q(`SELECT line, COUNT(DISTINCT matchId) matches, ROUND(COUNT(*)*1.0/COUNT(DISTINCT matchId),2) picks_per_match FROM TennisPick GROUP BY line`));

console.log("=== stake stats ===");
console.log(q(`SELECT ROUND(MIN(stake),1) mn, ROUND(AVG(stake),1) av, ROUND(MAX(stake),1) mx FROM TennisPick`));

db.close();
