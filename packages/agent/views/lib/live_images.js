const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
    v_uv = (a_position + 1.0) * 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;



const FRAGMENT_SHADER = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_time;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
        value += noise(p) * amplitude;
        p = p * 2.03 + vec2(11.7, 7.9);
        amplitude *= 0.5;
    }
    return value;
}
void main() {
    vec2 uv = v_uv;
    float t = u_time;
    vec2 fieldA = vec2(t * 0.071, -t * 0.043);
    vec2 fieldB = vec2(-t * 0.037, t * 0.059);
    float a = fbm(uv * vec2(5.7, 8.3) + fieldA);
    float b = fbm(uv.yx * vec2(9.1, 6.4) + fieldB + 17.0);
    float c = fbm(uv * vec2(3.2, 11.6) + vec2(t * 0.023, t * 0.031) + 31.0);

    // Bordas ficam estaveis e o centro recebe deslocamento muito sutil.
    float edge = smoothstep(0.0, 0.16, uv.x) * smoothstep(0.0, 0.16, uv.y)
               * smoothstep(0.0, 0.16, 1.0 - uv.x) * smoothstep(0.0, 0.16, 1.0 - uv.y);
    vec2 displacement = vec2(a - b, b - c) * 0.008 * edge;
    vec3 color = texture2D(u_texture, clamp(uv + displacement, 0.001, 0.999)).rgb;

    float light = (a * 0.55 + b * 0.30 + c * 0.15 - 0.5) * 0.075;
    color += vec3(light * 0.62, light * 0.76, light);
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || "Falha ao compilar shader");
    }
    return shader;
}

function createRenderer(image, canvas) {
    const gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        powerPreference: "low-power",
    });
    if (!gl) throw new Error("WebGL indisponivel");

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "Falha ao ligar shader");
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0);
    const time = gl.getUniformLocation(program, "u_time");

    const sourceWidth = image.naturalWidth || 1;
    const sourceHeight = image.naturalHeight || 1;
    const scale = Math.min(1, 960 / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);

    return {
        draw(seconds) {
            gl.uniform1f(time, seconds);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        },
        destroy() {
            gl.deleteTexture(texture);
            gl.deleteBuffer(buffer);
            gl.deleteProgram(program);
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        },
    };
}

function enhanceImage(image) {
    if (image.dataset.liveImageReady) return () => {};
    image.dataset.liveImageReady = "true";

    let frame = 0;
    let renderer = null;
    let visible = true;
    let stopped = false;
    const canvas = document.createElement("canvas");
    canvas.className = "live-image-canvas";
    canvas.setAttribute("aria-hidden", "true");

    const render = (now) => {
        if (stopped) return;
        if (visible && !document.hidden) renderer?.draw(now / 1000);
        frame = requestAnimationFrame(render);
    };
    const start = () => {
        if (stopped || renderer) return;
        try {
            renderer = createRenderer(image, canvas);
            image.insertAdjacentElement("afterend", canvas);
            image.classList.add("live-image-source");
            frame = requestAnimationFrame(render);
        } catch {
            canvas.remove();
            image.classList.remove("live-image-source");
        }
    };

    const intersection = typeof IntersectionObserver === "function"
        ? new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting !== false; }, { rootMargin: "120px" })
        : null;
    intersection?.observe(image);
    if (image.complete && image.naturalWidth) start();
    else image.addEventListener("load", start, { once: true });

    return () => {
        stopped = true;
        cancelAnimationFrame(frame);
        intersection?.disconnect();
        image.removeEventListener("load", start);
        renderer?.destroy();
        canvas.remove();
        image.classList.remove("live-image-source");
        delete image.dataset.liveImageReady;
    };
}

export function enhanceLiveImages(node) {
    if (typeof window === "undefined" || typeof document === "undefined") return {};
    const cleanups = new Map();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    const scan = () => {
        if (reduceMotion?.matches) return;
        for (const image of node.querySelectorAll('img[data-live-image="true"]')) {
            if (!cleanups.has(image)) cleanups.set(image, enhanceImage(image));
        }
        for (const [image, cleanup] of cleanups) {
            if (!node.contains(image)) {
                cleanup();
                cleanups.delete(image);
            }
        }
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(node, { childList: true, subtree: true });

    return {
        destroy() {
            observer.disconnect();
            for (const cleanup of cleanups.values()) cleanup();
            cleanups.clear();
        },
    };
}
