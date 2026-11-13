const { getBattery, getSystemStatus } = require('.');

async function router_getBattery() {
    /**
     * @register_router si/battery
     * @method GET
     */

    try {
        return await getBattery();
    } catch (error) {
        return {
            success: false,
            message: "Failed to retrieve battery information.",
            error: error.message
        };
    }
}

async function router_getSystemStatus() {
    /**
     * @register_router si/system-status
     * @method GET
     */
    try {
        return await getSystemStatus();
    } catch (error) {
        return {
            success: false,
            message: "Failed to retrieve system status information.",
            error: error.message
        };
    }
}

module.exports = {
    router_getBattery,
    router_getSystemStatus
};