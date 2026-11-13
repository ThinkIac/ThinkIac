const { getBattery, getSystemStatus } = require('.');

async function tool_getBattery() {
    /**
     * @register_tool get_battery
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

async function tool_getSystemStatus() {
    /**
     * @register_tool get_system_status
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
    tool_getBattery,
    tool_getSystemStatus
};