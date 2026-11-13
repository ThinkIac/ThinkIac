export const GROUP_LAYOUTS = {
    2: ["columns", "rows"],
    3: ["one-left", "one-right", "two-top", "two-bottom"],
    4: ["grid", "columns", "rows"],
};

export function normalizeTabOrder(order, tabs) {
    const ids = tabs.map((tab) => tab.sessionId);
    const known = new Set(ids);
    return [...(order || []).filter((id, index, all) => known.has(id) && all.indexOf(id) === index), ...ids.filter((id) => !order?.includes(id))];
}

export function normalizeTabGroups(groups, tabs) {
    const known = new Set(tabs.map((tab) => tab.sessionId));
    const claimed = new Set();
    return (groups || []).flatMap((group) => {
        const tabIds = (group.tabIds || []).filter((id) => known.has(id) && !claimed.has(id)).slice(0, 4);
        tabIds.forEach((id) => claimed.add(id));
        if (tabIds.length < 2) return [];
        const layouts = GROUP_LAYOUTS[tabIds.length];
        return [{ ...group, tabIds, name: group.name || "Grupo", layout: layouts.includes(group.layout) ? group.layout : layouts[0] }];
    });
}

export function moveTab(order, sourceId, targetId, after = false) {
    const next = order.filter((id) => id !== sourceId);
    const targetIndex = next.indexOf(targetId);
    if (targetIndex < 0) return [...next, sourceId];
    next.splice(targetIndex + (after ? 1 : 0), 0, sourceId);
    return next;
}

export function groupTab(groups, sourceId, targetId, createId) {
    if (sourceId === targetId) return { groups, groupId: null, rejected: true };
    const sourceGroup = groups.find((group) => group.tabIds.includes(sourceId));
    const targetGroup = groups.find((group) => group.tabIds.includes(targetId));
    if (sourceGroup && targetGroup && sourceGroup.id === targetGroup.id) return { groups, groupId: targetGroup.id, rejected: false };
    if (targetGroup && targetGroup.tabIds.length >= 4) return { groups, groupId: targetGroup.id, rejected: true };

    let next = groups.map((group) => ({ ...group, tabIds: group.tabIds.filter((id) => id !== sourceId) })).filter((group) => group.tabIds.length > 1);
    if (targetGroup) {
        next = next.map((group) => group.id === targetGroup.id
            ? { ...group, tabIds: [...group.tabIds, sourceId], layout: GROUP_LAYOUTS[group.tabIds.length + 1][0] }
            : group);
        return { groups: next, groupId: targetGroup.id, rejected: false };
    }
    const id = createId();
    return { groups: [...next, { id, name: "Novo grupo", tabIds: [targetId, sourceId], layout: "columns" }], groupId: id, rejected: false };
}

// Compatibility aliases for callers using the earlier member naming.
export const reorderTab = moveTab;
export function createOrExtendGroup(groups, sourceId, targetId, createId = () => `group-${Date.now()}`) {
    const normalized = (groups || []).map((group) => ({ ...group, tabIds: group.tabIds || group.members || [] }));
    const result = groupTab(normalized, sourceId, targetId, createId);
    return { ...result, groups: result.groups.map((group) => ({ ...group, members: group.tabIds })) };
}
export function removeTabFromGroups(groups, tabId) {
    return (groups || []).map((group) => ({ ...group, tabIds: (group.tabIds || group.members || []).filter((id) => id !== tabId) }))
        .filter((group) => group.tabIds.length > 1);
}
