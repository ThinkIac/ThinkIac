




export async function chatSendContract(req, res) {
    /**
     * @register_router chat/send
     * @method POST
     */
    if (!req.body?.message) {
        return { status: 400, data: { error: '`message` is required' } }
    }
    const { chatSend } = await import('./routes/chat.js')
    return chatSend(req, res)
}

export async function chatStreamContract(req, res) {
    /**
     * @register_router chat/stream
     * @method POST
     * @streaming
     */
    if (!req.body?.message) {
        res.status(400).json({ error: '`message` is required' })
        return
    }
    const { chatStream } = await import('./routes/chat.js')
    return chatStream(req, res)
}

export function agentHealthContract() {
    /**
     * @register_router health
     * @method GET
     */
    return {
        ok: true,
        package: 'agent',
        contracts: ['chat/send', 'chat/stream', 'websocket'],
    }
}
