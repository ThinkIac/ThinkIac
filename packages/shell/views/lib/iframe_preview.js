const PREVIEW_WIDTH = 480;
const PREVIEW_HEIGHT = 270;
const MAX_STYLED_NODES = 1800;

function stylesheetText(document) {
    return [...document.styleSheets].map((sheet) => {
        try { return [...sheet.cssRules].map((rule) => rule.cssText).join("\n"); }
        catch { return ""; }
    }).join("\n");
}

function isSafePreviewUrl(value, document) {
    if (!value || value.startsWith("data:")) return true;
    try { return new URL(value, document.baseURI).origin === location.origin; }
    catch { return false; }
}

// Styles injected by Svelte at runtime are not always represented by an
// accessible CSSStyleSheet.  Copying the resolved style makes the detached
// SVG self-contained, without bringing in an html-to-canvas dependency.
function inlineResolvedStyles(source, clone) {
    const sourceNodes = [source, ...source.querySelectorAll("*")];
    const cloneNodes = [clone, ...clone.querySelectorAll("*")];
    const length = Math.min(sourceNodes.length, cloneNodes.length, MAX_STYLED_NODES);
    for (let index = 0; index < length; index += 1) {
        const sourceNode = sourceNodes[index];
        const cloneNode = cloneNodes[index];
        const style = source.ownerDocument.defaultView.getComputedStyle(sourceNode);
        cloneNode.setAttribute("style", style.cssText);
        if (cloneNode.tagName === "IMG" && !isSafePreviewUrl(sourceNode.currentSrc || sourceNode.src, source)) {
            cloneNode.removeAttribute("src");
        }
    }
}

function waitForPaint(document) {
    return new Promise((resolve) => {
        const done = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
        // Fonts are a common reason a first-frame thumbnail looks blank. Do
        // not wait indefinitely for a font server: the bounded timeout keeps
        // opening Workstation instant even when an app is offline.
        Promise.race([
            document.fonts?.ready ?? Promise.resolve(),
            new Promise((finish) => setTimeout(finish, 700)),
        ]).finally(done);
    });
}

// Creates one small bitmap from an already-rendered, same-origin iframe.
// It is intentionally not a live mirror and never polls or observes the app.
export async function captureIframePreview(iframe, { width = PREVIEW_WIDTH, height = PREVIEW_HEIGHT } = {}) {
    const document = iframe?.contentDocument;
    if (!document?.documentElement || !document.defaultView) return null;
    try {
        await waitForPaint(document);
        const clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll("script, noscript, video, audio, iframe, canvas").forEach((node) => node.remove());
        inlineResolvedStyles(document.documentElement, clone);
        const head = clone.querySelector("head") || clone.insertBefore(document.createElement("head"), clone.firstChild);
        const base = document.createElement("base");
        base.href = document.baseURI;
        const styles = document.createElement("style");
        styles.textContent = stylesheetText(document);
        head.prepend(styles);
        head.prepend(base);
        // A screenshot means the visible app surface, not its full scrollable
        // document. This also keeps SVG work bounded for long lists.
        const sourceWidth = Math.max(1, iframe.clientWidth || document.documentElement.clientWidth);
        const sourceHeight = Math.max(1, iframe.clientHeight || document.documentElement.clientHeight);
        clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        clone.style.width = `${sourceWidth}px`;
        clone.style.height = `${sourceHeight}px`;
        const markup = new XMLSerializer().serializeToString(clone);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${sourceWidth} ${sourceHeight}" preserveAspectRatio="xMidYMid slice"><foreignObject width="${sourceWidth}" height="${sourceHeight}">${markup}</foreignObject></svg>`;
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        try {
            const image = new Image();
            await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            canvas.getContext("2d").drawImage(image, 0, 0, width, height);
            return canvas.toDataURL("image/jpeg", 0.72);
        } finally { URL.revokeObjectURL(url); }
    } catch { return null; }
}
