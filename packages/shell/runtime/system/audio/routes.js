const { getVolumeStatus, listAudioDevices, switchAudioDevice } = require('.');

async function router_getAudioStatus() {
    /**
     * @register_router audio/status
     * @method GET
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

async function router_setSystemVolume(req, res, ctx) {
    /**
     * @register_router audio/volume
     * @method POST
     */

    try {
        const { level } = req.body || {};

        await setSystemVolume(level);
    } catch (error) {
        return {
            error: error.message,
            status: 403
        };
    }
}

async function router_listAudioDevices() {
    /**
     * @register_router audio/devices
     * @method GET
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

async function router_switchAudioDevice(req, res, ctx) {
    /**
     * @register_router audio/switch
     * @method PATCH
     */
    try {
        const { deviceId } = req.body || {};
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
    router_getAudioStatus,
    router_setSystemVolume,
    router_listAudioDevices,
    router_switchAudioDevice
};

