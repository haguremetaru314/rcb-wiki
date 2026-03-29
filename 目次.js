// ============================================================
// ↓1. 目次生成・制御機能（PC版：最適化・軽量化・クールタイム実装版）
// ============================================================
function generateFloatingTOC() {
    // 1229px以下（スマホ・タブレット等）は別関数で処理するため即時リターン
    if (window.innerWidth <= 1230) return;

    // 高さ700px以下の場合はSP版にフォールバック
    if (window.innerHeight <= 700) {
        setupFloatingTOC_SP();
        return;
    }

    // --- 1. 目次コンテナの生成と取得 ---
    let $toc = $('#floating-toc');
    if ($toc.length === 0) {
        // HTML構造を一括で生成（DOM操作回数の削減）
        // HTML構造を一括で生成
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
    
    $target.empty(); // 初期化（重複防止）

    // --- 2. 目次アイテムの構築（文字列連結による高速化） ---
    let tocHtml = '<div class="toc-item toc-page-name"><a href="#wiki_header" id="toc-link-home">ページトップ</a></div>';

    // 見出しスキャン：最初のh1（ページタイトル）を除外
    const $headings = $('#main_content, .main_content').find('h1, h2, h3').filter((i, el) => {
        if ($(el).hasClass('toc-ignore')) return false;
        return !(i === 0 && el.tagName.toLowerCase() === 'h1');
    });

    $headings.each(function(i) {
        const $el = $(this);
        const id = $el.attr('id') || `toc-anchor-${i}`;
        $el.attr('id', id); // IDがなければ付与
        
        const tag = this.tagName.toLowerCase();
        const prefix = (tag === "h2") ? "◆ " : (tag === "h3") ? "◇ " : "";
        tocHtml += `<div class="toc-item toc-${tag}"><a href="#${id}">${prefix}${ $el.text().trim() }</a></div>`;
    });

    // コメント欄の追加
    const $commentArea = $('#comment_area, .comment_plugin').first();
    if ($commentArea.length) {
        const cId = $commentArea.attr('id') || 'anchor-comment';
        $commentArea.attr('id', cId);
        tocHtml += `<div class="toc-item toc-h1"><a href="#${cId}">コメント欄</a></div>`;
    }

    $target.append(tocHtml); // 構築したHTMLを一挙に挿入

    // --- 3. 状態復元と開閉制御 ---
    const savedState = localStorage.getItem('wikiTocStatePC');
    if (savedState === 'closed') {
        $target.hide();
        $toggle.text('[表示]');
    }

    // 開閉イベント（.off()で二重登録防止）
    $toggle.off('click').on('click', function() {
        $target.slideToggle(200, function() {
            const isVisible = $target.is(':visible');
            $toggle.text(isVisible ? '[閉じる]' : '[表示]');
            localStorage.setItem('wikiTocStatePC', isVisible ? 'open' : 'closed');
        });
    });

    // --- 4. スクロール・TOPボタン制御 ---
    $target.off('scroll.topBtn').on('scroll.topBtn', function() {
        // 30px以上スクロールでTOPボタン表示
        $(this).scrollTop() > 30 ? $topBtn.fadeIn(200) : $topBtn.fadeOut(200);
    });

    $topBtn.off('click').on('click', () => {
        $target.scrollTop(0);
        $('#toc-link-home')[0].click(); // ページ最上部へ
    });

    // --- 5. 目次内の自動スクロール制御ロジック ---
    let isUserScrolling = false;
    let userScrollTimer = null;
    let lastAutoScrollTime = 0; // 【新規】最終実行時刻を保持
    const AUTO_SCROLL_COOLDOWN = 800; // 【新規】クールタイム（ミリ秒）

    // ユーザー操作検知：自動スクロールを一時停止
    $target.on('wheel DOMMouseScroll mousewheel touchmove click', () => {
        isUserScrolling = true;
        clearTimeout(userScrollTimer);
        // 操作終了から2秒間は自動スクロールを再開させない
        userScrollTimer = setTimeout(() => { isUserScrolling = false; }, 2000);
    });

    // 目次内の項目を中央付近へスクロールさせる関数
    function scrollTocToActiveLink(element) {
        const container = $target[0];
        if (!element || !container || $(container).is(':hidden')) return;

        // 【追加】クールタイム判定：前回の実行から間隔が短すぎる場合は無視
        const now = Date.now();
        if (now - lastAutoScrollTime < AUTO_SCROLL_COOLDOWN) return;

        const relTop = element.offsetTop - container.offsetTop;
        const relBottom = relTop + element.offsetHeight;
        const scrollPos = container.scrollTop;
        const containerHeight = container.offsetHeight;

        // 判定用しきい値
        const topMargin = 20;
        const bottomMargin = 100;

        // 現在の表示範囲外（マージン外）ならスムーズにスクロール
        if (relTop < (scrollPos + topMargin) || relBottom > (scrollPos + containerHeight - bottomMargin)) {
            container.scrollTo({
                top: relTop - (containerHeight / 2) + (element.offsetHeight / 2),
                behavior: 'smooth'
            });
            // 【追加】実行時刻を更新
            lastAutoScrollTime = now;
        }
    }

    // MutationObserverで「現在位置（active-sectionクラス）」の変化を監視
    const observer = new MutationObserver(mutations => {
        // ユーザーが手動スクロール中なら自動追従しない
        if (isUserScrolling) return;

        mutations.forEach(m => {
            // 該当するリンクに active-section クラスが付与された瞬間に発火
            if (m.type === 'attributes' && $(m.target).hasClass('active-section')) {
                scrollTocToActiveLink(m.target);
            }
        });
    });

    // 目次内の全リンクに対してクラス監視を開始
    $target.find('a').each(function() {
        observer.observe(this, { attributes: true });
    });

    // 外部のスクロール連動イベントなどをセット
    setupEvents($headings, $commentArea);

    // --- 6. 初期ロード時の位置合わせ ---
    $(window).on('load', () => {
        setTimeout(() => {
            // 目次が閉じている場合は計算コストをかけない
            if ($target.is(':hidden')) return;

            const currentScroll = $(window).scrollTop();
            let $bestMatch = null;
            let minDiff = Infinity;

            // 1. ブラウザの現在表示位置に最も近い見出しを探す
            $headings.each(function() {
                const diff = Math.abs($(this).offset().top - currentScroll);
                if (diff < minDiff) {
                    minDiff = diff;
                    $bestMatch = $(this);
                }
            });

            // 2. その見出しに対応する目次項目をスクロール
            if ($bestMatch) {
                const $tocLink = $target.find(`a[href="#${$bestMatch.attr('id')}"]`);
                if ($tocLink.length) {
                    // 初期ロード時はクールタイムを無視して即座に合わせるため
                    // 直接 scrollTo を呼ぶか、lastAutoScrollTime を 0 にしておく
                    scrollTocToActiveLink($tocLink.parent()[0]);
                }
            }
        }, 150); // 描画完了を待つための微小なディレイ
    });
}
// ============================================================
// ↑1. 目次生成・制御機能（PC版：最適化完了）
// ============================================================




// ============================================================
// ↓2. スマホ専用UI（サイドメニュー風 ＆ 全スキャン ＆ 強力コメント検索）
// ============================================================
function setupFloatingTOC_SP() {
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
