---
name: clarus-llm-setup
description: Start the local LLM server for the clarus explain step. Use when Dispatch Brief generation fails or when the explain stage is needed in the demo.
license: Apache-2.0
compatibility: Requires llama.cpp installed (brew install llama.cpp on macOS)
metadata:
  repo: clarus
---

```bash
cd scripts && ./run_llama.sh
```

Starts `llama-server` at `http://localhost:8080`.
Default model: `bartowski/Llama-3.2-3B-Instruct-GGUF`

Then pass `--llm-url http://localhost:8080` to `eds explain run`.
