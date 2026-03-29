// ============================================================
// ↓2. スマホ専用UI（サイドメニュー風 ＆ 全スキャン ＆ 強力コメント検索）
// ============================================================
window.setupFloatingTOC_SP = function () {
    // 幅1230超かつ高さ700超の場合はPC版が担当するため除外
    if (window.innerWidth >= 1230 && window.innerHeight > 700) return;
    
    if ($('#floating-toc').length === 0) {
        $('body').append('<div id="floating-toc"><div class="toc-title">目次 <span id="toc-toggle">×</span></div><div id="toc-target"></div></div>');
    }
    if ($('#sp-toc-open-btn').length === 0) {
        // 【修正】display:noneを明示してfadeIn()が正しく機能するようにする
        $('body').append('<div id="sp-toc-open-btn" style="display:none;">≡</div>');
        $('body').append('<div id="sp-toc-overlay"></div>');
        // 追加直後にfadeInで表示
        $('#sp-toc-open-btn').fadeIn(200);
    }
    
    var $target = $('#toc-target');
    $target.empty();

    // スマホ版：ページトップ追加
    $target.append('<div class="toc-item toc-page-name"><a href="#wiki_header">ページトップ</a></div>');

    // 【修正】スキャンは全体対象にしつつ、非表示コンテンツ内の見出しを除外
    var $headingsSP = $('#main_content, .main_content').find('h1, h2, h3').filter(function() {
        if ($(this).hasClass('toc-ignore')) return false; // ← 追加
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

    // スマホ版：コメント欄
    var $commentSP = $('#comment_area, .comment_plugin, #comment-form, .uk-comment').first();
    if ($commentSP.length > 0) {
        var cId = $commentSP.attr('id') || 'anchor-comment-sp';
        $commentSP.attr('id', cId);
        $target.append('<div class="toc-item toc-h1"><a href="#' + cId + '">コメント欄</a></div>');
    }

    // スマホ専用開閉イベント
    $('#sp-toc-open-btn').off('click').on('click', function() {
        $('#floating-toc').addClass('is-open');
        $('#sp-toc-overlay').fadeIn(200);
        $(this).fadeOut(200);
        $('#toc-toggle').text('×');
        // 背景スクロールを禁止
        /*$('body').css('overflow', 'hidden');*/
    });
    
    $('#sp-toc-overlay, #toc-toggle').off('click').on('click', function() {
        $('#floating-toc').removeClass('is-open');
        $('#sp-toc-overlay').fadeOut(200);
        $('#sp-toc-open-btn').fadeIn(200);
        // 背景スクロール禁止を解除
        $('body').css('overflow', '');
    });

    // 【読み込み時1回だけ】画面中央をpxで計算してbottomにセット
    // bottom基準にすることでURLバーの出入りによる再計算が不要になり、ガクッとしない
    // bottom = 画面の下半分の高さ - ボタン高さ60pxの半分(30px)
    var btnBottom = window.innerHeight / 2 - 30;
    $('#sp-toc-open-btn').css('bottom', btnBottom + 'px');

    // スマホ版のクリック・スクロール処理をアタッチ
    setupEvents($headingsSP, $commentSP);
}

// スムーズスクロールとハイライトの共通処理
function setupEvents($headings, $commentArea) {
    $(document).off('click', '#toc-target a').on('click', '#toc-target a', function(e) {
        var href = $(this).attr('href');
        var $targetEl = (href === "#wiki_header") ? $('body') : $(href);
        if ($targetEl.length) {
            e.preventDefault();
            // スマホ時はクリック後に閉じる
            if (window.innerWidth <= 1000) {
                $('#floating-toc').removeClass('is-open');
                $('#sp-toc-overlay').fadeOut(200);
                $('#sp-toc-open-btn').fadeIn(200);
                // 背景スクロール禁止を解除
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
}
// ============================================================
// ↑2. スマホ専用UI（サイドメニュー風 ＆ 全スキャン ＆ 強力コメント検索）
// ============================================================
