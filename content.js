window.MathJax = {
    options: {
        enableMenu: false,
        menuOptions: {
            settings: {
                assistiveMml: false,
                collapsible: false,
                explorer: false
            }
        },
        renderActions: {
            assistiveMml: [],
            enrich: [],
            explorer: []
        }
    },
    tex: {
        processEscapes: true,
        packages: { '[+]': ['cancel', 'boldsymbol', 'enclose', 'bbox', 'color'] }
    },
    svg: { fontCache: 'local' },
    loader: {
        ready: function () {
            // ★ MathJax 4 相容性修復：建立 SymbolMap → TokenMap 別名
            // MathJax 4 將 input.tex.SymbolMap 重新命名為 input.tex.TokenMap
            // 但 v3 的擴充套件（cancel, enclose 等）仍參照舊路徑
            try {
                if (MathJax._ && MathJax._.input && MathJax._.input.tex) {
                    var tex = MathJax._.input.tex;
                    if (tex.TokenMap && !tex.SymbolMap) {
                        tex.SymbolMap = tex.TokenMap;
                        console.log('[LaTeX] Created SymbolMap alias for TokenMap (v4 compat)');
                    }
                }
            } catch (e) { console.warn('[LaTeX] SymbolMap shim error:', e); }

            // ★ 停用版本檢查、補上 preLoad shim、修復 ParseUtil.default
            try {
                if (MathJax.loader && MathJax.loader.checkVersion) {
                    MathJax.loader._origCheckVersion = MathJax.loader.checkVersion;
                    MathJax.loader.checkVersion = function () { return false; };
                }
                // preLoad shim：新版 MathJax 已移除此方法
                if (MathJax.loader && typeof MathJax.loader.preLoad !== 'function') {
                    MathJax.loader.preLoad = function () {};
                }
                // ParseUtil.default shim：新版將 default export 改放在 .ParseUtil 子屬性
                // cancel / enclose / bbox 的 extension bundle 依賴 ParseUtil.default.keyvalOptions
                var _pu = MathJax._?.input?.tex?.ParseUtil;
                if (_pu && !_pu.default && _pu.ParseUtil) {
                    _pu.default = _pu.ParseUtil;
                }
            } catch (_) { }

            // ★ 攔截 Configuration.create → 強制向 ConfigurationHandler 註冊
            // MathJax 4 的 Configuration.create 不自動呼叫 ConfigurationHandler.set
            try {
                var _cfgMod = MathJax._.input.tex.Configuration;
                var _origCreate = _cfgMod.Configuration.create;
                var _ch = _cfgMod.ConfigurationHandler;
                if (_origCreate && _ch && _ch.set) {
                    _cfgMod.Configuration.create = function (name, opts) {
                        var cfg = _origCreate.call(this, name, opts);
                        try { _ch.set(name, cfg); } catch (_) { }
                        return cfg;
                    };
                }
            } catch (_) { }

            // ★ 攔截 MapHandler.register → 備份所有 CommandMap 實例
            try {
                var _mhPatch = MathJax._.input.tex.MapHandler.MapHandler;
                window._capturedExtMaps = {};
                if (_mhPatch && _mhPatch.register) {
                    var _origReg = _mhPatch.register.bind(_mhPatch);
                    _mhPatch.register = function (map) {
                        var mn = map && (map._name || map.name);
                        if (mn) window._capturedExtMaps[mn] = map;
                        return _origReg(map);
                    };
                }
            } catch (_) { }

            // 載入打包好的本地擴充（enclose 必須在 cancel 之前）
            try {
                if (window.mj_ext_enclose) window.mj_ext_enclose();
                if (window.mj_ext_cancel) window.mj_ext_cancel();
                if (window.mj_ext_boldsymbol) window.mj_ext_boldsymbol();
                if (window.mj_ext_bbox) window.mj_ext_bbox();
                if (window.mj_ext_color) window.mj_ext_color();
                console.log('[LaTeX] All extensions loaded');
            } catch (e) { console.error('[LaTeX] Bundle eval error:', e); }

            // 執行原始防護以繼續流程
            MathJax.loader.defaultReady();
        }
    },
    startup: {
        typeset: false,
        ready() {
            try {
                const F = MathJax._.output.fonts["mathjax-newcm"]?.svg_ts?.MathJaxNewcmFont;
                if (F?.prototype) {
                    // 阻止動態字型載入（CSP 會擋）
                    F.prototype.loadDynamicFile = function (name) {
                        if (name && typeof name === 'object') name.failed = true;
                        return Promise.resolve();
                    };
                    F.prototype.loadDynamicFileSync = function (name) {
                        if (name && typeof name === 'object') name.failed = true;
                    };
                    F.prototype.loadDynamicFilesSync = function () { };
                    F.prototype.loadDynamicFiles = function () { return Promise.resolve(); };
                }

                // ★ 核心修復：覆蓋 dynamicSetup，讓字型資料直接寫入 variant.chars
                // 字型 JS 呼叫 dynamicSetup(ext, name, data)
                // 原版把 data 存進閉包，等動態載入完才展開 → 我們阻止了載入所以永遠不展開
                // 新版直接把 data 寫入 font 實例的 variant.chars
                if (F) {
                    window._mjFontQueue = [];  // 暫存：MathJax 還沒完全初始化時先排隊
                    const origDS = F.dynamicSetup?.bind(F);
                    F.dynamicSetup = function (ext, name, data) {
                        // 仍呼叫原版（建立 descriptor 結構）
                        try { if (origDS) origDS(ext, name, data); } catch (_) { }
                        // 直接展開字元資料
                        window._mjFontQueue.push(data);
                    };
                }
            } catch (_) { }

            MathJax.startup.defaultReady();

            // ★ 重新執行擴充並注入 maps：提取為可重入函式，loader.ready 與 boot() 都會呼叫
            //   - 順序：enclose 必須在 cancel 之前（cancel 依賴 enclose 的 ENCLOSE_OPTIONS）
            //   - 每個擴充包獨立 try/catch，避免單一失敗連帶讓後續擴充不被執行
            //   - 已註冊則跳過，反覆呼叫是冪等的
            window._latexLoadExtensions = function () {
                var EXTS = ['enclose', 'cancel', 'boldsymbol', 'bbox', 'color'];
                var loaded = 0;
                for (var i = 0; i < EXTS.length; i++) {
                    var name = EXTS[i];
                    // 已註冊就跳過
                    if (MathJax._ && MathJax._.input && MathJax._.input.tex && MathJax._.input.tex[name]) {
                        loaded++;
                        continue;
                    }
                    var fn = window['mj_ext_' + name];
                    if (!fn) continue;
                    try {
                        fn();
                        loaded++;
                    } catch (e) {
                        console.warn('[LaTeX] ext ' + name + ' threw:', e.message);
                    }
                }
                // 把 CommandMap 注入 parser 的 macro handler
                try {
                    var _inp = MathJax.startup.input;
                    if (Array.isArray(_inp)) _inp = _inp[0];
                    var _items = _inp.parseOptions.handlers.get('macro')._configuration.items;
                    var _mhGet = MathJax._.input.tex.MapHandler.MapHandler;
                    EXTS.forEach(function (name) {
                        var exists = _items.some(function (i) {
                            return (i.item && (i.item._name || i.item.name)) === name;
                        });
                        if (exists) return;
                        var map = null;
                        try { map = _mhGet.getMap(name); } catch (_) { }
                        if (!map && window._capturedExtMaps) map = window._capturedExtMaps[name];
                        if (map) {
                            _items.push({ item: map, priority: 5 });
                            console.log('[LaTeX] Injected ' + name + ' map into parser');
                        }
                    });
                } catch (e) { console.warn('[LaTeX] Map injection error:', e.message); }

                // ★ boldsymbol 特殊接線：它不只靠 CommandMap，還需要
                //   (1) 自訂 token node factory → 在 \boldsymbol{...} 範圍內把產生的 token 標記 fixBold
                //   (2) postprocessor (rewriteBoldTokens) → 解析後把 fixBold 節點改成 bold mathvariant
                //   手動注入 CommandMap 不會帶入這兩者，導致 \boldsymbol 解析成功卻沿用一般斜體字形
                //   （字形 ref 仍是 -I- 而非 -BI-/-B-），肉眼看起來「沒變粗」。
                try {
                    var _bsCfg = MathJax._?.input?.tex?.boldsymbol?.BoldsymbolConfiguration;
                    if (_bsCfg && _bsCfg.createBoldToken && _bsCfg.rewriteBoldTokens) {
                        var _bi = MathJax.startup.input;
                        if (Array.isArray(_bi)) _bi = _bi[0];
                        var _bpo = _bi.parseOptions;
                        // (1) 安裝 bold token creator（用 flag 確保冪等）
                        if (_bpo.nodeFactory && !_bpo.nodeFactory._boldsymbolPatched) {
                            _bpo.nodeFactory.setCreators({ token: _bsCfg.createBoldToken });
                            _bpo.nodeFactory._boldsymbolPatched = true;
                            console.log('[LaTeX] boldsymbol token creator installed');
                        }
                        // (2) 安裝 postprocessor（用 flag 確保冪等）
                        if (_bi.postFilters && !_bi._boldsymbolPostAdded) {
                            _bi.postFilters.add(_bsCfg.rewriteBoldTokens, 10);
                            _bi._boldsymbolPostAdded = true;
                            console.log('[LaTeX] boldsymbol postFilter installed');
                        }
                    }
                } catch (e) { console.warn('[LaTeX] boldsymbol wiring error:', e.message); }

                // ★ color 特殊接線：color 套件的 Configuration 帶有 config() 與 options，
                //   手動注入 CommandMap 不會帶入，導致：
                //   (1) packageData 沒有 'color' → \textcolor 讀 .model 時 throw
                //   (2) parseOptions.options.color 缺 padding/borderWidth → \colorbox/\fcolorbox throw
                //   兩者補上後 \textcolor / \color / \colorbox / \fcolorbox / \definecolor 才會正常。
                try {
                    var _cMod = MathJax._?.input?.tex?.color;
                    var _ColorModel = _cMod && _cMod.ColorUtil && _cMod.ColorUtil.ColorModel;
                    if (_ColorModel) {
                        var _ci = MathJax.startup.input;
                        if (Array.isArray(_ci)) _ci = _ci[0];
                        var _cpo = _ci.parseOptions;
                        if (_cpo.packageData && !_cpo.packageData.get('color')) {
                            _cpo.packageData.set('color', { model: new _ColorModel() });
                            console.log('[LaTeX] ColorModel set into packageData');
                        }
                        if (!_cpo.options.color) {
                            _cpo.options.color = { padding: '5px', borderWidth: '2px' };
                            console.log('[LaTeX] color options (padding/borderWidth) set');
                        }
                    }
                } catch (e) { console.warn('[LaTeX] color wiring error:', e.message); }

                return loaded;
            };

            try {
                var n = window._latexLoadExtensions();
                console.log('[LaTeX] startup.ready loaded ' + n + '/5 extensions');
            } catch (e) { console.warn('[LaTeX] startup ext load error:', e); }

            // （color ColorModel + options 初始化已移入 _latexLoadExtensions，
            //   確保 color 套件實際載入後才執行，並補上 colorbox/fcolorbox 需要的 options）

            // ★ 補充 \therefore / \because（可能不在此版 AMS 中）
            try {
                var _sm = MathJax._.input.tex.SymbolMap;
                if (_sm.CharacterMap) {
                    // 取得 AMSsymbols-mathchar0mo 的 parser 函式作為範本
                    var _mhG = MathJax._.input.tex.MapHandler.MapHandler;
                    var amsMap = null;
                    try { amsMap = _mhG.getMap('AMSsymbols-mathchar0mo'); } catch (_) { }
                    var parseFn = amsMap?.parser || null;
                    new _sm.CharacterMap('extra-ams-mo', parseFn, {
                        therefore: '\u2234',
                        because: '\u2235'
                    });
                    var extraMap = null;
                    try { extraMap = _mhG.getMap('extra-ams-mo'); } catch (_) { }
                    if (!extraMap && window._capturedExtMaps) extraMap = window._capturedExtMaps['extra-ams-mo'];
                    if (extraMap) {
                        var _inp2 = MathJax.startup.input;
                        if (Array.isArray(_inp2)) _inp2 = _inp2[0];
                        var _items2 = _inp2.parseOptions.handlers.get('macro')._configuration.items;
                        _items2.push({ item: extraMap, priority: 5 });
                        console.log('[LaTeX] Added extra AMS symbols');
                    }
                }
            } catch (_) { }

            console.log('[LaTeX] MathJax ready');

            // 請求字型注入 → 完成後展開字元 → 啟動渲染
            window.postMessage({ type: 'mj-inject-all-fonts' }, '*');
            window.addEventListener('message', function h(e) {
                if (e.data?.type !== 'mj-all-fonts-injected') return;
                window.removeEventListener('message', h);
                console.log('[LaTeX] Fonts ready (' + e.data.count + ')');

                // 把排隊的字型資料寫入 variant.chars
                try {
                    const font = MathJax.startup.output.font;
                    if (font && window._mjFontQueue) {
                        let total = 0;
                        for (const data of window._mjFontQueue) {
                            if (!data || typeof data !== 'object') continue;
                            for (const [variantName, chars] of Object.entries(data)) {
                                if (!chars || typeof chars !== 'object') continue;
                                const variant = font.variant?.[variantName];
                                if (!variant) continue;
                                if (!variant.chars) variant.chars = {};
                                for (const [code, charData] of Object.entries(chars)) {
                                    const existing = variant.chars[+code];
                                    // 只替換 descriptor（非 array）或缺失的
                                    if (!existing || !Array.isArray(existing)) {
                                        variant.chars[+code] = charData;
                                        total++;
                                    }
                                }
                            }
                        }
                        console.log('[LaTeX] Expanded ' + total + ' chars from ' + window._mjFontQueue.length + ' font files');
                        delete window._mjFontQueue;
                    }
                } catch (err) {
                    console.warn('[LaTeX] Font expansion error:', err);
                }

                window._latexFontsReady = true;
                boot();
            });
            // 超時 8 秒
            setTimeout(() => {
                if (!window._latexFontsReady) {
                    console.warn('[LaTeX] Font timeout');
                    window._latexFontsReady = true;
                    boot();
                }
            }, 8000);
        }
    }
};

