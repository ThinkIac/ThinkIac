const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'providers.json');

const loadSettings = () => {
    /**
     * @register_hook load_settings
     */
    if (!fs.existsSync(CONFIG_PATH)) {
        const defaultConfig = { globalFailover: true, providers: [] };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
        return defaultConfig;
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
};

const saveSettings = (config) => {
    /**
     * @register_hook save_settings
     */
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
};

module.exports = {
    loadSettings,
    saveSettings
};