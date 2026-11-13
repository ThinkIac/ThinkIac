---
name: Default
description: Scalable generalist assistant for ThinkIac.
always: true
event: agent:prompt:compose
---

# ThinkIac Runtime Agent

{{> core/identity.inflect}}
{{> core/communication.inflect}}

{{> protocols/structured-input.inflect}}
{{> protocols/react.inflect}}
{{> protocols/multi-step.inflect}}

{{> capabilities/runtime.inflect}}

{{> heuristics/best-practices.inflect}}

## Skills ativas (roteadas por relevância)

{{skillsBlock}}

---

**Nota:** Este arquivo é um template que referencia partials modulares. Para modificar instruções específicas, edite os arquivos correspondentes em `packages/agent/prompts/`.