import { copyMessageTiming } from './message_time.js';

// Normalize persisted messages without depending on a concrete agent package.
// Resolve resources at call time so switching the active agent remains supported.
export function createHistoryMessages({ resourceUrl, processAssistantMessage }) {
    function contentToString(raw) {
        if (!raw) return "";
        if (typeof raw === "string") return raw;
        if (Array.isArray(raw)) {
            return raw
                .filter((b) => b && b.type === "text" && b.text)
                .map((b) => String(b.text))
                .join("\n")
                .trim();
        }
        if (typeof raw === "object" && raw.text) return String(raw.text);
        return "";
    }

    const ATTACH_RE =
        /\[Attached reference:\s*type=([^;\]]*);\s*path=([^;\]]*);\s*mime=([^;\]]*);\s*name=([^\]]*)\]/g;
    const IMAGE_PATH_RE = /\[Image Path:\s*([^\]]+)\]/g;

    function attachmentUrl(p) {
        return resourceUrl(`/attachment?path=${encodeURIComponent(p)}`);
    }

    function attachmentFromRef(type, filePath, mime, name) {
        const mimetype = (mime || "").trim() || "application/octet-stream";
        const clean = (filePath || "").trim();
        return {
            name: (name || "").trim() || clean.split("/").pop() || "file",
            path: clean,
            mimetype,
            isImage:
                type === "image" || mimetype.startsWith("image/"),
            isText: false,
            base64: null,
            textContent: null,
            url: attachmentUrl(clean),
            fromHistory: true,
        };
    }

    function extractAttachmentRefs(content) {
        const text = String(content ?? "");
        if (!text.includes("[Attached reference:") && !text.includes("[Image Path:"))
            return { content: text, attachments: [] };

        const attachments = [];
        let out = text.replace(ATTACH_RE, (_, type, p, mime, name) => {
            attachments.push(
                attachmentFromRef(type.trim(), p, mime, name),
            );
            return "";
        });
        out = out.replace(IMAGE_PATH_RE, (_, p) => {
            attachments.push(attachmentFromRef("image", p, "", ""));
            return "";
        });
        return { content: out.replace(/\n{3,}/g, "\n\n").trim(), attachments };
    }

    function mergeAttachments(rawAtts, refAtts) {
        const merged = [...(rawAtts ?? [])];
        const seen = new Set(merged.map((a) => a?.path).filter(Boolean));
        for (const a of refAtts) {
            if (a.path && seen.has(a.path)) continue;
            if (a.path) seen.add(a.path);
            merged.push(a);
        }
        return merged;
    }

    function mergeAssistantGroup(items) {
        const steps = [];
        const reasoningParts = [];
        let allReasoningText = null;
        let lastContent = "";
        let model = null, provider = null;
        for (const item of items) {
            const m = item.raw;
            const content = item.content;
            lastContent = content;
            if (m.model) {
                model = m.model;
                provider = m.provider ?? null;
            }
            const toolCalls = m.tool_calls ?? [];
            if (toolCalls.length > 0) {
                for (const tc of toolCalls) {
                    const name = tc.function?.name || tc.name || "tool";
                    const args =
                        tc.function?.arguments ??
                        tc.arguments ??
                        tc.args ??
                        tc.input ??
                        null;
                    steps.push({
                        label: name,
                        reasoning: content || null,
                        args,
                        result: tc.result ?? tc.output ?? null,
                    });
                }
            }
            if (toolCalls.length > 0 && content.trim()) {
                reasoningParts.push(content);
            }
            const rc = m.reasoning_content ?? m.reasoning ?? null;
            if (rc) {
                allReasoningText = allReasoningText
                    ? allReasoningText + " " + rc
                    : rc;
            }
        }
        const msg = {
            role: "assistant",
            content: lastContent,
            attachments: [],
            streaming: false,
            steps: steps,
            allReasoning:
                allReasoningText ||
                (reasoningParts.length > 0 ? reasoningParts.join(" ") : null),
            thinkingExpanded: false,
            model,
            provider,
            ...copyMessageTiming(items[items.length - 1]?.raw),
        };
        return processAssistantMessage(msg);
    }

    function sanitizeHistoryMessages(raw) {
        if (!Array.isArray(raw)) return [];
        const interleaved = [];
        for (const m of raw) {
            const role = m.role || (m.is_user ? "user" : "assistant");
            if (role !== "user" && role !== "assistant") continue;
            const content = contentToString(
                m.content ?? m.message ?? m.text ?? "",
            );
            if (
                role === "assistant" &&
                !content.trim() &&
                !m.steps?.length &&
                (!Array.isArray(m.tool_calls) || m.tool_calls.length === 0)
            )
                continue;
            if (role === "user" && !content.trim() && !m.attachments?.length)
                continue;
            interleaved.push({ raw: m, role, content });
        }
        const merged = [];
        let assistantGroup = [];
        function flushGroup() {
            if (assistantGroup.length === 0) return;
            merged.push(mergeAssistantGroup(assistantGroup));
            assistantGroup = [];
        }
        for (const item of interleaved) {
            if (item.role === "user") {
                flushGroup();
                const refs = extractAttachmentRefs(item.content);
                merged.push({
                    role: "user",
                    content: refs.content,
                    attachments: mergeAttachments(
                        item.raw.attachments,
                        refs.attachments,
                    ),
                    inputTrace: item.raw.inputTrace ?? null,
                    streaming: false,
                    steps: [],
                    allReasoning: null,
                    thinkingExpanded: false,
                    ...copyMessageTiming(item.raw),
                });
            } else {
                assistantGroup.push(item);
            }
        }
        flushGroup();
        return merged;
    }
    return { contentToString, extractAttachmentRefs, mergeAttachments, sanitizeHistoryMessages };
}
