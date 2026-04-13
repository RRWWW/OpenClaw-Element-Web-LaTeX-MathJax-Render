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

            // ★ 重新執行擴充：loader.ready() 階段 MathJax._ 命名空間尚未完整
            //   combineWithMathJax 寫入失敗；此處再呼叫一次確保 Configuration 與 CommandMap 註冊
            try {
                if (window.mj_ext_enclose) window.mj_ext_enclose();
                if (window.mj_ext_cancel) window.mj_ext_cancel();
                if (window.mj_ext_boldsymbol) window.mj_ext_boldsymbol();
                if (window.mj_ext_bbox) window.mj_ext_bbox();
                if (window.mj_ext_color) window.mj_ext_color();
                console.log('[LaTeX] Re-executed extensions post-startup');
            } catch (e) { console.warn('[LaTeX] Re-exec error:', e); }

            // ★ 後備注入：確保 extension CommandMap 存在於 parser 的 macro handler
            try {
                var _inp = MathJax.startup.input;
                if (Array.isArray(_inp)) _inp = _inp[0];
                var _macroH = _inp.parseOptions.handlers.get('macro');
                var _items = _macroH._configuration.items;
                var _mhGet = MathJax._.input.tex.MapHandler.MapHandler;
                ['enclose', 'cancel', 'boldsymbol', 'bbox', 'color'].forEach(function (name) {
                    var exists = _items.some(function (i) {
                        return (i.item?._name || i.item?.name) === name;
                    });
                    if (exists) return;
                    var map = null;
                    try { map = _mhGet.getMap(name); } catch (_) { }
                    if (!map && window._capturedExtMaps) map = window._capturedExtMaps[name];
                    if (map) {
                        _items.push({ item: map, priority: 5 });
                        console.log('[LaTeX] Injected', name, 'map into parser');
                    } else {
                        console.warn('[LaTeX] Map not found:', name);
                    }
                });
            } catch (e) { console.warn('[LaTeX] Map injection error:', e); }

            // ★ color extension 需要初始化 ColorModel
            try {
                var _inp3 = MathJax.startup.input;
                if (Array.isArray(_inp3)) _inp3 = _inp3[0];
                var _pd = _inp3.parseOptions.packageData;
                if (_pd && !_pd.get('color')) {
                    var _colorMod = MathJax._.input.tex.color;
                    if (_colorMod) {
                        // 嘗試取得 ColorModel class
                        var ColorModel = _colorMod.ColorUtil?.ColorModel
                                      || _colorMod.ColorUtil?.ColorModel;
                        if (ColorModel) {
                            _pd.set('color', { model: new ColorModel() });
                            console.log('[LaTeX] Initialized ColorModel');
                        }
                        // 也嘗試執行 config callback
                        var colorCfg = MathJax._.input.tex.Configuration.ConfigurationHandler.get('color');
                        if (colorCfg && colorCfg.configMethod) {
                            try { colorCfg.configMethod(_inp3, _inp3.parseOptions); } catch (_) { }
                        }
                    }
                }
            } catch (_) { }

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
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode(n) {
                let p = n.parentElement;
                while (p && p !== el) {
                    if (p.classList && p.classList.contains('latex-rendered')) {
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
        return /\$|\\\(|\\\[|\\begin\{[a-zA-Z]/.test(text);
    }

    // ★ 把已渲染的 .latex-rendered 還原成原始 $...$ 文字
    // 內容變動後需要乾淨重新處理時使用。
    function unwrapRendered(el) {
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

        // ★ 若元素已有舊渲染，先還原為原始文字以便重新處理
        // （Telegram 漸進載入：第一次處理時可能 LaTeX 還沒到，需要支援重做）
        if (el.querySelector('.latex-rendered')) {
            unwrapRendered(el);
        }

        // ★ Telegram 把 $...$ 誤判成 cashtag（股票代號），包成藍色超連結 <a>
        // 解包成普通 span，讓 LaTeX 以白底黑字正常顯示
        const tgEntities = el.querySelectorAll(
            'a.text-entity-link[data-entity-type="MessageEntityCashtag"],' +
            'a.text-entity-link[data-entity-type="MessageEntityHashtag"]'
        );
        for (const a of tgEntities) {
            const span = document.createElement('span');
            while (a.firstChild) span.appendChild(a.firstChild);
            a.replaceWith(span);
        }

        const text = el.textContent;
        const hasDisplay = text.includes('$$');
        const hasInline = /\$[^$]/.test(text);
        const hasLatexDelim = text.includes('\\(') || text.includes('\\[');
        // ★ 新增：偵測裸露的 \begin{...} 環境（無 $$ 包裹）
        const hasBareEnv = /\\begin\{/.test(text);
        if (!hasDisplay && !hasInline && !hasLatexDelim && !hasBareEnv) return;

        let html = el.innerHTML;
        let changed = false;

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
        // 支援常見環境：array, matrix, pmatrix, bmatrix, Bmatrix, vmatrix, Vmatrix,
        //              aligned, align, cases, equation, gather, split, etc.
        html = html.replace(/\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}/g, (full, env, inner) => {
            // 如果已經在 SLOT 裡（已處理），跳過
            if (full.includes('\x00SLOT')) return full;
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

        // ── 還原所有佔位符 ──
        if (changed) el.innerHTML = restore(html);
    }

    // ── 可見性驅動的渲染：只渲染視窗內的訊息，避免阻塞 ──
    let rendering = false;
    const renderQueue = [];
    let renderTimer = null;

    // IntersectionObserver：元素進入視窗附近時才加入渲染佇列
    const visObs = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting && !processed.has(entry.target)) {
                visObs.unobserve(entry.target);
                if (!renderQueue.includes(entry.target)) {
                    renderQueue.push(entry.target);
                }
            }
        }
        if (renderQueue.length && !renderTimer) {
            renderTimer = requestAnimationFrame(flushRender);
        }
    }, { rootMargin: '99999px 0px' });

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
        { msg: '.mx_EventTile_body',  list: '.mx_RoomView_MessageList' }, // Element
        { msg: '.chat-text',          list: '.chat-thread-inner' },        // OpenClaw
        { msg: '.text-content',       list: '.MessageList' },               // Telegram Web A
    ];

    function getMsgSelector() {
        return PLATFORM_SELECTORS.map(p => p.msg).join(', ');
    }

    // 掃描：找到未處理的訊息，交給 IntersectionObserver
    // ★ Telegram 等漸進載入平台：若元素含有未渲染的 LaTeX 則重設狀態重新處理
    function scan() {
        for (const el of document.querySelectorAll(getMsgSelector())) {
            if (processed.has(el)) {
                // 已處理過，但內容可能更新了 → 檢查是否還有未渲染的 LaTeX
                if (hasUnrenderedLatex(el)) {
                    processed.delete(el);
                    visObs.observe(el);
                }
            } else {
                visObs.observe(el);
            }
        }
    }

    // MutationObserver：訊息列表子元素變化時掃描
    let timer = null;
    let msgObs = new MutationObserver(() => {
        if (rendering) return;
        clearTimeout(timer);
        timer = setTimeout(scan, 200);
    });
    let currentList = null;

    function attachListObserver() {
        for (const { list } of PLATFORM_SELECTORS) {
            const el = document.querySelector(list);
            if (el && el !== currentList) {
                if (currentList) msgObs.disconnect();
                currentList = el;
                msgObs.observe(el, { childList: true, subtree: true });
                console.log('[LaTeX] Attached observer to', list);
                return;
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
