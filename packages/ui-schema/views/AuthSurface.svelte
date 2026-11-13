<script>
  export let surface;
  export let state = {};
  export let actionUrl = '';

  let data = {}, appliedState = null, busy = '', error = '', notice = '', createOpen = false, editing = null, selectedRole = null;
  let createForm = { name: '', email: '', username: '', password: '', roleSelections: [] };
  let registration = { registrationEnabled: true, invitationsEnabled: true, defaultRoleSelection: '' };
  let roleName = '', roleEditName = '', grantPermission = '', grantEffect = 'allow';

  // `data` is also updated with the complete state returned by an action.
  // Track the last prop separately: comparing the prop with `data` caused
  // that fresh response to be immediately replaced by the stale parent prop.
  $: if (state && state !== appliedState) {
    appliedState = state;
    data = state;
    registration = { ...registration, ...(state.settings || {}) };
    if (selectedRole) selectedRole = (state.permissions?.groups || []).find((group) => group.id === selectedRole.id) || null;
  }
  $: users = Array.isArray(data.users) ? data.users : [];
  $: permissions = data.permissions || { groups: [], memberships: [], grants: [], selectablePermissions: [] };
  $: roles = Array.isArray(permissions.groups) ? permissions.groups.filter((group) => !group.declaredPackage) : [];
  // Package roles are declared in their package manifest and only become a
  // stored group on their first assignment. Keep them in this picker so an
  // administrator can grant a product role before that happens.
  $: assignableRoles = Array.isArray(data.assignableRoles) ? data.assignableRoles : [];
  $: availableRoles = Array.isArray(data.availableRoles) ? data.availableRoles : [];
  $: roleOptions = optionsFor(assignableRoles);
  $: defaultRoleOptions = optionsFor(availableRoles);
  $: selectablePermissions = Array.isArray(permissions.selectablePermissions) ? permissions.selectablePermissions : [];

  function optionsFor(declaredRoles) {
    const stored = (permissions.groups || []).map((group) => ({ value: `group:${group.id}`, label: group.name }));
    const declared = declaredRoles
      .filter((role) => !(permissions.groups || []).some((group) => group.declaredPackage === role.packageName && group.declaredGroup === role.id))
      .map((role) => ({ value: `declared:${role.packageName}:${role.id}`, label: `${role.packageLabel} · ${role.label}` }));
    return [...stored, ...declared];
  }

  function groupsFor(userId) { const ids = (permissions.memberships || []).filter((item) => item.userId === userId).map((item) => item.groupId); return (permissions.groups || []).filter((group) => ids.includes(group.id)); }
  function membershipFor(userId, groupId) { return (permissions.memberships || []).find((item) => item.userId === userId && item.groupId === groupId); }
  function grantsFor(subjectType, subjectId) { return (permissions.grants || []).filter((item) => item.subjectType === subjectType && item.subjectId === subjectId); }
  function membersFor(groupId) { return (permissions.memberships || []).filter((item) => item.groupId === groupId); }
  function status(invite) { return invite.consumed ? 'Used' : invite.revoked ? 'Revoked' : 'Available'; }

  async function act(action, values = {}, label = action) {
    busy = label; error = ''; notice = '';
    try {
      const response = await fetch(actionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, values: { ...values, tab: surface.tab } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status >= 400) throw new Error(result.error || result.message || 'Não foi possível concluir a ação.');
      data = result.state || data; notice = result.notice || 'Atualizado.';
    } catch (cause) { error = cause.message || 'Não foi possível concluir a ação.'; }
    finally { busy = ''; }
  }
  function createUser() { act('auth.create-user', createForm, 'create-user').then(() => { if (!error) { createOpen = false; createForm = { name: '', email: '', username: '', password: '', roleSelections: [] }; } }); }
  function saveUser() { act('auth.update-user', { userId: editing.id, ...editing.form }, 'update-user').then(() => { if (!error) editing = null; }); }
  function openEdit(user) { editing = { id: user.id, form: { name: user.name || '', email: user.email || '', username: user.username || '', roleSelections: groupsFor(user.id).map((group) => `group:${group.id}`) } }; }
  function selectRole(role) { selectedRole = role; roleEditName = role.name; grantPermission = ''; grantEffect = 'allow'; }
</script>

