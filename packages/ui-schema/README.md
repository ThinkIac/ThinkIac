# ui-schema

`ui-schema` descreve interfaces declarativas renderizadas por hosts como
Settings. O pacote consumidor fornece uma `surface` com versão, tipo, estado e
um conjunto fechado de ações; o host renderiza os controles e devolve somente
ações previstas pelo contrato.

Use schema para formulários e ações simples. Use uma view Svelte em iframe
quando houver navegação, estado visual complexo ou interação que não possa ser
expressa declarativamente.

O schema não concede autoridade. A rota ou tool do pacote deve autenticar o
chamador, autorizar a operação e validar os dados novamente. Segredos não devem
ser incorporados ao documento da superfície.

Veja [Settings](../settings/README.md) para declarar `settingsTab` e `keysTab`,
e o [mapa central](../think/README.md#mapa-de-integrações) para as alternativas.
