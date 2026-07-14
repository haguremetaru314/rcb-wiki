;(function($){
'use strict';

/* ===============
CONFIG
========================== */

const CFG={
DEBOUNCE:250,
DELAY:50,
WRAP:'.wikidb-sortable',
TBL:'.uk-overflow-container',
SEP:'\x00'
};

/* ===============
PRESETS
============== */

const PRESETS=[
{label:'［即効］',match:['[即効]'],scope:'.scope_area',pat:null},
{label:'［除外］',match:['[除外]'],scope:'.scope_area',pat:null},
{label:'［保持］',match:['[保持]'],scope:'.scope_area',pat:null},
{label:'ダメージ',match:['敵与ダメ'],pat:[/相手に[^0-9]{0,10}([0-9]+)ダメージ/]},
{label:'最大体力減少',match:['敵体力失'],pat:[/([0-9]+)失/]},
{label:'与ダメ増加',match:['与ダメ↑'],pat:[/与えるダメージ[^0-9]{0,10}([0-9]+)/],ex:[/次に与えるダメージ/]},
{label:'次与ダメ増加',match:['次ダメ↑'],pat:[/ダメージが([0-9]+)/]},
{label:'マナ獲得',match:['自マナ得'],pat:[/([0-9]+)マナ/]},
{label:'マナ消費',match:['マナ消費'],pat:[/([0-9]+)マナ[^0-9]{0,5}消費/]},
{label:'回復',match:['自回復'],pat:[/([0-9]+)回復/]},
{label:'回復量増加',match:['回復↑'],pat:[/回復量が([0-9]+)/]},
{label:'シールド獲得',match:['自盾得'],pat:null},
{label:'ドロー',match:['デ→手（ドロー）'],pat:[/([0-9]+)つ引く/]},
{label:'スキル生成',match:['デ外→'],pat:null},
{label:'スキル発動',match:['スキル誘発'],pat:null},
{label:'行動不能',match:['敵行動失'],pat:null},
{label:'追加行動',match:['自行動得'],pat:null},
{label:'自傷ダメ',match:['自与ダメ'],pat:[/あなたに[^0-9]{0,5}([0-9]+)ダメージ/]},
{label:'闇シリーズ',match:['闇シリーズ'],pat:null},
{label:'火炎シリーズ',match:['火_炎シリーズ'],pat:null}
];

/* ===================
STATE
================== */

let tables=[];
let cache=[];
let filterState=new Map(); // i -> 0:未選択, 1:含む, 2:除外
let sortMode='default';
let sortKey=-1;
let keyword='';
let mode='enhanced';

let wrap,ctrl;
let timer=null;

/* ★最適化: DOMが「並び替え済み」かどうかを追跡するフラグ。
   sortMode==='default' のときに毎回全テーブルをinsertBeforeし直す
   無駄な処理をスキップするために使う。 */
let isReordered=false;

/* ★最適化: #wikidb-sort-key の再構築が本当に必要かどうかを判定するための
   直前のinclude構成の署名（ラベルを連結した文字列） */
let lastIncludeSig=null;

const originalOrder=new Map();
const originalPos=new Map();

/* =======================
UTILS
================ */

function norm(str){
return (str||'').replace(/[\r\n\s]+/g,' ').trim();
}

/* ★最適化: 引数を「まだ改行・空白を含む生のeffect文字列」から
   「呼び出し側で1回だけ計算済みの、空白除去済み文字列」に変更。
   同じeffect文字列に対してPRESETSの数だけreplace()を繰り返す無駄を排除。 */
function extractVal(collapsedEffect,p){

if(!p.pat) return null;

if(p.ex && p.ex.some(r=>r.test(collapsedEffect))) return null;

for(const reg of p.pat){

const m=collapsedEffect.match(reg);

if(m){

const n=Number(m[1]);

if(!isNaN(n)) return n;

}

}

return null;
}

function getFilterGroups(){

const include=[];
const exclude=[];

filterState.forEach((state,i)=>{
if(state===1) include.push(PRESETS[i]);
if(state===2) exclude.push(PRESETS[i]);
});

return {include,exclude};
}

/* ============
行数取得
======== */

function extractLCFromText(text){

let lines=Infinity;
let chars=Infinity;

const m = norm(text).match(/([0-9]+)\s*行[\s\u3000]*([0-9]+)\s*字/);

if(m){
lines = +m[1];
chars = +m[2];
}

return {lines,chars};
}

/* =======
TABLE REGISTER
=========== */

function registerTable(el,index,dedup){

originalOrder.set(el,index);
originalPos.set(el,{parent:el.parentNode,next:el.nextSibling});

const $el=$(el);

/* ★最適化: .content-a / .content-b は複数箇所から参照されるため
   jQueryオブジェクトを1回だけ取得してキャッシュする */
const $contentA=$el.find('.content-a');
const $contentB=$el.find('.content-b');

const name=norm($el.find('tr:first td:first p:first').text());

/* ★最適化: 生のcontent-a/content-bテキストを1回だけ計算し、
   effectA/effectB と textA/textB の両方で使い回す
   （元コードの「フォールバック仕様の違い」は完全に維持） */
const rawA=norm($contentA.text());
const rawB=norm($contentB.text());

let effectA=rawA;
let effectB=rawB;

if(!effectA) effectA=norm($el.text());
if(!effectB) effectB=effectA;

const key=name+CFG.SEP+effectA;

if(dedup[key]){

el.style.display='none';

}else{

dedup[key]=true;

}

/* ★最適化: extractValに渡す「空白除去済み文字列」を
   PRESETSループの外側で1回だけ計算 */
const effectACollapsed=effectA.replace(/[\r\n\s]+/g,'');
const effectBCollapsed=effectB.replace(/[\r\n\s]+/g,'');

/* ★最適化: scopeを持たないプリセット用に $el 全体のテキストを1回だけ計算 */
const fullText=norm($el.text());

/* ★最適化: scope付きプリセット（.scope_areaなど）のテキストを
   同一scope文字列につき1回だけ計算してキャッシュ */
const scopeTextCache={};

function getScopeText($content,scope,side){
const ckey=side+'|'+scope;
if(!(ckey in scopeTextCache)){
scopeTextCache[ckey]=norm($content.find(scope).text());
}
return scopeTextCache[ckey];
}

const valuesA={};
const valuesB={};
const matchesA={};
const matchesB={};

for(const p of PRESETS){

valuesA[p.label]=extractVal(effectACollapsed,p);
valuesB[p.label]=extractVal(effectBCollapsed,p);

/* match判定 */

let targetA,targetB;

if(p.scope){

targetA=getScopeText($contentA,p.scope,'a');
targetB=getScopeText($contentB,p.scope,'b');

}else{

targetA=fullText;
targetB=fullText;

}

matchesA[p.label]=p.match ? p.match.some(w=>targetA.includes(w)) : true;
matchesB[p.label]=p.match ? p.match.some(w=>targetB.includes(w)) : true;

}

/* textA/textB は元コードのフォールバック仕様（$contentBの存在有無で判定）を維持 */
const textA = rawA;
const textB = $contentB.length ? rawB : fullText;

const lcA = extractLCFromText(textA);
const lcB = extractLCFromText(textB);

cache.push({
el,
valuesA,
valuesB,
matchesA,
matchesB,
values:mode==='enhanced'?valuesA:valuesB,
matches:mode==='enhanced'?matchesA:matchesB,
linesA: lcA.lines,
charsA: lcA.chars,
linesB: lcB.lines,
charsB: lcB.chars,

lines: mode==='enhanced'?lcA.lines:lcB.lines,
chars: mode==='enhanced'?lcA.chars:lcB.chars,
key,
text:el.textContent.toLowerCase()
});

}

/* =============
MODE SWITCH
============= */

function switchWikiDBValues(isEnhanced){

mode=isEnhanced?'enhanced':'normal';

for(const c of cache){
c.values = isEnhanced ? c.valuesA : c.valuesB;
c.matches = isEnhanced ? c.matchesA : c.matchesB;

c.lines = isEnhanced ? c.linesA : c.linesB;
c.chars = isEnhanced ? c.charsA : c.charsB;
}

applyAll();

}

/* ================
APPLY FILTER / SORT
============== */

function applyAll(){

const {include,exclude}=getFilterGroups();
const pLen=include.length;

/* ★最適化: sort-key select は include の構成（labelの並び）が
   前回から変化していない場合は再構築をスキップする */
const includeSig=include.map(p=>p.label).join(CFG.SEP);

if(includeSig!==lastIncludeSig){

const $sel=$('#wikidb-sort-key');
if($sel.length){

const prev=$sel.val();

$sel.empty().append('<option value="-1">（先頭数値優先）</option>');

include.forEach((p,i)=>{
$sel.append(`<option value="${i}">${p.label}</option>`);
});

if($sel.find(`option[value="${prev}"]`).length){
$sel.val(prev);
sortKey=+prev;
}else{
$sel.val('-1');
sortKey=-1;
}

}

lastIncludeSig=includeSig;

}

const visible=[];
const seen={};

for(const c of cache){

let show=true;
let vals=[];

/* 含む条件 */
if(include.length){

for(const p of include){

if(!c.matches[p.label]){
show=false;
break;
}

vals.push(c.values[p.label]);

}

}

/* 除外条件 */
if(show && exclude.length){

for(const p of exclude){

if(c.matches[p.label]){
show=false;
break;
}

}

}

/* 検索文字列 */
if(show && keyword){

if(!c.text.includes(keyword)) show=false;

}

if(show){

if(sortMode!=='default'){
if(seen[c.key]){
c.el.style.display='none';
continue;
}
seen[c.key]=1;
}

visible.push({
el:c.el,
vals,
orig:originalOrder.get(c.el),
lines:c.lines,
chars:c.chars
});

c.el.style.display='';

}else{
c.el.style.display='none';
}

}

ctrl.find('#wikidb-search-count').text(visible.length+'件');

/* SORT */

if(sortMode==='lines-asc'||sortMode==='lines-desc'){

const dir=sortMode==='lines-asc'?1:-1;

visible.sort((a,b)=>{

const ai=!isFinite(a.lines);
const bi=!isFinite(b.lines);

if(ai!==bi) return ai?1:-1;

return dir*(a.lines-b.lines||a.chars-b.chars)||a.orig-b.orig;

});

}

else if((sortMode==='asc'||sortMode==='desc') && pLen){

const k=(sortKey>=0 && sortKey<pLen)?sortKey:0;

visible.sort((a,b)=>{

const av=a.vals[k];
const bv=b.vals[k];

if(av==null && bv==null) return a.orig-b.orig;
if(av==null) return 1;
if(bv==null) return -1;

return (sortMode==='asc'?av-bv:bv-av)||a.orig-b.orig;

});

}

if(sortMode==='default'){

/* ★最適化: 既にDOM順が「元の並び」であれば、
   insertBeforeを繰り返す無駄な再配置をスキップする。
   検索やフィルタだけの操作で並び替えが発生していないケースを高速化。 */
if(isReordered){

for(const el of tables){

const pos=originalPos.get(el);

if(pos?.parent){
pos.parent.insertBefore(el,pos.next);
}

}

isReordered=false;

}

return;

}

const frag=document.createDocumentFragment();

for(const v of visible){
frag.appendChild(v.el);
}

ctrl[0].after(frag);

isReordered=true;

}

/*UI BUILD */

function buildUI(){

if($('#wikidb-controls').length) return;

const btns=PRESETS.map((p,i)=>
`<button class="wikidb-filter wikidb-btn" data-i="${i}">${p.label}</button>`
).join('');

const html=`
<div id="wikidb-controls">
<div>検索 <input id="wikidb-search"><button id="wikidb-clear">✕</button> <span id="wikidb-search-count"></span></div>
<div>フィルタ ${btns} <button id="wikidb-filter-clear">全解除</button></div>
<div>
<button class="wikidb-sort wikidb-btn active" data-mode="default">元</button>
<button class="wikidb-sort wikidb-btn" data-mode="desc">数値▲</button>
<button class="wikidb-sort wikidb-btn" data-mode="asc">数値▼</button>
<button class="wikidb-sort wikidb-btn" data-mode="lines-desc">行文字数▲</button>
<button class="wikidb-sort wikidb-btn" data-mode="lines-asc">行文字数▼</button>
<select id="wikidb-sort-key"><option value="-1">（数値ソート時の優先数値）</option></select>
</div>
</div>`;

wrap.prepend(html);
ctrl=$('#wikidb-controls');

}

/*EVENTS*/

$(document).on('click','.wikidb-filter',function(){

const i=+$(this).data('i');
let state=filterState.get(i)||0;

state=(state+1)%3; // 0→1→2→0

if(state===0){
filterState.delete(i);
}else{
filterState.set(i,state);
}

/* 見た目 */
$(this).removeClass('active exclude');

if(state===1){
$(this).addClass('active');
}else if(state===2){
$(this).addClass('exclude');
}

applyAll();

});

$(document).on('click','#wikidb-filter-clear',()=>{

    /* フィルタ解除 */
    filterState.clear();
    $('.wikidb-filter').removeClass('active exclude');

    /* ★検索も初期化 */
    keyword='';
    $('#wikidb-search').val('');

    /* ソートも初期化 */
    sortMode='default';
    $('.wikidb-sort').removeClass('active');
    $('.wikidb-sort[data-mode="default"]').addClass('active');
    applyAll();
});

$(document).on('click','.wikidb-sort',function(){

sortMode=$(this).data('mode');
$('.wikidb-sort').removeClass('active');
$(this).addClass('active');
applyAll();

});

$(document).on('change','#wikidb-sort-key',function(){

sortKey=+this.value;
applyAll();

});

$(document).on('input','#wikidb-search',function(){

const v=this.value.toLowerCase();

clearTimeout(timer);

timer=setTimeout(()=>{

keyword=v;
applyAll();

},CFG.DEBOUNCE);

});

$(document).on('click','#wikidb-clear',()=>{

keyword='';
$('#wikidb-search').val('');
applyAll();

});



function init(){

wrap=$(CFG.WRAP);
if(!wrap.length) return;

tables=wrap.find(CFG.TBL).toArray();

const dedup={};

tables.forEach((el,i)=>{
registerTable(el,i,dedup);
});

buildUI();

switchWikiDBValues($('.content-a').is(':visible'));
applyAll();

}

$(document).ready(()=>{
setTimeout(init,CFG.DELAY);
});

/* ★ここに置く */
document.addEventListener('wikidb-mode-change',function(e){
switchWikiDBValues(e.detail.enhanced);
});

})(jQuery);
