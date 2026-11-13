# SWE Workflow

O SWE Workflow é um perfil opt-in do executor e uma política de operação do
`engineer`. Ele permanece desativado por padrão e não cria uma nova persona ou
um pacote `swe-agent`.

## Contratos implementados

- `thinkiac.swe-workflow/v1`: perfil, orçamento, allowlist e limite de artefato;
- `thinkiac.swe-baseline/v1`: HEAD e fingerprints de mudanças preexistentes;
- `thinkiac.swe-result/v1`: manifesto terminal validado;
- `thinkiac.swe-artifact/v1`: evidência redigida e endereçada por SHA-256;
- `thinkiac.swe-corpus/v1`: dez issues reproduzíveis por fixtures geradas;
- `thinkiac.swe-benchmark/v1`: comparação entre targets sob casos iguais.

`runSweWorkflow` sempre captura baseline e persiste baseline, trace e diff. Uma
conclusão com mudanças só permanece `completed` quando há diff revisado e ao
menos uma validação aprovada. Caso contrário, é rebaixada para `partial`.

## Isolamento

`in_place` é o padrão. `worktree` precisa ser solicitado explicitamente. O
worktree parte da revisão Git, não copia mudanças locais e é retido após a
execução. A API devolve o comando de limpeza, mas não o executa. Reconciliação é
deliberada a partir do diff inspecionado.

## Avaliação e promoção

O corpus fica em `benchmark/swe-corpus.v1.json`. O runner exige um adapter
`executeCase`, portanto não acopla modelo ou provedor. A comparação só marca um
resultado como comparável se houver pelo menos dois targets com exatamente os
mesmos casos. O snapshot inicial permanece `pending-measurement` até existirem
dois acessos explícitos; a implementação não fabrica evidência de modelo.

Ativação no Runtime continua sendo decisão de configuração. Testes locais
demonstram os contratos, não publicação nem ganho real contra modelos.
