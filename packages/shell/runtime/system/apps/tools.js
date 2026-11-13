const { getActiveApps } = require(".");

async function tool_getActiveApps() {
    /**
     * @register_tool getActiveApps
     * @description Get a list of active apps (Docker Containers)
     */
    try {
        return await getActiveApps();
    } catch (error) {
        return {
            error: "Failed to retrieve active apps",
            details: error.message
        }
    }
}

module.exports = { tool_getActiveApps };