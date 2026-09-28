// Which AI provider and model write the release notes, for every package
// repository at once. Package repositories pass the API keys and nothing else;
// to switch the provider or the model, change this file and release this
// repository. Drift sync and Dependabot then move the callers to that release.
//
// Providers are tried in this order. A provider is skipped when its key isn't
// set, and the next one is tried when its call fails. Only when every provider
// is skipped or has failed do the notes come from GitHub.
//
// Both providers speak the OpenAI Chat Completions API.
//
// The models were chosen by comparing eight models on real releases of the
// package repositories (2026-09-25). Claude Opus 5.5 wrote the most accurate,
// user-focused notes and Sonnet 5 came close; gpt-5-mini, the earlier
// default, described implementation details and labelled internal CI changes
// as breaking.

export const AI_PROVIDERS = [
  {
    name: 'openrouter',
    label: 'OpenRouter',
    keyEnv: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'anthropic/claude-opus-5.5',
    // Sent as OpenRouter's `models` list: when the first model is down, rate
    // limited or rejects the request, OpenRouter answers with the next one.
    fallbackModels: ['anthropic/claude-sonnet-5'],
    // Route only to endpoints whose providers don't store or train on the
    // prompts. OpenRouter itself doesn't log them unless the account opts in.
    body: { provider: { data_collection: 'deny' } },
  },
  {
    name: 'openai',
    label: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-6-luna',
  },
];

export function findProvider(name) {
  const provider = AI_PROVIDERS.find((candidate) => candidate.name === name);

  if (!provider) throw new Error(`unknown AI provider "${name}" (known: ${AI_PROVIDERS.map(({ name: known }) => known).join(', ')})`);

  return provider;
}
