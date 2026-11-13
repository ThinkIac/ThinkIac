const {
    addProvider,
    getProviders,
    editProvider,
    removeProvider,
    setFailover
} = require(".");

async function tool_addProvider({ newProvider }) {
    /**
     * @register_tool add_provider
     * @description Add a new provider to the system settings.
     * @param {Object} newProvider - The provider configuration to add.
     * @param {string} newProvider.name - The name of the provider.
     * @param {string} newProvider.type - The type of the provider (e.g., "openrouter", "custom").
     * @param {string} newProvider.baseUrl - The base URL for the provider's API.
     * @param {boolean?} newProvider.noKeys - Whether the provider requires API keys.
     * @param {array?} newProvider.apiKeys - An array of API keys for the provider (if applicable).
     * @param {boolean?} newProvider.errorPooling - Whether to enable error pooling for this provider.
     * @param {string} newProvider.selectedModel - The default model to use with this provider.
     */

    try {
        return await addProvider(newProvider);
    } catch (error) {
        return {
            success: false,
            message: "Failed to add provider via tool.",
            error: error.message
        };
    }
}

async function tool_getProviders() {
    /**
     * @register_tool get_providers
     * @description Retrieve the list of all configured providers.
     */

    try {
        return await getProviders();
    } catch (error) {
        return {
            success: false,
            message: "Failed to retrieve providers via tool.",
            error: error.message
        };
    }
}

async function tool_editProvider({ name, updates }) {
    /**
     * @register_tool edit_provider
     * @description Edit an existing provider's configuration.
     * @param {string} name - The name of the provider to edit.
     * @param {object} updates - The fields to update for the provider.
     * @param {string?} updates.baseUrl - The new base URL for the provider's API.
     * @param {boolean?} updates.noKeys - Whether the provider requires API keys.
     * @param {array?} updates.apiKeys - An array of API keys for the provider (if applicable).
     * @param {boolean?} updates.errorPooling - Whether to enable error pooling for this provider.
     * @param {string?} updates.selectedModel - The default model to use with this provider.
     */

    try {
        return await editProvider(name, updates);
    } catch (error) {
        return {
            success: false,
            message: "Failed to edit provider via tool.",
            error: error.message
        };
    }
}

async function tool_removeProvider({ name }) {
    /**
     * @register_tool remove_provider
     * @description Remove a provider from the system settings.
     * @param {string} name - The name of the provider to remove.
     */
    try {
        return await removeProvider(name);
    } catch (error) {
        return {
            success: false,
            message: "Failed to remove provider via tool.",
            error: error.message
        };
    }
}

async function tool_setFailover({ status }) {
    /**
     * @register_tool set_failover
     * @description Enable or disable global failover mode.
     * @param {boolean} status - The desired status of global failover (true to enable, false to disable).
     */
    try {
        return await setFailover(status);
    } catch (error) {
        return {
            success: false,
            message: "Failed to set failover via tool.",
            error: error.message
        };
    }
}

module.exports = {
    tool_addProvider,
    tool_getProviders,
    tool_editProvider,
    tool_removeProvider,
    tool_setFailover
};