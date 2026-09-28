"""Manual model probe; uses synthetic history, never runs model-proposed tools.

Run explicitly with --run. This measures model output, not guest integration.
"""
import ast
import json
import pathlib
import sys
import time
import urllib.request

from persistent_runtime import build_model_messages, normalize_model_response


def main():
    if sys.argv[1:] != ["--run"]:
        raise SystemExit("Pass --run to query the locally installed qwen3.5:2b model.")
    source = ast.parse(pathlib.Path(__file__).with_name("agent.py").read_text(encoding="utf8"))
    bootstrap = next(ast.literal_eval(n.value) for n in source.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "BOOTSTRAP" for t in n.targets))
    refusal = "I don't have access to that previous conversation; my memory is limited to our current session."
    history = [{"role": "user", "content": "Where do you operate?"}, {"role": "assistant", "content": refusal}] * 3
    cases = [
        ("environment", "Are you aware you are in a virtual machine, with access to it? What can you actually do?", history, ""),
        ("recall", "What is the name of my small test project?", history, "James named the test project Copper Finch. It is stored in projects/copper-finch.md."),
        ("inspect", "Inspect your actual projects directory and tell me what is there. Use your tool.", history, ""),
        ("write", "Create projects/hello.py containing Python that prints hello from Debian. Run it and tell me the actual output.", [], ""),
    ]
    for name, request, chat, memory in cases:
        messages = build_model_messages(bootstrap, {"chatHistory": chat, "memorySummary": memory, "goals": []}, request, "", "", [], "no game")
        payload = {"model": "qwen3.5:2b", "messages": messages, "stream": False, "think": False, "format": "json", "options": {"num_predict": 512, "temperature": 0}}
        started = time.monotonic()
        req = urllib.request.Request("http://127.0.0.1:11434/api/chat", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=125) as response:
            value = json.load(response)
        print(json.dumps({"case": name, "seconds": round(time.monotonic()-started, 1), "finish": value.get("done_reason"), "result": normalize_model_response(value["message"]["content"])}, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
