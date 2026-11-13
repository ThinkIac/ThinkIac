/**
 * Converte um link de notificação em uma intenção de navegação da Agent.
 *
 * Retorna `external` somente para origens diferentes. Links da própria
 * Agent precisam seguir o contrato de deep-link para nunca provocarem uma
 * navegação completa acidental.
 */
export function resolveNotificationDeepLink(click, origin) {
    if (!click || !origin) return null;

    let url;
    try {
        url = new URL(click, origin);
    } catch {
        return null;
    }

    if (url.origin !== origin) return { type: "external", href: url.href };

    const open = url.searchParams.get("open");
    if (open === "chat") {
        const session = url.searchParams.get("session");
        return session ? { type: "chat", session } : null;
    }
    if (open === "app") {
        const app = url.searchParams.get("app");
        return app ? { type: "app", app } : null;
    }
    if (open === "result") {
        return {
            type: "result",
            pkg: url.searchParams.get("pkg") || undefined,
            file: url.searchParams.get("file") || undefined,
        };
    }
    return null;
}
