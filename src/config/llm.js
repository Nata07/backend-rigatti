const { OpenAIProvider } = require("../services/llm/OpenAIProvider");

function createLLMClient({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL } = {}) {
  return new OpenAIProvider({
    apiKey,
    model: model || "gpt-4o-mini",
  });
}

module.exports = {
  createLLMClient,
};