// ── 注入樣式（可複製 + 顯示優化）────────────────────────────────────────
(function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* Telegram 把 $XXX 誤判為 cashtag，套上藍底線 link 樣式；強制還原成普通文字 */
        a.text-entity-link[data-entity-type="MessageEntityCashtag"],
        a.text-entity-link[data-entity-type="MessageEntityHashtag"] {
            color: inherit !important;
            text-decoration: none !important;
            cursor: text !important;
        }
        .latex-rendered { position: relative; cursor: pointer; }
        .latex-rendered.latex-display {
            display: block; text-align: center; margin: .4em 0;
            max-width: 100%;
            overflow-x: auto; overflow-y: hidden;
            /* 避免 Telegram / 父層攔截或 snap 行為干擾水平捲動 */
            overscroll-behavior: contain;
            scroll-snap-type: none;
            -webkit-overflow-scrolling: touch;
        }
        .latex-rendered > mjx-container { pointer-events: none; }
        .latex-rendered .latex-src {
            position: absolute; left: 0; top: 0; width: 100%; height: 100%;
            color: transparent; font-size: 0; line-height: 0;
            overflow: hidden; white-space: pre; user-select: text;
            -webkit-user-select: text;
        }
        .latex-rendered .latex-src::selection { background: rgba(0,120,215,.3); }
        /* ★ Discord overlay：原 messageContent 由 React 管理，
           我們改 innerHTML 會讓 React reconciliation 撞孤兒節點導致整頁崩潰
           ("Well, this is awkward")。改在尾端 append 一個 overlay div，
           並用 CSS 把其他兄弟隱藏，React 完全不會被打擾。 */
        [data-latex-discord-rendered] > *:not(.latex-discord-overlay) {
            display: none !important;
        }
        .latex-discord-overlay {
            display: block;
            color: inherit;
            font: inherit;
        }
        /* Markdown 表格 */
        .latex-md-table {
            border-collapse: collapse;
            margin: 6px 0;
            color: inherit;
            font-size: inherit;
        }
        .latex-md-table th, .latex-md-table td {
            border: 1px solid rgba(255,255,255,0.18);
            padding: 3px 12px;
            text-align: left;
            vertical-align: middle;
            white-space: nowrap;
        }
        .latex-md-table th {
            background: rgba(255,255,255,0.07);
            font-weight: 600;
        }
        .latex-md-table tr:nth-child(even) td {
            background: rgba(255,255,255,0.03);
        }
        /* 全域提示：由 JS 動態定位，position:fixed 不受父層 overflow 裁剪 */
        #latex-tip-global {
            position: fixed; z-index: 2147483647; pointer-events: none;
            background: #333; color: #fff; font-size: 12px; padding: 3px 10px;
            border-radius: 5px; white-space: nowrap;
            opacity: 0; transition: opacity .18s;
            transform: translateX(-50%);
        }
        #latex-tip-global.show { opacity: 1; }
        #latex-tip-global.svg-tip { background: #1a6b3a; }

        /* 不額外覆蓋 MathJax SVG 樣式，避免破壞 pmatrix / underbrace 等正常渲染 */

    `;
    document.head.appendChild(style);
})();

// ── 啟動渲染（只在字型就緒後呼叫一次）─────────────────────────────────────
function boot() {
    if (window._latexBooted) return;
    window._latexBooted = true;

    // ★ 延遲重試擴充載入：startup.ready 時 MathJax._.input.tex.ParseUtil 可能還沒
    //   完整暴露 (.default 為 undefined)，導致 enclose bundle 在讀取
    //   ParseUtil.default.keyvalOptions 時拋錯，連帶讓依賴它的 cancel 也失敗。
    //   boot() 在字型載入完成後執行，此時 MathJax 完全就緒，再試一次即可成功註冊。
    try {
        if (typeof window._latexLoadExtensions === 'function') {
            var nLoaded = window._latexLoadExtensions();
            console.log('[LaTeX] boot deferred-loaded ' + nLoaded + '/5 extensions');
        }
    } catch (e) { console.warn('[LaTeX] boot ext load error:', e); }

    const processed = new WeakSet();

    function decodeHtml(s) {
        return s.replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
            .replace(/&nbsp;/g, ' ');
    }

    // Element 的 markdown 會把 _ 變 <em>、** 變 <strong> 等
    // CommonMark: \\ 在行尾會變成 \<br>（一個反斜線 + 換行標籤），需要還原成 \\
    function stripTags(s) {
        // ★ 步驟 1：還原 LaTeX 換行指令
        // Element markdown 將 \\\\ 轉為 \\<br> 或 \<br>
        // 不論原本是 1 或 2 個反斜線，接 <br> 的情況一律還原為 \\（雙反斜線 = LaTeX 換行）
        let cleaned = s.replace(/\\{1,2}\s*(<br\s*\/?>)/gi, '\\\\\n')  // \<br> 或 \\<br> → \\ + 換行
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<em>([\s\S]*?)<\/em>/gi, '_$1_')
            .replace(/<i>([\s\S]*?)<\/i>/gi, '_$1_')       // Telegram 斜體
            .replace(/<strong>([\s\S]*?)<\/strong>/gi, '$1')
            .replace(/<b>([\s\S]*?)<\/b>/gi, '$1')          // Telegram 粗體
            .replace(/<del>([\s\S]*?)<\/del>/gi, '$1')
            .replace(/<[^>]+>/g, '');

        // 特殊處理：當陣列/矩陣寫在同一行時，Element 會把 \\ 當成跳脫字串而只剩下 \
        // 我們要在特定環境內部把單一的反斜線（後接空白或換行）還原回雙反斜線
        cleaned = cleaned.replace(/\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}/g, (match, env, inner) => {
            if (/matrix|array|aligned|cases|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|split|gather|align|eqnarray|tabular/.test(env)) {
                // 必須是落單的反斜線才處理 (前後不能有反斜線)，否則正常的 \\ 會被變成 \\\\
                let fixedInner = inner.replace(/(?<!\\)\\(?!\\)(\s+)/g, '\\\\$1');
                return `\\begin{${env}}${fixedInner}\\end{${env}}`;
            }
            return match;
        });

        return decodeHtml(cleaned);
    }

    function escAttr(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 重新渲染已存在但用舊版（缺少 cancel 等 package）渲染的 spans
    function reRenderExisting() {
        const spans = document.querySelectorAll('span.latex-rendered[data-latex]');
        let count = 0;
        for (const span of spans) {
            const rawTex = span.getAttribute('data-latex');
            if (!rawTex) continue;
            const tex = decodeHtml(rawTex);
            const isDisplay = span.classList.contains('latex-display');

            // 檢查是否有 merror（渲染失敗的標記）
            const hasError = span.querySelector('mjx-merror, [data-mjx-error]');
            // 檢查 \cancel 是否顯示為紅字（未渲染的標記）
            const hasRawCancel = span.textContent && span.textContent.includes('\\cancel');
            if (!hasError && !hasRawCancel) continue;

            try {
                const node = MathJax.tex2svg(tex, { display: isDisplay });
                if (!node.querySelector('mjx-merror, [data-mjx-error]')) {
                    const escaped = escAttr(tex);
                    const delim = isDisplay ? '$$' : '$';
                    span.innerHTML = node.outerHTML +
                        `<span class="latex-src">${delim}${escaped}${delim}</span>`;
                    count++;
                }
            } catch (_) { }
        }
        if (count) console.log('[LaTeX] Re-rendered ' + count + ' existing spans');
    }

    let retryId = 0;
    const retryQueue = [];

    // ★ 自動把數學模式中裸露的 CJK 字元包進 \text{} 以免 MathJax 解析錯誤
    // 已經在 \text/\mathrm/\mbox/\operatorname{...} 中的字元不會被重複包裹
    const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u4e00-\u9fff\uff00-\uffef]+/g;
    function autoWrapCJK(tex) {
        if (!CJK_RE.test(tex)) return tex;
        CJK_RE.lastIndex = 0;
        // 切出已經是 text-like 的區塊，這些區塊原樣保留
        const protectRe = /\\(?:text|mathrm|mbox|operatorname)\{[^{}]*\}/g;
        let out = '';
        let i = 0;
        let m;
        while ((m = protectRe.exec(tex)) !== null) {
            out += tex.slice(i, m.index).replace(CJK_RE, s => `\\text{${s}}`);
            out += m[0];
            i = m.index + m[0].length;
        }
        out += tex.slice(i).replace(CJK_RE, s => `\\text{${s}}`);
        return out;
    }

    function wrapSvg(tex, display) {
        const renderTex = autoWrapCJK(tex);
        try {
            const node = MathJax.tex2svg(renderTex, { display });
            if (node.querySelector('mjx-merror, [data-mjx-error]')) {
                console.warn('[LaTeX] Parse error:', tex.substring(0, 60));
                return null;
            }

            // ★ 黑色方塊修復已移至 CSS：rect[data-frame] { fill: none !important }
            // 不在 JS 裡操作 rect 屬性，避免影響 pmatrix / underbrace 等正常渲染

            const svgHtml = node.outerHTML;
            const escaped = escAttr(tex);
            const delim = display ? '$$' : '$';
            const cls = display ? 'latex-rendered latex-display' : 'latex-rendered';
            return `<span class="${cls}" data-latex="${escaped}" title="${escaped}">` +
                svgHtml +
                `<span class="latex-src">${delim}${escaped}${delim}</span>` +
                `</span>`;
        } catch (e) {
            if (e.message && e.message.includes('MathJax retry')) {
                console.debug('[LaTeX] Expected async fallback for:', tex.substring(0, 40));
            } else {
                console.warn('[LaTeX] Render error (will retry async):', tex.substring(0, 60), e.message);
            }
            const id = 'latex-retry-' + (retryId++);
            const escaped = escAttr(tex);
            const delim = display ? '$$' : '$';
            const cls = display ? 'latex-rendered latex-display latex-pending' : 'latex-rendered latex-pending';
            retryQueue.push({ id, tex, display });
            return `<span class="${cls}" id="${id}" data-latex="${escaped}" title="${escaped}">` +
                `<span style="opacity:.5;font-style:italic">${delim}${escaped}${delim}</span>` +
                `</span>`;
        }
    }

    function processRetryQueue() {
        if (!retryQueue.length) return;
        const items = retryQueue.splice(0);
        setTimeout(async () => {
            let promiseChain = Promise.resolve();
            for (const { id, tex, display } of items) {
                const el = document.getElementById(id);
                if (!el) continue;
                const renderTex = autoWrapCJK(tex);
                let syncSuccess = false;
                try {
                    const node = MathJax.tex2svg(renderTex, { display });
                    if (!node.querySelector('mjx-merror, [data-mjx-error]')) {
                        const escaped = escAttr(tex);
                        const delim = display ? '$$' : '$';
                        el.innerHTML = node.outerHTML +
                            `<span class="latex-src">${delim}${escaped}${delim}</span>`;
                        el.classList.remove('latex-pending');
                        syncSuccess = true;
                    }
                } catch (_) { }

                if (syncSuccess) continue;

                promiseChain = promiseChain.then(() => {
                    const elCheck = document.getElementById(id);
                    if (!elCheck) return;
                    try {
                        const delim = display ? '$$' : '$';
                        elCheck.innerHTML = `${delim}${renderTex}${delim}`;
                        elCheck.style.opacity = '';
                        return MathJax.typesetPromise([elCheck]).then(() => {
                            elCheck.classList.remove('latex-pending');
                        }).catch(err => {
                            console.warn('[LaTeX] Async typeset failed:', tex.substring(0, 40), err);
                        });
                    } catch (err) {
                        console.warn('[LaTeX] Final retry failed:', tex.substring(0, 40));
                    }
                });
            }
        }, 500);
    }

    // ── 全域固定提示（不受父層 overflow:hidden 裁剪）────────────────────────
    const _tipEl = (() => {
        const el = document.createElement('span');
        el.id = 'latex-tip-global';
        document.body.appendChild(el);
        return el;
    })();
    let _tipTimer = null;
    // tipX/tipY：手勢發生當下的游標 / 觸控座標（避免 getBoundingClientRect 在非同步後失準）
    function showTip(tipX, tipY, msg, isSvg = false) {
        let top = tipY - 36;
        if (top < 8) top = tipY + 24;
        _tipEl.textContent = msg;
        _tipEl.className = isSvg ? 'svg-tip' : '';
        _tipEl.style.left = tipX + 'px';
        _tipEl.style.top  = top + 'px';
        _tipEl.classList.add('show');
        if (_tipTimer) clearTimeout(_tipTimer);
        _tipTimer = setTimeout(() => _tipEl.classList.remove('show'), 1400);
    }

    // 手勢辨識（電腦＋手機共通）：
    // • 單擊 / 單點    → 複製 LaTeX 原始碼
    // • 雙擊 / 雙點    → 複製 SVG XML（進剪貼簿，可直接貼圖）

    // SVG → PNG Blob（純 async 工具，ClipboardItem 會直接吃 Promise）
    async function svgToPngBlob(svgEl) {
        const rect = svgEl.getBoundingClientRect();
        const W = Math.max(Math.ceil(rect.width  || 200), 10);
        const H = Math.max(Math.ceil(rect.height || 60),  10);
        const SCALE = 2; // 2× retina

        const clone = svgEl.cloneNode(true);
        clone.setAttribute('xmlns',       'http://www.w3.org/2000/svg');
        clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        clone.setAttribute('width',  W);
        clone.setAttribute('height', H);
        const svgStr = new XMLSerializer().serializeToString(clone);

        // data: URL 而非 blob: URL —— 避開某些頁面 (如 OpenClaw/devtunnels) 的 CSP `img-src` 限制
        // 用 TextEncoder 正確處理 UTF-8（MathJax SVG 內含非 ASCII 字元）
        const bytes = new TextEncoder().encode(svgStr);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(binary);

        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload  = resolve;
            img.onerror = () => reject(new Error('SVG image load failed'));
            img.src = dataUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width  = W * SCALE;
        canvas.height = H * SCALE;
        const ctx = canvas.getContext('2d');
        ctx.scale(SCALE, SCALE);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);

        return new Promise((res, rej) => {
            canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob null')), 'image/png');
        });
    }

    // 雙擊 / 雙點：複製 PNG 圖片至剪貼簿
    // 關鍵：把 Promise<Blob> 直接傳給 ClipboardItem，瀏覽器會在 user-gesture 視窗內等待 Promise，
    // 這樣就算後續有 await 也不會失去使用者啟動（如 OpenClaw 那樣的嚴格頁面會失敗）。
    function copyAsPng(wrap, tipX, tipY) {
        const svgEl = wrap.querySelector('svg');
        if (!svgEl) { showTip(tipX, tipY, 'No SVG'); return; }
        try {
            const blobPromise = svgToPngBlob(svgEl).catch(err => {
                console.error('[LaTeX] svgToPngBlob failed:', err);
                throw err;
            });
            // 同步呼叫 clipboard.write，保持 user-activation
            navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blobPromise })
            ]).then(() => {
                showTip(tipX, tipY, 'PNG Copied!', true);
            }).catch(err => {
                console.error('[LaTeX] clipboard.write failed:', err);
                showTip(tipX, tipY, 'Copy failed: ' + (err.name || err.message || 'unknown'));
            });
        } catch (err) {
            console.error('[LaTeX] PNG copy failed:', err);
            showTip(tipX, tipY, 'Copy failed');
        }
    }

    function copyLatex(wrap, tipX, tipY) {
        const tex = wrap.getAttribute('data-latex');
        if (!tex) return;
        const delim = wrap.classList.contains('latex-display') ? '$$' : '$';
        navigator.clipboard.writeText(delim + tex + delim)
            .then(() => showTip(tipX, tipY, 'Copied!'))
            .catch(() => {});
    }

    // ── 電腦：click / dblclick ──
    // 單擊延遲 220ms 等待，若緊接著 dblclick 則取消單擊動作
    let _clickTimer = null;
    document.addEventListener('click', (e) => {
        const wrap = e.target.closest('.latex-rendered');
        if (!wrap) return;
        if (_clickTimer) return; // 等待中，讓 dblclick 優先
        const cx = e.clientX, cy = e.clientY;
        _clickTimer = setTimeout(() => {
            _clickTimer = null;
            copyLatex(wrap, cx, cy);
        }, 220);
    });
    document.addEventListener('dblclick', (e) => {
        const wrap = e.target.closest('.latex-rendered');
        if (!wrap) return;
        e.preventDefault();
        if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
        copyAsPng(wrap, e.clientX, e.clientY);
    });

    // ── 手機：touchend 偵測雙點（300ms 內連點兩次同一公式）──
    let _lastTap = { time: 0, el: null };
    document.addEventListener('touchend', (e) => {
        const wrap = e.target.closest('.latex-rendered');
        if (!wrap) return;
        const now = Date.now();
        const tx = e.changedTouches[0]?.clientX ?? 0;
        const ty = e.changedTouches[0]?.clientY ?? 0;
        if (_lastTap.el === wrap && now - _lastTap.time < 300) {
            e.preventDefault();
            _lastTap = { time: 0, el: null };
            if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
            copyAsPng(wrap, tx, ty);
        } else {
            _lastTap = { time: now, el: wrap };
        }
    }, { passive: false });


    // ★ 檢查元素是否還有未渲染的 LaTeX（在 .latex-rendered 之外）
    // 用於 Telegram 等漸進載入內容的平台：訊息容器在內容到達前可能先被觀察過，
    // 等實際 LaTeX 出現時必須能重新處理。
    function hasUnrenderedLatex(el) {
        // ★ Discord overlay 模式：原文兄弟仍含 $$/$ 文字但已被 CSS 隱藏，
        //   且由 overlay 重新渲染；TreeWalker 必須跳過這些原文，否則無限重試。
        const discordOverlayed = el.hasAttribute && el.hasAttribute('data-latex-discord-rendered');
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode(n) {
                let p = n.parentElement;
                while (p && p !== el) {
                    if (p.classList && p.classList.contains('latex-rendered')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // ★ 跳過 code/pre 內的文字（$ 在程式碼中不需渲染，避免無限重試迴圈）
                    if (p.tagName === 'CODE' || p.tagName === 'PRE') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // ★ Discord overlay：頂層非 overlay 子節點整支跳過
                    if (discordOverlayed && p.parentElement === el
                        && !(p.classList && p.classList.contains('latex-discord-overlay'))) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    p = p.parentElement;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let text = '';
        let node;
        while ((node = walker.nextNode())) {
            text += node.textContent;
            if (text.length > 4000) break;  // 早退避免大訊息浪費
        }
        return /\$|\\\(|\\\[|\\begin\{(equation|align|aligned|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|gather|gathered|split|multline|eqnarray|CD|math|displaymath)\*?\}/.test(text);
    }

    // ★ Discord 用 React 管控 messageContent，innerHTML 替換會讓 React fiber
    //   持有的子節點變孤兒，下次 reconciliation 撞上即崩潰（"Well, this is awkward"）。
    //   改在 messageContent 內 append 一個 overlay 子節點，並用 CSS 隱藏其他兄弟。
    //   React 只管自己創的子節點，append 的 overlay 不會被它主動移除。
    function isDiscordMsg(el) {
        return el && el.matches && el.matches('[class*="messageContent"]');
    }

    // ★ 把已渲染的 .latex-rendered / .latex-md-table 還原成原始文字
    // 內容變動後需要乾淨重新處理時使用。
    function unwrapRendered(el) {
        // 移除已渲染的 Markdown 表格（無法還原 markdown 原文，直接移除讓重新渲染）
        el.querySelectorAll('.latex-md-table').forEach(t => t.remove());
        // 還原 LaTeX span → 原始 $...$ 文字
        const rendered = el.querySelectorAll('.latex-rendered');
        for (const r of rendered) {
            const tex = r.getAttribute('data-latex') || '';
            if (!tex) { r.remove(); continue; }
            const isDisplay = r.classList.contains('latex-display');
            const delim = isDisplay ? '$$' : '$';
            r.replaceWith(document.createTextNode(delim + tex + delim));
        }
    }

    function renderEl(el) {
        if (processed.has(el)) return;
        processed.add(el);

        // 跳過純程式碼訊息：<pre> 內容佔總文字 >90% 時視為純 code，無需處理
        // ★ 不再用「有 pre 且無 p」判斷（Telegram 不用 <p> 包裹文字會誤殺含 code 的混合訊息）
        const preEls = el.querySelectorAll('pre');
        if (preEls.length) {
            let preLen = 0;
            for (const p of preEls) preLen += p.textContent.length;
            if (preLen > el.textContent.length * 0.9) return;
        }

        const discordMode = isDiscordMsg(el);

        // ★ 若元素已有舊渲染，先還原為原始文字以便重新處理
        // （Telegram 漸進載入：第一次處理時可能 LaTeX 還沒到，需要支援重做）
        // Discord overlay 模式：不還原原文（會動到 React 子樹），只清除舊 overlay 即可。
        if (discordMode) {
            el.querySelectorAll(':scope > .latex-discord-overlay').forEach(o => o.remove());
            el.removeAttribute('data-latex-discord-rendered');
        } else if (el.querySelector('.latex-rendered')) {
            unwrapRendered(el);
        }

        // ★ Telegram 把 $...$ 誤判成 cashtag（股票代號），包成藍色超連結 <a>
        // Cashtag：Telegram 消耗了 $ 符號（$F → <a>F</a>），必須還原，
        //          否則 $F = ma$ 的配對會斷掉，LaTeX 無法識別
        // Hashtag：直接解包成 span 即可
        el.querySelectorAll(
            'a.text-entity-link[data-entity-type="MessageEntityCashtag"]'
        ).forEach(a => {
            const inner = a.textContent;
            // 若 Telegram 已把 $ 放進 link text 則不重複加；否則補上 $
            const restored = inner.startsWith('$') ? inner : '$' + inner;
            a.replaceWith(document.createTextNode(restored));
        });
        el.querySelectorAll(
            'a.text-entity-link[data-entity-type="MessageEntityHashtag"]'
        ).forEach(a => {
            const span = document.createElement('span');
            while (a.firstChild) span.appendChild(a.firstChild);
            a.replaceWith(span);
        });

        const text = el.textContent;
        const hasDisplay = text.includes('$$');
        const hasInline = /\$[^$]/.test(text);
        const hasLatexDelim = text.includes('\\(') || text.includes('\\[');
        // ★ 新增：偵測裸露的 \begin{...} 環境（無 $$ 包裹）
        // 只偵測 MathJax 支援的數學環境，排除文件模式環境（table, figure, tikzpicture 等）
        const hasBareEnv = /\\begin\{(equation|align|aligned|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|gather|gathered|split|multline|eqnarray|CD|math|displaymath)[*]?\}/.test(text);
        // ★ 新增：偵測純 Markdown table（標頭行 + 分隔行）
        // 不偵測會漏掉「整段表格、無 LaTeX」的訊息
        const hasMdTable = /\|[^\n]*\|[\r\n]+[\s]*\|[\s\-:|]+\|/.test(text);
        if (!hasDisplay && !hasInline && !hasLatexDelim && !hasBareEnv && !hasMdTable) return;

        let html = el.innerHTML;
        let changed = false;

        // ★ Discord markdown 復原：Discord 把 `_X_` 解析為 <em>X</em>（會吃掉底線），
        //   並把 `\,`、`\;`、`\!`、`\:` 等 LaTeX 間距指令的反斜線當轉義字符吃掉。
        //   這在 LaTeX 下標 (`\int_{-\infty}`) 和微分間距 (`\,dx`) 上尤其致命。
        //   注意：<em> 可能跨越 $$ 邊界（例如 $$ \int</span><em>{-\infty}...$$ </em>），
        //   所以必須先把 <em>→_..._ 還原，再讓 $$...$$ matcher 正常匹配。
        if (discordMode) {
            html = html.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '_$1_')
                       .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '_$1_');
            // ★ 還原被 Discord 吃掉反斜線的 LaTeX 間距指令 \; \: \! \,
            //   Discord 把 \; → ; ／ \: → : ／ \! → ! ／ \, → ,（轉義剝除反斜線），
            //   導致間距渲染成「字面標點」（如 \;=\; 變 ;=;、\exp\! 變 exp!、m\,c 變 m,c）。
            //   還原策略依各標點「字面用途的罕見程度」分級，避免誤傷正常數學：
            //   - ; : ：數學中當字面符號極罕見 → 積極還原（後接 空白/命令/運算子/右括號 即視為間距）
            //           但不碰已是 \; 的（負向 lookbehind \\）以免變成 \\;（換行）。
            //   - !   ：n! 階乘極常見 → 只在「緊貼反斜線命令」時還原（如 \exp\!\left）。
            //   - ,   ：逗號列表極常見 → 只在 微分(\,d?) 或 緊貼 \color 群組 時還原，
            //           其餘逗號(如 (\alpha,\beta)、f(x,y)) 一律保留。
            const SP = { ';': '\\;', ':': '\\:' };
            const recoverSpacing = t => {
                // ★ 先保護 HTML 標籤與實體，避免把它們的 ; 或 < > 當成 LaTeX 標點誤改：
                //   對齊符 & 在 innerHTML 裡是 &amp;，若不保護，"&amp;=" 的 ; 會被當成 \;
                //   還原成 "&amp\;" → 解碼失敗 → \begin{align} 整個爆掉。
                const prot = [];
                t = t.replace(/<[^>]+>|&[a-zA-Z]+;|&#\d+;/g,
                              m => { prot.push(m); return '\x02' + (prot.length - 1) + '\x02'; });
                t = t
                    .replace(/(?<!\\)([;:])(?=\s|\\|[+\-=<>)\]}])/g, m => SP[m])
                    .replace(/(?<=[+\-=<>(\[{])(?<!\\)([;:])/g, m => SP[m])
                    .replace(/!(?=\\[a-zA-Z])/g, '\\!')
                    .replace(/([\w}\)\]])\s*,\s*(d[a-zA-Z])/g, '$1\\,$2')   // 微分間距 \,dx：前綴允許 文字/}/)/]（如 f(z)\,dz、[g]\,dx）
                    .replace(/,(?=\\(?:text)?color)/g, '\\,')   // 緊貼(無空格) \color/\textcolor 的逗號 = 群組間被吃的 \,（有空格的真清單則保留）
                    .replace(/([+\-=<>])\s*,/g, '$1\\,')          // 逗號緊跟二元運算子後(如 -\,)：真清單不會這樣寫，安全
                    .replace(/(\\(?:exists|forall|nexists))\s*,/g, '$1\\,')  // 量詞後的逗號：\exists\, 被吃成 \exists ,（量詞後絕不接真逗號）
                    .replace(/(,\s+),/g, '$1\\,');                // 雙逗號的第二個 = 被吃的 \,（如 "0, , n_0" → "0, \, n_0"）
                return t.replace(/\x02(\d+)\x02/g, (_, i) => prot[+i]);
            };
            html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => '$$' + recoverSpacing(inner) + '$$');
            html = html.replace(/(?<!\$)\$(?!\$)([\s\S]{1,500}?)(?<!\$)\$(?!\$)/g,
                                (m, inner) => '$' + recoverSpacing(inner) + '$');
        }

        const slots = [];
        function hold(content) {
            slots.push(content);
            return `\x00SLOT${slots.length - 1}\x00`;
        }
        function restore(s) {
            return s.replace(/\x00SLOT(\d+)\x00/g, (_, i) => slots[+i]);
        }

        html = html.replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, m => hold(m));
        html = html.replace(/<code[^>]*>[\s\S]*?<\/code>/gi, m => hold(m));

        // Display math: 按 <p> 段落邊界拆分，避免文字中的 $$ 和公式的 $$ 錯位配對
        // 先嘗試段落內 $$...$$
        html = html.replace(/<p>([\s\S]*?)<\/p>/gi, (pFull, pInner) => {
            if (!pInner.includes('$$')) return pFull;
            const replaced = pInner.replace(/\$\$([\s\S]*?)\$\$/g, (full, inner) => {
                const tex = stripTags(inner).trim();
                if (!tex || tex.length < 2) return full;
                const result = wrapSvg(tex, true);
                if (result) { changed = true; return hold(result); }
                return full;
            });
            return '<p>' + replaced + '</p>';
        });
        // 也處理不在 <p> 裡的 $$...$$（包含跨段落的多行環境如 aligned、matrix 等）
        html = html.replace(/\$\$([\s\S]*?)\$\$/g, (full, inner) => {
            const tex = stripTags(inner).trim();
            if (!tex || tex.length < 2) return full;
            const result = wrapSvg(tex, true);
            if (result) { changed = true; return hold(result); }
            return full;
        });

        html = html.replace(/\\\[([\s\S]*?)\\\]/g, (full, inner) => {
            const tex = stripTags(inner).trim();
            if (!tex || tex.length < 2) return full;
            const result = wrapSvg(tex, true);
            if (result) { changed = true; return hold(result); }
            return full;
        });

        // ★ 新增：偵測裸露的 \begin{env}...\end{env}（無 $$ 包裹），視為 display math
        // 只處理 MathJax 支援的數學環境，排除文件模式環境（table, figure, tikzpicture 等）
        // 以免 \begin{table} 造成無限重試迴圈
        const MATH_ENV_RE = /^(equation|align|aligned|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|gather|gathered|split|multline|eqnarray|CD|math|displaymath)\*?$/;
        html = html.replace(/\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}/g, (full, env, inner) => {
            // 如果已經在 SLOT 裡（已處理），跳過
            if (full.includes('\x00SLOT')) return full;
            // 只處理數學環境
            if (!MATH_ENV_RE.test(env)) return full;
            const tex = stripTags(full).trim();
            if (!tex) return full;
            const result = wrapSvg(tex, true);
            if (result) { changed = true; return hold(result); }
            return full;
        });

        if (html.includes('$')) {
            html = html.replace(/(?<!\$)\$(?!\$)([\s\S]{1,500}?)(?<!\$)\$(?!\$)/g, (m, inner) => {
                if (inner.includes('\x00SLOT')) return m;
                if (/<\/?(?:p|div|h[1-6]|ul|ol|li|blockquote|table|tr|td)[^>]*>/i.test(inner)) return m;
                if ((inner.match(/\n/g) || []).length > 3) return m;
                const tex = stripTags(inner).trim();
                if (!tex) return m;
                // 允許純數字運算與單個英文/數字字元 ($0$, $k$)
                if (tex.length === 1 && !/[a-zA-Z0-9]/i.test(tex)) return m;
                const result = wrapSvg(tex, false);
                if (result) { changed = true; return hold(result); }
                return m;
            });
        }

        // Inline math: \(...\)
        html = html.replace(/\\\(([\s\S]*?)\\\)/g, (full, inner) => {
            if (inner.includes('\x00SLOT')) return full;
            const tex = stripTags(inner).trim();
            if (!tex) return full;
            const result = wrapSvg(tex, false);
            if (result) { changed = true; return hold(result); }
            return full;
        });

        // ── Markdown 表格渲染（LaTeX 已先渲染，格子內含 SLOT ref）───────────────
        if (html.includes('|')) {
            // 統一換行：<br> → \n，方便逐行偵測
            // ★ 修復：若表格標題嵌在前段文字同一行末（如 "說明,,| 標題 | 欄 |"），
            //         在 | 前插入換行，使偵測器能正確識別 header
            //   注意：必須限定「同一行從行首到 | 之間沒有任何 pipe」，
            //   否則正常的 "| a | b | c |" 表頭會在中間被切斷。
            const normHtml = html
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/(^|\n)([^\n|]+?)(\|(?:[^|\n]+\|){2,})(?=\n\|[\s\-:|]+\|)/g,
                         (_, nl, prefix, header) => nl + prefix + '\n' + header);
            const lines = normHtml.split('\n');
            const out = [];
            let tLines = []; // { raw, text } — raw 含 HTML，text 去 tag 後用來解析

            // 去除行內 HTML tag，取純文字，用於判斷 & 解析表格
            const stripH = s => s.replace(/<[^>]+>/g, '').trim();

            const flushTable = () => {
                if (tLines.length >= 2) {
                    const texts = tLines.map(o => o.text);
                    // 第二行必須是分隔線 |---|---| 或 |:---:|
                    if (/^\|[\s\-:|]+\|$/.test(texts[1])) {
                        const validTexts = texts.filter(t => /^\|.+\|$/.test(t));
                        if (validTexts.length >= 2) {
                            // ★ 支援 cell 內以 \| 跳脫的 pipe（GFM 慣例）
                            //   先用 placeholder 換掉 \|，split 後再還原
                            const parse = l => l.replace(/^\||\|$/g, '')
                                .replace(/\\\|/g, '\x01')
                                .split('|')
                                .map(c => c.trim().replace(/\x01/g, '|'));
                            const heads = parse(validTexts[0]);
                            const body  = validTexts.slice(2).filter(Boolean).map(parse);

                            // 保留首行開頭的 HTML tag（如 <span>）及末行尾部的 HTML tag（如 </span>）
                            const prefix = tLines[0].raw.match(/^((?:<[^>]*>)*)/)?.[1] || '';
                            const suffix = tLines[tLines.length - 1].raw.match(/((?:<\/[^>]*>)*)$/)?.[1] || '';

                            let t = '<table class="latex-md-table"><thead><tr>';
                            heads.forEach(h => t += `<th>${h}</th>`);
                            t += '</tr></thead><tbody>';
                            body.forEach(cells => {
                                t += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
                            });
                            t += '</tbody></table>';

                            out.push(prefix + t + suffix);
                            changed = true;
                            tLines = [];
                            return;
                        }
                    }
                }
                out.push(...tLines.map(o => o.raw));
                tLines = [];
            };

            for (const line of lines) {
                // 去除 HTML tag 後，判斷是否為 |...|...| 格式的表格行
                const text = stripH(line);
                if (/^\|.+\|\s*$/.test(text)) {
                    tLines.push({ raw: line, text });
                } else {
                    if (tLines.length) flushTable();
                    out.push(line);
                }
            }
            if (tLines.length) flushTable();
            html = out.join('\n');
        }

        // ── 還原所有佔位符 ──
        if (changed) {
            if (discordMode) {
                // Discord：不動 React 管控的子節點，只在尾端 append overlay
                const overlay = document.createElement('div');
                overlay.className = 'latex-discord-overlay';
                overlay.innerHTML = restore(html);
                el.appendChild(overlay);
                el.setAttribute('data-latex-discord-rendered', '1');
            } else {
                el.innerHTML = restore(html);
            }
        }

        // ★ 記錄渲染後的內容指紋（textContent 長度）
        //   scan() 用此來判斷是否有新內容到達，避免解析失敗的元素被無限重試。
        processedLen.set(el, el.textContent.length);
    }

    // ── 渲染佇列（直接排隊，不依賴 IntersectionObserver）────────────────────
    // ★ 修復：IntersectionObserver 的 rootMargin 無法穿透 Discord 等平台的
    //         overflow:hidden 捲動容器，導致視窗外的訊息永遠不觸發 isIntersecting。
    //         改用直接排隊 + requestIdleCallback 節流，效能同樣良好。
    let rendering = false;
    const renderQueue = [];
    // ★ 內容指紋：記錄每個元素上次 renderEl 完成後的 textContent 長度
    //   scan() 只有在長度變化（新內容到達）時才重新排隊，防止解析失敗（如 \xrightarrow 無法渲染）
    //   造成的無限重試迴圈。
    const processedLen = new WeakMap();
    let renderTimer = null;

    function flushRender() {
        renderTimer = null;
        if (!renderQueue.length) {
            processRetryQueue();
            return;
        }
        rendering = true;
        const el = renderQueue.shift(); // 每幀只處理 1 個
        try { renderEl(el); } catch (_) { }
        rendering = false;

        if (renderQueue.length) {
            // 用 rIC 讓瀏覽器有喘息空間，最多等 80ms
            if (window.requestIdleCallback) {
                requestIdleCallback(() => {
                    renderTimer = requestAnimationFrame(flushRender);
                }, { timeout: 80 });
            } else {
                setTimeout(() => {
                    renderTimer = requestAnimationFrame(flushRender);
                }, 16);
            }
        } else {
            processRetryQueue();
        }
    }

    // 各平台的選擇器設定
    // msg: 訊息文字容器，list: 訊息列表（用來觀察新訊息）
    const PLATFORM_SELECTORS = [
        { msg: '.mx_EventTile_body',          list: '.mx_RoomView_MessageList' }, // Element
        { msg: '.chat-text',                  list: '.chat-thread-inner' },        // OpenClaw
        { msg: '.text-content',               list: '.MessageList' },               // Telegram Web A
        { msg: '[class*="messageContent"]',   list: 'ol[class*="scrollerInner"]' }, // Discord
    ];

    function getMsgSelector() {
        return PLATFORM_SELECTORS.map(p => p.msg).join(', ');
    }

    // 掃描：找到未處理的訊息，直接放入渲染佇列
    // ★ Telegram 等漸進載入平台：若元素含有未渲染的 LaTeX 則重設狀態重新處理
    function enqueue(el) {
        if (!renderQueue.includes(el)) renderQueue.push(el);
    }
    function scan() {
        for (const el of document.querySelectorAll(getMsgSelector())) {
            if (processed.has(el)) {
                // ★ Discord：如果 overlay 屬性還在但 overlay 子節點被外部（React）移掉，
                //   表示渲染被破壞，要重做。重置 attr + processed 後再判斷。
                if (el.hasAttribute('data-latex-discord-rendered')
                    && !el.querySelector(':scope > .latex-discord-overlay')) {
                    el.removeAttribute('data-latex-discord-rendered');
                    processed.delete(el);
                    processedLen.delete(el);
                    enqueue(el);
                    continue;
                }
                // ★ 已渲染表格的元素不重新處理：
                //   unwrapRendered 會移除 <table> 但無法還原原本的 pipe 文字，
                //   導致表格永久消失。若表格存在，視為完整渲染，不重新排隊。
                if (el.querySelector('.latex-md-table')) continue;
                // ★ 內容指紋檢查：若 textContent 長度沒有變化，表示沒有新內容到達，
                //   無需重試（避免解析失敗的元素如 \xrightarrow、\begin{table} 造成無限迴圈）
                const lastLen = processedLen.get(el);
                if (lastLen !== undefined && lastLen === el.textContent.length) continue;
                // 已處理過，但內容可能更新了 → 檢查是否還有未渲染的 LaTeX
                if (hasUnrenderedLatex(el)) {
                    processed.delete(el);
                    enqueue(el);
                }
            } else {
                enqueue(el);
            }
        }
        if (renderQueue.length && !renderTimer) {
            renderTimer = requestAnimationFrame(flushRender);
        }
    }

    // MutationObserver：訊息列表子元素變化時掃描
    let timer = null;
    let msgObs = new MutationObserver(() => {
        if (rendering) return;
        clearTimeout(timer);
        timer = setTimeout(scan, 200);
    });
    const observedLists = new Set();

    function attachListObserver() {
        for (const { list } of PLATFORM_SELECTORS) {
            // ★ 觀察所有匹配的列表（例如 Discord 同時有主頻道 + 討論串面板）
            for (const el of document.querySelectorAll(list)) {
                if (!observedLists.has(el)) {
                    observedLists.add(el);
                    msgObs.observe(el, { childList: true, subtree: true });
                    console.log('[LaTeX] Attached observer to', list);
                }
            }
        }
    }

    attachListObserver();

    // 房間/頁面切換：subtree: true 確保能偵測到動態載入的 .chat-thread-inner
    let roomTimer = null;
    new MutationObserver(() => {
        clearTimeout(roomTimer);
        roomTimer = setTimeout(() => {
            attachListObserver();
            scan();
        }, 500);
    }).observe(document.body, { childList: true, subtree: true });

    // 暴露給除錯用
    window._latexScan = scan;

    console.log('[LaTeX] Renderer active');
    reRenderExisting();   // 修復舊版渲染殘留（如缺 cancel package 的紅字）

    // 多次 retry scan：應對 WebSocket 聊天延遲載入（如 OpenClaw）
    [300, 1500, 3000, 6000].forEach(ms => setTimeout(() => {
        attachListObserver();
        scan();
    }, ms));
}
