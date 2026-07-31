/**
 * index.html からスクリプトを取り出し、docs/design.md §11「実装後の確認項目」のうち
 * 自動判定できるものを検証する。ブラウザは使わず、最小限のDOMスタブで動かす。
 *
 *   node tools/selftest.mjs            アサーションのみ
 *   node tools/selftest.mjs --sim      36ターンの通し実行（バランス確認）を追加
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const src = html.slice(html.indexOf('"use strict";'), html.lastIndexOf('</' + 'script>'));

/* ---- 最小のDOMスタブ ---- */
const store = {};
const out = { app: '', modalRoot: '' };
const el = (id) => ({ set innerHTML(v){ out[id] = v; }, get innerHTML(){ return out[id]; },
                      setAttribute(){}, getAttribute(){ return 'auto'; }, value: '0' });
const els = { app: el('app'), modalRoot: el('modalRoot') };
globalThis.localStorage = { getItem:k=>store[k]||null, setItem:(k,v)=>{store[k]=v;}, removeItem:k=>{delete store[k];} };
globalThis.document = {
  getElementById: id => els[id] || { innerHTML:'', value:'0', setAttribute(){}, getAttribute(){ return null; } },
  documentElement: { setAttribute(){}, getAttribute(){ return 'auto'; } },
  querySelectorAll: () => [],
};
globalThis.window = globalThis;
globalThis.alert = () => {};
globalThis.confirm = () => true;

const g = new Function(src + `;return {
  newGame, endTurn, render, ui, V, PROMPTS, applyClosing, CARDS, CARD_CATS, COLLECT_ACTIONS, CFG,
  acceptLead, refuseLead, requiredLimit, perCompanyCap, frameFree, frameUsed, totalFrame, setLimit,
  resolveClaim, bestBase, couldHaveSafeguard, shippableCash, shippableReal, effectiveMonths, arMonths,
  siteDays, termsValid, makeCompany, ratingOf, outstanding, avgMargin, runBulkPrice, runCollectAction,
  runLoan, runRenego, slotsLeft, useSlot, legacyAction, unlocked, get S(){ return S; }
};`)();

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS ' : '  FAIL ') + msg); if (!cond) fail++; };
const section = (t) => console.log('\n' + t);

/* ===================== §4.1 支払サイトとガード条件 ===================== */
section('§4.1 支払サイト（式より先にガード条件を判定する）');
ok(g.siteDays({closing:30,mo:1,day:30}) === 60, '末締め翌月末払い = 60日');
ok(g.siteDays({closing:20,mo:1,day:10}) === 50, '20日締め翌月10日払い = 50日');
ok(g.siteDays({closing:30,mo:2,day:30}) === 90, '末締め翌々月末払い = 90日');
ok(g.termsValid({closing:30,mo:0,day:30}) === false, '末締め・当月末払いは成立しない（確認項目6）');
ok(g.termsValid({closing:30,mo:0,day:20}) === false, '末締め・当月20日払いは成立しない（確認項目6）');
ok(g.termsValid({closing:20,mo:0,day:10}) === false, '20日締め・当月10日払いは成立しない');
ok(g.termsValid({closing:20,mo:0,day:30}) === true && g.siteDays({closing:20,mo:0,day:30}) === 10,
   '20日締め当月末払いは成立し、10日サイトになる');

/* ===================== §6.4 出荷可能額の換算 ===================== */
section('§6.4 限度額 ÷ 実効サイト（確認項目18）');
const partial = { terms:{closing:20,mo:1,day:30,method:'partial',noteRatio:0.4,noteDays:60}, order:640 };
const cashOnly = g.shippableCash(partial, 700), withNote = g.shippableReal(partial, 700);
ok(Math.abs((1 - withNote/cashOnly) - 0.30) < 0.05,
   `一部手形の相手は同じ限度額で出荷可能額が約3割少ない（月${Math.round(cashOnly)}万 → 月${Math.round(withNote)}万）`);

