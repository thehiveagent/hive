# Providers

Hive supports multiple providers for chat completions:

- OpenAI (`openai`)
- Anthropic (`anthropic`)
- Google (`google`)
- Ollama (`ollama`)
- Groq (`groq`)
- Mistral (`mistral`)
- OpenRouter (`openrouter`)
- Together (`together`)

## How Hive stores keys and settings

- Interactive setup (`hive init`, `hive config ...`) stores API keys in your OS keychain under service name `hive` and account name matching the provider (e.g. `openai`).
- Providers also read API keys from environment variables (listed per provider below).
- Models and base URLs can be overridden via environment variables (listed per provider below) or via `hive config model`.

## OpenAI

- API key env var: `OPENAI_API_KEY` (get a key from https://platform.openai.com/api-keys)
- Base URL env var: `OPENAI_BASE_URL` (default: `https://api.openai.com/v1`)
- Model env var: `OPENAI_MODEL` (default: `gpt-4o-mini`)
- Notes: Uses the OpenAI Chat Completions API. Supports Hive’s automatic `web_search` tool calls.

## Anthropic

- API key env var: `ANTHROPIC_API_KEY` (get a key from https://console.anthropic.com/)
- Model env var: `ANTHROPIC_MODEL` (default: `claude-3-5-haiku-latest`)
- Notes: Uses the `https://api.anthropic.com/v1/messages` streaming endpoint with `anthropic-version: 2023-06-01`. This provider implementation does not expose tool-calling, so Hive’s automatic `web_search` tool calls are unavailable (you can still use `/search` and `/browse` in chat).

## Google

- API key env var: `GOOGLE_API_KEY` (get a key from https://aistudio.google.com/app/apikey)
- Base URL env var: `GOOGLE_BASE_URL` (default: `https://generativelanguage.googleapis.com/v1beta/openai`)
- Model env var: `GOOGLE_MODEL`
  - Default in provider config: `gemini-3.0-flash`
  - Default used elsewhere in Hive: `gemini-2.0-flash`
- Notes: Uses Google’s OpenAI-compatible endpoint. Supports Hive’s automatic `web_search` tool calls.

## Ollama

- API key env var: `OLLAMA_API_KEY` (optional)
- Base URL env var: `OLLAMA_BASE_URL` (default: `http://localhost:11434/v1`)
- Model env var: `OLLAMA_MODEL` (default: `llama3.2`)
- Notes: Intended for local models via an Ollama server. API key is not required. **Tool calling is currently disabled for Ollama due to formatting issues (will be fixed in a future version)**.

## Groq

- API key env var: `GROQ_API_KEY` (get a key from https://console.groq.com/)
- Base URL env var: `GROQ_BASE_URL` (default: `https://api.groq.com/openai/v1`)
- Model env var: `GROQ_MODEL` (default: `llama-3.3-70b-versatile`)
- Notes: Uses Groq’s OpenAI-compatible API. **Tool calling is currently disabled for Groq due to formatting issues (will be fixed in a future version)**.

## Mistral

- API key env var: `MISTRAL_API_KEY` (get a key from https://console.mistral.ai/)
- Base URL env var: `MISTRAL_BASE_URL` (default: `https://api.mistral.ai/v1`)
- Model env var: `MISTRAL_MODEL` (default: `mistral-small-latest`)
- Notes: Uses Mistral’s OpenAI-compatible API. Supports Hive’s automatic `web_search` tool calls.

## OpenRouter

- API key env var: `OPENROUTER_API_KEY` (get a key from https://openrouter.ai/keys)
- Base URL env var: `OPENROUTER_BASE_URL` (default: `https://openrouter.ai/api/v1`)
- Model env var: `OPENROUTER_MODEL` (default: `openai/gpt-4o-mini`)
- Notes: Uses OpenRouter’s OpenAI-compatible API. Supports Hive’s automatic `web_search` tool calls.

## Together

- API key env var: `TOGETHER_API_KEY` (get a key from https://api.together.xyz/)
- Base URL env var: `TOGETHER_BASE_URL` (default: `https://api.together.xyz/v1`)
- Model env var: `TOGETHER_MODEL` (default: `meta-llama/Llama-3.3-70B-Instruct-Turbo`)
- Notes: Uses Together’s OpenAI-compatible API. Supports Hive’s automatic `web_search` tool calls.
