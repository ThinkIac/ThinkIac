const {
    getVolumeStatus,
    listAudioDevices,
    switchAudioDevice
} = require('.');

async function tool_getAudioStatus() {
    /**
     * @register_tool getAudioStatus
     * @description Get the current audio volume and mute status
     */
    try {
        return await getVolumeStatus();
    } catch (error) {
        return {
            error: error.message,
            status: 403
        };
    }
}

async function tool_setSystemVolume(ctx) {
    /**
     * @register_tool setSystemVolume
     * @description Set the system audio volume to a specific level (0-100)
     * @param {number} level - The desired volume level (0-100)
     */

    try {
        const { level } = ctx || {};

        await setSystemVolume(level);
    } catch (error) {
        return {
            error: error.message,
            status: 403
        };
    }
}

async function tool_listAudioDevices() {
    /**
     * @register_tool listAudioDevices
     * @description List all available audio devices
     */
    try {
        return await listAudioDevices();
    } catch (error) {
        return {
            error: error.message,
            status: 403
        };
    }
}

async function tool_switchAudioDevice(ctx) {
    /**
     * @register_tool switchAudioDevice
     * @description Switch the active audio device
     * @param {string} deviceId - The ID of the device to switch to
     */
    try {
        const { deviceId } = ctx || {};
        await switchAudioDevice(deviceId);

        return { success: true, switchedTo: deviceId };
    } catch (error) {
        return {
            error: error.message,
            status: 403
        };
    }
}

module.exports = {
    tool_getAudioStatus,
    tool_setSystemVolume,
    tool_listAudioDevices,
    tool_switchAudioDevice
};

