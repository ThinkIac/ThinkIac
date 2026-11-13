// system-monitor — pacote de teste independente para o registro de itens de
// menu via manifest.menu (ver views/lib/menu_bootstrap.js no agent). Expõe
// um único endpoint com uso ao vivo de CPU/memória/disco/rede.
import si from "systeminformation";

const VIRTUAL_FILESYSTEMS = new Set(["tmpfs", "devtmpfs", "proc", "sysfs", "cgroup", "cgroup2", "overlay"]);
const VIRTUAL_INTERFACES = /^(?:lo|docker\d*|br-|veth|virbr|tun\d*|tap\d*)$/i;

export function primaryDisk(filesystems = []) {
    const usable = filesystems.filter((disk) => {
        const size = Number(disk?.size) || 0;
        return size > 0 && !VIRTUAL_FILESYSTEMS.has(String(disk?.type || "").toLowerCase());
    });
    // Android and containers often list pseudo volumes before the data volume.
    // The largest usable filesystem is the most useful capacity indicator.
    return usable.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))[0]
        || filesystems.find((disk) => (Number(disk?.size) || 0) > 0)
        || { used: 0, size: 0, use: 0 };
}

export function networkRates(interfaces = []) {
    const physical = interfaces.filter((net) => !VIRTUAL_INTERFACES.test(String(net?.iface || net?.ifaceName || "")));
    const source = physical.length > 0 ? physical : interfaces;
    return source.reduce((total, net) => ({
        rxKBs: total.rxKBs + (Number(net?.rx_sec) || 0) / 1024,
        txKBs: total.txKBs + (Number(net?.tx_sec) || 0) / 1024,
    }), { rxKBs: 0, txKBs: 0 });
}

export function summarizeStats({ load = {}, mem = {}, fsSize = [], netStats = [] } = {}) {
    const disk = primaryDisk(fsSize);
    const net = networkRates(netStats);
    const memUsed = mem.active ?? mem.used ?? 0;
    return {
        cpu: { pct: Math.round(load.currentLoad || 0) },
        mem: {
            pct: mem.total ? Math.round((memUsed / mem.total) * 100) : 0,
            usedGB: +(memUsed / 1024 ** 3).toFixed(1),
            totalGB: +(mem.total / 1024 ** 3).toFixed(1),
        },
        disk: {
            pct: Math.round(disk.use || 0),
            usedGB: +((Number(disk.used) || 0) / 1024 ** 3).toFixed(1),
            totalGB: +((Number(disk.size) || 0) / 1024 ** 3).toFixed(1),
        },
        net: {
            rxKBs: +net.rxKBs.toFixed(1),
            txKBs: +net.txKBs.toFixed(1),
        },
        at: Date.now(),
    };
}

async function collectStats() {
    try {
        const [load, mem, fsSize, netStats] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.fsSize(),
            si.networkStats(),
        ]);

        return summarizeStats({ load, mem, fsSize, netStats });
    } catch (error) {
        return { error: error.message };
    }
}

export async function getStats() {
    /**
     * @register_router stats
     * @method GET
     */
    return collectStats();
}

export async function getSystemStats() {
    /**
     * @register_tool getSystemStats
     * @description Lê o uso atual de CPU, memória, armazenamento e rede. Útil para automações de monitoramento.
     */
    return collectStats();
}
