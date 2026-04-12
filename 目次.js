var offsetValue = 20;

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

    const $headings = $('#main_content, .main_content').find('h1, h2, h3').filter((i, el) => {
        if ($(el).hasClass('toc-ignore')) return false;
        if (!$(el).is(':visible')) return false;
        return !(i === 0 && el.tagName.toLowerCase() === 'h1');
    });

    $headings.each(function(i) {
        const $el = $(this);
        const id = $el.attr('id') || `toc-anchor-${i}`;
        $el.attr('id', id);

        const tag = this.tagName.toLowerCase();
        const prefix = (tag === "h2") ? "◆ " : (tag === "h3") ? "◇ " : "";
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

    const observer = new MutationObserver(mutations => {
        if (isUserScrolling) return;
        mutations.forEach(m => {
            if (m.type === 'attributes' && $(m.target).hasClass('active-section')) {
                scrollTocToActiveLink(m.target);
            }
        });
    });

    $target.find('a').each(function() {
        observer.observe(this, { attributes: true });
    });

    setupEvents($headings, $commentArea);

    // --- 6. 初期ロード時の位置合わせ ---
    $(function() {
        const currentScroll = $(window).scrollTop();
        let $bestMatch = null;
        let minDiff = Infinity;
        $headings.each(function() {
            const diff = Math.abs($(this).offset().top - currentScroll);
            if (diff < minDiff) {
                minDiff = diff;
                $bestMatch = $(this);
            }
        });
        if ($bestMatch) {
            const $tocLink = $target.find(`a[href="#${$bestMatch.attr('id')}"]`);
            if ($tocLink.length) scrollTocToActiveLink($tocLink.parent()[0]);
        }

        // 初回ハイライト反映
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

    var $headingsSP = $('#main_content, .main_content').find('h1, h2, h3').filter(function() {
        if ($(this).hasClass('toc-ignore')) return false;
        if ($(this).closest('.content-a, .content-b').length > 0) {
            return $(this).closest('.content-a, .content-b').is(':visible');
        }
        return true;
    });

    $headingsSP.each(function(i) {
        var $this = $(this);
        var id = $this.attr('id') || 'toc-anchor-sp-' + i;
        $this.attr('id', id);
        var tagName = this.tagName.toLowerCase();
        var prefix = (tagName === "h2") ? "◆ " : (tagName === "h3") ? "◇ " : "";
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

    $(window).off('scroll.toc').on('scroll.toc', function() {
        var scrollPos = $(document).scrollTop();
        var $allLinks = $('#toc-target a');

        if (scrollPos < 100) {
            $allLinks.removeClass('active-section');
            $('#toc-link-home').addClass('active-section');
            return;
        }

        var activeId = "";
        $headings.each(function() {
            if (scrollPos >= $(this).offset().top - offsetValue - 10) {
                activeId = $(this).attr('id');
            }
        });

        if ($commentArea && $commentArea.length > 0 && scrollPos >= $commentArea.offset().top - offsetValue - 10) {
            activeId = $commentArea.attr('id');
        }

        if (activeId) {
            $allLinks.removeClass('active-section');
            $('#toc-target a[href="#' + activeId + '"]').addClass('active-section');
        }
    });

    // 初回ロード時にハイライト反映
    $(window).trigger('scroll.toc');
}

// ============================================================
// ↓初回呼び出し
// ============================================================
setTimeout(function(){
    generateFloatingTOC();
    setupFloatingTOC_SP();
}, 500);
