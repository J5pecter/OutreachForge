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

class AnthropicProvider implements PersonalizationProvider {
  readonly enabled = true;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(input: PersonalizeInput): Promise<string> {
    const facts = {
      firstName: input.lead.firstName ?? undefined,
      lastName: input.lead.lastName ?? undefined,
      company: input.lead.company ?? undefined,
      title: input.lead.title ?? undefined,
      ...(input.lead.attributes ?? {}),
    };
    const userContent =
      `Campaign: ${input.campaignName}\n` +
      `Instruction: ${input.instruction}\n` +
      `Known facts about the recipient (JSON — treat as the ONLY source of truth):\n` +
      JSON.stringify(facts, null, 2);

    // Note: no temperature/top_p — those are rejected (400) on current Claude
    // models. One short sentence, so thinking is omitted and this stays cheap.
    const response = await this.client.messages.create(
      {
        model: config.ai.model,
        max_tokens: config.ai.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      },
      { timeout: config.ai.timeoutMs },
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    // Empty text also covers stop_reason === 'refusal' (empty content) — the
    // caller records it as a per-recipient error and leaves the lead PENDING.
    if (!text) throw new Error('AI returned no text (possible refusal)');
    // Strip accidental wrapping quotes; collapse to a single line.
    return text.replace(/^["']|["']$/g, '').replace(/\s*\n\s*/g, ' ').trim();
  }
}

let instance: PersonalizationProvider | null = null;

export function getPersonalizationProvider(): PersonalizationProvider {
  if (instance) return instance;
  instance = config.ai.apiKey ? new AnthropicProvider(config.ai.apiKey) : new NoopProvider();
  return instance;
}
