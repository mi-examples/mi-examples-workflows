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

export const AI_PROVIDERS = [
  {
    name: 'openrouter',
    label: 'OpenRouter',
    keyEnv: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openai/gpt-5-mini',
    // Route only to endpoints whose providers don't store or train on the
    // prompts. OpenRouter itself doesn't log them unless the account opts in.
    body: { provider: { data_collection: 'deny' } },
  },
  {
    name: 'openai',
    label: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-5-mini',
  },
];

export function findProvider(name) {
  const provider = AI_PROVIDERS.find((candidate) => candidate.name === name);

  if (!provider) throw new Error(`unknown AI provider "${name}" (known: ${AI_PROVIDERS.map(({ name: known }) => known).join(', ')})`);

  return provider;
}
