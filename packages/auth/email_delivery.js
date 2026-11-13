import crypto from 'node:crypto';

function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

export function verificationMail({ email, code, url }) {
    const safeUrl = String(url);
    return {
        subject: 'Confirme seu e-mail no ThinkIac',
        text: `Confirme seu e-mail abrindo este link: ${safeUrl}\n\nOu informe este código: ${code}\n\nO link e o código expiram em 15 minutos.`,
        html: `<p>Confirme seu e-mail para concluir o cadastro no ThinkIac.</p><p><a href="${escapeHtml(safeUrl)}">Confirmar e-mail</a></p><p>Ou informe este código: <strong>${escapeHtml(code)}</strong></p><p>O link e o código expiram em 15 minutos.</p>`,
    };
}

export async function queueVerificationEmail({ email, code, url, env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const gatewayUrl = env.AUTH_EMAIL_GATEWAY_URL || env.PROJECT_MAIL_GATEWAY_URL;
    const token = env.AUTH_EMAIL_GATEWAY_TOKEN || env.PROJECT_MAIL_GATEWAY_TOKEN;
    const mailboxId = env.AUTH_EMAIL_MAILBOX_ID;
    const sender = env.AUTH_EMAIL_FROM;
    if (!gatewayUrl || !token || !mailboxId || !sender) throw new Error('Envio de confirmação de e-mail não está configurado.');
    const mail = verificationMail({ email, code, url });
    const response = await fetchImpl(`${gatewayUrl.replace(/\/$/, '')}/v1/messages/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ mailboxId, sender, to: email, ...mail, idempotencyKey: `auth-email-verification:${crypto.randomUUID()}` }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Falha ao enfileirar e-mail (${response.status}).`);
    }
    return response.json();
}
