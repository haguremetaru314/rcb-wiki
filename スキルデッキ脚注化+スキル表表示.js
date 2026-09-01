(function () {
    "use strict";

    /* ================
      設定
    ============== */

    // データ構造を変えたらこのバージョン番号を上げてキャッシュを無効化する
    const DATA_VERSION = "v1.39.02";
    const SKILL_CACHE_KEY = "skill_data_cache_" + DATA_VERSION;
    const ENEMY_CACHE_KEY = "enemy_data_cache_" + DATA_VERSION;
    const CACHE_TTL_MS    = 5 * 24 * 60 * 60 * 1000;

    // ★それぞれ「スキルデータ専用ページ」「敵データ専用ページ」のパスを設定する。
    //   例: "/roguelikecardbattle/page/1234"
    //   null のままなら、従来どおり現在ページの #wiki_menu から読む（後方互換フォールバック）。
    const SKILL_DATA_SOURCE_PATH = "/roguelikecardbattle/name/inc_スキルデータ";
    const ENEMY_DATA_SOURCE_PATH = "/roguelikecardbattle/name/inc_敵データ";

    const SKILL_HALT_WORD = "SKILLBREAK";
    const DECK_TARGET_WORD = "";
    const DECK_HALT_WORD  = "DECKBREAK";

    const EXCLUDE_SKILL_PHRASES = ["自傷", "ガードマ", "補給する", "圧倒的", "自己増殖", "喚起す","連想デッキ","呪縛の雫デッキ","瞑想デッキ","反芻再生覚醒デッキ","炎爆魔デッキ","を拡張","混合す","拡張性"];
    const EXCLUDE_ENEMY_PHRASES = ["",""];

    const TRIGGER_RE = /\<\<デッキ:([^}:]+)(:強化版)?\>\>/g;

    const getRoot = () =>
        document.querySelector(".uk-width-medium-2-3, .uk-width-2-3, #main_content") || document.body;

    /* ================================
      ユーティリティ
    ==================================== */

    const esc     = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    function pickSkillData(sdList, enemyName, nameFilter) {
        if (!sdList) return null;
        const list = nameFilter
            ? sdList.filter(d => d.name.replace(/\+/g, "") === nameFilter)
            : sdList;
        const src = list.length ? list : sdList;
        return src.find(d => d.owners?.some(o => o.includes(enemyName)))
            || src.find(d => !d.owners?.length)
            || src[0];
    }
    function isEditContext() {
        return location.href.includes("/edit")
            || location.href.includes("/setting")
            || location.href.includes("/db/Nsk")
            || location.href.includes("/pageList")
            || document.title.includes("ページ編集画面")
            || document.title.includes("左メニュー")
            || !!document.querySelector("#edit_form, .cke_editable, #wiki_header_dropdown_nav_newpage");
    }

    function textContains(word) {
        return (document.querySelector("#main_content") || document.body).textContent.includes(word);
    }

    /* ============================================================
      キャッシュ（doc1方式：生HTML文字列を保存 / 有効期限つき）
    ============================================================ */

    const Cache = {
        load(key) {
            try {
                const obj = JSON.parse(localStorage.getItem(key));
                if (!obj || !obj.expires || obj.expires <= Date.now() || typeof obj.html !== "string") {
                    localStorage.removeItem(key);
                    return null;
                }
                return obj.html;
            } catch { return null; }
        },
        save(key, html) {
            try {
                localStorage.setItem(key, JSON.stringify({ expires: Date.now() + CACHE_TTL_MS, html }));
            } catch {}
        }
    };

    /* ============================================================
      データソースの取得
      - SKILL_DATA_SOURCE_PATH / ENEMY_DATA_SOURCE_PATH が設定されていれば、
        それぞれの専用ページを1回だけfetchし、HTML文字列としてキャッシュする
        （doc1のレシピ取得と同じ方式）。スキルと敵は別ページ・別キャッシュキーで
        独立して管理される。
      - 未設定 or fetch失敗時は現在ページの document にフォールバックする。
      - 同時に複数箇所から呼ばれても、それぞれ実際のfetchは1回に集約する（Promise共有）。
    ============================================================ */

    let skillDocPromise = null;
    let enemyDocPromise = null;

    async function fetchDataDocument(path, cacheKey) {
        // キャッシュ済みHTMLがあればそれを使う（ネットワークアクセスなし）
        const cached = Cache.load(cacheKey);
        if (cached) {
            return (new DOMParser).parseFromString(cached, "text/html");
        }

        const res = await fetch(path, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`data page fetch failed: ${res.status}`);
        const html = await res.text();
        Cache.save(cacheKey, html);
        return (new DOMParser).parseFromString(html, "text/html");
    }

    // スキル用のソースDocumentを返す（フォールバック込み、同時呼び出しはPromiseを共有して二重fetchを防ぐ）
    function getSkillSourceDoc() {
        if (!SKILL_DATA_SOURCE_PATH) return Promise.resolve(document);
        if (!skillDocPromise) {
            skillDocPromise = fetchDataDocument(SKILL_DATA_SOURCE_PATH, SKILL_CACHE_KEY)
                .catch(err => {
                    console.warn("[skill data] 専用ページの取得に失敗。現在ページにフォールバックします。", err);
                    skillDocPromise = null; // 次回リトライできるようにする
                    return document;
                });
        }
        return skillDocPromise;
    }

    // 敵用のソースDocumentを返す（フォールバック込み、同時呼び出しはPromiseを共有して二重fetchを防ぐ）
    function getEnemySourceDoc() {
        if (!ENEMY_DATA_SOURCE_PATH) return Promise.resolve(document);
        if (!enemyDocPromise) {
            enemyDocPromise = fetchDataDocument(ENEMY_DATA_SOURCE_PATH, ENEMY_CACHE_KEY)
                .catch(err => {
                    console.warn("[enemy data] 専用ページの取得に失敗。現在ページにフォールバックします。", err);
                    enemyDocPromise = null; // 次回リトライできるようにする
                    return document;
                });
        }
        return enemyDocPromise;
    }

    /* ========================
      データ構築
      （どのDocumentから読むかを引数化。現在ページでもfetch結果でも動く）
    ============================= */

    function buildSkillData(sourceDoc) {
        const map = Object.create(null);
        const urlToCleanNames = Object.create(null);

        sourceDoc.querySelectorAll("#wiki_menu .is-skill-data, .is-skill-data").forEach(c => {
            const p = c.querySelector("p");
            if (!p) return;

            const fields = p.innerHTML.split(",").map(f => f.trim());
            if (fields.length < 9) return;

            const imgIdx = fields.findIndex(f => /<img\b/i.test(f));
            if (imgIdx === -1 || imgIdx < 7) return;

            const stripTag = s => s.replace(/<br\s*\/?>/gi, "").trim();

            const displayName = stripTag(fields[0]);
            const cleanName    = displayName.replace(/\+/g, "");

            const zoku1 = stripTag(fields[1] || "");
            const meta1 = stripTag(fields[2] || "");
            const tx1   = (fields[3] || "").trim();

            const zoku2 = stripTag(fields[4] || "");
            const meta2 = stripTag(fields[5] || "");
            const tx2   = (fields[6] || "").trim();

            const imgMatch = fields[imgIdx].match(/src\s*=\s*"([^"]+)"/i);
            const imgUrl   = imgMatch ? imgMatch[1] : "";

            const urlName  = stripTag(fields[imgIdx + 1] || "") || displayName;

            if (urlName !== "バニラスキル") {
                if (!urlToCleanNames[urlName]) urlToCleanNames[urlName] = [];
                if (!urlToCleanNames[urlName].includes(cleanName)) urlToCleanNames[urlName].push(cleanName);
            }

            const owners = fields.slice(imgIdx + 2)
                .map(s => stripTag(s).replace(/^[①②③④⑤⑥⑦⑧⑨⑩\d\s。、・]+/, "").trim())
                .filter(Boolean);

            const dataObj = {
                name:    displayName,
                urlName: urlName,
                imgUrl:  imgUrl,
                linkUrl: "https://wiki3.jp/roguelikecardbattle/name/" + encodeURIComponent(urlName),
                owners,
                normal: { zoku: zoku1, meta: meta1, tx: tx1 },
                plus:   { zoku: zoku2, meta: meta2, tx: tx2 }
            };

            if (!map[cleanName]) map[cleanName] = [];
            map[cleanName].push(dataObj);
        });

        const rawMap = Object.create(null);
        Object.keys(map).forEach(k => { rawMap[k] = [...map[k]]; });

        Object.entries(urlToCleanNames).forEach(([urlName, names]) => {
            if (names.length < 2) return;
            const merged = [];
            names.forEach(n => {
                (rawMap[n] || [])
                    .filter(d => d.urlName === urlName)
                    .forEach(d => { if (!merged.includes(d)) merged.push(d); });
            });
            names.forEach(n => { map[n] = merged; });
        });

        const urlSameGroups = Object.values(urlToCleanNames).filter(n => n.length >= 2).map(n => [...n]);
        return { map, urlSameGroups };
    }

    function buildEnemyMap(sourceDoc) {
        const map = Object.create(null);

        sourceDoc.querySelectorAll("#wiki_menu .is-enemy-data, .is-enemy-data").forEach(c => {
            const ps   = c.querySelectorAll("p");
            const name = ps[0]?.textContent.trim();
            if (!name) return;
            const skills = [];
            for (let i = 4; i + 1 < ps.length; i += 2) {
                const sName = ps[i].textContent.trim();
                if (sName) skills.push({ skillName: sName, count: parseInt(ps[i+1].textContent.trim(), 10) || 1 });
            }
            if (!map[name]) map[name] = [];
            map[name].push({ imgUrl: ps[1]?.querySelector("img")?.src || "", category: ps[2]?.textContent.trim() || "", skills });
        });

        return map;
    }

    /* ============================================================
      データ取得のエントリポイント（スキル・敵をまとめて1回で解決）
    ============================================================ */

    let allDataPromise = null;

    function loadAllData() {
        if (allDataPromise) return allDataPromise;

        allDataPromise = Promise.all([getSkillSourceDoc(), getEnemySourceDoc()])
            .then(([skillDoc, enemyDoc]) => {
                const { map: skillMap, urlSameGroups } = buildSkillData(skillDoc);
                const enemyMap = buildEnemyMap(enemyDoc);
                return { skillMap, urlSameGroups, enemyMap };
            })
            .catch(err => {
                allDataPromise = null; // 失敗時は次回呼び出しでリトライ可能にする
                throw err;
            });

        return allDataPromise;
    }

    /* ====================
      テキストノード処理（スキル・敵名リンク化）
    ===================== */

    function makeLinker(skillMap, enemyMap, excludeSkillPhrases, excludeEnemyPhrases) {
        const skillExcludes = (excludeSkillPhrases || []).filter(Boolean).sort((a, b) => b.length - a.length);
        const enemyExcludes = (excludeEnemyPhrases || []).filter(Boolean).sort((a, b) => b.length - a.length);
        const skillNames    = Object.keys(skillMap).sort((a, b) => b.length - a.length);
        const enemyNames    = Object.keys(enemyMap).sort((a, b) => b.length - a.length);

        const allTokens = [...new Set([...skillExcludes, ...enemyExcludes, ...skillNames, ...enemyNames])]
            .sort((a, b) => b.length - a.length)
            .map(esc);
        if (!allTokens.length) return () => {};

        const combinedRe    = new RegExp("(" + allTokens.join("|") + ")", "g");
        const testRe        = new RegExp("(" + allTokens.join("|") + ")");
        const skillExcludeSet = new Set(skillExcludes);
        const enemyExcludeSet = new Set(enemyExcludes);

        return function linkifyNode(node) {
            const parent = node.parentElement;
            if (!parent) return;
            if (parent.closest(".no-skill-link") && parent.closest(".no-enemy-link")) return;
            const disableSkill = parent.closest(".no-skill-link");
            const disableEnemy = parent.closest(".no-enemy-link");
            if (parent.closest("h1,h4,.uk-h1,.uk-h2,.uk-h3")) return;
            if (parent.closest("[style*='xx-large'],[style*='x-large']")) return;
            if (parent.closest(".uk-text-right,.uk-text-small")) return;
            if (parent.closest("#wiki_menu,#floating-toc,.skill-trigger,.enemy-trigger,#edit_form,.uk-navbar,.popup-word,.enemy-skill-table-wrapper")) {
              if (!parent.closest(".plugin_recenct_comment")) return;}
            if (!testRe.test(node.nodeValue)) return;

            combinedRe.lastIndex = 0;
            const span = document.createElement("span");
            span.innerHTML = node.nodeValue.replace(combinedRe, match => {
              if (!disableSkill && !skillExcludeSet.has(match) && skillMap[match]) {
                return `<a href="javascript:void(0);" class="skill-trigger popup-word-style" data-skill="${match}">${match}</a>`;
              }

              if (!disableEnemy && !enemyExcludeSet.has(match) && enemyMap[match]) {
                return `<a href="javascript:void(0);" class="enemy-trigger popup-word-style" data-enemy="${match}">${match}</a>`;
              }
              return match;
            });
            node.parentNode.replaceChild(span, node);
        };
    }

    function walkAndLink(root, linkifyNode) {
        root.normalize();
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        const nodes  = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        nodes.forEach(n => linkifyNode(n));
    }

    function observeAndLink(root, linkifyNode) {
        new MutationObserver(mutations => {
            const nodes = [];
            mutations.forEach(m => {
                m.addedNodes.forEach(n => {
                    if (n.parentElement?.closest("span, a.skill-trigger, a.enemy-trigger, .enemy-skill-table-wrapper")) return;
                    if (n.nodeType === Node.TEXT_NODE) { nodes.push(n); return; }
                    if (n.nodeType === Node.ELEMENT_NODE) {
                        const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT, null, false);
                        let t; while ((t = w.nextNode())) nodes.push(t);
                    }
                });
            });
            nodes.forEach(n => linkifyNode(n));
        }).observe(root, { childList: true, subtree: true });
    }

    /* ============================================================
      {{デッキ:敵名}} テンプレート展開
    ============================================================ */

    function expandEnemySkillTables(skillMap, enemyMap, urlSameGroups) {
        const root = getRoot(); root.normalize();
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        const hits = [];
        let node;
        while ((node = walker.nextNode())) {
            if (node.parentElement?.closest("#wiki_menu,.enemy-skill-table-wrapper,#edit_form")) continue;
            TRIGGER_RE.lastIndex = 0;
            if (TRIGGER_RE.test(node.nodeValue)) hits.push(node);
        }

        hits.forEach(textNode => {
            TRIGGER_RE.lastIndex = 0;
            const frag = document.createDocumentFragment();
            let lastIdx = 0, m;
            while ((m = TRIGGER_RE.exec(textNode.nodeValue)) !== null) {
                if (m.index > lastIdx) frag.appendChild(document.createTextNode(textNode.nodeValue.slice(lastIdx, m.index)));
                frag.appendChild(buildEnemyTable(m[1].trim(), enemyMap, skillMap, !!m[2], urlSameGroups));
                lastIdx = m.index + m[0].length;
            }
            if (lastIdx < textNode.nodeValue.length) frag.appendChild(document.createTextNode(textNode.nodeValue.slice(lastIdx)));
            textNode.parentNode.replaceChild(frag, textNode);
        });
    }

    function buildEnemyTable(enemyName, enemyMap, skillMap, isPlus, urlSameGroups) {
        const wrapper = document.createElement("div");
        wrapper.className = "enemy-skill-table-wrapper";

        const skillSetList = enemyMap[enemyName];
        if (!skillSetList?.length) {
            wrapper.innerHTML = `<div class="est-notfound">【敵スキル表】「${escHtml(enemyName)}」のデータが見つかりません。</div>`;
            return wrapper;
        }

        const header = document.createElement("div");
        header.className   = isPlus ? "est-header est-header-plus" : "est-header";
        header.textContent = `${enemyName} のデッキ${isPlus ? "（強化版）" : ""}`;
        wrapper.appendChild(header);

        skillSetList.forEach((variantData, variantIdx) => {
            const skillEntries = Array.isArray(variantData) ? variantData : (variantData.skills || []);

            if (skillSetList.length > 1) {
                const varLabel = document.createElement("div");
                varLabel.className   = "est-variant-label";
                varLabel.textContent = `パターン ${variantIdx + 1}`;
                wrapper.appendChild(varLabel);
            }

            const table = document.createElement("table");
            table.className = isPlus ? "est-table est-table-plus" : "est-table";
            table.innerHTML = `<thead><tr>
                <th class="est-th-icon"></th>
                <th class="est-th-zoku">属性</th>
                <th class="est-th-effect">説明</th>
            </tr></thead>`;
            const tbody = document.createElement("tbody");

            function makeRow(skillData, d, count, isDerived, derivedName) {
                const tr = document.createElement("tr");
                if (isDerived) tr.className = "est-derived-row";
                const imgCell  = document.createElement("td"); imgCell.className = "est-td-icon";

                const iconWrap = document.createElement("a");
                iconWrap.className = "est-icon-wrap" + (isDerived ? " est-icon-wrap-derived" : "");
                if (skillData) iconWrap.href = skillData.linkUrl;
                if (skillData?.imgUrl) {
                    const img = document.createElement("img");
                    img.src = skillData.imgUrl; img.className = "est-skill-icon";
                    iconWrap.appendChild(img);
                }
                if (!isDerived) {
                    const countLabel = document.createElement("span");
                    countLabel.className = "est-icon-count";
                    countLabel.textContent = "×" + count;
                    iconWrap.appendChild(countLabel);
                }
                imgCell.appendChild(iconWrap);
                const zokuCell   = document.createElement("td"); zokuCell.className = "est-td-zoku";
                zokuCell.textContent = d ? d.zoku : "—";
                const effectCell = document.createElement("td"); effectCell.className = "est-td-effect";
                if (d?.tx) effectCell.innerHTML = d.tx;
                else { effectCell.textContent = "（データなし）"; effectCell.style.color = "#999"; }

                tr.append(imgCell, zokuCell, effectCell);
                return tr;
            }

            skillEntries.forEach(entry => {
                const sKey      = entry.skillName.replace(/\+/g, "");
                const skillData = pickSkillData(skillMap[sKey] || skillMap[entry.skillName] || null, enemyName);
                const d         = (isPlus && skillData?.plus) ? skillData.plus : skillData?.normal || null;
                tbody.appendChild(makeRow(skillData, d, entry.count, false, null));
                const sameGroup = urlSameGroups?.find(g => g.includes(sKey));
                if (sameGroup) {
                    const groupDataList = skillMap[sKey] || skillMap[entry.skillName] || [];
                    sameGroup.forEach(derivedName => {
                        if (derivedName === sKey) return;
                        const dData = pickSkillData(
                            groupDataList.filter(d => d.name.replace(/\+/g, "") === derivedName),
                            enemyName,
                            derivedName
                        );
                        if (!dData) return;
                        const dd = (isPlus && dData?.plus) ? dData.plus : dData?.normal || null;
                        tbody.appendChild(makeRow(dData, dd, entry.count, true, derivedName));
                    });
                }
            });

            table.appendChild(tbody);
            wrapper.appendChild(table);
        });

        return wrapper;
    }

    /* ============================================================
      ポップアップ共通制御
    ============================================================ */

    function createPopupController(modal) {
        let activeTrigger = null, hideTimer = null, isLocked = false;
        let lockedTop = null;

        const stopHide  = () => { clearTimeout(hideTimer); hideTimer = null; };
        const startHide = () => {
            if (isLocked) return;
            stopHide();
            hideTimer = setTimeout(() => { modal.style.display = "none"; activeTrigger = null; isLocked = false; }, 200);
        };
        const hide = () => { stopHide(); modal.style.display = "none"; activeTrigger = null; isLocked = false; lockedTop = null; };

        const reposition = trg => {
            if (!trg) return;
            activeTrigger = trg;
            modal.style.display = "block";
            const rect = trg.getBoundingClientRect();
            const mH = modal.offsetHeight, mW = modal.offsetWidth;
            const winH = window.innerHeight, winW = window.innerWidth;

            if (lockedTop === null) {
                let top = rect.bottom + 10;
                if (top + mH > winH) top = rect.top - mH - 10;
                if (top < 10)        top = 10;
                if (top + mH > winH) top = winH - mH - 10;
                lockedTop = top;
            }

            let left = rect.left;
            if (left + mW > winW) left = winW - mW - 10;
            if (left < 10)        left = 10;
            modal.style.top = lockedTop + "px"; modal.style.left = left + "px";
        };

        window.addEventListener("scroll", () => { if (modal.style.display === "block") hide(); }, { passive: true });
        modal.addEventListener("mouseenter", () => { isLocked = false; stopHide(); });
        modal.addEventListener("mouseleave", startHide);

        return {
            get activeTrigger() { return activeTrigger; },
            set activeTrigger(v) { activeTrigger = v; },
            get isLocked() { return isLocked; },
            set isLocked(v) { isLocked = v; },
            stopHide, startHide, hide, reposition
        };
    }

    /* =====================
      スキルポップアップ
    ========================== */

    function initSkillModal(skillMap, urlSameGroups) {
        const modal = document.createElement("div");
        modal.id = "skill-card-modal";
        modal.style.cssText = "position:fixed;z-index:10100;display:none;";
        document.body.appendChild(modal);

        const ctrl = createPopupController(modal);

        function render(skillName, currentIndex, plusStateArray) {
            const dataList = skillMap[skillName];
            if (!dataList?.length) return;
            plusStateArray ??= dataList.map(() => false);
            currentIndex  ??= 0;

            const total = dataList.length;
            const pagerHtml = total > 1 ? `
                <div class="modal-pager" style="font-size:1.25em;display:flex;">
                    <div class="pager-area pager-prev" data-dir="-1" style="flex:1;display:flex;align-items:center;justify-content:flex-start;cursor:${currentIndex===0?"default":"pointer"};opacity:${currentIndex===0?"0.2":"1"};padding:4px 8px;">◀</div>
                    <div class="pager-label" style="flex:0 0 auto;display:flex;align-items:center;padding:4px 8px;">${currentIndex+1} / ${total}</div>
                    <div class="pager-area pager-next" data-dir="1" style="flex:1;display:flex;align-items:center;justify-content:flex-end;cursor:${currentIndex===total-1?"default":"pointer"};opacity:${currentIndex===total-1?"0.2":"1"};padding:4px 8px;">▶</div>
                </div>` : "";

            const allCardsHtml = dataList.map((cardData, idx) => {
                const isCurrent = idx === currentIndex;
                const usePlus   = plusStateArray[idx] && cardData.plus;
                const cardD     = usePlus ? cardData.plus : cardData.normal;
                return `<div class="modal-card" data-card-index="${idx}" style="visibility:${isCurrent?"visible":"hidden"};position:${isCurrent?"relative":"absolute"};top:0;left:0;width:100%;">
                    <div class="modal-sw-container">
                        <div class="sw-btn ${!usePlus?"active-n":""}" data-type="n" data-index="${idx}">通常版</div>
                        <div class="sw-btn ${usePlus?"active-p":""}" data-type="p" data-index="${idx}" ${!cardData.plus?'style="opacity:0.2;"':""}>強化版</div>
                    </div>
                    <div class="modal-header">
                     <div class="modal-icon-wrap">
                        <img src="${cardData.imgUrl}" class="modal-icon">
                        </div>
                        <div class="modal-title-box">
                            <div class="modal-name ${usePlus?"type-plus":"type-normal"}">${cardData.name}</div>
                            <div class="modal-meta">${cardD.zoku} / ${cardD.meta}</div>
                        </div>
                    </div>
                    <div class="modal-text">${cardD.tx}</div>
                    <a href="${cardData.linkUrl}" class="modal-link" ${!isCurrent?'tabindex="-1"':""}>詳細ページへ</a>
                </div>`;
            }).join("");

            modal.innerHTML = `${pagerHtml}<div class="modal-cards-wrapper" style="position:relative;">${allCardsHtml}</div>`;
            modal.classList.toggle("modal-plus", !!(plusStateArray[currentIndex] && dataList[currentIndex].plus));

            modal.querySelectorAll(".pager-area").forEach(arrow => {
                arrow.onclick = e => {
                    e.stopPropagation();
                    const newIdx = currentIndex + parseInt(arrow.dataset.dir, 10);
                    if (newIdx < 0 || newIdx >= total) return;
                    ctrl.isLocked = true; ctrl.stopHide();
                    render(skillName, newIdx, plusStateArray);
                    ctrl.reposition(ctrl.activeTrigger);
                };
            });

            modal.querySelectorAll(".sw-btn").forEach(btn => {
                btn.onclick = e => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.index, 10);
                    if (idx !== currentIndex) return;
                    if (btn.dataset.type === "p" && !dataList[idx].plus) return;
                    ctrl.isLocked = true; ctrl.stopHide();
                    const isPlus       = btn.dataset.type === "p";
                    const newPlusState = [...plusStateArray];
                    const sameGroup    = urlSameGroups.find(g => g.includes(skillName));
                    if (sameGroup) newPlusState.fill(isPlus); else newPlusState[idx] = isPlus;
                    render(skillName, currentIndex, newPlusState);
                    ctrl.reposition(ctrl.activeTrigger);
                };
            });
        }

        document.addEventListener("click", e => {
          const trg = e.target.closest(".skill-trigger");
          if (trg) {
            e.preventDefault(); e.stopPropagation();
            ctrl.isLocked = false; ctrl.stopHide();

            const tappedName = trg.dataset.skill;
            const sameGroup = urlSameGroups.find(g => g.includes(tappedName));
            let startIndex = 0;
            if (sameGroup) {
              const dataList = skillMap[tappedName];
              if (dataList) {
                const idx = dataList.findIndex(
                  d => d.name.replace(/\+/g, "") === tappedName
                );
                if (idx !== -1) startIndex = idx;
              }
            }
            render(tappedName, startIndex, null);
            ctrl.reposition(trg);
          } else if (!e.target.closest("#skill-card-modal")) {
            ctrl.hide();
          }
        });

        document.addEventListener("mouseover", e => {
            const trg = e.target.closest(".skill-trigger");
            if (trg || e.target.closest("#skill-card-modal")) {
                if (trg) ctrl.isLocked = false;
                if (modal.style.display === "block") ctrl.stopHide();
            } else if (modal.style.display === "block") {
                ctrl.startHide();
            }
        });

        window._skillCardShow = function (skillName, x, y, preferEnemyName) {
            if (!skillMap[skillName]) return;
            ctrl.isLocked = true; ctrl.stopHide();
            const dataList   = skillMap[skillName];
            let startIndex   = 0;
            if (preferEnemyName) {
                const idx = dataList.findIndex(d => d.owners?.some(o => o.includes(preferEnemyName)));
                if (idx !== -1) startIndex = idx;
            }
            render(skillName, startIndex, null);
            modal.style.display = "block";

            const mH = modal.offsetHeight, mW = modal.offsetWidth;
            const winH = window.innerHeight, winW = window.innerWidth;
            const enemyModal = document.getElementById("enemy-card-modal");
            const eRect = enemyModal?.style.display !== "none" ? enemyModal.getBoundingClientRect() : null;
            let top, left;
            if (eRect) {
                left = Math.min(Math.max(10, eRect.left), winW - mW - 10);
                const topBelow = eRect.bottom + 10, topAbove = eRect.top - mH - 10;
                if (topBelow + mH <= winH - 10)      top = topBelow;
                else if (topAbove >= 10)              top = topAbove;
                else top = eRect.top > winH - eRect.bottom
                    ? Math.max(10, eRect.top - mH - 10)
                    : Math.min(eRect.bottom + 10, winH - mH - 10);
            } else {
                left = Math.max(10, (winW - mW) / 2);
                top  = Math.max(10, (winH - mH) / 2);
            }
            modal.style.top = top + "px"; modal.style.left = left + "px";
            ctrl.activeTrigger = null;
        };
    }

    /* ===================
      敵ポップアップ
    ==================== */

    function initEnemyModal(enemyMap, skillMap) {
        const modal = document.createElement("div");
        modal.id = "enemy-card-modal";
        modal.style.cssText = "position:fixed;z-index:10000;display:none;";
        document.body.appendChild(modal);

        const ctrl = createPopupController(modal);

        function render(enemyName) {
            const skillSetList = enemyMap[enemyName];
            if (!skillSetList?.length) return;

            const firstVariant = skillSetList[0];
            if (Array.isArray(firstVariant)) {
                localStorage.removeItem(ENEMY_CACHE_KEY);
                location.reload();
                return;
            }

            const { imgUrl, category } = firstVariant;
            const deckLabel = category === "異形" ? "初期デッキ" : "スキルデッキ";

            const variantsHtml = skillSetList.map((variantData, variantIdx) => {
                const skillEntries = Array.isArray(variantData) ? variantData : (variantData.skills || []);
                const variantLabelHtml = skillSetList.length > 1
                    ? `<div class="enemy-modal-variant-label">パターン ${variantIdx + 1}</div>` : "";
                const rowsHtml = skillEntries.map(entry => {
                    const sKey = entry.skillName.replace(/\+/g, "");
                    const sdList    = skillMap[sKey] || skillMap[entry.skillName] || null;
                    const skillData = sdList
                        ? (sdList.find(d => d.owners?.some(o => o.includes(enemyName))) || sdList.find(d => !d.owners?.length) || sdList[0])
                        : null;
                    const iconHtml = skillData?.imgUrl
                        ? `<img src="${skillData.imgUrl}" class="enemy-modal-skill-icon">`
                        : `<span class="enemy-modal-skill-icon-placeholder"></span>`;
                    const hasSkillCard = !!(skillMap[sKey] || skillMap[entry.skillName]);
                    return `<div class="enemy-modal-row${hasSkillCard ? " enemy-modal-row-clickable" : ""}" data-skill-name="${sKey}">
                        <span class="enemy-modal-skill-icon-wrap">${iconHtml}</span>
                        <span class="enemy-modal-skill-name">${entry.skillName}</span>
                        <span class="enemy-modal-skill-count">×${entry.count}</span>
                    </div>`;
                }).join("");
                return variantLabelHtml + `<div class="enemy-modal-deck">${rowsHtml}</div>`;
            }).join("");

            modal.innerHTML = `
                <div class="enemy-modal-top">
                    ${imgUrl ? `<div class="enemy-modal-chara-wrap"><img src="${imgUrl}" class="enemy-modal-chara-img"></div>` : ""}
                    <div class="enemy-modal-top-right">
                        <div class="enemy-modal-deck-label">${deckLabel}</div>
                        <div class="enemy-modal-name-label">${enemyName} のデッキ</div>
                    </div>
                </div>
                ${variantsHtml}
                <div class="enemy-modal-page-link"><a href="https://wiki3.jp/roguelikecardbattle/name/${encodeURIComponent(enemyName)}">個別ページへ</a></div>`;

            modal.querySelectorAll(".enemy-modal-row-clickable").forEach(row => {
                row.addEventListener("click", e => {
                    e.stopPropagation();
                    window._skillCardShow?.(row.dataset.skillName, e.clientX, e.clientY, enemyName);
                });
            });
        }

        document.addEventListener("click", e => {
            const trg = e.target.closest(".enemy-trigger");
            if (trg) {
                e.preventDefault(); e.stopPropagation();
                ctrl.isLocked = false; ctrl.stopHide();
                render(trg.dataset.enemy); ctrl.reposition(trg);
            } else if (!e.target.closest("#enemy-card-modal")) {
                ctrl.hide();
            }
        });

        document.addEventListener("mouseover", e => {
            const trg = e.target.closest(".enemy-trigger");
            if (trg || e.target.closest("#enemy-card-modal") || e.target.closest("#skill-card-modal")) {
                if (trg) ctrl.isLocked = false;
                if (modal.style.display === "block") ctrl.stopHide();
            } else if (modal.style.display === "block") {
                ctrl.startHide();
            }
        });
    }

    /* =====================
      エントリポイント
    ============= */

    async function onLoadReady() {
        if (isEditContext()) return;

        let skillMap, urlSameGroups, enemyMap;
        try {
            ({ skillMap, urlSameGroups, enemyMap } = await loadAllData());
        } catch (err) {
            console.warn("[skill/enemy data] 読み込みに失敗しました。", err);
            return;
        }

        initSkillModal(skillMap, urlSameGroups);
        initEnemyModal(enemyMap, skillMap);

        expandEnemySkillTables(skillMap, enemyMap, urlSameGroups);
        document.dispatchEvent(new CustomEvent("skillLinksReady"));

        const needsSkillLink = SKILL_HALT_WORD ? !textContains(SKILL_HALT_WORD) : true;
        const needsDeckLink  = textContains(DECK_TARGET_WORD) && (DECK_HALT_WORD ? !textContains(DECK_HALT_WORD) : true);

        if (needsSkillLink || needsDeckLink) {
            const effectiveSkillMap = needsSkillLink ? skillMap : {};
            const effectiveEnemyMap = needsDeckLink  ? enemyMap : {};
            if (Object.keys(effectiveSkillMap).length > 0 || Object.keys(effectiveEnemyMap).length > 0) {
                const linkifyNode = makeLinker(
                    effectiveSkillMap,
                    effectiveEnemyMap,
                    needsSkillLink ? EXCLUDE_SKILL_PHRASES : [],
                    needsDeckLink  ? EXCLUDE_ENEMY_PHRASES : []
                );

                const roots = [getRoot()];
                const commentSection = document.querySelector("#comment-form");
                if (commentSection && !roots[0].contains(commentSection)) roots.push(commentSection);
                const recentComment = document.querySelector(".plugin_recenct_comment");
                if (recentComment && !roots[0].contains(recentComment)) roots.push(recentComment);

                roots.forEach(root => { walkAndLink(root, linkifyNode); observeAndLink(root, linkifyNode); });
            }
        }
    }

    document.readyState === "complete" ? setTimeout(onLoadReady, 0) : window.addEventListener("load", onLoadReady);

})();
