import assert from "node:assert/strict";
import test from "node:test";
import { primaryDisk, summarizeStats } from "../index.js";

test("seleciona armazenamento útil depois de volumes virtuais", () => {
    const disk = primaryDisk([
        { type: "tmpfs", size: 12 * 1024 ** 3, used: 1 },
        { type: "ext4", size: 128 * 1024 ** 3, used: 32 * 1024 ** 3, use: 25 },
    ]);
    assert.equal(disk.type, "ext4");
});

test("agrega rede real e ignora loopback", () => {
    const stats = summarizeStats({
        fsSize: [{ type: "ext4", size: 64 * 1024 ** 3, used: 16 * 1024 ** 3, use: 25 }],
        netStats: [
            { iface: "lo", rx_sec: 9000, tx_sec: 7000 },
            { iface: "wlan0", rx_sec: 2048, tx_sec: 1024 },
            { iface: "rmnet0", rx_sec: 3072, tx_sec: 2048 },
        ],
    });
    assert.equal(stats.net.rxKBs, 5);
    assert.equal(stats.net.txKBs, 3);
    assert.equal(stats.disk.totalGB, 64);
});
