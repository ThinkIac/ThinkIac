import { describe, expect, test } from "vitest";

import { createGestureRouter, installEdgeSwipeDetector } from "./bus.js";

function pointer(type, values) {
    const event = new Event(type);
    Object.assign(event, { pointerType: "touch", pointerId: 1, clientY: 120, ...values });
    return event;
}

function withDetector(openPanel = null) {
    const previousWindow = globalThis.window;
    globalThis.window = { innerWidth: 390, scrollY: 0 };
    const element = new EventTarget();
    const gestures = [];
    const dispose = installEdgeSwipeDetector(element, (gesture) => gestures.push(gesture), () => true, () => openPanel);
    return {
        element,
        gestures,
        dispose: () => { dispose(); globalThis.window = previousWindow; },
    };
}

describe("gestos de borda no navegador mobile", () => {
test("abre as duas gavetas por swipe de borda", () => {
    const left = withDetector();
    left.element.dispatchEvent(pointer("pointerdown", { clientX: 8 }));
    left.element.dispatchEvent(pointer("pointerup", { clientX: 86 }));
    expect(left.gestures.map((gesture) => [gesture.fromEdge, gesture.direction])).toEqual([["left", "right"]]);
    left.dispose();

    const right = withDetector();
    right.element.dispatchEvent(pointer("pointerdown", { clientX: 386 }));
    right.element.dispatchEvent(pointer("pointerup", { clientX: 300 }));
    expect(right.gestures.map((gesture) => [gesture.fromEdge, gesture.direction])).toEqual([["right", "left"]]);
    right.dispose();
});

test("fecha a gaveta aberta a partir de sua superfície, na direção correta", () => {
    const left = withDetector("left");
    left.element.dispatchEvent(pointer("pointerdown", { clientX: 180 }));
    left.element.dispatchEvent(pointer("pointerup", { clientX: 100 }));
    expect(left.gestures[0]?.direction).toBe("left");
    left.dispose();

    const right = withDetector("right");
    right.element.dispatchEvent(pointer("pointerdown", { clientX: 200 }));
    right.element.dispatchEvent(pointer("pointerup", { clientX: 280 }));
    expect(right.gestures[0]?.direction).toBe("right");
    right.dispose();
});

test("ignora gesto interno e na direção oposta", () => {
    const closed = withDetector();
    closed.element.dispatchEvent(pointer("pointerdown", { clientX: 160 }));
    closed.element.dispatchEvent(pointer("pointerup", { clientX: 80 }));
    expect(closed.gestures).toHaveLength(0);
    closed.dispose();

    const openLeft = withDetector("left");
    openLeft.element.dispatchEvent(pointer("pointerdown", { clientX: 120 }));
    openLeft.element.dispatchEvent(pointer("pointerup", { clientX: 205 }));
    expect(openLeft.gestures).toHaveLength(0);
    openLeft.dispose();
});

test("dá ao app registrado a chance de consumir antes do fallback do Shell", async () => {
    const router = createGestureRouter();
    const calls = [];
    router.register(() => { calls.push("shell"); return { handled: true }; }, { priority: 0 });
    router.register(() => { calls.push("app"); return { handled: true }; }, { priority: 100 });

    await expect(router.dispatch({ type: "swipe", direction: "right", fromEdge: "left" })).resolves.toEqual({ handled: true });
    expect(calls).toEqual(["app"]);
});
});
