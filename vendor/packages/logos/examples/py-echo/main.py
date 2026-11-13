#!/usr/bin/env python3
"""
A Lógos process-module in Python.

Lógos spawns this file and speaks newline-delimited JSON on stdio. Each event
whose name matches one of the manifest's "events" patterns is delivered here;
we reply with a result that becomes the pipeline value on the runtime side.

From any package (JS):
    const out = await $('python:echo',  { text: 'hi' })   // -> { echo: 'hi' }
    const out = await $('python:upper', { text: 'hi' })   // -> { upper: 'HI' }

Protocol
--------
runtime -> child : {"op":"event","id":"..","event":"python:echo","payload":{..}}
child  -> runtime: {"op":"result","id":"..","payload":{..}}
                   {"op":"error","id":"..","message":".."}
                   {"op":"log","message":".."}
                   {"op":"emit","event":"..","payload":{..}}   # fire a bus event
                   {"op":"register","events":["python:*"]}      # add patterns
"""
import sys
import json


def log(message):
    sys.stdout.write(json.dumps({"op": "log", "message": message}) + "\n")
    sys.stdout.flush()


def handle(event, payload):
    """Return the payload to send back as the pipeline result."""
    payload = payload or {}
    if event == "python:echo":
        return {"echo": payload.get("text", "")}
    if event == "python:upper":
        return {"upper": str(payload.get("text", "")).upper()}
    # Unknown event within our namespace — echo the whole payload.
    return {"unhandled": event, "payload": payload}


def main():
    log("py-echo module ready")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        if msg.get("op") != "event":
            continue

        msg_id = msg.get("id")
        try:
            result = handle(msg.get("event"), msg.get("payload"))
            out = {"op": "result", "id": msg_id, "payload": result}
        except Exception as exc:  # noqa: BLE001
            out = {"op": "error", "id": msg_id, "message": str(exc)}

        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
