var offsetValue = 20;

// ============================================================
// ↓ 共通ユーティリティ：見出し座標のキャッシュ生成
// ============================================================
// scrollイベントのたびに $(el).offset().top を呼ぶと毎回強制リフローが
// 発生するため、TOC構築のタイミングで一度だけ座標を確定しキャッシュする。
// （region開閉・content-a/b切替・resize等での再構築時は setupEvents が
//   毎回呼ばれるので、その都度このキャッシュも作り直される＝常に最新）
function buildHeadingPositions($headings) {
    return $headings.map(function() {
        return { id: this.id, top: $(this).offset().top };
    }).get();
}

// scrollPos以下で最後（＝一番下）の見出しindexを二分探索で求める。
// headingData は top昇順（DOM順）であることを前提とする。
function findActiveHeadingIndex(headingData, scrollPos, offset) {
    let lo = 0, hi = headingData.length - 1, ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (scrollPos >= headingData[mid].top - offset - 10) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

// ============================================================
// ↓1. 目次生成・制御機能（PC版：最適化・軽量化・クールタイム実装版）
// ============================================================
function generateFloatingTOC() {
    if (window.innerWidth <= 1230) return;
    if (window.innerHeight <= 700) {
        setupFloatingTOC_SP();
        return;
    }

    let $toc = $('#floating-toc');
    if ($toc.length === 0) {
        $('body').append(`
        <div id="floating-toc">
            <div class="toc-title">
                <div class="toc-title-left">
                    目次 <span id="toc-header-top" style="display:none;">▲TOP</span>
                </div>
                <span id="toc-toggle">[閉じる]</span>
            </div>
            <div id="toc-target"></div>
        </div>
        `);
        $toc = $('#floating-toc');
    }

    const $target = $toc.find('#toc-target');
    const $toggle = $toc.find('#toc-toggle');
    const $topBtn = $toc.find('#toc-header-top');

    $target.empty();

    let tocHtml = '<div class="toc-item toc-page-name"><a href="#wiki_header" id="toc-link-home">ページトップ</a></div>';

    // ① 表示/非表示に関わらず、全見出しに対して一度だけIDを確定させる
    //    (content-a側・content-b側の両方に固有のIDを振ることで、
    //     切り替え時のID重複を防ぐ)
    const $allHeadings = $('#main_content, .main_content').find('h1, h2, h3');

    $allHeadings.each(function(i) {
        if (!this.id) this.id = 'toc-anchor-' + i;
    });

    // ② TOCに載せるのは、その中で「今表示されている」ものだけに絞り込む
    //    (i===0 の判定は元コードと同じく全見出し中でのインデックスを使う)
    const $headings = $allHeadings.filter((i, el) => {
        if ($(el).hasClass('toc-ignore')) return false;
        if (!$(el).is(':visible')) return false;
        return !(i === 0 && el.tagName.toLowerCase() === 'h1');
    });

    $headings.each(function() {
        const $el = $(this);
        const id = $el.attr('id');

        const tag = this.tagName.toLowerCase();
        const prefix = (tag === "h2") ? " " : (tag === "h3") ? " " : "";
        tocHtml += `<div class="toc-item toc-${tag}"><a href="#${id}">${prefix}${$el.text().trim()}</a></div>`;
    });

    const $commentArea = $('#comment_area, .comment_plugin').first();
    if ($commentArea.length) {
        const cId = $commentArea.attr('id') || 'anchor-comment';
        $commentArea.attr('id', cId);
        tocHtml += `<div class="toc-item toc-h1"><a href="#${cId}">コメント欄</a></div>`;
    }

    $target.append(tocHtml);

    const savedState = localStorage.getItem('wikiTocStatePC');
    if (savedState === 'closed') {
        $target.hide();
        $toggle.text('[表示]');
    }

    $toggle.off('click').on('click', function() {
        $target.slideToggle(200, function() {
            const isVisible = $target.is(':visible');
            $toggle.text(isVisible ? '[閉じる]' : '[表示]');
            localStorage.setItem('wikiTocStatePC', isVisible ? 'open' : 'closed');
        });
    });

    $target.off('scroll.topBtn').on('scroll.topBtn', function() {
        $(this).scrollTop() > 30 ? $topBtn.fadeIn(200) : $topBtn.fadeOut(200);
    });

    $topBtn.off('click').on('click', () => {
        $target.scrollTop(0);
        $('#toc-link-home')[0].click();
    });

    let isUserScrolling = false;
    let userScrollTimer = null;
    let lastAutoScrollTime = 0;
    const AUTO_SCROLL_COOLDOWN = 800;

    $target.on('wheel DOMMouseScroll mousewheel touchmove click', () => {
        isUserScrolling = true;
        clearTimeout(userScrollTimer);
        userScrollTimer = setTimeout(() => { isUserScrolling = false; }, 2000);
    });

    function scrollTocToActiveLink(element) {
        const container = $target[0];
        if (!element || !container || $(container).is(':hidden')) return;
        const now = Date.now();
        if (now - lastAutoScrollTime < AUTO_SCROLL_COOLDOWN) return;

        const relTop = element.offsetTop - container.offsetTop;
        const relBottom = relTop + element.offsetHeight;
        const scrollPos = container.scrollTop;
        const containerHeight = container.offsetHeight;

        const topMargin = 20;
        const bottomMargin = 100;

        if (relTop < (scrollPos + topMargin) || relBottom > (scrollPos + containerHeight - bottomMargin)) {
            container.scrollTo({
                top: relTop - (containerHeight / 2) + (element.offsetHeight / 2),
                behavior: 'smooth'
            });
            lastAutoScrollTime = now;
        }
    }

    // 【最適化】従来は $target.find('a') の各要素にobserve()を個別発行していたが、
    // 親要素1つに対して subtree:true で監視すれば同じ検知ができ、
    // observe()呼び出し回数がリンク数に比例しなくなる（O(n) → O(1)）。
    const observer = new MutationObserver(mutations => {
        if (isUserScrolling) return;
        mutations.forEach(m => {
            if (m.type === 'attributes' && $(m.target).hasClass('active-section')) {
                scrollTocToActiveLink(m.target);
            }
        });
    });

    observer.observe($target[0], {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true
    });

    setupEvents($headings, $commentArea);
    
    // --- 6. 初期ロード時の位置合わせ ---
    $(function() {
        // 【修正】以前はここで「現在のスクロール位置に一番近い見出し」を
        // 独自に計算し、それに向けてTOCパネルを先にスクロールさせていた。
        // しかしこの判定は、通常のスクロール中に使われる
        // findActiveHeadingIndex（＝一番下まで読み進めた見出しを採用する
        // ロジック）とは基準が異なるため、実際にactiveになる見出しと
        // ズレることがあった。
        //
        // さらに、その独自ロジックによる手動スクロールが
        // lastAutoScrollTime を更新してしまい、直後に走る
        // 「正しい見出しへの自動スクロール」（handleScroll →
        // MutationObserver → scrollTocToActiveLink）が
        // AUTO_SCROLL_COOLDOWN によってブロックされ、
        // 間違った位置のまま固定されてしまっていた。
        //
        // → 独自ロジックは廃止し、通常のscroll処理にそのまま委ねる。
        //    これによりハイライト対象とパネルのスクロール対象が
        //    常に同じ基準（findActiveHeadingIndex）で一致するようになる。
        $(window).trigger('scroll.toc');
    });
}

// ============================================================
// ↓2. スマホ専用UI（サイドメニュー風 ＆ 全スキャン ＆ 強力コメント検索）
// ============================================================
function setupFloatingTOC_SP() {
    if (window.innerWidth >= 1230 && window.innerHeight > 700) return;
    
    if ($('#floating-toc').length === 0) {
        $('body').append('<div id="floating-toc"><div class="toc-title">目次 <span id="toc-toggle">×</span></div><div id="toc-target"></div></div>');
    }
    if ($('#sp-toc-open-btn').length === 0) {
        $('body').append('<div id="sp-toc-open-btn" style="display:none;">≡</div>');
        $('body').append('<div id="sp-toc-overlay"></div>');
        $('#sp-toc-open-btn').fadeIn(200);
    }
    
    var $target = $('#toc-target');
    $target.empty();
    $target.append('<div class="toc-item toc-page-name"><a href="#wiki_header">ページトップ</a></div>');

    // ① 表示/非表示に関わらず、全見出しに対して一度だけIDを確定させる
    var $allHeadingsSP = $('#main_content, .main_content').find('h1, h2, h3');

    $allHeadingsSP.each(function(i) {
        if (!this.id) this.id = 'toc-anchor-sp-' + i;
    });

    // ② TOCに載せるのは、その中で「今表示されている」ものだけに絞り込む
    //    ※ content-a/content-b の切り替えだけでなく、region_content（折りたたみ領域）の
    //      開閉状態も見なければ、PC版と挙動がズレて閉じたままの見出しまで載ってしまう
    var $headingsSP = $allHeadingsSP.filter(function() {
        if ($(this).hasClass('toc-ignore')) return false;

        var $switchArea = $(this).closest('.content-a, .content-b');
        if ($switchArea.length > 0 && !$switchArea.is(':visible')) return false;

        var $regionArea = $(this).closest('.region_content');
        if ($regionArea.length > 0 && !$regionArea.is(':visible')) return false;

        return true;
    });

    $headingsSP.each(function() {
        var $this = $(this);
        var id = $this.attr('id');
        var tagName = this.tagName.toLowerCase();
        var prefix = (tagName === "h2") ? " " : (tagName === "h3") ? " " : "";
        $target.append('<div class="toc-item toc-' + tagName + '"><a href="#' + id + '">' + prefix + $this.text().trim() + '</a></div>');
    });

    var $commentSP = $('#comment_area, .comment_plugin, #comment-form, .uk-comment').first();
    if ($commentSP.length > 0) {
        var cId = $commentSP.attr('id') || 'anchor-comment-sp';
        $commentSP.attr('id', cId);
        $target.append('<div class="toc-item toc-h1"><a href="#' + cId + '">コメント欄</a></div>');
    }

    $('#sp-toc-open-btn').off('click').on('click', function() {
    $('#floating-toc').addClass('is-open');
    $('#sp-toc-overlay').fadeIn(200);
    $(this).fadeOut(200);
    $('#toc-toggle').text('×');
});

    $('#sp-toc-overlay, #toc-toggle').off('click').on('click', function() {
        $('#floating-toc').removeClass('is-open');
        $('#sp-toc-overlay').fadeOut(200);
        $('#sp-toc-open-btn').fadeIn(200);
        $('body').css('overflow', '');
    });

    var btnBottom = window.innerHeight / 2 - 30;
    $('#sp-toc-open-btn').css('bottom', btnBottom + 'px');

    setupEvents($headingsSP, $commentSP);
}

// ============================================================
// ↓共通イベント処理
// ============================================================
function setupEvents($headings, $commentArea) {
    // 【最適化】.offset().top をスクロール中に毎回呼ぶと強制リフローが
    // 発生するため、構築タイミングで一度だけ座標を確定してキャッシュする。
    // (region開閉・content-a/b切替等で再構築される場合はこの関数自体が
    //  呼び直されるため、キャッシュも自動的に最新化される)
    const headingData = buildHeadingPositions($headings);
    const commentTop = ($commentArea && $commentArea.length) ? $commentArea.offset().top : null;
    const commentId = ($commentArea && $commentArea.length) ? $commentArea.attr('id') : null;

    $(document).off('click', '#toc-target a').on('click', '#toc-target a', function(e) {
        var href = $(this).attr('href');
        var $targetEl = (href === "#wiki_header") ? $('body') : $(href);
        if ($targetEl.length) {
            e.preventDefault();
            if (window.innerWidth <= 1000) {
                $('#floating-toc').removeClass('is-open');
                $('#sp-toc-overlay').fadeOut(200);
                $('#sp-toc-open-btn').fadeIn(200);
                $('body').css('overflow', '');
            }
            var targetPos = (href === "#wiki_header") ? 0 : $targetEl.offset().top - offsetValue + 1;
            $('html, body').animate({ scrollTop: targetPos }, 400);
        }
    });

    // 【最適化】requestAnimationFrame で間引き、1フレーム1回だけ実処理を走らせる。
    // 中身の処理は .offset() を呼ばず、キャッシュ済み座標(headingData)を
    // 二分探索するだけなので、リフローもO(n)線形走査も発生しない。
    let scrollTicking = false;

    function handleScroll() {
        var scrollPos = $(document).scrollTop();
        var $allLinks = $('#toc-target a');

        if (scrollPos < 100) {
            $allLinks.removeClass('active-section');
            $('#toc-link-home').addClass('active-section');
            return;
        }

        var activeId = "";
        var idx = findActiveHeadingIndex(headingData, scrollPos, offsetValue);
        if (idx >= 0) {
            activeId = headingData[idx].id;
        }

        if (commentTop !== null && scrollPos >= commentTop - offsetValue - 10) {
            activeId = commentId;
        }

        if (activeId) {
            $allLinks.removeClass('active-section');
            $('#toc-target a[href="#' + activeId + '"]').addClass('active-section');
        }
    }

    $(window).off('scroll.toc').on('scroll.toc', function() {
        if (scrollTicking) return;
        scrollTicking = true;
        requestAnimationFrame(function() {
            handleScroll();
            scrollTicking = false;
        });
    });

    // 初回ロード時にハイライト反映
    $(window).trigger('scroll.toc');
}

// ============================================================
// ↓【追加】region（折りたたみ領域）の開閉を検知して目次を再構築
// ============================================================
// region_switch クリックで .region_content に uk-hidden が付け外しされるが、
// そのタイミングでは目次側は何も知らないため、開いた瞬間に中の見出しが
// 目次へ反映されない（閉じても消えない）。
// .region_content の class 変化を MutationObserver で監視し、
// 変化があれば既存の 'wiki-toc-rebuild' イベントを飛ばして再生成させる。
function setupRegionTocWatcher() {
    let rebuildTimer = null;
    const requestRebuild = () => {
        clearTimeout(rebuildTimer);
        // region開閉アニメーション等が絡む場合があるため少し待ってから再構築
        rebuildTimer = setTimeout(() => {
            document.dispatchEvent(new CustomEvent('wiki-toc-rebuild'));
        }, 200);
    };

    const observedRegions = new WeakSet();

    function observeRegion(el) {
        if (observedRegions.has(el)) return;
        observedRegions.add(el);
        const mo = new MutationObserver(requestRebuild);
        mo.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    // 既存の region_content を監視対象に
    document.querySelectorAll('.region_content').forEach(observeRegion);

    // ページ内で後からregionブロックが追加されるケースにも対応
    const bodyObserver = new MutationObserver(mutations => {
        let found = false;
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                if (node.matches && node.matches('.region_content')) {
                    observeRegion(node);
                    found = true;
                }
                if (node.querySelectorAll) {
                    node.querySelectorAll('.region_content').forEach(el => {
                        observeRegion(el);
                        found = true;
                    });
                }
            });
        });
        if (found) requestRebuild();
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// ↓初回呼び出し
// ============================================================
setTimeout(function(){
    generateFloatingTOC();
    setupFloatingTOC_SP();
    setupRegionTocWatcher();
}, 500);


// ============================================================
// ↓ 通常版/強化版切り替え時の目次再生成
// ============================================================
document.addEventListener('wiki-toc-rebuild', function() {
    if (window.innerWidth <= 1230 || window.innerHeight <= 700) {
        setupFloatingTOC_SP();
    } else {
        generateFloatingTOC();
    }
});
