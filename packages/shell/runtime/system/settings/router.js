const {
    addProvider,
    getProviders,
    editProvider,
    removeProvider,
    setFailover
} = require(".");

async function router_addProvider(ctx) {
    /**
     * @register_router settings/providers
     * @method POST
     */

    try {
        const newProvider = ctx.body;

        return await addProvider(newProvider);
    } catch (error) {
        return {
            success: false,
            message: "Failed to add provider.",
            error: error.message
        };
    }
}

async function router_getProviders() {
    /**
     * @register_router settings/providers
     * @method GET
     */

    try {
        return await getProviders();
    } catch (error) {
        return {
            success: false,
            message: "Failed to retrieve providers.",
            error: error.message
        };
    }
}

async function router_editProvider(ctx) {
    /**
     * @register_router settings/providers/:name
     * @method PUT
     */
    try {
        const updates = ctx.body;
        const { name } = ctx.params;

        return await editProvider(name, updates);
    } catch (error) {
        return {
            success: false,
            message: "Failed to edit provider.",
            error: error.message
        };
    }
}

async function router_removeProvider(ctx) {
    /**
     * @register_router settings/providers/:name
     * @method DELETE
     */
    try {
        const { name } = ctx.params;

        return await removeProvider(name);
    } catch (error) {
        return {
            success: false,
            message: "Failed to remove provider.",
            error: error.message
        };
    }
}

async function router_setFailover(ctx) {
    /**
     * @register_router settings/failover
     * @method PATCH
     */
    try {
        await setFailover(ctx.body.status);

        return {
            success: true,
            globalFailover: config.globalFailover
        };
    } catch (error) {
        return {
            success: false,
            message: "Failed to update failover status.",
            error: error.message
        };
    }
}

module.exports = {
    router_addProvider,
    router_getProviders,
    router_editProvider,
    router_removeProvider,
    router_setFailover
};