<section class="surface" aria-busy={!!busy}>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}

  {#if surface.tab === 'auth-users'}
    <header><h2>Users <small>{users.length}</small></h2><button class="primary" on:click={() => createOpen = !createOpen}>{createOpen ? 'Close' : 'Add user'}</button></header>
    {#if createOpen}<form class="form" on:submit|preventDefault={createUser}><label>Name<input bind:value={createForm.name} /></label><label>Email<input type="email" required bind:value={createForm.email} /></label><label>Username<input required bind:value={createForm.username} /></label><label>Password<input type="password" required bind:value={createForm.password} /></label><label>Roles<select multiple bind:value={createForm.roleSelections}>{#each roleOptions as role}<option value={role.value}>{role.label}</option>{/each}</select></label><footer><button class="primary" disabled={busy === 'create-user'}>Create user</button></footer></form>{/if}
    <ul>{#each users as user}<li><div><strong>{user.name || user.username || user.email}</strong><small>{user.email}</small><small>{groupsFor(user.id).map((group) => group.name).join(', ') || 'No roles'}</small></div><div class="row-actions"><button on:click={() => openEdit(user)}>Edit</button>{#if user.role !== 'admin'}<button class="danger" disabled={busy === `delete-${user.id}`} on:click={() => act('auth.delete-user', { userId: user.id }, `delete-${user.id}`)}>Delete</button>{/if}</div>{#if editing?.id === user.id}<form class="form edit" on:submit|preventDefault={saveUser}><label>Name<input bind:value={editing.form.name} /></label><label>Email<input type="email" required bind:value={editing.form.email} /></label><label>Username<input required bind:value={editing.form.username} /></label><label>Roles<select multiple bind:value={editing.form.roleSelections}>{#each roleOptions as role}<option value={role.value}>{role.label}</option>{/each}</select></label><footer><button class="primary" disabled={busy === 'update-user'}>Save</button><button type="button" on:click={() => editing = null}>Cancel</button></footer></form>{/if}</li>{/each}</ul>

  {:else if surface.tab === 'auth-registration'}
    <form class="form narrow" on:submit|preventDefault={() => act('auth.save-registration', registration, 'registration')}><label class="switch"><span>Allow registration<small>Anyone can create an account.</small></span><input type="checkbox" bind:checked={registration.registrationEnabled} /></label>{#if registration.registrationEnabled}<label class="switch"><span>Enable invitations<small>Allow invitation codes during sign-up.</small></span><input type="checkbox" bind:checked={registration.invitationsEnabled} /></label><label>Default role<select bind:value={registration.defaultRoleSelection}><option value="">No default role</option>{#each defaultRoleOptions as role}<option value={role.value}>{role.label}</option>{/each}</select></label>{/if}<footer><button class="primary" disabled={busy === 'registration'}>Save settings</button></footer></form>

  {:else if surface.tab === 'auth-invitations'}
    <header><h2>Invitations</h2><button class="primary" disabled={busy === 'invite'} on:click={() => act('auth.create-invite', {}, 'invite')}>Create invitation</button></header>
    <ul>{#each data.invites || [] as invite}<li><code>{invite.code}</code><span class="badge">{status(invite)}</span>{#if !invite.consumed && !invite.revoked}<button class="danger" disabled={busy === `revoke-${invite.code}`} on:click={() => act('auth.revoke-invite', { code: invite.code }, `revoke-${invite.code}`)}>Revoke</button>{/if}</li>{:else}<li class="muted">No invitations yet.</li>{/each}</ul>

  {:else}
    <header><h2>Roles</h2></header><form class="inline" on:submit|preventDefault={() => { if (roleName.trim()) act('auth.create-role', { name: roleName.trim() }, 'create-role').then(() => { if (!error) roleName = ''; }); }}><input aria-label="New role name" placeholder="New role name" bind:value={roleName} /><button class="primary" disabled={busy === 'create-role'}>Create role</button></form>
    <div class="roles"><section>{#each roles as role}<button class:active={selectedRole?.id === role.id} class="role" on:click={() => selectRole(role)}><strong>{role.name}</strong><small>{membersFor(role.id).length} people · {grantsFor('group', role.id).length} permissions</small></button>{:else}<p class="muted">No custom roles yet.</p>{/each}</section>{#if selectedRole}<aside><form class="inline" on:submit|preventDefault={() => act('auth.update-role', { id: selectedRole.id, name: roleEditName }, 'update-role')}><input aria-label="Role name" bind:value={roleEditName} /><button class="primary" disabled={busy === 'update-role'}>Save</button></form><h3>Permissions</h3>{#each grantsFor('group', selectedRole.id) as grant}<div class="line"><code>{grant.permission}</code><button class="danger" on:click={() => act('auth.remove-grant', { id: grant.id }, `remove-grant-${grant.id}`)}>Remove</button></div>{:else}<p class="muted">No permissions.</p>{/each}<form class="inline" on:submit|preventDefault={() => grantPermission && act('auth.add-grant', { subjectType: 'group', subjectId: selectedRole.id, permission: grantPermission, effect: grantEffect }, 'add-grant')}><select aria-label="Permission" bind:value={grantPermission}><option value="">Select permission</option>{#each selectablePermissions as permission}<option value={permission.permission}>{permission.packageName} · {permission.resource} · {permission.action}</option>{/each}</select><select aria-label="Effect" bind:value={grantEffect}><option value="allow">Allow</option><option value="deny">Deny</option></select><button disabled={!grantPermission || busy === 'add-grant'}>Add</button></form><h3>People</h3>{#each users as user}<label class="member"><input type="checkbox" checked={!!membershipFor(user.id, selectedRole.id)} on:change={() => { const membership = membershipFor(user.id, selectedRole.id); act(membership ? 'auth.remove-member' : 'auth.add-member', membership ? { id: membership.id } : { userId: user.id, groupId: selectedRole.id }, `member-${user.id}`); }} />{user.name || user.username || user.email}</label>{/each}<footer><button class="danger" disabled={busy === 'delete-role'} on:click={() => act('auth.delete-role', { id: selectedRole.id }, 'delete-role').then(() => { if (!error) selectedRole = null; })}>Delete role</button></footer></aside>{:else}<aside class="muted">Select a role to manage it.</aside>{/if}</div>
  {/if}
</section>

<style>
  .surface,.form,.roles,aside,ul{display:grid;gap:1rem}.surface *{box-sizing:border-box}header,.row-actions,.inline,.line{align-items:center;display:flex;gap:.6rem;justify-content:space-between}h2,h3,p{margin:0}h2{font-size:1.2rem}h3{border-top:1px solid var(--tk-border);font-size:1rem;margin-top:.5rem;padding-top:1rem}small,.muted{color:var(--tk-muted);display:block;font-size:.85rem}.form{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:1rem;max-width:680px}.form.narrow{grid-template-columns:1fr}.edit{flex-basis:100%;grid-column:1/-1;width:100%}.switch{align-items:center;display:flex;justify-content:space-between}.switch input,.member input{min-height:1.1rem;width:1.1rem}label{color:var(--tk-muted);display:grid;gap:.35rem;font-size:.85rem}input,select{background:transparent;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);color:var(--tk-text);font:inherit;min-height:2.5rem;padding:.55rem .65rem;width:100%}button{background:transparent;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);color:var(--tk-text);cursor:pointer;font:inherit;padding:.55rem .75rem}button.primary{background:var(--tk-accent);border-color:var(--tk-accent);color:var(--tk-on-accent,var(--tk-bg));font-weight:700}button.danger{color:var(--tk-danger,#ff9b9b)}button:disabled{cursor:wait;opacity:.6}footer{display:flex;gap:.5rem;justify-content:flex-end;grid-column:1/-1}ul{list-style:none;margin:1rem 0 0;padding:0}li{align-items:center;border-top:1px solid var(--tk-border);display:flex;flex-wrap:wrap;gap:1rem;justify-content:space-between;padding:.8rem 0}li>div:first-child{margin-right:auto}.badge{border:1px solid var(--tk-border);border-radius:999px;color:var(--tk-muted);font-size:.75rem;padding:.2rem .5rem}.roles{grid-template-columns:minmax(180px,.7fr) minmax(0,1.3fr);margin-top:1rem}.roles>section{display:grid;align-content:start;gap:.45rem}.role{display:grid;text-align:left}.role.active{background:var(--tk-surface-2,var(--tk-surface));border-color:var(--tk-border-hi)}aside{border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);min-height:320px;padding:1rem}.member{align-items:center;border-top:1px solid var(--tk-border);display:flex;padding:.5rem 0}.notice{border-left:2px solid var(--tk-border-hi);padding:.75rem}.error{color:var(--tk-danger,#ff9b9b)}code{overflow-wrap:anywhere}@media(max-width:680px){.form,.roles{grid-template-columns:1fr}.inline{align-items:stretch;flex-direction:column}.inline>*{width:100%}}
</style>
