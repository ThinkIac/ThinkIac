/**
 * structured messages controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createStructuredMessages({ state: contextState, deps }) {
    function processAssistantMessage(msg) {
        if (msg.role === "assistant" && msg.content) {
            const structured = deps.extractStructuredInput(msg.content);
            msg._structuredData = structured.steps;
            msg.content = structured.content;
            // A IA também pode anexar arquivos: o marcador vira anexo
            // renderizado no lugar do texto cru.
            const refs = deps.extractAttachmentRefs(msg.content);
            if (refs.attachments.length) {
                msg.content = refs.content;
                msg.attachments = deps.mergeAttachments(
                    msg.attachments,
                    refs.attachments,
                );
            }
        }
        return msg;
    }

    function onEscape() {
        if (contextState.lastMessage) {
            (contextState.lastMessage._structuredData = null, contextState.lastMessage = contextState.lastMessage);
            contextState.history = [...contextState.history]; // Força o Svelte a atualizar a UI e reverter para a InputBar normal
        }
    }

    function handleLLMResponse(response) {
        if (response.structuredInput) {
            contextState.structuredProps = response.structuredInput;
        }
    }

    return { processAssistantMessage, onEscape, handleLLMResponse };
}
