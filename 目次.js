var offsetValue = 20;

// ========================================
// ■ 共通ブレークポイント（追加）
// ========================================
const TOC_BREAKPOINT = 1230;
const TOC_HEIGHT_BREAKPOINT = 700;

function isSP() {
    return window.innerWidth <= TOC_BREAKPOINT || window.innerHeight <= TOC_HEIGHT_BREAKPOINT;
}

// ============================================================
// ↓ 共通ユーティリティ：見出し座標のキャッシュ生成
// ============================================================
function buildHeadingPositions($headings) {
    return $headings.map(function() {
        return { id: this.id, top: $(this).offset().top };
    }).get();
}

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
// ↓1. PC版
// ============================================================
function generateFloatingTOC() {
    if (isSP()) {
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

    const $allHeadings = $('#main_content, .main_content').find('h1, h2, h3');

    $allHeadings.each(function(i) {
        if (!this.id) this.id = 'toc-anchor-' + i;
    });

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

        if (relTop < scrollPos || relBottom > scrollPos + containerHeight) {
            container.scrollTo({
                top: relTop - containerHeight / 2,
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

    observer.observe($target[0], {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true
    });

    setupEvents($headings, $commentArea);

    $(window).trigger('scroll.toc');
}

// ============================================================
// ↓2. SP版（修正版）
// ============================================================
function setupFloatingTOC_SP() {
    if (!isSP()) return;

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

    var $allHeadingsSP = $('#main_content, .main_content').find('h1, h2, h3');

    $allHeadingsSP.each(function(i) {
        if (!this.id) this.id = 'toc-anchor-sp-' + i;
    });

    var $headingsSP = $allHeadingsSP.filter(function() {
        if ($(this).hasClass('toc-ignore')) return false;

        const style = window.getComputedStyle(this);
        if (style.display === 'none' || style.visibility === 'hidden') return false;

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

    function openToc() {
        $('#floating-toc').addClass('is-open');
        $('#sp-toc-overlay').fadeIn(200);
        $('#sp-toc-open-btn').fadeOut(200);
        $('body').css('overflow', 'hidden');
    }

    function closeToc() {
        $('#floating-toc').removeClass('is-open');
        $('#sp-toc-overlay').fadeOut(200);
        $('#sp-toc-open-btn').fadeIn(200);
        $('body').css('overflow', '');
    }

    $('#sp-toc-open-btn').off('click').on('click', openToc);
    $('#sp-toc-overlay, #toc-toggle').off('click').on('click', closeToc);

    $(document).off('keydown.toc').on('keydown.toc', function(e) {
        if (e.key === 'Escape') closeToc();
    });

    var btnBottom = window.innerHeight / 2 - 30;
    $('#sp-toc-open-btn').css('bottom', btnBottom + 'px');
    $('#floating-toc').css('height', window.innerHeight + 'px');

    setupEvents($headingsSP);
}

// ============================================================
// ↓共通イベント処理
// ============================================================
function setupEvents($headings, $commentArea) {

    const headingData = buildHeadingPositions($headings);
    const commentTop = ($commentArea && $commentArea.length) ? $commentArea.offset().top : null;
    const commentId = ($commentArea && $commentArea.length) ? $commentArea.attr('id') : null;

    $(document).off('click', '#toc-target a').on('click', '#toc-target a', function(e) {
        var href = $(this).attr('href');
        var $targetEl = (href === "#wiki_header") ? $('body') : $(href);
        if ($targetEl.length) {
            e.preventDefault();

            if (isSP()) {
                $('#floating-toc').removeClass('is-open');
                $('#sp-toc-overlay').fadeOut(200);
                $('#sp-toc-open-btn').fadeIn(200);
                $('body').css('overflow', '');
            }

            var targetPos = (href === "#wiki_header") ? 0 : $targetEl.offset().top - offsetValue + 1;
            $('html, body').animate({ scrollTop: targetPos }, 400);
        }
    });

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

    $(window).trigger('scroll.toc');
}

// ========================================
// ■ リサイズ対応（追加）
// ========================================
$(window).off('resize.toc').on('resize.toc', function() {
    var btnBottom = window.innerHeight / 2 - 30;
    $('#sp-toc-open-btn').css('bottom', btnBottom + 'px');
    $('#floating-toc').css('height', window.innerHeight + 'px');

    if (isSP()) {
        setupFloatingTOC_SP();
    } else {
        $('#floating-toc').removeClass('is-open');
        $('#sp-toc-overlay').hide();
        $('body').css('overflow', '');
        generateFloatingTOC();
    }
});

// ============================================================
// ↓初回呼び出し
// ============================================================
setTimeout(function(){
    generateFloatingTOC();
    setupFloatingTOC_SP();
    setupRegionTocWatcher();
    setupLayoutTocWatcher();
}, 500);

// ============================================================
// ↓ 再生成
// ============================================================
document.addEventListener('wiki-toc-rebuild', function() {
    if (isSP()) {
        setupFloatingTOC_SP();
    } else {
        generateFloatingTOC();
    }
});
