// Service Worker: 按需注入字型檔到頁面
// chrome.scripting.executeScript 繞過 CSP

// 數學相關必要字型（20 個，涵蓋幾乎所有數學符號）
const FONT_FILES = [
    'math.js', 'variants.js', 'symbols.js', 'symbols-b-i.js',
    'calligraphic.js', 'double-struck.js', 'fraktur.js', 'script.js',
    'accents.js', 'accents-b-i.js',
    'arrows.js', 'marrows.js', 'mshapes.js', 'shapes.js',
    'latin.js', 'latin-b.js', 'latin-i.js', 'latin-bi.js',
    'greek.js', 'greek-ss.js',
    'PUA.js', 'monospace.js'
];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'inject-all-fonts' && sender.tab?.id) {
        const tabId = sender.tab.id;
        const promises = FONT_FILES.map(file =>
            chrome.scripting.executeScript({
                target: { tabId },
                files: ['fonts/svg/dynamic/' + file],
                world: 'MAIN'
            }).catch(() => null)
        );
        Promise.all(promises).then(results => {
            const ok = results.filter(r => r !== null).length;
            sendResponse({ ok: true, count: ok });
        });
        return true;
    }
});
