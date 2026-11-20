/**
 * composer layout controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createComposerLayout({ state: contextState, deps }) {
    function measureComposerDock() {
        if (!contextState.composerStage) return;
        // O espaço extra evita a última mensagem encostar na sombra e cobre
        // menus/seleções que aumentam a barra depois da hidratação.
        contextState.composerDockHeight = Math.max(122, Math.ceil(contextState.composerStage.getBoundingClientRect().height + 16));
    }

    function animateComposerToDock() {
        const first = contextState.composerStage?.getBoundingClientRect();
        if (!first) return;
        deps.tick().then(() => {
            const last = contextState.composerStage?.getBoundingClientRect();
            if (!last) return;
            const dx = first.left - last.left;
            const dy = first.top - last.top;
            (contextState.composerStage.style.transition = "none", contextState.composerStage = contextState.composerStage);
            (contextState.composerStage.style.transform = `translate(${dx}px, ${dy}px) scale(1.035)`, contextState.composerStage = contextState.composerStage);
            requestAnimationFrame(() => {
                (contextState.composerStage.style.transition = "transform 320ms cubic-bezier(.22,.8,.2,1)", contextState.composerStage = contextState.composerStage);
                (contextState.composerStage.style.transform = "", contextState.composerStage = contextState.composerStage);
                deps.window.setTimeout(() => {
                    if (contextState.composerStage) (contextState.composerStage.style.transition = "", contextState.composerStage = contextState.composerStage);
                }, 340);
            });
        });
    }

    return { measureComposerDock, animateComposerToDock };
}