/* ===================== §6.9(c) 基準回収率 ===================== */
section('§6.9(c) 保全状況別の基準回収率（確認項目3・5・20）');
g.newGame(42);
const S = g.S;
const mk = (sg, extra) => {
  const c = g.makeCompany({ name:'テスト', industry:'retail', order:100, score:60, room:2 });
  c.safeguards = sg; Object.assign(c, extra || {});
  c.claim = 1000; c.status = 'legal'; c.actionsTaken = c.actionsTaken || {};
  S.companies.push(c); return c;
};
const sample = (sg, extra, n=300) => { const r = []; for (let i=0;i<n;i++) r.push(g.bestBase(mk(sg, extra)).rate); return r; };
const none = sample({});
ok(Math.max(...none) <= 0.10, '保全なし → 0〜10%');
const col = sample({ collateral:{turn:9,pt:3} }, { actionsTaken:{ enforceCollateral:true } });
ok(Math.min(...col) >= 0.70 && Math.max(...col) <= 0.95, '物的担保（担保を実行）→ 70〜95%');
const notar = sample({ notarial:{turn:9,pt:2} });
ok(Math.min(...notar) >= 0.50 && Math.max(...notar) <= 0.80, '公正証書 → 50〜80%');
const both = sample({ collateral:{turn:9,pt:3}, notarial:{turn:9,pt:2} }, { actionsTaken:{ enforceCollateral:true } });
ok(Math.max(...both) <= 0.95, '公正証書＋物的担保でも加算されず、最も高いもの1つだけが適用される（確認項目20）');
const voidG = sample({ guarantor:{turn:9,pt:3} }, { actionsTaken:{ claimGuarantor:true }, guarantorCap:null });
ok(Math.max(...voidG) <= 0.10, '極度額未設定の連帯保証は無効 → 保全なしと同じ0〜10%に落ちる（確認項目5）');
const goodG = sample({ guarantor:{turn:9,pt:3} }, { actionsTaken:{ claimGuarantor:true }, guarantorCap:800 });
ok(Math.min(...goodG) >= 0.40, '極度額を定めた連帯保証 → 40〜90%を発動する');
ok(g.bestBase(mk({ collateral:{turn:9,pt:3} }, { trap:'fraud', actionsTaken:{ enforceCollateral:true } })).rate === 0,
   '取り込み詐欺は保全があっても0%（予防しか手段がない類型。確認項目8）');
ok(g.bestBase(mk({ notarial:{turn:9,pt:2} }, { trap:'circular' })).rate === 0, '架空循環取引も0%（確認項目9）');

/* ===================== §3.5 開放時期と学習ビートの整合 ===================== */
section('§3.5 「いつまでなら取れたか」の表示制約（確認項目19）');
const early = g.makeCompany({ name:'第3ターン契約', industry:'retail', order:100, score:60, room:2 });
early.startTurn = 3;
const earlyTxt = g.couldHaveSafeguard(early, 'collateral').join(' / ');
ok(!/第3ターンの契約時なら/.test(earlyTxt) && /まだ扱えませんでした/.test(earlyTxt),
   '保全がロックされていた第3ターンの契約を「取れました」と責めない');
const late = g.makeCompany({ name:'第9ターン契約', industry:'const', order:480, score:57, room:2 });
late.startTurn = 9;
ok(/第9ターンの契約時なら 3pt で取れました/.test(g.couldHaveSafeguard(late, 'collateral').join(' / ')),
   '第9ターンの契約には具体的なターンとptを示す');

/* ===================== §4.4 総与信枠はゼロサム ===================== */
section('§4.4 総与信枠（確認項目13・16）');
const sub = S.companies.find(c => c.active && !c.main && c.limit > 0);
ok(g.setLimit(sub.id, sub.limit + 3000).ok === false, '格付上限・総枠を超える増額はできない');
const main = S.companies.find(c => c.main);
ok(g.setLimit(main.id, main.limit + 100).ok === false, '格付上限を超過中の主要取引先は増額不可（経過措置）');
ok(g.setLimit(main.id, main.limit - 100).ok === true, '超過中でも減額はできる（枠を剥がせる）');

/* ===================== §8 解説カード ===================== */
section('§8 解説カード');
ok(g.CARDS.length === 30, `カードは全30枚（実際 ${g.CARDS.length}）`);
ok(g.CARDS.filter(c => c.tier === '必須').length === 14,
   `必須は14枚（実際 ${g.CARDS.filter(c=>c.tier==='必須').length}）`);
ok(g.CARDS.every(c => g.CARD_CATS.includes(c.cat)), 'すべてのカードが定義済みのカテゴリに属する');
ok(g.CARDS.filter(c => c.cat === '法令').every(c => c.src && c.src !== '—'), '法令カードには出典がある');
ok(new Set(g.CARDS.map(c => c.id)).size === 30, 'カードIDが重複していない');

/* ===================== 画面描画（全タブ・全モーダル） ===================== */
section('画面（全タブ・全モーダルが例外なく描画される）');
let renderErr = null;
try {
  for (let seed = 1; seed <= 3; seed++){
    g.newGame(seed);
    const st = g.S;
    for (let i = 0; i < 40 && !st.gameOver && !st.ending; i++){
      for (const tab of ['home','companies','cash','buy','cards']){ g.V.tab = tab; g.render(); }
      g.V.tab = 'home';
      for (const co of st.companies.filter(c => c.active).slice(0, 3)){
        g.V.modal = { kind:'manage', coId:co.id }; g.render();
        g.V.modal = { kind:'collect', coId:co.id }; g.render();
        g.V.dlg = { sg:['notarial'], conc:['discount'], cap:'' };
        g.V.modal = { kind:'renego', coId:co.id }; g.render();
      }
      for (const lead of st.leads.slice(0, 2)){ g.ui.credit(lead.id); g.render(); }
      g.V.modal = { kind:'legacy' }; g.render();
      g.V.modal = null; g.V.dlg = null;
      while (st.promptQueue && st.promptQueue.length){
        g.render();
        const q = st.promptQueue[0];
        g.ui.prompt(i % g.PROMPTS[q.id].options.length);
      }
      while (st.cardQueue.length){ g.render(); g.ui.cardOk(); }
      if (st.pendingClosing){ g.render(); g.applyClosing(st.pendingClosing.candidates.map(c => c.id)); }
      for (const lead of st.leads.slice()){
        const want = Math.min(Math.round(g.requiredLimit(lead)), g.perCompanyCap(lead), g.frameFree());
        if (want > 50 && i % 2 === 0) g.acceptLead(lead, want, [], [], null); else g.refuseLead(lead);
      }
      g.endTurn();
    }
    g.render();
    if (!out.modalRoot && (st.ending || st.gameOver)) throw new Error('終了時のモーダルが描画されない');
  }
} catch(e){ renderErr = e; }
ok(!renderErr, '3シード×40ターン、全タブ・全モーダル・全プロンプト分岐で例外が出ない' + (renderErr ? ` (${renderErr.message})` : ''));

