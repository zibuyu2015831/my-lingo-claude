const LANG_CODE_TO_NAME = {
  en: 'English', ja: 'Japanese', de: 'German', fr: 'French',
  ko: 'Korean', es: 'Spanish', it: 'Italian', pt: 'Portuguese',
  ru: 'Russian', ar: 'Arabic', 'zh-CN': 'Chinese', 'zh-TW': 'Chinese (Traditional)',
}

const OPTIMIZATION_SYSTEM = `You are a prompt optimizer for Claude Code, a professional AI coding assistant.
Your job is to transform the user's input into an optimal English execution prompt.

Rules (strictly follow all):
1. Do not change the user's intent.
2. Do not add requirements that are not implied by the user.
3. Preserve code blocks, commands, logs, paths, identifiers, URLs, branch names, package names, and error messages.
4. Optimize the prompt for Claude Code usage.
5. Prefer clear task boundaries.
6. If the user asks for analysis, do not turn it into implementation.
7. If the user asks to implement, preserve that intent.
8. If the original prompt is ambiguous, add only minimal clarification.
9. Output valid JSON only.
10. Never expose secrets or sensitive values in generated content.

Additional domain terms to preserve: {domain_terms}

Output JSON with fields: detected_input_language, execution_prompt_en, rewrite_type, key_changes`

const REFINE_SYSTEM = `You are a prompt engineer helping a developer sharpen their ideas into precise AI coding assistant prompts.
Your job is to rewrite a rough idea into a clear, actionable prompt for Claude Code.

Rules:
1. Preserve the user's intent exactly.
2. Make the prompt specific, actionable, and well-structured.
3. Use imperative mood.
4. Output valid JSON only with field: execution_prompt_en`

export function buildOptimizationMessages(prompt, detection, config) {
  const domainTerms = (config.domain_terms || []).join(', ') || 'none'
  const systemPrompt = OPTIMIZATION_SYSTEM.replace('{domain_terms}', domainTerms)
  const detectedLang = (detection && detection.lang) || 'unknown'

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Input language: ${detectedLang}\nUser's prompt: ${prompt}\n\nGenerate the optimized English execution prompt.`,
      },
    ],
  }
}

export function buildRefineMessages(prompt, config) {
  return {
    messages: [
      { role: 'system', content: REFINE_SYSTEM },
      {
        role: 'user',
        content: `Refine this rough idea into a precise Claude Code prompt:\n\n${prompt}`,
      },
    ],
  }
}

// Builds a trailing instruction for Claude to append a native-language summary.
// Returns empty string when not applicable (lang is 'en' or not configured).
export function buildSummaryLanguageCtx(config) {
  const lang = config.summary_language || config.native_language
  if (!lang || lang === 'en') return ''
  return `\n\nAfter your response, append a brief summary in ${lang} (2-3 sentences) so the user can quickly grasp the key points in their native language.`
}

// Builds a trailing instruction requiring Claude to respond in the active space's
// target language. Returns empty string when mode is 'off' or language code is unknown.
export function buildResponseLanguageCtx(config) {
  if (config?.response_language_mode !== 'target') return ''
  const langName = LANG_CODE_TO_NAME[config?.target_language]
  if (!langName) return ''
  return `\n\nPlease respond entirely in ${langName}.`
}
