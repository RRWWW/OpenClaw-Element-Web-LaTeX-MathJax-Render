// isolated world（document_start）— 可存取 chrome.runtime
document.documentElement.setAttribute(
    'data-mj-font-base',
    chrome.runtime.getURL('fonts/svg/dynamic')
);

// 轉發字型注入請求給 background SW
window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type === 'mj-inject-all-fonts') {
        chrome.runtime.sendMessage({ type: 'inject-all-fonts' }, (response) => {
            window.postMessage({
                type: 'mj-all-fonts-injected',
                ok: response?.ok ?? false,
                count: response?.count ?? 0
            }, '*');
        });
    }
});
