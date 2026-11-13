const loudness = require('loudness');
const { exec } = require('child_process');
const util = require('util');

const { dispatchEvent: $ } = require('logos');
const execPromise = util.promisify(exec);

async function getVolumeStatus() {
    /**
     * @register_hook getVolumeStatus
     */
    try {
        const volume = await loudness.getVolume();
        const muted = await loudness.getMuted();
        
        return {
            currentVolume: volume,
            isMuted: muted
        };
    } catch (error) {
        $('aura:log', {
            level: 'error',
            message: `Audio Status Error: ${error.message}`
        });

        throw new Error("Audio backend (amixer/pactl) not found. Install alsa-utils.");
    }
}

async function setSystemVolume(level) {
    /**
     * @register_hook setSystemVolume
     */
    try {
        await loudness.setVolume(level);
        return { success: true, volume: level };
    } catch (error) {
        console.error("Set Volume Error:", error);
        $('aura:log', {
            level: 'error',
            message: `Set Volume Error: ${error.message}`
        });

        throw error;
    }
}

async function listAudioDevices() {
    /**
     * @register_hook listAudioDevices
     */
    try {
        let command = "";
        if (process.platform === 'win32') {
            command = `powershell "Get-AudioDevice -List | Where-Object { $_.Type -eq 'Playback' } | Select-Object Name, Index, Default"`;
        } else {
            command = `pactl list short sinks`;
        }

        const { stdout } = await execPromise(command);
        
        return {
            platform: process.platform,
            devices: stdout.trim() || "No devices detected."
        };
    } catch (error) {
        $('aura:log', {
            level: 'error',
            message: `List Devices Error: ${error.message}`
        });

        throw new Error("Required tool (pactl or PowerShell) is missing.");
    }
}

async function switchAudioDevice(deviceId) {
    /**
     * @register_hook switchAudioDevice
     */
    try {
        let command = "";
        
        if (process.platform === 'win32') {
            command = `powershell "Set-AudioDevice -Index ${deviceId}"`;
        } else {
            command = `pactl set-default-sink ${deviceId}`;
        }

        await execPromise(command);
        return {
            success: true,
            activeDevice: deviceId
        };
    } catch (error) {
        $('aura:log', {
            level: 'error',
            message: `Switch Audio Device Error: ${error.message}`
        });

        throw new Error("Failed to switch audio device.");
    }
}

module.exports = {
    getVolumeStatus,
    setSystemVolume,
    listAudioDevices,
    switchAudioDevice
};
