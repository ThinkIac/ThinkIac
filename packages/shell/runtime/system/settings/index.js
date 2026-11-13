const { dispatchEvent: $ } = require('logos');

async function addProvider(newProvider) {
    /**
     * @register_hook aura:add_provider
     */
    try {
        const config = await $('load_settings');
        config.providers.push(newProvider);

        await $('save_settings', config);

        return {
            success: true,
            message: "New provider added.",
            data: newProvider
        };
    } catch (error) {
        return {
            success: false,
            message: "Failed to add provider.",
            error: error.message
        };
    }
}

async function getProviders() {
    /**
     * @register_hook aura:get_providers
     */
    try {
        const config = await $('load_settings');
        return {
            success: true,
            providers: config.providers
        };
    } catch (error) {
        return {
            success: false,
            message: "Failed to retrieve providers.",
            error: error.message
        };
    }
}

async function editProvider(name, updates) {
    /**
     * @register_hook aura:edit_provider
     */
    const config = await $('load_settings');
    const index = config.providers.findIndex(p => p.name === name);

    if (index !== -1) {
        config.providers[index] = { ...config.providers[index], ...updates };
        await $('save_settings', config);
        return { success: true, message: "Configurations updated." };
    }

    return { success: false, message: "Provider not found." };
}

async function removeProvider(name) {
    /**
     * @register_hook aura:remove_provider
     */
    const config = await $('load_settings');
    const initialLength = config.providers.length;

    config.providers = config.providers.filter(p => p.name !== name);

    if (config.providers.length < initialLength) {
        await $('save_settings', config);
        return { success: true, message: `Provider '${name}' removed.` };
    }

    return { success: false, message: "No provider found for removal." };
}

async function setFailover(status) {
    /**
     * @register_hook aura:set_failover
     */
    const config = await $('load_settings');
    config.globalFailover = !!status;
    await $('save_settings', config);

    return {
        success: true,
        globalFailover: config.globalFailover
    };
}

module.exports = {
    addProvider,
    getProviders,
    editProvider,
    removeProvider,
    setFailover
};
