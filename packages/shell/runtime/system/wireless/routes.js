const wifi = require('node-wifi');

wifi.init({ iface: null });

async function getCurrentConnection() {
    /**
     * @register_router wireless/current
     * @method GET
     */
    try {
        const connections = await wifi.getCurrentConnections();
        if (connections.length === 0) {
            return { connected: false, message: "No active Wi-Fi connection." };
        }

        const conn = connections[0];
        return {
            connected: true,
            ssid: conn.ssid,
            bssid: conn.bssid,
            signalLevel: conn.signal_level,
            quality: conn.quality,
            security: conn.security,
            channel: conn.channel
        };
    } catch (error) {
        console.error("Error fetching current connection:", error);
        throw error;
    }
}

async function scanAvailableNetworks() {
    /**
     * @register_router wireless/scan
     * @method GET
     */
    try {
        const networks = await wifi.scan();
        return networks.map(net => ({
            ssid: net.ssid,
            signal: net.signal_level,
            quality: net.quality,
            security: net.security,
            isOpen: net.security === 'none'
        }));
    } catch (error) {
        console.error("Error scanning networks:", error);
        throw error;
    }
}

async function connectToNetwork({ ssid, password }) {
    /**
     * @register_router connect
     * @method POST
     * @param {string} ssid - The name of the network.
     * @param {string} password - The network password.
     */
    try {
        await wifi.connect({ ssid, password });
        return { success: true, message: `Connected to ${ssid}` };
    } catch (error) {
        console.error("Connection failed:", error);
        return { success: false, message: "Authentication failed or network unreachable." };
    }
}

async function disconnectNetwork() {
    /**
     * @register_router wireless/disconnect
     * @method POST
     */
    try {
        await wifi.disconnect();

        return {
            success: true,
            message: "Disconnected successfully."
        };
    } catch (error) {
        console.error("Disconnection Error:", error);

        throw error;
    }
}

module.exports = {
    getCurrentConnection,
    scanAvailableNetworks,
    connectToNetwork,
    disconnectNetwork
};