/* ===================== 通し実行（--sim） ===================== */
if (process.argv.includes('--sim')){
  section('通し実行（有能なプレイの近似。確認項目12・15の目安）');
  const rows = [];
  for (let seed = 1; seed <= 10; seed++){
    g.newGame(seed);
    const st = g.S;
    let guard = 0;
    while (!st.gameOver && !st.ending && guard++ < 200){
      while (st.promptQueue && st.promptQueue.length){
        const q = st.promptQueue[0], P = g.PROMPTS[q.id];
        let i = 0;
        if (q.id === 'circularMain') i = 2;      // 断る
        if (q.id === 'jump') i = 2;              // 連帯保証人を条件に応諾
        if (q.id === 't11rebate') i = 1;
        if (q.id === 'termsChange') i = 1;
        st.promptQueue.shift();
        P.options[Math.min(i, P.options.length-1)].run(q.p);
      }
      st.cardQueue.length = 0;
      if (st.pendingClosing) g.applyClosing(st.pendingClosing.candidates.map(c => c.id));
      if (g.avgMargin() < 0.145 && g.slotsLeft() > 0) g.runBulkPrice();
      for (const co of st.companies.filter(c => c.active && ['delay','longdelay','legal'].includes(c.status))){
        for (const key of ['claimGuarantor','enforceCollateral','offset','lien','repossess','mail','dun','proof']){
          if (g.slotsLeft() <= 0) break;
          const a = g.COLLECT_ACTIONS.find(x => x.key === key);
          if (a && a.ok(co)) g.runCollectAction(co.id, key);
        }
      }
      if (st.legacy.alive && st.turn >= 3 && g.slotsLeft() > 0){ g.useSlot(); g.legacyAction('ack'); }
      if (st.turn >= 8 && st.turn <= 19 && g.slotsLeft() > 0){
        const co = st.companies.find(c => c.main && c.active && !Object.keys(c.safeguards).length);
        if (co) g.runRenego(co.id, ['collateral'], ['discount','site','volume'], null);
      }
      for (const co of st.companies.filter(c => c.active && !c.prepay)){
        const peak = Math.max(g.outstanding(co), ...(co.balHistory || [0]).slice(-3));
        const want = Math.ceil((peak + 40)/10)*10;
        if (want < co.limit) g.setLimit(co.id, want);
      }
      for (const co of st.leads.slice()){
        const want = Math.min(Math.round(g.requiredLimit(co)), g.perCompanyCap(co), g.frameFree());
        if (want < 50 || st.cash < want*0.84 + 900 || g.effectiveMonths(co.terms) > 3.2){ g.refuseLead(co); continue; }
        const sg = st.turn >= g.CFG.unlock.safeguardHeavy
          ? (co.room >= 3 ? ['collateral'] : co.room >= 2 ? ['notarial'] : ['eol'])
          : (st.turn >= g.CFG.unlock.safeguardLight ? ['eol'] : []);
        const conc = sg.length ? ['discount'] : [];
        const r = g.acceptLead(co, want, sg, conc, null);
        if (r && r.counter && r.counter.length) g.acceptLead(co, want, r.counter, conc, null);
      }
      if (g.unlocked('finance') && st.cash < 1400 && st.loans.reduce((a,l)=>a+l.left,0) < 2600 && g.slotsLeft() > 0) g.runLoan(1000);
      g.endTurn();
    }
    rows.push({ seed,
      結果: st.gameOver ? `倒産 T${st.gameOver.turn}（${st.gameOver.kind}）` : st.ending ? st.ending.grade.key : `T${st.turn}`,
      累計売上: Math.round(st.stats.sales), 焦げ付き純損失: Math.round(st.stats.badDebtNet),
      損失率: (st.stats.badDebtNet/Math.max(1,st.stats.sales)*100).toFixed(2)+'%',
      現金: Math.round(st.cash), 用語帳: Object.keys(st.cards).length });
  }
  console.table(rows);
}

console.log('\n' + (fail ? `${fail} 件の失敗` : 'すべての確認項目を満たしている'));
process.exit(fail ? 1 : 0);
