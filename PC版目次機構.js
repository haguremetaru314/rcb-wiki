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
