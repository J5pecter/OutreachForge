import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';

export type LeadContext = {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  attributes?: Record<string, unknown>;
};

export type PersonalizeInput = {
  instruction: string; // operator's guidance for what the sentence should say
  lead: LeadContext;
  campaignName: string;
};

export interface PersonalizationProvider {
  readonly enabled: boolean;
  generate(input: PersonalizeInput): Promise<string>;
}

// The guardrails that keep this honest rather than spammy: use only supplied
// facts, never invent, one plain sentence, no filler. Uniqueness here is a
// byproduct of real personalization — it is explicitly NOT a spam-evasion knob.
const SYSTEM_PROMPT = [
  'You write a single, honest personalization sentence for the top of an outreach email.',
  'Hard rules:',
  '- Use ONLY the facts provided about the recipient. Never invent facts, numbers, mutual connections, recent events, or achievements.',
  '- If the provided facts are thin, write a brief, neutral sentence relevant to their role or industry rather than fabricating specifics.',
  '- Output exactly ONE sentence, plain text. No greeting, no sign-off, no surrounding quotes, no emojis.',
  '- Keep it under 30 words and sound like a real person, not marketing copy.',
  '- Do not include the recipient\'s email address or any tracking text.',
].join('\n');

class NoopProvider implements PersonalizationProvider {
  readonly enabled = false;
  async generate(): Promise<string> {
    return '';
  }
}

// Same prompt body for every provider: only the supplied facts, one sentence.
function buildUserContent(input: PersonalizeInput): string {
  const facts = {
    firstName: input.lead.firstName ?? undefined,
    lastName: input.lead.lastName ?? undefined,
    company: input.lead.company ?? undefined,
    title: input.lead.title ?? undefined,
    ...(input.lead.attributes ?? {}),
  };
  return (
    `Campaign: ${input.campaignName}\n` +
    `Instruction: ${input.instruction}\n` +
    `Known facts about the recipient (JSON — treat as the ONLY source of truth):\n` +
    JSON.stringify(facts, null, 2)
  );
}

// Clean up model output: strip wrapping quotes, collapse to one line.
function tidy(text: string): string {
  const t = text.trim();
  if (!t) throw new Error('AI returned no text (possible refusal / blocked)');
  return t.replace(/^["']|["']$/g, '').replace(/\s*\n\s*/g, ' ').trim();
}

class AnthropicProvider implements PersonalizationProvider {
  readonly enabled = true;
  private client: Anthropic;
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(input: PersonalizeInput): Promise<string> {
    // No temperature/top_p — rejected (400) on current Claude models.
    const response = await this.client.messages.create(
      {
        model: config.ai.model || 'claude-opus-4-8',
        max_tokens: config.ai.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserContent(input) }],
      },
      { timeout: config.ai.timeoutMs },
    );
    return tidy(
      response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(''),
    );
  }
}

// Google Gemini via the free-tier Generative Language REST API (no SDK needed).
// Get a free key at https://aistudio.google.com/apikey — no card required.
class GeminiProvider implements PersonalizationProvider {
  readonly enabled = true;
  constructor(private apiKey: string) {}

  async generate(input: PersonalizeInput): Promise<string> {
    const model = config.ai.model || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: buildUserContent(input) }] }],
          generationConfig: { maxOutputTokens: config.ai.maxTokens, temperature: 0.4 },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Gemini API ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('');
      return tidy(text);
    } finally {
      clearTimeout(timer);
    }
  }
}

let instance: PersonalizationProvider | null = null;

export function getPersonalizationProvider(): PersonalizationProvider {
  if (instance) return instance;
  if (config.ai.provider === 'gemini') instance = new GeminiProvider(config.ai.geminiKey);
  else if (config.ai.provider === 'anthropic') instance = new AnthropicProvider(config.ai.anthropicKey);
  else instance = new NoopProvider();
  return instance;
}
