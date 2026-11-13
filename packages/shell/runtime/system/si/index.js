const si = require('systeminformation');

async function getBattery() {
    /**
     * @register_hook aura:system:battery
     */

    try {
        const battery = await si.battery();

        const isLaptop = battery.hasBattery;

        const details = {
            isLaptop: isLaptop,
            batteryLevel: isLaptop ? `${battery.percent}%` : 'N/A',
            isCharging: battery.isCharging,
            status: isLaptop ? (battery.isCharging ? 'Charging' : 'Discharging') : 'No battery detected',
            acConnected: battery.acConnected,
            health: isLaptop ? `${battery.capacityUnit} ${battery.capacity}` : 'N/A',
            cycleCount: battery.cycleCount || 0,
            estimatedTimeLeft: battery.timeremaining ? `${battery.timeremaining} mins` : 'Calculating...'
        };

        return details;
    } catch (error) {
        throw new Error("Could not retrieve battery telemetry.");
    }
}

async function getSystemStatus() {
    /**
     * @register_hook aura:system:status
     */
    try {
        const [cpu, mem, memLayout, fsSize, graphics, os] = await Promise.all([
            si.cpu(),
            si.mem(),
            si.memLayout(),
            si.fsSize(),
            si.graphics(),
            si.osInfo()
        ]);

        const mainDisk = fsSize && fsSize.length > 0 ? fsSize[0] : { used: 0, size: 0, use: 0 };

        const primaryGPU = (graphics.controllers && graphics.controllers.length > 0)
            ? graphics.controllers[0]
            : null;

        const systemData = {
            neuralEngine: {
                selected: "Auto Select (Dynamic)",
                optimizedFor: cpu.brand || 'Unknown Processor'
            },
            hardware: {
                chipset: cpu.brand || 'Unknown',
                arch: os.arch || 'N/A',
                memory: {
                    size: `${Math.round((mem.total || 0) / 1024 ** 3)}GB`,
                    type: memLayout[0]?.type || 'DDR4',
                    clockSpeed: `${memLayout[0]?.clockSpeed || 0}MHz`
                }
            },
            graphics: {
                model: primaryGPU?.model || 'Integrated Graphics',
                vendor: primaryGPU?.vendor || 'Generic',
                vram: primaryGPU?.vram ? `${primaryGPU.vram}MB` : 'Dynamic',
                bus: primaryGPU?.bus || 'Onboard'
            },
            storage: {
                used: `${Math.round((mainDisk.used || 0) / 1024 ** 3)}GB`,
                total: `${Math.round((mainDisk.size || 0) / 1024 ** 3)}GB`,
                percentage: mainDisk.use ? parseFloat(mainDisk.use.toFixed(2)) : 0
            },
            os: {
                platform: os.platform,
                distro: os.distro,
                release: os.release
            }
        };

        return systemData;
    } catch (error) {
        throw new Error("Could not retrieve system information");
    }
}

module.exports = {
    getBattery,
    getSystemStatus
};