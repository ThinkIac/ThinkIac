
export function selectExecutionTools(tools, {classifiedNames, requiredTools = [], always = () => false, allowlist, toolMode, toolAllowlist} = {}) {
 let selected = tools.filter(tool => tool.reach !== 'manual');
 if (!['all','selected'].includes(toolMode) && classifiedNames?.length) {
  const relevant = selected.filter(tool => classifiedNames.includes(tool.name) || requiredTools.includes(tool.name) || always(tool));
  if (relevant.length) selected = relevant;
 }
 if (toolAllowlist) selected = selected.filter(tool => (toolAllowlist.includes(tool.name) || (tool.name==='run_runtime_tool' && toolAllowlist.length>0)));
 if (allowlist) selected = selected.filter(tool => allowlist.includes(tool.name));
 return selected;
}


export function assertExecutionTool(tc, allowlist, depth=0) {
 if (!allowlist) return;
 if (depth>8) throw new Error('Encadeamento de ferramentas excessivo.');
 if (tc.name==='run_runtime_tool') return assertExecutionTool({name:tc.input?.tool,input:tc.input?.args},allowlist,depth+1);
 if (tc.name==='run_tool') return assertExecutionTool({name:tc.input?.name,input:tc.input?.input},allowlist,depth+1);
 if (!tc.name || !allowlist.includes(tc.name)) throw new Error('Ferramenta não autorizada para esta Agent: '+(tc.name||'indefinida'));
 if (tc.name==='run_parallel') for (const call of tc.input?.tools||[]) assertExecutionTool(call,allowlist,depth+1);
}
