/**
 * Renderizador de templates dos gatilhos de especialistas.
 *
 * Compatível com a sintaxe antes fornecida pelo módulo externo `inflect`:
 * interpolação {{ expressao }}, {#each}, {#if} e {#switch}. Ele fica
 * versionado com o único consumidor para que a imagem do tenant não dependa
 * de um pacote que não é mais publicado no registry configurado.
 */
function renderTemplate(template, context = {}, baseDir = process.cwd()) {
  function evaluate(expression) {
    try {
      const value = new Function(...Object.keys(context), `return ${expression}`)(...Object.values(context));
      return value != null ? value : `{{${expression}}}`;
    } catch {
      return `{{${expression}}}`;
    }
  }

  let output = String(template ?? '');

  output = output.replace(/\{#each\s+(\S+)\s+as\s+([^,\s}]+)(?:,\s*([^\s}]+))?\}([\s\S]*?)\{\/each\}/g,
    (_, collection, itemName, indexName, inner) => {
      const items = evaluate(collection);
      if (!Array.isArray(items)) return '';
      return items.map((item, index) => renderTemplate(inner, {
        ...context,
        [itemName]: item,
        ...(indexName ? { [indexName]: index } : {}),
      }, baseDir)).join('');
    });

  output = output.replace(/\{#if\s+([\s\S]+?)\}([\s\S]*?)\{\/if\}/g, (_, condition, inner) => {
    const branches = inner.split(/\{:\s*else\s*\}/);
    return evaluate(condition) ? renderTemplate(branches[0], context, baseDir)
      : renderTemplate(branches[1] ?? '', context, baseDir);
  });

  output = output.replace(/\{#switch\s+([\s\S]+?)\}([\s\S]*?)\{\/switch\}/g, (_, expression, inner) => {
    const value = evaluate(expression);
    const cases = /\{#case\s+([\s\S]+?)\}([\s\S]*?)\{\/case\}/g;
    let match;
    while ((match = cases.exec(inner))) {
      if (evaluate(match[1]) === value) return renderTemplate(match[2], context, baseDir);
    }
    const fallback = /\{:\s*default\s*\}([\s\S]*)/.exec(inner);
    return fallback ? renderTemplate(fallback[1], context, baseDir) : '';
  });

  return output.replace(/\{\{\s*([\s\S]+?)\s*\}\}/g, (_, expression) => {
    const value = evaluate(expression);
    return value != null ? value : '';
  });
}

module.exports = { renderTemplate };
module.exports.default = renderTemplate;
