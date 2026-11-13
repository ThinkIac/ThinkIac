// Script para aplicar as modificações do ReAct Recursivo no agent.js
// Uso: node patch_react.mjs

import { readFileSync, writeFileSync } from 'fs';

const path = new URL('./agent.js', import.meta.url).pathname;
let content = readFileSync(path, 'utf8');

// 1. Adicionar import do Metacore
const importLine = "import { getMetacognition } from './metacognition.js'";
const metacoreImport = "import { getMetacore } from './metacore.js'";
if (!content.includes(metacoreImport)) {
  content = content.replace(importLine, importLine + '\n' + metacoreImport);
}

// 2. Adicionar const metacore após const meta = getMetacognition()
content = content.replace(
  '  const meta = getMetacognition()\n',
  '  const meta = getMetacognition()\n  const metacore = getMetacore()\n'
);

// 3. Substituir o bloco de checkAborted + iterations++ no início do while
// Procurar o padrão: checkAborted()\n\n    iterations++
const targetBlock = `    checkAborted()

    iterations++`;

const replacementBlock = `    checkAborted()

    // ─── ReAct Recursivo: Metacore check ─────────────────────────────────
    metacore.checkPatterns(sessionId)
    const cmd = metacore.getCommand(sessionId)
    if (cmd?.action === 'pause') {
      const pauseMsg = \`*\${cmd.instruction}*\\n\\n(Motivo: \${cmd.reason})\`
      pushMessage(sessionId, { role: 'assistant', content: pauseMsg })
      const pending = getPendingReset()
      if (pending) { clearPendingReset(); executeReset(pending.reason) }
      return pauseMsg
    }

    // ─── Cross-session hints na primeira iteração ────────────────────────
    let crossSessionHint = null
    if (iterations === 0) {
      try {
        const msgs = getMessages(sessionId)
        const lastUser = [...msgs].reverse().find(m => m.role === 'user')
        if (lastUser) crossSessionHint = await metacore.getHints(sessionId, lastUser.content || '', [])
      } catch(e) { /* hints sao opcionais */ }
    }
    // ─────────────────────────────────────────────────────────────────────

    iterations++`;

// Replace only the first occurrence (the one inside the while loop)
content = content.replace(targetBlock, replacementBlock);

// 4. Modificar o system prompt cache para incluir hints quando disponíveis
// Encontrar o bloco where _cachedSystem é reconstruído
content = content.replace(
  `      // Atualiza apenas horário e modelo (partes dinâmicas)
      const { provider, model } = resolveProvider()
      currentSystem = _cachedSystem.replace(
        /## Horario Atual: .+$/m,
        \`## Horario Atual: \${nowLabel()}\`
      ).replace(
        /## Modelo: .+$/m,
        \`## Modelo: \${provider} / \${model}\`
      )
    }`,
  `      // Atualiza apenas horário e modelo (partes dinâmicas)
      const { provider, model } = resolveProvider()
      currentSystem = _cachedSystem.replace(
        /## Horario Atual: .+$/m,
        \`## Horario Atual: \${nowLabel()}\`
      ).replace(
        /## Modelo: .+$/m,
        \`## Modelo: \${provider} / \${model}\`
      )

      // Se há hint cross-session, adiciona ao system prompt
      if (crossSessionHint) {
        currentSystem += \`\\n\\n## Hint de Sessão Similar\\nBaseado em sessões anteriores similares: \${crossSessionHint}\`
      }
    }`
);

// 5. Injetar comando de reorientação na chamada LLM
// Modificar a chamada callLLM para usar effectiveSystem com comandos do Metacore
content = content.replace(
  `    checkAborted()
    $('agent:llm-start', { sessionId, iteration: iterations, messages, tools });

    const response = await callLLM({ system: currentSystem, messages, tools, abortSignal })`,
  `    checkAborted()
    $('agent:llm-start', { sessionId, iteration: iterations, messages, tools });

    // ─── ReAct Recursivo: injeta comando de reorientação ─────────────────
    let effectiveSystem = currentSystem
    if (cmd?.action === 'reorient') {
      effectiveSystem += \`\\n\\n## ⚠️ Comando do Metacore\\n\${cmd.instruction}\\n\\n(Siga esta instrução antes de continuar.)\`
      console.log(\`[Metacore] Reorientação: \${cmd.reason}\`)
    }

    const response = await callLLM({ system: effectiveSystem, messages, tools, abortSignal })`
);

// 6. Adicionar observe() no final do loop, antes do shouldReflect
content = content.replace(
  `    if (meta.shouldReflect()) {`,
  `    // ─── ReAct Recursivo: Metacore observe ──────────────────────────────
    try {
      const hasErrors = parsed.tool_calls?.length > 0
      metacore.observe({
        sessionId,
        iteration: iterations,
        toolCalls: parsed.tool_calls || [],
        errors: hasErrors ? [] : [],
        duration: 0,
        madeProgress: !!(parsed.tool_calls?.length > 0),
      })
    } catch(e) { /* metacore observe silencioso */ }

    if (meta.shouldReflect()) {`
);

// 7. Adicionar aprendizado cross-session quando tarefa conclui com sucesso
content = content.replace(
  `      pushMessage(sessionId, buildAssistantMessage(response));

      const pending = getPendingReset()
      if (pending) { clearPendingReset(); executeReset(pending.reason) }

      $('agent:success', { sessionId, iteration: iterations, text: finalText || '[done]' });

      return finalText || 'Concluido.';`,
  `      pushMessage(sessionId, buildAssistantMessage(response));

      // ─── ReAct Recursivo: aprende template se tarefa concluída ──────────
      try {
        const msgs = getMessages(sessionId)
        const lastUser = [...msgs].reverse().find(m => m.role === 'user')
        if (lastUser && lastUser.content) {
          metacore.learnTemplate({
            sessionId,
            objective: lastUser.content,
            toolsUsed: parsed.tool_calls?.map(tc => tc.name || tc.tool) || [],
            template: finalText?.slice(0, 200) || 'Tarefa concluída com sucesso.'
          })
        }
      } catch(e) { /* aprendizado opcional */ }
      // ─────────────────────────────────────────────────────────────────────

      const pending = getPendingReset()
      if (pending) { clearPendingReset(); executeReset(pending.reason) }

      $('agent:success', { sessionId, iteration: iterations, text: finalText || '[done]' });

      return finalText || 'Concluido.';`
);

writeFileSync(path, content, 'utf8');
console.log('✅ agent.js modificado com sucesso!');