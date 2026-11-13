// Ações contextuais do menu de cabeçalho. O catálogo pode conter a mesma
// contribuição em mais de uma view do pacote, então a chave pública é
// `sourcePackage:id`, não o índice no array.

function same(left, right) {
    return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

export function actionTargetsView(action, app) {
    if (!action?.target?.package || !app?.packageName) return false;
    return same(action.target.package, app.packageName)
        && (!action.target.view || same(action.target.view, app.view));
}

export function headerActionsForView(catalog, app) {
    const seen = new Set();
    return (Array.isArray(catalog) ? catalog : [])
        .flatMap((entry) => Array.isArray(entry?.headerActions) ? entry.headerActions : [])
        .filter((action) => {
            const key = `${action?.sourcePackage || ""}:${action?.id || ""}`;
            if (!actionTargetsView(action, app) || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => Number(a.order || 1000) - Number(b.order || 1000)
            || String(a.label || "").localeCompare(String(b.label || "")));
}

export function headerActionMessage(action, app) {
    return {
        type: "thinkiac:header-action",
        version: 1,
        action: {
            id: action.id,
            label: action.label,
            event: action.event,
            sourcePackage: action.sourcePackage,
        },
        target: { package: app.packageName, view: app.view },
    };
}
