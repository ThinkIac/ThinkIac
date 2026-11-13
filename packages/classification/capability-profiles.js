'use strict';

const BROWSER_TOOLS = [
    'browser_list_tabs', 'browser_open_tab', 'browser_focus_tab',
    'browser_get_page_state', 'browser_find', 'browser_navigate',
    'browser_click', 'browser_fill', 'browser_history', 'browser_press',
    'browser_scroll', 'browser_close_tab', 'browser_wait',
    'browser_cancel_action',
];

const PROFILES = [
    {
        id: 'browser.operate',
        patterns: [
            /\b(naveg(?:ue|ar|ação)|browser|geckoview|site|sites|página|pagina|url|link|aba|abas)\b/i,
            /\b(abra|abrir|acesse|acessar|pesquise|pesquisar|busque|buscar|clique|clicar|preencha|preencher)\b.{0,60}\b(no|na|um|uma|o|a)?\s*(site|página|pagina|browser|navegador|google|url|link)\b/i,
        ],
        tools: BROWSER_TOOLS,
    },
    {
        id: 'tasks.create',
        patterns: [
            /\b(crie|criar|cria|adicione|adicionar|registre|registrar|abra|abrir)\b.{0,40}\b(task|tasks|tarefa|tarefas)\b/i,
            /\b(task|tasks|tarefa|tarefas)\b.{0,40}\b(crie|criar|cria|adicione|adicionar|registre|registrar|abra|abrir)\b/i,
        ],
        tools: ['listBoards', 'createTask', 'createTaskFromText'],
    },
    {
        id: 'tasks.read',
        patterns: [/\b(liste|listar|mostre|mostrar|consulte|consultar|veja|ver|busque|buscar)\b.{0,40}\b(task|tasks|tarefa|tarefas|board|boards)\b/i],
        tools: ['listBoards', 'listTasks', 'getTask'],
    },
    {
        id: 'tasks.update',
        patterns: [/\b(atualize|atualizar|mova|mover|comente|comentar|altere|alterar)\b.{0,40}\b(task|tasks|tarefa|tarefas)\b/i],
        tools: ['getTask', 'updateTask', 'moveTask', 'addTaskComment'],
    },
];

function inferCapabilities(message, availableNames) {
    const text = typeof message === 'string' ? message : '';
    const eligible = availableNames ? new Set(availableNames) : null;
    const profiles = PROFILES.filter(profile => profile.patterns.some(pattern => pattern.test(text)));
    const tools = [...new Set(profiles.flatMap(profile => profile.tools))]
        .filter(name => !eligible || eligible.has(name));
    return { capabilities: profiles.map(profile => profile.id), tools };
}

module.exports = { BROWSER_TOOLS, PROFILES, inferCapabilities };
